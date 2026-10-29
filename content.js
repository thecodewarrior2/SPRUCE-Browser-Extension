// content.js — runs inside Gmail (isolated world). Watches for opened messages, sends each link to
// the background page for analysis, then rewrites or marks it; blocks tracking pixels; handles the 🔍
// reveal; reports its own failures to the application log. Never reports Gmail's own errors.
// shared.js (loaded first) provides: isGhostAnchorStyle, detectLinkProblem, emailTrackerProvider,
// BUILTIN_TRACKER_SET, hostInSet and the settings model.

let linkCount = 0;
let pixelCount = 0;
let visualOverridesActive = true;
// ---------------------------------------------------------------------------
// SITE ADAPTER: where message bodies are and how each webmail proxies images.
// Gmail is fully supported; Outlook on the web and Proton Mail are experimental.
// ---------------------------------------------------------------------------
const SITE = (() => {
    const inFrame = window !== window.top;
    const parentOrigin = (location.ancestorOrigins && location.ancestorOrigins.length) ? location.ancestorOrigins[0] : '';
    let host = location.hostname;
    if (!host && parentOrigin) { try { host = new URL(parentOrigin).hostname; } catch (e) { /* ignore */ } }   // about:blank / srcdoc frames
    const fromParam = (src, names) => {
        try { const u = new URL(src); for (const n of names) { const v = u.searchParams.get(n); if (v && /^https?:\/\//i.test(v)) return v; } } catch (e) { /* ignore */ }
        return src;
    };
    // Gmail's image proxy keeps the sender's original URL after a '#'.
    const gmailOriginal = (src) => (/googleusercontent\.com\//.test(src) && src.includes('#http')) ? src.slice(src.indexOf('#') + 1) : src;
    if (host === 'mail.google.com') {
        return {
            id: 'gmail', name: 'Gmail', body: '.ii.gt', settingKey: null, readFrames: false,
            originalImageUrl: gmailOriginal,
            // Proxied images are fetched by the extension from Google's proxy (never from the sender).
            proxyImageUrl: (src) => /^https:\/\/[^/]*\.googleusercontent\.com\//.test(src) ? src.split('#')[0] : null,
            attachments: true
        };
    }
    const site = WEBMAIL_SITES.find(w => w.host.test(host) && (inFrame || !w.path || w.path.test(location.pathname)));
    if (site) {
        return {
            id: site.id, name: site.name, settingKey: site.settingKey,
            // In a site's message frame the whole frame is the message.
            body: inFrame && site.frameBody ? 'body' : site.body,
            readFrames: !inFrame && !!site.readFrames,
            originalImageUrl: (src) => fromParam(src, site.imageParams || ['url']),
            proxyImageUrl: () => null, attachments: false
        };
    }
    // Pages of a supported host that aren't mail (e.g. iCloud Photos), and the test harness.
    return { id: 'other', name: 'this site', body: '.ii.gt', settingKey: null, readFrames: false, originalImageUrl: gmailOriginal, proxyImageUrl: () => null, attachments: false };
})();

// Documents to scan. Several webmails (Proton, iCloud, Zoho, GMX) show each message in a frame. Some
// of those frames are sandboxed without scripts, where extension scripts can't run; when the frame
// allows same-origin access it is read from the page instead.
const observedFrames = new WeakSet();
const frameFirstSeen = new WeakMap();          // frame document → when the page first saw it
const FRAME_GRACE_MS = 1200;                   // time for the extension's own script to start in a frame

// A frame the extension's own script runs in marks itself, so the page doesn't count it twice.
if (window !== window.top) {
    try { document.documentElement.setAttribute('data-unshortener-frame', '1'); } catch (e) { /* ignore */ }
}

function scanRoots() {
    const roots = [{ doc: document, body: SITE.body }];
    if (SITE.readFrames) {
        for (const f of document.querySelectorAll('iframe')) {
            if (!f.dataset.unshortenerLoad) {           // the message is written into the frame after it's inserted
                f.dataset.unshortenerLoad = '1';
                f.addEventListener('load', () => scheduleScan());
            }
            let d = null;
            try { d = f.contentDocument; } catch (e) { /* cross-origin: not a message frame */ }
            if (!d || !d.body) continue;
            // Frames where the extension's own script runs are handled there. Only frames left
            // unmarked after a short grace period (sandboxed frames without scripts) are read here.
            if (d.documentElement.hasAttribute('data-unshortener-frame')) continue;
            if (!frameFirstSeen.has(d)) { frameFirstSeen.set(d, Date.now()); setTimeout(scheduleScan, FRAME_GRACE_MS + 100); }
            if (Date.now() - frameFirstSeen.get(d) < FRAME_GRACE_MS) continue;
            roots.push({ doc: d, body: 'body' });
            if (!observedFrames.has(d)) {
                observedFrames.add(d);
                const st = d.createElement('style');          // the hover style for 🔍 inside the frame
                st.textContent = '.unshortener-icon.unshortener-hover-reveal{opacity:0;transition:opacity .12s}a:hover+.unshortener-icon.unshortener-hover-reveal,.unshortener-icon.unshortener-hover-reveal:hover,.unshortener-icon.unshortener-hover-reveal:focus{opacity:1}';
                d.head && d.head.appendChild(st);
                new MutationObserver(() => scheduleScan()).observe(d.body, { childList: true, subtree: true });
                attachHoverCard(d);
            }
        }
    }
    return roots;
}
// All elements matching `suffix` inside message bodies, across every scanned document.
// Never anything editable: an email being written (some webmail labels its editor "Message body"
// too) must not be changed, or the changes would be sent to the recipients.
function isEditable(el) {
    return !!(el && (el.isContentEditable || (el.closest && el.closest('[contenteditable="true"], [contenteditable=""], textarea'))));
}
function inBodies(suffix) {
    const out = [];
    for (const r of scanRoots()) {
        const sel = r.body.split(',').map(x => x.trim() + (suffix ? ' ' + suffix : '')).join(', ');
        for (const el of r.doc.querySelectorAll(sel)) if (!isEditable(el) && phishSimGate(suffix ? (el.closest(r.body) || el) : el)) out.push(el);
    }
    return out;
}

// Phishing simulations (administrator policies). While rules exist, an email is checked only after it
// is known not to be a training email:
//   - managedPhishSimulationDomains (every webmail): every link goes to the vendor's domains;
//   - managedPhishSimulationRules (Gmail): the vendor's header (and secret value / sending address).
// A training email is left completely alone (no lookups that could count as a click, no pixel
// blocking that would hide "opened", no banners). If the check can't be made, the email is checked as
// usual.
let weakRulesLogged = false;
let refusedDomainsLogged = false;
function phishSimGate(body) {
    const rules = SITE.id === 'gmail' ? ((lastPolicy && lastPolicy.phishSimRules) || []) : [];
    const domains = (lastPolicy && lastPolicy.phishSimDomains) || [];
    if (!rules.length && !domains.length) return true;
    const st = body.dataset.unshortenerSim;
    if (st === 'no') return true;
    if (st === 'yes' || st === 'pending') return false;
    const refused = (lastPolicy && lastPolicy.phishSimDomainsRefused) || [];
    if (!refusedDomainsLogged && refused.length) {
        refusedDomainsLogged = true;
        reportEvent('warning', `Phishing simulation domains ignored: ${refused.map(r => `${r.domain} (${r.why})`).join('; ')}. A real phishing email linking only there would otherwise go unchecked; list only domains your training vendor owns.`);
    }
    if (!weakRulesLogged && rules.some(r => r.weak)) {
        weakRulesLogged = true;
        reportEvent('warning', `Phishing simulation rule${rules.filter(r => r.weak).length > 1 ? 's' : ''} ${rules.filter(r => r.weak).map(r => `“${r.name}”`).join(', ')} match a public header name only; a real phishing email could copy it. Add the vendor's secret header value or its sending addresses (Help for administrators: ADMIN-GUIDE.md).`);
    }
    body.dataset.unshortenerSim = 'pending';
    identifySimulation(body, rules, domains).then(found => guarded('Checking for a phishing simulation', () => {
        body.dataset.unshortenerSim = found ? 'yes' : 'no';
        if (found) reportEvent('info', `Phishing simulation email (${found}): left unchecked, as set by your administrator.`);
        scheduleScan();
    })).catch(() => { body.dataset.unshortenerSim = 'no'; scheduleScan(); });
    return false;
}

// What identifies the email as a training email ("KnowBe4", "links to ssuport.com"), or null.
async function identifySimulation(body, rules, domains) {
    if (domains.length) {
        const hrefs = [...body.querySelectorAll('a[href]')].map(a => a.href).filter(h => /^https?:\/\//i.test(h)).slice(0, 200);
        if (hrefs.length) {
            const unwrapped = await new Promise(resolve => safeSend({ action: 'unwrapLinksOffline', urls: hrefs }, resolve));
            const d = Array.isArray(unwrapped) ? linksAllOnSimulationDomains(unwrapped, domains) : null;
            if (d) return `links to ${d}`;
        }
    }
    if (rules.length) {
        const h = await getMessageHeaders(body);
        const rule = h ? matchPhishSimulation(h.raw, rules) : null;
        if (rule) return rule.name;
    }
    return null;
}
function containerOf(el) { return el.closest(SITE.body) || (el.ownerDocument && el.ownerDocument.body) || null; }

// Pixel settings for the current scan, so an image that finishes loading later can be checked alone.
let pixelContext = null;
// Message body (SITE.body) → number of tracking pixels blocked in it. Counts are derived from what is
// still on the page (see refreshCounts), so a conversation with several messages counts correctly.
const pixelCounts = new Map();
const processedLinksMap = new Map(); // Standard Map with explicit lifecycle clearing

// Sends an entry to the application log (via the background). Never includes link paths or queries.
// Only this extension's own failures are reported, never Gmail's page errors.
function reportEvent(level, message) {
    try {
        if (!chrome.runtime || !chrome.runtime.id) return;   // extension reloaded: this tab's script is orphaned
        chrome.runtime.sendMessage({ action: 'logEvent', level, source: 'Gmail', message: String(message) }, () => { void chrome.runtime.lastError; });
    } catch (e) { /* nothing more can be done from an orphaned script */ }
}

function originOf(url) {
    try { return new URL(url).origin; } catch (e) { return '(invalid link)'; }
}

// Runs one unit of work; a failure is logged and does not stop the rest of the email from being processed.
function guarded(what, fn) {
    try { return fn(); }
    catch (e) { reportEvent('error', `${what} failed: ${e && e.message ? e.message : e}`); }
}

// Drops state for elements Gmail has removed from the page (releasing them for garbage collection)
// and recomputes the counts from what is still displayed.
// A message counts only while it is displayed: Gmail keeps opened messages in the page (hidden) when
// you go back to the inbox or switch labels, so "still in the page" is not "on screen".
function isShown(el) { return !!el && el.isConnected && el.getClientRects().length > 0; }

function refreshCounts() {
    const shown = new Map();                                   // container → displayed? (once per refresh)
    const isShownCached = (c) => { if (!shown.has(c)) shown.set(c, isShown(c)); return shown.get(c); };
    linkCount = 0;
    for (const [el, d] of processedLinksMap) {
        if (!el.isConnected) { processedLinksMap.delete(el); continue; }
        if (d.countable && isShownCached(containerOf(el))) linkCount++;
    }
    pixelCount = 0;
    for (const [container, n] of pixelCounts) {
        if (!container.isConnected) { pixelCounts.delete(container); continue; }
        if (isShownCached(container)) pixelCount += n;
    }
}

// Active = protection is on for this site and a message is on screen. The toolbar icon is in color
// with the count while active, and greyed out without a count otherwise.
function protectionOn() {
    if (SITE.settingKey && lastSettings[SITE.settingKey] === false) return false;
    return lastSettings.enableLinkUnmasking !== false || lastSettings.enableTrackingPixelBlocking !== false;
}
let lastReported = '';
function reportState() {
    refreshCounts();
    const active = protectionOn() && inBodies('').some(isShown);
    const links = active ? linkStats() : null;
    const state = { action: 'updateBadge', active, linkCount: active ? linkCount : 0, pixelCount: active ? pixelCount : 0, links };
    const key = JSON.stringify(state);
    if (key !== lastReported) {                                // only tell the background about changes
        lastReported = key;
        safeSend(state);
    }
    return state;
}
// At most one state check every 250 ms, however busy the page is.
function scheduleBadgeUpdate() {
    if (badgeTimer) return;
    badgeTimer = setTimeout(() => { badgeTimer = null; guarded('Updating the toolbar badge', reportState); }, 250);
}

// Link statistics for the messages on screen (toolbar popup). Only web links count (not mailto:,
// tel: or in-page anchors). scanned = safe + unsafe + notVerified; unscanned = still being checked or
// could not be checked.
function linkStats() {
    const s = { total: 0, scanned: 0, safe: 0, caution: 0, unsafe: 0, notVerified: 0, unscanned: 0 };
    const shownBodies = new Set(inBodies('').filter(isShown));
    for (const a of inBodies('a')) {
        if (!shownBodies.has(containerOf(a))) continue;
        const disabled = a.hasAttribute('data-unshortener-original-href');
        const href = disabled ? a.getAttribute('data-unshortener-original-href') : (a.getAttribute('href') || '');
        if (!/^\s*(https?|javascript|data|vbscript|blob|file):/i.test(href)) continue;
        if (!disabled) { try { if (new URL(a.href).hostname === 'mail.google.com') continue; } catch (e) { continue; } }
        s.total++;
        const d = processedLinksMap.get(a);
        if (disabled) { s.scanned++; s.unsafe++; }
        else if (d) {
            s.scanned++;
            if (!d.isSafe && d.severity === 'caution') s.caution++;
            else if (!d.isSafe) s.unsafe++;
            else if (d.isUnknown && !d.isAllowlisted) s.notVerified++;
            else s.safe++;
        } else s.unscanned++;
    }
    return s;
}

// The toolbar badge is updated once after a burst of changes, not once per link or pixel.
let badgeTimer = null;


function safeSend(message, callback) {
    try {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) { if (callback) callback(null); return; }
            if (callback) callback(response);
        });
    } catch (e) {
        // Extension was reloaded/updated while this tab stayed open.
        if (callback) callback(null);
    }
}

// Link marker icons as [size, extra <svg> attributes, [tag, attributes]…]; built with DOM calls, never
// parsed from markup. Dangerous link: red octagon with a yellow "!".
const SVG_NS = 'http://www.w3.org/2000/svg';
const DANGER_SVG = [22, {}, [
    ['polygon', { points: '7,2 17,2 22,7 22,17 17,22 7,22 2,17 2,7', fill: '#d93025', stroke: '#ffffff', 'stroke-width': '1.5' }],
    ['path', { d: 'M12,6.5 L12,12.5', stroke: '#ffd700', 'stroke-width': '2.5', 'stroke-linecap': 'round' }],
    ['circle', { cx: '12', cy: '16.5', r: '1.5', fill: '#ffd700' }]]];
// Suspicious but not dangerous (text shows another site, raw IP…): amber warning triangle.
const CAUTION_SVG = [20, { 'aria-hidden': 'true' }, [
    ['path', { d: 'M12 2.5 L22.5 21 H1.5 Z', fill: '#f9ab00', stroke: '#5f3b00', 'stroke-width': '1.2', 'stroke-linejoin': 'round' }],
    ['rect', { x: '11', y: '9', width: '2', height: '6.5', rx: '1', fill: '#202124' }],
    ['circle', { cx: '12', cy: '18', r: '1.2', fill: '#202124' }]]];
// Blocklisted link with a hidden destination: magnifier on a red disc. Click = "reveal?" prompt.
const REVEAL_SVG = [22, {}, [
    ['circle', { cx: '12', cy: '12', r: '11', fill: '#d93025', stroke: '#ffffff', 'stroke-width': '1.5' }],
    ['circle', { cx: '10.5', cy: '10.5', r: '4.2', fill: 'none', stroke: '#ffffff', 'stroke-width': '2' }],
    ['path', { d: 'M13.6,13.6 L17.5,17.5', stroke: '#ffffff', 'stroke-width': '2.4', 'stroke-linecap': 'round' }],
    ['path', { d: 'M10.5,8.6 L10.5,10.9 M10.5,12.4 L10.5,12.5', stroke: '#ffd700', 'stroke-width': '1.8', 'stroke-linecap': 'round' }]]];

// Email tracking link: small blue magnifier, shown when the link is hovered (see content.css).
const TRACKER_REVEAL_SVG = [16, {}, [
    ['circle', { cx: '12', cy: '12', r: '11', fill: '#1a73e8', stroke: '#ffffff', 'stroke-width': '1.5' }],
    ['circle', { cx: '10.5', cy: '10.5', r: '4.2', fill: 'none', stroke: '#ffffff', 'stroke-width': '2' }],
    ['path', { d: 'M13.6,13.6 L17.5,17.5', stroke: '#ffffff', 'stroke-width': '2.4', 'stroke-linecap': 'round' }]]];

function buildSvg([size, attrs, shapes]) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const set = (el, a) => { for (const [k, v] of Object.entries(a)) el.setAttribute(k, v); };
    set(svg, Object.assign({ width: String(size), height: String(size), viewBox: '0 0 24 24', style: 'vertical-align: middle; display: inline-block;' }, attrs));
    for (const [tag, a] of shapes) { const el = document.createElementNS(SVG_NS, tag); set(el, a); svg.appendChild(el); }
    return svg;
}

let lastSettings = {};
let lastPolicy = {};    // administrator-only policies (phishing simulation rules…)   // settings used for the most recent scan (needed when a link is revealed later)

function findIcon(link) {
    const next = link.nextElementSibling;
    if (next && next.classList.contains('unshortener-icon')) return next;
    return link.querySelector('.unshortener-icon');
}

// kind: 'danger' | 'reveal' (blocklisted) | 'trackreveal' (email tracker) | 'shield' | null (hide)
function setIcon(link, kind, title) {
    let icon = findIcon(link);
    if (!kind) {
        if (icon) { icon.style.display = 'none'; icon.textContent = ''; icon.dataset.kind = ''; }
        return;
    }
    if (!icon) {
        if (!link.parentNode) return;
        icon = document.createElement('span');
        icon.className = 'unshortener-icon';
        icon.style.cssText = 'display:inline-block;background-color:transparent;border:none;padding:0;vertical-align:middle;';
        icon.addEventListener('click', (e) => guarded('Handling a click on a warning icon', () => {
            const kind = icon.dataset.kind;
            if (kind !== 'danger' && kind !== 'caution' && kind !== 'reveal' && kind !== 'trackreveal') return;
            e.preventDefault();
            e.stopPropagation();
            if (kind === 'reveal' || kind === 'trackreveal') revealLink(link);
            else link.click();
        }));
        link.after(icon);
    }
    icon.dataset.kind = kind;
    icon.style.display = 'inline-block';
    icon.title = title || '';
    icon.classList.toggle('unshortener-hover-reveal', kind === 'trackreveal');
    if (kind === 'trackreveal') {
        icon.setAttribute('role', 'button');
        icon.setAttribute('tabindex', '0');
        icon.setAttribute('aria-label', title || 'Reveal where this link goes');
        if (!icon.dataset.keys) {
            icon.dataset.keys = '1';
            icon.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); icon.click(); } });
        }
    } else {
        icon.removeAttribute('role'); icon.removeAttribute('tabindex'); icon.removeAttribute('aria-label');
    }
    if (kind === 'shield') {
        icon.textContent = ' 🛡️';
        icon.style.fontSize = '1.0em';
        icon.style.marginLeft = '4px';
        icon.style.cursor = '';
    } else {
        icon.replaceChildren(buildSvg(kind === 'danger' ? DANGER_SVG : kind === 'caution' ? CAUTION_SVG : kind === 'trackreveal' ? TRACKER_REVEAL_SVG : REVEAL_SVG));
        icon.style.marginLeft = kind === 'trackreveal' ? '3px' : '6px';
        icon.style.cursor = 'pointer';
    }
}

