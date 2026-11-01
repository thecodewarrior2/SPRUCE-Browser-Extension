// content.js — runs inside each supported webmail (isolated world). Watches for opened messages, sends
// each link to the service worker for analysis, then rewrites or marks it; blocks tracking pixels;
// handles the 🔍 reveal; reads senders, the inbox list and the toolbar through the shared mail engine
// (one code path for every webmail, driven by its WEBMAIL_SITES entry); reports its own failures to
// the application log. Never reports the webmail's own errors.
// shared.js (loaded first) provides: isGhostAnchorStyle, detectLinkProblem, emailTrackerProvider,
// BUILTIN_TRACKER_SET, hostInSet and the settings model.

let linkCount = 0;
let pixelCount = 0;
let visualOverridesActive = true;
// ---------------------------------------------------------------------------
// SITE ADAPTER: which webmail this is, from the WEBMAIL_SITES table (shared.js): where message bodies
// are, how it proxies images, and its `mail` profile for the shared mail engine below. Gmail is one
// entry of that table like the others.
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
    const adapter = (site) => {
        const proxy = site.imageProxy;
        return {
            id: site.id, name: site.name, settingKey: site.settingKey || null,
            // In a site's message frame the whole frame is the message.
            body: inFrame && site.frameBody ? 'body' : site.body,
            readFrames: !inFrame && !!site.readFrames,
            // An image proxy that keeps the original address after "#" (Gmail's), or one that passes it
            // as a query parameter.
            originalImageUrl: (src) => (proxy && proxy.originalAfterHash && proxy.host.test(src) && src.includes('#http')) ? src.slice(src.indexOf('#') + 1)
                : site.imageParams ? fromParam(src, site.imageParams) : src,
            // Proxied images are fetched by the extension from the site's proxy (never from the sender).
            proxyImageUrl: (src) => proxy && proxy.host.test(src) ? src.split('#')[0] : null,
            attachments: site.attachments || null,
            // The site's own profile, else the generic one (accessibility labels; read-only).
            mail: site.mail !== undefined ? site.mail : GENERIC_MAIL
        };
    };
    const site = WEBMAIL_SITES.find(w => w.host.test(host) && (inFrame || !w.path || w.path.test(location.pathname)));
    if (site) return adapter(site);
    // Pages of a supported host that aren't mail (e.g. iCloud Photos), and the test harness.
    return adapter({ id: 'other', name: 'this site', body: '.ii.gt', imageProxy: (WEBMAIL_SITES.find(w => w.imageProxy) || {}).imageProxy, mail: null });
})();

// ---------------------------------------------------------------------------
// MAIL ENGINE: reads any webmail's inbox list, opened emails, toolbar and compose window from its
// `mail` profile (WEBMAIL_SITES in shared.js). The same code runs on every site; only the profile
// differs. On a site without a profile, MAIL is null and only the checks inside opened emails run.
// A site whose entry has no profile of its own gets the generic one (GENERIC_MAIL: accessibility labels,
// read-only). What a site can do follows from what its profile describes (mailCapabilities):
//   MAIL_CAN.list     sender icons, labels and checks in the inbox list
//   MAIL_CAN.opened   sender checks, icons and labels in opened emails
//   MAIL_CAN.headers  signs in the email's original source (forged headers, DMARC…), server country
//   MAIL_CAN.move     moving flagged emails to Spam with the site's own Report spam
//   MAIL_CAN.compose  checking links before sending
// ---------------------------------------------------------------------------
const MAIL = SITE.mail;
const MAIL_CAN = mailCapabilities(SITE);
// The first element matching the comma-separated selectors, trying them in the order listed.
function firstMatch(root, selectors) {
    if (!root || !selectors) return null;
    for (const sel of selectors.split(',')) { const el = root.querySelector(sel.trim()); if (el) return el; }
    return null;
}
// An id read from an element by the profile's readers: { attr, match } (the pattern's first group) or
// { attr, hex } (a hexadecimal id written as "<hex>:<decimal>").
function readId(el, readers) {
    if (!el || !readers) return null;
    for (const r of readers) {
        const v = el.getAttribute(r.attr);
        if (!v) continue;
        if (r.match) { const m = r.match.exec(v); if (m) return m[1]; continue; }
        if (r.hex && /^[0-9a-f]{6,16}$/i.test(v)) { try { return `${r.hex}:${BigInt('0x' + v).toString()}`; } catch (e) { /* ignore */ } }
    }
    return null;
}
// Links to the webmail itself (its own pages) are never checked.
function isOwnWebmailHost(host) { return !!(MAIL && MAIL.ownHosts && MAIL.ownHosts.includes(host)); }

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
//   - managedPhishSimulationRules (webmail whose original source can be read): the vendor's header
//     (and secret value / sending address).
// A training email is left completely alone (no lookups that could count as a click, no pixel
// blocking that would hide "opened", no banners). If the check can't be made, the email is checked as
// usual.
let weakRulesLogged = false;
let refusedDomainsLogged = false;
function phishSimGate(body) {
    const rules = MAIL_CAN.headers ? ((lastPolicy && lastPolicy.phishSimRules) || []) : [];
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
        reportEvent('warning', `Phishing simulation rule${rules.filter(r => r.weak).length > 1 ? 's' : ''} ${rules.filter(r => r.weak).map(r => `“${r.name}”`).join(', ')} match a public header name only; a real phishing email could copy it. Add the vendor's secret header value or its sending addresses (Help for administrators: docs/ADMIN-GUIDE.md).`);
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
        chrome.runtime.sendMessage(withAccount({ action: 'logEvent', level, source: SITE.name, message: String(message) }), () => { void chrome.runtime.lastError; });
    } catch (e) { /* nothing more can be done from an orphaned script */ }
}

// Which mailbox this page is (several accounts can be signed in, each in its own tab): every message to
// the background carries it, so each log entry says which account an action was taken in. account is
// the signed-in address where the webmail shows it (Gmail: in the page title), else ''; site is the
// webmail's name, and Gmail's account number in the address (/mail/u/1/) tells signed-in accounts
// apart before the title is there. In a try: this runs before the mail profile below is set up.
function mailAccount() {
    let address = '';
    try { address = accountAddress(); } catch (e) { /* profile not ready yet */ }
    const u = /\/mail\/u\/(\d+)/.exec(location.pathname);
    return { account: address, site: (SITE && SITE.name) || location.hostname, slot: u ? u[1] : '' };
}
// Under its own key (mailbox), so it can never clash with a message's own fields (senderIcon has a site).
function withAccount(message) {
    if (!message || typeof message !== 'object' || message.mailbox !== undefined) return message;
    return Object.assign({}, message, { mailbox: mailAccount() });
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
// Queued moves to Spam, for the toolbar popup: how many, and why they're waiting when they are. In a
// try: this can run on the background's first message, before the mover's state further down exists.
function moveWaitState() {
    try { return spamQueue.size ? { n: spamQueue.size, why: document.documentElement.dataset.unshortenerSpamWait || '' } : null; }
    catch (e) { return null; }
}
let lastReported = '';
function reportState() {
    refreshCounts();
    const active = protectionOn() && inBodies('').some(isShown);
    const links = active ? linkStats() : null;
    const state = { action: 'updateBadge', active, linkCount: active ? linkCount : 0, pixelCount: active ? pixelCount : 0, links, moveWait: moveWaitState() };
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
        if (!disabled) { try { if (isOwnWebmailHost(new URL(a.href).hostname)) continue; } catch (e) { continue; } }
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
    // A message that expects an answer is work in progress until the answer has been handled.
    const done = callback ? workStarted() : null;
    const answer = (response) => { try { callback(response); } finally { done(); } };
    try {
        chrome.runtime.sendMessage(withAccount(message), (response) => {
            if (chrome.runtime.lastError) { if (callback) answer(null); return; }
            if (callback) answer(response);
        });
    } catch (e) {
        // Extension was reloaded/updated while this tab stayed open.
        if (callback) answer(null);
    }
}

// --- Work in progress ------------------------------------------------------------------------------
// How many checks are still running on the page: messages to the background waiting for an answer,
// emails' original source or attachments being read, a scan waiting to run (or the first one, right
// after the page loads), and emails queued or being moved to Spam. Shown as
// <html data-unshortener-busy="N">: 0 means everything on screen has been checked and decided, so the
// browser tests (and anyone troubleshooting) can wait for "done" instead of guessing how long it takes.
let workInFlight = 0, firstScanPending = true;
const SPAM_PARKED = new Set(['view', 'several lists', 'split view', 'selection', 'user busy', 'tab hidden', 'not shown']);
function publishBusy() {
    let n;
    // Called as early as the first message, before the scan and Spam state below are set up.
    try {
        if (!spamQueue.size && document.documentElement.dataset.unshortenerSpamWait) document.documentElement.dataset.unshortenerSpamWait = '';
        // Moves parked until the user changes something (the view, a selection…) aren't work in progress;
        // waits that end by themselves (the quiet period, a pause after failures) are.
        const parked = SPAM_PARKED.has(document.documentElement.dataset.unshortenerSpamWait || '');
        n = workInFlight + (firstScanPending || mutationDebounceTimer ? 1 : 0) + (parked ? 0 : spamQueue.size) + (spamMoveRunning ? 1 : 0);
    } catch (e) { n = workInFlight + 1; }
    const v = String(n);
    if (document.documentElement.dataset.unshortenerBusy !== v) document.documentElement.dataset.unshortenerBusy = v;
}
// Starts a unit of work; the function it returns ends it (once). The end is counted a moment later, so
// a step that starts the next one right away never shows 0 in between.
function workStarted() {
    workInFlight++;
    publishBusy();
    let ended = false;
    return () => { if (ended) return; ended = true; setTimeout(() => { workInFlight--; publishBusy(); }, 0); };
}
function trackWork(promise) {
    const done = workStarted();
    promise.then(done, done);
    return promise;
}

const DANGER_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" style="vertical-align: middle; display: inline-block;"><polygon points="7,2 17,2 22,7 22,17 17,22 7,22 2,17 2,7" fill="#d93025" stroke="#ffffff" stroke-width="1.5"/><path d="M12,6.5 L12,12.5" stroke="#ffd700" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1.5" fill="#ffd700"/></svg>`;
// Suspicious but not dangerous (text shows another site, raw IP…): amber warning triangle.
const CAUTION_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" style="vertical-align: middle; display: inline-block;" aria-hidden="true"><path d="M12 2.5 L22.5 21 H1.5 Z" fill="#f9ab00" stroke="#5f3b00" stroke-width="1.2" stroke-linejoin="round"/><rect x="11" y="9" width="2" height="6.5" rx="1" fill="#202124"/><circle cx="12" cy="18" r="1.2" fill="#202124"/></svg>`;
// Blocklisted link with a hidden destination: magnifier on a red disc. Click = "reveal?" prompt.
const REVEAL_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" style="vertical-align: middle; display: inline-block;"><circle cx="12" cy="12" r="11" fill="#d93025" stroke="#ffffff" stroke-width="1.5"/><circle cx="10.5" cy="10.5" r="4.2" fill="none" stroke="#ffffff" stroke-width="2"/><path d="M13.6,13.6 L17.5,17.5" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/><path d="M10.5,8.6 L10.5,10.9 M10.5,12.4 L10.5,12.5" stroke="#ffd700" stroke-width="1.8" stroke-linecap="round"/></svg>`;

// Email tracking link: small blue magnifier, shown when the link is hovered (see content.css).
const TRACKER_REVEAL_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align: middle; display: inline-block;"><circle cx="12" cy="12" r="11" fill="#1a73e8" stroke="#ffffff" stroke-width="1.5"/><circle cx="10.5" cy="10.5" r="4.2" fill="none" stroke="#ffffff" stroke-width="2"/><path d="M13.6,13.6 L17.5,17.5" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/></svg>`;

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
        icon.innerHTML = kind === 'danger' ? DANGER_SVG : kind === 'caution' ? CAUTION_SVG : kind === 'trackreveal' ? TRACKER_REVEAL_SVG : REVEAL_SVG; // static markup only
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
        // Chromium can leave an empty style="" behind when a CSSOM-created style is removed
        // directly; writing the attribute first makes the removal complete.
        link.setAttribute('style', '');
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
        let title = d.isUnknown
            ? `Not verified: ${d.finalUrl}\n(Original link: ${d.originalUrl})${d.note ? `\n(${d.note})` : ''}`
            : `Checked, nothing found: ${d.finalUrl}\n(Original link: ${d.originalUrl})`;
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
            d.isUnknown = response.verdict !== 'safe';   // anything but a definite "safe" is not verified
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
            reportEvent('error', `Settings could not be loaded, so this email was not scanned. Reload ${SITE.name}; if it keeps happening, reload the extension.`);
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

            // Decide by the parsed host. (A substring test on the webmail's own host let any link skip
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
            if (link.dataset.unshortened || !linkHost || isOwnWebmailHost(linkHost)) {
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
                                isUnknown: response.verdict !== 'safe',   // anything but a definite "safe" is not verified
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
    trackWork(fetch(img.src, { credentials: 'include' }))
        .then(r => r.blob()).then(async (blob) => { if (blob.size <= ATTACHMENT_MAX_BYTES) send({ b64: await blobToBase64(blob), mime: blob.type }); })
        .catch(() => { img.dataset.qr = 'failed'; });
}

// Attachments, located as the site's `attachments` entry describes (Gmail: the chip's download_url
// attribute, "mime:name:url", and as a fallback its download links, attid= with view=att / disp=).
// Each is fetched with the user's own session (same site) and checked on this device, by type:
//   images, PDFs → QR codes (+ PDF links) · SVG, HTML → scripts, redirects, fake logins · .ics → links
//   ZIP/RAR/7z → encrypted? · any file name → hidden text-direction characters
const ATTACHMENT_MAX_PER_SCAN = 6;
const EXT_MIME = { pdf: 'application/pdf', svg: 'image/svg+xml', svgz: 'image/svg+xml', html: 'text/html', htm: 'text/html', shtml: 'text/html',
    xhtml: 'text/html', ics: 'text/calendar', zip: 'application/zip', rar: 'application/x-rar', '7z': 'application/x-7z-compressed',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

// Attachment cards, as the site's `attachments` entry describes them: an attribute holding
// "mime:name:address" (cardAttr), and download links (link selector, href pattern).
function findAttachments() {
    const found = [];
    const A = SITE.attachments;
    if (!A) return found;
    if (A.cardAttr) for (const el of document.querySelectorAll(`[${A.cardAttr}]`)) {
        const parts = String(el.getAttribute(A.cardAttr)).split(':');
        if (parts.length >= 3) found.push({ el, mime: parts[0], name: parts[1], url: parts.slice(2).join(':') });
    }
    if (A.link) for (const a of document.querySelectorAll(A.link)) {
        if (A.linkHref && !A.linkHref.test(a.getAttribute('href'))) continue;
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
        const msg = MAIL_CAN.opened && MAIL.message.container ? anchor.closest(MAIL.message.container) : null;
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
    const res = await trackWork(fetch(url, { credentials: 'include' }));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!limit) return trackWork(res.blob());
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
    link.title = `⚠️ Disabled by S.P.R.U.C.E+: ${reason}.`;
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
            } else if (r.verdict !== 'safe') {
                render('info', [goes, `not verified${r.note ? ` (${r.note})` : ''}`].filter(Boolean).join(' · '), dest);
            } else {
                render('ok', [goes, '✓ checked, nothing found'].filter(Boolean).join(' · '), dest);
            }
        }));
    }
}

