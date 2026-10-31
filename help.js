// help.js — Help tab: section navigation, cross-links, and the LIVE tables of the Architecture page.
// Live tables are generated from the code that is actually running (shared.js, decoders.js), so the
// documentation cannot drift from the behavior. Everything is built with textContent (no HTML from data).

(() => {
    // ---------------------------------------------------------------- helpers
    function el(tag, props, ...children) {
        const e = document.createElement(tag);
        if (props) Object.entries(props).forEach(([k, v]) => {
            if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
        });
        children.flat().forEach(c => { if (c === null || c === undefined) return; e.append(c instanceof Node ? c : document.createTextNode(String(c))); });
        return e;
    }
    const code = (t) => el('code', null, String(t));
    const list = (items) => el('ul', { class: 'simple-list' }, items.map(i => el('li', null, i)));
    function table(headers, rows) {
        return el('table', { class: 'arch-table' },
            el('thead', null, el('tr', null, headers.map(h => el('th', null, h)))),
            el('tbody', null, rows.map(r => el('tr', null, r.map(c => el('td', null, c))))));
    }
    function fill(id, ...nodes) {
        const target = document.getElementById(id);
        if (!target) return;
        target.textContent = '';
        nodes.flat().forEach(n => target.append(n));
    }
    const fmtMs = (ms) => ms % 86400000 === 0 ? `${ms / 86400000} days` : ms % 3600000 === 0 ? `${ms / 3600000} hours` : `${ms / 60000} minutes`;
    const onOff = (v) => v ? 'On' : 'Off';

    // ---------------------------------------------------------------- navigation
    function showTab(name) {
        const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
        if (btn) btn.click();
    }
    function showHelp(section, anchor) {
        showTab('help');
        document.querySelectorAll('#helpNav button').forEach(b => b.classList.toggle('active', b.dataset.help === section));
        document.querySelectorAll('.help-section').forEach(s => s.classList.toggle('active', s.id === `help-${section}`));
        if (section === 'architecture') renderArchitecture();
        if (section === 'privacy') renderPrivacyTable();
        if (section === 'compat') renderCompat();
        if (section === 'about') document.getElementById('aboutVersion').textContent = chrome.runtime.getManifest().version;
        const target = anchor ? document.getElementById(anchor) : document.querySelector('.help-body');
        if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
    }

    document.addEventListener('click', (e) => {
        const nav = e.target.closest('#helpNav button');
        if (nav) { showHelp(nav.dataset.help); return; }
        const helpLink = e.target.closest('[data-help-link], [data-help-anchor]');
        if (helpLink) {
            e.preventDefault();
            const anchor = helpLink.dataset.helpAnchor;
            const section = helpLink.dataset.helpLink || (anchor && anchor.startsWith('arch-') ? 'architecture' : null);
            if (section) showHelp(section, anchor);
            else if (anchor) document.getElementById(anchor).scrollIntoView({ behavior: 'smooth' });
            return;
        }
        const gotoTab = e.target.closest('[data-goto-tab]');
        if (gotoTab) { e.preventDefault(); showTab(gotoTab.dataset.gotoTab); return; }
        const gotoLog = e.target.closest('[data-goto-log]');
        if (gotoLog) {
            e.preventDefault();
            showTab('logging');
            const b = document.querySelector(`#logNav button[data-log="${gotoLog.dataset.gotoLog}"]`);
            if (b) b.click();
        }
    });

    // ---------------------------------------------------------------- privacy: what can be sent
    async function renderPrivacyTable() {
        const cfg = await loadEffectiveSettings();
        const S = cfg.values;
        const lock = (k) => cfg.locked[k] ? ' 🔒' : '';
        fill('privacySendsTable', table(['Feature', 'What is sent', 'Who receives it', 'Now'], [
            ['Short-link lookup', 'The full address of a short link (bit.ly and similar, or one shaped like a short link), or a blocklisted or email tracking link you chose to reveal with its 🔍. Never one-time links, and never tracking links automatically.',
             S.customUnshortenerEndpoint ? `Your own service (${hostOf(S.customUnshortenerEndpoint)})${S.useUnshortenMeFallback ? ', then unshorten.me if it gives no answer' : ''}` : 'unshorten.me (third party; sees your IP address)',
             onOff(S.enableThirdPartyResolution) + lock('enableThirdPartyResolution')],
            ['Threat checks', 'Only the site name, e.g. example.com.',
             'Cloudflare (1.1.1.1 reference and Security' + (S.dnsCloudflareFamily ? ', Family' : '') + ')' + (S.dnsQuad9 ? ', Quad9' : '') +
             (S.dnsAdGuard ? ', AdGuard (only as a backup)' : '') + (S.customDohEndpoint ? `, your own resolver (${hostOf(S.customDohEndpoint)})` : '') + '. They see your IP address.',
             onOff(S.enableDnsThreatCheck) + lock('enableDnsThreatCheck')],
            ['Shortener list update', 'A plain daily download of two public lists. Nothing about you or your email.', 'raw.githubusercontent.com (GitHub; sees your IP address)',
             onOff(S.enableRemoteListSync) + lock('enableRemoteListSync')],
            ['Checking links before sending', 'When you press Send: the site names of the links you wrote (to the threat-check services above), and one request to each linked website to see that it answers, as when your reader clicks it. Never for one-time links; nothing about your email itself.',
             'Cloudflare 1.1.1.1 and the threat-check services; the websites you link to', onOff(S.enableSendCheck) + lock('enableSendCheck')],
            ['Phishing list update', 'Plain downloads of the public phishing lists (at most once a day), including a list of scam senders\' addresses. Links and senders are matched on this computer; nothing about you is sent.', 'openphish.com, phishing.army and raw.githubusercontent.com (they see your IP address)',
             onOff(S.enablePhishingFeeds) + lock('enablePhishingFeeds')],
            ['Sender checks (Gmail)', 'Only the domain of each sender (e.g. example.com), never the address or anything about the email. Gmail, Outlook.com and other big providers\' domains and your own organization\'s are never sent.', 'the threat-check services above',
             onOff(S.enableSenderDomainCheck && S.enableDnsThreatCheck) + lock('enableSenderDomainCheck')],
            ['Sender icons (Gmail)', 'The site name of each sender (e.g. example.com), to get its icon.', 'Google\'s icon service (www.google.com; Google already delivers your Gmail)',
             onOff(S.enableSenderIdentity && S.enableDnsThreatCheck) + lock('enableSenderIdentity')],
            ['Stand-in sender icons (Gmail)', 'The site name of a sender whose site has no icon of its own (and not its parent domain either).', 'DuckDuckGo\'s icon service (icons.duckduckgo.com)',
             onOff(S.enableSenderIdentity && S.enableDnsThreatCheck && S.enableSenderIconFallback) + lock('enableSenderIconFallback')],
            ['Sender country (Gmail)', 'The internet address of the server that delivered an email (from Gmail\'s own record, read emails only), or of the sender\'s website. Once a month at most per address.', 'country.is (open-source service; sees your IP address)',
             onOff(S.enableSenderIdentity && S.enableSenderCountry && S.enableDnsThreatCheck) + lock('enableSenderCountry')]
        ]));
    }

    // ---------------------------------------------------------------- compatibility chart
    // Generated from WEBMAIL_SITES and FEATURE_SUPPORT (shared.js) with mailCapabilities, the same
    // function the content script uses to decide what runs on a site.
    function renderCompat() {
        const sites = WEBMAIL_SITES;
        const caps = sites.map(mailCapabilities);
        const short = (n) => n.replace(/ on the web$/, '').replace(/ Mail$/, '');
        const mark = (v) => v === 'generic' ? el('span', { class: 'basic', title: 'Found through the page\'s accessibility labels; read-only (experimental)' }, 'Basic')
            : v ? el('span', { class: 'yes', 'aria-label': 'Yes', title: 'Works' }, '✓') : el('span', { class: 'no', 'aria-label': 'Not yet', title: 'Not yet' }, '—');
        const head = el('tr', null, el('th', { scope: 'col' }, 'Feature'), sites.map(w => el('th', { scope: 'col' }, short(w.name))));
        const status = el('tr', { class: 'status' }, el('th', { scope: 'row', style: 'font-weight: normal;' }, 'Support'), sites.map(w => el('td', null, w.mail ? 'Full' : 'Experimental')));
        const rows = FEATURE_SUPPORT.map(f => el('tr', null,
            el('th', { scope: 'row', style: 'font-weight: normal;' }, f.name, f.needs ? '' : el('span', { style: 'color: var(--text-muted);' }, ' (every site)')),
            caps.map(c => el('td', null, mark(f.needs ? c[f.needs] : true)))));
        fill('compatTable', el('table', { class: 'help-table compat-table' }, el('thead', null, head), el('tbody', null, status, rows)));
    }

    // ---------------------------------------------------------------- architecture
    let archRendered = false;
    let snapshotCount = null;
    async function renderArchitecture() {
        const cfg = await loadEffectiveSettings();
        if (!archRendered) {
            archRendered = true;
            renderToc();
            renderStatic();
        }
        renderLive(cfg);
    }

    function renderToc() {
        const toc = document.getElementById('archToc');
        document.querySelectorAll('#help-architecture h3[id]').forEach(h => {
            toc.append(el('a', { href: '#', 'data-help-anchor': h.id }, h.textContent.replace('LIVE', '').trim()));
        });
    }

    function renderEngine() {
        const yes = (v, extra) => v ? (extra ? `Yes (${extra})` : 'Yes') : '—';
        fill('archEngine', table(['Site', 'Message body', 'Inbox list', 'Opened emails', 'Original source', 'Report spam', 'Compose'],
            WEBMAIL_SITES.map(w => {
                const c = mailCapabilities(w), M = w.mail || {};
                const gen = (v, own) => v === 'generic' ? 'Generic (accessibility labels)' : yes(v, own);
                return [w.name, code(w.body), gen(c.list, M.list && M.list.row), gen(c.opened, M.message && M.message.sender),
                        yes(c.headers, M.headers && M.headers.receiver && `trusts ${M.headers.receiver.host}`), yes(c.move), yes(c.compose)];
            })));
    }

    function renderStatic() {
        renderEngine();
        fill('archFiles', table(['File', 'Runs in', 'Responsibility'], [
            [code('manifest.json'), 'Safari', 'Manifest V3: permissions, background page, content scripts. Wrapped in a Mac or iPhone/iPad app by Apple\'s converter (tools/build-safari.sh).'],
            [code('background.html'), 'background page', 'Loads the background scripts and the scanner (non-persistent background page).'],
            [code('shared.js'), 'everywhere', 'Settings model and policy merging, domain lists, one-time detection, misleading-link checks, backup/restore, shared constants.'],
            [code('content.js'), 'webmail tab', 'Finds opened messages, sends links for analysis, rewrites and marks links, blocks pixels, reveal flow, error reporting. Its mail engine reads the inbox list, senders, toolbar and compose window of any webmail from that site\'s entry in WEBMAIL_SITES (shared.js): one code path for every site, Gmail included.'],
            [code('qr-decoder.js'), 'scanner', 'Self-contained QR Code reader (ISO/IEC 18004): finder patterns, perspective correction, Reed-Solomon.'],
            [code('scanner.js'), 'background page', 'Decodes QR codes in images and PDF pages and lists PDF links.'],
            [code('compat.js'), 'background page', 'Small shims for JavaScript features pdf.js uses that Safari lacks.'],
            [code('lib/pdf.min.mjs, lib/pdf.worker.min.mjs'), 'scanner', 'pdf.js (Mozilla, Apache-2.0) for rendering PDF attachments.'],
            [code('content.css'), 'Gmail tab', 'Shows the 🔍 on email tracking links only while the link is hovered or focused; styles the sender icons, domain labels, the moved-to-Spam notice and the "Moving to Spam…" row guard.'],
            [code('background.js'), 'background page', 'Link pipeline, threat checks, lookups, list sync and safeguards, logging, cleanup, message API, badge.'],
            [code('decoders.js'), 'background page, Options', 'All offline decoders and the unwrapping loop.'],
            [code('custom-endpoints.js'), 'background page', 'Request building and reply parsing for your own threat resolver and unshortener.'],
            [code('options.html / options.js'), 'Options page', 'Settings, Link Inspector, Logging (application log, history, URL cache), backup/restore.'],
            [code('help.js'), 'Options page', 'This Help tab and its live tables.'],
            [code('theme.js'), 'Options page, popup', 'Light/dark appearance: follows the system by default and remembers the user\'s choice.'],
            [code('popup.html / popup.js'), 'toolbar popup', 'Counts for the open message, visual toggle, recent activity.'],
            [code('shortener-snapshot.txt'), 'background page', 'Bundled shortener list used before the first download.'],
            [code('icons/'), 'Safari', 'Toolbar and extension-page icons (16, 32, 48, 128 px).'],
            [code('tools/refresh-snapshot.js'), 'your computer (Node)', 'Optional: refreshes the bundled snapshot before packaging.'],
            [code('tools/build-safari.sh'), 'a Mac (Xcode)', 'Wraps the extension in an app with Apple\'s converter and builds it.']
        ]));

        fill('archMessages', table(['Message', 'From → to', 'Purpose'], [
            [code('getSettings'), 'Gmail → background', 'Effective settings (user values merged with policy) and lists.'],
            [code('resolveUrl'), 'Gmail → background', 'Analyze one link ({url, linkText, reveal}); returns destination, verdict, notes, and whether a 🔍 reveal can be offered.'],
            [code('logPixel'), 'Gmail → background', 'Record a blocked tracking pixel in History.'],
            [code('checkSenders'), 'Gmail → background', 'Sender checks for the inbox list and opened emails ({senders, ownDomain}); returns status (flagged, caution, clean, trusted, unverified, unknown), reasons, whether to move to Spam, and the country.'],
            [code('senderCountry'), 'Gmail → background', 'Country of the server that delivered an email (IP from the email\'s headers).'],
            [code('recordSpamMoves'), 'Gmail → background', 'Remember conversations moved to Spam or taken out of it (never moved again) and log moves, failed moves and rescues.'],
            [code('senderIcon'), 'Gmail → background', 'A sender site\'s icon as a data: URL, or none; fetched once and remembered.'],
            [code('updateBadge'), 'Gmail → background', 'Per-tab count on the toolbar button.'],
            [code('logEvent'), 'Gmail, pages → background', 'Write an application log entry (accepted only from this extension).'],
            [code('testUnwrap'), 'Options → background', 'Link Inspector: the pipeline without caching or logging, with explanations.'],
            [code('testResolver / testCustomThreat / testCustomUnshortener'), 'Options → background', 'Resolver test buttons.'],
            [code('forceSync'), 'Options → background', 'Settings → "Update now": run the list update immediately.'],
            [code('toggleVisuals / getCounts'), 'popup → Gmail', 'Switch highlights; read counts for the open message.']
        ]));

        fill('archStorage', table(['Key (storage.local)', 'Contents'], [
            [code('<setting keys>'), 'Only settings you changed; defaults are not stored. See the settings reference.'],
            [code('customAllowlist / customBlocklist'), 'Your site lists (organization lists come from policy and are merged at read time).'],
            [code('customTrustedSenders'), 'Your trusted senders (addresses or domains), never flagged or moved to Spam; the organization\'s list (managedTrustedSenders) is merged at read time.'],
            [code('senderResultCache'), 'Sender verdicts with their reasons, what was checked and the accounts the sender was seen in (6 hours; Logging → Senders).'],
            [code('IndexedDB "senderIcons"'), 'Site icons exactly as Google sends them (raw image bytes, about 600 bytes each), or a record without bytes for a site without an icon: one record per site, 30 days, at most 1,500 sites. Kept in the extension\'s own database instead of the settings storage: a quarter smaller, and saving one icon doesn\'t rewrite the others. Cleared by Delete now and by Logging → Senders → Clear.'],
            [code('spamMoveLog'), 'Logging → Moved to Spam: each move, failed move, rescue and Keep it with time, account, sender and why; a rescue of a logged move marks that line (rescuedTs) instead of adding one (newest 1,000; auto-delete period).'],
            [code('spamMovedThreads'), 'Conversations the extension moved to Spam (remembered just before moving): {thread id: time}, the newest 50,000, with no time limit. None of them is ever moved again. Kept by Delete now.'],
            [code('spamRescuedThreads'), 'Conversations you took out of Spam (Not spam, Move to Inbox): {thread id: time}, the newest 50,000, kept apart so moves never push them out. None of them is ever moved. Kept by Delete now.'],
            [code('senderDomainCache / geoCache'), 'Sender-domain threat verdicts (' + fmtMs(SAFE_CACHE_MS) + ') and IP-address countries (30 days).'],
            [code('senderMessageCache'), 'Per email: the delivering server\'s address, a short fingerprint of the From address (never the address) and the signs of forgery found in its headers, read once; at most 5,000, deleted after the auto-delete period.'],
            [code('https://… (one key per link)'), 'Cache entry: {finalUrl, resolver, isSafe, reason, resolvedIp, cachedDate, cachedTimestamp}. Never one-time, unverified, blocklisted or revealed links.'],
            [code('resolutionHistory'), 'History entries: {timestamp, shortUrl, finalUrl, verdict, reason, resolvedIp, resolver, account}.'],
            [code('errorLogs'), 'Application log entries: {time, timestampMs, level, source, message, count, account}.'],
            [code('recentActivity'), 'Popup feed: link and pixel events and errors, with the account.'],
            [code('listState'), 'List sync state per source: {active[], pending{domain: {count, last}}, lastSuccess}, plus fallback and syncDisabledSince.'],
            [code('remoteShorteners'), 'The combined list of synced shortener domains currently in use.'],
            [code('lastSyncTime / cacheSchema / welcomeDismissed'), 'Bookkeeping.'],
            [code('storage.managed'), 'Not available in Safari (no extension policies); read as empty.']
        ]));

        fill('archPlatform',
            el('p', null, el('b', null, 'WebExtension APIs: '),
               'storage (local, onChanged; managed is read but Safari has none), alarms (daily list update and cleanup), runtime (messaging, install/update events, packaged files), action (toolbar badge), tabs (popup → Gmail tab), permissions (one-host access for your own services).'),
            el('p', null, el('b', null, 'Web platform: '),
               'fetch with AbortController timeouts, MutationObserver, URL and URLSearchParams, atob/btoa (base64), DataView (DNS wire format, RFC 8484), BigInt (Flickr base-58), the Clipboard API.'),
            el('p', null, el('b', null, 'Third-party code: '),
               'only pdf.js (Mozilla, bundled in lib/) for PDF attachments. No frameworks, build tools, remote scripts or analytics; Manifest V3 forbids remote code in any case.'));
    }

    async function renderLive(cfg) {
        const S = cfg.values;

        // Decoders
        const ruleRows = REDIRECT_RULES.map(r => [r.name, r.hostTest ? 'Amazon country sites' : r.hosts.join(', '), code(r.path.source)]);
        fill('archDecoders',
            el('p', null, el('b', null, 'Security gateways'), ' (also used for one-time links, in this order):'),
            el('ol', { class: 'simple-list' }, STRICT_DECODERS.map(([name]) => el('li', null, name))),
            el('p', null, el('b', null, 'Generic decoders'), ' (ordinary links only, after the gateways):'),
            el('ol', { class: 'simple-list' }, GENERIC_DECODERS.map(([name]) => el('li', null, name))),
            el('p', null, el('b', null, `Known redirect table (${REDIRECT_RULES.length} rules):`)),
            table(['Redirect', 'Hosts (and subdomains)', 'Path pattern'], ruleRows),
            el('p', null, el('b', null, 'Expanded offline without a lookup: '), 'youtu.be, redd.it, dai.ly, flic.kr, instagr.am.'),
            el('p', null, el('b', null, 'Recognized but not decodable: '), 'Mimecast URL Protect (destination domain shown when provided), Fortinet, and email-provider trackers.'),
            el('p', null, el('b', null, 'Safety rules: '), 'at most six layers; generic decoders run only on known redirect, tracker or shortener hosts and never on social "share" pages; JSON payloads are decoded only when they contain exactly one URL; destinations written unencoded into a path are never re-decoded.'));

        // One-time detection
        fill('archOneTime',
            el('p', null, el('b', null, 'Path')), el('span', { class: 'regex' }, SINGLE_USE_PATH_RE.toString()),
            el('p', null, el('b', null, 'Query parameter')), el('span', { class: 'regex' }, SINGLE_USE_PARAM_RE.toString()),
            el('p', null, el('b', null, 'Link text')), el('span', { class: 'regex' }, SINGLE_USE_TEXT_RE.toString()),
            el('p', null, `Protection is currently ${S.enableOneTimeLinkProtection ? 'on' : 'off'}${cfg.locked.enableOneTimeLinkProtection ? ' (set by your organization)' : ''}.`));

        // Resolvers
        const resolverRows = [
            ['Cloudflare 1.1.1.1', 'reference (non-filtering)', code('https://1.1.1.1/dns-query?name=<host>&type=A'), 'Destination IP; tells a Quad9 block from a missing domain', onOff(S.enableDnsThreatCheck)],
            ['Quad9', 'primary security', code('https://dns.quad9.net/dns-query?dns=<RFC 8484 wire query>'), 'NXDOMAIN while the reference resolves', onOff(S.enableDnsThreatCheck && S.dnsQuad9)],
            ...WIRE_DNS_PROVIDERS.map(p => [p.name, 'primary security', code(`${p.url}?dns=<RFC 8484 wire query>`), 'Sinkhole address, or NXDOMAIN while the reference resolves', onOff(S.enableDnsThreatCheck && S[p.id])]),
            ...JSON_DNS_PROVIDERS.map(p => [p.name, { primary: 'primary security', content: 'content filter (flags)', backup: 'backup (only if no primary answers)' }[p.role],
                code(p.url('<host>')), 'Sinkhole answer 0.0.0.0 / 127.0.0.1', onOff(S.enableDnsThreatCheck && S[p.id])]),
            ['Your own resolver', 'primary security', S.customDohEndpoint ? code(S.customDohEndpoint) : 'not set', 'Recognized reply formats (below)', S.customDohEndpoint ? onOff(S.enableDnsThreatCheck) : '—']
        ];
        fill('archResolvers', table(['Service', 'Role', 'Request', 'How a block is recognized', 'Now'], resolverRows));
        document.querySelectorAll('[data-live="SAFE_CACHE_MS"]').forEach(n => { n.textContent = fmtMs(SAFE_CACHE_MS); });

        // Lists
        if (snapshotCount === null) {   // the packaged file never changes: read it once
            try {
                const txt = await (await fetch(chrome.runtime.getURL('shortener-snapshot.txt'))).text();
                snapshotCount = txt.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).length;
            } catch (e) { snapshotCount = '?'; }
        }
        // Safeguards: what each kind of list is checked for, side by side, and why some checks don't apply.
        const mb = (n) => `${Math.round(n / 1048576)} MB`;
        // Equal columns for the three kinds of list, so each reads as easily as the others.
        const evenColumns = (t) => { t.style.tableLayout = 'fixed'; t.querySelectorAll('thead th').forEach((th, i) => { th.style.width = i ? '29%' : '13%'; }); return t; };
        fill('archLists',
            evenColumns(table(['Safeguard', 'Short-link lists', 'Phishing and scam lists', 'Popular-site lists'], [
                ['What a wrong entry could do', 'make links on that site be sent to unshorten.me to be looked up (a privacy risk), so these lists are checked most strictly',
                    'show a false warning (never on a major site); for the scam-sender list, move that one address\'s email to Spam', 'keep that site from being flagged as a look-alike (being on the list never makes a sender trusted)'],
                ['Size limits', `${mb(REMOTE_LIST_MAX_BYTES)} per download, ${REMOTE_LIST_MAX_DOMAINS.toLocaleString()} domains`, `${mb(PHISH_FEED_MAX_BYTES)} per download, ${PHISH_FEED_MAX_ENTRIES.toLocaleString()} entries`, `the top ${POPULAR_TOP.toLocaleString()} of each list`],
                ['Entry format', 'plain domain names only; anything else is ignored', 'each list its own kind (links, domains or full addresses); anything else is ignored', 'domain names'],
                ['Never accepted', `${PROTECTED_DOMAINS.size} major sites and their subdomains`, 'the same major sites; shared cloud-storage hosting; addresses on major brands\' own domains', 'only sites that enforce DMARC (as email-sending brands do) count'],
                ['A broken download', 'failed or too large: the previous copy is kept', `failed, too large or fewer than ${PHISH_FEED_MIN_ENTRIES} entries: the previous copy is kept`, `failed or fewer than ${POPULAR_MIN.toLocaleString()} sites: the previous copy is kept`],
                ['New entries held back', `until seen on ${REMOTE_LIST_HOLD_SIGHTINGS} separate days (at least ${fmtMs(REMOTE_LIST_SIGHTING_GAP_MS)} apart)`,
                    'no: phishing sites are often gone within hours, so holding entries for days would keep the list out of date, and a wrong entry can only add a warning', 'no: downloaded once a month, and the rankings change slowly'],
                ['Mass-change guard', `a download changing more than ${Math.round(REMOTE_LIST_MAX_CHANGE_RATIO * 100)}% of a list (minimum allowance ${REMOTE_LIST_MIN_CHANGE_LIMIT} entries) is held back`,
                    'no: these lists change almost completely from one day to the next', 'no: each list is kept on its own, so one bad download can\'t replace the other'],
                ['Removals', 'take effect immediately', 'take effect immediately (each download replaces the list)', 'with the next monthly download'],
                ['Fresh start', `the first download, or one after ${fmtMs(REMOTE_LIST_FRESH_START_MS)} without an update (or after sync was off), is accepted as the new starting point`, '—', '—']
            ])),
            el('p', null, `Before the short-link lists are first downloaded, the bundled snapshot (${snapshotCount} domains) is used. Built in, and never downloaded: ${publicShorteners.length} public shorteners and ${espTrackers.length} email-provider trackers.`),
            el('details', { class: 'more' }, el('summary', null, 'Show the protected sites and built-in lists'),
                el('p', null, el('b', null, 'Protected sites: '), [...PROTECTED_DOMAINS].join(', ')),
                el('p', null, el('b', null, 'Built-in public shorteners: '), publicShorteners.join(', ')),
                el('p', null, el('b', null, 'Email-provider trackers (never sent anywhere): '), espTrackers.join(', '))));

        // Network
        const own = (v) => v ? code(v) : 'not set';
        fill('archNetwork', table(['Destination', 'When', 'What is sent', 'Controlled by', 'Now'], [
            [code('1.1.1.1'), 'each threat check', 'hostname', 'Check sites for threats', onOff(S.enableDnsThreatCheck)],
            [code('dns.quad9.net'), 'each threat check', 'hostname (DNS wire format)', 'Threat-check services → Quad9', onOff(S.enableDnsThreatCheck && S.dnsQuad9)],
            [code('security.cloudflare-dns.com'), 'each threat check', 'hostname', 'Threat-check services', onOff(S.enableDnsThreatCheck && S.dnsCloudflareSecurity)],
            [code('family.cloudflare-dns.com'), 'each threat check', 'hostname', 'Threat-check services', onOff(S.enableDnsThreatCheck && S.dnsCloudflareFamily)],
            [code('dns.adguard-dns.com'), 'only if no security service answers', 'hostname', 'Threat-check services', onOff(S.enableDnsThreatCheck && S.dnsAdGuard)],
            ['Your own threat resolver', 'each threat check', 'hostname, or the full link if configured with {url} (one-time links: origin only)', 'Your own services', own(S.customDohEndpoint)],
            ['Your own unshortener', 'eligible short links, and links you reveal with 🔍', 'the full link', 'Your own services', own(S.customUnshortenerEndpoint)],
            [code('unshorten.me'), 'eligible short links, and links you reveal with 🔍' + (S.customUnshortenerEndpoint ? ', if your own unshortener gives no answer' : ''), 'the full link', 'Look up short links online',
                onOff(S.enableThirdPartyResolution && (!S.customUnshortenerEndpoint || S.useUnshortenMeFallback))],
            [code('openphish.com, phishing.army'), 'phishing lists: once a day', 'nothing (plain download)', 'Check links against phishing lists', onOff(S.enablePhishingFeeds)],
            [code('freedns.controld.com'), 'each threat check', 'hostname (DNS wire format)', 'Threat-check services → Control D', onOff(S.enableDnsThreatCheck && S.dnsControlD)],
            [code('protective.joindns4.eu'), 'each threat check (if enabled)', 'hostname (DNS wire format)', 'Threat-check services → DNS4EU', onOff(S.enableDnsThreatCheck && S.dnsDns4eu)],
            [code('raw.githubusercontent.com'), 'once a day', 'nothing (plain download)', 'Keep the shortener list up to date', onOff(S.enableRemoteListSync)],
            [code('*.googleusercontent.com'), 'QR check of an email image', 'nothing (fetches the image from Google\'s image proxy, which Gmail already used)', 'Check QR codes in emails', onOff(S.enableQrScanning)],
            [code('storage.googleapis.com, firebasestorage.googleapis.com'), 'only when you click 🔍 on a cloud-storage link', 'a plain download of the page (without the #fragment)', 'Offer to reveal hidden destinations', onOff(S.enableTrackerReveal)],
            ['the websites you link to', 'when you press Send on an email with links', 'one request per link (no page is read), to see that it answers', 'Check links before sending', onOff(S.enableSendCheck)],
            [code('mail.google.com'), 'only for an email with a company-only link or a sender name claiming a brand', 'nothing new: reads that email\'s original source from Gmail itself (your session)', 'Check who sent the email', onOff(S.enableSenderChecks)],
            [code('mail.google.com'), 'opened emails (sender icons on), and read emails in the inbox list (country flags on, not Offline only); once per email, two at a time', 'nothing new: reads the email\'s headers from Gmail itself (your session) for the sender\'s country and verification', 'Show sender icons / Show the sender\'s country', onOff(S.enableSenderIdentity)],
            [code('www.google.com/s2, *.gstatic.com'), 'a new sender site (Gmail; at most once a month per site)', 'the sender\'s site name, for its icon', 'Show sender icons and domain labels', onOff(S.enableSenderIdentity && S.enableDnsThreatCheck)],
            [code('*.googleusercontent.com'), 'a colleague\'s photo, or a company\'s logo, Gmail showed in an opened email (at most once a week per sender or company; verified BIMI logos are embedded in the page and need no request)', 'nothing but the image\'s address, which Gmail already loaded', 'Sender photos and company logos', onOff(S.enableSenderIdentity && S.enableDnsThreatCheck && S.enableSenderAvatars)],
            [code('1.1.1.1'), 'a sender company\'s BIMI and DMARC records (TXT; at most once a week per company, once a day for one found without)', 'the company\'s main domain name', 'Company logos from BIMI', onOff(S.enableSenderIdentity && S.enableDnsThreatCheck && S.enableSenderBimi)],
            ['the company\'s logo server (from its BIMI record)', 'its BIMI logo, loaded by the inbox page as a picture (records checked at most once a week per company, once a day for one found without)', 'your computer\'s IP address, as for any picture a web page shows (no cookies, no referrer)', 'Company logos from BIMI', onOff(S.enableSenderIdentity && S.enableDnsThreatCheck && S.enableSenderBimi)],
            [code('icons.duckduckgo.com'), 'a sender site without its own icon (Gmail; at most once a week per site)', 'the sender\'s site name, for a stand-in icon', 'Stand-in icon for sites without their own', onOff(S.enableSenderIdentity && S.enableDnsThreatCheck && S.enableSenderIconFallback)],
            [code('api.country.is'), 'a new sending server or sender website (at most once a month each)', 'that server\'s IP address', 'Show sender icons + Show the sender\'s country', onOff(S.enableSenderIdentity && S.enableSenderCountry && S.enableDnsThreatCheck)],
            ['the threat-check services above', 'each new sender domain (Gmail; at most every ' + fmtMs(SAFE_CACHE_MS) + ')', 'the sender\'s domain', 'Check sender domains for threats', onOff(S.enableSenderDomainCheck && S.enableDnsThreatCheck)],
            [code('raw.githubusercontent.com'), 'scam-sender list: once a day', 'nothing (plain download)', 'Check sender addresses against phishing lists', onOff(S.enablePhishingFeeds && S.enableSenderAddressCheck)],
            [code('raw.githubusercontent.com') + ' · ' + code('tranco-list.eu'), 'popular-sites lists: once a month', 'nothing (plain download)', 'Catch look-alike senders', onOff(S.enableLookalikeCheck && S.enableRemoteListSync)],
            [code('data.iana.org') + ' · the domain\'s registry', 'a sender domain one letter away from a protected one, or a popular name plus a word like "billing" (at most once a month each)', 'the sender\'s domain, for its registration date', 'Catch look-alike senders', onOff(S.enableLookalikeCheck && S.enableDnsThreatCheck)],
            [code('www.whois.com'), 'only when you click a WHOIS button', 'the IP address shown', 'you', '—']
        ]));

        // Logging
        fill('archLogging', list([
            `Levels: error (needs attention; also shown in the popup), warning (a problem the extension worked around), info (routine events).`,
            `Identical messages within ${fmtMs(LOG_DEDUPE_MS)} are merged with a count.`,
            `Limits: ${MAX_ERROR_LOGS} log entries, ${MAX_HISTORY} history entries, ${MAX_ACTIVITY} popup activity entries; all are also deleted after the auto-delete period (${S.retentionDays} days now).`,
            'Error messages contain only a link\'s origin (https://host/…), never its path or query. History keeps full links except one-time links, which are redacted.',
            'Uncaught errors in the background page, Options page and popup are captured; from Gmail only this extension\'s own failures are reported.'
        ]));

        // Settings reference
        const typeText = (d) => d.type === 'integer' ? `integer ${d.min}–${d.max}` : d.type === 'enum' ? d.values.join(' | ') : d.type;
        fill('archSettings', table(['Setting', 'Policy key (Chrome, Firefox)', 'Type', 'Default', 'Now'], SETTING_DEFS.map(d => [
            code(d.key), code(d.managedKey), typeText(d), d.def === '' ? '(empty)' : String(d.def),
            d.secret ? (S[d.key] ? '•••••• (hidden)' : '(empty)') + (cfg.locked[d.key] ? ' 🔒' : '')
                     : (S[d.key] === '' ? '(empty)' : String(S[d.key])) + (cfg.locked[d.key] ? ' 🔒' : '')
        ])), el('p', null, 'Also: ', code('managedAllowlist'), ' and ', code('managedBlocklist'), ' (arrays of domains), merged with your own lists; ', code('managedTrustedSenders'), ' (the allow list, merged with your trusted senders), addresses or domains. ',
               'Settings marked as secret (request headers) are never exported to backups.'));

        // This installation
        chrome.storage.local.get(null, (items) => {
            const ls = items.listState || {};
            // Every list the extension downloads, with its terms and its state here.
            const link = (name, href) => el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, name);
            const when = (t) => t ? `updated ${new Date(t).toLocaleString()}` : 'not downloaded yet';
            const pop = items.popularDomains || {};
            const popSources = pop.sources || {};
            const shortenerRow = (name, home, u) => { const src = (ls.sources || {})[u];
                const row = [link(name, home), 'which sites are link shorteners (only links on them are looked up)', 'once a day', 'see the project'];
                if (!S.enableRemoteListSync) return [...row, 'off (Keep the shortener list up to date)', '—', '—'];
                return [...row, src && src.lastSuccess ? `${(src.active || []).length.toLocaleString()} domains` : 'the bundled snapshot meanwhile',
                    src ? Object.keys(src.pending || {}).length.toLocaleString() : '0', when(src && src.lastSuccess)]; };
            const feedUse = { openphish: 'known phishing links', phishingarmy: 'known phishing sites', sefinekemails: 'known scam and phishing sender addresses (Gmail)' };
            fill('archAllLists', table(['List', 'Used for', 'Downloaded', 'License or terms', 'In use', 'New entries on hold', 'Last update'], [
                shortenerRow('PeterDaveHello/url-shorteners', 'https://github.com/PeterDaveHello/url-shorteners', REMOTE_LIST_URLS[0]),
                shortenerRow('boutetnico/url-shorteners', 'https://github.com/boutetnico/url-shorteners', REMOTE_LIST_URLS[1]),
                ...PHISH_FEEDS.map(f => { const r = items[`feed_${f.id}`]; const on = S.enablePhishingFeeds && (!f.requires || S[f.requires]);
                    const row = [link(f.name, f.home), feedUse[f.id] || '', 'once a day', f.license];
                    return on ? [...row, r ? `${r.count.toLocaleString()} entries` : '—', 'not held', when(r && r.updated)] : [...row, 'off', '—', '—']; }),
                ...[['Chrome UX Report top list', 'https://github.com/zakird/crux-top-lists', 'crux', 'data by Google, CC BY 4.0'], ['Tranco', 'https://tranco-list.eu', 'tranco', 'free research list (KU Leuven and others)']].map(([name, home, id, terms]) => {
                    const row = [link(name, home), `popular sites (top ${POPULAR_TOP.toLocaleString()}) protected from look-alike senders`, 'once a month', terms];
                    if (!(S.enableLookalikeCheck && S.enableRemoteListSync)) return [...row, 'off (Catch look-alike senders)', '—', '—'];
                    return [...row, popSources[id] ? `${(pop.count || 0).toLocaleString()} sites, both lists together` : '—', 'not held', when(popSources[id])]; })
            ]), el('p', null, 'Only the short-link lists hold new entries back; why the others don\'t is under Safeguards below.'));
            const cacheCount = Object.keys(items).filter(k => k.startsWith('http://') || k.startsWith('https://')).length;
            const locked = Object.keys(cfg.locked).length;
            fill('archState',
                table(['Item', 'Value'], [
                    ['Version', chrome.runtime.getManifest().version],
                    ['Settings set by your organization', locked ? `${locked}` : 'none'],
                    ['Downloaded lists', 'see Downloaded lists above'],
                    ['Cached link results', cacheCount.toLocaleString()],
                    ['History entries', (items.resolutionHistory || []).length.toLocaleString()],
                    ['Application log entries', (items.errorLogs || []).length.toLocaleString()]
                ]));
        });
    }

    // Keep live sections current while they are on screen. Changes are coalesced (Gmail can write the
    // cache and logs while this page is open) and nothing is done when Help isn't visible.
    let liveTimer = null;
    chrome.storage.onChanged.addListener(() => {
        clearTimeout(liveTimer);
        liveTimer = setTimeout(() => {
            const active = document.querySelector('.help-section.active');
            if (!active || !document.getElementById('tab-help').classList.contains('active')) return;
            if (active.id === 'help-architecture') renderArchitecture();
            if (active.id === 'help-privacy') renderPrivacyTable();
        }, 1000);
    });
})();