// Title = this extension's notes + its main message + the sender's own title (never discarded).
// The extension's information about a link is shown by the hover card (see HOVER CARD), so it is
// kept in a data attribute; the sender's own title, if any, stays exactly as written.
function setTitle(link, d, main) {
    d.info = [...(d.notes || []), main].filter(Boolean).join('\n');
    if (d.info) link.dataset.unshortenerInfo = d.info; else delete link.dataset.unshortenerInfo;
    if (d.originalTitle) link.setAttribute('title', d.originalTitle); else link.removeAttribute('title');
}

// Replaces the link's content with text, keeping the original nodes so they can be put back
// exactly (bold, spans and other sender markup survive a toggle).
function replaceLinkText(link, d, text) {
    if (!d.textReplaced) d.originalNodes = Array.from(link.childNodes);
    // A fresh text node: setting textContent can update a lone existing text node in place, which
    // would overwrite the saved original.
    link.replaceChildren(document.createTextNode(text));
    d.textReplaced = true;
}

// Puts the link back exactly as the sender wrote it: content and the full inline style attribute.
// (Earlier versions blanked color/background/padding/border-radius, which destroyed styled
// call-to-action buttons.)
function restoreLink(link, d) {
    if (d.textReplaced) {
        link.replaceChildren(...(d.originalNodes || [document.createTextNode(d.originalText)]));
        d.textReplaced = false;
    }
    if (d.originalStyle === null || d.originalStyle === undefined) {
        link.removeAttribute('style');
    } else {
        link.setAttribute('style', d.originalStyle);
    }
}

function applyLinkStyles(link, linkData) {
    const d = linkData;
    restoreLink(link, d);

    if (!visualOverridesActive || !d.needsStyling) {
        link.href = d.originalUrl;
        setIcon(link, null);
        setTitle(link, d, null);
        return;
    }

    link.href = d.finalUrl;
    const hasImage = !!link.querySelector('img');

    // Caution links in an email with many of them are described once in the email banner instead.
    if (d.collapsed && !d.isSafe && d.severity === 'caution') {
        link.href = d.finalUrl;
        setTitle(link, d, `${d.reason || 'Unusual link'}.\nDestination: ${d.finalUrl}`);
        setIcon(link, null);
        return;
    }

    // Company-only links (c.gle…): no highlight and no icon, however many there are; any caution is
    // shown once in the email banner. The tooltip keeps only the facts.
    if (d.companyLink) {
        link.href = d.originalUrl;
        const c = d.companyLink;
        setTitle(link, d, `${c.brand} short link (${c.host}). Where it leads couldn't be looked up.` +
            (d.companyVerified ? `\nThe email was verified as sent by ${c.brand} directly to you.` : '') + `\nAddress: ${d.originalUrl}`);
        setIcon(link, null);
        return;
    }

    // Case 1: Allowlisted Domains
    if (d.isAllowlisted) {
        setTitle(link, d, `Allowlisted URL: ${d.originalUrl}`);
        setIcon(link, 'shield', 'Domain is allowlisted by user or enterprise policy');
        return;
    }

    // Case 2: Safe links: sender styling untouched.
    if (d.isSafe) {
        if (d.isNakedUrl && !hasImage) replaceLinkText(link, d, d.finalUrl);
        let title = `Clean destination: ${d.finalUrl}\n(Original link: ${d.originalUrl})`;
        if (d.isUnknown && d.note) title += `\n(Not verified: ${d.note})`;
        if (d.trackerRevealable && !d.revealed) {
            title = `Email tracking link (${d.trackerProvider}). Its destination is kept by the provider.\nHover and click the 🔍 next to it to reveal where it goes.`;
            setTitle(link, d, title);
            setIcon(link, 'trackreveal', 'Reveal where this email tracking link goes (asks first; does not open it)');
            return;
        }
        setTitle(link, d, title);
        setIcon(link, null);
        return;
    }

    // Case 3a: Caution (suspicious but common in legitimate mail): amber, text kept, ⚠ icon.
    if (d.severity === 'caution') {
        const why = d.reason || 'Suspicious link';
        setTitle(link, d, `⚠️ Caution: ${why}.\nDestination: ${d.finalUrl}`);
        link.style.backgroundColor = '#fef7e0';
        link.style.color = '#5f3b00';
        link.style.border = '1px solid #f9ab00';
        link.style.padding = '1px 4px';
        link.style.borderRadius = '4px';
        link.style.textDecoration = 'underline';
        if (hasImage) { link.style.outline = '3px solid #f9ab00'; link.style.outlineOffset = '2px'; }
        setIcon(link, 'caution', `Caution: ${why}`);
        return;
    }

    // Case 3b: Unsafe / Flagged Links
    const blockReason = d.reason || "Unsafe content";

    // DNS-flagged links get their text replaced; link-text mismatches keep the text so the
    // reader can still see what the link claimed to be.
    if (!hasImage && !d.keepText) {
        replaceLinkText(link, d, d.revealed && d.finalUrl !== d.originalUrl
            ? `DO NOT CLICK: ${blockReason} → ${d.finalUrl}`   // revealed blocklisted link: show where it goes
            : `DO NOT CLICK: ${blockReason}`);
    }

    if (d.destinationHidden) {
        setTitle(link, d, `⚠️ WARNING: ${blockReason}.\nWhere this link goes has been hidden. Click the 🔍 icon next to it to reveal the destination (this does not open the link).`);
    } else {
        setTitle(link, d, `⚠️ WARNING: ${blockReason}. Destination: ${d.finalUrl}`);
    }
    link.style.backgroundColor = '#d93025';
    link.style.color = '#ffffff';
    link.style.padding = '3px 6px';
    link.style.borderRadius = '4px';
    link.style.fontWeight = 'bold';
    link.style.textDecoration = 'none';
    link.style.display = 'inline-block';
    if (hasImage) {
        link.style.outline = '4px solid #d93025';
        link.style.outlineOffset = '2px';
    }
    if (d.destinationHidden) setIcon(link, 'reveal', 'Blocked link: click to reveal where it goes (does not open it)');
    else if (d.cloudInspectable && !d.revealed) setIcon(link, 'reveal', 'Cloud-storage page: click to inspect where it redirects (does not open it)');
    else setIcon(link, 'danger', `WARNING: ${blockReason}`);
}

// Reveal flow for blocklisted links. Nothing about the link is decoded or sent anywhere until the
// user clicks the icon and confirms. Revealing never opens the link.
// Reveal on request: a blocklisted link (destination hidden) or an email tracking link (destination
// kept by the provider). Nothing is decoded or sent until the user confirms. Revealing never opens the link.
function revealLink(link) {
    const d = processedLinksMap.get(link);
    if (!d || d.revealing || !(d.destinationHidden || (d.trackerRevealable && !d.revealed) || (d.cloudInspectable && !d.revealed))) return;
    const isCloud = !d.destinationHidden && d.cloudInspectable && !d.revealed;
    const isTracker = !d.destinationHidden && !isCloud;

    let message;
    if (isCloud) {
        message =
            `☁️ This link opens a web page stored in public cloud storage (${d.cloudPlatform}). Phishing kits use such pages to redirect visitors to the real site.\n\n` +
            `To find out where it redirects, the extension will download the page's code from ${d.cloudPlatform} and read it. ` +
            `Nothing in it is run, and the hidden data after "#" in the link is never sent.\n\n` +
            `Inspect it? This does NOT open the link, and the link stays flagged.`;
    } else if (isTracker) {
        message =
            `📧 This is an email tracking link from ${d.trackerProvider}. Where it goes is stored by the provider, so it can't be read from the link itself.\n\n` +
            `To reveal it, the full link will be sent to ${d.revealVia || 'unshorten.me'}, which will follow it. ` +
            `The sender will see this as a click on the link, as if you had opened it.\n\n` +
            `Reveal where it goes? This does NOT open the link in your browser.`;
    } else {
        const owner = d.blockedByPolicy ? "your organization's blocklist" : 'your blocklist';
        const privacy = d.revealUsesNetwork
            ? `To find out, the full link will be sent to ${d.revealVia || 'unshorten.me'}, which will follow it to its destination. The sender may be able to see that the link was followed.`
            : 'It will be decoded on this device only. Nothing will be sent to any third party.';
        message =
            `🔒 This link is on ${owner}, so its destination has been hidden.\n\n` +
            `Link: ${d.originalUrl}\n\n` +
            `Do you want to reveal where it goes?\n${privacy}\n\n` +
            `Revealing does NOT open the link, and the link stays flagged.`;
    }
    if (!confirm(message)) return;

    d.revealing = true;
    const icon = findIcon(link);
    if (icon) icon.title = 'Revealing destination…';

    safeSend({ action: 'resolveUrl', url: d.originalUrl, linkText: d.linkText, reveal: true }, (response) => guarded('Revealing a link', () => {
        d.revealing = false;
        const kindLabel = isTracker ? 'an email tracking link' : 'a blocklisted link';
        if (!response || !response.finalUrl) {
            if (icon) icon.title = 'Reveal where this link goes (asks first; does not open it)';
            reportEvent('warning', `Revealing ${kindLabel} on ${originOf(d.originalUrl)} failed (no answer from the background service).`);
            alert('The destination of this link could not be revealed.');
            return;
        }
        d.notes = (d.notes || []).filter(n => !n.startsWith('Revealed:'));
        const changed = response.finalUrl !== d.originalUrl;

        if (isCloud) {
            d.revealed = true;
            d.isSafe = false;                                   // stays flagged
            if (response.reason) d.reason = response.reason;
            d.notes.push(changed ? `Revealed: the page redirects to ${response.finalUrl}` : 'Revealed: no redirect target could be found in the page\'s code.');
            if (changed) d.finalUrl = response.finalUrl;
        } else if (isTracker) {
            d.trackerRevealable = false;
            d.revealed = true;
            if (!changed) {
                d.notes.push('Revealed: the lookup service could not find the destination, so it is still unknown.');
                applyLinkStyles(link, d);
                alert('The lookup service could not reveal where this link goes.');
                return;
            }
            d.finalUrl = response.finalUrl;
            let problem = null;
            if (lastSettings.enableMismatchWarnings) problem = detectLinkProblem(d.originalText, d.originalUrl, d.finalUrl, BUILTIN_TRACKER_SET);
            d.isSafe = response.isSafe && !problem;
            d.keepText = response.isSafe && !!problem;
            d.severity = !response.isSafe ? 'danger' : linkProblemSeverity(problem);
            d.reason = !response.isSafe ? response.reason : (problem ? problem.charAt(0).toUpperCase() + problem.slice(1) : null);
            d.isUnknown = response.verdict === 'unknown';
            d.note = response.note;
            d.needsStyling = true;
            d.notes.push(`Revealed: goes to ${d.finalUrl}`);
            if (!d.isSafe) attachClickConfirmation(link, d);
            d.countable = true;
            scheduleBadgeUpdate();
        } else {
            d.destinationHidden = false;
            d.revealed = true;
            d.finalUrl = response.finalUrl;
            d.isSafe = false;                                  // a blocklisted link stays flagged
            d.reason = response.isSafe ? d.reason : (response.reason || d.reason);
            d.notes.push(changed ? `Revealed: goes to ${response.finalUrl}`
                : response.shortLinkUnresolved ? 'Revealed: the destination could not be looked up, so it is still unknown.'
                : 'Revealed: this link does not redirect anywhere else; this is its real destination.');
        }
        applyLinkStyles(link, d);
    }));
}

// Asks before opening a flagged link (click or middle-click). Reads linkData at click time, so a
// later reveal is reflected. Attached at most once per link.
function attachClickConfirmation(el, linkData) {
    if (!lastSettings.enableClickConfirmation || linkData.confirmAttached) return;
    linkData.confirmAttached = true;
    const confirmClick = (event) => {
        if (event.type === 'auxclick' && event.button !== 1) return; // middle-click only
        if (linkData.isSafe) return;
        // Links described only in the email banner (amber) open normally; red ones always ask.
        if (linkData.severity !== 'danger' && (linkData.collapsed || linkData.companyLink)) return;
        const proceed = linkData.severity === 'caution'
            ? confirm(`⚠️ Caution: ${linkData.reason || 'This link looks suspicious'}.\n\nDestination: ${linkData.finalUrl}\n\nOpen it anyway?`)
            : confirm(
            `⚠️ STOP: This link was flagged by your security filter.\n\n` +
            `Reason: ${String(linkData.reason || 'Unsafe content').toUpperCase()}\n` +
            (linkData.destinationHidden
                ? `Destination: hidden (blocklisted). Use the 🔍 icon to reveal it first.\n\n`
                : `Destination: ${linkData.finalUrl}\n\n`) +
            `Are you absolutely sure you want to visit this site?`
        );
        if (!proceed) { event.preventDefault(); event.stopPropagation(); }
    };
    el.addEventListener('click', confirmClick);
    el.addEventListener('auxclick', confirmClick);
}

function processTrackingPixels(allTargetDomains, allowlist, shouldRemovePixels) {
    pixelContext = { allowSet: new Set(allowlist), trackerSet: new Set(allTargetDomains), shouldRemovePixels };
    inBodies('img').forEach(img => guarded('Checking an image for tracking pixels', () => checkPixel(img)));
}

// Decides whether one image is a tracking pixel and, if so, removes or neutralizes it.
// Decides whether one image is a tracking pixel and, if so, removes or neutralizes it. Order:
//   1. a known open-pixel address (SendGrid /wf/open, Mailchimp /track/open.php, …) → pixel at any size
//   2. any image larger than 20 px → never a pixel (real content: banners, photos, QR codes)
//   3. tiny, hidden or collapsed images → pixel
//   4. small/unknown-size images on a tracker domain → pixel
// Images that are not pixels are passed on to the QR-code check.
function checkPixel(img) {
    if (!pixelContext || img.dataset.unshortened || !img.isConnected) return;
    const { allowSet, trackerSet, shouldRemovePixels } = pixelContext;

    const src = img.src;
    if (!src || src.startsWith('data:')) return;
    const originalUrl = SITE.originalImageUrl(src);
    let hostname = '';
    try { hostname = new URL(originalUrl).hostname.toLowerCase(); } catch (e) { /* not a URL */ }
    if (hostname && hostInSet(hostname, allowSet)) { maybeScanQr(img); return; }

    let isTracker = !!openPixelRule(originalUrl);
    if (!isTracker) {
        const attrW = parseInt(img.getAttribute('width') || '-1', 10);
        const attrH = parseInt(img.getAttribute('height') || '-1', 10);
        const styleW = parseInt(img.style.width || '-1', 10);
        const styleH = parseInt(img.style.height || '-1', 10);
        // naturalWidth/Height are only meaningful once loaded; earlier they read 0×0.
        const loaded = img.complete && img.naturalWidth > 0;
        const w = attrW >= 0 ? attrW : (styleW >= 0 ? styleW : (loaded ? img.naturalWidth : -1));
        const h = attrH >= 0 ? attrH : (styleH >= 0 ? styleH : (loaded ? img.naturalHeight : -1));

        if (w > 20 || h > 20) { maybeScanQr(img); return; }          // content image, whatever its domain

        if ((w < 0 || h < 0) && !img.complete) {
            // Size unknown yet: decide when it finishes loading (only this image is re-checked).
            if (!img.dataset.pixelDeferred) {
                img.dataset.pixelDeferred = '1';
                img.addEventListener('load', () => guarded('Checking an image for tracking pixels', () => checkPixel(img)), { once: true });
            }
            return;
        }
        const hiddenByStyle = img.style.display === 'none' || img.style.visibility === 'hidden' || img.style.opacity === '0';
        const parent = img.parentElement;
        const collapsed = parent && (parent.style.maxHeight === '0px' || parent.style.height === '0px') && parent.style.overflow === 'hidden';
        isTracker =
            (w >= 0 && h >= 0 && ((w <= 3 && h <= 8) || (w <= 8 && h <= 3) || (w * h <= 24))) ||   // 1×1, 2×6, area ≤ 24 px²
            (w >= 0 && w <= 3) || (h >= 0 && h <= 3) ||                                         // one side ≤ 3 px
            hiddenByStyle || collapsed ||
            (!!hostname && hostInSet(hostname, trackerSet));                                     // small or unknown size on a tracker domain
    }
    if (!isTracker) { maybeScanQr(img); return; }
    if (isTracker) {
        img.dataset.unshortened = 'true';
        const container = containerOf(img);
        if (container) pixelCounts.set(container, (pixelCounts.get(container) || 0) + 1);

        if (shouldRemovePixels) {
            img.remove();
        } else {
            // Silently neutralize without visual clutter
            img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            img.style.width = '0px';
            img.style.height = '0px';
            img.style.display = 'none';
            img.style.opacity = '0';
        }

        safeSend({ action: 'logPixel', url: originalUrl, removed: shouldRemovePixels });
        scheduleBadgeUpdate();
    }
}