function hostLabel(u) { try { return new URL(u).hostname; } catch (e) { return u; } }

// ---------------------------------------------------------------------------
// SENDER CHECKS (webmail with a `mail` profile). The webmail's own authentication verdict for the open
// email is read from the message's original source (Gmail's "Show original"; same site, the user's
// own session; the profile's `headers` entry) only when needed:
// the email contains a company-only short link (c.gle…) whose destination is unknown, or the
// sender's name claims a brand. Nothing is sent anywhere else. Results are cached per message.
// ---------------------------------------------------------------------------
const messageAuth = new Map();          // message id → Promise<auth | null>
const MESSAGE_AUTH_MAX = 100;
const pageValueCache = new Map();
let authFetchFailureLogged = false;

function senderChecksActive() { return !!MAIL_CAN.opened && lastSettings.enableSenderChecks !== false && !(SITE.settingKey && lastSettings[SITE.settingKey] === false); }

// The permanent id of the message a body belongs to (Gmail: "msg-f:<decimal>").
function messageIdOf(el) {
    if (!MAIL || !MAIL.ids || !MAIL.ids.messageHolder) return null;
    return readId(el.closest(MAIL.ids.messageHolder), MAIL.ids.message);
}

// A value the original-source address needs, as the profile describes it: from the page address
// (path pattern), from an inline script (pattern, then the field-th comma-separated item), or from
// any link that carries it (linkParam). Remembered for the page.
function pageValue(name, spec) {
    if (pageValueCache.has(name)) return pageValueCache.get(name);
    let v = '';
    const ok = (x) => !!x && (!spec.valid || spec.valid.test(x));
    if (spec.path) { const m = spec.path.exec(location.pathname); if (m) v = m[1]; }
    if (!v && spec.script) {
        for (const sc of document.querySelectorAll('script:not([src])')) {
            const m = spec.script.exec(sc.textContent || '');
            if (!m) continue;
            const x = spec.field === undefined ? m[1] : (m[1].split(',')[spec.field] || '').replace(/["'\s]/g, '');
            if (ok(x)) { v = x; break; }
        }
    }
    if (!v && spec.linkParam) {
        const a = document.querySelector(`a[href*="${spec.linkParam}="]`);
        const m = a && new RegExp(`[?&]${spec.linkParam}=([^&#]+)`).exec(a.getAttribute('href'));
        if (m && ok(m[1])) v = m[1];
    }
    if (!v && spec.fallback !== undefined) v = spec.fallback;
    if (!spec.path) pageValueCache.set(name, v);          // the account in the address can change
    return v;
}
// The address of a message's original source, from the profile's template.
function headersUrl(id) {
    const H = MAIL.headers;
    return H.url.replace(/\{(\w+)\}/g, (m, k) => {
        if (k === 'origin') return location.origin;
        if (k === 'id') return encodeURIComponent(id);
        const spec = H.values && H.values[k];
        if (!spec) return '';
        const v = pageValue(k, spec);
        return v ? (spec.format ? spec.format.replace('{value}', encodeURIComponent(v)) : encodeURIComponent(v)) : '';
    });
}

// The original source is the whole raw message, attachments included (possibly megabytes); only the
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

// The open email's headers from its original source ({ raw, auth }), read once per email and shared
// by the sender checks and the phishing-simulation check; null if they can't be read.
function getMessageHeaders(el) {
    return getMessageHeadersById(messageIdOf(el));
}
function getMessageHeadersById(id) {
    if (!id || !MAIL_CAN.headers) return Promise.resolve(null);
    if (messageAuth.has(id)) return messageAuth.get(id);
    if (messageAuth.size >= MESSAGE_AUTH_MAX) messageAuth.delete(messageAuth.keys().next().value);
    const H = MAIL.headers;
    const p = trackWork(fetch(headersUrl(id), { credentials: 'include' })
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return readUntilHeadersEnd(r); })
        .then(text => {
            let raw = text;
            if (/<pre[\s>]/i.test(text)) {
                const doc = new DOMParser().parseFromString(text, 'text/html');
                const pre = firstMatch(doc, H.text || 'pre');
                raw = pre ? pre.textContent : text;
            }
            const auth = parseAuthResults(raw, H.receiver && H.receiver.host);
            // A domain whose mail passed its sender verification here becomes protected against
            // look-alikes (the look-alike check; only the domain is kept).
            if (auth && auth.dmarc === 'pass' && auth.headerFrom && lastSettings.enableLookalikeCheck !== false) safeSend({ action: 'senderVerified', domain: String(auth.headerFrom) });
            return { raw, auth };
        })
        .catch(e => {
            if (!authFetchFailureLogged) { authFetchFailureLogged = true; reportEvent('warning', `${SITE.name}'s original message could not be read (${e.message}), so senders are treated as not checked.`); }
            return null;
        }));
    messageAuth.set(id, p);
    return p;
}