// Anchors deliberately hidden with font-size:0 or near-zero opacity are disabled.
function neutraliseGhostAnchors() {
    inBodies('a[style]').forEach(a => guarded('Checking for hidden links', () => {
        if (a.dataset.unshortened) return;
        if (isGhostAnchorStyle(a.style)) {
            a.dataset.unshortened = 'ghost-blocked';
            a.removeAttribute('href');
            a.style.display = 'none';
        }
    }));
}

function unshortenLinks() {
    const emailBodies = inBodies('');
    if (emailBodies.length === 0) return;

    safeSend({ action: 'getSettings' }, (cfg) => guarded('Scanning an email', () => {
        if (!cfg || !cfg.values) {
            reportEvent('error', 'Settings could not be loaded, so this email was not scanned. Reload Gmail; if it keeps happening, reload the extension.');
            return;
        }
        lastSettings = cfg.values;
        lastPolicy = cfg.policy || {};
        if (SITE.settingKey && !cfg.values[SITE.settingKey]) return;     // support for this webmail switched off
        guarded('Checking attachments', scanAttachments);
        guarded('Looking for drawn QR codes', scanDrawnQr);
        guarded('Checking senders', scanSenders);
        const S = cfg.values;
        visualOverridesActive = S.visualOverridesActive;

        if (S.enableHiddenLinkProtection) neutraliseGhostAnchors();

        // Pixel detection: built-in tracker domains plus the blocklist. The synced community lists
        // are deliberately NOT used here or below: an untrusted list entry must never be able to
        // remove images or silence a warning.
        const pixelTrackerDomains = [...new Set([...publicShorteners, ...espTrackers, ...cfg.blocklist])];
        // Mismatch check: only skipped when the destination is still an unresolved BUILT-IN
        // shortener/tracker. The blocklist no longer silences warnings; it flags links instead.
        const unresolvedTrackerSet = BUILTIN_TRACKER_SET;

        if (S.enableTrackingPixelBlocking) {
            processTrackingPixels(pixelTrackerDomains, cfg.allowlist, S.removeTrackingPixels);
        }

        if (!S.enableLinkUnmasking) return;

        const links = inBodies('a');
        const pendingHrefs = new Map(); // Batches identical links in the same pass

        links.forEach(link => {
            const originalUrl = link.href;

            // Decide by the parsed host. (A substring test on "mail.google.com" let any link skip
            // scanning just by containing that text, e.g. https://evil.example/?x=mail.google.com.)
            let linkHost = '';
            try {
                const u = new URL(originalUrl);
                if (u.protocol === 'http:' || u.protocol === 'https:') linkHost = u.hostname.toLowerCase();
            } catch (e) {}
            if (!link.dataset.unshortened && riskyScheme(link.getAttribute('href'))) {
                flagRiskySchemeLink(link, riskyScheme(link.getAttribute('href')));
                return;
            }
            if (link.dataset.unshortened || !linkHost || linkHost === 'mail.google.com') {
                return;
            }

            link.dataset.unshortened = 'pending';

            if (!pendingHrefs.has(originalUrl)) {
                pendingHrefs.set(originalUrl, [link]);

                const linkTextForCheck = [
                    link.textContent.trim(),
                    ...Array.from(link.querySelectorAll('img')).map(i => i.alt || ''),
                    link.getAttribute('aria-label') || ''
                ].join(' ').trim();
                safeSend({
                    action: 'resolveUrl',
                    url: originalUrl,
                    linkText: linkTextForCheck
                }, (response) => {
                    const elements = pendingHrefs.get(originalUrl) || [];

                    elements.forEach(el => guarded(`Applying the result for a link on ${originOf(originalUrl)}`, () => {
                        if (response && response.finalUrl) {
                            const originalText = el.textContent.trim();
                            // Text shown as code ("meson.build", "config.yml") names a file, not a website.
                            const textClaim = el.closest('code, pre, kbd, samp, tt') || el.querySelector('code, kbd, samp, tt') ? '' : originalText;
                            const hasImg = !!el.querySelector('img');
                            const isNakedUrl = !hasImg && (originalText === originalUrl || originalText === originalUrl.replace(/^https?:\/\//, ''));

                            // Link-text vs destination, raw IPs, punycode, user:pass@ tricks.
                            let problem = null;
                            if (S.enableMismatchWarnings && !response.isAllowlisted) {
                                problem = detectLinkProblem(textClaim, originalUrl, response.finalUrl, unresolvedTrackerSet);
                            }
                            // A company-only short link (c.gle…) whose destination couldn't be looked up is
                            // judged by who sent the email (see verifyCompanyLink), not marked right away.
                            const companyLink = !problem && response.isSafe && response.shortLinkUnresolved
                                ? companyOnlyShortener(originalUrl) : null;
                            // A short link whose destination couldn't be looked up: Caution, with the reason.
                            if (!problem && response.isSafe && response.shortLinkUnresolved && !companyLink) {
                                const shortHost = hostLabel(originalUrl);
                                const brand = brandOfDomain(registrableDomain(shortHost));
                                problem = `${brand ? `${brand} short link (${shortHost})` : `short link (${shortHost})`}: its destination couldn't be looked up` +
                                          (response.shortLinkWhy ? ` (${response.shortLinkWhy})` : '');
                            }
                            const flagged = !response.isSafe || !!problem;
                            const reason = !response.isSafe
                                ? response.reason
                                : (problem ? problem.charAt(0).toUpperCase() + problem.slice(1) : null);

                            const notes = [];
                            if (response.isOneTime) notes.push('One-time / unsubscribe link: this extension did not open, fetch or store it.');
                            if (response.opaqueNote) notes.push(response.opaqueNote);
                            if (response.cloudFragment) notes.push(`Hidden data in the link (never sent to the server, read by the page's code): ${response.cloudFragment}`);

                            const linkData = {
                                originalUrl: originalUrl,
                                finalUrl: response.finalUrl,
                                originalText: originalText,
                                originalStyle: el.getAttribute('style'),   // sender's styling, restored verbatim
                                originalTitle: el.getAttribute('title'),
                                isNakedUrl: isNakedUrl,
                                isSafe: !flagged,
                                reason: reason,
                                keepText: response.isSafe && !!problem,
                                severity: !response.isSafe ? 'danger' : linkProblemSeverity(problem),
                                isUnknown: response.verdict === 'unknown',
                                note: response.note,
                                destinationHidden: !!response.destinationHidden,
                                blockedByPolicy: !!response.blockedByPolicy,
                                revealUsesNetwork: !!response.revealUsesNetwork,
                                revealVia: response.revealVia || '',
                                linkText: linkTextForCheck,
                                isAllowlisted: response.isAllowlisted,
                                notes: notes,
                                needsStyling: (!response.isAllowlisted && response.finalUrl !== originalUrl) || flagged || !!response.trackerRevealable || !!companyLink,
                                // counted on the badge only once something was actually changed or flagged
                                countable: (!response.isAllowlisted && response.finalUrl !== originalUrl) || flagged,
                                trackerRevealable: !!response.trackerRevealable,
                                trackerProvider: response.trackerProvider || '',
                                cloudInspectable: !!response.cloudInspectable,
                                cloudPlatform: response.cloudPlatform || '',
                                // Company-only link (c.gle…): never marked on the link itself; findings go to the email banner.
                                companyLink: companyLink || null,
                                textReplaced: false
                            };

                            processedLinksMap.set(el, linkData);
                            el.dataset.unshortened = 'true';

                            if (flagged) attachClickConfirmation(el, linkData);

                            applyLinkStyles(el, linkData);
                            if (companyLink) verifyCompanyLink(el, linkData, companyLink);
                            else if (flagged) scheduleBannerRefresh(containerOf(el));
                            if (linkData.countable) scheduleBadgeUpdate();
                        } else {
                            el.dataset.unshortened = 'failed';
                        }
                    }));
                    if (!response || !response.finalUrl) {
                        reportEvent('warning', `A link on ${originOf(originalUrl)} could not be analyzed and was left unchanged (no answer from the background service).`);
                    }

                    pendingHrefs.delete(originalUrl);
                });
            } else {
                pendingHrefs.get(originalUrl).push(link);
            }
        });
    }));
}

// Debounced Observer with Explicit Memory Clearing
let mutationDebounceTimer = null;
// ---------------------------------------------------------------------------
// QR CODES (email images and attachments). Pixels are decoded on this device by the extension's
// background scanner; a slim bar under the image or attachment shows where the code leads.
// ---------------------------------------------------------------------------
const QR_MAX_SQUARE = 8;        // QR-shaped images per message
const QR_MAX_POSTER = 3;        // large flyer/poster images per message (a QR code may be inside)
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const qrPerContainer = new WeakMap();

async function blobToBase64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(bin);
}

// Only images that could plausibly carry a QR code are scanned, so newsletters' banners and photos
// cost nothing: QR-shaped images (roughly square, at least 64 px), and a few large posters/flyers
// (at least 400 px on both sides). Ordinary wide banners are never scanned.
function maybeScanQr(img) {
    if (!lastSettings.enableQrScanning || img.dataset.qr || !img.isConnected) return;
    if (!(img.complete && img.naturalWidth > 0)) {
        if (!img.dataset.qrDeferred) {
            img.dataset.qrDeferred = '1';
            img.addEventListener('load', () => guarded('Checking an image for a QR code', () => maybeScanQr(img)), { once: true });
        }
        return;
    }
    const w = img.naturalWidth, h = img.naturalHeight, ratio = w / h;
    const square = Math.min(w, h) >= 64 && ratio >= 0.75 && ratio <= 1.33;
    const poster = !square && w >= 400 && h >= 400;
    if (!square && !poster) return;
    const container = containerOf(img);
    const counts = qrPerContainer.get(container) || { square: 0, poster: 0 };
    if (container && (square ? counts.square >= QR_MAX_SQUARE : counts.poster >= QR_MAX_POSTER)) return;
    if (square) counts.square++; else counts.poster++;
    if (container) qrPerContainer.set(container, counts);
    img.dataset.qr = 'scanning';

    const send = (payload) => safeSend(Object.assign({ action: 'scanQr' }, payload), (res) => guarded('Showing a QR code result', () => {
        img.dataset.qr = res && res.ok ? 'done' : 'failed';
        if (res && res.ok && res.codes && res.codes.length) showScanResults(img, res, '', img);
    }));
    const proxied = SITE.proxyImageUrl(img.src);
    if (proxied) return send({ url: proxied, mime: '' });
    let sameOrigin = false;
    try { sameOrigin = new URL(img.src).origin === location.origin || img.src.startsWith('blob:'); } catch (e) { /* ignore */ }
    if (!sameOrigin) { img.dataset.qr = 'skipped'; return; }   // never fetch from the sender's own server
    fetch(img.src, { credentials: 'include' })
        .then(r => r.blob()).then(async (blob) => { if (blob.size <= ATTACHMENT_MAX_BYTES) send({ b64: await blobToBase64(blob), mime: blob.type }); })
        .catch(() => { img.dataset.qr = 'failed'; });
}

// Gmail attachments. Located by the chip's download_url attribute ("mime:name:url") and, as a
// fallback, by download links (attid= with view=att / disp=). Each is fetched with the user's own Gmail
// session (same site) and checked on this device, by type:
//   images, PDFs → QR codes (+ PDF links) · SVG, HTML → scripts, redirects, fake logins · .ics → links
//   ZIP/RAR/7z → encrypted? · any file name → hidden text-direction characters
const ATTACHMENT_MAX_PER_SCAN = 6;
const EXT_MIME = { pdf: 'application/pdf', svg: 'image/svg+xml', svgz: 'image/svg+xml', html: 'text/html', htm: 'text/html', shtml: 'text/html',
    xhtml: 'text/html', ics: 'text/calendar', zip: 'application/zip', rar: 'application/x-rar', '7z': 'application/x-7z-compressed',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

function findAttachments() {
    const found = [];
    for (const el of document.querySelectorAll('[download_url]')) {
        const parts = String(el.getAttribute('download_url')).split(':');
        if (parts.length >= 3) found.push({ el, mime: parts[0], name: parts[1], url: parts.slice(2).join(':') });
    }
    for (const a of document.querySelectorAll('a[href*="attid="]')) {
        if (!/[?&](view=att|disp=(safe|inline|attd))/.test(a.getAttribute('href'))) continue;
        if (found.some(f => f.url === a.href)) continue;
        const name = (a.getAttribute('download') || a.getAttribute('aria-label') || a.textContent || '').replace(/^Download (attachment )?/i, '').trim();
        const ext = (name.match(/\.([a-z0-9]{1,5})$/i) || [])[1];
        found.push({ el: a, mime: EXT_MIME[(ext || '').toLowerCase()] || '', name, url: a.href });
    }
    return found;
}

function attachmentKind(mime, name) {
    const ext = ((String(name).match(/\.([a-z0-9]{1,5})$/i) || [])[1] || '').toLowerCase();
    if (/svg/i.test(mime) || ext === 'svg' || ext === 'svgz') return 'svg';
    if (/html/i.test(mime) || ['html', 'htm', 'shtml', 'xhtml'].includes(ext)) return 'html';
    if (/calendar/i.test(mime) || ext === 'ics') return 'ics';
    if (/zip|rar|7z|compressed/i.test(mime) || ['zip', 'rar', '7z'].includes(ext)) return 'archive';
    if (/pdf/i.test(mime) || ext === 'pdf') return 'pdf';
    if (/^image\//i.test(mime) || EXT_MIME[ext] && /^image\//.test(EXT_MIME[ext])) return 'image';
    return null;
}

function infoBar(anchor, text, severity) {
    const bar = document.createElement('div');
    bar.className = 'unshortener-qr-bar';
    bar.setAttribute('role', 'note');
    styleNotice(bar, anchor.parentElement || anchor, severity === 'warn' ? 'caution' : severity === 'danger' ? 'danger' : 'info');
    bar.style.maxWidth = '640px';
    bar.dataset.severity = severity || 'info';
    bar.textContent = text;
    anchor.after(bar);
    // A dangerous attachment counts in the email's verdict (sender label, banner, Spam).
    if (severity === 'danger') {
        const msg = anchor.closest('.adn, [data-message-id], .gs');
        const body = msg && msg.querySelector(SITE.body);
        if (body) scheduleBannerRefresh(body);
    }
    return bar;
}

function scanAttachments() {
    if (!SITE.attachments || !lastSettings.enableAttachmentScanning) return;
    let n = 0;
    for (const att of findAttachments()) {
        if (att.el.dataset.qrScanned || n >= ATTACHMENT_MAX_PER_SCAN) continue;
        att.el.dataset.qrScanned = '1';
        guarded('Checking an attachment', () => {
            if (hasDirectionTricks(att.name)) {
                infoBar(att.el, `⛔ The file name “${att.name.replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g, '')}” contains hidden characters that reverse text direction to disguise the real file type. Don't open it.`, 'danger');
            }
            const kind = attachmentKind(att.mime, att.name);
            if (!kind) return;
            let u;
            try { u = new URL(att.url, location.href); } catch (e) { return; }
            if (u.origin !== location.origin) return;
            n++;
            checkAttachment(att, kind, u.href);
        });
    }
}

async function readAttachment(url, limit) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!limit) return res.blob();
    // only the first `limit` bytes (archive headers)
    const reader = res.body.getReader();
    const chunks = []; let total = 0;
    while (total < limit) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); total += value.length; }
    reader.cancel().catch(() => {});
    const out = new Uint8Array(Math.min(total, limit)); let off = 0;
    for (const c of chunks) { const take = Math.min(c.length, out.length - off); out.set(c.subarray(0, take), off); off += take; if (off >= out.length) break; }
    return out;
}

function checkAttachment(att, kind, url) {
    const label = `“${att.name}”`;
    if (kind === 'archive') {
        readAttachment(url, 64 * 1024).then((head) => guarded('Checking an archive', () => {
            const info = archiveInfo(head);
            if (!info) return;
            if (info.encrypted) infoBar(att.el, `⚠️ ${label} is a password-protected ${info.format} archive. Email security can't scan inside it, which is why attackers use them (often with the password in the email). Only open it if you were expecting it from someone you trust.`, 'warn');
            else if (info.encrypted === null) infoBar(att.el, `ℹ️ ${label} is a ${info.format} archive whose contents can't be checked here. Be careful if you weren't expecting it.`, 'info');
        })).catch((e) => reportEvent('warning', `An archive attachment could not be read (${e.message}).`));
        return;
    }
    readAttachment(url).then(async (blob) => {
        if (blob.size > ATTACHMENT_MAX_BYTES) return;
        if (kind === 'svg' || kind === 'html') {
            const result = analyzeMarkup(await blob.text(), kind);
            guarded('Checking an attachment', () => {
                if (result.flags.length) {
                    infoBar(att.el, `⛔ DO NOT OPEN: the ${kind.toUpperCase()} attachment ${label} ${result.flags.join(', ')}. ${kind === 'svg' ? 'Real pictures never do this.' : 'Attachments like this are a common phishing technique.'}`, 'danger');
                }
                if (result.urls.length) showScanResults(att.el, { ok: true, codes: [], links: result.urls.map(url => ({ url })) }, label, null);
            });
            return;
        }
        if (kind === 'ics') {
            const urls = extractIcsUrls(await blob.text());
            if (urls.length) guarded('Checking a calendar invite', () => showScanResults(att.el, { ok: true, codes: [], links: urls.map(url => ({ url })) }, label, null));
            return;
        }
        safeSend({ action: 'scanQr', b64: await blobToBase64(blob), mime: att.mime || blob.type, name: att.name }, (res) => guarded('Showing an attachment result', () => {
            if (res && res.ok && ((res.codes && res.codes.length) || (res.links && res.links.length))) showScanResults(att.el, res, label, null);
        }));
    }).catch((e) => reportEvent('warning', `An attachment could not be read (${e.message}).`));
}

// ---------------------------------------------------------------------------
// QR CODES DRAWN WITHOUT AN IMAGE (HTML tables or block characters), used to slip past image scanners.
// The module grid is read from the page and decoded in the background; nothing is cheap to skip:
// only tables with at least 21×21 cells, or runs of block characters, are examined.
// ---------------------------------------------------------------------------
function cellIsDark(cell) {
    const view = cell.ownerDocument.defaultView;
    const c = (view.getComputedStyle(cell).backgroundColor || '').match(/[\d.]+/g);
    let rgb = c && c.length >= 3 && !(c.length === 4 && +c[3] === 0) ? c.slice(0, 3).map(Number) : null;
    if (!rgb) {
        const attr = cell.getAttribute('bgcolor');
        if (attr && /^#?[0-9a-f]{6}$/i.test(attr)) { const h = attr.replace('#', ''); rgb = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); }
    }
    if (!rgb) return 0;
    return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) < 128 ? 1 : 0;
}

function gridFromTable(table) {
    const rows = table.rows;
    if (rows.length < 21 || rows.length > 200) return null;
    const grid = [];
    for (const row of rows) {
        let cellsWide = 0;
        for (const c of row.cells) cellsWide += c.colSpan || 1;
        if (cellsWide < 21 || cellsWide > 200) return null;
        const line = [];
        for (const c of row.cells) { const v = cellIsDark(c); for (let k = 0; k < (c.colSpan || 1); k++) line.push(v); }
        grid.push(line);
    }
    const width = Math.max(...grid.map(r => r.length));
    return grid.map(r => r.concat(new Array(width - r.length).fill(0)));
}

const BLOCK_CHARS = /[█▀▄▌▐▖▗▘▝▙▚▛▜▞▟]/;
const QUADRANTS = { '█': [1, 1, 1, 1], '▀': [1, 1, 0, 0], '▄': [0, 0, 1, 1], '▌': [1, 0, 1, 0], '▐': [0, 1, 0, 1], '▘': [1, 0, 0, 0], '▝': [0, 1, 0, 0],
    '▖': [0, 0, 1, 0], '▗': [0, 0, 0, 1], '▚': [1, 0, 0, 1], '▞': [0, 1, 1, 0], '▙': [1, 0, 1, 1], '▛': [1, 1, 1, 0], '▜': [1, 1, 0, 1], '▟': [0, 1, 1, 1] };

function gridFromBlockText(text) {
    const lines = text.split('\n').map(l => l.replace(/\s+$/, '')).filter(l => BLOCK_CHARS.test(l));
    if (lines.length < 10) return null;
    const chars = new Set(lines.join(''));
    const width = Math.max(...lines.map(l => [...l].length));
    if (width < 10) return null;
    const halfOnly = [...chars].every(c => c === '█' || c === '▀' || c === '▄' || /\s/.test(c));
    const fullOnly = [...chars].every(c => c === '█' || /\s/.test(c));
    const grid = [];
    for (const line of lines) {
        const cs = [...line.padEnd(width, ' ')];
        if (fullOnly) { grid.push(cs.map(c => (c === '█' ? 1 : 0))); continue; }
        if (halfOnly) {                      // one column per character, two rows per line
            grid.push(cs.map(c => (c === '█' || c === '▀' ? 1 : 0)));
            grid.push(cs.map(c => (c === '█' || c === '▄' ? 1 : 0)));
            continue;
        }
        const top = [], bottom = [];         // quadrant characters: 2×2 modules each
        for (const c of cs) { const q = QUADRANTS[c] || [0, 0, 0, 0]; top.push(q[0], q[1]); bottom.push(q[2], q[3]); }
        grid.push(top, bottom);
    }
    // "██" per module (to look square): halve the width when every run is even
    if (fullOnly && grid.every(r => r.join('').split(/(?<=0)(?=1)|(?<=1)(?=0)/).every(run => run.length % 2 === 0))) {
        return grid.map(r => r.filter((_, i) => i % 2 === 0));
    }
    return grid;
}

function scanDrawnQr() {
    if (!lastSettings.enableQrScanning) return;
    const candidates = [];
    for (const t of inBodies('table')) {
        if (t.dataset.qrDrawn || t.rows.length < 21 || !t.rows[0] || t.rows[0].cells.length < 11) continue;
        t.dataset.qrDrawn = '1';
        const grid = gridFromTable(t);
        if (grid) candidates.push({ el: t, grid, where: 'a table in this email' });
    }
    for (const root of scanRoots()) {
        for (const body of root.doc.querySelectorAll(root.body)) {
            if (!BLOCK_CHARS.test(body.textContent)) continue;
            const walker = root.doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
            const parents = new Set();
            for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/[█▀▄▌▐▖▗▘▝▙▚▛▜▞▟]{3,}/.test(n.nodeValue)) parents.add(n.parentElement.closest('pre, p, div, td') || n.parentElement);
            for (const el of parents) {
                if (el.dataset.qrDrawn) continue;
                el.dataset.qrDrawn = '1';
                const grid = gridFromBlockText(el.innerText || el.textContent);
                if (grid) candidates.push({ el, grid, where: 'text characters in this email' });
            }
        }
    }
    for (const c of candidates.slice(0, 4)) {
        safeSend({ action: 'decodeQrMatrix', grid: c.grid }, (r) => guarded('Showing a drawn QR code', () => {
            if (r && r.text) showScanResults(c.el, { ok: true, codes: [{ text: r.text }] }, c.where, null);
        }));
    }
}

function flagRiskySchemeLink(link, scheme) {
    link.dataset.unshortened = 'true';
    const reason = scheme === 'javascript' || scheme === 'vbscript' ? 'this link runs code instead of opening a web page'
        : `this link opens embedded "${scheme}:" content instead of a web page`;
    link.setAttribute('data-unshortener-original-href', link.getAttribute('href'));
    link.removeAttribute('href');
    link.title = `⚠️ Disabled by Link Unshortener: ${reason}.`;
    link.style.backgroundColor = '#d93025'; link.style.color = '#fff'; link.style.padding = '2px 5px'; link.style.borderRadius = '4px';
    reportEvent('info', `Disabled a "${scheme}:" link in an email.`);
}

// Shows one bar per QR code (and up to 5 PDF links) under `anchor`; destinations are checked like links.
function showScanResults(anchor, res, label, img) {
    // label: '' for an image in the email, or the attachment's quoted name
    const place = (page) => label ? ` in ${label}${page ? `, page ${page}` : ''}` : '';
    const items = (res.codes || []).slice(0, 3).map(c => ({ text: c.text, where: place(c.page), kind: 'QR code' }))
        .concat((res.links || []).slice(0, 5).map(l => ({ text: l.url, where: place(l.page), kind: 'Link' })));
    const themeFrom = anchor.parentElement || anchor;
    for (const item of items) {
        const bar = document.createElement('div');
        bar.className = 'unshortener-qr-bar';
        bar.setAttribute('role', 'note');
        const isUrl = /^https?:\/\//i.test(item.text);
        // One bar: "🔳 QR code: <content or link> · status   Copy"
        const render = (kind, status, href) => {
            styleNotice(bar, themeFrom, kind);
            bar.style.maxWidth = '640px';
            bar.textContent = '';
            const lead = document.createElement('span');
            lead.textContent = `${kind === 'danger' ? '⛔' : kind === 'caution' ? '⚠️' : '🔳'} ${item.kind}${item.where}: `;
            bar.appendChild(lead);
            const shown = item.text.length > 200 ? item.text.slice(0, 200) + '…' : item.text;
            if (href) {
                const a = document.createElement('a');
                a.href = href;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = shown;
                a.dataset.unshortened = 'true';             // the extension's own link, not part of the email
                a.style.cssText = 'color:inherit;text-decoration:underline;font-weight:bold;';
                if (kind === 'caution') a.addEventListener('click', (e) => { if (!confirm(`⚠️ Caution: ${status}.\n\nOpen ${href} anyway?`)) e.preventDefault(); });
                bar.appendChild(a);
            } else {
                const span = document.createElement('span');
                span.style.cssText = 'font-weight:bold;';
                span.textContent = shown;                     // codes, text and dangerous links stay plain
                bar.appendChild(span);
            }
            if (status) { const st = document.createElement('span'); st.textContent = ` · ${status}`; bar.appendChild(st); }
            bar.appendChild(noticeButton('Copy', (b) => copyText(item.text, b)));
        };
        render('info', isUrl ? `checking ${hostLabel(item.text)}…` : '', null);
        anchor.after(bar);
        if (!isUrl) continue;
        safeSend({ action: 'resolveUrl', url: item.text, linkText: '' }, (r) => guarded('Showing a QR destination', () => {
            if (!r || !r.finalUrl) { render('info', 'could not be checked', item.text); return; }
            let problem = null;
            if (lastSettings.enableMismatchWarnings) problem = detectLinkProblem('', item.text, r.finalUrl, BUILTIN_TRACKER_SET);
            const dest = r.finalUrl;
            const goes = dest !== item.text ? `goes to ${hostLabel(dest)}` : '';
            if (r.isSafe && problem && linkProblemSeverity(problem) === 'caution') {
                render('caution', problem, dest);
            } else if (!r.isSafe || problem) {
                render('danger', `${item.kind === 'QR code' ? 'DO NOT SCAN' : 'DO NOT OPEN'}: leads to a flagged site (${!r.isSafe ? r.reason : problem})`, null);
                if (img) { img.style.outline = '4px solid #c5221f'; img.style.outlineOffset = '2px'; }
            } else if (r.verdict === 'unknown') {
                render('info', [goes, `not verified${r.note ? ` (${r.note})` : ''}`].filter(Boolean).join(' · '), dest);
            } else {
                render('ok', [goes, '✓ checked, nothing found'].filter(Boolean).join(' · '), dest);
            }
        }));
    }
}

function hostLabel(u) { try { return new URL(u).hostname; } catch (e) { return u; } }

// ---------------------------------------------------------------------------
// SENDER CHECKS (Gmail). Gmail's own authentication verdict for the open email is read from the
// message's original source ("Show original", same site, the user's own session) only when needed:
// the email contains a company-only short link (c.gle…) whose destination is unknown, or the
// sender's name claims a brand. Nothing is sent anywhere else. Results are cached per message.
// ---------------------------------------------------------------------------
const messageAuth = new Map();          // Gmail message id → Promise<auth | null>
const MESSAGE_AUTH_MAX = 100;
let gmailIkCache = null;
let authFetchFailureLogged = false;

function senderChecksActive() { return SITE.id === 'gmail' && lastSettings.enableSenderChecks !== false; }

// The permanent id of the message a body belongs to, as "msg-f:<decimal>".
function gmailMessageId(el) {
    const holder = el.closest('[data-message-id], [data-legacy-message-id]');
    if (!holder) return null;
    const permanent = (holder.getAttribute('data-message-id') || '').replace(/^#/, '');
    if (/^msg-f:\d+$/.test(permanent)) return permanent;
    const legacy = holder.getAttribute('data-legacy-message-id');
    if (legacy && /^[0-9a-f]{6,16}$/i.test(legacy)) { try { return `msg-f:${BigInt('0x' + legacy).toString()}`; } catch (e) { /* ignore */ } }
    return null;
}

// Gmail's account key (ik): from the page's GLOBALS script, else from any link that carries it.
function gmailIk() {
    if (gmailIkCache !== null) return gmailIkCache;
    let ik = '';
    for (const s of document.querySelectorAll('script:not([src])')) {
        const m = /GLOBALS\s*=\s*\[((?:[^\]]){0,3000})/.exec(s.textContent || '');
        if (m) { const parts = m[1].split(','); const v = (parts[9] || '').replace(/["'\s]/g, ''); if (/^[0-9a-f]{8,12}$/i.test(v)) { ik = v; break; } }
    }
    if (!ik) { const a = document.querySelector('a[href*="ik="]'); const m = a && /[?&]ik=([0-9a-f]{8,12})/i.exec(a.getAttribute('href')); if (m) ik = m[1]; }
    gmailIkCache = ik;
    return ik;
}

// "Show original" is the whole raw message, attachments included (possibly megabytes); only the
// headers at the top are needed, so reading stops once they end (blank line), at most 512 KB.
async function readUntilHeadersEnd(response) {
    if (!response.body || !response.body.getReader) return response.text();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '', bytes = 0;
    try {
        while (bytes < 512 * 1024) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            text += decoder.decode(value, { stream: true });
            const start = text.search(/<pre[\s>]/i);
            const from = start >= 0 ? start : 0;
            if (/\r?\n\r?\n/.test(text.slice(text.indexOf('>', from) + 1))) break;   // headers complete
        }
    } finally {
        reader.cancel().catch(() => {});
    }
    return text;
}

// The open email's headers from Gmail's "Show original" ({ raw, auth }), read once per email and
// shared by the sender checks and the phishing-simulation check; null if they can't be read.
function getMessageHeaders(el) {
    return getMessageHeadersById(gmailMessageId(el));
}
function getMessageHeadersById(id) {
    if (!id) return Promise.resolve(null);
    if (messageAuth.has(id)) return messageAuth.get(id);
    if (messageAuth.size >= MESSAGE_AUTH_MAX) messageAuth.delete(messageAuth.keys().next().value);
    const account = (/\/mail\/u\/(\d+)/.exec(location.pathname) || [, '0'])[1];
    const ik = gmailIk();
    const url = `${location.origin}/mail/u/${account}/?${ik ? `ik=${ik}&` : ''}view=om&permmsgid=${encodeURIComponent(id)}`;
    const p = fetch(url, { credentials: 'include' })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return readUntilHeadersEnd(r); })
        .then(text => {
            let raw = text;
            if (/<pre[\s>]/i.test(text)) {
                const doc = new DOMParser().parseFromString(text, 'text/html');
                const pre = doc.querySelector('#raw_message_text, pre.raw_message_text, pre');
                raw = pre ? pre.textContent : text;
            }
            return { raw, auth: parseAuthResults(raw) };
        })
        .catch(e => {
            if (!authFetchFailureLogged) { authFetchFailureLogged = true; reportEvent('warning', `Gmail's original message could not be read (${e.message}), so senders are treated as not checked.`); }
            return null;
        });
    messageAuth.set(id, p);
    return p;
}

function getMessageAuth(el) {
    return getMessageHeaders(el).then(h => {
        if (h && !h.auth && !authFetchFailureLogged) { authFetchFailureLogged = true; reportEvent('warning', 'Sender checks: no authentication results from Gmail in the original message, so senders are treated as not checked.'); }
        return h ? h.auth : null;
    });
}

// Links in quoted or forwarded parts were not written by this email's sender.
function inQuotedSection(el) { return !!el.closest('.gmail_quote, .gmail_quote_container, blockquote, .gmail_extra'); }

// Trusts a company-only link quietly when the email verifiably came from that company directly to
// the user (only logged); otherwise marks it Caution or Danger with the reason.
function verifyCompanyLink(el, d, company) {
    const body = containerOf(el) || el;
    const authP = senderChecksActive() ? getMessageAuth(body) : Promise.resolve(null);
    authP.then(auth => guarded('Checking who sent a company link', () => {
        if (!el.isConnected) return;
        const r = evaluateCompanyLink({ shortener: company, auth, inQuote: inQuotedSection(el) });
        if (r.verified) {
            d.companyVerified = true;
            applyLinkStyles(el, d);
            reportEvent('info', `Verified company link: a ${company.brand} link (${company.host}) in an email verified as sent by ${company.brand} directly to you. Its destination can't be looked up; it was left unmarked.`);
            return;
        }
        // Counted (popup statistics) but not styled; red cases still ask before opening.
        Object.assign(d, { isSafe: false, reason: r.reason, severity: r.severity, countable: true,
                           companyFinding: { code: r.code, severity: r.severity, company, sender: r.sender } });
        if (r.severity === 'danger') attachClickConfirmation(el, d);
        scheduleBannerRefresh(body);
        scheduleBadgeUpdate();
    }));
}

// The sender shown by Gmail for the message a body belongs to.
function gmailSenderOf(body) {
    const msg = body.closest('.adn, [data-message-id], .gs') || document;
    const s = msg.querySelector('.gD[email]');
    return s ? { name: s.getAttribute('name') || s.textContent.trim(), address: (s.getAttribute('email') || '').toLowerCase() } : null;
}

// ---------------------------------------------------------------------------
// THEME for everything the extension draws inside an email: notices follow the surface they sit on
// (Gmail's light or dark theme), with soft colors that keep at least 4.5:1 contrast.
// ---------------------------------------------------------------------------
const NOTICE_PALETTE = {
    light: { caution: { bg: '#fef7e0', fg: '#3c2a00', edge: '#f9ab00' }, danger: { bg: '#fce8e6', fg: '#5c0b07', edge: '#c5221f' },
             info: { bg: '#f1f3f4', fg: '#202124', edge: '#80868b' }, ok: { bg: '#e6f4ea', fg: '#0d3b1e', edge: '#188038' },
             card: { bg: '#ffffff', fg: '#202124', muted: '#5f6368', border: '#dadce0', link: '#1967d2' } },
    dark:  { caution: { bg: '#3a3220', fg: '#fde293', edge: '#f9ab00' }, danger: { bg: '#3c1f1f', fg: '#f6aea9', edge: '#ee675c' },
             info: { bg: '#303134', fg: '#e8eaed', edge: '#9aa0a6' }, ok: { bg: '#1e3a2a', fg: '#a8dab5', edge: '#34a853' },
             card: { bg: '#2d2e30', fg: '#e8eaed', muted: '#bdc1c6', border: '#5f6368', link: '#8ab4f8' } }
};
function isDarkSurface(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const m = (getComputedStyle(e).backgroundColor || '').match(/[\d.]+/g);
        if (m && m.length >= 3 && !(m.length === 4 && +m[3] === 0)) return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) < 128;
    }
    return false;
}
function palette(el) { return NOTICE_PALETTE[isDarkSurface(el) ? 'dark' : 'light']; }
function styleNotice(el, themeFrom, kind) {
    const c = palette(themeFrom)[kind] || palette(themeFrom).info;
    el.style.cssText = `display:block;box-sizing:border-box;margin:4px 0 8px;padding:8px 12px;border-radius:6px;font:13px/1.5 Arial,sans-serif;` +
        `background:${c.bg};color:${c.fg};border-left:4px solid ${c.edge};word-break:break-word;`;
    return c;
}
// A small text button (Details, Copy…) that inherits the notice's color; keyboard focus stays visible.
function noticeButton(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'all:unset;cursor:pointer;margin-left:10px;font:inherit;font-size:12px;text-decoration:underline;color:inherit;';
    b.addEventListener('focus', () => { b.style.outline = '2px solid currentColor'; b.style.outlineOffset = '2px'; });
    b.addEventListener('blur', () => { b.style.outline = 'none'; });
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(b); });
    return b;
}
async function copyText(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    if (btn) { const old = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = old; }, 1500); }
}