function getMessageAuth(el) {
    return getMessageHeaders(el).then(h => {
        if (h && !h.auth && !authFetchFailureLogged) { authFetchFailureLogged = true; reportEvent('warning', `Sender checks: no authentication results from ${SITE.name} in the original message, so senders are treated as not checked.`); }
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

// The opened message a body belongs to: { container, el } with the element showing its sender, or
// null. A site's own profile names them (message.container, message.sender). The generic profile
// looks outward from the body (at most 8 levels) for the first element showing an address that comes
// before the body on the page and isn't part of it, an inbox row or the extension's own additions:
// webmail show the sender above the message.
function openedSenderElement(body) {
    if (!MAIL_CAN.opened) return null;
    const M = MAIL.message;
    if (M.container) {
        const container = body.closest(M.container) || body.parentElement;
        const el = container && container.querySelector(M.sender);
        return el ? { container, el } : null;
    }
    let node = body;
    for (let depth = 0; depth < 8 && node.parentElement && node.parentElement !== document.body; depth++) {
        node = node.parentElement;
        for (const el of node.querySelectorAll(M.near)) {
            if (body.contains(el) || el.closest('[class*="unshortener-"]') || (MAIL.list && el.closest(MAIL.list.row))) continue;
            if (!(el.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING) || !isShown(el) || !senderOf(el)) continue;
            return { container: node, el };
        }
    }
    return null;
}
// The element holding one whole opened message (its header, body and attachments).
function messageContainerOf(body) {
    if (MAIL_CAN.opened && MAIL.message.container) return body.closest(MAIL.message.container) || body.parentElement;
    const found = openedSenderElement(body);
    return (found && found.container) || body.parentElement;
}
// The sender the webmail shows for the message a body belongs to: { name, address }.
function openedSenderOf(body) {
    const found = openedSenderElement(body);
    const who = found && senderOf(found.el);
    return who ? { name: who.name, address: who.address } : null;
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
// The color an element is drawn on: the first background up its ancestors that isn't see-through.
function surfaceColor(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        const m = (getComputedStyle(e).backgroundColor || '').match(/[\d.]+/g);
        if (m && m.length >= 3 && !(m.length === 4 && +m[3] === 0)) return [+m[0], +m[1], +m[2]];
    }
    return [255, 255, 255];
}
const isDarkRgb = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) < 128;
function isDarkSurface(el) { return isDarkRgb(surfaceColor(el)); }
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
    if (MAIL_CAN.opened && openedStates.has(body)) updateOpenedVerdict(body);
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
        st.el.setAttribute('aria-label', 'S.P.R.U.C.E+ notice about this email');
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
// CHECKING LINKS BEFORE SENDING (webmail whose profile describes its compose window). Send (the
// button, or Ctrl/⌘+Enter) is held while the links
// in the new message are checked; the quoted original is left out. If any link has a problem, a
// dialog lists them and the user goes back to fix them or sends anyway. An email without links
// sends at once. Checks that can't finish (network down, too slow) don't block sending.
// ---------------------------------------------------------------------------
const sendApproved = new WeakSet();      // compose windows allowed to send (our own repeated click)
let sendCheckRunning = false;
const COMPOSE_BODY_SELECTOR = MAIL_CAN.compose ? MAIL.compose.body : '';

function sendCheckActive() { return MAIL_CAN.compose && protectionOn() && lastSettings.enableSendCheck !== false; }

// The Send button a click or key went to: its label says Send (and not Schedule…), or it carries the
// site's own class for Send in any language (Gmail's long-stable one).
function sendButtonFrom(target) {
    const b = target && target.closest ? target.closest('[role="button"]') : null;
    if (!b) return null;
    const C = MAIL.compose;
    const label = (b.getAttribute('data-tooltip') || b.getAttribute('aria-label') || '').trim();
    if (C.notSend && C.notSend.test(label)) return null;
    if (!(C.send && C.send.test(label)) && !(C.sendClass && b.classList.contains(C.sendClass))) return null;
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
        btn = [...compose.querySelectorAll('[role="button"]')].find(b => sendButtonFrom(b));
        if (!btn) return;
    } else {
        btn = sendButtonFrom(e.target);
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
if (MAIL_CAN.compose) {
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'keydown']) document.addEventListener(t, onSendAttempt, true);
}

// Checks each message's sender once: names claiming a brand, look-alike domains, and (with the
// webmail's verdict, fetched only when the name claims a brand or a company-only link is present) brand
// domains failing verification and scam text inside genuine company notifications.
function scanSenders() {
    if (!senderChecksActive()) return;
    for (const body of inBodies('')) {
        if (body.dataset.senderChecked || !isShown(body)) continue;
        const sender = openedSenderOf(body);
        if (!sender || !sender.address) continue;
        body.dataset.senderChecked = '1';
        const claimed = displayNameBrand(sender.name);
        const needsVerdict = !!claimed || [...body.querySelectorAll('a[href]')].some(a => companyOnlyShortener(a.href));
        const ownership = claimed && !senderDomainOwnedBy(claimed, domainOfAddress(sender.address)) ? brandOwnershipFor(domainOfAddress(sender.address), claimed.name, lastSettings) : Promise.resolve(null);
        const finish = (auth, owned) => guarded('Checking the sender', () => {
            if (!body.isConnected) return;
            const r = evaluateSender({ displayName: sender.name, address: sender.address, auth, bodyText: auth ? body.innerText.slice(0, 20000) : '', ownership: owned });
            // A brand's or a colleague's name on another address counts in the email's verdict (as in
            // the inbox list; see updateOpenedVerdict), which the banner shows: not repeated here.
            if (lastSettings.enableLookalikeCheck !== false) r.findings = r.findings.filter(f => !/^The sender's name says/.test(f.message));
            showSenderFindings(body, r.findings);
            for (const line of r.info) reportEvent('info', line);
            for (const f of r.findings) reportEvent(f.severity === 'danger' ? 'warning' : 'info', `Sender check: ${f.message}`);
        });
        if (needsVerdict) Promise.all([getMessageAuth(body), ownership]).then(([auth, owned]) => finish(auth, owned)); else finish(null, null);
    }
}

// ---------------------------------------------------------------------------
// SENDER IDENTITY AND AUTOMATIC SPAM (webmail with a `mail` profile; Gmail today). Every sender in the
// inbox list and in opened emails gets
// its site icon, the country flag and a domain label colored by its check (checkSender in
// background.js). An email whose sender is FLAGGED (never one that is unverified, unknown or clean) is
// moved to Spam with the webmail's own Report spam button, only from the inbox and only once: conversations
// the extension moved are remembered, so one the user takes back out of Spam stays where they put it.
// A short notice at the top of the webmail says how many were moved, with a link to the Spam folder.
// Nothing here runs on a training email from your phishing simulation (administrator policies).
// ---------------------------------------------------------------------------
const senderResults = new Map();           // raw address → Promise<result | null>, for this page
const SENDER_RESULTS_MAX = 1000;
const messageInfos = new Map();            // Gmail message id → Promise<{ fh, ip, an } | null>
const senderIcons = new Map();             // "site|address" → Promise<{ d: data: URL or "", avatar }>
const openedStates = new WeakMap();        // message body → what's known about its sender (opened emails)
const loggedVerdicts = new Set();          // emails whose own verdict was already logged on this page (newest 2,000)
const spamQueue = new Map();               // conversation → { kind: 'row' | 'thread', address, reason, msgId, since }
const spamAttempted = new Set();           // conversations Gmail was asked to move on this page: never asked twice
const spamTries = new Map();               // conversation → clicks Gmail ignored (tried again up to SPAM_MAX_TRIES)
let spamMoveRunning = 0;                   // when the current pass started (0: none)
let spamMoveTimer = null;
let spamMoveFailures = 0;                  // passes in a row in which Gmail moved nothing
let spamPausedUntil = 0;
let splitViewLogged = false;
let multiListLogged = false;
let spamRetryDelay = 3000;                 // after a pass whose clicks Gmail ignored (reset when one moves)
const SPAM_PARKED_POLL_MS = 3000;          // while parked (the view, an open email, a selection…): a cheap look this often
const SPAM_MAX_TRIES = 3;                  // a conversation Gmail skipped while moving others is tried again, at most this often
const SPAM_PAUSE_AFTER = 3;                // passes in a row that moved nothing before pausing (never stopping)
const SPAM_WAIT_MAX_MS = 10 * 60 * 1000;   // a queued conversation that isn't shown for this long leaves the queue
const SPAM_RUN_TIMEOUT_MS = 90000;         // a pass still "running" after this never finished: abandoned by the monitor
let senderMessageCache = null;             // Promise<{ msg id → { fh, ip, an, t } }>, kept between visits
let senderMessageCacheTimer = null;
const SENDER_MESSAGE_CACHE_MAX = 5000;
const STATUS_TEXT = { flagged: 'Flagged sender', caution: 'Caution', clean: 'Checked', trusted: 'Trusted', unverified: 'Not verified', unknown: 'Unknown sender', pending: 'Checking…' };
// Color and a mark only where they mean something: flagged and caution ask for attention, trusted is
// the user's or organization's own choice. Everything else (checked, not verified) stays neutral, so
// big providers don't look suspect and nothing looks safe that wasn't proven safe.
const STATUS_MARK = { flagged: '⛔', caution: '⚠', trusted: '✓' };
const STATUS_SHOWN = new Set(['flagged', 'caution', 'trusted']);
const STATUS_RANK = { flagged: 5, caution: 4, unknown: 3, unverified: 2, trusted: 1, clean: 1, pending: 0 };

function senderFeaturesOn(S) {
    if (SITE.settingKey && S[SITE.settingKey] === false) return false;          // support for this webmail switched off
    return !!(MAIL_CAN.list || MAIL_CAN.opened) && !!(S.enableSenderIdentity || S.enableSenderDomainCheck || S.enableSenderAddressCheck);
}

// Conversation ids (Gmail: "thread-f:<decimal>") of a list row and of the open conversation, and the
// id of a row's newest message, as the profile's `ids` entry describes them.
function rowThreadElement(row) { return MAIL && MAIL.ids ? row.querySelector(MAIL.ids.rowThread) : null; }
function rowThreadKey(row) { return MAIL && MAIL.ids ? readId(rowThreadElement(row), MAIL.ids.thread) : null; }
function rowLastMessageId(row) { return MAIL && MAIL.ids ? readId(rowThreadElement(row), MAIL.ids.rowLastMessage) : null; }
function currentThreadKey() {
    if (!MAIL || !MAIL.openThread) return null;
    const h = [...document.querySelectorAll(MAIL.openThread)].find(isShown);
    return h ? readId(h, MAIL.ids.thread) : null;
}
// The rows of the inbox list, and their state (the profile's `list` entry).
function listRows() { return MAIL_CAN.list ? [...document.querySelectorAll(MAIL.list.row)] : []; }
function rowIsUnread(row) {
    return !!(MAIL.list.unread && row.matches(MAIL.list.unread)) || !!(MAIL.list.unreadLabel && MAIL.list.unreadLabel.test(row.getAttribute('aria-label') || ''));
}
function rowCheckbox(row) { return row.querySelector(MAIL.list.checkbox); }
function rowIsSelected(row) { return !!(MAIL.list.selected && row.matches(MAIL.list.selected)) || (rowCheckbox(row) || { getAttribute: () => null }).getAttribute('aria-checked') === 'true'; }

// The signed-in account (Gmail: "Subject - name@school.org - Gmail" in the title), and its
// organization's domain. The LAST address in the title is the account's: an email's subject comes
// first and can contain any address. A personal-mail domain (gmail.com…) is no organization: others
// share it.
function accountAddress() {
    if (!MAIL || !MAIL.account || !MAIL.account.fromTitle) return '';
    const all = (document.title || '').match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g);
    return all ? all[all.length - 1].toLowerCase() : '';
}
function ownOrgDomain() {
    const d = domainOfAddress(accountAddress());
    return d && !isPersonalMailDomain(d) ? d : '';
}

// A sender as the webmail shows it: { raw, address, domain, name }. Broken addresses (encoded parts,
// more than 64 characters before the @…) are kept: they are themselves a sign of forgery.
function senderOf(el) {
    const A = (MAIL && MAIL.senderAttrs) || {};
    const attrs = (names) => [].concat(names || []);
    let raw = '';
    for (const n of attrs(A.address)) {
        const v = el.getAttribute(n);
        if (!v) continue;
        // A whole attribute is the address as written: an encoded part ("=?UTF-8?B?…?=") is
        // case-sensitive, so it's never lower-cased. With `extract`, the address is taken out of a
        // longer value ("Jane Doe <jane@example.com>", "mailto:…").
        raw = A.extract ? ((v.replace(/^mailto:/i, '').match(EMAIL_IN_TEXT_RE) || [])[0] || '') : v;
        raw = raw.trim();
        if (raw) break;
    }
    const p = parseSenderAddress(raw);
    if (!p) return null;
    let name = '';
    for (const n of attrs(A.name)) { name = el.getAttribute(n) || ''; if (name) break; }
    if (!name) name = el.textContent.trim();
    if (!name || name.includes('@')) {                              // a title like "Jane Doe <jane@example.com>"
        const t = (el.getAttribute('title') || '').split('<')[0].trim();
        if (t && !t.includes('@')) name = t;
    }
    return { raw, address: p.address, domain: p.domain, name: name.slice(0, 120) };
}

// Senders shown in a list row (up to 3, without the signed-in user), in the order the webmail shows them.
function rowSenders(row) {
    const me = accountAddress();
    const out = new Map();
    let spans = row.querySelectorAll(MAIL.list.sender);
    const firstAttr = MAIL.senderAttrs && [].concat(MAIL.senderAttrs.address || [])[0];
    if (!spans.length && firstAttr) spans = row.querySelectorAll(`[${firstAttr}]`);
    for (const s of spans) {
        const who = senderOf(s);
        if (!who || who.address === me || out.has(who.raw)) continue;
        out.set(who.raw, who);
    }
    return [...out.values()].slice(-3);
}

// Colleagues' names (look-alike check), as hashes only: learned from your own organization's senders in
// the inbox list, so an outside address using one of those names is noticed. Loaded once per page.
let colleagueHashes = null;
const colleagueLearnQueue = new Set();
function loadColleagueHashes() {
    if (!colleagueHashes) {
        colleagueHashes = new Set();
        safeSend({ action: 'getColleagueNames' }, (list) => { if (Array.isArray(list)) list.forEach(h => colleagueHashes.add(h)); });
    }
    return colleagueHashes;
}
function learnColleagueName(name) {
    const h = colleagueNameHash(name);
    if (!h || loadColleagueHashes().has(h)) return;
    colleagueHashes.add(h);
    colleagueLearnQueue.add(h);
    if (colleagueLearnQueue.size === 1) setTimeout(() => {
        const hashes = [...colleagueLearnQueue];
        colleagueLearnQueue.clear();
        safeSend({ action: 'learnColleagueNames', hashes });
    }, 2000);
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

// Whether an address's domain is the brand's that its sender name claims, from public records (the
// background's brandOwnership): { state: 'owned' | 'likely' | 'unknown', how }, or null when not
// looked up (Offline only, the check off, or no answer), which judges the name as before. Asked once
// per domain and brand per page; the background remembers answers 30 days.
const brandOwnerships = new Map();
const BRAND_OWNERSHIPS_MAX = 500;
function brandOwnershipFor(domain, brandName, S) {
    if (!S || !S.enableDnsThreatCheck || !S.enableLookalikeCheck) return Promise.resolve(null);
    const reg = registrableDomain(domain) || domain;
    const key = `${brandName}|${reg}`;
    if (!brandOwnerships.has(key)) {
        if (brandOwnerships.size >= BRAND_OWNERSHIPS_MAX) brandOwnerships.delete(brandOwnerships.keys().next().value);
        const p = new Promise(resolve => safeSend({ action: 'brandOwnership', domain: reg, brand: brandName }, (r) => resolve(r && r.state ? { state: r.state, how: r.how || '' } : null)));
        brandOwnerships.set(key, p);
        p.then(v => { if (!v && brandOwnerships.get(key) === p) brandOwnerships.delete(key); });      // no answer: asked again next time
    }
    return brandOwnerships.get(key);
}
// The lookups for the senders whose name claims a brand their domain isn't known to be; null elsewhere.
function ownershipsFor(senders, S) {
    return Promise.all(senders.map(s => {
        const b = S.enableLookalikeCheck && s.name ? displayNameBrand(s.name) : null;
        return b && s.domain && !isPersonalMailDomain(s.domain) && !senderDomainOwnedBy(b, s.domain) ? brandOwnershipFor(s.domain, b.name, S) : Promise.resolve(null);
    }));
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
            if (cache[msgId] && Array.isArray(cache[msgId].an) && cache[msgId].v === HEADER_SIGNS_VERSION) return cache[msgId];
            headersFetched.add(msgId);
            if (headersFetched.size > 2000) headersFetched.delete(headersFetched.values().next().value);
            const h = await withHeaderSlot(() => getMessageHeadersById(msgId));
            if (!h) return null;
            const headers = parseRawHeaders(h.raw);
            const from = ((headers.find(([n]) => n === 'from') || [])[1] || '');
            const fm = /<([^>]*)>\s*$/.exec(from);
            const parsed = parseSenderAddress(fm ? fm[1] : ((from.match(EMAIL_IN_TEXT_RE) || [])[0] || from));
            const receiver = MAIL.headers.receiver || {};
            const an = headerAnomalies(h.raw, accountAddress(), receiver);
            const info = { fh: parsed ? addressFingerprint(parsed.address) : '', ip: deliveringIp(headers, receiver.host) || '', an, v: HEADER_SIGNS_VERSION, t: Date.now() };
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
// The sender's icon: a remembered photo or verified logo for the address first (round, as the webmail
// shows them), else the site's icon, else a blank space of the same size.
function senderIconEl(domain, S, address, name) {
    const wrap = document.createElement('span');
    wrap.className = 'unshortener-sender-icon';
    wrap.dataset.site = siteOfSender(domain);
    wrap.dataset.domain = String(domain || '').toLowerCase();
    wrap.dataset.name = String(name || '').slice(0, 80);
    wrap.dataset.address = String(address || '').toLowerCase();
    fillSenderIcon(wrap, S);
    return wrap;
}
// Size of the sender pictures in the inbox list (setting senderPictureSize; 'auto' follows Gmail's
// display density): 'large' (36-pixel circles over the checkbox; Default density), 'medium' (32;
// Comfortable) or 'inline' (Compact: no circles, the site's icon in line with the country flag, at
// the flag's size). Only where the profile describes its own pictures (Gmail); elsewhere the icon
// stays beside the sender. The density last seen is kept while the page shows nothing to tell
// Default and Comfortable apart (no attachments in view).
let lastDensity = 'default';
function listDensity() {
    const D = MAIL && MAIL.list && MAIL.list.density;
    if (!D) return lastDensity;
    const nav = D.navItem ? document.querySelector(D.navItem) : null;
    const navHeight = nav ? nav.getBoundingClientRect().height : 0;
    const row = listRows().find(isShown);
    const rowHeight = row ? row.getBoundingClientRect().height : 0;
    if ((navHeight && navHeight <= D.compactNavMax) || (!navHeight && rowHeight && rowHeight <= D.compactRowMax)) return (lastDensity = 'compact');
    const rows = listRows().filter(isShown);
    if (D.chips && rows.some(r => r.querySelector(D.chips))) return (lastDensity = 'default');
    if (D.paperclip && rows.some(r => r.querySelector(D.paperclip))) return (lastDensity = 'comfortable');
    return lastDensity === 'compact' ? (lastDensity = 'default') : lastDensity;
}
function pictureMode(S) {
    if (!MAIL_CAN.avatars) return 'none';
    const set = S.senderPictureSize;
    if (set === 'large' || set === 'medium' || set === 'inline') return set;
    return { compact: 'inline', comfortable: 'medium' }[listDensity()] || 'large';
}
function applyPictureMode(S) {
    const mode = pictureMode(S);
    if (document.documentElement.dataset.unshortenerPictures !== mode) document.documentElement.dataset.unshortenerPictures = mode;
    return mode;
}

// The density can change while the inbox is open (Settings → Density) without the list being rebuilt,
// so it's looked at again every 3 seconds while the tab is shown (one element and two sizes); the
// rows are redrawn only when the picture size changes or a row lost its picture. Stopped while the tab
// is in the background.
let densityTimer = null;
function setDensityWatch() {
    const on = MAIL_CAN.avatars && !document.hidden;
    if (on && !densityTimer) densityTimer = setInterval(() => guarded('Following Gmail\'s density', () => {
        if (!lastSettings.enableSenderIdentity) return;
        harvestPagePhotos(lastSettings);
        const before = document.documentElement.dataset.unshortenerPictures;
        // …and a picture Gmail took away while redrawing a row (coming back from an email) is put back.
        if (applyPictureMode(lastSettings) !== before || listRows().some(r => isShown(r) && avatarLost(r))) scheduleScan();
    }), 3000);
    else if (!on && densityTimer) { clearInterval(densityTimer); densityTimer = null; }
}
setDensityWatch();
document.addEventListener('visibilitychange', setDensityWatch);

// In an inbox row with circles ('large' or 'medium') the sender's picture is a circle over the row's
// checkbox (placeRowAvatar): their photo or company logo, else the site's icon, else a colored
// initial, so every row looks the same; nothing is drawn beside the sender then (the wrapper keeps
// only the country flag). In 'inline' mode the site's icon sits beside the flag, at the flag's size.
// In an opened email (no checkbox) the site's icon stays beside the sender, since the webmail shows
// its own picture there.
function fillSenderIcon(wrap, S) {
    const site = wrap.dataset.site, address = wrap.dataset.address, domain = wrap.dataset.domain || site;
    const blank = () => { const b = document.createElement('span'); b.className = 'unshortener-sender-blank'; b.setAttribute('aria-hidden', 'true'); return b; };
    wrap.querySelectorAll('img, .unshortener-sender-blank').forEach(e => e.remove());
    const row = () => MAIL && MAIL.list ? wrap.closest(MAIL.list.row) : null;
    const mode = document.documentElement.dataset.unshortenerPictures || 'none';
    const circles = () => (mode === 'large' || mode === 'medium') && !!(MAIL.list.checkbox && row() && row().querySelector(MAIL.list.checkbox));
    const initial = () => placeRowAvatar(wrap, '', 'initial');
    const slot = blank();
    wrap.insertBefore(slot, wrap.firstChild);
    const avatars = !!(MAIL_CAN.avatars && S.enableSenderAvatars && address);
    if (!(SENDER_DOMAIN_RE.test(site) && (S.enableDnsThreatCheck || avatars))) {
        // Nothing can be asked for (offline): an initial in the circle, so every row looks the same.
        Promise.resolve().then(() => { if (slot.isConnected && circles()) { slot.remove(); initial(); } });
        return;
    }
    const key = `${site}|${domain}|${avatars ? address : ''}`;
    if (!senderIcons.has(key)) {
        if (senderIcons.size >= SENDER_RESULTS_MAX) senderIcons.delete(senderIcons.keys().next().value);
        senderIcons.set(key, new Promise(resolve => safeSend({ action: 'senderIcon', site, domain, address: avatars ? address : '' },
            (r) => {
                const img = (v) => typeof v === 'string' && v.startsWith('data:image/') ? v : '';
                // A BIMI logo whose server allows no download comes as its https: address.
                const pic = (v) => img(v) || (typeof v === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(v) ? v : '');
                resolve({ d: img(r && r.d), a: pic(r && r.a), k: r && typeof r.k === 'string' ? r.k : '' });
            })));
    }
    senderIcons.get(key).then(r => {
        if (!slot.isConnected) return;
        if (circles()) {
            slot.remove();
            if (r.a) placeRowAvatar(wrap, r.a, r.k || 'logo', r.d);
            else if (r.d) placeRowAvatar(wrap, r.d, 'icon');
            else initial();
            return;
        }
        if (!r.d) return;
        const img = document.createElement('img');
        img.alt = '';
        img.width = 16; img.height = 16;
        if (mode === 'inline' && row()) img.className = 'unshortener-flag-size';
        img.addEventListener('error', () => img.replaceWith(blank()), { once: true });
        img.src = r.d;
        slot.replaceWith(img);
        // An icon that wouldn't show on the row (a black logo on the dark theme) gets a small plate.
        iconLook(r.d).then(look => {
            if (!img.isConnected) return;
            const surface = surfaceColor(img.parentElement);
            const plate = contrastingBackground(look, surface, [iconTintOver(look && look.tint, !isDarkRgb(surface)), ICON_MID_GREY]);
            if (plate !== surface) { img.classList.add('unshortener-icon-plate'); img.style.backgroundColor = cssRgb(plate); }
        });
    });
}
// The sender's picture in an inbox row: a circle over the row's checkbox (as Gmail's own avatars and
// Simplify Gmail draw it). kind 'photo' or 'logo' fills the circle; 'icon' (a site's small icon) sits
// in the middle of a plain circle. It never takes clicks, and it steps aside while the row is under
// the mouse, focused or ticked, so the checkbox is there to use.
function placeRowAvatar(wrap, url, kind = 'logo', fallback = '') {
    const row0 = MAIL && MAIL.list && MAIL.list.checkbox ? wrap.closest(MAIL.list.row) : null;
    if (row0 && kind === 'initial') {
        row0.querySelectorAll('.unshortener-row-avatar').forEach(e => e.remove());
        const box = row0.querySelector(MAIL.list.checkbox);
        const letter = senderInitial(wrap.dataset.name, wrap.dataset.address);
        if (!box || !box.parentElement || !letter) { delete row0.dataset.unshortenerAvatar; return; }
        box.parentElement.classList.add('unshortener-avatar-cell');
        row0.classList.add('unshortener-avatar-row');
        const el = document.createElement('span');
        el.className = 'unshortener-row-avatar unshortener-row-initial';
        el.dataset.kind = 'initial';
        el.setAttribute('aria-hidden', 'true');
        el.textContent = letter;
        el.style.backgroundColor = initialColor(wrap.dataset.address);
        box.parentElement.appendChild(el);
        row0.dataset.unshortenerAvatar = '1';
        return;
    }
    const row = MAIL && MAIL.list && MAIL.list.checkbox ? wrap.closest(MAIL.list.row) : null;
    if (!row) return;
    row.querySelectorAll('.unshortener-row-avatar').forEach(e => e.remove());
    const box = url ? row.querySelector(MAIL.list.checkbox) : null;
    if (!box || !box.parentElement) { delete row.dataset.unshortenerAvatar; return; }
    const cell = box.parentElement;
    cell.classList.add('unshortener-avatar-cell');
    row.classList.add('unshortener-avatar-row');
    const img = document.createElement('img');
    img.className = 'unshortener-row-avatar' + (kind === 'icon' ? ' unshortener-row-icon' : '');
    img.dataset.kind = kind;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    // A logo that won't load (its server is down, or the page refuses it): the site's icon instead.
    img.addEventListener('error', () => { img.remove(); delete row.dataset.unshortenerAvatar; placeRowAvatar(wrap, fallback, fallback ? 'icon' : 'initial'); }, { once: true });
    if (/^https:/i.test(url)) img.referrerPolicy = 'no-referrer';
    img.src = url;
    cell.appendChild(img);
    row.dataset.unshortenerAvatar = '1';
    // A site's icon sits on a soft tint of its own main color (light or dark to suit the theme)
    // instead of a white disc, so the circles look alike and the icon doesn't get lost; on the other
    // one when the icon wouldn't show on it (a black logo on the dark theme). A logo with see-through
    // parts gets a dark circle instead of white when it's white itself.
    // It's drawn as large as fits (shared.js iconFillScale), since site icons often carry their own
    // empty margins: a round logo fills the circle, a solid square one fills it edge to edge.
    if (kind === 'icon') iconLook(url).then(async look => {
        if (!img.isConnected) return;
        img.style.backgroundColor = cssRgb(iconCircleColor(look, isDarkSurface(row)));
        const fitted = await fittedIcon(url, iconFillScale(look));
        if (fitted && img.isConnected && img.src === url) { img.src = fitted; img.classList.add('unshortener-row-icon-fitted'); }
    });
    else if (kind === 'logo') iconLook(url).then(look => {
        const bg = contrastingBackground(look, ICON_SURFACE.light, [[60, 64, 67], ICON_MID_GREY]);
        if (img.isConnected && bg !== ICON_SURFACE.light) img.style.backgroundColor = cssRgb(bg);
    });
}

// How an icon looks (shared.js iconPixelLook: its main color, see-through parts, outline), read from
// a 32 px copy; null when it can't be read. Only pictures the extension holds (data: URLs) are read:
// a logo on another server is never fetched again for this. Remembered per icon for the page.
const iconLooks = new Map();
function iconLook(url) {
    if (!/^data:image\//i.test(url || '')) return Promise.resolve(null);
    if (iconLooks.has(url)) return iconLooks.get(url);
    const p = new Promise(resolve => {
        const im = new Image();
        im.onload = () => {
            try {
                const size = 32, c = document.createElement('canvas');
                c.width = c.height = size;
                const g = c.getContext('2d', { willReadFrequently: true });
                g.drawImage(im, 0, 0, size, size);
                resolve(iconPixelLook(g.getImageData(0, 0, size, size).data, size));
            } catch (e) { resolve(null); }
        };
        im.onerror = () => resolve(null);
        im.src = url;
    });
    if (iconLooks.size > 500) iconLooks.delete(iconLooks.keys().next().value);
    iconLooks.set(url, p);
    return p;
}

// A site's icon redrawn at `scale` times the circle's width, centred on a square twice the largest
// circle's size (sharp on high-density screens); the circle crops what reaches past it. null when the
// icon can't be drawn. Remembered per icon and size for the page.
const fittedIcons = new Map();
function fittedIcon(url, scale) {
    if (!scale || !/^data:image\//i.test(url || '')) return Promise.resolve(null);
    const key = scale.toFixed(3) + '|' + url;
    if (fittedIcons.has(key)) return fittedIcons.get(key);
    const p = new Promise(resolve => {
        const im = new Image();
        im.onload = () => {
            try {
                const box = 72, side = box * scale, c = document.createElement('canvas');
                c.width = c.height = box;
                const g = c.getContext('2d');
                g.imageSmoothingQuality = 'high';
                g.drawImage(im, (box - side) / 2, (box - side) / 2, side, side);
                resolve(c.toDataURL('image/png'));
            } catch (e) { resolve(null); }
        };
        im.onerror = () => resolve(null);
        im.src = url;
    });
    if (fittedIcons.size > 300) fittedIcons.delete(fittedIcons.keys().next().value);
    fittedIcons.set(key, p);
    return p;
}

// Photos and logos (the profile's message.avatar): the picture the webmail shows beside the sender of
// an opened email is remembered, so the inbox list shows it too. Whose picture is used:
//   - your own organization: each colleague's own photo (kept per address); never the company logo;
//   - another company: one logo for the whole company (kept per site), shown for every address there,
//     people included. It is learned only from an email that passed the webmail's sender verification
//     (DMARC) and was sent either from one of the company's shared mailboxes (contact@, info@,
//     support@, news@… whose picture the company itself chose) or with a logo the webmail embedded
//     in the page (Gmail writes verified BIMI logos in as data: images). A person's own photo there
//     (bob@company) is never used: the company's logo is shown for them instead;
//   - personal email services (gmail.com, outlook.com…): nothing; the site icon is shown.
// So a company's logo needs one opened email from it, not one per sender. Embedded logos are stored
// directly (a change is spotted by a fingerprint); pictures from the webmail's photo host are
// downloaded by the background part (which the page's own image-loading rules don't affect).
// The picture sits beside the message body, not inside it, so it is looked for in the whole message
// (message.avatar.scope). The webmail fills it in late, so it's looked for again after 0.5, 1.5 and
// 3 s. A changed picture replaces the old one and every icon it belongs to on the page is redrawn.
// Why a picture wasn't used is logged once per sender on the page (Logging → application log), with
// the image's host and kind but never its full address.
const avatarSkipLogged = new Set();
function logAvatarSkip(address, why) {
    if (avatarSkipLogged.has(address)) return;
    avatarSkipLogged.add(address);
    if (avatarSkipLogged.size > 500) avatarSkipLogged.delete(avatarSkipLogged.values().next().value);
    reportEvent('info', `Sender photo or logo for ${address} not used: ${why}`);
}
// The sender's picture in the message the body belongs to: the message itself (scope), else up to four
// levels out from the body's own box until one shows a picture for that address.
function avatarImagesFor(body, A, address) {
    const scope = A.scope ? body.closest(A.scope) : null;
    let box = scope || messageContainerOf(body), all = [];
    for (let i = 0; box && i < (scope ? 1 : 5); i++, box = box.parentElement) {
        // Never a picture inside the email itself: only the webmail's own ones count.
        all = [...box.querySelectorAll(A.img)].filter(el => !el.closest(SITE.body));
        const img = all.find(el => (el.getAttribute(A.addressAttr) || '').trim().toLowerCase() === address);
        if (img) return { img, count: all.length };
        if (box === document.body) break;
    }
    return { img: null, count: all.length };
}
// Colleagues' photos from anywhere the webmail shows them, without opening their emails: hover
// cards, the chat panel, recipient chips and opened emails mark them the same way (message.avatar.img,
// whose addressAttr is the address). Only addresses of the user's own organization, only from the
// webmail's profile-photo host, never from inside an email. Looked at on each 3-second check while
// the tab is shown; each picture is sent to the background once per page.
const pagePhotosSeen = new Set();
function harvestPagePhotos(S) {
    const A = MAIL_CAN.avatars ? MAIL.message.avatar : null;
    const org = ownOrgDomain();
    if (!A || !org || !S.enableSenderAvatars || !S.enableSenderIdentity || !S.enableDnsThreatCheck) return;
    for (const img of document.querySelectorAll(A.img)) {
        const address = (img.getAttribute(A.addressAttr) || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+$/.test(address)) continue;
        const domain = domainOfAddress(address);
        if (!domain || !(domain === org || domain.endsWith('.' + org))) continue;
        const url = img.getAttribute('src') || '';
        if (!A.photoHost.test(url) || A.placeholder.test(url) || img.closest(SITE.body)) continue;
        const key = address + '|' + url;
        if (pagePhotosSeen.has(key)) continue;
        pagePhotosSeen.add(key);
        if (pagePhotosSeen.size > 2000) pagePhotosSeen.delete(pagePhotosSeen.values().next().value);
        safeSend({ action: 'senderAvatar', address, url, kind: 'personal' }, (r) => guarded('Showing a sender photo', () => {
            if (r !== 'saved' && r !== 'updated') return;
            for (const k of [...senderIcons.keys()]) if (k.endsWith('|' + address)) senderIcons.delete(k);
            document.querySelectorAll('.unshortener-sender-icon').forEach(w => { if (w.dataset.address === address) fillSenderIcon(w, lastSettings); });
        }));
    }
}
function harvestAvatar(body, who, auth) {
    const A = MAIL_CAN.avatars ? MAIL.message.avatar : null;
    if (!A || !lastSettings.enableSenderAvatars || !who || !who.address) return;
    const org = ownOrgDomain();
    const own = !!org && (who.domain === org || who.domain.endsWith('.' + org));
    if (!own && isPersonalMailDomain(registrableDomain(who.domain) || who.domain)) {
        logAvatarSkip(who.address, 'it\'s a personal email service; its site icon is shown.');
        return;
    }
    const attempt = (n) => {
        const { img, count } = avatarImagesFor(body, A, who.address);
        const url = img ? (img.getAttribute('src') || img.currentSrc || '') : '';
        const embedded = !!url && !!A.embeddedLogo && A.embeddedLogo.test(url);
        const photo = !!url && !!A.photoHost && A.photoHost.test(url);
        if (!url || !(embedded || photo) || A.placeholder.test(url)) {
            if (n < 3) { setTimeout(() => guarded('Reading a sender photo', () => attempt(n + 1)), [500, 1500, 3000][n]); return; }
            let host = '';
            try { host = url && !url.startsWith('data:') ? new URL(url, location.href).hostname : ''; } catch (e) { /* ignore */ }
            logAvatarSkip(who.address, !img ? (count ? `${SITE.name} showed ${count} photo${count === 1 ? '' : 's'} in the email, none marked as this sender's.` : `${SITE.name} showed no photo or logo beside the sender.`)
                : !url ? 'the image had no address yet.'
                : A.placeholder.test(url) ? `${SITE.name} showed its generic placeholder (no photo).`
                : url.startsWith('data:') ? 'it\'s an image embedded in the page, of a type that isn\'t used.'
                : `the image comes from ${host || 'an unknown host'}, not ${SITE.name}'s own image host.`);
            return;
        }
        const site = registrableDomain(who.domain) || who.domain;
        let request;
        if (own) {
            if (!photo) { logAvatarSkip(who.address, `it's ${org}'s logo; colleagues are shown with their own photos.`); return; }
            request = { action: 'senderAvatar', address: who.address, url, kind: 'personal' };
        } else {
            if (!(auth && auth.dmarc === 'pass')) { logAvatarSkip(who.address, `${SITE.name}'s sender verification for this email was ${auth ? `DMARC ${auth.dmarc}` : 'not available'}; a company's logo is learned only from an email that passed (DMARC).`); return; }
            if (!embedded && !isSharedMailbox(who.address)) { logAvatarSkip(who.address, `it's a person's own photo; ${site}'s logo is shown for them instead once one of its shared mailboxes (contact@, info@, support@…) has been seen.`); return; }
            request = { action: 'senderAvatar', address: who.address, domain: site, url, kind: 'logo' };
        }
        safeSend(request, (r) => guarded('Showing a sender photo', () => {
            if (r !== 'saved' && r !== 'updated') return;
            const mine = (k) => request.kind === 'logo' ? k.startsWith(site + '|') || registrableDomain(k.split('|')[0]) === site : k.endsWith('|' + who.address);
            for (const k of [...senderIcons.keys()]) if (mine(k)) senderIcons.delete(k);
            document.querySelectorAll('.unshortener-sender-icon').forEach(w => {
                if (request.kind === 'logo' ? (registrableDomain(w.dataset.site || '') || w.dataset.site) === site : w.dataset.address === who.address) fillSenderIcon(w, lastSettings);
            });
        }));
    };
    attempt(0);
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
    const mark = chip.querySelector('.unshortener-sender-mark');
    if (mark) mark.textContent = STATUS_MARK[status] || '';
    else chip.dataset.mark = STATUS_MARK[status] || '';
    const lines = [`${STATUS_TEXT[status] || status}: ${address}`];
    if (r) lines.push(...r.reasons);
    if (extra) lines.push(...extra);
    chip.title = lines.join('\n');
    chip.setAttribute('aria-label', lines.join('. '));
}

// The webmail's own address element used as the sender's label (opened emails): our class, colors and
// explanation added, and taken off again exactly (the element itself is the webmail's).
function markAddress(el, dark, address) {
    el.classList.add('unshortener-sender-address');
    el.classList.toggle('unshortener-dark', dark);
    el.setAttribute('role', 'note');
    setChipResult(el, null, address);
    return el;
}
function unmarkAddress(el) {
    el.classList.remove('unshortener-sender-address', 'unshortener-dark');
    for (const a of ['data-status', 'data-mark', 'title', 'aria-label', 'role']) el.removeAttribute(a);
}
function removeSenderDecorations(root = document) {
    root.querySelectorAll('.unshortener-sender-address').forEach(unmarkAddress);
    root.querySelectorAll('.unshortener-sender-icon, .unshortener-sender-chip, .unshortener-row-avatar').forEach(e => e.remove());
    root.querySelectorAll('[data-unshortener-avatar]').forEach(r => { delete r.dataset.unshortenerAvatar; });
    root.querySelectorAll('[data-unshortener-sender]').forEach(e => { delete e.dataset.unshortenerSender; e.unshortenerSpam = null; });
}

// Logs once per email when what's in the email itself (headers, links, attachments, name) changes the
// sender's verdict, so the log says why an email was flagged although its sender looked fine.
function logEmailVerdict(id, address, base, final) {
    if (!final || final.status === base.status || loggedVerdicts.has(`${id}|${final.status}`)) return;
    loggedVerdicts.add(`${id}|${final.status}`);
    if (loggedVerdicts.size > 2000) loggedVerdicts.delete(loggedVerdicts.values().next().value);   // oldest first
    reportEvent(final.status === 'flagged' ? 'warning' : 'info', `Email from ${address}: ${STATUS_TEXT[final.status] || final.status} (the sender alone was ${STATUS_TEXT[base.status] || base.status}). Why: ${final.reasons.join(' ')}`);
}

let lastLocked = {};                       // settings set by the organization (from getSettings)
// --- Inbox list ------------------------------------------------------------------------------------
function scanSenderRows(S) {
    const rows = listRows().filter(isShown);
    if (!rows.length) return;
    const dark = isDarkSurface(rows[0]);
    const pictures = applyPictureMode(S);          // Gmail's density, read once per scan
    const spamFolder = !!S.enableSpamFolderFlags && inSpamView();
    for (const row of rows) {
        const senders = rowSenders(row);
        if (!senders.length) continue;
        const thread = rowThreadKey(row);
        const msgId = rowLastMessageId(row);
        const unread = rowIsUnread(row);
        noteReadState(thread, unread);
        if (S.enableLookalikeCheck) for (const s of senders) if (s.name && isOwnDomain(s.domain, ownOrgDomain())) learnColleagueName(s.name);
        const key = [thread, msgId, unread ? 'u' : 'r', ...senders.map(s => s.raw), S.enableSenderIdentity ? 'id' : '', S.enableSenderCountry ? 'cc' : '', S.enableSenderAvatars ? 'av' : '', pictures, spamFolder ? 'spam' : ''].join('|');
        // Unchanged since the last scan (and Gmail hasn't redrawn the row without our label).
        if (row.dataset.unshortenerSender === key && (!S.enableSenderIdentity || (row.querySelector('.unshortener-sender-chip') && !avatarLost(row)))) continue;
        removeSenderDecorations(row);
        row.dataset.unshortenerSender = key;
        // The sender shown first is the one decorated; a flagged one anywhere in the row wins.
        let icon = null, chip = null;
        if (S.enableSenderIdentity) {
            icon = senderIconEl(senders[0].domain, S, senders[0].address, senders[0].name);
            chip = senderChipEl(senders[0].domain, dark, senders[0].address);
            const nameCell = firstMatch(row, MAIL.list.nameCell);
            const subject = firstMatch(row, MAIL.list.subjectCell);
            if (nameCell) nameCell.insertBefore(icon, nameCell.firstChild);
            if (subject) subject.insertBefore(chip, subject.firstChild);
            // No cells described (the generic profile): the icon before the sender, the label after it.
            if (!nameCell || !subject) {
                const holder = [...row.querySelectorAll(MAIL.list.sender)].find(e => senderOf(e)) || null;
                if (holder && !nameCell) holder.insertAdjacentElement('beforebegin', icon);
                if (holder && !subject) holder.insertAdjacentElement('afterend', chip);
            }
            else if (nameCell) nameCell.insertBefore(chip, icon.nextSibling);
        }
        // A read email's own headers are read (once) for the server's country and signs of forgery; in
        // the Spam folder an unread one's too (unless that turned out to mark emails read).
        const readHeaders = !!msgId && (!unread || (spamFolder && !unreadHeadersOff));
        const infoP = readHeaders ? messageInfo(msgId) : Promise.resolve(null);
        if (readHeaders && unread && thread) infoP.then(info => { if (info && headersFetched.has(msgId)) unreadHeaderReads.set(thread, Date.now()); });
        const subjectText = MAIL.list.subject ? ((firstMatch(row, MAIL.list.subject) || {}).textContent || '') : '';
        const show = (results, info, ours, owns) => guarded('Showing who sent an email', () => {
            if (!row.isConnected || row.dataset.unshortenerSender !== key) return;
            // Signs in this email: the names shown, and the headers when they belong to the last sender.
            const org = ownOrgDomain();
            const finals = results.map((r, k) => {
                const signals = displayNameAnomalies(senders[k].name);
                // The name doesn't belong with the address (a brand's name, or a colleague's, outside).
                if (S.enableLookalikeCheck && r && r.status !== 'trusted') signals.push(...nameAddressSigns(senders[k].name, senders[k].address, org, loadColleagueHashes(), owns && owns[k]));
                // The name is the user's own address or mailbox name, on someone else's address.
                if (S.enableOwnNameCheck && r && r.status !== 'trusted') signals.push(...ownNameSigns(senders[k].name, senders[k].address, accountAddress()));
                // A "call this number" subject (whoever sent it).
                if (S.enableCallbackScamCheck && r && r.status !== 'trusted') signals.push(...subjectScamSigns(subjectText));
                if (info && info.fh === addressFingerprint(senders[k].address)) signals.push(...info.an);
                const f = applyEmailSignals(r, signals);
                if (r && f) logEmailVerdict(`${thread}|${senders[k].address}`, senders[k].address, r, f);
                return f;
            });
            let i = 0;
            finals.forEach((r, k) => { if (r && (STATUS_RANK[r.status] || 0) > (STATUS_RANK[finals[i] ? finals[i].status : 'pending'] || 0)) i = k; });
            let r = finals[i], extra = null;
            const who = senders[i];
            // Spam folder: red for what the checks flag and for what the extension moved there (with why);
            // anything else was put there by Gmail or the user, and says so.
            if (spamFolder && r) {
                if (ours) r = Object.assign({}, r, { status: 'flagged', reasons: [spamMovedText(ours), ...r.reasons] });
                else if (r.status !== 'flagged') extra = [SPAM_NOT_FLAGGED_NOTE];
            }
            if (chip) {
                chip.querySelector('.unshortener-sender-domain').textContent = siteOfSender(who.domain);
                setChipResult(chip, r, who.address, extra);
            }
            if (icon && S.enableSenderCountry && r) {
                const own = info && info.fh === addressFingerprint(senders[0].address) ? info : null;
                setSenderFlag(icon, results[0] && results[0].country, results[0] && results[0].countrySource);
                if (own && S.enableDnsThreatCheck) serverCountry(own).then(c => { if (c && row.dataset.unshortenerSender === key) setSenderFlag(icon, c, 'server'); });
            }
            // Moved only when every sender shown is flagged: one flagged reply in a genuine conversation
            // must not send everyone's messages to Spam.
            // The verdict stays on the row, so the monitor can queue it again if it had to wait.
            row.unshortenerSpam = finals.length && finals.every(x => x && x.move) && thread
                ? { kind: 'row', address: senders[0].address, reason: finals[0].reasons.join(' '), msgId, unread, how: isSearchView(location.hash, MAIL.views) ? 'automatically, from search results' : 'automatically, from the inbox list' } : null;
            if (row.unshortenerSpam && S.enableAutoSpam) queueSpamMove(thread, row.unshortenerSpam);
        });
        Promise.all([senderResultsFor(senders.map(s => s.raw)), spamFolder ? spamMovedReasons() : null, ownershipsFor(senders, S)]).then(([results, moved, owns]) => {
            const ours = moved && thread ? moved.get(thread) : null;
            show(results, null, ours, owns);
            infoP.then(info => { if (info) show(results, info, ours, owns); });
        });
    }
    scheduleGuardSync();        // rows the webmail redrew for another conversation lose a stale guard
}

// --- Spam folder -----------------------------------------------------------------------------------
const SPAM_NOT_FLAGGED_NOTE = 'Checked: none of this extension\'s checks flag it (that doesn\'t prove it\'s safe). Gmail put it in Spam, or you did.';
function spamMovedText(m) {
    const when = m.ts ? ` on ${new Date(m.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
    return `This extension moved it to Spam${when}.${m.reason ? ` Why: ${m.reason}` : ''}`;
}
// The conversations the extension moved to Spam (and the user hasn't taken out since), with why: the
// move log keeps the reason. Read once, again when they change.
let spamMovedInfo = null;
function spamMovedReasons() {
    if (!spamMovedInfo) spamMovedInfo = new Promise(resolve => {
        try {
            chrome.storage.local.get({ spamMovedThreads: {}, spamRescuedThreads: {}, spamMoveLog: [] }, (st) => {
                const map = new Map();
                if (chrome.runtime.lastError || !st) return resolve(map);
                const why = new Map();
                for (const e of Array.isArray(st.spamMoveLog) ? st.spamMoveLog : []) if (e && e.action === 'moved' && e.thread && !why.has(e.thread)) why.set(e.thread, e.reason || '');
                const rescued = st.spamRescuedThreads || {};
                for (const [thread, ts] of Object.entries(st.spamMovedThreads || {})) if (!(rescued[thread] > ts)) map.set(thread, { ts, reason: why.get(thread) || '' });
                resolve(map);
            });
        } catch (e) { resolve(new Map()); }
    });
    return spamMovedInfo;
}
// Reading an unread email's headers must never mark it read, and Gmail doesn't document whether its
// original-message page does. So this watches: an email whose headers were read while unread that then
// turns read without being opened means it does, and unread emails' headers aren't read any more (until
// the Spam folder setting is turned off and on again).
const unreadHeaderReads = new Map();          // conversation → when its headers were read while unread
const headersFetched = new Set();              // message ids whose headers were downloaded (not cached)
const openedThreads = new Set();               // conversations opened in this page
let unreadHeadersOff = false;
try { chrome.storage.local.get({ spamUnreadHeadersOff: 0 }, r => { unreadHeadersOff = !!(r && r.spamUnreadHeadersOff); }); } catch (e) { /* extension reloaded */ }
function noteReadState(thread, unread) {
    if (unread || !thread || !unreadHeaderReads.has(thread)) return;
    const at = unreadHeaderReads.get(thread);
    unreadHeaderReads.delete(thread);
    if (unreadHeadersOff || openedThreads.has(thread) || currentThreadKey() === thread || Date.now() - at > 10 * 60e3) return;
    unreadHeadersOff = true;
    try { chrome.storage.local.set({ spamUnreadHeadersOff: Date.now() }); } catch (e) { /* extension reloaded */ }
    reportEvent('warning', 'An email in Spam turned read after its headers were read, without being opened, so the extension no longer reads the headers of unread emails in Spam: they are checked from their sender until opened, as in the inbox. To try again, turn Settings → Senders → "Flag dangerous emails in the Spam folder" off and on.');
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
    const msg = messageContainerOf(body);
    if (msg) {
        if (msg.querySelector('.unshortener-qr-bar[data-severity="danger"]')) out.push({ weight: 5, text: 'It has an attachment flagged as dangerous.' });
        const noname = findAttachments().filter(a => msg.contains(a.el) && /^noname(\.[a-z0-9]{1,5})?$/i.test(String(a.name || '').trim()));
        if (noname.length) out.push({ weight: 2, text: 'It has an attachment without a name (“noname”), which genuine mail programs rarely send.' });
    }
    return out;
}

// The text the webmail shows around an opened email, without the body (written by the sender) and
// without the extension's own additions: where the webmail puts its own warnings about the sender.
function webmailTextAround(body) {
    const container = messageContainerOf(body);
    if (!container) return '';
    let text = '';
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (body.contains(n) || (n.parentElement && n.parentElement.closest('[class*="unshortener-"]'))) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    for (let n = walker.nextNode(); n && text.length < 6000; n = walker.nextNode()) {
        const t = n.nodeValue.trim();
        if (t) text += t + '\n';
    }
    return text;
}

// The opened email's own verdict from its sender, its headers, its name, its content and the webmail's
// own warnings about the sender; drawn on its label and in its banner, and queued for Spam when flagged.
function updateOpenedVerdict(body) {
    const st = openedStates.get(body);
    if (!st || !st.base || !st.nameEl.isConnected) return;
    const signals = [...displayNameAnomalies(st.name), ...(st.info && st.info.fh === addressFingerprint(st.address) ? st.info.an : []), ...emailContentSignals(body),
                     ...serviceWarningSigns(webmailTextAround(body), SITE.name),
                     ...(lastSettings.enableLookalikeCheck !== false && st.base.status !== 'trusted' ? nameAddressSigns(st.name, st.address, ownOrgDomain(), loadColleagueHashes(), st.ownership) : []),
                     ...(lastSettings.enableOwnNameCheck !== false && st.base.status !== 'trusted' ? ownNameSigns(st.name, st.address, accountAddress()) : []),
                     ...(lastSettings.enableCallbackScamCheck !== false && st.base.status !== 'trusted' ? [...subjectScamSigns(openedSubject()), ...bodyScamSigns(body.innerText)] : [])];
    const final = applyEmailSignals(st.base, signals);
    st.final = final;
    logEmailVerdict(st.msgId || st.address, st.address, st.base, final);
    if (st.chip) {
        setChipResult(st.chip, final, st.address, st.authLine);
        // A label of our own spells out the status; the webmail's address shows it by its mark and colors.
        const domainEl = st.chip.querySelector('.unshortener-sender-domain');
        if (domainEl) domainEl.textContent = STATUS_SHOWN.has(final.status) ? `${siteOfSender(st.domain)} · ${STATUS_TEXT[final.status]}` : siteOfSender(st.domain);
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

// The opened conversation's subject, where the webmail's entry says where it is.
function openedSubject() {
    const el = MAIL.message && MAIL.message.subject ? [...document.querySelectorAll(MAIL.message.subject)].find(isShown) : null;
    return el ? el.textContent : '';
}

function scanOpenedSenders(S) {
    if (!MAIL_CAN.opened) return;
    const open = currentThreadKey();
    if (open) openedThreads.add(open);
    for (const body of inBodies('')) {               // training emails are never in this list (phishSimGate)
        if (!isShown(body)) continue;
        const found = openedSenderElement(body);
        const nameEl = found && found.el;
        if (!nameEl) continue;
        const who = senderOf(nameEl);
        if (!who || who.address === accountAddress()) continue;
        const key = `${who.raw}|${S.enableSenderIdentity ? 'id' : ''}|${S.enableSenderCountry ? 'cc' : ''}`;
        const holder = nameEl.parentElement;
        if (nameEl.dataset.unshortenerSender === key && (!S.enableSenderIdentity || !holder || holder.querySelector('.unshortener-sender-chip, .unshortener-sender-address'))) continue;
        if (holder) { holder.querySelectorAll('.unshortener-sender-icon, .unshortener-sender-chip').forEach(e => e.remove()); holder.querySelectorAll('.unshortener-sender-address').forEach(unmarkAddress); }
        nameEl.dataset.unshortenerSender = key;
        let icon = null, chip = null;
        if (S.enableSenderIdentity && holder) {
            icon = senderIconEl(who.domain, S, who.address);
            nameEl.insertAdjacentElement('beforebegin', icon);
            // The webmail's own "<address>" beside the sender's name carries the label (its colors and
            // explanation), so no extra label is drawn there; elsewhere a label goes after the name.
            const addressEl = MAIL.message.senderAfter && holder.querySelector(MAIL.message.senderAfter);
            if (addressEl) chip = markAddress(addressEl, isDarkSurface(nameEl), who.address);
            else {
                chip = senderChipEl(who.domain, isDarkSurface(nameEl), who.address);
                chip.style.marginLeft = '6px';
                nameEl.insertAdjacentElement('afterend', chip);
            }
        }
        const msgId = messageIdOf(body);
        const st = { nameEl, chip, icon, address: who.address, domain: who.domain, name: who.name, msgId, thread: currentThreadKey(), base: null, info: null, authLine: [], ownership: null };
        openedStates.set(body, st);
        Promise.all([senderResultsFor([who.raw]), messageInfo(msgId), getMessageAuth(body), ownershipsFor([who], S)]).then(([[r], info, auth, [owned]]) => guarded('Showing who sent an email', () => {
            if (!nameEl.isConnected || nameEl.dataset.unshortenerSender !== key || !r || openedStates.get(body) !== st) return;
            st.base = r;
            st.info = info;
            st.ownership = owned;
            harvestAvatar(body, who, auth);
            st.authLine = auth ? [`${SITE.name}'s sender verification: DMARC ${auth.dmarc}, SPF ${auth.spf}, DKIM ${auth.dkim}.`] : [];
            if (icon && S.enableSenderCountry) {
                setSenderFlag(icon, r.country, r.countrySource);
                if (S.enableDnsThreatCheck && info && info.fh === addressFingerprint(who.address)) serverCountry(info).then(c => { if (c && nameEl.dataset.unshortenerSender === key) setSenderFlag(icon, c, 'server'); });
            }
            updateOpenedVerdict(body);
        }));
    }
}

// --- Row highlighter ------------------------------------------------------------------------------
// The inbox row under the mouse, and selected rows, get a see-through color (light or dark theme
// variant, so text keeps its contrast) and/or an outline, so it's clear which email a click opens.
// One style element, rebuilt only when the settings or the theme change. Works on every site whose
// profile describes its inbox list (the generic one included).
let rowHighlightKey = '';
function applyRowHighlighter(S) {
    const id = 'unshortener-row-highlight';
    let el = document.getElementById(id);
    const on = MAIL_CAN.list && S.enableRowHighlighter !== false && !(SITE.settingKey && S[SITE.settingKey] === false);
    if (!on) { if (el) el.remove(); rowHighlightKey = ''; return; }
    const sample = listRows().find(isShown);
    if (!sample) return;                                            // no list on screen yet
    const dark = isDarkSurface(sample);
    const style = ['both', 'fill', 'outline'].includes(S.rowHighlightStyle) ? S.rowHighlightStyle : 'both';
    const key = [MAIL.list.row, dark, S.rowHighlightColor, S.rowHighlightSelectedColor, style, S.rowHighlightSelected !== false].join('|');
    if (el && rowHighlightKey === key) return;
    const rows = MAIL.list.row.split(',').map(r => r.trim());
    const selectedMark = MAIL.list.selected || '[aria-selected="true"]';
    const css = [];
    // Ticked rows first, in their own color; then the row under the mouse, which wins when it is
    // ticked too (same specificity, later rule).
    const paint = (states, color) => {
        const c = ROW_HIGHLIGHT_COLORS[color] || ROW_HIGHLIGHT_COLORS.yellow;
        const fill = dark ? c.dark : c.light, accent = dark ? c.accentDark : c.accent;
        if (style !== 'outline') {
            // An overlay (background-image) over the row's own background, on the row and its cells.
            css.push(`${states.join(', ')}, ${states.map(st => `${st} > td`).join(', ')} { background-image: linear-gradient(${fill}, ${fill}) !important; }`);
        }
        if (style !== 'fill') {
            css.push(`${states.join(', ')} { outline: 2px solid ${accent} !important; outline-offset: -2px !important; }`);
            css.push(`${states.map(st => `${st} > td:first-child`).join(', ')} { box-shadow: inset 4px 0 0 ${accent} !important; }`);
        }
    };
    if (S.rowHighlightSelected !== false) paint(rows.map(r => `${r}${selectedMark}`), S.rowHighlightSelectedColor || 'blue');
    paint(rows.map(r => `${r}:hover`), S.rowHighlightColor);
    if (!el) { el = document.createElement('style'); el.id = id; (document.head || document.documentElement).appendChild(el); }
    el.textContent = css.join('\n');
    rowHighlightKey = key;
}

// --- Other extensions that do the same job ---------------------------------------------------------
// Found from what they add to the page: their own resources (a "chrome-extension://<id>/…" image or
// stylesheet, which names the extension; matched against OVERLAPPING_EXTENSIONS) and their effects
// (sender icons or photos in inbox rows that aren't ours). Each one found is reported to the
// background (shown in Settings → Other extensions), and a notice offers the fixes: turn the other
// one off (recommended: ours also checks senders for phishing), turn our matching feature off, or
// ignore it. Never when an administrator switched these warnings off, for features already off, for
// ones the user ignored, or more than once per page.
const FAVICON_SERVICES = /\/\/(www\.google\.com\/s2\/favicons|t\d\.gstatic\.com\/faviconV2|icons\.duckduckgo\.com|logo\.clearbit\.com|favicone\.com|icon\.horse)/i;
const PHOTO_SERVICES = /\/\/([^/]*\.googleusercontent\.com|(www\.|secure\.)?gravatar\.com)\//i;
let conflictsCheckedAt = 0;
const conflictsShown = new Set();
function detectConflicts(S) {
    if (!S.enableConflictWarnings || Date.now() - conflictsCheckedAt < 20000) return;
    conflictsCheckedAt = Date.now();
    const found = new Map();                                          // key → { key, name, does, features, via }
    const ownId = chrome.runtime.id;
    // 1. Resources another extension added to the page.
    const urls = [...document.querySelectorAll('[src*="-extension://"], [href*="-extension://"]')].map(e => e.getAttribute('src') || e.getAttribute('href') || '');
    for (const sh of document.styleSheets) { try { if (sh.href) urls.push(sh.href); } catch (e) { /* ignore */ } }
    for (const u of urls) {
        const m = /^(?:chrome|moz)-extension:\/\/([^/]+)\//i.exec(u);
        if (!m || m[1] === ownId) continue;
        const known = OVERLAPPING_EXTENSIONS.find(x => x.ids.includes(m[1]));
        if (known) found.set(known.ids[0], { key: known.ids[0], name: known.name, does: known.does, features: known.features, via: 'page' });
    }
    // 2. Effects in the inbox list: sender icons or photos that aren't ours.
    if (MAIL_CAN.list) {
        // Only the sender's cell: the webmail's own pictures elsewhere in a row (attachment
        // thumbnails) aren't an extension's.
        const rows = listRows().filter(isShown).slice(0, 30);
        const cellSel = MAIL.list.nameCell ? MAIL.list.nameCell.split(',').map(c => `${c.trim()} img`).join(', ') : null;
        const foreign = (re) => !!cellSel && rows.some(r => [...r.querySelectorAll(cellSel)].some(i => !i.closest('[class*="unshortener-"]') && re.test(i.getAttribute('src') || '')));
        if (S.enableSenderIdentity && foreign(FAVICON_SERVICES) && ![...found.values()].some(f => f.features.includes('enableSenderIdentity')))
            found.set('effect:icons', { key: 'effect:icons', name: 'Another extension', does: 'sender icons in the inbox', features: ['enableSenderIdentity'], via: 'effect' });
        if (S.enableSenderAvatars && foreign(PHOTO_SERVICES) && ![...found.values()].some(f => f.features.includes('enableSenderAvatars')))
            found.set('effect:photos', { key: 'effect:photos', name: 'Another extension', does: 'sender photos in the inbox', features: ['enableSenderAvatars'], via: 'effect' });
    }
    if (!found.size) return;
    // Only conflicts with features of ours that are on.
    const live = [...found.values()].map(f => Object.assign({}, f, { features: f.features.filter(k => S[k] !== false) })).filter(f => f.features.length);
    if (!live.length) return;
    safeSend({ action: 'reportConflicts', site: SITE.name, conflicts: live }, (ignored) => guarded('Warning about other extensions', () => {
        const skip = new Set(Array.isArray(ignored) ? ignored : []);
        const next = live.find(f => !skip.has(f.key) && !conflictsShown.has(f.key));
        if (next) showConflictNotice(next);
    }));
}

function showConflictNotice(c) {
    conflictsShown.add(c.key);
    document.querySelectorAll('.unshortener-conflict-notice').forEach(e => e.remove());
    const el = document.createElement('div');
    el.className = 'unshortener-conflict-notice' + (isDarkSurface(document.body) ? ' unshortener-dark' : '');
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-label', 'Another extension does the same job');
    const ours = c.features.map(k => FEATURE_NAMES[k] || k);
    const text = document.createElement('div');
    const lead = document.createElement('b');
    lead.textContent = c.via === 'effect' ? `Another extension also shows ${c.does}.` : `${c.name} also does ${c.does}.`;
    text.append(lead, ` Two extensions doing the same job in ${SITE.name} can conflict (doubled icons, flicker, a slower page). We recommend keeping S.P.R.U.C.E+ on, since it also checks these senders for phishing, and turning the other one off.`);
    const buttons = document.createElement('div');
    buttons.className = 'unshortener-conflict-buttons';
    const btn = (label, primary, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (primary) b.className = 'primary'; b.addEventListener('click', () => guarded('Resolving an extension conflict', fn)); buttons.appendChild(b); return b; };
    btn(c.via === 'effect' ? 'Turn the other one off…' : `Turn off ${c.name}…`, true, () => { safeSend({ action: 'openConflicts' }); el.remove(); });
    // Only the overlapping settings of ours, one at a time or all; the ones left on are remembered as
    // kept, so this warning comes back only if one turned off here is turned back on.
    const other = c.name === 'Another extension' ? 'another extension' : c.name;
    const offButton = (keys, label) => {
        const b = btn(label, false, () => {
            turnOffForConflict(c.key, c.features, keys, lastLocked, (done) => {
                if (done.length) reportEvent('info', `Turned off our ${done.map(k => FEATURE_NAMES[k] || k).join(' and ')} because ${other} does the same job.`);
            });
            el.remove();
        });
        if (keys.every(k => lastLocked[k])) { b.disabled = true; b.title = 'Set by your organization'; }
    };
    if (c.features.length > 1) c.features.forEach(k => offButton([k], `Turn off only our ${FEATURE_NAMES[k] || k}`));
    offButton(c.features, c.features.length > 1 ? 'Turn off all of ours' : `Turn off ours (${ours.join(', ')})`);
    btn('Ignore', false, () => { safeSend({ action: 'ignoreConflict', key: c.key }); el.remove(); });
    el.append(text, buttons);
    document.body.appendChild(el);
}

// --- Moving to Spam --------------------------------------------------------------------------------
function queueSpamMove(thread, item) {
    if (!MAIL_CAN.move || !thread || spamAttempted.has(thread) || spamQueue.has(thread)) return;
    spamQueue.set(thread, Object.assign({}, item, { since: Date.now() }));
    publishBusy();
    scheduleGuardSync();
    scheduleSpamMoves();
}
function scheduleSpamMoves(delay = 800) {
    clearTimeout(spamMoveTimer);
    spamMoveTimer = setTimeout(() => {
        spamMoveTimer = null;
        runSpamMoves().catch(e => {
            spamMoveRunning = 0;
            reportEvent('error', `Moving emails to Spam failed: ${e && e.message ? e.message : e}`);
        });
    }, Math.max(delay, spamPausedUntil - Date.now()));
}

// A message to the background that answers null if it takes too long (the background was restarted,
// or the extension updated): moving waits and tries again instead of hanging.
function sendWithTimeout(message, ms = 8000) {
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), ms);
        safeSend(message, (r) => { clearTimeout(timer); resolve(r); });
    });
}