// ---------------------------------------------------------------------------
// EMAIL BANNER: one compact notice at the top of an email, full width, rebuilt from the email's
// current state. It lists, one sentence each: sender warnings, company links that can't be checked
// (grouped and counted), dangerous links (still marked in red), and unusual links when an email has
// so many that marking each would clutter it (they are then left plain). "Details" lists the links;
// "What should I do?" shows short advice. Both start closed so the banner stays small.
// ---------------------------------------------------------------------------
const COLLAPSE_CAUTION_AT = 5;            // amber links per email before they're summarized instead
const emailBanners = new WeakMap();      // message body → { el, sender: Map, open: { details, help } }
const bannerTimers = new WeakMap();

function bannerState(body) {
    let st = emailBanners.get(body);
    if (!st) { st = { el: null, sender: new Map(), open: { details: false, help: false } }; emailBanners.set(body, st); }
    return st;
}
function scheduleBannerRefresh(body) {
    if (!body) return;
    clearTimeout(bannerTimers.get(body));
    bannerTimers.set(body, setTimeout(() => guarded('Updating the email banner', () => refreshEmailBanner(body)), 150));
}

function linkCategory(reason) {
    const r = String(reason || '').toLowerCase();
    if (r.startsWith('link text shows')) return 'mismatch';
    if (r.includes('destination couldn\'t be looked up')) return 'unknown';
    if (r.includes('raw ip')) return 'ip';
    if (r.includes('sign-in link')) return 'signin';
    if (r.includes('punycode') || r.includes('international') || r.includes('unusual characters')) return 'unicode';
    return 'other';
}
const CATEGORY_TEXT = {
    mismatch: (n) => n === 1 ? 'A link in this email shows one website but goes to another.' : `${n} links in this email show one website but go to another.`,
    unknown: (n) => n === 1 ? 'A short link in this email goes somewhere that couldn\'t be looked up.' : `${n} short links in this email go to places that couldn't be looked up.`,
    ip: (n) => n === 1 ? 'A link in this email points to a raw internet address instead of a website name.' : `${n} links in this email point to raw internet addresses instead of website names.`,
    signin: (n) => n === 1 ? 'A sign-in link in this email sends you on to another site afterwards.' : `${n} sign-in links in this email send you on to another site afterwards.`,
    unicode: (n) => n === 1 ? 'A link in this email uses unusual characters in its web address.' : `${n} links in this email use unusual characters in their web address.`,
    other: (n) => n === 1 ? 'A link in this email looks unusual.' : `${n} links in this email look unusual.`
};

function refreshEmailBanner(body) {
    if (!body.isConnected) return;
    if (SITE.id === 'gmail' && openedStates.has(body)) updateOpenedVerdict(body);
    const st = bannerState(body);
    const companyGroups = new Map(), dangerLinks = [], cautionLinks = [];
    for (const [el, d] of processedLinksMap) {
        if (!el.isConnected || containerOf(el) !== body || d.isSafe) continue;
        if (d.companyFinding) {
            const k = `${d.companyFinding.code}|${d.companyFinding.company.host}`;
            if (!companyGroups.has(k)) companyGroups.set(k, Object.assign({ els: [] }, d.companyFinding));
            companyGroups.get(k).els.push(el);
        } else if (d.severity === 'danger') dangerLinks.push(el);
        else if (d.severity === 'caution') cautionLinks.push(el);
    }
    // Many amber links: summarize instead of marking each; few: mark each as before.
    const collapse = cautionLinks.length >= COLLAPSE_CAUTION_AT;
    for (const el of cautionLinks) {
        const d = processedLinksMap.get(el);
        if (!!d.collapsed !== collapse) { d.collapsed = collapse; applyLinkStyles(el, d); }
    }

    const lines = [], entries = [], kinds = new Set();
    for (const f of [...st.sender.values()].sort((a, b) => (a.severity === 'danger' ? 0 : 1) - (b.severity === 'danger' ? 0 : 1))) {
        lines.push({ severity: f.severity, text: f.message });
        kinds.add(f.severity === 'danger' ? 'sender' : (/phone number/.test(f.message) ? 'scam' : 'caution'));
    }
    if (dangerLinks.length) {
        const n = dangerLinks.length;
        const reasons = [...new Set(dangerLinks.map(el => processedLinksMap.get(el).reason).filter(Boolean))].slice(0, 2);
        lines.push({ severity: 'danger', text: `${n === 1 ? 'A link' : `${n} links`} in this email ${n === 1 ? 'is' : 'are'} flagged as dangerous${reasons.length ? ` (${reasons.join('; ')})` : ''}. ${n === 1 ? 'It is' : 'They are'} marked in red.` });
        kinds.add('danger');
        dangerLinks.forEach(el => entries.push(el));
    }
    for (const g of companyGroups.values()) {
        lines.push({ severity: g.severity, text: companyLinkSummary(g.code, g.els.length, g.company.brand, g.company.host, g.sender) });
        kinds.add(g.severity === 'danger' ? 'danger' : 'caution');
        g.els.forEach(el => entries.push(el));
    }
    if (collapse) {
        const byCat = new Map();
        for (const el of cautionLinks) { const c = linkCategory(processedLinksMap.get(el).reason); byCat.set(c, (byCat.get(c) || 0) + 1); }
        for (const [c, n] of byCat) lines.push({ severity: 'caution', text: CATEGORY_TEXT[c](n) });
        kinds.add('caution');
        cautionLinks.forEach(el => entries.push(el));
    }

    if (!lines.length) { if (st.el) { st.el.remove(); st.el = null; } return; }
    if (!st.el || !st.el.isConnected) {
        st.el = document.createElement('div');
        st.el.className = 'unshortener-email-banner';
        st.el.setAttribute('role', 'note');
        st.el.setAttribute('aria-label', 'Link Unshortener notice about this email');
        body.parentElement.insertBefore(st.el, body);
    }
    renderBanner(body, st, lines, entries, kinds);
}

function renderBanner(body, st, lines, entries, kinds) {
    const danger = lines.some(l => l.severity === 'danger');
    const c = styleNotice(st.el, body, danger ? 'danger' : 'caution');
    st.el.style.width = '100%';
    st.el.style.margin = '0 0 12px';
    st.el.textContent = '';
    for (const l of lines) {
        const div = document.createElement('div');
        div.style.margin = '2px 0';
        div.textContent = `${l.severity === 'danger' ? '⛔' : '⚠️'} ${l.text}`;
        st.el.appendChild(div);
    }
    const bar = document.createElement('div');
    bar.style.cssText = 'margin-top:4px;';
    const details = document.createElement('div');
    const help = document.createElement('div');
    if (entries.length) {
        const b = noticeButton(`${st.open.details ? 'Hide' : 'Show'} details (${entries.length})`, () => { st.open.details = !st.open.details; refreshEmailBanner(body); });
        b.style.marginLeft = '0';
        b.setAttribute('aria-expanded', String(st.open.details));
        bar.appendChild(b);
    }
    const hb = noticeButton('What should I do?', () => { st.open.help = !st.open.help; refreshEmailBanner(body); });
    if (!entries.length) hb.style.marginLeft = '0';
    hb.setAttribute('aria-expanded', String(st.open.help));
    bar.appendChild(hb);
    st.el.appendChild(bar);

    if (st.open.details && entries.length) {
        const list = document.createElement('ul');
        list.style.cssText = 'margin:6px 0 0;padding-left:18px;font-size:12px;max-height:180px;overflow:auto;';
        // In the order they appear in the email.
        entries.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
        for (const el of entries.slice(0, 60)) {
            const d = processedLinksMap.get(el);
            const li = document.createElement('li');
            li.tabIndex = 0;
            li.style.cssText = 'cursor:pointer;margin:1px 0;';
            const text = (el.textContent || '').trim().slice(0, 60) || '(image link)';
            li.textContent = `“${text}” → ${hostLabel(d.finalUrl || d.originalUrl)}`;
            // The reason is added only where the arrow doesn't already say it (dangerous links).
            if (d.severity === 'danger' && !d.companyFinding && d.reason) {
                const why = document.createElement('span');
                why.textContent = ` — ${String(d.reason).replace(/\.$/, '')}`;
                li.appendChild(why);
            }
            const flash = (on) => { el.style.outline = on ? `3px solid ${c.edge}` : ''; el.style.outlineOffset = on ? '2px' : ''; };
            li.addEventListener('mouseenter', () => flash(true));
            li.addEventListener('mouseleave', () => flash(false));
            li.addEventListener('focus', () => flash(true));
            li.addEventListener('blur', () => flash(false));
            const go = () => { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); flash(true); setTimeout(() => flash(false), 1600); };
            li.addEventListener('click', go);
            li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
            list.appendChild(li);
        }
        details.appendChild(list);
        st.el.appendChild(details);
    }
    if (st.open.help) {
        const tips = [];
        if (kinds.has('sender')) tips.push('Treat this email as untrusted: don\'t open its links or attachments, call its phone numbers or pay anything.');
        if (kinds.has('danger')) tips.push('Don\'t open links marked in red or reply with personal details. If the email claims to be from a company, go to its website by typing the address yourself, and report the email (in Gmail: ⋮ → Report phishing).');
        if (kinds.has('scam')) tips.push('Don\'t call numbers or pay from an unexpected message; contact the company through its official website.');
        if (kinds.has('caution')) tips.push('Before opening a link, point at it to see where it really goes. If you weren\'t expecting this email, check with the sender another way.');
        const label = document.createElement('div');
        label.style.cssText = 'margin-top:8px;font-size:12px;font-weight:bold;';
        label.textContent = 'What to do';
        const ul = document.createElement('ul');
        ul.style.cssText = 'margin:2px 0 0;padding-left:18px;font-size:12px;';
        for (const t of tips) { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }
        help.append(label, ul);
        st.el.appendChild(help);
    }
}

function showSenderFindings(body, findings) {
    const st = bannerState(body);
    for (const f of findings) st.sender.set(`sender|${f.message}`, f);
    if (findings.length) scheduleBannerRefresh(body);
}

// ---------------------------------------------------------------------------
// HOVER CARD: a small card shown when pointing at (or tabbing to) a checked link: verdict,
// destination, the extension's notes, and a Copy button. One element per page, created on first
// use; one page-wide listener; nothing runs per link.
// ---------------------------------------------------------------------------
const hoverCards = new WeakMap();        // document → { el, link, showTimer, hideTimer }
function hoverCardFor(doc) {
    let hc = hoverCards.get(doc);
    if (hc) return hc;
    const el = doc.createElement('div');
    el.id = 'unshortener-hover-card';
    el.setAttribute('role', 'tooltip');
    el.style.cssText = 'position:fixed;z-index:2147483000;display:none;max-width:420px;padding:10px 12px;border-radius:8px;' +
        'font:12.5px/1.45 Arial,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.25);word-break:break-word;';
    doc.body.appendChild(el);
    hc = { el, link: null, showTimer: null, hideTimer: null };
    el.addEventListener('mouseenter', () => clearTimeout(hc.hideTimer));
    el.addEventListener('mouseleave', () => hideHoverCard(doc, 150));
    hoverCards.set(doc, hc);
    return hc;
}
function hideHoverCard(doc, delay = 0) {
    const hc = hoverCards.get(doc);
    if (!hc) return;
    clearTimeout(hc.showTimer);
    clearTimeout(hc.hideTimer);
    hc.hideTimer = setTimeout(() => {
        hc.el.style.display = 'none';
        if (hc.link) hc.link.removeAttribute('aria-describedby');
        hc.link = null;
    }, delay);
}
function showHoverCard(link) {
    const d = processedLinksMap.get(link);
    if (!d || !d.info) return;
    const doc = link.ownerDocument;
    const hc = hoverCardFor(doc);
    clearTimeout(hc.hideTimer);
    const p = palette(link).card;
    hc.el.style.background = p.bg; hc.el.style.color = p.fg; hc.el.style.border = `1px solid ${p.border}`;
    hc.el.textContent = '';
    const banner = d.collapsed || d.companyFinding;
    const head = doc.createElement('div');
    head.style.cssText = 'font-weight:bold;margin-bottom:4px;';
    head.textContent = banner ? 'ℹ️ Explained in the note at the top of this email'
        : !d.isSafe && d.severity === 'danger' ? '⛔ Dangerous link'
        : !d.isSafe ? '⚠️ Caution'
        : d.isUnknown ? 'Not verified' : '✓ Checked, nothing found';
    hc.el.appendChild(head);
    const dest = d.destinationHidden ? null : (d.finalUrl || d.originalUrl);
    if (dest) {
        const host = doc.createElement('div');
        host.style.cssText = 'font-size:14px;';
        host.textContent = hostLabel(dest);
        const full = doc.createElement('div');
        full.style.cssText = `color:${p.muted};font-size:11.5px;`;
        full.textContent = dest.length > 160 ? dest.slice(0, 160) + '…' : dest;
        hc.el.append(host, full);
    }
    const notes = d.info.split('\n').filter(l => l && !(dest && l.includes(dest)) && !/^Address: /.test(l)).slice(0, 4);
    if (notes.length) {
        const n = doc.createElement('div');
        n.style.cssText = 'margin-top:6px;white-space:pre-line;';
        n.textContent = notes.join('\n').replace(/^⚠️ (WARNING|Caution): /gm, '');
        hc.el.appendChild(n);
    }
    if (dest) {
        const actions = doc.createElement('div');
        actions.style.cssText = `margin-top:6px;color:${p.link};`;
        const copy = noticeButton('Copy address', (b) => copyText(dest, b));
        copy.style.marginLeft = '0';
        actions.appendChild(copy);
        hc.el.appendChild(actions);
    }
    hc.el.style.display = 'block';
    const r = link.getBoundingClientRect(), w = hc.el.offsetWidth, h = hc.el.offsetHeight, vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
    hc.el.style.left = `${Math.max(8, Math.min(r.left, vw - w - 8))}px`;
    hc.el.style.top = `${r.bottom + 6 + h < vh ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
    hc.link = link;
    link.setAttribute('aria-describedby', hc.el.id);
}
const hoverListenersAdded = new WeakSet();
function attachHoverCard(doc) {
    if (hoverListenersAdded.has(doc)) return;
    hoverListenersAdded.add(doc);
    const linkOf = (t) => (t && t.closest ? t.closest('a') : null);
    const start = (e) => {
        const a = linkOf(e.target);
        if (!a || !processedLinksMap.has(a)) return;
        const hc = hoverCardFor(doc);
        clearTimeout(hc.hideTimer); clearTimeout(hc.showTimer);
        hc.showTimer = setTimeout(() => guarded('Showing link details', () => showHoverCard(a)), e.type === 'focusin' ? 0 : 300);
    };
    const end = (e) => {
        const a = linkOf(e.target);
        if (a && processedLinksMap.has(a) && !(e.relatedTarget && hoverCards.get(doc) && hoverCards.get(doc).el.contains(e.relatedTarget))) hideHoverCard(doc, 200);
    };
    doc.addEventListener('mouseover', start, true);
    doc.addEventListener('mouseout', end, true);
    doc.addEventListener('focusin', start, true);
    doc.addEventListener('focusout', end, true);
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideHoverCard(doc); }, true);
    doc.addEventListener('scroll', () => hideHoverCard(doc), true);
}
attachHoverCard(document);

// ---------------------------------------------------------------------------
// CHECKING LINKS BEFORE SENDING (Gmail). Send (the button, or Ctrl/⌘+Enter) is held while the links
// in the new message are checked; the quoted original is left out. If any link has a problem, a
// dialog lists them and the user goes back to fix them or sends anyway. An email without links
// sends at once. Checks that can't finish (network down, too slow) don't block sending.
// ---------------------------------------------------------------------------
const sendApproved = new WeakSet();      // compose windows allowed to send (our own repeated click)
let sendCheckRunning = false;
const COMPOSE_BODY_SELECTOR = 'div[contenteditable="true"][g_editable="true"], div[contenteditable="true"][role="textbox"]';

function sendCheckActive() { return SITE.id === 'gmail' && protectionOn() && lastSettings.enableSendCheck !== false; }

function gmailSendButtonFrom(target) {
    const b = target && target.closest ? target.closest('[role="button"]') : null;
    if (!b) return null;
    const label = (b.getAttribute('data-tooltip') || b.getAttribute('aria-label') || '').trim();
    if (/schedule|later|more send options/i.test(label)) return null;
    // "Send" in English, or Gmail's own (long-stable) class for the Send button in any language.
    if (!/^send\b/i.test(label) && !b.classList.contains('aoO')) return null;
    return b;
}
function composeOf(el) {
    for (let e = el; e && e !== document.body && e.nodeType === 1; e = e.parentElement) {
        if (e.querySelector(COMPOSE_BODY_SELECTOR)) return e;
    }
    return null;
}

// Links the sender wrote: linked text and typed addresses, outside quoted or forwarded parts.
function collectOutgoingLinks(body) {
    const inQuote = (n) => !!(n.nodeType === 1 ? n : n.parentElement).closest('.gmail_quote, .gmail_quote_container, blockquote, .gmail_extra');
    const seen = new Map();
    for (const a of body.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href') || '';
        if (inQuote(a) || !/^https?:\/\//i.test(href) || seen.has(href)) continue;
        seen.set(href, { url: href, text: (a.textContent || '').trim().slice(0, 200) });
    }
    let text = '';
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (inQuote(n) || n.parentElement.closest('a')) continue;
        text += n.nodeValue + '\n';
    }
    for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"']+|\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>"']*/gi)) {
        let u = m[0].replace(/[.,;:!?)\]]+$/, '');
        if (!/^https?:/i.test(u)) u = 'http://' + u;
        if (!seen.has(u)) seen.set(u, { url: u, text: '' });
    }
    // Names typed without http:// or www. ("test.com"): Gmail makes them links only when sending.
    for (const u of findBareDomains(text)) if (!seen.has(u) && !seen.has(u + '/')) seen.set(u, { url: u, text: '' });
    return { links: [...seen.values()].slice(0, 40), malformed: findMalformedUrls(text) };
}

function proceedSend(compose, btn) {
    sendApproved.add(compose);
    try {
        for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            const Ev = t.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
            btn.dispatchEvent(new Ev(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
        }
    } finally {
        setTimeout(() => sendApproved.delete(compose), 1500);
    }
}

// The dialog: "checking…", then the problems with Go back and fix / Send anyway.
function sendDialog() {
    const dark = isDarkSurface(document.body);
    const p = palette(document.body).card;
    const overlay = document.createElement('div');
    overlay.className = 'unshortener-send-dialog';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'unshortener-send-title');
    box.setAttribute('aria-describedby', 'unshortener-send-body');
    box.style.cssText = `background:${p.bg};color:${p.fg};border:1px solid ${p.border};border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.35);` +
        'max-width:640px;width:calc(100% - 48px);max-height:80vh;overflow:auto;padding:18px 20px;font:14px/1.5 Arial,sans-serif;';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const previous = document.activeElement;
    const api = { onEscape: null };
    const button = (label, primary, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText = `margin-left:8px;padding:8px 16px;border-radius:6px;font:inherit;font-weight:600;cursor:pointer;` +
            (primary ? `background:${p.link};color:${dark ? '#202124' : '#ffffff'};border:1px solid ${p.link};` : `background:transparent;color:${p.fg};border:1px solid ${p.border};`);
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
        return b;
    };
    const render = (title, bodyNode, buttons) => {
        box.textContent = '';
        const h = document.createElement('div');
        h.id = 'unshortener-send-title';
        h.style.cssText = 'font-size:16px;font-weight:bold;margin-bottom:8px;';
        h.textContent = title;
        bodyNode.id = 'unshortener-send-body';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:flex-end;margin-top:14px;';
        buttons.forEach(b => row.appendChild(b));
        box.append(h, bodyNode, row);
        (buttons.find(b => b.dataset.primary) || buttons[0]).focus();
    };
    overlay.addEventListener('keydown', (e) => {
        e.stopPropagation();                                   // keep Gmail's shortcuts out of the dialog
        if (e.key === 'Escape' && api.onEscape) { e.preventDefault(); api.onEscape(); }
        if (e.key === 'Tab') {                                 // keep focus inside the dialog
            const f = [...box.querySelectorAll('button')];
            if (!f.length) return;
            const i = f.indexOf(document.activeElement);
            if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
            else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        }
    });
    api.close = () => { overlay.remove(); if (previous && previous.focus) previous.focus(); };
    api.checking = (n, onCancel) => {
        const t = document.createElement('div');
        t.textContent = `Checking ${n} link${n === 1 ? '' : 's'} in this email before sending: spelling, whether ${n === 1 ? 'it exists, works and is' : 'they exist, work and are'} safe…`;
        api.onEscape = onCancel;
        render('Checking links before sending', t, [button('Cancel sending', false, onCancel)]);
    };
    api.problems = (bad, onSend, onBack) => {
        const dangerous = bad.some(r => r.problems.some(x => /dangerous|imitates|look-alike/.test(x)));
        const wrap = document.createElement('div');
        const intro = document.createElement('div');
        intro.textContent = dangerous ? 'This email links to a site that may be dangerous for the people you\'re sending it to:'
            : `${bad.length === 1 ? 'This link' : `These ${bad.length} links`} may not work for the people you're sending the email to:`;
        const ul = document.createElement('ul');
        ul.style.cssText = 'margin:8px 0 0;padding-left:20px;';
        for (const r of bad.slice(0, 20)) {
            const li = document.createElement('li');
            li.style.cssText = 'margin:6px 0;';
            const u = document.createElement('div');
            u.style.cssText = 'font-weight:bold;word-break:break-all;';
            u.textContent = r.url.length > 120 ? r.url.slice(0, 120) + '…' : r.url;
            const why = document.createElement('div');
            why.style.cssText = `color:${p.muted};`;
            why.textContent = r.problems.map(x => x.charAt(0).toUpperCase() + x.slice(1)).join('. ') + '.';
            li.append(u, why);
            ul.appendChild(li);
        }
        wrap.append(intro, ul);
        const back = button('Go back and fix', true, onBack);
        back.dataset.primary = '1';
        api.onEscape = onBack;
        render(dangerous ? 'Dangerous link in this email' : 'Check the links before sending', wrap, [button('Send anyway', false, onSend), back]);
    };
    return api;
}

async function startSendCheck(compose, btn) {
    if (sendCheckRunning) return;
    // Settings may not have been loaded yet on this page: read them now, so "off" is always honored.
    const cfg = await new Promise(resolve => safeSend({ action: 'getSettings' }, resolve));
    if (cfg && cfg.values) lastSettings = Object.assign({}, lastSettings, cfg.values);
    if (!sendCheckActive()) { proceedSend(compose, btn); return; }
    const body = compose.querySelector(COMPOSE_BODY_SELECTOR);
    if (!body) { proceedSend(compose, btn); return; }
    const { links, malformed } = collectOutgoingLinks(body);
    if (!links.length && !malformed.length) { proceedSend(compose, btn); return; }
    sendCheckRunning = true;
    let cancelled = false;
    const dlg = sendDialog();
    dlg.checking(links.length + malformed.length, () => { cancelled = true; sendCheckRunning = false; dlg.close(); reportEvent('info', 'Sending was cancelled while links were being checked.'); });
    const results = links.length ? await new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), 20000);
        safeSend({ action: 'checkOutgoingLinks', links }, (r) => { clearTimeout(timer); resolve(r); });
    }) : [];
    if (cancelled) return;
    sendCheckRunning = false;
    if (results === null) reportEvent('warning', 'Before sending: the link check didn\'t finish in time, so the email was sent without it.');
    const bad = (results || []).filter(r => r && r.problems && r.problems.length)
        .concat(malformed.map(m => ({ url: m, problems: ['is mistyped: a web address should begin with “http://” or “https://”'] })));
    if (!bad.length) { dlg.close(); proceedSend(compose, btn); return; }
    dlg.problems(bad,
        () => { dlg.close(); reportEvent('info', `Sent anyway, with ${bad.length} link problem${bad.length === 1 ? '' : 's'}.`); proceedSend(compose, btn); },
        () => { dlg.close(); body.focus(); });
}

function onSendAttempt(e) {
    if (!sendCheckActive()) return;
    let btn = null, compose = null;
    if (e.type === 'keydown') {
        if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
        compose = composeOf(e.target);
        if (!compose) return;
        btn = [...compose.querySelectorAll('[role="button"]')].find(b => gmailSendButtonFrom(b));
        if (!btn) return;
    } else {
        btn = gmailSendButtonFrom(e.target);
        if (!btn) return;
        compose = composeOf(btn);
        if (!compose) return;
    }
    if (sendApproved.has(compose)) return;                       // approved: let this send through
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click' || e.type === 'keydown') {
        // Never trap an email: if the check itself fails, close the dialog and send as normal.
        startSendCheck(compose, btn).catch(err => {
            sendCheckRunning = false;
            document.querySelectorAll('.unshortener-send-dialog').forEach(d => d.remove());
            reportEvent('error', `Checking links before sending failed (${err && err.message ? err.message : err}); the email was sent without the check.`);
            proceedSend(compose, btn);
        });
    }
}
if (SITE.id === 'gmail') {
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'keydown']) document.addEventListener(t, onSendAttempt, true);
}

// Checks each message's sender once: names claiming a brand, look-alike domains, and (with Gmail's
// verdict, fetched only when the name claims a brand or a company-only link is present) brand
// domains failing verification and scam text inside genuine company notifications.
function scanSenders() {
    if (!senderChecksActive()) return;
    for (const body of inBodies('')) {
        if (body.dataset.senderChecked || !isShown(body)) continue;
        const sender = gmailSenderOf(body);
        if (!sender || !sender.address) continue;
        body.dataset.senderChecked = '1';
        const needsVerdict = !!displayNameBrand(sender.name) || [...body.querySelectorAll('a[href]')].some(a => companyOnlyShortener(a.href));
        const finish = (auth) => guarded('Checking the sender', () => {
            if (!body.isConnected) return;
            const r = evaluateSender({ displayName: sender.name, address: sender.address, auth, bodyText: auth ? body.innerText.slice(0, 20000) : '' });
            showSenderFindings(body, r.findings);
            for (const line of r.info) reportEvent('info', line);
            for (const f of r.findings) reportEvent(f.severity === 'danger' ? 'warning' : 'info', `Sender check: ${f.message}`);
        });
        if (needsVerdict) getMessageAuth(body).then(finish); else finish(null);
    }
}

// ---------------------------------------------------------------------------
// SENDER IDENTITY AND AUTOMATIC SPAM (Gmail). Every sender in the inbox list and in opened emails gets
// its site icon, the country flag and a domain label colored by its check (checkSender in
// background.js). An email whose sender is FLAGGED (never one that is unverified, unknown or clean) is
// moved to Spam with Gmail's own Report spam button, only from the inbox and only once: conversations
// the extension moved are remembered, so one the user takes back out of Spam stays where they put it.
// A short notice at the top of Gmail says how many were moved, with a link to the Spam folder.
// Nothing here runs on a training email from your phishing simulation (administrator policies).
// ---------------------------------------------------------------------------
const senderResults = new Map();           // raw address → Promise<result | null>, for this page
const SENDER_RESULTS_MAX = 1000;
const messageInfos = new Map();            // Gmail message id → Promise<{ fh, ip, an } | null>
const senderIcons = new Map();             // site → Promise<data: URL | ''>
const openedStates = new WeakMap();        // message body → what's known about its sender (opened emails)
const loggedVerdicts = new Set();          // emails whose own verdict was already logged on this page
const spamQueue = new Map();               // conversation → { kind: 'row' | 'thread', row, address, reason, msgId }
const spamAttempted = new Set();           // conversations tried on this page (moved or not): never tried twice
let spamMoveRunning = false;
let spamMoveTimer = null;
let spamMoveFailures = 0;
let splitViewLogged = false;
let multiListLogged = false;
let spamRetryDelay = 3000;
const SPAM_MOVE_MAX_FAILURES = 3;          // Gmail's page no longer looks as expected: stop until it's reloaded
let senderMessageCache = null;             // Promise<{ msg id → { fh, ip, an, t } }>, kept between visits
let senderMessageCacheTimer = null;
const SENDER_MESSAGE_CACHE_MAX = 5000;
const STATUS_TEXT = { flagged: 'Flagged sender', caution: 'Caution', clean: 'Checked', trusted: 'Trusted', unverified: 'Not verified', unknown: 'Unknown sender', pending: 'Checking…' };
const STATUS_MARK = { flagged: '⛔', caution: '⚠', clean: '✓', trusted: '✓' };
const STATUS_RANK = { flagged: 5, caution: 4, unknown: 3, unverified: 2, trusted: 1, clean: 1, pending: 0 };

function senderFeaturesOn(S) {
    return SITE.id === 'gmail' && !!(S.enableSenderIdentity || S.enableSenderDomainCheck || S.enableSenderAddressCheck);
}

function gmailIdFromHex(prefix, hex) {
    if (!hex || !/^[0-9a-f]{6,16}$/i.test(hex)) return null;
    try { return `${prefix}:${BigInt('0x' + hex).toString()}`; } catch (e) { return null; }
}
// "thread-f:<decimal>" from a list row's subject or an open conversation's title.
function gmailThreadKey(el) {
    if (!el) return null;
    const perm = (el.getAttribute('data-thread-perm-id') || el.getAttribute('data-thread-id') || '').replace(/^#/, '');
    if (/^thread-f:\d+$/.test(perm)) return perm;
    return gmailIdFromHex('thread-f', el.getAttribute('data-legacy-thread-id'));
}
function rowThreadElement(row) { return row.querySelector('[data-thread-id], [data-legacy-thread-id]'); }
function rowThreadKey(row) { return gmailThreadKey(rowThreadElement(row)); }
function currentThreadKey() {
    const h = [...document.querySelectorAll('h2[data-thread-perm-id], h2[data-legacy-thread-id]')].find(isShown);
    return h ? gmailThreadKey(h) : null;
}

// The signed-in account ("Subject - name@school.org - Gmail" in the title), and its organization's
// domain. The LAST address in the title is the account's: an email's subject comes first and can
// contain any address. A personal-mail domain (gmail.com…) is no organization: others share it.
function gmailAccountAddress() {
    const all = (document.title || '').match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g);
    return all ? all[all.length - 1].toLowerCase() : '';
}
function ownOrgDomain() {
    const d = domainOfAddress(gmailAccountAddress());
    return d && !isPersonalMailDomain(d) ? d : '';
}

// A sender as Gmail shows it: { raw, address, domain, name }. Broken addresses (encoded parts, more
// than 64 characters before the @…) are kept: they are themselves a sign of forgery.
function senderOf(el) {
    // As written: an encoded part ("=?UTF-8?B?…?=") is case-sensitive, so it's never lower-cased.
    const raw = String(el.getAttribute('email') || '').trim();
    const p = parseSenderAddress(raw);
    return p ? { raw, address: p.address, domain: p.domain, name: el.getAttribute('name') || el.textContent.trim() } : null;
}

// Senders shown in a list row (up to 3, without the signed-in user), in the order Gmail shows them.
function rowSenders(row) {
    const me = gmailAccountAddress();
    const out = new Map();
    let spans = row.querySelectorAll('.yW [email], .yX [email]');
    if (!spans.length) spans = row.querySelectorAll('[email]');
    for (const s of spans) {
        const who = senderOf(s);
        if (!who || who.address === me || out.has(who.raw)) continue;
        out.set(who.raw, who);
    }
    return [...out.values()].slice(-3);
}

// Check results, one request per scan for all senders not yet known on this page (the background
// remembers them too, across visits).
function senderResultsFor(raws) {
    const missing = raws.filter(a => !senderResults.has(a));
    if (missing.length) {
        const batch = new Promise(resolve => safeSend({ action: 'checkSenders', senders: missing.map(address => ({ address })), ownDomain: ownOrgDomain() },
            (r) => resolve(Array.isArray(r) ? r : [])));
        missing.forEach((a, i) => {
            if (senderResults.size >= SENDER_RESULTS_MAX) senderResults.delete(senderResults.keys().next().value);
            const p = batch.then(r => {
                const v = r[i] && r[i].status ? r[i] : null;
                if (!v && senderResults.get(a) === p) senderResults.delete(a);      // no answer: asked again next time
                // Couldn't be checked (network…): checked again after a while, not for the rest of the visit.
                if (v && v.status === 'unverified') setTimeout(() => { if (senderResults.get(a) === p) senderResults.delete(a); }, 10 * 60 * 1000);
                return v;
            });
            senderResults.set(a, p);
        });
    }
    return Promise.all(raws.map(a => senderResults.get(a)));
}

// FNV-1a of the lower-case address: enough to tell whether the headers belong to the sender shown.
function addressFingerprint(a) {
    let h = 0x811c9dc5;
    for (const c of String(a || '').trim().toLowerCase()) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
}
// At most two "Show original" reads at once, so a long inbox doesn't flood Gmail with requests.
let headerSlots = 2;
const headerWaiters = [];
async function withHeaderSlot(fn) {
    if (headerSlots <= 0) await new Promise(r => headerWaiters.push(r)); else headerSlots--;
    try { return await fn(); }
    finally { const next = headerWaiters.shift(); if (next) next(); else headerSlots++; }
}

function loadSenderMessageCache() {
    if (!senderMessageCache) {
        senderMessageCache = new Promise(resolve => {
            try { chrome.storage.local.get({ senderMessageCache: {} }, (r) => resolve(!chrome.runtime.lastError && r && r.senderMessageCache && typeof r.senderMessageCache === 'object' ? r.senderMessageCache : {})); }
            catch (e) { resolve({}); }
        });
    }
    return senderMessageCache;
}
function saveSenderMessageCache() {
    if (senderMessageCacheTimer) return;
    senderMessageCacheTimer = setTimeout(async () => {
        senderMessageCacheTimer = null;
        const cache = await loadSenderMessageCache();
        // Kept no longer than the auto-delete period (Settings → Logging), like the rest of the history.
        const cutoff = Date.now() - (Number(lastSettings.retentionDays) || 30) * 864e5;
        for (const k of Object.keys(cache)) if (!cache[k] || !(cache[k].t >= cutoff) || cache[k].from || !Array.isArray(cache[k].an)) delete cache[k];
        const keys = Object.keys(cache);
        if (keys.length > SENDER_MESSAGE_CACHE_MAX) keys.sort((a, b) => cache[a].t - cache[b].t).slice(0, keys.length - SENDER_MESSAGE_CACHE_MAX).forEach(k => delete cache[k]);
        try { chrome.storage.local.set({ senderMessageCache: cache }, () => void chrome.runtime.lastError); } catch (e) { /* extension reloaded */ }
    }, 2000);
}