// The monitor: every few seconds while the webmail is shown, flagged rows still in the inbox are queued again,
// a pass that never finished is abandoned, and waiting moves are retried. Moving never switches itself
// off; after repeated failures it only pauses, for longer each time.
function spamMonitor() {
    if (!MAIL_CAN.move || document.hidden || !lastSettings.enableAutoSpam || !senderFeaturesOn(lastSettings)) return;
    if (spamMoveRunning && Date.now() - spamMoveRunning > SPAM_RUN_TIMEOUT_MS) {
        spamMoveRunning = 0;
        reportEvent('warning', `Moving emails to Spam had stalled (${SITE.name} or the extension didn't answer); it was restarted.`);
    }
    let unchecked = false;
    for (const row of listRows()) {
        if (!isShown(row)) continue;
        // Shown but never looked at: the list was hidden when it was scanned and came back without
        // the webmail changing its contents (nothing for the page observer to see), so scan again.
        if (!row.dataset.unshortenerSender) { unchecked = true; continue; }
        if (!row.unshortenerSpam) continue;
        const thread = rowThreadKey(row);
        if (thread) queueSpamMove(thread, row.unshortenerSpam);
    }
    if (unchecked) scheduleScan();
    syncMoveGuards();
    if (spamQueue.size && !spamMoveRunning && !spamMoveTimer) scheduleSpamMoves();
}
// Runs only while the webmail's tab is shown: stopped while it's in the background, so it never wakes the
// computer for nothing (a background tab can't move emails anyway).
let spamMonitorTimer = null;
function setSpamMonitor() {
    const on = MAIL_CAN.move && !document.hidden;
    if (on && !spamMonitorTimer) spamMonitorTimer = setInterval(() => guarded('Watching moves to Spam', spamMonitor), 5000);
    else if (!on && spamMonitorTimer) { clearInterval(spamMonitorTimer); spamMonitorTimer = null; }
}
setSpamMonitor();
document.addEventListener('visibilitychange', setSpamMonitor);
// What parks a move can end without the page mutating under the observer: the view changes back, the
// tab is shown again. Look right away then (the pass itself re-checks everything before acting);
// a pause after failures still holds, because the scheduler never fires inside it.
if (MAIL_CAN.move) {
    window.addEventListener('hashchange', () => { if (spamQueue.size) scheduleSpamMoves(); scheduleGuardSync(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && spamQueue.size) scheduleSpamMoves(); });
}

// The user's own activity in the webmail, in two tiers. A click or a key is an action: it can have an
// Undo of its own (which a move of ours must not replace) and shows intent, so moving waits
// SPAM_ACTION_QUIET_MS after the last one. The mouse merely moving over the list, or scrolling, is a
// gesture: the one hazard is rows shifting under a pointer in motion, so moving waits only until the
// pointer has been still for SPAM_GESTURE_QUIET_MS. Clicks on the row guard's own buttons don't count
// (pressing "Move now" must not start a quiet period that delays the move it asks for).
const SPAM_ACTION_QUIET_MS = 10000;
const SPAM_GESTURE_QUIET_MS = 2000;
let lastUserAction = 0, lastUserGesture = 0;
function noteUserActivity(e) {
    if (!e.isTrusted) return;                       // our own clicks on the webmail's buttons don't count
    if (e.target && e.target.closest && e.target.closest('.unshortener-move-banner')) return;
    if (e.type === 'pointermove' || e.type === 'wheel') {
        if (e.type === 'pointermove' && !(e.target && e.target.closest && e.target.closest(`[role="main"], ${MAIL.list.row}`))) return;
        lastUserGesture = Date.now();
    } else lastUserAction = Date.now();
}
if (MAIL_CAN.move) for (const t of ['pointerdown', 'keydown', 'wheel', 'pointermove']) document.addEventListener(t, noteUserActivity, { capture: true, passive: true });
function quietRemaining() {
    return Math.max(0, lastUserAction + SPAM_ACTION_QUIET_MS - Date.now(), lastUserGesture + SPAM_GESTURE_QUIET_MS - Date.now());
}