// What an email's own headers say ({ fh, ip, an }): the delivering server's address, a fingerprint of
// the From address (never the address itself) and the signs of forgery found (headerAnomalies). Read
// once per email from Gmail itself, and remembered. Read emails only, so checking can't change
// what Gmail shows as unread.
function messageInfo(msgId) {
    if (!msgId) return Promise.resolve(null);
    if (!messageInfos.has(msgId)) {
        if (messageInfos.size >= SENDER_RESULTS_MAX) messageInfos.delete(messageInfos.keys().next().value);
        messageInfos.set(msgId, (async () => {
            const cache = await loadSenderMessageCache();
            if (cache[msgId] && Array.isArray(cache[msgId].an)) return cache[msgId];
            const h = await withHeaderSlot(() => getMessageHeadersById(msgId));
            if (!h) return null;
            const headers = parseRawHeaders(h.raw);
            const from = ((headers.find(([n]) => n === 'from') || [])[1] || '');
            const fm = /<([^>]*)>\s*$/.exec(from);
            const parsed = parseSenderAddress(fm ? fm[1] : ((from.match(EMAIL_IN_TEXT_RE) || [])[0] || from));
            const an = headerAnomalies(h.raw, gmailAccountAddress());
            const info = { fh: parsed ? addressFingerprint(parsed.address) : '', ip: gmailDeliveringIp(headers) || '', an, t: Date.now() };
            cache[msgId] = info;
            saveSenderMessageCache();
            return info;
        })().catch(() => null));
    }
    return messageInfos.get(msgId);
}
function serverCountry(info) {
    if (!info || !info.ip) return Promise.resolve(null);
    return new Promise(resolve => safeSend({ action: 'senderCountry', ip: info.ip }, (c) => resolve(isCountryCode(c) ? c : null)));
}

// --- Drawing ---------------------------------------------------------------------------------------
// The site icon from the background (fetched once from Google's icon service and remembered; only the
// site name is sent). A site without an icon, and "Offline only", get a blank space of the same size.
function senderIconEl(domain, S) {
    const wrap = document.createElement('span');
    wrap.className = 'unshortener-sender-icon';
    const slot = document.createElement('span');
    slot.className = 'unshortener-sender-blank';
    slot.setAttribute('aria-hidden', 'true');
    wrap.appendChild(slot);
    const site = siteOfSender(domain);
    if (S.enableDnsThreatCheck && SENDER_DOMAIN_RE.test(site)) {
        if (!senderIcons.has(site)) senderIcons.set(site, new Promise(resolve => safeSend({ action: 'senderIcon', site }, (d) => resolve(typeof d === 'string' && d.startsWith('data:image/') ? d : ''))));
        senderIcons.get(site).then(d => {
            if (!d || !slot.isConnected) return;
            const img = document.createElement('img');
            img.alt = '';
            img.width = 16; img.height = 16;
            img.addEventListener('error', () => img.replaceWith(slot), { once: true });
            img.src = d;
            slot.replaceWith(img);
        });
    }
    return wrap;
}

function setSenderFlag(icon, country, source) {
    let flag = icon.querySelector('.unshortener-sender-flag');
    if (!country) { if (flag) flag.remove(); return; }
    if (!flag) { flag = document.createElement('span'); flag.className = 'unshortener-sender-flag'; icon.appendChild(flag); }
    const where = source === 'server' ? 'Sent from a server in' : source === 'host' ? 'Sender\'s website is hosted in' : 'Sender\'s domain is registered under';
    flag.textContent = countryFlag(country);
    flag.title = `${where} ${countryName(country)}`;
    flag.setAttribute('role', 'img');
    flag.setAttribute('aria-label', flag.title);
}

function senderChipEl(domain, dark, address) {
    const chip = document.createElement('span');
    chip.className = 'unshortener-sender-chip' + (dark ? ' unshortener-dark' : '');
    const mark = document.createElement('span');
    mark.className = 'unshortener-sender-mark';
    mark.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'unshortener-sender-domain';
    name.textContent = siteOfSender(domain);
    chip.append(mark, name);
    setChipResult(chip, null, address);
    return chip;
}

function setChipResult(chip, r, address, extra) {
    const status = r ? r.status : 'pending';
    chip.dataset.status = status;
    chip.querySelector('.unshortener-sender-mark').textContent = STATUS_MARK[status] || '';
    const lines = [`${STATUS_TEXT[status] || status}: ${address}`];
    if (r) lines.push(...r.reasons);
    if (extra) lines.push(...extra);
    chip.title = lines.join('\n');
    chip.setAttribute('aria-label', lines.join('. '));
}

function removeSenderDecorations(root = document) {
    root.querySelectorAll('.unshortener-sender-icon, .unshortener-sender-chip').forEach(e => e.remove());
    root.querySelectorAll('[data-unshortener-sender]').forEach(e => { delete e.dataset.unshortenerSender; });
}

// Logs once per email when what's in the email itself (headers, links, attachments, name) changes the
// sender's verdict, so the log says why an email was flagged although its sender looked fine.
function logEmailVerdict(id, address, base, final) {
    if (!final || final.status === base.status || loggedVerdicts.has(`${id}|${final.status}`)) return;
    loggedVerdicts.add(`${id}|${final.status}`);
    reportEvent(final.status === 'flagged' ? 'warning' : 'info', `Email from ${address}: ${STATUS_TEXT[final.status] || final.status} (the sender alone was ${STATUS_TEXT[base.status] || base.status}). Why: ${final.reasons.join(' ')}`);
}

// --- Inbox list ------------------------------------------------------------------------------------
function scanSenderRows(S) {
    const rows = [...document.querySelectorAll('tr.zA')].filter(isShown);
    if (!rows.length) return;
    const dark = isDarkSurface(rows[0]);
    for (const row of rows) {
        const senders = rowSenders(row);
        if (!senders.length) continue;
        const threadEl = rowThreadElement(row);
        const thread = gmailThreadKey(threadEl);
        const msgId = threadEl ? gmailIdFromHex('msg-f', threadEl.getAttribute('data-legacy-last-message-id')) : null;
        const unread = row.classList.contains('zE');
        const key = [thread, msgId, unread ? 'u' : 'r', ...senders.map(s => s.raw), S.enableSenderIdentity ? 'id' : '', S.enableSenderCountry ? 'cc' : ''].join('|');
        // Unchanged since the last scan (and Gmail hasn't redrawn the row without our label).
        if (row.dataset.unshortenerSender === key && (!S.enableSenderIdentity || row.querySelector('.unshortener-sender-chip'))) continue;
        removeSenderDecorations(row);
        row.dataset.unshortenerSender = key;
        // The sender shown first is the one decorated; a flagged one anywhere in the row wins.
        let icon = null, chip = null;
        if (S.enableSenderIdentity) {
            icon = senderIconEl(senders[0].domain, S);
            chip = senderChipEl(senders[0].domain, dark, senders[0].address);
            const nameCell = row.querySelector('.yW') || row.querySelector('.yX');
            const subject = row.querySelector('.xT') || row.querySelector('.y6');
            if (nameCell) nameCell.insertBefore(icon, nameCell.firstChild);
            if (subject) subject.insertBefore(chip, subject.firstChild);
            else if (nameCell) nameCell.insertBefore(chip, icon.nextSibling);
        }
        // A read email's own headers are read (once) for the server's country and signs of forgery.
        const infoP = msgId && !unread ? messageInfo(msgId) : Promise.resolve(null);
        const show = (results, info) => guarded('Showing who sent an email', () => {
            if (!row.isConnected || row.dataset.unshortenerSender !== key) return;
            // Signs in this email: the names shown, and the headers when they belong to the last sender.
            const finals = results.map((r, k) => {
                const signals = displayNameAnomalies(senders[k].name);
                if (info && info.fh === addressFingerprint(senders[k].address)) signals.push(...info.an);
                const f = applyEmailSignals(r, signals);
                if (r && f) logEmailVerdict(`${thread}|${senders[k].address}`, senders[k].address, r, f);
                return f;
            });
            let i = 0;
            finals.forEach((r, k) => { if (r && (STATUS_RANK[r.status] || 0) > (STATUS_RANK[finals[i] ? finals[i].status : 'pending'] || 0)) i = k; });
            const r = finals[i], who = senders[i];
            if (chip) {
                chip.querySelector('.unshortener-sender-domain').textContent = siteOfSender(who.domain);
                setChipResult(chip, r, who.address);
            }
            if (icon && S.enableSenderCountry && r) {
                const own = info && info.fh === addressFingerprint(senders[0].address) ? info : null;
                setSenderFlag(icon, results[0] && results[0].country, results[0] && results[0].countrySource);
                if (own && S.enableDnsThreatCheck) serverCountry(own).then(c => { if (c && row.dataset.unshortenerSender === key) setSenderFlag(icon, c, 'server'); });
            }
            // Moved only when every sender shown is flagged: one flagged reply in a genuine conversation
            // must not send everyone's messages to Spam.
            if (finals.length && finals.every(x => x && x.move) && thread && S.enableAutoSpam) {
                queueSpamMove(thread, { kind: 'row', row, address: senders[0].address, reason: finals[0].reasons.join(' '), msgId, unread, how: 'automatically, from the inbox list' });
            }
        });
        senderResultsFor(senders.map(s => s.raw)).then(results => {
            show(results, null);
            infoP.then(info => { if (info) show(results, info); });
        });
    }
}

// --- Opened emails ---------------------------------------------------------------------------------
// The signs found in an opened email itself: dangerous links (as marked in the email), dangerous or
// unnamed attachments. Recomputed whenever the email's banner is refreshed (links finish checking).
function emailContentSignals(body) {
    const out = [];
    let total = 0, danger = 0;
    const reasons = new Set();
    for (const [el, d] of processedLinksMap) {
        if (!el.isConnected || containerOf(el) !== body) continue;
        total++;
        if (!d.isSafe && d.severity === 'danger' && !d.companyFinding) { danger++; if (d.reason) reasons.add(String(d.reason).replace(/\.$/, '')); }
    }
    if (danger) {
        const why = [...reasons].slice(0, 2).join('; ');
        out.push({ weight: danger >= 2 || danger === total ? 5 : 3,
            text: `${danger === total ? (danger === 1 ? 'Its only link is' : `All ${danger} of its links are`) : `${danger} of its ${total} links ${danger === 1 ? 'is' : 'are'}`} flagged as dangerous${why ? ` (${why})` : ''}.` });
    }
    const msg = body.closest('.adn, [data-message-id], .gs') || body.parentElement;
    if (msg) {
        if (msg.querySelector('.unshortener-qr-bar[data-severity="danger"]')) out.push({ weight: 5, text: 'It has an attachment flagged as dangerous.' });
        const noname = findAttachments().filter(a => msg.contains(a.el) && /^noname(\.[a-z0-9]{1,5})?$/i.test(String(a.name || '').trim()));
        if (noname.length) out.push({ weight: 2, text: 'It has an attachment without a name (“noname”), which genuine mail programs rarely send.' });
    }
    return out;
}

// The opened email's own verdict from its sender, its headers, its name and its content; drawn on its
// label and in its banner, and queued for Spam when flagged.
function updateOpenedVerdict(body) {
    const st = openedStates.get(body);
    if (!st || !st.base || !st.nameEl.isConnected) return;
    const signals = [...displayNameAnomalies(st.name), ...(st.info && st.info.fh === addressFingerprint(st.address) ? st.info.an : []), ...emailContentSignals(body)];
    const final = applyEmailSignals(st.base, signals);
    st.final = final;
    logEmailVerdict(st.msgId || st.address, st.address, st.base, final);
    if (st.chip) {
        setChipResult(st.chip, final, st.address, st.authLine);
        st.chip.querySelector('.unshortener-sender-domain').textContent = `${siteOfSender(st.domain)} · ${STATUS_TEXT[final.status] || final.status}`;
    }
    const banner = bannerState(body);
    const line = final.status === 'flagged' ? { severity: 'danger', message: `This email is flagged. ${final.reasons.join(' ')} Don't open its links or attachments or reply with personal details.` }
        : final.status === 'caution' ? { severity: 'caution', message: `Be careful with this email. ${final.reasons.join(' ')}` } : null;
    const old = banner.sender.get('sender-identity');
    if ((old && old.message) !== (line && line.message)) {
        if (line) banner.sender.set('sender-identity', line); else banner.sender.delete('sender-identity');
        scheduleBannerRefresh(body);
    }
    if (final.move && st.thread && lastSettings.enableAutoSpam) queueSpamMove(st.thread, { kind: 'thread', address: st.address, reason: final.reasons.join(' '), msgId: st.msgId, how: 'automatically, when the email was opened' });
}

function scanOpenedSenders(S) {
    for (const body of inBodies('')) {               // training emails are never in this list (phishSimGate)
        if (!isShown(body)) continue;
        const msg = body.closest('.adn, [data-message-id], .gs') || body.parentElement;
        const nameEl = msg && msg.querySelector('.gD[email]');
        if (!nameEl) continue;
        const who = senderOf(nameEl);
        if (!who || who.address === gmailAccountAddress()) continue;
        const key = `${who.raw}|${S.enableSenderIdentity ? 'id' : ''}|${S.enableSenderCountry ? 'cc' : ''}`;
        const holder = nameEl.parentElement;
        if (nameEl.dataset.unshortenerSender === key && (!S.enableSenderIdentity || !holder || holder.querySelector('.unshortener-sender-chip'))) continue;
        if (holder) holder.querySelectorAll('.unshortener-sender-icon, .unshortener-sender-chip').forEach(e => e.remove());
        nameEl.dataset.unshortenerSender = key;
        let icon = null, chip = null;
        if (S.enableSenderIdentity && holder) {
            icon = senderIconEl(who.domain, S);
            chip = senderChipEl(who.domain, isDarkSurface(nameEl), who.address);
            chip.style.marginLeft = '6px';
            nameEl.insertAdjacentElement('beforebegin', icon);
            const after = holder.querySelector('.go') || nameEl;
            after.insertAdjacentElement('afterend', chip);
        }
        const msgId = gmailMessageId(body);
        const st = { nameEl, chip, icon, address: who.address, domain: who.domain, name: who.name, msgId, thread: currentThreadKey(), base: null, info: null, authLine: [] };
        openedStates.set(body, st);
        Promise.all([senderResultsFor([who.raw]), messageInfo(msgId), getMessageAuth(body)]).then(([[r], info, auth]) => guarded('Showing who sent an email', () => {
            if (!nameEl.isConnected || nameEl.dataset.unshortenerSender !== key || !r || openedStates.get(body) !== st) return;
            st.base = r;
            st.info = info;
            st.authLine = auth ? [`Gmail's sender verification: DMARC ${auth.dmarc}, SPF ${auth.spf}, DKIM ${auth.dkim}.`] : [];
            if (icon && S.enableSenderCountry) {
                setSenderFlag(icon, r.country, r.countrySource);
                if (S.enableDnsThreatCheck && info && info.fh === addressFingerprint(who.address)) serverCountry(info).then(c => { if (c && nameEl.dataset.unshortenerSender === key) setSenderFlag(icon, c, 'server'); });
            }
            updateOpenedVerdict(body);
        }));
    }
}

// --- Moving to Spam --------------------------------------------------------------------------------
function queueSpamMove(thread, item) {
    if (spamAttempted.has(thread) || spamQueue.has(thread)) return;
    spamQueue.set(thread, item);
    scheduleSpamMoves();
}
function scheduleSpamMoves(delay = 800) {
    clearTimeout(spamMoveTimer);
    spamMoveTimer = setTimeout(() => runSpamMoves().catch(e => {
        spamMoveRunning = false;
        reportEvent('error', `Moving emails to Spam failed: ${e && e.message ? e.message : e}`);
    }), delay);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(test, ms) {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (test()) return true;
    return test();
}
function gmailPress(el) {
    for (const t of ['mouseover', 'mousedown', 'mouseup', 'click']) {
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
    }
}

// The user is typing, has a menu or dialog open, or has selected emails: never act then (selected
// emails would be reported together with ours). Checked again right before every click.
function shownAll(selector) { return [...document.querySelectorAll(selector)].filter(isShown); }
// Selected rows anywhere in the page, shown or not (a collapsed inbox section can hold a selection the
// toolbar would act on too).
function selectedRows() {
    return [...document.querySelectorAll('tr.zA')].filter(r => r.classList.contains('x7') || (r.querySelector('[role="checkbox"]') || { getAttribute: () => null }).getAttribute('aria-checked') === 'true');
}
function userBusy() {
    const a = document.activeElement;
    if (a && a !== document.body && (isEditable(a) || /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName))) return true;
    return shownAll('[role="dialog"], [role="alertdialog"], [role="menu"], .unshortener-send-dialog').length > 0;
}

// Gmail's own Report spam button, by its label (several languages), or by Gmail's action number when
// its label still says spam in another language. Never any other button.
const REPORT_SPAM_LABEL = /^(report spam|spam melden|signaler comme spam|marcar como spam|denunciar spam|segnala come spam|als spam markeren|rapportér spam|rapporter som spam|rapportera som skräppost|zgłoś spam|nahlásit spam|ilmoita roskapostiksi)/i;
const SPAM_WORD = /spam|skräp|迷惑|垃圾|스팸|спам/i;
const UNSUBSCRIBE_LABEL = /unsubscribe|abmelden|abbestellen|désabonner|desuscribir|cancelar (la )?suscripción|annulla iscrizione|uitschrijven|afmeld|avsluta|wypisz/i;
function gmailReportSpamButton() {
    for (const b of document.querySelectorAll('[gh="mtb"] [role="button"], [gh="tm"] [role="button"], [act="9"][role="button"]')) {
        if (!isShown(b) || b.getAttribute('aria-disabled') === 'true' || b.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) continue;
        const label = (b.getAttribute('aria-label') || b.getAttribute('data-tooltip') || '').trim();
        if (REPORT_SPAM_LABEL.test(label) || (b.getAttribute('act') === '9' && SPAM_WORD.test(label))) return b;
    }
    return null;
}

// Gmail sometimes asks "Report spam and unsubscribe?". Only plain Report spam is ever chosen
// (unsubscribing from a phisher confirms your address); anything unclear is cancelled.
function newDialogs(before) { return shownAll('[role="alertdialog"], [role="dialog"]').filter(d => !before.has(d)); }
function cancelNewDialogs(before) {
    for (const d of newDialogs(before)) d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
}
async function confirmSpamDialog(before) {
    let dialog = null;
    await waitFor(() => (dialog = newDialogs(before)[0]), 1500);
    if (!dialog) return true;
    const buttons = [...dialog.querySelectorAll('button, [role="button"]')].filter(isShown);
    const plain = buttons.find(b => REPORT_SPAM_LABEL.test((b.textContent || b.getAttribute('aria-label') || '').trim()) && !UNSUBSCRIBE_LABEL.test(b.textContent || ''));
    if (plain) { gmailPress(plain); return true; }
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    return false;
}

// Still allowed to act, right now: the setting, the view and the user (checked before every click).
function mayActNow() {
    return !!lastSettings.enableAutoSpam && !document.hidden && gmailViewAllowsAutoSpam(location.hash) && !userBusy();
}
// Each row still shows the conversation it was checked for (Gmail can redraw a row for another one).
function rowsStillMatch(items) {
    return items.every(it => it.row.isConnected && isShown(it.row) && rowThreadKey(it.row) === it.thread);
}

async function reportSpamRows(items) {
    if (selectedRows().length || !mayActNow() || !rowsStillMatch(items)) return null;   // try again later
    const boxes = items.map(it => it.row.querySelector('[role="checkbox"]'));
    if (boxes.some(b => !b)) return [];
    const unselect = () => items.forEach((it, i) => { if (it.row.isConnected && boxes[i].getAttribute('aria-checked') === 'true') gmailPress(boxes[i]); });
    boxes.forEach(gmailPress);
    await sleep(200);
    const sel = selectedRows();
    if (sel.length !== items.length || items.some(it => !sel.includes(it.row)) || !rowsStillMatch(items)) { unselect(); return []; }
    const btn = gmailReportSpamButton();
    if (!btn || !mayActNow()) { unselect(); return btn ? null : []; }
    const before = new Set(shownAll('[role="alertdialog"], [role="dialog"]'));
    gmailPress(btn);
    if (!await confirmSpamDialog(before)) { await sleep(200); cancelNewDialogs(before); unselect(); return []; }
    const gone = (it) => !it.row.isConnected || !isShown(it.row) || rowThreadKey(it.row) !== it.thread;
    if (!await waitFor(() => items.every(gone), 5000)) { cancelNewDialogs(before); unselect(); return items.filter(gone); }
    return items;
}

async function reportSpamOpenThread(item) {
    // The toolbar would act on a selection; and the conversation on screen must still be this one.
    if (selectedRows().length || !mayActNow() || currentThreadKey() !== item.thread) return null;
    const btn = gmailReportSpamButton();
    if (!btn) return [];
    const before = new Set(shownAll('[role="alertdialog"], [role="dialog"]'));
    gmailPress(btn);
    if (!await confirmSpamDialog(before)) { await sleep(200); cancelNewDialogs(before); return []; }
    if (await waitFor(() => currentThreadKey() !== item.thread, 5000)) return [item];
    cancelNewDialogs(before);
    return [];
}

// A training email from your phishing simulation must never be moved. Returns false (not one), 'yes',
// or 'unverifiable'. Simulation link domains need the email's links, which only an opened email shows
// (an opened one reaches this only after its links were checked), so a list row is unverifiable while
// they're set. With header rules, the headers are read; an unread email's never are.
async function phishSimulationState(item) {
    const rules = (lastPolicy && lastPolicy.phishSimRules) || [], domains = (lastPolicy && lastPolicy.phishSimDomains) || [];
    const d = domainOfAddress(item.address);
    if (domains.some(x => d === x || d.endsWith('.' + x))) return 'yes';
    if (domains.length && item.kind === 'row') return 'unverifiable';
    if (!rules.length) return false;
    if (!item.msgId || item.unread) return 'unverifiable';
    const h = await getMessageHeadersById(item.msgId);
    if (!h) return 'unverifiable';
    return matchPhishSimulation(h.raw, rules) ? 'yes' : false;
}

// Every other message open in the conversation is flagged too (a flagged reply in a genuine
// conversation must not send the colleagues' messages to Spam).
async function conversationAllFlagged() {
    const states = inBodies('').filter(isShown).map(b => openedStates.get(b)).filter(Boolean);
    return states.length > 0 && states.every(st => st.final && st.final.move);
}

// Remembered before Gmail is asked, so a conversation is never tried twice, even if the page is
// reloaded or the background restarts in between. Resolves to false if it couldn't be saved.
function rememberSpamThreads(items, log) {
    return new Promise(resolve => safeSend({ action: 'recordSpamMoves', log,
        moves: items.map(it => ({ thread: it.thread, address: it.address || '', reason: it.reason || '', how: it.how || '' })) }, r => resolve(r === true)));
}

// The user takes conversations out of Spam (Not spam, Move to Inbox): remembered, so that whatever
// put them there (Gmail or the extension), the extension never moves them back.
const NOT_SPAM_LABEL = /^(not spam|move to inbox|kein spam|in den posteingang|pas un spam|non spam|déplacer vers la boîte de réception|no es spam|mover a recibidos|non è spam|sposta in posta in arrivo|geen spam|verplaatsen naar inbox|nie jest spamem|não é spam|mover para a caixa de entrada|inte skräppost)/i;
function inSpamView() { return /^#(spam(\/|$)|search\/.*in(:|%3A)spam)/i.test(location.hash); }
function onRescueClick(e) {
    if (!inSpamView()) return;
    const b = e.target && e.target.closest ? e.target.closest('[role="button"]') : null;
    if (!b || !NOT_SPAM_LABEL.test((b.getAttribute('aria-label') || b.getAttribute('data-tooltip') || b.textContent || '').trim())) return;
    const threads = new Set(selectedRows().map(rowThreadKey).filter(Boolean));
    const open = currentThreadKey();
    if (open) threads.add(open);
    if (threads.size) rememberSpamThreads([...threads].map(thread => ({ thread, reason: 'taken out of Spam by you' })), 'rescued');
}
if (SITE.id === 'gmail') document.addEventListener('mousedown', onRescueClick, true);

function movedThreads() {
    return new Promise(resolve => {
        try { chrome.storage.local.get({ spamMovedThreads: {} }, (r) => resolve(!chrome.runtime.lastError && r && r.spamMovedThreads ? r.spamMovedThreads : null)); }
        catch (e) { resolve(null); }
    });
}

async function runSpamMoves() {
    if (spamMoveRunning || !spamQueue.size) return;
    if (!lastSettings.enableAutoSpam || spamMoveFailures >= SPAM_MOVE_MAX_FAILURES) { spamQueue.clear(); return; }
    // Hidden tab or not the inbox: wait (the queue is looked at again on the next scan).
    if (document.hidden || !gmailViewAllowsAutoSpam(location.hash) || userBusy()) return;
    spamMoveRunning = true;
    try {
        const memory = await movedThreads();
        if (!memory) return;                                  // can't tell what was moved before: do nothing
        // Several lists on the inbox page (Multiple Inboxes, Priority Inbox sections): some can show
        // conversations that aren't in the inbox, so nothing is moved from the list there.
        if (!currentThreadKey() && new Set(shownAll('tr.zA').map(r => r.closest('table'))).size > 1) {
            if (!multiListLogged) { multiListLogged = true; reportEvent('info', 'Emails from flagged senders are not moved to Spam from an inbox with several sections (Multiple Inboxes or Priority Inbox); they are still marked, and are moved when opened.'); }
            return;
        }
        // Split view (a conversation open beside the list): which one the toolbar acts on isn't certain,
        // so nothing is moved there.
        if (currentThreadKey() && shownAll('tr.zA').length) {
            if (!splitViewLogged) { splitViewLogged = true; reportEvent('info', 'Emails from flagged senders are not moved to Spam while Gmail shows a conversation beside the list (split view); they are still marked.'); }
            return;
        }
        const rows = [];
        let open = null;
        const current = currentThreadKey();
        for (const [thread, it] of [...spamQueue]) {
            const drop = () => { spamQueue.delete(thread); spamAttempted.add(thread); };
            if (memory[thread]) { drop(); continue; }        // moved before: the user took it back out of Spam
            it.thread = thread;
            if (it.kind === 'thread') {
                if (current !== thread) { spamQueue.delete(thread); continue; }
            } else if (current || !it.row.isConnected || !isShown(it.row) || rowThreadKey(it.row) !== thread) { spamQueue.delete(thread); continue; }
            const sim = await phishSimulationState(it);
            if (sim) {
                drop();
                reportEvent('info', sim === 'yes' ? `An email from ${it.address} matches your organization's phishing simulation, so it was not moved to Spam.`
                    : `An email from ${it.address} wasn't moved to Spam from the list: with phishing-simulation rules set, it's moved only once it's opened and shown not to be a training email.`);
                continue;
            }
            if (it.kind === 'thread' && !await conversationAllFlagged()) { drop(); continue; }
            if (it.kind === 'thread') open = it; else rows.push(it);
        }
        // The settings (a policy may have changed) and the page are looked at again right before
        // acting: the checks above can take a moment (headers).
        const cfg = await new Promise(resolve => safeSend({ action: 'getSettings' }, resolve));
        if (!cfg || !cfg.values) return;
        lastSettings = cfg.values;
        lastPolicy = cfg.policy || {};
        if (!mayActNow() || currentThreadKey() !== current) return;
        const batch = open ? [open] : rows.filter(it => rowsStillMatch([it])).slice(0, 20);
        if (!batch.length) return;
        // Everything that would make Gmail act on something else is checked before remembering, so a
        // move put off for the user isn't recorded as done.
        if (selectedRows().length || (open ? currentThreadKey() !== open.thread : !rowsStillMatch(batch))) return;
        if (!await rememberSpamThreads(batch, false)) return;  // not remembered: don't move
        const moved = open ? await reportSpamOpenThread(open) : await reportSpamRows(batch);
        if (moved === null) return;                          // the user is busy or has emails selected: later
        for (const it of batch) { spamQueue.delete(it.thread); spamAttempted.add(it.thread); }
        if (moved.length) {
            spamMoveFailures = 0;
            spamRetryDelay = 3000;
            rememberSpamThreads(moved, 'moved');
            if (lastSettings.enableSpamNotice) showSpamNotice(moved.length);
        }
        const notMoved = batch.filter(it => !moved.includes(it));
        if (notMoved.length) rememberSpamThreads(notMoved.map(it => Object.assign({}, it, { how: 'Gmail did not confirm the move (its Report spam button or dialog was not as expected)' })), 'failed');
        if (moved.length < batch.length && ++spamMoveFailures >= SPAM_MOVE_MAX_FAILURES) {
            reportEvent('warning', 'Emails from flagged senders could not be moved to Spam: Gmail\'s Report spam button wasn\'t found or didn\'t work. They are still marked; reload Gmail to try again.');
        }
    } finally {
        spamMoveRunning = false;
        if (spamQueue.size) {                                 // waiting for the user: look again in a while
            scheduleSpamMoves(spamRetryDelay);
            spamRetryDelay = Math.min(spamRetryDelay * 2, 60000);
        }
    }
}

// A notice at the top of Gmail: how many emails were moved, with a link to the Spam folder. It goes
// away after 15 seconds (not while pointed at or focused), or with ×.
let spamNotice = null;
function showSpamNotice(n) {
    if (!spamNotice || !spamNotice.el.isConnected) {
        const el = document.createElement('div');
        el.className = 'unshortener-spam-notice' + (isDarkSurface(document.body) ? ' unshortener-dark' : '');
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        const text = document.createElement('span');
        const review = document.createElement('a');
        review.href = '#spam';
        review.textContent = 'Review';
        review.addEventListener('click', () => close());
        const x = document.createElement('button');
        x.type = 'button';
        x.textContent = '×';
        x.setAttribute('aria-label', 'Dismiss');
        x.addEventListener('click', () => close());
        el.append(text, review, x);
        document.body.appendChild(el);
        const state = { el, text, count: 0, timer: null };
        let paused = false;
        const close = () => { clearTimeout(state.timer); el.remove(); if (spamNotice === state) spamNotice = null; };
        state.arm = () => { clearTimeout(state.timer); if (el.isConnected) state.timer = setTimeout(() => { if (!paused) close(); }, 15000); };
        el.addEventListener('mouseenter', () => { paused = true; });
        el.addEventListener('mouseleave', () => { paused = false; state.arm(); });
        el.addEventListener('focusin', () => { paused = true; });
        el.addEventListener('focusout', () => { paused = false; state.arm(); });
        spamNotice = state;
    }
    spamNotice.count += n;
    const c = spamNotice.count;
    spamNotice.text.textContent = `🛡️ ${c} email${c === 1 ? '' : 's'} from flagged senders ${c === 1 ? 'was' : 'were'} moved to Spam.`;
    spamNotice.arm();
}

// One pass over the inbox list and the opened emails.
function scanSenderIdentity() {
    if (SITE.id !== 'gmail') return;
    safeSend({ action: 'getSettings' }, (cfg) => guarded('Checking senders', () => {
        if (!cfg || !cfg.values) return;
        lastSettings = cfg.values;
        lastPolicy = cfg.policy || {};
        const S = cfg.values;
        if (!senderFeaturesOn(S)) {
            if (document.querySelector('[data-unshortener-sender]')) removeSenderDecorations();
            spamQueue.clear();
            return;
        }
        if (!S.enableSenderIdentity && document.querySelector('.unshortener-sender-icon, .unshortener-sender-chip')) removeSenderDecorations();
        scanSenderRows(S);
        scanOpenedSenders(S);
        if (spamQueue.size) scheduleSpamMoves();
    }));
}

// Gmail's inbox rows are watched too, for the sender icons and checks.
const WATCH_SELECTOR = SITE.id === 'gmail' ? `${SITE.body}, tr.zA` : SITE.body;

// Watches for Gmail inserting a message body. Gmail changes the page constantly, so the callback
// does as little as possible: text nodes and leaf elements (which cannot contain a message body)
// are skipped before any search, and bursts of changes are debounced into a single scan.
const observer = new MutationObserver((mutations) => {
    scheduleBadgeUpdate();                     // opening, closing or switching views can change the state
    let emailOpened = false;
    outer:
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.matches(WATCH_SELECTOR) || (node.firstElementChild && node.querySelector(WATCH_SELECTOR)) ||
                (SITE.readFrames && (node.tagName === 'IFRAME' || (node.firstElementChild && node.querySelector('iframe'))))) {
                emailOpened = true;
                break outer;
            }
        }
    }
    if (emailOpened) scheduleScan();
});

// One scan after a burst of changes (Gmail, or a Proton message frame, updating the page).
function scheduleScan() {
    clearTimeout(mutationDebounceTimer);
    mutationDebounceTimer = setTimeout(() => {
        refreshCounts();                       // forget messages Gmail removed; keep those still shown
        guarded('Scanning an email', unshortenLinks);
        guarded('Checking senders', scanSenderIdentity);
        scheduleBadgeUpdate();
    }, 350);
}

observer.observe(document.body, { childList: true, subtree: true });
if (document.querySelector(SITE.body) || (SITE.readFrames && document.querySelector('iframe'))) setTimeout(() => guarded('Scanning an email', unshortenLinks), 500);
if (SITE.id === 'gmail') setTimeout(scheduleScan, 500);

// Gmail switches views without reloading; report the state right away on navigation and tab switches.
// Going back to the inbox shows the list Gmail kept, without inserting anything: scan it again.
window.addEventListener('hashchange', () => { scheduleBadgeUpdate(); if (SITE.id === 'gmail') scheduleScan(); });
window.addEventListener('popstate', scheduleBadgeUpdate);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastReported = ''; scheduleBadgeUpdate(); if (spamQueue.size) scheduleSpamMoves(); } });
const SENDER_SETTING_KEYS = ['enableSenderIdentity', 'enableSenderCountry', 'enableSenderDomainCheck', 'enableSenderAddressCheck', 'enableAutoSpam', 'customTrustedSenders', 'customAllowlist', 'enableDnsThreatCheck'];
// Turning protection on or off in Settings or the popup takes effect on the icon immediately.
chrome.storage.onChanged.addListener((changes, area) => {
    // A policy change (for example sender features locked off) applies at once.
    if (area === 'managed' && SITE.id === 'gmail') { spamQueue.clear(); senderResults.clear(); removeSenderDecorations(); scheduleScan(); return; }
    if (area !== 'local') return;
    if (changes.senderMessageCache && changes.senderMessageCache.newValue === undefined) senderMessageCache = null;   // cleared in Settings
    let relevant = false;
    for (const key of ['enableLinkUnmasking', 'enableTrackingPixelBlocking', SITE.settingKey]) {
        if (key && changes[key]) { lastSettings[key] = changes[key].newValue; relevant = true; }
    }
    if (relevant) scheduleBadgeUpdate();
    // Sender features switched on or off: drawn or removed right away.
    if (SITE.id === 'gmail' && SENDER_SETTING_KEYS.some(k => changes[k])) {
        senderResults.clear();
        removeSenderDecorations();
        scheduleScan();
    }
});
scheduleBadgeUpdate();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleVisuals') {
        visualOverridesActive = request.enabled;
        processedLinksMap.forEach((linkData, link) => guarded('Switching link highlights', () => applyLinkStyles(link, linkData)));
        sendResponse({ status: "Visuals toggled", active: visualOverridesActive });
    }

    // The background asks again after it restarted (it keeps the reports in memory only).
    if (request.action === 'reportState') {
        lastReported = '';
        sendResponse(reportState());
    }
});