// --- The row guard ---------------------------------------------------------------------------------
// A flagged row waiting to move to Spam says so and can't be clicked by accident: the sender and
// subject are struck through, a small banner explains what will happen (and why it's waiting, when it
// is), and a real click anywhere on the row is swallowed before the webmail sees it (our own synthetic
// clicks aren't trusted events and pass through). The banner's "Move now" moves it without waiting for
// the quiet period — that move is the user's own request; "Keep it" leaves it in the inbox for good
// (the same memory as taking an email back out of Spam). The guard is keyed to the conversation and
// checked against the row on every sync and on every swallowed event, so a row the webmail redraws for
// another conversation is freed at once, never blocked by a stale guard.
let guardSyncTimer = null;
function scheduleGuardSync() {
    if (guardSyncTimer) return;
    guardSyncTimer = setTimeout(() => { guardSyncTimer = null; guarded('Marking rows about to move', syncMoveGuards); }, 50);
}
// Guards only where the mover could act on the list: never with a conversation open beside it (split
// view) or several list sections shown (the mover refuses both, so the guard must not promise a move),
// and never in a view moves aren't made from.
function guardAllowedNow() {
    return !!lastSettings.enableAutoSpam && MAIL_CAN.list && senderFeaturesOn(lastSettings)
        && viewAllowsAutoSpam(location.hash, MAIL.views, lastSettings.enableAutoSpamInSearch !== false)
        && !currentThreadKey()
        && new Set(shownAll(MAIL.list.row).map(r => r.closest(MAIL.list.container || 'table'))).size <= 1;
}
function syncMoveGuards() {
    if (!MAIL_CAN.move || !MAIL_CAN.list) return;
    const allowed = guardAllowedNow();
    for (const row of listRows()) {
        const thread = rowThreadKey(row);
        setRowGuard(row, allowed && thread && spamQueue.has(thread) && row.unshortenerSpam && isShown(row) ? thread : null);
    }
}
function guardWaitText() {
    const wait = document.documentElement.dataset.unshortenerSpamWait || '';
    if (wait === 'recent activity' || wait === 'user busy') return 'Moving to Spam when you pause…';
    if (wait === 'selection') return 'Moving to Spam once nothing is selected…';
    if (wait === 'paused' || wait === 'retrying') return `Moving to Spam (waiting for ${SITE.name})…`;
    return 'Moving to Spam…';
}
function setRowGuard(row, thread) {
    let banner = row.querySelector('.unshortener-move-banner');
    if (!thread) {
        if (banner) banner.remove();
        row.classList.remove('unshortener-moving');
        return;
    }
    row.classList.add('unshortener-moving');
    if (banner && banner.dataset.unshortenerThread !== thread) { banner.remove(); banner = null; }
    if (!banner) {
        banner = document.createElement('span');
        banner.className = 'unshortener-move-banner' + (isDarkSurface(row) ? ' unshortener-dark' : '');
        banner.dataset.unshortenerThread = thread;
        const text = document.createElement('span');
        text.className = 'unshortener-move-text';
        text.setAttribute('role', 'status');
        const btn = (label, aria, fn) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.setAttribute('aria-label', aria);
            b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); guarded(aria, fn); });
            return b;
        };
        banner.append(text,
            btn('Move now', 'Move this email to Spam now', () => moveThreadNow(thread)),
            btn('Keep it', 'Keep this email in the inbox', () => keepThreadInInbox(thread)));
        // Nothing on the banner may reach the webmail's own row handlers (a click would open the email).
        for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick']) banner.addEventListener(t, (e) => e.stopPropagation());
        const cell = firstMatch(row, MAIL.list.subjectCell);
        (cell || row.lastElementChild || row).appendChild(banner);
    }
    const t = banner.querySelector('.unshortener-move-text');
    const want = guardWaitText();
    if (t && t.textContent !== want) t.textContent = want;
}
function moveThreadNow(thread) {
    const it = spamQueue.get(thread);
    if (!it) return;
    it.now = Date.now();
    scheduleSpamMoves(0);
}
function keepThreadInInbox(thread) {
    const it = spamQueue.get(thread) || {};
    spamQueue.delete(thread);
    spamAttempted.add(thread);
    rememberSpamThreads([{ thread, address: it.address || '', reason: it.reason || '', how: 'Keep it, on the row about to move' }], 'kept');
    syncMoveGuards();
    publishBusy();
    scheduleBadgeUpdate();
    reportEvent('info', `An email from ${it.address || 'a flagged sender'} stays in the inbox: you chose Keep it. It will not be moved to Spam.`);
}
// The swallowing itself. Re-checked against the queue first: a row redrawn for another conversation
// frees itself on the very click instead of blocking it.
function onGuardPointer(e) {
    if (!e.isTrusted) return;
    const row = e.target && e.target.closest ? e.target.closest('.unshortener-moving') : null;
    if (!row) return;
    if (e.target.closest('.unshortener-move-banner')) return;         // the banner's own buttons work
    const thread = rowThreadKey(row);
    if (!thread || !spamQueue.has(thread) || !guardAllowedNow()) { setRowGuard(row, null); return; }
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'pointerdown') {                                   // show where the answer is
        const banner = row.querySelector('.unshortener-move-banner');
        if (banner) { banner.classList.remove('unshortener-flash'); void banner.offsetWidth; banner.classList.add('unshortener-flash'); }
    }
}
if (MAIL_CAN.move) for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick']) document.addEventListener(t, onGuardPointer, true);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(test, ms) {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (test()) return true;
    return test();
}
// A click as the webmail's own buttons expect it (some react to the press, not the click).
function press(el) {
    for (const t of ['mouseover', 'mousedown', 'mouseup', 'click']) {
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
    }
}

// The user is typing, has a menu or dialog open, or has selected emails: never act then (selected
// emails would be reported together with ours). Checked again right before every click.
function shownAll(selector) { return [...document.querySelectorAll(selector)].filter(isShown); }
// Selected rows in the list shown. (Gmail keeps lists it showed earlier hidden in the page; a selection
// left there doesn't count, or moving would wait forever.)
function selectedRows() {
    return listRows().filter(r => isShown(r) && rowIsSelected(r));
}
// Each part of the toolbar selector, followed by a descendant selector.
function inToolbar(descendant) { return MAIL.toolbar.split(',').map(t => `${t.trim()} ${descendant}`).join(', '); }
// Anything selected that the toolbar would act on: shown rows, or the toolbar's own select-all box
// (which also covers a selection in a collapsed inbox section).
function anySelection() {
    if (selectedRows().length) return true;
    const all = [...document.querySelectorAll(inToolbar('[role="checkbox"]'))].find(isShown);
    return !!all && /^(true|mixed)$/.test(all.getAttribute('aria-checked') || '');
}
function userBusy() {
    const a = document.activeElement;
    if (a && a !== document.body && (isEditable(a) || /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName))) return true;
    return shownAll('[role="dialog"], [role="alertdialog"], [role="menu"], .unshortener-send-dialog').length > 0;
}

// The webmail's own Report spam button, by its label (several languages), or by the attribute the
// profile names for it (spamAction; Gmail's action number) when its label still says spam in another
// language. Never any other button.
const REPORT_SPAM_LABEL = /^(report spam|spam melden|signaler comme spam|marcar como spam|denunciar spam|segnala come spam|als spam markeren|rapportér spam|rapporter som spam|rapportera som skräppost|zgłoś spam|nahlásit spam|ilmoita roskapostiksi)/i;
const SPAM_WORD = /spam|skräp|迷惑|垃圾|스팸|спам/i;
const UNSUBSCRIBE_LABEL = /unsubscribe|abmelden|abbestellen|désabonner|desuscribir|cancelar (la )?suscripción|annulla iscrizione|uitschrijven|afmeld|avsluta|wypisz/i;
function reportSpamButton() {
    const act = MAIL.spamAction;
    const sel = inToolbar('[role="button"]') + (act ? `, [${act.attr}="${act.value}"][role="button"]` : '');
    for (const b of document.querySelectorAll(sel)) {
        if (!isShown(b) || b.getAttribute('aria-disabled') === 'true' || b.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) continue;
        const label = (b.getAttribute('aria-label') || b.getAttribute('data-tooltip') || '').trim();
        if (REPORT_SPAM_LABEL.test(label) || (act && b.getAttribute(act.attr) === act.value && SPAM_WORD.test(label))) return b;
    }
    return null;
}

// The webmail may ask "Report spam and unsubscribe?" (Gmail does). Only plain Report spam is ever chosen
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
    if (plain) { press(plain); return true; }
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    return false;
}

// Still allowed to act, right now: the setting, the view and the user (checked before every click).
// urgent: the user pressed "Move now" on everything about to be moved, so the quiet period doesn't
// apply (it protects them from surprise; this move is their own request). Everything else still does.
function mayActNow(urgent) {
    return !!lastSettings.enableAutoSpam && !document.hidden && viewAllowsAutoSpam(location.hash, MAIL.views, lastSettings.enableAutoSpamInSearch !== false) && !userBusy() && (urgent || !quietRemaining());
}
// Something queued was asked to move now (the row guard's "Move now").
function queuedNow() {
    for (const it of spamQueue.values()) if (it.now) return true;
    return false;
}
// Each row still shows the conversation it was checked for (Gmail can redraw a row for another one).
function rowsStillMatch(items) {
    return items.every(it => it.row.isConnected && isShown(it.row) && rowThreadKey(it.row) === it.thread);
}

// Result of asking Gmail: { moved, ignored, failed }, or null when the user got busy first (nothing
// was clicked; tried later). ignored: Gmail didn't act (nothing clicked, or the click changed nothing)
// and the conversations are still in the inbox, so they may be tried again. failed: Gmail asked
// something unclear, which was cancelled; not tried again.
const SPAM_CONFIRM_MS = 8000;
async function reportSpamRows(items, urgent) {
    if (anySelection() || !mayActNow(urgent) || !rowsStillMatch(items)) return null;
    const none = { moved: [], ignored: items, failed: [] };
    const boxes = items.map(it => rowCheckbox(it.row));
    if (boxes.some(b => !b)) return none;
    const unselect = () => items.forEach((it, i) => { if (it.row.isConnected && boxes[i].getAttribute('aria-checked') === 'true') press(boxes[i]); });
    boxes.forEach(press);
    await sleep(200);
    const sel = selectedRows();
    if (sel.length !== items.length || items.some(it => !sel.includes(it.row)) || !rowsStillMatch(items)) { unselect(); return none; }
    const btn = reportSpamButton();
    if (!btn || !mayActNow(urgent)) { unselect(); return btn ? null : none; }
    const before = new Set(shownAll('[role="alertdialog"], [role="dialog"]'));
    press(btn);
    if (!await confirmSpamDialog(before)) { await sleep(200); cancelNewDialogs(before); unselect(); return { moved: [], ignored: [], failed: items }; }
    const gone = (it) => !it.row.isConnected || !isShown(it.row) || rowThreadKey(it.row) !== it.thread;
    await waitFor(() => items.every(gone), SPAM_CONFIRM_MS);
    cancelNewDialogs(before);
    unselect();                                       // whatever Gmail left behind is never left selected
    const moved = items.filter(gone);
    return { moved, ignored: items.filter(it => !moved.includes(it)), failed: [] };
}

async function reportSpamOpenThread(item) {
    // The toolbar would act on a selection; and the conversation on screen must still be this one.
    if (anySelection() || !mayActNow() || currentThreadKey() !== item.thread) return null;
    const none = { moved: [], ignored: [item], failed: [] };
    const btn = reportSpamButton();
    if (!btn) return none;
    const before = new Set(shownAll('[role="alertdialog"], [role="dialog"]'));
    press(btn);
    if (!await confirmSpamDialog(before)) { await sleep(200); cancelNewDialogs(before); return { moved: [], ignored: [], failed: [item] }; }
    if (await waitFor(() => currentThreadKey() !== item.thread, SPAM_CONFIRM_MS)) return { moved: [item], ignored: [], failed: [] };
    cancelNewDialogs(before);
    return none;
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
    return sendWithTimeout({ action: 'recordSpamMoves', log,
        moves: items.map(it => ({ thread: it.thread, address: it.address || '', reason: it.reason || '', how: it.how || '' })) }).then(r => r === true);
}
// Gmail didn't act on these, so they're not remembered as moved (they may be tried again).
function forgetSpamThreads(items) {
    return sendWithTimeout({ action: 'forgetSpamMoves', threads: items.map(it => it.thread) }).then(r => r === true);
}

// The user takes conversations out of Spam (Not spam, Move to Inbox): remembered, so that whatever
// put them there (Gmail or the extension), the extension never moves them back.
const NOT_SPAM_LABEL = /^(not spam|move to inbox|kein spam|in den posteingang|pas un spam|non spam|déplacer vers la boîte de réception|no es spam|mover a recibidos|non è spam|sposta in posta in arrivo|geen spam|verplaatsen naar inbox|nie jest spamem|não é spam|mover para a caixa de entrada|inte skräppost)/i;
function inSpamView() { return !!(MAIL && MAIL.views && MAIL.views.spam && MAIL.views.spam.test(location.hash.replace(/^#/, ''))); }
function onRescueClick(e) {
    if (!inSpamView()) return;
    const b = e.target && e.target.closest ? e.target.closest('[role="button"]') : null;
    if (!b || !NOT_SPAM_LABEL.test((b.getAttribute('aria-label') || b.getAttribute('data-tooltip') || b.textContent || '').trim())) return;
    const threads = new Set(selectedRows().map(rowThreadKey).filter(Boolean));
    const open = currentThreadKey();
    if (open) threads.add(open);
    if (threads.size) rememberSpamThreads([...threads].map(thread => ({ thread, reason: 'taken out of Spam by you' })), 'rescued');
}
if (MAIL_CAN.move) document.addEventListener('mousedown', onRescueClick, true);

// The conversations moved or rescued (see recordSpamMoves), kept in the page as one compact list (see
// compactSet) and read again only when they change, not on every try. Resolves to { has(thread) },
// or null if they can't be read (then nothing is moved).
let spamMemory = null;
function movedThreads() {
    if (!spamMemory) {
        spamMemory = new Promise(resolve => {
            setTimeout(() => resolve(null), 8000);
            try {
                chrome.storage.local.get({ spamMovedThreads: {}, spamRescuedThreads: {} }, (r) => resolve(!chrome.runtime.lastError && r && r.spamMovedThreads && r.spamRescuedThreads
                    ? compactSet([...Object.keys(r.spamMovedThreads), ...Object.keys(r.spamRescuedThreads)]) : null));
            }
            catch (e) { resolve(null); }
        }).then(m => { if (!m) spamMemory = null; return m; });
    }
    return spamMemory;
}

// The shown inbox row of a queued conversation, with its verdict; false when the row is shown without
// one (its verdict changed); null when it isn't shown right now (an email is open, the list is hidden).
function rowForThread(thread) {
    let found = null;
    for (const r of listRows()) {
        if (!isShown(r) || rowThreadKey(r) !== thread) continue;
        if (r.unshortenerSpam) return r;
        found = false;
    }
    return found;
}

async function runSpamMoves() {
    if (spamMoveRunning || !spamQueue.size) return;
    if (!lastSettings.enableAutoSpam) { spamQueue.clear(); scheduleGuardSync(); publishBusy(); return; }
    spamMoveRunning = Date.now();
    publishBusy();
    // Why the queued moves are waiting, when they are (shown as <html data-unshortener-spam-wait>).
    let wait = 'not shown';
    try {
        // Paused after repeated failures, hidden tab, not the inbox or the user is busy: wait (every
        // exit below looks again later while anything is queued).
        wait = Date.now() < spamPausedUntil ? 'paused' : document.hidden ? 'tab hidden' : !viewAllowsAutoSpam(location.hash, MAIL.views, lastSettings.enableAutoSpamInSearch !== false) ? 'view'
            : userBusy() ? 'user busy' : quietRemaining() && !queuedNow() ? 'recent activity' : '';
        if (wait) return;
        wait = 'not shown';
        const current = currentThreadKey();
        // Several lists on the inbox page (Multiple Inboxes, Priority Inbox sections): some can show
        // conversations that aren't in the inbox, so nothing is moved from the list there. (Search
        // results may be split into sections too; any of them may be moved.)
        if (!current && !isSearchView(location.hash, MAIL.views) && new Set(shownAll(MAIL.list.row).map(r => r.closest(MAIL.list.container || 'table'))).size > 1) {
            if (!multiListLogged) { multiListLogged = true; reportEvent('info', 'Emails from flagged senders are not moved to Spam from an inbox with several sections (Multiple Inboxes or Priority Inbox); they are still marked, and are moved when opened.'); }
            wait = 'several lists';
            return;
        }
        // Split view (a conversation open beside the list): which one the toolbar acts on isn't certain,
        // so nothing is moved there.
        if (current && shownAll(MAIL.list.row).length) {
            if (!splitViewLogged) { splitViewLogged = true; reportEvent('info', `Emails from flagged senders are not moved to Spam while ${SITE.name} shows a conversation beside the list (split view); they are still marked.`); }
            wait = 'split view';
            return;
        }
        // Only now the memory (after the cheap checks above, so a wait never reads it).
        const memory = await movedThreads();
        if (!memory) { wait = 'memory'; return; }             // can't tell what was moved before: wait
        const rows = [];
        let open = null;
        for (const [thread, it] of [...spamQueue]) {
            const drop = () => { spamQueue.delete(thread); spamAttempted.add(thread); };
            if (memory.has(thread)) { drop(); continue; }        // moved before, or the user took it back out of Spam
            // Not shown for a long time: leaves the queue (the monitor queues it again if it comes back).
            if (Date.now() - it.since > SPAM_WAIT_MAX_MS) { spamQueue.delete(thread); continue; }
            it.thread = thread;
            if (it.kind === 'thread') {
                if (current !== thread) continue;             // waits until it's open again
            } else {
                if (current) continue;                        // an email is open: the list waits
                const row = rowForThread(thread);
                if (row === false) { spamQueue.delete(thread); continue; }   // its verdict changed
                if (!row) continue;                           // not shown right now: waits
                it.row = row;
            }
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
        const cfg = await sendWithTimeout({ action: 'getSettings' });
        if (!cfg || !cfg.values) { wait = 'settings'; return; }
        lastSettings = cfg.values;
        lastPolicy = cfg.policy || {};
        // Rows the user asked to move now (the row guard's "Move now") go first, on their own: their
        // move is the user's own request, so the quiet period doesn't apply to them — but it still
        // protects every other row, which waits for the next pass.
        const urgentRows = rows.filter(it => it.now);
        const urgent = !open && urgentRows.length > 0;
        if (!mayActNow(urgent) || currentThreadKey() !== current) { wait = 'user busy'; return; }
        const batch = open ? [open] : (urgent ? urgentRows : rows).filter(it => rowsStillMatch([it])).slice(0, 20);
        if (!batch.length) return;                            // what's queued isn't on screen: 'not shown'
        // Everything that would make Gmail act on something else is checked before remembering, so a
        // move put off for the user isn't recorded as done.
        if (anySelection()) { wait = 'selection'; return; }
        if (open ? currentThreadKey() !== open.thread : !rowsStillMatch(batch)) return;
        if (!await rememberSpamThreads(batch, false)) return;  // not remembered: don't move
        const result = open ? await reportSpamOpenThread(open) : await reportSpamRows(batch, urgent);
        if (!result) { await forgetSpamThreads(batch); wait = 'user busy'; return; }   // the user got busy first: nothing clicked
        const { moved, ignored, failed } = result;
        for (const it of [...moved, ...failed]) { spamQueue.delete(it.thread); spamAttempted.add(it.thread); }
        if (moved.length) {
            spamMoveFailures = 0;
            spamRetryDelay = 3000;
            rememberSpamThreads(moved, 'moved');
            if (lastSettings.enableSpamNotice) showSpamNotice(moved.length);
        }
        // Gmail didn't act on these: tried again. Only when Gmail moved others but not these does it count
        // against them (given up and logged after a few tries); when Gmail moved nothing at all, the
        // problem is Gmail's page, so moving pauses (below) and nothing is given up.
        const retry = [], giveUp = [];
        for (const it of ignored) {
            const n = (spamTries.get(it.thread) || 0) + (moved.length ? 1 : 0);
            spamTries.set(it.thread, n);
            (n < SPAM_MAX_TRIES ? retry : giveUp).push(it);
        }
        if (retry.length) { await forgetSpamThreads(retry); retry.forEach(it => spamQueue.delete(it.thread)); }
        for (const it of giveUp) { spamQueue.delete(it.thread); spamAttempted.add(it.thread); }
        const notMoved = [...failed.map(it => Object.assign({}, it, { how: `${SITE.name} asked something unclear before reporting it, so that was cancelled` })),
                          ...giveUp.map(it => Object.assign({}, it, { how: `${SITE.name} didn't move it after ${SPAM_MAX_TRIES} tries (its Report spam button didn't respond as expected)` }))];
        if (notMoved.length) rememberSpamThreads(notMoved, 'failed');
        if (!moved.length) {
            if (++spamMoveFailures >= SPAM_PAUSE_AFTER) {
                const pause = Math.min(15000 * 2 ** (spamMoveFailures - SPAM_PAUSE_AFTER), 10 * 60 * 1000);
                spamPausedUntil = Date.now() + pause;
                reportEvent('warning', `${SITE.name} didn't move flagged emails to Spam ${spamMoveFailures} times in a row (its Report spam button didn't respond as expected). Trying again in ${Math.round(pause / 1000)} seconds; they stay marked meanwhile.`);
            }
        } else spamPausedUntil = 0;
        wait = '';
    } finally {
        spamMoveRunning = 0;
        document.documentElement.dataset.unshortenerSpamWait = spamQueue.size ? wait || 'retrying' : '';
        scheduleGuardSync();
        scheduleBadgeUpdate();
        publishBusy();
        if (spamQueue.size) {                                 // waiting (user busy, list hidden, paused): look again
            const quiet = quietRemaining();
            // Waiting out the user's quiet period: look right when it ends. Parked, or a one-off wait
            // (the view, an open email, a selection, the memory): a steady, cheap look — and the change
            // that unparks it (the view or tab changing, "Move now") brings a look at once. Only a pass
            // that clicked and was ignored backs off; repeated such passes pause (above).
            if (quiet && !queuedNow()) scheduleSpamMoves(quiet + 300);
            else if (wait) scheduleSpamMoves(SPAM_PARKED_POLL_MS);
            else {
                scheduleSpamMoves(spamRetryDelay);
                spamRetryDelay = Math.min(spamRetryDelay * 2, 30000);
            }
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
        review.href = (MAIL.views && MAIL.views.spamHref) || '#';
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
// --- Copy the sender's address -------------------------------------------------------------------
// A button beside the sender of each opened email (after their address) that copies the address, with
// a brief "Copied" confirmation (announced to screen readers too). Works on its own, whatever the
// sender checks are set to. Inspired by Copy Button for Gmail.
const COPY_PATH = 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z';
const COPIED_PATH = 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z';
// The button's 16-pixel icon (copy, or a check mark once copied), built as elements.
function setCopyIcon(btn, done) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of [['viewBox', '0 0 24 24'], ['width', '16'], ['height', '16'], ['aria-hidden', 'true'], ['focusable', 'false']]) svg.setAttribute(k, v);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('d', done ? COPIED_PATH : COPY_PATH);
    svg.appendChild(path);
    btn.replaceChildren(svg);
}
function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => copyTextFallback(text));
    return Promise.resolve(copyTextFallback(text));
}
function copyTextFallback(text) {
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    t.remove();
    return ok;
}
function addCopyButtons(S) {
    const sel = MAIL_CAN.opened === true && MAIL.message && MAIL.message.sender;
    if (!sel || !S.enableCopyAddress) { document.querySelectorAll('.unshortener-copy-address').forEach(b => b.remove()); return; }
    for (const nameEl of document.querySelectorAll(sel)) {
        const holder = nameEl.parentElement;
        const who = senderOf(nameEl);
        if (!holder || !who || !who.address || holder.querySelector('.unshortener-copy-address')) continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'unshortener-copy-address' + (isDarkSurface(nameEl) ? ' unshortener-dark' : '');
        btn.title = `Copy ${who.address}`;
        btn.setAttribute('aria-label', `Copy the sender's address, ${who.address}`);
        setCopyIcon(btn, false);
        const status = document.createElement('span');
        status.className = 'unshortener-copy-status';
        status.setAttribute('role', 'status');
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();                         // not a click on the email header (it would collapse it)
            guarded('Copying an address', () => copyText(who.address).then(ok => {
                setCopyIcon(btn, ok);
                btn.classList.toggle('unshortener-copied', ok);
                status.textContent = ok ? 'Copied' : 'Couldn\'t copy';
                clearTimeout(btn.unshortenerTimer);
                btn.unshortenerTimer = setTimeout(() => { setCopyIcon(btn, false); btn.classList.remove('unshortener-copied'); status.textContent = ''; }, 1500);
            }));
        });
        const after = (MAIL.message.senderAfter && holder.querySelector(MAIL.message.senderAfter)) || holder.querySelector('.unshortener-sender-chip') || nameEl;
        after.insertAdjacentElement('afterend', btn);
        btn.insertAdjacentElement('afterend', status);
    }
}

function scanSenderIdentity() {
    if (!MAIL_CAN.list && !MAIL_CAN.opened) return;
    safeSend({ action: 'getSettings' }, (cfg) => guarded('Checking senders', () => {
        if (!cfg || !cfg.values) return;
        lastSettings = cfg.values;
        lastPolicy = cfg.policy || {};
        lastLocked = cfg.locked || {};
        const S = cfg.values;
        if (MAIL_CAN.opened === true) addCopyButtons(S);
        applyRowHighlighter(S);
        detectConflicts(S);
        if (!senderFeaturesOn(S)) {
            if (document.querySelector('[data-unshortener-sender]')) removeSenderDecorations();
            spamQueue.clear();
            publishBusy();
            return;
        }
        if (!S.enableSenderIdentity && document.querySelector('.unshortener-sender-icon, .unshortener-sender-chip, .unshortener-sender-address')) removeSenderDecorations();
        scanSenderRows(S);
        scanOpenedSenders(S);
        if (spamQueue.size) scheduleSpamMoves();
    }));
}

// The inbox rows are watched too (webmail with a list profile), for the sender icons and checks.
const WATCH_SELECTOR = MAIL_CAN.list ? `${SITE.body}, ${MAIL.list.row}` : SITE.body;

// Watches for Gmail inserting a message body. Gmail changes the page constantly, so the callback
// does as little as possible: text nodes and leaf elements (which cannot contain a message body)
// are skipped before any search, and bursts of changes are debounced into a single scan.
// A list row we decorated whose contents the webmail rewrote (it refreshes rows in place, for
// example when the tab is shown again), losing our icon or label: it's drawn again.
function rowLostDecorations(target) {
    if (!MAIL_CAN.list || !lastSettings.enableSenderIdentity || !target || target.nodeType !== Node.ELEMENT_NODE) return false;
    const row = target.closest(MAIL.list.row);
    return !!(row && row.dataset.unshortenerSender && (!row.querySelector('.unshortener-sender-icon, .unshortener-sender-chip') || avatarLost(row)));
}
// Gmail redrew the checkbox cell and took the photo over it with it.
function avatarLost(row) { return row.dataset.unshortenerAvatar === '1' && !row.querySelector('.unshortener-row-avatar'); }
const observer = new MutationObserver((mutations) => {
    scheduleBadgeUpdate();                     // opening, closing or switching views can change the state
    let emailOpened = false;
    outer:
    for (const mutation of mutations) {
        if ((mutation.addedNodes.length || mutation.removedNodes.length) && rowLostDecorations(mutation.target)) { emailOpened = true; break; }
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
        mutationDebounceTimer = null;
        firstScanPending = false;
        publishBusy();
    }, 350);
    publishBusy();
}

observer.observe(document.body, { childList: true, subtree: true });
if (document.querySelector(SITE.body) || (SITE.readFrames && document.querySelector('iframe'))) setTimeout(() => guarded('Scanning an email', unshortenLinks), 500);
if (MAIL) setTimeout(scheduleScan, 500);
else setTimeout(() => { firstScanPending = false; publishBusy(); }, 600);   // after the first scan above
publishBusy();

// Gmail switches views without reloading; report the state right away on navigation and tab switches.
// Going back to the inbox shows the list Gmail kept, without inserting anything: scan it again.
window.addEventListener('hashchange', () => { scheduleBadgeUpdate(); if (MAIL) scheduleScan(); });
window.addEventListener('popstate', scheduleBadgeUpdate);
// Coming back to the tab: the webmail may have refreshed the list while it was hidden.
document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastReported = ''; scheduleBadgeUpdate(); if (MAIL) scheduleScan(); if (spamQueue.size) scheduleSpamMoves(); } });
const SENDER_SETTING_KEYS = ['enableLookalikeCheck', 'enableOwnNameCheck', 'enableCallbackScamCheck', 'enableAutoSpamInSearch', 'enableSpamFolderFlags', 'enableCopyAddress', 'senderPictureSize', 'enableSenderBimi', 'enableRowHighlighter', 'rowHighlightColor', 'rowHighlightStyle', 'rowHighlightSelected', 'rowHighlightSelectedColor', 'enableConflictWarnings',
    'enableSenderIdentity', 'enableSenderAvatars', 'enableSenderIconFallback', 'enableSenderCountry', 'enableSenderDomainCheck', 'enableSenderAddressCheck', 'enableAutoSpam', 'customTrustedSenders', 'customAllowlist', 'enableDnsThreatCheck'];
// Turning protection on or off in Settings or the popup takes effect on the icon immediately.
chrome.storage.onChanged.addListener((changes, area) => {
    // A policy change (for example sender features locked off) applies at once.
    if (area === 'managed' && MAIL) { spamQueue.clear(); publishBusy(); senderResults.clear(); removeSenderDecorations(); scheduleScan(); return; }
    if (area !== 'local') return;
    if (changes.senderMessageCache && changes.senderMessageCache.newValue === undefined) senderMessageCache = null;   // cleared in Settings
    if (changes.spamMovedThreads || changes.spamRescuedThreads) spamMemory = null;   // read again when next needed
    if (changes.spamMovedThreads || changes.spamRescuedThreads || changes.spamMoveLog) spamMovedInfo = null;
    if (changes.spamUnreadHeadersOff) unreadHeadersOff = !!changes.spamUnreadHeadersOff.newValue;
    let relevant = false;
    for (const key of ['enableLinkUnmasking', 'enableTrackingPixelBlocking', SITE.settingKey]) {
        if (key && changes[key]) { lastSettings[key] = changes[key].newValue; relevant = true; }
    }
    if (relevant) scheduleBadgeUpdate();
    // Sender features switched on or off: drawn or removed right away.
    if (MAIL && (SENDER_SETTING_KEYS.some(k => changes[k]) || (SITE.settingKey && changes[SITE.settingKey]))) {
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
