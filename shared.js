// shared.js — loaded by the service worker (importScripts), the Gmail content script,
// the popup and the options page, so every part of the extension uses ONE definition of
// settings, domain lists and link-analysis rules.

// ---------------------------------------------------------------------------
// SETTINGS
// Every setting can be changed by the user (stored in chrome.storage.local) and can be
// locked by a Google Workspace / Chrome policy (chrome.storage.managed, keys = managedKey).
// A managed value always wins and the UI shows the setting as locked.
// All features are ON by default.
// ---------------------------------------------------------------------------
const SETTING_DEFS = [
    // Link protection
    { key: 'enableLinkUnmasking',         managedKey: 'managedEnableLinkUnmasking',         def: true, type: 'boolean' },
    // 🔍 on email tracking links: on request, send the link to the lookup service to reveal its destination.
    { key: 'enableTrackerReveal',         managedKey: 'managedEnableTrackerReveal',         def: true, type: 'boolean' },
    // QR codes (email images and attachments) are decoded on this device; their destinations are checked like links.
    // Local phishing lists (OpenPhish community feed, Phishing Army), downloaded periodically and matched on the device.
    { key: 'enablePhishingFeeds',         managedKey: 'managedEnablePhishingFeeds',         def: true, type: 'boolean' },
    // Sender checks (Gmail): reads the open email's authentication results from Gmail when needed.
    { key: 'enableSenderChecks',          managedKey: 'managedEnableSenderChecks',          def: true, type: 'boolean' },
    // Checks the links in an email being sent (Gmail) when Send is pressed.
    { key: 'enableSendCheck',             managedKey: 'managedEnableSendCheck',             def: true, type: 'boolean' },
    // Sender identity (Gmail): the sender's site icon and domain label, in the inbox and in opened emails.
    { key: 'enableSenderIdentity',        managedKey: 'managedEnableSenderIdentity',        def: true, type: 'boolean' },
    // A site without its own icon gets its parent domain's, or DuckDuckGo's icon service's (a second
    // icon service, asked only for such sites); re-checked weekly so the site's own icon replaces it.
    { key: 'enableSenderIconFallback',    managedKey: 'managedEnableSenderIconFallback',    def: true, type: 'boolean' },
    // Sender photos and company logos, as the webmail itself shows them in opened emails, in place of
    // the site icon: colleagues' own photos (the user's own organization), and one logo per other
    // company, learned from a verified email from its shared mailbox or with a BIMI logo.
    { key: 'enableSenderAvatars',         managedKey: 'managedEnableSenderAvatars',         def: true, type: 'boolean' },
    // Size of sender pictures in the inbox list: auto follows Gmail's display density (Default: large
    // 36-pixel circles; Comfortable: medium 32; Compact: small icons in line with the country flag).
    { key: 'senderPictureSize',           managedKey: 'managedSenderPictureSize',           def: 'auto', type: 'enum', values: ['auto', 'large', 'medium', 'inline'] },
    // Look-alike senders (inbox rows, nothing opened): domains imitating a popular site, a well-known
    // brand, your organization or a domain your mail has verified; and names that don't match the address.
    { key: 'enableLookalikeCheck',        managedKey: 'managedEnableLookalikeCheck',        def: true, type: 'boolean' },
    // A sender's name that is the user's own email address or mailbox name, on someone else's address
    // (inbox rows, nothing opened): a scam trick to look like a notice about the user's own account.
    { key: 'enableOwnNameCheck',          managedKey: 'managedEnableOwnNameCheck',          def: true, type: 'boolean' },
    // "Call this number" scams: a phone number with purchase or support wording in the subject (inbox
    // rows, nothing opened) or with "if you didn't make this purchase" in an opened email.
    { key: 'enableCallbackScamCheck',     managedKey: 'managedEnableCallbackScamCheck',     def: true, type: 'boolean' },
    // BIMI logos: the company logo a domain publishes in DNS, shown without opening any email.
    { key: 'enableSenderBimi',            managedKey: 'managedEnableSenderBimi',            def: true, type: 'boolean' },
    // Row highlighter: the inbox row under the mouse (and selected rows) is highlighted, so it's clear
    // which email a click opens. A see-through color, so text stays readable in light and dark themes.
    { key: 'enableRowHighlighter',        managedKey: 'managedEnableRowHighlighter',        def: true, type: 'boolean' },
    { key: 'rowHighlightColor',           managedKey: 'managedRowHighlightColor',           def: 'yellow', type: 'enum', values: ['yellow', 'blue', 'green', 'pink', 'purple', 'gray'] },
    { key: 'rowHighlightStyle',           managedKey: 'managedRowHighlightStyle',           def: 'both', type: 'enum', values: ['both', 'fill', 'outline'] },
    { key: 'rowHighlightSelected',        managedKey: 'managedRowHighlightSelected',        def: true, type: 'boolean' },
    // Ticked emails get their own color (not the mouse's by default, so the two aren't confused).
    { key: 'rowHighlightSelectedColor',   managedKey: 'managedRowHighlightSelectedColor',   def: 'blue', type: 'enum', values: ['yellow', 'blue', 'green', 'pink', 'purple', 'gray'] },
    // Warn when another installed extension does the same job in the webmail (two sender-icon or
    // row-highlight extensions can conflict), with one-click fixes. Administrators can switch it off.
    { key: 'enableConflictWarnings',      managedKey: 'managedEnableConflictWarnings',      def: true, type: 'boolean' },
    // A button beside the sender of an opened email that copies their address.
    { key: 'enableCopyAddress',           managedKey: 'managedEnableCopyAddress',           def: true, type: 'boolean' },
    // Country flag of the server that sent the email (the domain's ending when it can't be looked up).
    { key: 'enableSenderCountry',         managedKey: 'managedEnableSenderCountry',         def: true, type: 'boolean' },
    // Sender domains checked against the threat services and phishing lists (Gmail).
    { key: 'enableSenderDomainCheck',     managedKey: 'managedEnableSenderDomainCheck',     def: true, type: 'boolean' },
    // Sender addresses checked against known phishing senders: the administrator's, the user's and the community list.
    { key: 'enableSenderAddressCheck',    managedKey: 'managedEnableSenderAddressCheck',    def: true, type: 'boolean' },
    // Emails from a flagged sender are moved to Spam (never unverified, unknown or clean ones); once only per email.
    { key: 'enableAutoSpam',              managedKey: 'managedEnableAutoSpam',              def: true, type: 'boolean' },
    // Flagged emails found by a search are moved too (not a search in Spam, Trash, Sent, Drafts or everywhere).
    { key: 'enableAutoSpamInSearch',      managedKey: 'managedEnableAutoSpamInSearch',      def: true, type: 'boolean' },
    // A short notice at the top of Gmail when emails were moved, with a link to the Spam folder.
    { key: 'enableSpamNotice',            managedKey: 'managedEnableSpamNotice',            def: true, type: 'boolean' },
    { key: 'enableSpamFolderFlags',       managedKey: 'managedEnableSpamFolderFlags',       def: true, type: 'boolean' },
    { key: 'enableQrScanning',           managedKey: 'managedEnableQrScanning',            def: true, type: 'boolean' },
    { key: 'enableAttachmentScanning',    managedKey: 'managedEnableAttachmentScanning',    def: true, type: 'boolean' },
    // Other webmail (experimental): the extension also works on these sites.
    { key: 'enableOutlookSupport',        managedKey: 'managedEnableOutlookSupport',        def: true, type: 'boolean' },
    { key: 'enableProtonSupport',         managedKey: 'managedEnableProtonSupport',         def: true, type: 'boolean' },
    { key: 'enableYahooSupport',          managedKey: 'managedEnableYahooSupport',          def: true, type: 'boolean' },
    { key: 'enableAolSupport',            managedKey: 'managedEnableAolSupport',            def: true, type: 'boolean' },
    { key: 'enableZohoSupport',           managedKey: 'managedEnableZohoSupport',           def: true, type: 'boolean' },
    { key: 'enableIcloudSupport',         managedKey: 'managedEnableIcloudSupport',         def: true, type: 'boolean' },
    { key: 'enableFastmailSupport',       managedKey: 'managedEnableFastmailSupport',       def: true, type: 'boolean' },
    { key: 'enableGmxSupport',            managedKey: 'managedEnableGmxSupport',            def: true, type: 'boolean' },
    { key: 'enableOneTimeLinkProtection', managedKey: 'managedEnableOneTimeLinkProtection', def: true, type: 'boolean' },
    { key: 'enableMismatchWarnings',      managedKey: 'managedEnableMismatchWarnings',      def: true, type: 'boolean' },
    { key: 'enableHiddenLinkProtection',  managedKey: 'managedEnableHiddenLinkProtection',  def: true, type: 'boolean' },
    { key: 'enableClickConfirmation',     managedKey: 'managedEnableClickConfirmation',     def: true, type: 'boolean' },
    { key: 'visualOverridesActive',       managedKey: 'managedVisualOverrides',             def: true, type: 'boolean' },
    // Tracking pixels
    { key: 'enableTrackingPixelBlocking', managedKey: 'managedEnableTrackingPixelBlocking', def: true, type: 'boolean' },
    { key: 'removeTrackingPixels',        managedKey: 'managedRemoveTrackingPixels',        def: true, type: 'boolean' },
    // Data sharing (see Settings → Privacy level)
    { key: 'enableThirdPartyResolution',  managedKey: 'managedEnableThirdPartyResolution',  def: true, type: 'boolean' },
    { key: 'enableDnsThreatCheck',        managedKey: 'managedEnableDnsThreatCheck',        def: true, type: 'boolean' },
    { key: 'dnsQuad9',                    managedKey: 'managedDnsQuad9',                    def: true, type: 'boolean' },
    { key: 'dnsCloudflareSecurity',       managedKey: 'managedDnsCloudflareSecurity',       def: true, type: 'boolean' },
    // Adult-content filter: on by default; a match flags the link. Users can turn it off.
    { key: 'dnsCloudflareFamily',         managedKey: 'managedDnsCloudflareFamily',         def: true, type: 'boolean' },
    // AdGuard is a BACKUP resolver: only queried when no primary security resolver answers.
    { key: 'dnsControlD',                 managedKey: 'managedDnsControlD',                 def: true, type: 'boolean' },
    { key: 'dnsDns4eu',                   managedKey: 'managedDnsDns4eu',                   def: false, type: 'boolean' },
    { key: 'dnsAdGuard',                  managedKey: 'managedDnsAdGuard',                  def: true, type: 'boolean' },
    { key: 'enableRemoteListSync',        managedKey: 'managedEnableRemoteListSync',        def: true, type: 'boolean' },
    // Local data
    { key: 'enableResultCache',           managedKey: 'managedEnableResultCache',           def: true, type: 'boolean' },
    { key: 'enableHistoryLog',            managedKey: 'managedEnableHistoryLog',            def: true, type: 'boolean' },
    { key: 'retentionDays',               managedKey: 'managedRetentionDays',               def: 30,   type: 'integer', min: 1, max: 365 },
    // Custom threat resolver (Settings → Your own services). Placeholders: {hostname}, {url}.
    { key: 'customDohEndpoint',           managedKey: 'managedDohEndpoint',                 def: '',   type: 'string' },
    { key: 'customDohMethod',             managedKey: 'managedDohMethod',                   def: 'GET', type: 'enum', values: ['GET', 'POST'] },
    { key: 'customDohBody',               managedKey: 'managedDohBody',                     def: '',   type: 'string' },
    { key: 'customDohHeaders',            managedKey: 'managedDohHeaders',                  def: '',   type: 'string', secret: true },
    { key: 'customDohFlagField',          managedKey: 'managedDohFlagField',                def: '',   type: 'string' },
    // Custom unshortener (Settings → Your own services). Placeholders: {url}, {url_noscheme}, {hostname}.
    { key: 'customUnshortenerEndpoint',   managedKey: 'managedUnshortenerEndpoint',         def: '',   type: 'string' },
    { key: 'customUnshortenerMethod',     managedKey: 'managedUnshortenerMethod',           def: 'GET', type: 'enum', values: ['GET', 'POST'] },
    { key: 'customUnshortenerBody',       managedKey: 'managedUnshortenerBody',             def: '',   type: 'string' },
    { key: 'customUnshortenerHeaders',    managedKey: 'managedUnshortenerHeaders',          def: '',   type: 'string', secret: true },
    { key: 'customUnshortenerField',      managedKey: 'managedUnshortenerField',            def: '',   type: 'string' },
    // When a custom unshortener is set: still fall back to unshorten.me if it gives no answer?
    { key: 'useUnshortenMeFallback',      managedKey: 'managedUseUnshortenMeFallback',      def: true, type: 'boolean' }
];
// secret: true => may hold API keys; never written to exported backups.

const SETTING_BY_KEY = Object.fromEntries(SETTING_DEFS.map(d => [d.key, d]));

function coerceSetting(def, value) {
    if (def.type === 'boolean') return typeof value === 'boolean' ? value : undefined;
    if (def.type === 'string') return typeof value === 'string' ? value.trim() : undefined;
    if (def.type === 'enum') {
        if (typeof value !== 'string') return undefined;
        // Any spelling ("post", "Blue") becomes the allowed value as defined ("POST", "blue").
        const v = value.trim().toLowerCase();
        return def.values.find(x => x.toLowerCase() === v);
    }
    if (def.type === 'integer') {
        if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
        return Math.min(def.max, Math.max(def.min, Math.round(value)));
    }
    return undefined;
}

function normalizeDomain(value) {
    return String(value || '').trim().toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
        .replace(/[\/?#].*$/, '')
        .replace(/^\*\./, '')
        .replace(/\.$/, '');
}

function normalizeDomainList(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map(normalizeDomain).filter(Boolean))];
}

// Phishing-sender entries: a full address ("billing@paypa1.com") or a whole domain ("paypa1.com",
// "@paypa1.com", "*@paypa1.com"; subdomains included). Anything else is dropped.
const SENDER_DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
function normalizeSenderEntry(value) {
    const v = String(value || '').trim().toLowerCase().replace(/^mailto:/, '').replace(/^<|>$/g, '').replace(/^\*?@/, '').replace(/\.$/, '');
    const at = v.lastIndexOf('@');
    if (at < 0) return SENDER_DOMAIN_RE.test(v) ? v : '';
    const local = v.slice(0, at), domain = v.slice(at + 1);
    return local && local.length <= 64 && !/[\s@<>()",;:]/.test(local) && SENDER_DOMAIN_RE.test(domain) ? `${local}@${domain}` : '';
}
function normalizeSenderList(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map(normalizeSenderEntry).filter(Boolean))].slice(0, 20000);
}
// The entry that lists this address (exact address, or its domain or a parent domain), else null.
function senderListMatch(address, set) {
    const a = String(address || '').trim().toLowerCase();
    if (!a || !set || !set.size) return null;
    if (set.has(a)) return a;
    const parts = a.slice(a.lastIndexOf('@') + 1).split('.');
    for (let i = 0; i < parts.length - 1; i++) {
        const d = parts.slice(i).join('.');
        if (set.has(d)) return d;
    }
    return null;
}

function storageGetOnce(area, keys, timeoutMs) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (value) => { if (!done) { done = true; resolve(value); } };
        const timer = setTimeout(() => finish(null), timeoutMs);   // null = no answer in time
        try {
            if (!chrome.storage || !chrome.storage[area]) { clearTimeout(timer); return finish({}); }
            chrome.storage[area].get(keys, (result) => {
                clearTimeout(timer);
                if (chrome.runtime.lastError || !result) return finish({});
                finish(result);
            });
        } catch (e) {
            clearTimeout(timer);
            finish({});
        }
    });
}

// A storage read that can never hang. Some Chromium builds never answer the first
// chrome.storage.managed.get() made while a page is loading, which used to leave the options page
// with every switch shown as off. A read that does not answer is retried once; a second
// non-answer counts as "nothing stored" so the page still renders.
async function storageGet(area, keys) {
    const first = await storageGetOnce(area, keys, 1500);
    if (first !== null) return first;
    const second = await storageGetOnce(area, keys, 3000);
    return second !== null ? second : {};
}

// Returns the effective configuration: user values overridden by managed policy.
async function loadEffectiveSettings() {
    const defaults = {};
    SETTING_DEFS.forEach(d => { defaults[d.key] = d.def; });
    defaults.customAllowlist = [];
    defaults.customBlocklist = [];
    defaults.remoteShorteners = [];
    defaults.customTrustedSenders = [];

    const local = await storageGet('local', defaults);
    const managed = await storageGet('managed', null);

    const values = {};
    const locked = {};
    SETTING_DEFS.forEach(d => {
        const managedValue = coerceSetting(d, managed[d.managedKey]);
        // A managed empty string for the DoH endpoint is "not set", not a lock.
        if (managedValue !== undefined && !(d.type === 'string' && managedValue === '')) {
            values[d.key] = managedValue;
            locked[d.key] = true;
        } else {
            const localValue = coerceSetting(d, local[d.key]);
            values[d.key] = localValue !== undefined ? localValue : d.def;
        }
    });

    const managedAllowlist = normalizeDomainList(managed.managedAllowlist);
    const managedBlocklist = normalizeDomainList(managed.managedBlocklist);
    const managedTrustedSenders = normalizeSenderList(managed.managedTrustedSenders);
    return {
        values,
        locked,
        managedAllowlist,
        managedBlocklist,
        managedTrustedSenders,
        allowlist: [...new Set([...normalizeDomainList(local.customAllowlist), ...managedAllowlist])],
        blocklist: [...new Set([...normalizeDomainList(local.customBlocklist), ...managedBlocklist])],
        // Trusted senders (the allow list) by the user and the organization. There is no sender block
        // list: Gmail's own Report spam covers that.
        trustedSenders: [...new Set([...normalizeSenderList(local.customTrustedSenders), ...managedTrustedSenders])],
        remoteShorteners: Array.isArray(local.remoteShorteners) ? local.remoteShorteners : [],
        // Administrator-only policies: set by policy alone (no setting in the extension, not in backups).
        policy: {
            hideSettingsButton: managed.managedHidePopupSettingsButton === true,
            hideRecentActivity: managed.managedHideRecentActivity === true,
            phishSimRules: normalizePhishSimRules(managed.managedPhishSimulationRules),
            ...splitSimulationDomains(normalizeDomainList(managed.managedPhishSimulationDomains).slice(0, 500))
        }
    };
}

// ---------------------------------------------------------------------------
// DOMAIN LISTS
// ---------------------------------------------------------------------------

// Public URL shorteners: generic, not per-recipient. Safe to resolve over the network.
const publicShorteners = [
    'bit.ly', 't.co', 'tinyurl.com', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly',
    'rebrand.ly', 'bl.ink', 'rb.gy', 'v.gd', 'j.mp', 'lnkd.in', 'db.tt',
    'qr.ae', 'snip.ly', 'adf.ly', 'shorte.st', 't2m.io', 'kurzelinks.de',
    'goo.gl', 'share.google', 'search.app', 'wp.me', 'short.io', 'x.co', 'tiny.cc', 'clk.im', 'b.link',
    'flyn.im', 'flyn.to',
    // Big brands' own short-link domains (looked up like any shortener)
    'c.gle', 'g.co', 'goo.gle', 'youtu.be', 'aka.ms', 'msft.it', 'amzn.to', 'amzn.eu', 'a.co', 'fb.me', 'apple.co', 'spoti.fi', 'adobe.ly', 'ebay.to'
];

// Email-service-provider click trackers: per-recipient, may wrap reset / unsubscribe /
// confirmation links. Flagged as trackers, but NEVER requested over the network.
const espTrackers = [
    'klclick.com', 'klclick1.com', 'klclick2.com', 'klclick3.com', 'klaviyo.com', 'klaviyomail.com',
    'rs6.net', 'mktoweb.com', 'exacttarget.com', 'acemlna.com', 'acems1.com',
    'kit-mail3.com', 'ck.page', 'convertkit-mail.com', 'awstrack.me',
    'list-manage.com', 'sendgrid.net', 'hubapi.com', 'omnisend.com',
    'campaign-archive.com', 'mailchi.mp', 'aweber.com', 'infusionsoft.com',
    'keap-link.com', 'sg.us-west-2.awstrack.me', 'ct.sendgrid.net',
    'sparkpost.com', 'sparkpostmail.com', 'sparkpostmail2.com', 'e.sparkpost.com', 'spmta.com',
    'click.pstmrk.it', 'mandrillapp.com', 'mailgun.net',
    'pardot.com', 'iterable.com', 'braze.com', 'sendinblue.com'
];

const defaultShorteners = [...publicShorteners, ...espTrackers];

// Exact host or a real subdomain of it. Never a substring match: "evilgoogle.com" does not
// match "google.com", and "evil.com/?x=urldefense.com" does not match "urldefense.com".
function hostMatches(hostname, domain) {
    const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
    const d = String(domain || '').toLowerCase();
    return h === d || h.endsWith('.' + d);
}

// COMPACT LOOKUP LISTS. A large list of strings (a downloaded phishing or shortener list, the
// remembered Spam moves) kept as one sorted block of text plus an index of where each entry starts,
// and searched by halving (about 17 steps for 150,000 entries). It takes about a third of the memory
// of a Set of the same entries and builds in milliseconds. Lists are stored sorted, so building one
// only checks the order (an unsorted or old copy is sorted then). Works wherever a Set's has() is used.
function compactSet(entries) {
    let text = Array.isArray(entries) ? entries.join('\n') : String(entries || '');
    const index = (t) => {
        const starts = [];
        let sorted = true, prev = null;
        for (let p = 0; p < t.length;) {
            let e = t.indexOf('\n', p);
            if (e < 0) e = t.length;
            if (e > p) {
                const v = t.slice(p, e);
                if (prev !== null && v < prev) sorted = false;
                prev = v;
                starts.push(p);
            }
            p = e + 1;
        }
        return { starts, sorted };
    };
    let { starts, sorted } = index(text);
    if (!sorted) {
        text = [...new Set(text.split('\n').filter(Boolean))].sort().join('\n');
        starts = index(text).starts;
    }
    const at = new Uint32Array(starts);
    const entryAt = (i) => { const e = text.indexOf('\n', at[i]); return text.slice(at[i], e < 0 ? text.length : e); };
    return {
        size: at.length,
        has(value) {
            const s = String(value);
            let lo = 0, hi = at.length - 1;
            while (lo <= hi) {
                const mid = (lo + hi) >>> 1, v = entryAt(mid);
                if (v === s) return true;
                if (v < s) lo = mid + 1; else hi = mid - 1;
            }
            return false;
        },
        text: () => text
    };
}

function hostInSet(hostname, set) {
    const parts = String(hostname || '').toLowerCase().split('.');
    for (let i = 0; i < parts.length - 1; i++) {
        if (set.has(parts.slice(i).join('.'))) return true;
    }
    return false;
}

// Approximation of the registrable domain (no full public-suffix list): two-level country endings
// (co.uk, com.au, sch.uk…) and the US locality domains (state.us; k12, cc, lib… under a state, as
// school districts use: "example.k12.fl.us" is its own domain, not part of "fl.us").
const SECOND_LEVEL_LABELS = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'sch', 'ltd', 'plc', 'me',
    'nhs', 'police', 'mod', 'mil', 'gob', 'gouv', 'nom', 'biz', 'info', 'int', 'gv', 'k12', 'res', 'web', 'firm', 'gen', 'ind']);
const US_STATES = new Set(['al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'dc', 'fl', 'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la',
    'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc',
    'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'as', 'gu', 'mp', 'pr', 'vi']);
const US_STATE_SUBS = new Set(['k12', 'cc', 'lib', 'tec', 'gen', 'mus', 'state', 'dst', 'cog']);
const US_K12_SUBS = new Set(['pvt', 'chtr', 'paroch']);
function registrableDomain(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
    const parts = host.split('.');
    if (parts.length <= 2) return host;
    const tld = parts[parts.length - 1];
    const sld = parts[parts.length - 2];
    if (tld === 'us' && US_STATES.has(sld)) {
        // <st>.us, k12.<st>.us (and pvt.k12.<st>.us…), cc/lib/… .<st>.us are endings, like co.uk.
        let suffix = 2;
        if (US_STATE_SUBS.has(parts[parts.length - 3])) suffix = 3;
        if (suffix === 3 && parts[parts.length - 3] === 'k12' && US_K12_SUBS.has(parts[parts.length - 4])) suffix = 4;
        return parts.length > suffix ? parts.slice(-(suffix + 1)).join('.') : host;
    }
    if (tld.length === 2 && SECOND_LEVEL_LABELS.has(sld)) return parts.slice(-3).join('.');
    return parts.slice(-2).join('.');
}

// Structural check for short links on shorteners that are not on any list (new services,
// private domains). Matches the typical shape: a bare two-label domain with a 2-letter country
// TLD, no query string, and one short random-looking code, e.g. https://flyn.im/Eb1kG7.
// This only decides whether the link may be resolved; one-time-link protection still applies first.
function looksLikeShortLink(urlString) {
    let u;
    try { u = new URL(urlString); } catch (e) { return false; }
    if (u.search || u.hash || u.username || u.password || u.port) return false;
    const parts = u.hostname.toLowerCase().split('.');
    if (parts.length !== 2) return false;
    const [label, tld] = parts;
    if (tld.length !== 2 || label.length > 8) return false;
    const segments = u.pathname.split('/').filter(Boolean);
    if (segments.length !== 1) return false;
    const code = segments[0];
    if (!/^[A-Za-z0-9_-]{4,12}$/.test(code)) return false;
    return /\d/.test(code) || (/[a-z]/.test(code) && /[A-Z]/.test(code));
}

// ---------------------------------------------------------------------------
// ONE-TIME / UNSUBSCRIBE LINK DETECTION
// Links matching these patterns are never requested over the network, never cached,
// and never logged in full. They are only unwrapped by strict offline decoders.
// ---------------------------------------------------------------------------
const SINGLE_USE_PATH_RE = /\/(reset|forgot|password|passwd|verify|verification|validate|activate|activation|confirm|confirmation|login|log-in|signin|sign-in|signup|sign-up|auth|oauth|magic|otp|invitation|invite|accept|approve|redeem|claim|rsvp|unsubscribe|unsub|optout|opt-out|optin|opt-in|subscribe|preferences|manage|remove)(?=[\/_.?#&=-]|$)/i;
const SINGLE_USE_PARAM_RE = /(token|code|auth|key|nonce|ticket|sig|signature|magic|otp|hash|session|jwt|reset|verify|confirm|unsub\w*|optout)=/i;
const SINGLE_USE_TEXT_RE = /\b(reset|forgot|password|verify|verification|confirm|activate|log ?in|sign ?in|unsubscribe|unsub|opt[- ]?out|manage (?:your )?(?:email )?(?:preferences|subscription)|update (?:your )?preferences|accept (?:the )?invitation|approve|redeem|claim|magic link|one[- ]time)\b/i;

function isSingleUseToken(urlString, linkText = '') {
    let haystack = urlString || '';
    try { haystack += ' ' + decodeURIComponent(urlString); } catch (e) {}
    try { haystack += ' ' + decodeURIComponent(decodeURIComponent(urlString)); } catch (e) {}
    return SINGLE_USE_PATH_RE.test(haystack) ||
           SINGLE_USE_PARAM_RE.test(haystack) ||
           SINGLE_USE_TEXT_RE.test(linkText || '');
}

function redactOneTimeUrl(urlString) {
    try { return `${new URL(urlString).origin}/[one-time link redacted]`; }
    catch (e) { return '[one-time link redacted]'; }
}

// ---------------------------------------------------------------------------
// LINK ANALYSIS (used by the content script)
// ---------------------------------------------------------------------------

// True for anchors deliberately hidden with font-size:0 or near-zero opacity.
// Takes an element's inline CSSStyleDeclaration. (A substring test on "font-size: 0"
// would wrongly match "font-size: 0.9em", so the value is parsed.)
function isGhostAnchorStyle(style) {
    if (!style) return false;
    if (style.fontSize !== '' && style.fontSize !== undefined && parseFloat(style.fontSize) === 0) return true;
    if (style.opacity !== '' && style.opacity !== undefined && parseFloat(style.opacity) <= 0.01) return true;
    return false;
}

// Link text such as "meson.build", "README.md" or "setup.py" is a file name, not a website, even though
// .build, .md, .py, .sh, .zip… are also real internet endings. Bare text ending in one of these is not
// treated as a claim about where the link goes.
const FILE_EXTENSION_TLDS = new Set([
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', 'png', 'jpg', 'jpeg', 'gif', 'svg',
    'txt', 'csv', 'html', 'htm', 'php', 'asp', 'aspx', 'mp3', 'mp4', 'mov', 'json', 'xml', 'js', 'css', 'ics',
    'build', 'md', 'py', 'sh', 'rs', 'pl', 'so', 'ps', 'ai', 'mk', 'ml', 'app', 'gz', 'tar', 'exe', 'dmg', 'iso',
    'log', 'cfg', 'ini', 'yml', 'yaml', 'toml', 'lock', 'sql', 'bak', 'vue', 'tsx', 'jsx', 'kt', 'swift', 'java',
    'cpp', 'hpp', 'rb', 'go', 'ts', 'cs', 'lua', 'cmake', 'mod', 'sum', 'conf', 'env', 'csproj', 'sln', 'gradle'
]);

// Companies that own several domains, including their own short-link domains. Link text and destination
// within one family are consistent (text "gmail.com" pointing to google.com, or Google's c.gle).
const BRAND_FAMILIES = [
    { name: 'Google',    labels: ['google'], domains: ['gmail.com', 'youtube.com', 'youtu.be', 'android.com', 'withgoogle.com', 'blogger.com', 'googleblog.com', 'c.gle', 'g.co', 'goo.gle', 'goo.gl', 'gle'] },
    { name: 'Microsoft', labels: [], domains: ['microsoft.com', 'microsoftonline.com', 'live.com', 'office.com', 'outlook.com', 'microsoft365.com', 'office365.com', 'azure.com', 'windows.com', 'xbox.com', 'bing.com', 'skype.com', 'sharepoint.com', 'aka.ms', 'msft.it', 'onedrive.com', '1drv.ms', 'sharepointonline.com', 'microsoftpersonalcontent.com', 'svc.ms', 'microsoftstore.com', 'msn.com', 'azure.net', 'powerbi.com', 'dynamics.com', 'visualstudio.com'] },
    { name: 'Amazon',    labels: ['amazon'], domains: ['amzn.to', 'amzn.eu', 'a.co', 'primevideo.com', 'audible.com'] },
    { name: 'Meta',      labels: [], domains: ['facebook.com', 'facebookmail.com', 'fb.com', 'fb.me', 'instagram.com', 'whatsapp.com', 'messenger.com', 'meta.com', 'threads.net'] },
    { name: 'PayPal',    labels: ['paypal'], domains: ['paypal.com'] },
    { name: 'Apple',     labels: [], domains: ['apple.com', 'icloud.com', 'apple.co', 'me.com'] },
    { name: 'LinkedIn',  labels: [], domains: ['linkedin.com', 'lnkd.in'] },
    { name: 'X',         labels: [], domains: ['twitter.com', 'x.com', 't.co'] }
];
function brandOfDomain(regDomain) {
    if (!regDomain) return null;
    const label = regDomain.split('.')[0];
    const f = BRAND_FAMILIES.find(b => b.domains.includes(regDomain) || b.labels.includes(label));
    return f ? f.name : null;
}

// How serious a problem found by detectLinkProblem is:
//   'danger'  — deliberate deception (look-alike brand domains, hidden user names): red, "DO NOT CLICK"
//   'caution' — suspicious but common in legitimate mail (text shows another site, raw IP address,
//               international characters): amber, "Caution"
function linkProblemSeverity(problem) {
    if (!problem) return null;
    return /^look-alike domain|username\/password|\(a well-known brand\)/.test(problem) ? 'danger' : 'caution';
}

// Returns a human-readable problem description, or null if the link looks consistent.
//  visibleText : text the reader sees for the link
//  originalUrl : href as written in the email
//  finalUrl    : destination after unwrapping
//  trackerDomains : Set of shortener / tracker domains (destination unresolved => skip text check)
function detectLinkProblem(visibleText, originalUrl, finalUrl, trackerDomains) {
    let dest;
    try { dest = new URL(finalUrl); } catch (e) { return null; }
    const host = dest.hostname.toLowerCase();

    if (dest.username || dest.password) {
        return 'link hides its real destination behind a username/password prefix';
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) {
        return 'link points to a raw IP address instead of a domain name';
    }
    { const la = lookalikeOf(host); if (la) return `look-alike domain: ${host} ${la}`; }   // imitates a well-known brand
    { const sr = signInRedirectProblem(finalUrl); if (sr) return sr; }
    if (host.split('.').some(label => label.startsWith('xn--'))) {
        return 'link uses an internationalized (punycode) domain that can imitate a trusted site';
    }

    const text = String(visibleText || '').trim();
    if (!text) return null;
    const whole = text.match(/^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?:[\/?#]\S*)?$/i);
    const embedded = text.match(/\bhttps?:\/\/((?:[a-z0-9-]+\.)+[a-z]{2,})/i) ||
                     text.match(/\b(www\.(?:[a-z0-9-]+\.)+[a-z]{2,})/i);
    const found = whole || embedded;
    if (!found) return null;

    const textHost = found[1].toLowerCase();
    const textTld = textHost.split('.').pop();
    if (FILE_EXTENSION_TLDS.has(textTld)) return null;

    const textDomain = registrableDomain(textHost);
    const destDomain = registrableDomain(host);
    if (textDomain === destDomain) return null;
    { const brand = brandOfDomain(textDomain); if (brand && brand === brandOfDomain(destDomain)) return null; }   // same company

    let originalHost = '';
    try { originalHost = new URL(originalUrl).hostname.toLowerCase(); } catch (e) {}
    if (originalHost && registrableDomain(originalHost) === textDomain) return null; // text is just the (short)link itself
    if (trackerDomains && (hostInSet(host, trackerDomains) || hostInSet(textHost, trackerDomains))) return null; // unresolved tracker
    if (emailTrackerProvider(finalUrl)) return null; // unresolved email tracker (incl. branded domains): its host says nothing about the destination

    // Text that shows a well-known brand's address while going elsewhere is a classic phishing trick.
    if (PROTECTED_BRANDS.includes(textDomain)) return `link text shows ${textHost} (a well-known brand) but the link goes to ${host}`;
    return `link text shows ${textHost} but the link goes to ${host}`;
}

// ---------------------------------------------------------------------------
// BACKUP / RESTORE
// Format 2 (5.11+) backups contain only the settings the user actually changed, so defaults always
// come from the installed version: a default changed in a later version is never undone by
// restoring an older backup. Cached link results are never restored (they are rebuilt automatically
// and could otherwise carry outdated or tampered verdicts).
// ---------------------------------------------------------------------------
const BACKUP_FORMAT = 2;
const MAX_IMPORTED_DOMAINS = 5000;

// Older (format 1) backups wrote EVERY setting, including untouched defaults. For a setting whose
// default has changed between versions, those values cannot be told apart from a deliberate
// choice, so they are not restored. (Cloudflare Family was off by default only in 5.9.)
const LEGACY_AMBIGUOUS_VALUES = {
    dnsCloudflareFamily: { values: [false], label: 'Cloudflare Family adult-content filter', keep: 'on' }
};

// Valid custom endpoint: empty (not set) or an https:// address once placeholders are filled in.
function isValidDohEndpoint(value) {
    if (value === '') return true;
    if (!/^https:\/\//i.test(value)) return false;
    const filled = value.replace(/\{(hostname|url|url_noscheme)\}/g, 'example.com');
    try { new URL(filled); return true; } catch (e) { return false; }
}

function buildBackup(allItems, extensionVersion) {
    const backup = {
        exportFormat: BACKUP_FORMAT,
        extensionVersion: extensionVersion || '',
        exportDate: new Date().toLocaleString(),
        customAllowlist: normalizeDomainList(allItems.customAllowlist),
        customBlocklist: normalizeDomainList(allItems.customBlocklist),
        customTrustedSenders: normalizeSenderList(allItems.customTrustedSenders),
        settings: {},
        urlCacheNote: 'Included for your records only. Cached results are not restored on import; they are rebuilt automatically.',
        secretsNote: 'Request headers for custom resolvers (which may contain API keys) are not included. Re-enter them after restoring.',
        urlCache: {}
    };
    SETTING_DEFS.forEach(d => {
        if (!Object.prototype.hasOwnProperty.call(allItems, d.key)) return;   // never changed: use the installed default
        if (d.secret) return;                                                  // API keys are never exported
        const v = coerceSetting(d, allItems[d.key]);
        if (v !== undefined) backup.settings[d.key] = v;
    });
    Object.keys(allItems).forEach(k => {
        if (k.startsWith('http://') || k.startsWith('https://')) backup.urlCache[k] = allItems[k];
    });
    return backup;
}

// Decides what a restore will do, without touching storage.
//  data    : parsed backup file
//  current : { customAllowlist, customBlocklist, customTrustedSenders } currently stored
//  mode    : 'merge' | 'overwrite'
// Returns { updates, removeKeys, notes, settingsCount, cacheCount, legacy }.
function planImport(data, current, mode) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('This file is not a backup from this extension.');
    }
    const legacy = !(Number(data.exportFormat) >= BACKUP_FORMAT);
    const notes = [];
    const updates = {};
    const removeKeys = [];

    // Domain lists: normalized and size-limited.
    const lists = [['customAllowlist', 'allowlist', normalizeDomainList], ['customBlocklist', 'blocklist', normalizeDomainList],
                   ['customTrustedSenders', 'trusted sender', normalizeSenderList]];
    lists.forEach(([key, label, normalize]) => {
        if (key === 'customTrustedSenders' && !Array.isArray(data[key])) return;   // older backups don't have this list
        let incoming = normalize(data[key]);
        if (incoming.length > MAX_IMPORTED_DOMAINS) {
            notes.push(`Only the first ${MAX_IMPORTED_DOMAINS} ${label} entries were restored.`);
            incoming = incoming.slice(0, MAX_IMPORTED_DOMAINS);
        }
        updates[key] = mode === 'overwrite'
            ? incoming
            : [...new Set([...normalize(current && current[key]), ...incoming])];
    });

    // Feature settings: known keys with valid types only.
    const incoming = {};
    if (data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
        Object.keys(data.settings).forEach(k => {
            const def = SETTING_BY_KEY[k];
            if (!def || def.secret) return;
            const v = coerceSetting(def, data.settings[k]);
            if (v !== undefined) incoming[k] = v;
        });
    }
    if (legacy) {
        // Format 1 also stored these two at the top level.
        if (!('removeTrackingPixels' in incoming) && typeof data.removeTrackingPixels === 'boolean') {
            incoming.removeTrackingPixels = data.removeTrackingPixels;
        }
        if (!('customDohEndpoint' in incoming) && typeof data.customDohEndpoint === 'string') {
            incoming.customDohEndpoint = data.customDohEndpoint.trim();
        }
        Object.keys(LEGACY_AMBIGUOUS_VALUES).forEach(k => {
            const rule = LEGACY_AMBIGUOUS_VALUES[k];
            if (k in incoming && rule.values.includes(incoming[k])) {
                delete incoming[k];
                notes.push(`${rule.label}: left ${rule.keep}. This older backup cannot show whether it was switched off on purpose; change it in Settings if you want it off.`);
            }
        });
    }
    if ('customUnshortenerEndpoint' in incoming) {
        if (!isValidDohEndpoint(incoming.customUnshortenerEndpoint)) {
            delete incoming.customUnshortenerEndpoint;
            notes.push('Custom unshortener: not restored, because it is not a valid https:// address.');
        } else if (incoming.customUnshortenerEndpoint === '' && mode === 'merge') {
            delete incoming.customUnshortenerEndpoint;
        } else if (incoming.customUnshortenerEndpoint) {
            notes.push('Custom unshortener restored. Open Settings → Your own services and click its Save button so your browser can grant it access.');
        }
    }
    if ('customDohEndpoint' in incoming) {
        if (!isValidDohEndpoint(incoming.customDohEndpoint)) {
            delete incoming.customDohEndpoint;
            notes.push('Custom resolver: not restored, because it is not a valid https:// address.');
        } else if (incoming.customDohEndpoint === '' && mode === 'merge') {
            delete incoming.customDohEndpoint;          // merging never clears an existing resolver
        } else if (incoming.customDohEndpoint) {
            notes.push('Custom resolver restored. Open Settings → Your own services and click Save service so your browser can grant it access.');
        }
    }
    Object.assign(updates, incoming);

    // Overwrite: settings missing from the backup go back to the installed defaults.
    if (mode === 'overwrite') {
        SETTING_DEFS.forEach(d => { if (!d.secret && !(d.key in incoming)) removeKeys.push(d.key); });
    }

    const cacheCount = data.urlCache && typeof data.urlCache === 'object' ? Object.keys(data.urlCache).length : 0;
    if (cacheCount) notes.push(`${cacheCount} cached link result(s) in the backup were not restored; they are rebuilt automatically as you open mail.`);

    return { updates, removeKeys, notes, settingsCount: Object.keys(incoming).length, cacheCount, legacy };
}

// ---------------------------------------------------------------------------
// APPLICATION LOG REPORTING from the Options page and popup (the background writes the entry, so all
// writes are serialized in one place). level: 'error' | 'warning' | 'info'.
// ---------------------------------------------------------------------------
function reportToLog(level, source, message) {
    try {
        chrome.runtime.sendMessage({ action: 'logEvent', level, source, message: String(message) }, () => { void chrome.runtime.lastError; });
    } catch (e) { /* the extension is being reloaded */ }
}

// Records uncaught failures of an extension page in the application log.
function installPageErrorLogging(source) {
    if (typeof window === 'undefined') return;
    window.addEventListener('error', (e) => {
        reportToLog('error', source, `Unexpected error: ${e.message || e.error}${e.filename ? ` (${String(e.filename).split('/').pop()}:${e.lineno})` : ''}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
        const r = e.reason;
        reportToLog('error', source, `Unhandled failure: ${r && r.message ? r.message : r}`);
    });
}

// ---------------------------------------------------------------------------
// CONSTANTS SHARED WITH THE HELP PAGE
// Defined here (not in background.js) so the Help → Architecture page displays the exact values the
// extension runs on, instead of a copy that could drift.
// ---------------------------------------------------------------------------
const REMOTE_LIST_URLS = [
    'https://raw.githubusercontent.com/PeterDaveHello/url-shorteners/master/list',
    'https://raw.githubusercontent.com/boutetnico/url-shorteners/master/list.txt'
];

const REMOTE_LIST_MAX_BYTES = 2 * 1024 * 1024;

const REMOTE_LIST_MAX_DOMAINS = 50000;

const PROTECTED_DOMAINS = new Set([
    'google.com', 'gmail.com', 'googleusercontent.com', 'googleapis.com', 'youtube.com', 'gstatic.com',
    'microsoft.com', 'outlook.com', 'office.com', 'office365.com', 'live.com', 'sharepoint.com', 'microsoftonline.com',
    'apple.com', 'icloud.com', 'amazon.com', 'amazonaws.com', 'facebook.com', 'instagram.com', 'whatsapp.com',
    'linkedin.com', 'twitter.com', 'x.com', 'github.com', 'gitlab.com', 'paypal.com', 'stripe.com',
    'dropbox.com', 'box.com', 'zoom.us', 'slack.com', 'salesforce.com', 'docusign.com', 'docusign.net',
    'adobe.com', 'wikipedia.org', 'cloudflare.com', 'okta.com', 'atlassian.net', 'atlassian.com', 'notion.so', 'figma.com'
]);

const REMOTE_LIST_HOLD_SIGHTINGS = 3;                          // seen on 3 separate days

const REMOTE_LIST_SIGHTING_GAP_MS = 20 * 60 * 60 * 1000;       // sightings at least 20 h apart

const REMOTE_LIST_FRESH_START_MS = 7 * 24 * 60 * 60 * 1000;    // gap after which a download is a new start

const REMOTE_LIST_MAX_CHANGE_RATIO = 0.25;                     // > 25% changed in one download => hold it

const REMOTE_LIST_MIN_CHANGE_LIMIT = 250;                      // ...but always allow up to 250 changes

const JSON_DNS_PROVIDERS = [
    { id: 'dnsCloudflareSecurity', name: 'Cloudflare Security', role: 'primary', reason: 'Malware or Phishing (Cloudflare Security)', url: h => `https://security.cloudflare-dns.com/dns-query?name=${h}&type=A` },
    { id: 'dnsCloudflareFamily',   name: 'Cloudflare Family',   role: 'content', reason: 'Adult content (Cloudflare Family)',            url: h => `https://family.cloudflare-dns.com/dns-query?name=${h}&type=A` },
    { id: 'dnsAdGuard',            name: 'AdGuard (backup)',    role: 'backup',  reason: 'Malware, phishing or tracking (AdGuard DNS backup resolver)', url: h => `https://dns.adguard-dns.com/resolve?name=${h}&type=A` }
];
const MAX_ERROR_LOGS = 200;
const MAX_HISTORY = 50;
const MAX_ACTIVITY = 10;
const LOG_DEDUPE_MS = 10 * 60 * 1000;       // identical messages within 10 minutes are counted, not repeated
const SAFE_CACHE_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// PRIVACY LEVELS (Settings → Privacy level). Each level sets these three switches; any other
// combination is shown as "Custom".
// ---------------------------------------------------------------------------
const PRIVACY_PRESETS = {
    standard: { label: 'Standard',     values: { enableThirdPartyResolution: true,  enableDnsThreatCheck: true,  enableRemoteListSync: true,  enablePhishingFeeds: true } },
    private:  { label: 'Private',      values: { enableThirdPartyResolution: false, enableDnsThreatCheck: true,  enableRemoteListSync: true,  enablePhishingFeeds: true } },
    offline:  { label: 'Offline only', values: { enableThirdPartyResolution: false, enableDnsThreatCheck: false, enableRemoteListSync: false, enablePhishingFeeds: false } }
};

function currentPreset(values) {
    for (const [id, p] of Object.entries(PRIVACY_PRESETS)) {
        if (Object.entries(p.values).every(([k, v]) => values[k] === v)) return id;
    }
    return 'custom';
}

// A level is unavailable if it would need to change a setting locked by policy to another value.
function presetAvailable(id, cfg) {
    return Object.entries(PRIVACY_PRESETS[id].values).every(([k, v]) => !cfg.locked[k] || cfg.values[k] === v);
}

// ---------------------------------------------------------------------------
// EMAIL-PROVIDER CLICK TRACKERS
// Their destination is stored on the provider's servers and is only revealed by following the link,
// which registers a click as the recipient (and can unsubscribe or sign in). They are recognized
// three ways: the built-in domain list, provider domain families, and provider path signatures,
// which also catch "branded" tracking domains such as links.yourbank.com run by SendGrid.
// ---------------------------------------------------------------------------
const EMAIL_TRACKER_HOST_PATTERNS = [
    { re: /(^|\.)sendibm\d*\.com$/i, provider: 'Brevo/Sendinblue' },
    { re: /(^|\.)sendibt\d*\.com$/i, provider: 'Brevo/Sendinblue' },
    { re: /(^|\.)klclick\d*\.com$/i, provider: 'Klaviyo' }
];
const EMAIL_TRACKER_PATH_SIGNATURES = [
    { test: (u) => /^\/(ls|wf)\/click$/i.test(u.pathname) && u.searchParams.has('upn'), provider: 'SendGrid' },
    { test: (u) => /^\/mk\/(cl|mr)\//i.test(u.pathname), provider: 'Brevo/Sendinblue' },
    { test: (u) => /^\/track\/click$/i.test(u.pathname) && u.searchParams.has('u') && u.searchParams.has('id'), provider: 'Mailchimp' }
];

// Returns the provider name (or 'an email provider') if the URL is a click tracker, else null.
function emailTrackerProvider(urlString) {
    let u;
    try { u = new URL(urlString); } catch (e) { return null; }
    const host = u.hostname.toLowerCase();
    for (const p of EMAIL_TRACKER_HOST_PATTERNS) if (p.re.test(host)) return p.provider;
    for (const p of EMAIL_TRACKER_PATH_SIGNATURES) if (p.test(u)) return p.provider;
    if (hostInSet(host, ESP_TRACKER_SET)) return 'an email provider';
    return null;
}

// Built once (the arrays never change at runtime) instead of on every lookup.
const PUBLIC_SHORTENER_SET = new Set(publicShorteners);
const ESP_TRACKER_SET = new Set(espTrackers);
const BUILTIN_TRACKER_SET = new Set([...publicShorteners, ...espTrackers]);

// ---------------------------------------------------------------------------
// OPEN-PIXEL ADDRESSES
// Definitive tracking pixels: these URLs exist only to record that an email was opened, so they are
// blocked at any size. Sources: Ugly Email and Leave Me Alone tracker lists, EasyPrivacy, and the
// providers' own URL formats. Everything else is judged by size (see checkPixel in content.js).
// ---------------------------------------------------------------------------
const OPEN_PIXEL_RULES = [
    { name: 'SendGrid',        test: (u) => /\/wf\/open$/i.test(u.pathname) && u.searchParams.has('upn') },
    { name: 'Mailchimp',       test: (u) => hostMatches(u.hostname, 'list-manage.com') && /\/track\/open\.php$/i.test(u.pathname) },
    { name: 'HubSpot',         test: (u) => /\/e2t\/o\//i.test(u.pathname) || /^t\.(hubspotemail\.net|signaux|sidekickopen)/i.test(u.hostname) },
    { name: 'Brevo',           test: (u) => (/(^|\.)sendibt\d*\.com$/i.test(u.hostname) && /\/tr\/op\//i.test(u.pathname)) || /^\/mk\/op\//i.test(u.pathname) },
    { name: 'Salesforce Marketing Cloud', test: (u) => /^click\./i.test(u.hostname) && /\/open\.aspx$/i.test(u.pathname) },
    { name: 'Postmark',        test: (u) => hostMatches(u.hostname, 'pstmrk.it') && /^\/open/i.test(u.pathname) },
    { name: 'Mailgun',         test: (u) => /^\/e\/o\//.test(u.pathname) },
    { name: 'Marketo',         test: (u) => /\/trk$/i.test(u.pathname) && u.searchParams.has('t') },
    { name: 'ActiveCampaign',  test: (u) => /\/lt\.php$/i.test(u.pathname) && u.searchParams.get('l') === 'open' },
    { name: 'Shopify Email',   test: (u) => /\/tools\/emails\/open\//i.test(u.pathname) },
    { name: 'Amazon SES',      test: (u) => hostMatches(u.hostname, 'awstrack.me') && /^\/I0\//.test(u.pathname) },
    { name: 'Klaviyo',         test: (u) => /^\/o\/[0-9A-HJKMNP-TV-Z]{26}$/.test(u.pathname) },     // click.brand.com/o/<ULID>
    { name: 'Open tracker',    test: (u) => /^(trk|ctrk|track|tracking|open|t)\d*\./i.test(u.hostname) && /\/open(\/|\.|$)/i.test(u.pathname) }
];

// Name of the provider whose open pixel this is, or null.
function openPixelRule(urlString) {
    let u;
    try { u = new URL(urlString); } catch (e) { return null; }
    for (const r of OPEN_PIXEL_RULES) { try { if (r.test(u)) return r.name; } catch (e) { /* ignore */ } }
    return null;
}

// ---------------------------------------------------------------------------
// WEB PAGES HOSTED IN CLOUD STORAGE
// Phishing kits host a tiny HTML redirector in a public bucket (storage.googleapis.com, Firebase,
// S3, Azure, R2, IPFS) because the domain is trusted and never blocked by DNS filters. Recipient or
// campaign data rides in the #fragment, which is never sent to the server. Legitimate email almost
// never links to a raw HTML file in a bucket.
// ---------------------------------------------------------------------------
const CLOUD_STORAGE_PLATFORMS = [
    { re: /^storage\.googleapis\.com$/i,            name: 'Google Cloud Storage', bucket: true, inspectable: true },
    { re: /^firebasestorage\.googleapis\.com$/i,    name: 'Firebase Storage',     bucket: true, inspectable: true },
    { re: /\.storage\.googleapis\.com$/i,           name: 'Google Cloud Storage', bucket: true },
    { re: /(^|\.)s3[.-]([a-z0-9-]+\.)?amazonaws\.com$/i, name: 'Amazon S3',       bucket: true },
    { re: /\.blob\.core\.windows\.net$/i,           name: 'Azure Blob Storage',   bucket: true },
    { re: /\.r2\.dev$/i,                            name: 'Cloudflare R2',        bucket: true },
    { re: /^(ipfs\.io|dweb\.link|cloudflare-ipfs\.com|gateway\.pinata\.cloud)$|\.ipfs\.(dweb\.link|w3s\.link|nftstorage\.link)$/i, name: 'IPFS gateway', bucket: true },
    { re: /\.(web\.app|firebaseapp\.com)$/i,        name: 'Firebase Hosting' },
    { re: /\.pages\.dev$/i,                         name: 'Cloudflare Pages' },
    { re: /\.web\.core\.windows\.net$/i,            name: 'Azure Static Websites' }
];

// Decodes data hidden in a URL fragment: base64 "key=value" tracking data, or an email address.
function decodeFragmentPayload(hash) {
    const raw = String(hash || '').replace(/^#/, '').replace(/^[?/!]+/, '');
    if (!raw) return null;
    const looksLike = (s) => {
        if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s)) return 'email';
        if (/^[\w.-]+=[^&]*(&[\w.-]+=[^&]*)+$/.test(s)) return 'tracking';
        return null;
    };
    let plain = raw;
    try { plain = decodeURIComponent(raw); } catch (e) { /* keep raw */ }
    if (looksLike(plain)) return { kind: looksLike(plain), decoded: plain, encoded: false };
    if (/^[A-Za-z0-9+/_-]{8,}={0,2}$/.test(raw)) {
        try {
            const bin = atob(raw.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(raw.length / 4) * 4, '='));
            if (/^[\x20-\x7e]+$/.test(bin) && looksLike(bin)) return { kind: looksLike(bin), decoded: bin, encoded: true };
        } catch (e) { /* not base64 */ }
    }
    return null;
}

// Returns { platform, inspectable, reason, fragment } when the URL is a suspicious page on a cloud
// storage or hosting platform, else null.
function cloudStoragePage(urlString) {
    let u;
    try { u = new URL(urlString); } catch (e) { return null; }
    const host = u.hostname.toLowerCase();
    const p = CLOUD_STORAGE_PLATFORMS.find(x => x.re.test(host));
    if (!p) return null;
    let path = u.pathname;
    try { path = decodeURIComponent(path); } catch (e) { /* keep */ }
    const isHtml = /\.(s?html?|xhtml|svg|php)$/i.test(path) || p.name === 'IPFS gateway';
    const fragment = decodeFragmentPayload(u.hash);
    // Buckets: any HTML page. Hosting platforms (also used by real sites): only with hidden fragment data.
    if (!(p.bucket ? isHtml : !!fragment)) return null;
    let reason = `Web page hosted in public cloud storage (${p.name}), a common phishing technique`;
    if (fragment) reason = `Pre-targeted link: page in public cloud storage (${p.name}) carrying hidden ${fragment.kind === 'email' ? 'recipient' : 'tracking'} data`;
    return { platform: p.name, inspectable: !!p.inspectable, reason, fragment };
}

// Finds where a downloaded redirector page sends visitors, by reading its code (never running it).
// Covers meta refresh, location assignments/replace/assign and "'http://' + variable" building.
function extractRedirectTargets(html) {
    const text = String(html || '').slice(0, 512 * 1024);
    const found = [];
    const add = (u) => { if (u && /^https?:\/\//i.test(u) && !found.includes(u)) found.push(u); };
    const vars = {};
    for (const m of text.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"]{1,300})\2/g)) vars[m[1]] = m[3];
    for (const m of text.matchAll(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*url\s*=\s*([^"'>\s]+)/gi)) add(m[1]);
    for (const m of text.matchAll(/(?:location(?:\.href)?|location\.replace|location\.assign|window\.open)\s*(?:=|\()\s*([^;\n]{1,400})/g)) {
        // evaluate simple concatenations of string literals and known variables
        let out = '';
        let ok = true;
        for (const part of m[1].split('+')) {
            const t = part.trim().replace(/\)\s*$/, '');
            const lit = t.match(/^(['"`])(.*)\1$/);
            if (lit) out += lit[2];
            else if (vars[t] !== undefined) out += vars[t];
            else { if (out) break; ok = false; break; }
        }
        if (ok || out) add(out);
    }
    for (const m of text.matchAll(/["'](https?:\/\/[^"'\s<>]{4,300})["']/g)) add(m[1]);
    return found;
}

// ---------------------------------------------------------------------------
// MORE PROTECTIVE RESOLVERS (RFC 8484 wire format, no account). Block signals differ by provider, so
// answers are interpreted generically: a sinkhole address (0.0.0.0, 127.x, ::) or an NXDOMAIN for a
// name the reference resolver can resolve both count as a block.
// ---------------------------------------------------------------------------
const WIRE_DNS_PROVIDERS = [
    { id: 'dnsControlD', name: 'Control D (malware)', role: 'primary', reason: 'Malware or Phishing (Control D)', url: 'https://freedns.controld.com/p1' },
    { id: 'dnsDns4eu',   name: 'DNS4EU Protective',   role: 'primary', reason: 'Malware or Phishing (DNS4EU)',    url: 'https://protective.joindns4.eu/dns-query' }
];

// ---------------------------------------------------------------------------
// PHISHING LISTS: downloaded periodically, matched on the device (no lookups, nothing sent).
// OpenPhish: exact phishing URLs. Phishing Army: phishing hostnames (CC BY-NC 4.0). Sefinek: scam and
// phishing sender addresses (MIT).
// ---------------------------------------------------------------------------
const PHISH_FEEDS = [
    { id: 'openphish',    name: 'OpenPhish community feed', url: 'https://openphish.com/feed.txt', kind: 'url', license: 'OpenPhish Terms of Use', home: 'https://openphish.com' },
    { id: 'phishingarmy', name: 'Phishing Army (extended)', url: 'https://phishing.army/download/phishing_army_blocklist_extended.txt', kind: 'domain', license: 'CC BY-NC 4.0', home: 'https://phishing.army' },
    // Sender addresses used for scams and phishing (exact addresses only), for the sender checks (Gmail).
    { id: 'sefinekemails', name: 'Sefinek scam-sender list', url: 'https://raw.githubusercontent.com/sefinek/Blacklisted-Emails/main/blacklist/LIST.txt', kind: 'address', license: 'MIT', home: 'https://github.com/sefinek/Blacklisted-Emails', requires: 'enableSenderAddressCheck' }
];
// Every third-party list (shortener lists and phishing lists) is downloaded at most once a day, even
// when "Update now" is clicked, out of respect for the projects that publish them for free.
const THIRD_PARTY_LIST_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PHISH_FEED_MAX_BYTES = 40 * 1024 * 1024;
const PHISH_FEED_MAX_ENTRIES = 1500000;
const PHISH_FEED_MIN_ENTRIES = 20;          // a download smaller than this is treated as broken and ignored

// Normalized form used for exact URL matching: lowercase host, no default port, no fragment.
function normalizeFeedUrl(urlString) {
    try {
        const u = new URL(String(urlString).trim());
        if (!/^https?:$/.test(u.protocol)) return null;
        u.hash = '';
        return u.href.replace(/\/$/, '');
    } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// LOOK-ALIKE DOMAINS: names built to resemble a well-known brand.
// ---------------------------------------------------------------------------
const PROTECTED_BRANDS = ['paypal.com', 'microsoft.com', 'office.com', 'office365.com', 'outlook.com', 'live.com', 'apple.com', 'icloud.com',
    'amazon.com', 'netflix.com', 'docusign.com', 'dropbox.com', 'wellsfargo.com', 'chase.com', 'bankofamerica.com', 'citibank.com',
    'capitalone.com', 'americanexpress.com', 'coinbase.com', 'binance.com', 'metamask.io', 'facebook.com', 'instagram.com', 'whatsapp.com',
    'linkedin.com', 'google.com', 'gmail.com', 'youtube.com', 'adobe.com', 'fedex.com', 'usps.com', 'spotify.com', 'steamcommunity.com',
    'roblox.com', 'ebay.com', 'walmart.com', 'target.com', 'costco.com', 'bestbuy.com', 'verizon.com', 'tmobile.com', 'xfinity.com',
    'comcast.com', 'zoom.us', 'slack.com', 'salesforce.com', 'intuit.com', 'quickbooks.com', 'venmo.com', 'zellepay.com', 'cash.app',
    'stripe.com', 'shopify.com', 'github.com', 'twitter.com', 'telegram.org', 'discord.com', 'booking.com', 'airbnb.com', 'norton.com',
    'mcafee.com', 'geeksquad.com', 'dhl.com', 'ups.com', 'irs.gov', 'att.com'];
const CREDENTIAL_WORDS = new Set(['login', 'log', 'signin', 'sign', 'secure', 'security', 'verify', 'verification', 'account', 'accounts',
    'update', 'support', 'billing', 'wallet', 'auth', 'confirm', 'recovery', 'unlock', 'service', 'services', 'help', 'refund', 'payment']);
const CONFUSABLE_MAP = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd',
    'ɡ': 'g', 'һ': 'h', 'ӏ': 'l', 'ο': 'o', 'α': 'a', 'ρ': 'p', 'ν': 'v', 'τ': 't', 'κ': 'k', 'ı': 'i', 'ɑ': 'a', 'ℓ': 'l', 'ⅼ': 'l',
    'á': 'a', 'à': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a', 'å': 'a', 'é': 'e', 'è': 'e', 'ê': 'e', 'ë': 'e', 'í': 'i', 'ì': 'i', 'î': 'i',
    'ï': 'i', 'ó': 'o', 'ò': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o', 'ú': 'u', 'ù': 'u', 'û': 'u', 'ü': 'u', 'ý': 'y', 'ñ': 'n', 'ç': 'c',
    '0': 'o', '1': 'l', '3': 'e', '5': 's' };

// RFC 3492 punycode decoding of one label ("xn--…" without the prefix).
function punycodeDecodeLabel(input) {
    const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
    let n = 128, i = 0, bias = 72;
    const out = [];
    let basic = input.lastIndexOf('-');
    if (basic < 0) basic = 0;
    for (let j = 0; j < basic; j++) out.push(input.charCodeAt(j));
    const adapt = (delta, numPoints, first) => {
        delta = first ? Math.floor(delta / damp) : delta >> 1;
        delta += Math.floor(delta / numPoints);
        let k = 0;
        while (delta > ((base - tMin) * tMax) >> 1) { delta = Math.floor(delta / (base - tMin)); k += base; }
        return k + Math.floor((base - tMin + 1) * delta / (delta + skew));
    };
    for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length;) {
        const oldi = i;
        for (let w = 1, k = base; ; k += base) {
            if (idx >= input.length) return null;
            const c = input.charCodeAt(idx++);
            const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
            if (digit >= base) return null;
            i += digit * w;
            const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
            if (digit < t) break;
            w *= base - t;
        }
        bias = adapt(i - oldi, out.length + 1, oldi === 0);
        n += Math.floor(i / (out.length + 1));
        i %= out.length + 1;
        out.splice(i++, 0, n);
    }
    return String.fromCodePoint(...out);
}

function unicodeLabel(label) {
    if (!/^xn--/i.test(label)) return label;
    try { return punycodeDecodeLabel(label.slice(4).toLowerCase()) || label; } catch (e) { return label; }
}

function confusableSkeleton(label) {
    return Array.from(label.toLowerCase(), ch => CONFUSABLE_MAP[ch] || ch).join('').replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/-/g, '');
}

function editDistanceAtMost1(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++edits > 1) return false;
        if (a.length > b.length) i++;
        else if (a.length < b.length) j++;
        else if (a[i + 1] === b[j] && a[i] === b[j + 1]) { i += 2; j += 2; }   // swapped letters
        else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
}

// Returns a description if `host` imitates a protected brand, else null.
function lookalikeOf(host) {
    host = String(host || '').toLowerCase().replace(/\.$/, '');
    const reg = registrableDomain(host);
    if (!reg) return null;
    for (const brand of PROTECTED_BRANDS) if (hostMatches(host, brand)) return null;   // the real thing
    const label = reg.split('.')[0];
    const uLabel = unicodeLabel(label);
    const skeleton = confusableSkeleton(uLabel);
    const tokens = uLabel.split('-');
    for (const brand of PROTECTED_BRANDS) {
        const bl = brand.split('.')[0];
        if (host.startsWith(brand + '.')) return `starts with "${brand}" but is really ${reg}`;
        if (bl.length < 4) continue;
        if (uLabel !== bl && skeleton === bl) return `imitates ${brand} with look-alike characters`;
        if (bl.length >= 6 && label !== bl && editDistanceAtMost1(label, bl)) return `is one letter away from ${brand}`;
        if (tokens.length > 1 && tokens.includes(bl) && tokens.some(t => CREDENTIAL_WORDS.has(t))) return `uses the name "${bl}" but isn't ${brand}`;
    }
    return null;
}

// ---------------------------------------------------------------------------
// ATTACHMENT ANALYZERS (pure text/byte checks, run on the device)
// ---------------------------------------------------------------------------
// SVG and HTML attachments: phishing kits put scripts, redirects and fake login forms in them.
function analyzeMarkup(text, kind) {
    const t = String(text || '').slice(0, 2 * 1024 * 1024);
    const flags = [];
    const test = (re, label) => { if (re.test(t)) flags.push(label); };
    test(/<script\b/i, 'contains JavaScript');
    if (kind === 'svg') test(/<foreignObject\b/i, 'embeds a web page inside the image');
    test(/\son(load|error|click|mouseover|focus|begin|end|animationstart|pageshow)\s*=/i, 'runs code automatically');
    test(/location(\.href)?\s*=|location\.(replace|assign)\s*\(|window\.open\s*\(/i, 'redirects the browser to another site');
    test(/\batob\s*\(|\bFunction\s*\(|\beval\s*\(|document\.write\s*\(|unescape\s*\(|fromCharCode\s*\(/i, 'hides code from inspection');
    test(/<meta[^>]+http-equiv\s*=\s*["']?refresh/i, 'redirects automatically');
    test(/<form\b[^>]*action\s*=\s*["']?https?:/i, 'sends a form to another site');
    test(/<input\b[^>]*type\s*=\s*["']?password/i, 'asks for a password');
    const urls = new Set(extractRedirectTargets(t));
    for (const m of t.matchAll(/\b(?:href|action|src)\s*=\s*["'](https?:\/\/[^"'\s<>]{4,300})/gi)) urls.add(m[1]);
    for (const m of t.matchAll(/atob\s*\(\s*["'`]([A-Za-z0-9+/=_-]{12,})["'`]\s*\)|["'`](aHR0c[A-Za-z0-9+/=_-]{10,})["'`]/g)) {
        try {
            const dec = atob((m[1] || m[2]).replace(/-/g, '+').replace(/_/g, '/'));
            for (const u of dec.match(/https?:\/\/[\x21-\x7e]{4,300}/g) || []) urls.add(u.replace(/["'<>)]+$/, ''));
        } catch (e) { /* not base64 */ }
    }
    if (/#[^"'\s<>]*[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/i.test(t)) flags.push('carries an email address for a pre-filled fake login');
    // XML namespace identifiers (xmlns="http://www.w3.org/2000/svg" …) look like URLs but aren't links.
    return { flags, urls: [...urls].filter(u => /^https?:\/\//i.test(u) && !/^https?:\/\/www\.w3\.org\//i.test(u)).slice(0, 10) };
}

// Calendar invites (.ics): links in the description/location bypass normal body scanning.
function extractIcsUrls(text) {
    const unfolded = String(text || '').slice(0, 1024 * 1024).replace(/\r?\n[ \t]/g, '').replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';');
    const out = new Set();
    for (const m of unfolded.matchAll(/https?:\/\/[^\s"<>\\]{4,500}/g)) out.add(m[0].replace(/[),.;]+$/, ''));
    return [...out].slice(0, 10);
}

// Encrypted archives can't be scanned by mail filters, which is why attackers send them with the
// password in the email body. Reads only the first bytes.
function archiveInfo(bytes) {
    const b = bytes;
    if (b.length >= 8 && b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) {
        return { format: 'ZIP', encrypted: (b[6] & 1) === 1 };
    }
    if (b.length >= 6 && b[0] === 0x37 && b[1] === 0x7A && b[2] === 0xBC && b[3] === 0xAF && b[4] === 0x27 && b[5] === 0x1C) {
        return { format: '7-Zip', encrypted: null };       // encryption can't be read from the start of the file
    }
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21 && b[4] === 0x1A && b[5] === 0x07) {
        if (b[6] === 0x01 && b[7] === 0x00) {              // RAR5: header CRC (4 bytes), size vint, type vint (4 = encryption header)
            let p = 12;
            while (p < b.length && (b[p] & 0x80)) p++;
            return { format: 'RAR', encrypted: b[p + 1] === 4 ? true : null };
        }
        return { format: 'RAR', encrypted: null };
    }
    return null;
}

// Characters that reverse text direction can disguise "invoice‮fdp.exe" as "invoiceexe.pdf".
function hasDirectionTricks(name) {
    return /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/.test(String(name || ''));
}

// Links that run code or open embedded content instead of a web page.
function riskyScheme(href) {
    const m = /^\s*(javascript|data|vbscript|blob|file):/i.exec(String(href || ''));
    return m ? m[1].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// SUPPORTED WEBMAIL. Shared by the content script (where message bodies are, and how the shared
// engine reads each site) and the popup (which sites are supported). Everything that differs between
// webmail sites is data in this table; the code that uses it is the same for every site. Selectors
// for sites other than Gmail were written from public knowledge of each app and are experimental: if
// a site changes its layout, only this table needs updating.
//   body        message-body containers in the page
//   readFrames  also read same-site frames from the page (messages shown in frames)
//   frameBody   inside a frame on the site, treat the whole frame as the message
//   path        only on these paths (sites that host other apps, such as iCloud)
//   imageParams query parameters of the site's image proxy that hold the original image address
//   imageProxy  { host, originalAfterHash }: a proxy that keeps the original address after "#"
//   attachments how the site's attachment cards are found: cardAttr (an attribute holding
//               "mime:name:address"), link (download links) and linkHref (their address pattern)
//   mail        how the shared engine reads the site's inbox list, opened emails, toolbar and compose
//               window (see SITE_MAIL_FIELDS below). A site without it gets the checks inside opened
//               emails only.
// ---------------------------------------------------------------------------
// The `mail` profile:
//   ownHosts      links to the webmail itself, never checked
//   list          inbox rows: row, container (one list; several shown at once means sections such as
//                 Multiple Inboxes), unread, selected (selectors a row matches), checkbox, sender (elements
//                 holding a sender), nameCell (where the sender's icon goes), subjectCell (its label),
//                 subject (the subject's own text; message.subject: an opened conversation's)
//   senderAttrs   attributes of a sender element: address, name
//   ids           how conversations and messages are named: thread / message / rowLastMessage are lists of
//                 readers, { attr, match } (a pattern whose first group is the id) or { attr, hex }
//                 (a hexadecimal id written as "<hex>:<decimal>"); rowThread and messageHolder are the
//                 elements that carry them
//   openThread    the heading of an open conversation (carries its id)
//   message       container of one opened message, its sender element, and the element after which
//                 the sender's label goes (senderAfter; else right after the sender); avatar: the photo
//                 or logo the webmail shows for the sender (img, the attribute holding its address,
//                 photoHost: where people's photos are loaded from, embeddedLogo: a logo the webmail
//                 writes into the page itself, placeholder: generic images to ignore)
//   toolbar       the toolbar that acts on selected or open conversations; spamAction: an attribute
//                 that marks the Report spam button whatever its language
//   views         inbox: views (address after "#") where emails may be moved to Spam; spam: the Spam
//                 folder's views; spamHref: link to the Spam folder; search: search results, where
//                 flagged emails may be moved too, unless the search matches searchExcludes (a search
//                 in Spam, Trash, Sent…)
//   account       where the signed-in address is shown (fromTitle: the page title)
//   headers       the email's original source, fetched with the user's own session: url (template with
//                 {origin}, {account}, {ik}, {id}), the values filled in, the element holding the text,
//                 and the receiving mail system (host, name) whose own header lines can be trusted
//   compose       the compose window: body, the Send button (label pattern, class) and labels that
//                 aren't Send
// ---------------------------------------------------------------------------
const WEBMAIL_SITES = [
    { id: 'gmail', name: 'Gmail', settingKey: null, host: /^mail\.google\.com$/, body: '.ii.gt',
      attachments: { cardAttr: 'download_url', link: 'a[href*="attid="]', linkHref: /[?&](view=att|disp=(safe|inline|attd))/ },
      // Gmail's image proxy keeps the sender's original address after "#"; the extension fetches
      // proxied images from Google's proxy, never from the sender.
      imageProxy: { host: /^https:\/\/[^/]*\.googleusercontent\.com\//, originalAfterHash: true },
      mail: {
          ownHosts: ['mail.google.com'],
          list: { row: 'tr.zA', container: 'table', unread: '.zE', selected: '.x7', checkbox: '[role="checkbox"]',
                  // Display density (Settings → Density), told from the page: a left-menu item of 28 px or
                  // less (or rows under 36 px) is Compact; attachment chips under a subject are Default; a
                  // paperclip instead of chips is Comfortable.
                  density: { navItem: '[role="navigation"] .TN, .aqn.aIH .TN, .TN, .bzz', compactNavMax: 28, compactRowMax: 35,
                             chips: '.brd .brc', paperclip: '.yf img' },
                  sender: '.yW [email], .yX [email]', nameCell: '.yW, .yX', subjectCell: '.xT, .y6', subject: '.bog' },
          senderAttrs: { address: 'email', name: 'name' },
          ids: {
              thread: [{ attr: 'data-thread-perm-id', match: /^#?(thread-f:\d+)$/ }, { attr: 'data-thread-id', match: /^#?(thread-f:\d+)$/ },
                       { attr: 'data-legacy-thread-id', hex: 'thread-f' }],
              rowThread: '[data-thread-id], [data-legacy-thread-id]',
              rowLastMessage: [{ attr: 'data-legacy-last-message-id', hex: 'msg-f' }],
              message: [{ attr: 'data-message-id', match: /^#?(msg-f:\d+)$/ }, { attr: 'data-legacy-message-id', hex: 'msg-f' }],
              messageHolder: '[data-message-id], [data-legacy-message-id]'
          },
          openThread: 'h2[data-thread-perm-id], h2[data-legacy-thread-id]',
          message: { container: '.adn, [data-message-id], .gs', sender: '.gD[email]', senderAfter: '.go', subject: 'h2.hP',
                     // The photo or logo Gmail shows beside the sender (its hovercard id is the address).
                     // It sits in its own column of the whole message (scope: .adn), beside the box that
                     // holds the body (.gs), so it is looked for in the whole message.
                     // Gmail embeds a verified brand logo (BIMI) in the page itself as a data: image;
                     // it loads the picture of a Google account from googleusercontent.com, in any
                     // address format (the "/a/…" kind and the older "/-xxxx/AAAAAAAAAAI/…/photo.jpg").
                     avatar: { scope: '.adn, [data-message-id]', img: 'img[data-hovercard-id]', addressAttr: 'data-hovercard-id',
                               // Google's profile-photo hosts only (lh3…lh6), never the image proxy
                               // (ci3.googleusercontent.com…) that pictures inside emails go through.
                               photoHost: /^https:\/\/lh\d+\.googleusercontent\.com\//,
                               embeddedLogo: /^data:image\/(png|gif|jpeg|webp|svg\+xml)[;,]/i,
                               placeholder: /default-user|\/ic_|anonymous/i } },
          toolbar: '[gh="mtb"], [gh="tm"]',
          spamAction: { attr: 'act', value: '9' },
          views: { inbox: /^(inbox(\/.*)?|category\/[a-z]+(\/.*)?)?$/, spam: /^(spam(\/|$)|search\/.*in(:|%3A)spam)/i, spamHref: '#spam',
                   search: /^(search|advanced-search)\/./i,
                   searchExcludes: /\b(in|is|label):(spam|trash|anywhere|sent|drafts?|chats?|scheduled)\b|\bsubset=(spam|trash|anywhere|sent|drafts?|chats?)\b/i },
          account: { fromTitle: true },
          headers: {
              url: '{origin}/mail/u/{account}/?{ik}view=om&permmsgid={id}',
              values: {
                  account: { path: /\/mail\/u\/(\d+)/, fallback: '0' },
                  // Gmail's account key: from the page's GLOBALS script, else from any link that carries it.
                  ik: { script: /GLOBALS\s*=\s*\[((?:[^\]]){0,3000})/, field: 9, linkParam: 'ik', valid: /^[0-9a-f]{8,12}$/i, format: 'ik={value}&' }
              },
              text: '#raw_message_text, pre.raw_message_text, pre',
              receiver: { host: 'mx.google.com', name: 'Gmail' }
          },
          compose: { body: 'div[contenteditable="true"][g_editable="true"], div[contenteditable="true"][role="textbox"]',
                     send: /^send\b/i, sendClass: 'aoO', notSend: /schedule|later|more send options/i }
      } },
    { id: 'outlook',  name: 'Outlook on the web', settingKey: 'enableOutlookSupport',
      host: /(^|\.)outlook\.(live|office|office365)\.com$|^outlook\.cloud\.microsoft$/,
      body: '[aria-label="Message body"], [role="document"]', imageParams: ['url', 'Url'] },
    { id: 'proton',   name: 'Proton Mail', settingKey: 'enableProtonSupport',
      host: /^mail\.proton\.me$/, body: '[data-shortcut-target="message-container"] .message-content',
      readFrames: true, frameBody: true, imageParams: ['Url', 'url'] },
    { id: 'yahoo',    name: 'Yahoo Mail', settingKey: 'enableYahooSupport',
      host: /^mail\.yahoo\.com$/, body: '[data-test-id="message-view-body-content"], [data-test-id="message-view-body"]', imageParams: ['url', 'u'] },
    { id: 'aol',      name: 'AOL Mail', settingKey: 'enableAolSupport',
      host: /^mail\.aol\.com$/, body: '[data-test-id="message-view-body-content"], [data-test-id="message-view-body"]', imageParams: ['url', 'u'] },
    { id: 'zoho',     name: 'Zoho Mail', settingKey: 'enableZohoSupport',
      host: /^mail\.(zoho\.(com|eu|in|com\.au|jp|sa)|zohocloud\.ca)$/, body: '.zmMailContent, .zmPVContent, [class*="mail-content"]',
      readFrames: true, imageParams: ['url'] },
    { id: 'icloud',   name: 'iCloud Mail', settingKey: 'enableIcloudSupport',
      host: /^(www\.)?icloud\.com$/, path: /^\/(mail|applications\/mail)/, body: '.mail-message-defaults, [class*="message-body"], [class*="MessageBody"]',
      readFrames: true, frameBody: true, imageParams: ['url'] },
    { id: 'fastmail', name: 'Fastmail', settingKey: 'enableFastmailSupport',
      host: /^(app|www|beta)\.fastmail\.com$/, body: '.v-Message-body, .v-MessageBody, [class*="Message-body"]', imageParams: ['url'] },
    { id: 'gmx',      name: 'GMX', settingKey: 'enableGmxSupport',
      host: /(^|\.)gmx\.(com|net|de|at|ch|co\.uk|fr|es)$/, body: '.mail-body, .mail-content, [class*="mail-detail"]',
      readFrames: true, frameBody: true, imageParams: ['url', 'u'] }
];

// Elements that hold a sender's address in a webmail page, as most webmail write it: an attribute with
// the address, a title such as "Jane Doe <jane@example.com>", a mailto: link or a screen-reader label.
const SENDER_HOLDERS = '[email], [data-email], [data-address], [title*="@"], a[href^="mailto:"], [aria-label*="@"]';
// "Unread" as webmail say it to screen readers, in the languages the extension's other labels cover.
const UNREAD_WORDS = /\b(unread|ungelesen|non lu|no leído|non letto|niet gelezen|nieprzeczytan\w*|não lida|oläst|ulæst|ulest)\b/i;

// The generic profile, used on a supported site whose entry has no `mail` profile of its own. It finds
// what well-built webmail exposes to screen readers and in plain attributes: inbox rows (by their
// accessibility roles, and only rows that show a sender's address), the sender of an opened email
// (the address shown just before its body), and unread state (the row's accessibility label). It is
// read-only: it never clicks, so moving to Spam and the Send check wait for a site's own, verified
// entry. Header checks need a site's original-source page, which only a site's own entry can describe.
const GENERIC_MAIL = {
    generic: true,
    list: { row: '[role="listbox"] [role="option"], [role="grid"] [role="row"], [role="table"] [role="row"], [role="list"] [role="listitem"]',
            unreadLabel: UNREAD_WORDS, checkbox: '[role="checkbox"]', sender: SENDER_HOLDERS },
    senderAttrs: { address: ['email', 'data-email', 'data-address', 'title', 'href', 'aria-label'], name: ['name', 'data-name'], extract: true },
    message: { near: SENDER_HOLDERS }
};

// What the shared engine can do on a site, from what its entry describes (used by the content script
// and by the compatibility chart in Help, so the two always agree). Each is true (the site's own
// entry describes it), 'generic' (found through the generic profile) or false. A site entry without a
// `mail` profile gets the generic one; `mail: null` means none at all.
function mailCapabilities(site) {
    const M = site && site.mail !== undefined ? site.mail : GENERIC_MAIL;
    const how = (has) => has ? (M.generic ? 'generic' : true) : false;
    return {
        list: how(!!(M && M.list)),                           // sender icons, labels and checks in the inbox list
        opened: how(!!(M && M.message)),                      // sender checks, icons and labels in opened emails
        headers: !!(M && !M.generic && M.headers),            // signs in the original source; server country
        move: !!(M && !M.generic && M.list && M.toolbar && M.views),   // moving flagged emails to Spam
        compose: !!(M && !M.generic && M.compose),            // checking links before sending
        avatars: !!(M && !M.generic && M.message && M.message.avatar),   // sender photos and company logos
        account: !!(M && !M.generic && M.account && M.account.fromTitle),   // the signed-in address (own-name check)
        attachments: !!(site && site.attachments)             // attachment checks
    };
}

// The webmail's own warnings about a sender, shown around an opened email (never inside its body,
// which the sender wrote). The webmail checked the sender's verification (DMARC, SPF) and reports, so
// they count as signs in the email's verdict. Wording from the webmail's own help and public reports;
// a site that words it differently simply adds nothing.
//   Outlook: "This sender failed our fraud detection checks…", "… may not have been sent by …",
//            "unverified sender"
//   Gmail:   "This message might be dangerous" / "seems dangerous", "Be careful with this message"
const SERVICE_WARNINGS = [
    { re: /\bfailed our fraud detection checks\b/i, weight: 5 },
    { re: /\bthis message (might be|seems|may be) dangerous\b/i, weight: 5 },
    { re: /\bbe careful with this message\b/i, weight: 3 },
    { re: /\bmay not have been sent by\b/i, weight: 3 },
    { re: /\bunverified sender\b|\bcouldn't verify (that )?this (email|message|sender)\b/i, weight: 3 }
];
// Signs from a webmail's own warnings in some text: [{ weight, text }], each phrase once.
function serviceWarningSigns(text, siteName) {
    const out = [];
    const t = String(text || '');
    for (const w of SERVICE_WARNINGS) {
        const m = w.re.exec(t);
        if (!m) continue;
        // The whole sentence the phrase is in, as the webmail wrote it (at most 160 characters).
        const start = Math.max(t.lastIndexOf('.', m.index) + 1, t.lastIndexOf('\n', m.index) + 1, m.index - 120);
        let end = t.slice(m.index).search(/[.!\n]/);
        end = end < 0 ? Math.min(t.length, m.index + 160) : m.index + end + 1;
        const sentence = t.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 160);
        out.push({ weight: w.weight, text: `${siteName || 'The webmail'} itself warns about this sender: “${sentence}”` });
    }
    return out;
}

// Row highlighter colors: a see-through fill (one for light and one for dark themes, so text keeps
// its contrast) and a solid accent for the outline.
const ROW_HIGHLIGHT_COLORS = {
    yellow: { light: 'rgba(255, 213, 0, 0.30)',   dark: 'rgba(255, 213, 0, 0.20)',   accent: '#e3a700', accentDark: '#fdd663' },
    blue:   { light: 'rgba(26, 115, 232, 0.16)',  dark: 'rgba(138, 180, 248, 0.22)', accent: '#1a73e8', accentDark: '#8ab4f8' },
    green:  { light: 'rgba(52, 168, 83, 0.18)',   dark: 'rgba(129, 201, 149, 0.22)', accent: '#188038', accentDark: '#81c995' },
    pink:   { light: 'rgba(233, 30, 99, 0.14)',   dark: 'rgba(244, 143, 177, 0.22)', accent: '#c2185b', accentDark: '#f48fb1' },
    purple: { light: 'rgba(103, 58, 183, 0.15)',  dark: 'rgba(179, 157, 219, 0.24)', accent: '#673ab7', accentDark: '#b39ddb' },
    gray:   { light: 'rgba(0, 0, 0, 0.08)',       dark: 'rgba(255, 255, 255, 0.12)', accent: '#5f6368', accentDark: '#bdc1c6' }
};

// OTHER EXTENSIONS THAT DO THE SAME JOB. Two extensions changing the same part of the webmail (both
// drawing sender icons, both highlighting rows) can conflict: doubled icons, rows redrawn by both,
// a slower page. Known ones are recognized by their Chrome Web Store id: in the page (resources they
// add, "chrome-extension://<id>/…") or, once the user allows it, in the list of installed extensions.
//   features   our settings that do the same job (turning ours off is one way to end the conflict)
const OVERLAPPING_EXTENSIONS = [
    { name: 'Gmail Sender Icons', ids: ['jniljaamodclkmphgkgkooplflhkadpg'], features: ['enableSenderIdentity'], does: 'sender icons in the inbox' },
    { name: 'Simplify Gmail', ids: ['pbmlfaiicoikhdbjagjbglnbfcbcojpj'], features: ['enableSenderAvatars', 'enableTrackingPixelBlocking'], does: 'sender photos and blocking tracking pixels' },
    { name: 'Contact Avatars for Gmail', ids: ['pkljbdckinbcelpeipbnniamlhenoeon'], features: ['enableSenderAvatars'], does: 'sender photos in the inbox' },
    { name: 'Row Highlighter for Gmail', ids: ['ijfolchflbmnfopmpmodilcelmdakbfl'], features: ['enableRowHighlighter'], does: 'highlighting the row under the mouse' },
    { name: 'Copy Button for Gmail', ids: ['djkkdiclffdbkgndofebmejnanhdeegj'], features: ['enableCopyAddress'], does: 'a button that copies the sender\'s address' }
];
// Colors of the initial shown for a sender with no picture (white letter; each at least 5:1 contrast).
// No red, yellow or green: those mean flagged, caution and trusted elsewhere in the extension.
const INITIAL_COLORS = ['#1967D2', '#8430CE', '#00737A', '#5F6368', '#B80672', '#3949AB', '#6D4C41', '#01579B'];
// The color for an address: always the same one for the same sender.
function initialColor(address) {
    let h = 0;
    for (const ch of String(address || '').toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return INITIAL_COLORS[h % INITIAL_COLORS.length];
}
// The letter shown for a sender with no picture: the first letter or digit of their name, else of
// their address.
function senderInitial(name, address) {
    for (const s of [name, String(address || '').split('@')[0]]) {
        const m = /[\p{L}\p{N}]/u.exec(String(s || ''));
        if (m) return m[0].toLocaleUpperCase();
    }
    return '';
}

// --- Icon contrast ------------------------------------------------------------------------------------
// A site's icon has to stand out from what it's drawn on: a black logo with a see-through background
// vanishes on Gmail's dark theme, a white or yellow one on the light theme. Two things are measured: the
// icon's outline (its solid pixels next to see-through ones, or on its edge), which shows its shape, and
// its inner pixels, which are what's left to see when the outline is the icon's own backdrop (Google's G
// on a white disc reads fine on a light circle even though the disc blends in).
function relativeLuminance(rgb) {
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}
function contrastRatio(a, b) { return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }
// From an icon's pixels (RGBA, size × size): its main color (the average of its solid, not-white pixels;
// null for a white or empty icon), whether it has see-through parts, and the luminance of each pixel of
// its outline and of its inside.
function iconPixelLook(d, size) {
    const solid = (i) => d[i * 4 + 3] >= 128;
    let r = 0, g = 0, b = 0, n = 0, clear = 0;
    const edge = [], inner = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = y * size + x, p = i * 4;
        if (!solid(i)) { clear++; continue; }
        if (!(d[p] > 230 && d[p + 1] > 230 && d[p + 2] > 230)) { r += d[p]; g += d[p + 1]; b += d[p + 2]; n++; }
        const outline = x === 0 || y === 0 || x === size - 1 || y === size - 1 || !solid(i - 1) || !solid(i + 1) || !solid(i - size) || !solid(i + size);
        (outline ? edge : inner).push(relativeLuminance([d[p], d[p + 1], d[p + 2]]));
    }
    return { tint: n >= Math.max(8, size * size / 32) ? [r / n, g / n, b / n] : null, seeThrough: clear >= size * size * 0.05, edge, inner };
}
// The share of some of an icon's pixels (luminances) with at least `min`:1 contrast against a color.
function iconVisibleShare(pixels, bg, min) {
    if (!pixels.length) return 0;
    const lb = relativeLuminance(bg);
    return pixels.filter(l => contrastRatio(l, lb) >= min).length / pixels.length;
}
// An icon shows on a background when most of its outline (half, at 2:1) or enough of its inside (a
// fifth, at 2:1) stands out from it. 2:1 rather than 3:1 here, so a colorful logo keeps its usual look.
function iconStandsOut(look, bg) {
    return !look.edge.length || iconVisibleShare(look.edge, bg, 2) >= 0.5 || iconVisibleShare(look.inner, bg, 2) >= 0.2;
}
const ICON_SURFACE = { light: [255, 255, 255], dark: [32, 33, 36] };   // Gmail's light and dark rows
const ICON_MID_GREY = [128, 134, 139];                                  // 3.7:1 with white, 5.7:1 with black
// A soft tint of an icon's color: 16% of it over white (light theme), 30% over Gmail's dark surface;
// a plain grey when the icon has no color of its own.
function iconTintOver(rgb, dark) {
    if (!rgb) return dark ? [60, 64, 67] : [241, 243, 244];
    const base = dark ? ICON_SURFACE.dark : ICON_SURFACE.light, k = dark ? 0.3 : 0.16;
    return base.map((v, i) => Math.round(v + (rgb[i] - v) * k));
}
// The background for an icon: the preferred one while the icon shows on it, otherwise whichever of the
// others gives the most of its outline 3:1 contrast (WCAG 2.1 non-text contrast). A solid icon (no
// see-through parts) carries its own background and keeps the preferred one.
function contrastingBackground(look, preferred, others) {
    if (!look || !look.seeThrough || iconStandsOut(look, preferred)) return preferred;
    let best = preferred, bestShare = iconVisibleShare(look.edge, preferred, 3);
    for (const c of others) { const s = iconVisibleShare(look.edge, c, 3); if (s > bestShare) { best = c; bestShare = s; } }
    return best;
}
// The circle behind a site's icon in an inbox row: its own tint, light or dark to suit the theme, or
// the other one (or a mid grey) when the icon wouldn't show on it.
function iconCircleColor(look, dark) {
    const tint = look && look.tint;
    return contrastingBackground(look, iconTintOver(tint, dark), [iconTintOver(tint, !dark), ICON_MID_GREY]);
}
const cssRgb = (c) => `rgb(${c.map(v => Math.round(v)).join(', ')})`;

// The names of our features, as the conflict warnings say them.
const FEATURE_NAMES = {
    enableSenderIdentity: 'sender icons and labels', enableSenderAvatars: 'sender photos and company logos',
    enableTrackingPixelBlocking: 'tracking-pixel blocking', enableRowHighlighter: 'the row highlighter', enableCopyAddress: 'the copy-address button'
};

// Turning off only some of our features that overlap with another extension settles that conflict:
// the ones left on are remembered as kept (keptConflictFeatures: { key: [setting keys] }), and the
// warning comes back only if an overlapping feature that is not kept is on (one turned back on).
function conflictSettled(features, kept) {
    const k = new Set(Array.isArray(kept) ? kept : []);
    return (features || []).every(f => k.has(f));
}
// Turns off some of our features for a conflict, and remembers the rest of its features as kept.
function turnOffForConflict(key, features, off, locked, done) {
    const changes = {};
    off.filter(k => !(locked && locked[k])).forEach(k => { changes[k] = false; });
    chrome.storage.local.get({ keptConflictFeatures: {} }, r => {
        const kept = r.keptConflictFeatures && typeof r.keptConflictFeatures === 'object' ? r.keptConflictFeatures : {};
        kept[key] = features.filter(f => !(f in changes));
        changes.keptConflictFeatures = kept;
        chrome.storage.local.set(changes, () => done && done(Object.keys(changes).filter(k => k !== 'keptConflictFeatures')));
    });
}

// Every feature, and what a site needs for it (null: works on every supported site). Shown as the
// compatibility chart in Help → Which features work where.
const FEATURE_SUPPORT = [
    { name: 'Links: hidden destinations revealed, dangerous and look-alike links marked', needs: null },
    { name: 'Tracking pixels blocked', needs: null },
    { name: 'QR codes in email images', needs: null },
    { name: 'QR codes drawn without an image', needs: null },
    { name: 'Phishing-simulation emails recognized by their link domains', needs: null },
    { name: 'Attachment checks (QR codes, scripts, fake logins, encrypted archives)', needs: 'attachments' },
    { name: 'Sender checks in opened emails (brand names, look-alike domains, company links)', needs: 'opened' },
    { name: 'Sender icon, country flag and label in opened emails', needs: 'opened' },
    { name: 'Copy button for the sender\'s address', needs: 'avatars' },
    { name: 'Look-alike senders caught in the inbox list (nothing opened)', needs: 'list' },
    { name: 'Senders using your own name or address as theirs, caught in the inbox list', needs: 'account' },
    { name: '"Call this number" scams caught, even in emails genuinely sent by a company', needs: 'opened' },
    { name: 'Sender icon, country flag and label in the inbox list', needs: 'list' },
    { name: 'Sender pictures over the checkbox: colleagues\' photos, BIMI and company logos, site icons', needs: 'avatars' },
    { name: 'The webmail\'s own warnings about a sender counted in the email\'s verdict', needs: 'opened' },
    { name: 'Signs of forgery in the headers (DMARC, forged delivery records…)', needs: 'headers' },
    { name: 'Phishing-simulation emails recognized by their headers', needs: 'headers' },
    { name: 'Flagged emails moved to Spam', needs: 'move' },
    { name: 'Dangerous emails marked red in the Spam folder (moved there by the extension or not)', needs: 'move' },
    { name: 'Links checked before sending', needs: 'compose' },
    { name: 'Row highlighter (the email under the mouse, and selected ones)', needs: 'list' },
    { name: 'Warnings about other extensions that do the same job', needs: null }
];

// The supported webmail entry for a page address, or null.
function webmailSiteFor(urlString) {
    let u;
    try { u = new URL(urlString); } catch (e) { return null; }
    return WEBMAIL_SITES.find(s => s.host.test(u.hostname) && (!s.path || s.path.test(u.pathname))) || null;
}

// ---------------------------------------------------------------------------
// SENDER CHECKS ("trust but verify", Gmail)
// A company-only short link (c.gle…) whose destination can't be looked up is trusted only when the
// email really came from that company, directly to the user. Gmail's own verdict is read from the
// message's original source (Authentication-Results stamped by mx.google.com), only when needed.
// Separately, sender names claiming a brand, brand domains failing verification, look-alike sender
// domains and abuse of genuine company notification systems are flagged.
// ---------------------------------------------------------------------------

// Short-link domains only the company's own systems or staff can create. foreignSender: how
// serious it is to find one in mail from someone else. aka.ms links are made by Microsoft staff but
// copied into partner and IT newsletters everywhere, so that case is only a caution.
// Lower-case host name of a URL, or null.
function urlHostname(urlString) {
    try { return new URL(urlString).hostname.toLowerCase(); } catch (e) { return null; }
}

const COMPANY_ONLY_SHORTENERS = {
    'c.gle':   { brand: 'Google',    foreignSender: 'danger' },
    'g.co':    { brand: 'Google',    foreignSender: 'danger' },
    'goo.gle': { brand: 'Google',    foreignSender: 'caution' },
    'aka.ms':  { brand: 'Microsoft', foreignSender: 'caution' },
    'go.microsoft.com': { brand: 'Microsoft', foreignSender: 'caution' }      // /fwlink/?LinkId=… redirector
};
function companyOnlyShortener(urlString) {
    const host = urlHostname(urlString);
    return host && COMPANY_ONLY_SHORTENERS[host] ? Object.assign({ host }, COMPANY_ONLY_SHORTENERS[host]) : null;
}

// Brands whose genuine mail must pass with both DKIM and SPF aligned before a company link is
// trusted (a re-sent copy of a genuine message passes DKIM only).
const HIGH_VALUE_BRANDS = new Set(['Google', 'Microsoft', 'Apple', 'Amazon', 'PayPal']);

// Personal-mail domains: an address here is a private person, never the company (icloud.com,
// outlook.com and gmail.com belong to brands, but their users are not the brand).
const PERSONAL_MAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
    'yahoo.com', 'ymail.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'pm.me',
    'gmx.com', 'gmx.net', 'gmx.de', 'web.de', 'mail.com', 'zoho.com', 'zohomail.com', 'yandex.com', 'yandex.ru',
    'fastmail.com', 'tutanota.com', 'tuta.io', 'qq.com', '163.com', '126.com', 'hotmail.co.uk', 'yahoo.co.uk',
    'outlook.de', 'hotmail.de', 'hotmail.fr', 'yahoo.fr', 'libero.it', 'orange.fr', 'free.fr']);
function isPersonalMailDomain(domain) {
    const d = String(domain || '').toLowerCase();
    return PERSONAL_MAIL_DOMAINS.has(d) || /^(hotmail|outlook|live|yahoo)\.[a-z.]{2,6}$/.test(d);
}

// A company's shared mailbox (contact@, info@, support@, news@, no-reply@…) rather than a person's.
// The picture a company sets on such a mailbox is its own choice, so it serves as the company's logo.
const SHARED_MAILBOX_RE = /^(contact|contactus|info|information|hello|hi|hey|support|help|helpdesk|service|services|customerservice|customercare|care|sales|marketing|news|newsletter|newsletters|updates?|notifications?|notify|alerts?|noreply|no-reply|donotreply|do-not-reply|mail|mailer|email|team|office|admin|billing|accounts?|orders?|shop|store|feedback|community|events?|press|media|jobs|careers|recruiting|reply|members?|membership|webmaster|enquiries|inquiries|general|welcome|offers|deals|promotions?|digest|reminders?|receipts?|invoices?|security|account-security|service-desk)([._+-].*)?$/i;
function isSharedMailbox(address) {
    const local = String(address || '').toLowerCase().split('@')[0];
    return !!local && SHARED_MAILBOX_RE.test(local);
}

// The company a sending domain belongs to (null for personal mail and unknown domains).
function brandOfSender(domain) {
    const d = String(domain || '').toLowerCase().replace(/^.*@/, '');
    if (!d || isPersonalMailDomain(d)) return null;
    return brandOfDomain(registrableDomain(d)) || brandOfDomain(d);
}

// Brands people impersonate in sender names. ambiguous: also an ordinary word or name ("Apple
// Smith", "Chase"), so it only counts next to words like Support, Security or Billing.
const SENDER_NAME_BRANDS = [
    { name: 'Google', tokens: ['google', 'gmail', 'google workspace', 'youtube'] },
    { name: 'Microsoft', tokens: ['microsoft', 'office 365', 'microsoft 365', 'outlook', 'onedrive', 'sharepoint', 'teams'], ambiguousTokens: ['outlook', 'teams'] },
    { name: 'Apple', tokens: ['apple', 'icloud', 'itunes', 'app store'], ambiguousTokens: ['apple'] },
    { name: 'Amazon', tokens: ['amazon', 'amazon prime', 'aws'] },
    { name: 'PayPal', tokens: ['paypal'] },
    { name: 'Meta', tokens: ['facebook', 'instagram', 'whatsapp', 'meta'], ambiguousTokens: ['meta'] },
    { name: 'LinkedIn', tokens: ['linkedin'] },
    { name: 'Netflix', tokens: ['netflix'], domains: ['netflix.com'] },
    { name: 'DocuSign', tokens: ['docusign'], domains: ['docusign.com', 'docusign.net'] },
    { name: 'Dropbox', tokens: ['dropbox'], domains: ['dropbox.com', 'dropboxmail.com'] },
    { name: 'Wells Fargo', tokens: ['wells fargo'], domains: ['wellsfargo.com'] },
    { name: 'Bank of America', tokens: ['bank of america'], domains: ['bankofamerica.com', 'bofa.com'] },
    { name: 'Chase', tokens: ['chase'], ambiguousTokens: ['chase'], domains: ['chase.com', 'jpmorgan.com'] },
    { name: 'Coinbase', tokens: ['coinbase'], domains: ['coinbase.com'] },
    { name: 'Adobe', tokens: ['adobe'], domains: ['adobe.com'] },
    { name: 'FedEx', tokens: ['fedex'], domains: ['fedex.com'] },
    { name: 'UPS', tokens: ['ups'], ambiguousTokens: ['ups'], domains: ['ups.com'] },
    { name: 'DHL', tokens: ['dhl'], domains: ['dhl.com', 'dhl.de'] },
    { name: 'USPS', tokens: ['usps', 'postal service'], domains: ['usps.com', 'usps.gov'] },
    { name: 'IRS', tokens: ['irs', 'internal revenue service'], domains: ['irs.gov'] },
    { name: 'Norton', tokens: ['norton', 'norton 360'], ambiguousTokens: ['norton'], domains: ['norton.com', 'nortonlifelock.com', 'gen.digital'] },
    { name: 'McAfee', tokens: ['mcafee'], domains: ['mcafee.com'] },
    { name: 'Geek Squad', tokens: ['geek squad'], domains: ['geeksquad.com', 'bestbuy.com'] },
    { name: 'Venmo', tokens: ['venmo'], domains: ['venmo.com'] },
    { name: 'Zelle', tokens: ['zelle'], domains: ['zellepay.com'] },
    { name: 'Cash App', tokens: ['cash app', 'cashapp'], domains: ['cash.app', 'square.com', 'squareup.com'] },
    { name: 'eBay', tokens: ['ebay'], domains: ['ebay.com'] },
    { name: 'Walmart', tokens: ['walmart'], domains: ['walmart.com'] },
    { name: 'Costco', tokens: ['costco'], domains: ['costco.com'] },
    { name: 'Verizon', tokens: ['verizon'], domains: ['verizon.com', 'verizonwireless.com'] },
    { name: 'AT&T', tokens: ['at&t', 'att'], ambiguousTokens: ['att'], domains: ['att.com', 'att.net'] },
    { name: 'Xfinity', tokens: ['xfinity', 'comcast'], domains: ['xfinity.com', 'comcast.com', 'comcast.net'] },
    { name: 'Spotify', tokens: ['spotify'], domains: ['spotify.com'] },
    { name: 'Steam', tokens: ['steam'], ambiguousTokens: ['steam'], domains: ['steampowered.com', 'steamcommunity.com'] },
    { name: 'Intuit', tokens: ['intuit', 'quickbooks', 'turbotax'], domains: ['intuit.com', 'quickbooks.com', 'turbotax.com'] },
    { name: 'Zoom', tokens: ['zoom'], ambiguousTokens: ['zoom'], domains: ['zoom.us', 'zoom.com'] }
];
const SENDER_CONTEXT_WORDS = /\b(support|security|account|accounts|billing|team|service|services|help|helpdesk|alert|alerts|notification|notifications|payment|payments|customer|verification|verify|notice|center|centre|id|online|store|delivery|shipping|refund|invoice|admin|no-?reply|official|protection|fraud|department)\b/;

// Folds look-alike characters so "PаyPal" (Cyrillic а) still reads as "paypal".
function foldName(s) {
    return Array.from(String(s || '').normalize('NFKC').toLowerCase(), ch => (CONFUSABLE_MAP[ch] && !/[0-9]/.test(ch) ? CONFUSABLE_MAP[ch] : ch)).join('');
}

// The brand a sender's display name claims, or null.
function displayNameBrand(displayName) {
    const name = foldName(displayName).replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) return null;
    for (const b of SENDER_NAME_BRANDS) {
        for (const t of b.tokens) {
            if (!new RegExp(`(^| )${t.replace(/[&]/g, '\\&')}( |$)`).test(name)) continue;
            if ((b.ambiguousTokens || []).includes(t) && name !== t && !SENDER_CONTEXT_WORDS.test(name)) continue;
            return b;
        }
    }
    return null;
}

// Whether a sending domain belongs to the brand named in the display name.
function senderDomainOwnedBy(brand, domain) {
    const d = String(domain || '').toLowerCase();
    if (!d || isPersonalMailDomain(d)) return false;
    if (brandOfSender(d) === brand.name) return true;
    const reg = registrableDomain(d);
    return (brand.domains || []).some(x => reg === x || d === x || d.endsWith('.' + x));
}

// --- Name and address don't match (checked on every inbox row; nothing has to be opened) ---------
// A display name is reduced to its words, in order of the alphabet (so "Smith, John" = "John Smith"),
// without anything in brackets; kept only as a hash (colleagueNameHash), never as the name itself.
function colleagueNameKey(name) {
    const words = String(name || '').normalize('NFKC').toLowerCase().replace(/[([{].*?[)\]}]/g, ' ')
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter(Boolean);
    return words.length >= 2 ? words.sort().join(' ') : '';
}
// A short one-way fingerprint of a name key (two FNV-1a passes, 64 bits): enough to recognize the
// name again, not to read it back.
function colleagueNameHash(name) {
    const key = colleagueNameKey(name);
    if (!key) return '';
    let a = 0x811c9dc5, b = 0x01000193 ^ key.length;
    for (const ch of key) { const c = ch.codePointAt(0); a ^= c; a = Math.imul(a, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x5bd1e995) >>> 0; }
    return a.toString(36) + b.toString(36);
}
// Signs that a sender's name and address don't belong together: a well-known brand's name on an
// address that isn't the brand's (red: moved to Spam), or the name of someone in the user's own
// organization on an outside address (amber: colleagues sometimes write from a personal address).
// own: the user's organization domain; colleagues: Set of colleagueNameHash values.
function nameAddressSigns(name, address, own, colleagues) {
    const out = [];
    const domain = domainOfAddress(address);
    if (!name || !domain || (own && isOwnDomain(domain, own))) return out;
    const claimed = displayNameBrand(name);
    if (claimed && !senderDomainOwnedBy(claimed, domain)) {
        out.push({ weight: 5, text: `The sender's name says “${String(name).trim().slice(0, 60)}”, but ${address} isn't ${claimed.name}'s address.` });
    }
    const h = colleagues && colleagues.size ? colleagueNameHash(name) : '';
    if (h && colleagues.has(h)) {
        out.push({ weight: 3, text: `The sender uses the name of someone in your organization, but writes from an outside address (${address}).` });
    }
    return out;
}

// Signs that a sender borrows the reader's own name: a display name that is the reader's own email
// address, or its mailbox name (the part before the @) written exactly as in the address, on someone
// else's address, so the email looks like a notice about the reader's own account ("patdoe"
// <random@spam.example> to patdoe@example.com). On Gmail, Outlook.com and other big providers the
// mailbox name is unique to its owner, so there it counts written in any case ("Patdoe"); at an
// organization it can be a plain first name ("john@"), so only as written. Red: moved to Spam. Not for shared mailbox names
// (info, office…), senders in the reader's own organization, or a sender whose own mailbox name
// contains the reader's (likely their other account). account: the signed-in address.
const SHARED_MAILBOX_NAMES = new Set(['admin', 'office', 'info', 'contact', 'support', 'help', 'hello', 'mail', 'email', 'team', 'sales', 'billing', 'accounts', 'service', 'news', 'noreply', 'webmaster', 'postmaster', 'user', 'test']);
function ownNameSigns(name, address, account) {
    const n = String(name || '').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
    const me = String(account || '').trim().toLowerCase(), addr = String(address || '').trim().toLowerCase();
    const at = me.lastIndexOf('@'), domain = domainOfAddress(addr), own = domainOfAddress(me);
    if (!n || at < 1 || !domain || addr === me) return [];
    if (own && !isPersonalMailDomain(own) && (domain === own || domain.endsWith('.' + own))) return [];
    const mine = me.slice(0, at);
    if (addr.slice(0, addr.lastIndexOf('@')).includes(mine)) return [];
    const isAddress = n.toLowerCase() === me;
    const same = n === mine || (isPersonalMailDomain(own) && n.toLowerCase() === mine);
    if (!isAddress && !(same && mine.length >= 4 && !SHARED_MAILBOX_NAMES.has(mine))) return [];
    // The user's own name isn't repeated in the text (it ends up in the log).
    return [{ weight: 5, text: `The sender's name is your own ${isAddress ? 'email address' : 'mailbox name'}, but the email comes from someone else's address (${address}), a trick to look like a notice about your own account.` }];
}

// Parses the header block of a raw message: [[lower-case name, value], …] in order (unfolded).
function parseRawHeaders(raw) {
    const text = String(raw || '').replace(/\r\n/g, '\n');
    const end = text.indexOf('\n\n');
    const block = (end >= 0 ? text.slice(0, end) : text).replace(/\n[ \t]+/g, ' ');
    const out = [];
    for (const line of block.split('\n')) {
        const i = line.indexOf(':');
        if (i > 0 && !/\s/.test(line.slice(0, i))) out.push([line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()]);
    }
    return out;
}

const EMAIL_IN_TEXT_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const domainOfAddress = (a) => String(a || '').toLowerCase().replace(/^.*@/, '').replace(/[>\s]+$/, '');

// Reads the receiver's verdict. Only the topmost Authentication-Results written by the receiving mail
// system (its authserv-id, the webmail's `receiver`, e.g. "mx.google.com") counts (RFC 8601: anything
// lower may have been written by the sender). Returns null when there is no such header, or when the
// receiver isn't known (then no header can be trusted).
function parseAuthResults(raw, receiver) {
    if (!receiver) return null;
    const headers = parseRawHeaders(raw);
    const ar = headers.find(([n, v]) => n === 'authentication-results' && v.split(';')[0].trim().toLowerCase() === receiver);
    if (!ar) return null;
    const v = ar[1];
    const result = (m) => { const r = new RegExp(`\\b${m}=([a-z]+)`, 'i').exec(v); return r ? r[1].toLowerCase() : 'none'; };
    const fromHeader = (headers.find(([n]) => n === 'from') || [])[1] || '';
    const fm = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(fromHeader);
    const addrs = (name) => headers.filter(([n]) => n === name).map(([, x]) => x).join(', ').match(EMAIL_IN_TEXT_RE) || [];
    const hf = /header\.from=([^\s;]+)/i.exec(v);
    // The sender domain's own published DMARC policy, as Gmail reports it: "dmarc=fail (p=QUARANTINE …)".
    const dp = /\bdmarc=[a-z]+\s*\(([^)]*)\)/i.exec(v);
    const dmarcPolicy = dp && (/\bp=([a-z]+)/i.exec(dp[1]) || [])[1];
    const mf = /smtp\.mailfrom=([^\s;]+)/i.exec(v);
    return {
        dmarc: result('dmarc'), spf: result('spf'), dkim: result('dkim'), arc: result('arc'),
        dmarcPolicy: dmarcPolicy ? dmarcPolicy.toLowerCase() : '',
        headerFrom: hf ? domainOfAddress(hf[1]) : domainOfAddress(fm ? fm[2] : fromHeader),
        spfDomain: mf ? domainOfAddress(mf[1]) : '',
        dkimDomains: Array.from(v.matchAll(/dkim=pass[^;]*?header\.(?:i=@?|d=)([^\s;]+)/gi), m => domainOfAddress(m[1])),
        fromName: fm ? fm[1].trim() : '',
        fromAddress: (fm ? fm[2] : (fromHeader.match(EMAIL_IN_TEXT_RE) || [''])[0]).toLowerCase(),
        to: addrs('to').map(a => a.toLowerCase()),
        cc: addrs('cc').map(a => a.toLowerCase()),
        deliveredTo: ((headers.find(([n]) => n === 'delivered-to') || [])[1] || '').toLowerCase().trim(),
        isList: headers.some(([n]) => n === 'list-id')
    };
}

// Verdict for a company-only link whose destination is unknown: { verified } or { severity, code,
// reason }. code groups identical findings so an email shows one summary line, not one per link:
// forwarded | unchecked | notDirect | relayed | failed | foreign.
function evaluateCompanyLink({ shortener, auth, inQuote }) {
    const b = shortener.brand, host = shortener.host;
    const unknown = 'its destination couldn\'t be looked up';
    if (inQuote) return { severity: 'caution', code: 'forwarded', reason: `Forwarded ${b} link (${host}): ${unknown}, and who originally sent it can't be verified` };
    if (!auth) return { severity: 'caution', code: 'unchecked', reason: `${b} short link (${host}): ${unknown}, and the sender couldn't be checked` };
    const fromBrand = brandOfSender(auth.headerFrom);
    if (fromBrand === b && auth.dmarc === 'pass') {
        const direct = !!auth.deliveredTo && [...auth.to, ...auth.cc].includes(auth.deliveredTo) && !auth.isList;
        const spfAligned = auth.spf === 'pass' && brandOfSender(auth.spfDomain) === b;
        if (direct && (!HIGH_VALUE_BRANDS.has(b) || spfAligned)) return { verified: true };
        return { severity: 'caution', code: !direct ? 'notDirect' : 'relayed', reason: !direct
            ? `${b} short link (${host}) in an email verified as sent by ${b}, but not addressed to you directly (it may be a re-sent copy or a mailing list); ${unknown}`
            : `${b} short link (${host}) in an email signed by ${b} but relayed through another server; ${unknown}` };
    }
    if (fromBrand === b) return { severity: 'danger', code: 'failed', reason: `This email claims to come from ${b} but failed ${b}'s sender verification; its ${b} link (${host}) can't be trusted` };
    return { severity: shortener.foreignSender, code: 'foreign', sender: auth.headerFrom || '', reason: `Only ${b} issues ${host} links, but this email came from ${auth.headerFrom || 'another sender'}, not ${b}; ${unknown}` };
}

// Text that suggests a call-or-pay scam inside a genuine notification (attackers put it in fields
// such as account or organization names that the company's system then mails out).
const SCAM_PHONE_RE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)[\s.-]?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/;
const SCAM_WORDS_RE = /\b(payment|charged|charge|invoice|refund|order|subscription|renewal|purchase|transaction|bitcoin|crypto|gift ?cards?|call (us|now|immediately)|cancel)\b/i;

// Findings about the sender: [{ severity, message }], plus info for the log.
function evaluateSender({ displayName, address, auth, bodyText }) {
    const findings = [];
    const info = [];
    const domain = domainOfAddress(address);
    const claimed = displayNameBrand(displayName);
    if (claimed && !senderDomainOwnedBy(claimed, domain)) {
        findings.push({ severity: 'danger', message: `The sender's name says “${String(displayName).trim()}”, but the address ${address} isn't ${claimed.name}'s. Don't trust links, attachments or phone numbers in this email.` });
    }
    const la = domain && !isPersonalMailDomain(domain) ? lookalikeOf(domain) : null;
    if (la) findings.push({ severity: 'danger', message: `The sender's address (${domain}) ${la}.` });
    if (auth) {
        const fromBrand = brandOfSender(auth.headerFrom);
        if (fromBrand && auth.dmarc === 'fail') {
            findings.push({ severity: 'danger', message: `This email claims to come from ${fromBrand} (${auth.headerFrom}) but failed ${fromBrand}'s sender verification. It is probably forged.` });
        } else if (fromBrand && auth.dmarc === 'pass') {
            info.push(`Sender passed ${fromBrand}'s sender authentication (${auth.headerFrom}, DMARC pass).`);
            const text = String(bodyText || '');
            if (SCAM_PHONE_RE.test(text) && SCAM_WORDS_RE.test(text)) {
                findings.push({ severity: 'caution', message: `This is a genuine ${fromBrand} message, but it contains a phone number and payment wording. Attackers can make company systems send such text. Don't call numbers or pay from an unexpected message; contact ${fromBrand} through its official website.` });
            }
        }
    }
    return { findings, info };
}

// "Call this number" (callback) scams: a phone number to call about a purchase, renewal or charge.
// Attackers also type such text into fields a company's own system mails out (an organization or
// account name), so it counts whoever sent the email. In a subject it is strong: no genuine
// notification puts a support number there. In an opened email it is a caution only when it says to
// call if you didn't make the purchase (some banks' genuine fraud alerts say that too).
const CALLBACK_MONEY_RE = /\b(purchase[ds]?|order(ed)?|payment|charged?|renewal|renewed|subscription|invoice|transaction|refund|billing)\b/i;
const CALLBACK_CALL_RE = /\b(call|contact|support|help ?line|customer (service|care)|cancel|dispute)\b/i;
const CALLBACK_URGE_RE = /\b(cancel(l?ation)?|dispute|refund|charged|immediately|urgent(ly)?|not you|wasn'?t you)\b/i;
const CALLBACK_NOT_YOU_RE = /\b(not (made|authori[sz]ed|placed|requested) by you|did(n'?t| not) (make|authori[sz]e|place|request|order)|unauthori[sz]ed (purchase|charge|transaction|payment))\b/i;
// Letters from the "mathematical" alphabets (𝐔𝐒𝐃), which look like ordinary ones but don't match a filter's words.
const MATH_LETTERS_RE = /[\u{1D400}-\u{1D7FF}]/gu;
function subjectScamSigns(subject) {
    const s = String(subject || '').normalize('NFKC'), raw = String(subject || '');
    const out = [];
    if (SCAM_PHONE_RE.test(s) && CALLBACK_MONEY_RE.test(s)) {
        // Strong with the scam's own wording (not you, cancel, dispute, charged, immediately); a
        // number with "call" or "support" alone is a caution (a small shop may write "call to pick up").
        if (CALLBACK_NOT_YOU_RE.test(s) || CALLBACK_URGE_RE.test(s)) out.push({ weight: 5, text: 'Its subject gives a phone number to call about a purchase or charge you didn\'t make: the "call this number" scam. Even emails really sent by a company can carry it (attackers type it into names its system mails out). Don\'t call it.' });
        else if (CALLBACK_CALL_RE.test(s)) out.push({ weight: 3, text: 'Its subject gives a phone number to call about a purchase or payment, which genuine notifications rarely do.' });
    }
    if ((raw.match(MATH_LETTERS_RE) || []).length >= 2) out.push({ weight: 2, text: 'Its subject uses look-alike "mathematical" letters (such as 𝐔𝐒𝐃) to slip past filters.' });
    return out;
}
function bodyScamSigns(text) {
    const raw = String(text || '').slice(0, 20000), t = raw.normalize('NFKC');
    const out = [];
    if (SCAM_PHONE_RE.test(t) && CALLBACK_MONEY_RE.test(t) && CALLBACK_NOT_YOU_RE.test(t)) {
        out.push({ weight: 3, text: 'It asks you to call a phone number if you didn\'t make a purchase: the "call this number" scam. Contact the company through its official website instead.' });
    }
    if ((raw.match(MATH_LETTERS_RE) || []).length >= 2) out.push({ weight: 2, text: 'Its text uses look-alike "mathematical" letters (such as 𝐔𝐒𝐃) to slip past filters.' });
    return out;
}

// Sign-in links (Microsoft, Google) that send you on to another site afterwards: a phishing trick
// that uses the real sign-in page as a redirector.
function signInRedirectProblem(urlString) {
    let u;
    try { u = new URL(urlString); } catch (e) { return null; }
    const host = u.hostname.toLowerCase();
    const isSignIn = /(^|\.)login\.microsoftonline\.com$|(^|\.)login\.live\.com$/.test(host) || (host === 'accounts.google.com' && /\/o\/oauth2/.test(u.pathname));
    if (!isSignIn) return null;
    const target = u.searchParams.get('redirect_uri') || u.searchParams.get('redirect_url');
    const tHost = target ? urlHostname(target) : null;
    if (tHost && brandOfSender(tHost) !== brandOfSender(host)) {
        return `sign-in link that sends you on to ${tHost} afterwards, a trick that uses the real sign-in page to reach another site`;
    }
    return null;
}

// One summary sentence for `count` company links that share the same finding (email banner).
function companyLinkSummary(code, count, brand, host, sender) {
    const many = count > 1;
    const links = many ? `${count} ${brand} links (${host})` : `a ${brand} link (${host})`;
    const Links = links.charAt(0).toUpperCase() + links.slice(1);
    const they = many ? 'they' : 'it', them = many ? 'them' : 'it', lead = many ? 'lead' : 'leads';
    switch (code) {
        case 'forwarded': return `${Links} in a forwarded part of this email can't be checked: where ${they} ${lead} couldn't be looked up, and who originally sent ${them} can't be verified.`;
        case 'unchecked': return `${Links} in this email can't be checked: where ${they} ${lead} couldn't be looked up, and the sender couldn't be verified.`;
        case 'notDirect': return `${Links} in this email can't be checked: the email was sent by ${brand}, but not directly to you (it may be a re-sent or mailing-list copy), and where ${they} ${lead} couldn't be looked up.`;
        case 'relayed':   return `${Links} in this email can't be checked: the email was signed by ${brand} but relayed through another server, and where ${they} ${lead} couldn't be looked up.`;
        case 'failed':    return `This email claims to come from ${brand} but failed ${brand}'s sender verification. Don't trust its ${links}.`;
        case 'foreign':   return `This email contains ${links}, which only ${brand} issues, but it came from ${sender || 'another sender'}, not ${brand}. Don't trust ${them}.`;
        default:          return `${Links} in this email can't be checked.`;
    }
}

// ---------------------------------------------------------------------------
// CHECKING LINKS BEFORE SENDING (offline part). The network part (DNS existence, threat checks,
// reachability) is in background.js: checkOutgoingLinks.
// ---------------------------------------------------------------------------

// Endings that are almost always typing mistakes (none of these is a real top-level domain).
const TLD_TYPOS = { con: 'com', cmo: 'com', ocm: 'com', vom: 'com', xom: 'com', cpm: 'com', cim: 'com', comm: 'com',
    coom: 'com', comn: 'com', clm: 'com', cok: 'com', nte: 'net', ner: 'net', nett: 'net', ogr: 'org', orgg: 'org',
    rog: 'org', ord: 'org', eud: 'edu', edi: 'edu', gvo: 'gov', ogv: 'gov', ifno: 'info', inf: 'info' };

// Web addresses typed with a broken beginning, e.g. "http//example.com", "htp://", "hhtps://".
const MALFORMED_SCHEME_RE = /(?:^|[\s(<"'])((?:h+t+p+s?|htps?|hhtps?|htttps?|ttps?|https?)(?::\/\/|:\/(?!\/)|\/\/|:\\\\|;\/\/|::\/\/)[^\s<>"',)]+)/gi;
function findMalformedUrls(text) {
    const out = [];
    for (const m of String(text || '').matchAll(MALFORMED_SCHEME_RE)) {
        const s = m[1];
        if (/^https?:\/\//i.test(s)) continue;                       // well-formed
        out.push(s);
    }
    return [...new Set(out)].slice(0, 20);
}

// Problems that can be seen without any network lookup, in plain words.
function outgoingLinkOfflineProblems(url, linkText) {
    const problems = [];
    let u;
    try { u = new URL(url); } catch (e) { return ['isn\'t a valid web address']; }
    if (!/^https?:$/.test(u.protocol)) return problems;
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
    if (!isIp) {
        if (!host.includes('.')) problems.push('has no domain ending (such as .com)');
        else {
            const tld = host.split('.').pop();
            if (TLD_TYPOS[tld]) problems.push(`ends in “.${tld}”, which looks like a typo for “.${TLD_TYPOS[tld]}”`);
            if (/\.\./.test(u.hostname)) problems.push('has two dots in a row in its domain');
        }
        const la = lookalikeOf(host);
        if (la) problems.push(`goes to ${host}, which ${la}`);
    }
    // The visible text names a different website than the link goes to (easy to do when editing).
    const shown = String(linkText || '').trim();
    const textHost = /^(https?:\/\/)?(www\.)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(shown) ? (urlHostname(/^https?:/i.test(shown) ? shown : 'https://' + shown) || '') : '';
    if (textHost && registrableDomain(textHost) !== registrableDomain(host)) problems.push(`its text shows ${textHost}, but the link goes to ${host}`);
    return problems;
}

// Domain names typed without "http://" or "www." (Gmail turns "test.com" into a link only when the
// email is sent, so while composing it is plain text). Only well-known endings count, plus the typo
// endings above, so ordinary words with dots ("e.g.", "Node.js", "report.zip") are not mistaken
// for websites; email addresses and file names are left out.
const BARE_DOMAIN_TLDS = ['com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'io', 'co', 'us', 'uk', 'ca', 'au', 'nz', 'ie',
    'de', 'fr', 'it', 'es', 'nl', 'be', 'ch', 'at', 'se', 'no', 'dk', 'fi', 'pl', 'pt', 'cz', 'gr', 'hu', 'ro', 'jp', 'kr',
    'cn', 'hk', 'tw', 'sg', 'in', 'br', 'mx', 'ar', 'cl', 'ru', 'ua', 'za', 'eu', 'info', 'biz', 'me', 'tv', 'cc', 'ai',
    'dev', 'xyz', 'online', 'site', 'store', 'shop', 'tech', 'blog', 'cloud', 'news', 'live', 'link', 'club', 'top', 'ly',
    'gl', 'gle', 'ms', 'to', 'fm', 'gg', 'pro', 'name', 'email', 'page', 'bank', 'website', 'space', 'agency', 'company',
    ...Object.keys(TLD_TYPOS)].filter(t => !FILE_EXTENSION_TLDS.has(t));
const BARE_DOMAIN_RE = new RegExp(`(?<![@\\w.\\/:-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${BARE_DOMAIN_TLDS.join('|')}))(?![\\w@-]|\\.[a-z0-9])(\\/[^\\s<>"']*)?`, 'gi');
function findBareDomains(text) {
    const withoutUrls = String(text || '').replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, ' ');
    const out = [];
    for (const m of withoutUrls.matchAll(BARE_DOMAIN_RE)) {
        out.push(`http://${m[1]}${(m[2] || '').replace(/[.,;:!?)\]]+$/, '')}`);
    }
    return [...new Set(out)].slice(0, 40);
}

// ---------------------------------------------------------------------------
// PHISHING SIMULATIONS (administrator policy managedPhishSimulationRules, Gmail)
// Training emails from KnowBe4, Wizer and similar services are recognized by the header they add
// (ideally with a secret value) and, optionally, by the vendor's sending servers; such an email is
// not checked at all, so no lookup can register a "click" with the vendor and nothing is hidden.
// ---------------------------------------------------------------------------
const IP_V4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
function ipToBig(ip) {
    const s = String(ip || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    const v4 = IP_V4_RE.exec(s.replace(/^::ffff:/, ''));
    if (v4) {
        const parts = v4.slice(1).map(Number);
        if (parts.some(p => p > 255)) return null;
        return { v: 4, n: parts.reduce((a, p) => (a << 8n) + BigInt(p), 0n) };
    }
    if (!/^[0-9a-f:]+$/.test(s) || !s.includes(':')) return null;
    const [head, tail] = s.split('::');
    if (s.split('::').length > 2) return null;
    const h = head ? head.split(':') : [], t = tail !== undefined && tail ? tail.split(':') : [];
    const missing = 8 - h.length - t.length;
    if (missing < 0 || (tail === undefined && missing !== 0)) return null;
    const groups = [...h, ...Array(tail === undefined ? 0 : missing).fill('0'), ...t];
    if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
    return { v: 6, n: groups.reduce((a, g) => (a << 16n) + BigInt(parseInt(g, 16)), 0n) };
}
// "147.160.167.0/26", "23.21.109.197", "2a02:2c8:1:400::29" or an IPv6 range.
function ipInList(ip, list) {
    const a = ipToBig(ip);
    if (!a) return false;
    for (const entry of list || []) {
        const [addr, bitsText] = String(entry).trim().split('/');
        const b = ipToBig(addr);
        if (!b || b.v !== a.v) continue;
        const width = a.v === 4 ? 32 : 128;
        const bits = bitsText === undefined ? width : Number(bitsText);
        if (!Number.isInteger(bits) || bits < 0 || bits > width) continue;
        const shift = BigInt(width - bits);
        if ((a.n >> shift) === (b.n >> shift)) return true;
    }
    return false;
}

function normalizePhishSimRules(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const r of raw.slice(0, 20)) {
        if (!r || typeof r !== 'object') continue;
        const header = String(r.header || '').trim();
        if (!/^[A-Za-z0-9-]{1,100}$/.test(header)) continue;
        const ips = Array.isArray(r.ips) ? r.ips.map(String).filter(x => ipToBig(x.split('/')[0])).slice(0, 100) : [];
        out.push({
            name: String(r.name || header).slice(0, 60),
            header: header.toLowerCase(),
            value: typeof r.value === 'string' ? r.value.trim().slice(0, 500) : '',
            ips,
            weak: !(typeof r.value === 'string' && r.value.trim()) && !ips.length   // public header only: spoofable
        });
    }
    return out;
}

// "by <receiver>" in a Received header, e.g. "by mx.google.com".
function receivedByRe(receiver) { return new RegExp(`\\bby ${String(receiver).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'); }
// The address of the server that handed the email to the webmail: the topmost Received header written
// by its receiving mail system ("by mx.google.com"); lower ones could have been written by the sender.
// Null when the email was placed in the mailbox directly (vendors' "direct injection"), which has no
// such hop, or when the receiver isn't known.
function deliveringIp(headers, receiver) {
    if (!receiver) return null;
    const by = receivedByRe(receiver);
    for (const [n, v] of headers) {
        if (n !== 'received') continue;
        if (!by.test(v)) continue;
        const from = v.split(by)[0];
        const m = /\[([0-9a-f:.]+)\]/i.exec(from);
        return m ? m[1] : null;
    }
    return null;
}

// The first rule an email matches, or null. A rule matches when the header is present (and, if set,
// its value contains the rule's value) and, if the rule lists addresses, the webmail's receiving mail
// system (receiver) got the email from one of them.
function matchPhishSimulation(raw, rules, receiver) {
    if (!rules || !rules.length) return null;
    const headers = parseRawHeaders(raw);
    let ip;
    for (const rule of rules) {
        const values = headers.filter(([n]) => n === rule.header).map(([, v]) => v);
        if (!values.length) continue;
        if (rule.value && !values.some(v => v.toLowerCase().includes(rule.value.toLowerCase()))) continue;
        if (rule.ips.length) {
            if (ip === undefined) ip = deliveringIp(headers, receiver);
            if (!ip || !ipInList(ip, rule.ips)) continue;
        }
        return rule;
    }
    return null;
}

// Training emails recognized by their links (administrator policy managedPhishSimulationDomains, every
// webmail): an email counts as a simulation only if it has links and EVERY link, after unwrapping
// security-gateway rewrites, goes to the vendor's domains. One link anywhere else and it's checked as
// usual, so a phishing email can't hide behind a single training-domain link. Returns the domain that
// matched, or null.
function linksAllOnSimulationDomains(urls, domains) {
    const web = (urls || []).filter(u => /^https?:\/\//i.test(u));
    if (!web.length || !domains || !domains.length) return null;
    let first = null;
    for (const u of web) {
        const host = urlHostname(u);
        const d = host && domains.find(x => host === x || host.endsWith('.' + x));
        if (!d) return null;
        first = first || d;
    }
    return first;
}

// Domains that must never be training domains: anyone can host pages or links there, so a real
// phishing email whose links all point to one would otherwise be left unchecked. Such entries in
// managedPhishSimulationDomains are refused (and logged).
const SHARED_PLATFORM_SUFFIXES = ['amazonaws.com', 'cloudfront.net', 'windows.net', 'azurewebsites.net', 'azureedge.net',
    'googleapis.com', 'googleusercontent.com', 'appspot.com', 'web.app', 'firebaseapp.com', 'pages.dev', 'workers.dev', 'r2.dev',
    'github.io', 'githubusercontent.com', 'gitlab.io', 'netlify.app', 'vercel.app', 'herokuapp.com', 'onrender.com', 'glitch.me',
    'surge.sh', 'wixsite.com', 'weebly.com', 'godaddysites.com', 'squarespace.com', 'wordpress.com', 'blogspot.com', 'webflow.io',
    'dropbox.com', 'box.com', 'notion.site', 'canva.site', 'ipfs.io', 'dweb.link', 'mailchimp.com', 'list-manage.com',
    'sendgrid.net', 'hubspot.com', 'hs-sites.com', 'typeform.com', 'jotform.com', 'surveymonkey.com', 'formstack.com',
    '000webhostapp.com', 'linktr.ee', 'docusign.net', 'adobe.com'];
function refusedSimulationDomain(d) {
    const reg = registrableDomain(d) || d;
    if (isPersonalMailDomain(d)) return 'a personal email provider';
    if (brandOfDomain(reg) || brandOfDomain(d)) return 'a well-known company\'s domain, where anyone can host content';
    if (typeof publicShorteners !== 'undefined' && (publicShorteners.includes(d) || publicShorteners.includes(reg))) return 'a public link shortener';
    if (SHARED_PLATFORM_SUFFIXES.some(s => d === s || d.endsWith('.' + s))) return 'a shared hosting or sending platform';
    return null;
}
function splitSimulationDomains(list) {
    const phishSimDomains = [], phishSimDomainsRefused = [];
    for (const d of list) {
        const why = refusedSimulationDomain(d);
        if (why) phishSimDomainsRefused.push({ domain: d, why }); else phishSimDomains.push(d);
    }
    return { phishSimDomains, phishSimDomainsRefused };
}

// ---------------------------------------------------------------------------
// SENDER IDENTITY AND SENDER THREAT CHECKS (Gmail)
// Each sender gets a verdict from its address and domain: the community scam-sender list (there is
// no sender block list), the phishing lists for its domain, and the DNS threat services. Only a FLAGGED
// sender's email is ever moved to Spam; unverified, unknown and clean senders are left alone.
// ---------------------------------------------------------------------------

// Country-code endings sold worldwide as generic names (.io, .co, .tv…): they say nothing about
// where the sender is, so they never give a country.
const VANITY_CCTLDS = new Set(['io', 'co', 'me', 'tv', 'ai', 'ly', 'to', 'fm', 'gg', 'cc', 'ws', 'nu', 'tk', 'ml', 'ga', 'cf', 'gq',
    'sh', 'la', 'is', 'gl', 'vc', 'ms', 'im', 'ac', 'sc', 'st', 'cx', 'pw', 'bz', 'am', 'cd', 'cm', 'je', 'li', 'lc', 'mu', 'ps', 'so',
    'tc', 'vg', 'ag', 'dj', 'gd', 'gy', 'ht', 'ki', 'md', 'mn', 'nf', 're', 'sx', 'tl', 'vu', 'su', 'tf', 'yt', 'pm', 'wf', 'as', 'ad', 'fo']);

// The country a domain's ending names ("example.de" → "DE"), or null for generic and vanity endings.
function countryFromDomain(domain) {
    const tld = String(domain || '').toLowerCase().replace(/\.$/, '').split('.').pop();
    if (!/^[a-z]{2}$/.test(tld) || VANITY_CCTLDS.has(tld)) return null;
    return tld === 'uk' ? 'GB' : tld.toUpperCase();
}

function isCountryCode(cc) { return typeof cc === 'string' && /^[A-Z]{2}$/.test(cc); }

// Flag emoji for a two-letter country code (systems without flag glyphs show the two letters).
function countryFlag(cc) {
    if (!isCountryCode(cc)) return '';
    return String.fromCodePoint(...[...cc].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

let countryNames = null;
function countryName(cc) {
    if (!isCountryCode(cc)) return '';
    try {
        if (!countryNames) countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
        return countryNames.of(cc) || cc;
    } catch (e) { return cc; }
}

// Views where emails may be moved to Spam (the webmail's `mail.views`, matched against the address
// after "#"): the inbox itself and its category tabs, list or opened conversation; with search
// true, also search results (`views.search`), unless the search looks in Spam, Trash, Sent, Drafts,
// chats or everywhere (`views.searchExcludes`), whose conversations a search in your mail doesn't
// show. Never from Spam, Trash, Sent, Drafts, labels or All mail. No such views known: never.
function viewAllowsAutoSpam(hash, views, search = false) {
    const h = String(hash || '').replace(/^#/, '');
    if (!views) return false;
    if (views.inbox && views.inbox.test(h)) return true;
    return !!search && isSearchView(h, views) && !(views.spam && views.spam.test(h));
}
// Search results (or a conversation opened from them) that moving may act on.
function isSearchView(hash, views) {
    const h = String(hash || '').replace(/^#/, '');
    if (!views || !views.search || !views.search.test(h)) return false;
    let q = h;
    try { q = decodeURIComponent(h.replace(/\+/g, ' ')); } catch (e) { /* malformed: kept as written */ }
    return !(views.searchExcludes && views.searchExcludes.test(q));
}

// Sender verdict from the separate checks. All inputs are optional:
//   address, ownDomain            the sender's address; the user's own organization domain
//   allowlisted                   the sender's domain is on the allowlist (yours or your organization's)
//   trustedHit                    the address or domain is on the trusted senders list
//   listHit                       { source: 'community', entry, name } (the community scam-sender list)
//   addressChecked                the address was compared with the phishing-sender lists
//   domainFeed                    name of the phishing list that has the sender's domain
//   dns                           the DNS threat verdict for the domain ({ verdict, reason, scanner, note })
//   dnsChecked                    false when the DNS check is switched off or offline
// Returns { status, reasons, move } with status 'flagged' | 'caution' | 'clean' | 'unverified' |
// 'unknown' | 'trusted'. move is true only for flagged senders.
const SENDER_DNS_NOT_SECURITY = new Set(['Cloudflare Family', 'AdGuard (backup)']);
function isOwnDomain(domain, ownDomain) { return !!ownDomain && (domain === ownDomain || domain.endsWith('.' + ownDomain)); }
// Big providers' and brands' own domains, and your own organization's, are never judged by
// domain-wide lists or DNS filters (a false positive there would hit every sender on gmail.com);
// their addresses still are.
function senderDomainShared(domain, ownDomain) {
    return isPersonalMailDomain(domain) || PROTECTED_DOMAINS.has(registrableDomain(domain)) || isOwnDomain(domain, ownDomain);
}
function combineSenderVerdict(input = {}) {
    const v = combineSenderVerdictInner(input);
    v.own = isOwnDomain(domainOfAddress(input.address), input.ownDomain);
    return v;
}
function combineSenderVerdictInner({ address, ownDomain, allowlisted, trustedHit, listHit, addressChecked, domainFeed, dns, dnsChecked } = {}) {
    const domain = domainOfAddress(address);
    const own = isOwnDomain(domain, ownDomain);
    const sharedDomain = senderDomainShared(domain, ownDomain);
    // Your trusted senders (yours and your organization's allow list): never flagged or moved.
    if (trustedHit) return { status: 'trusted', reasons: [`On your trusted senders list (${trustedHit}).`], move: false };
    const reasons = [];
    if (listHit) {
        const who = listHit.name || 'a community list';
        reasons.push(listHit.entry.includes('@') ? `This address is listed as a phishing or scam sender by ${who}.`
            : `The sender's domain ${listHit.entry} is listed as a phishing or scam sender by ${who}.`);
    }
    if (allowlisted) return { status: 'trusted', reasons: ['The sender\'s domain is on your trusted sites list.'], move: false };
    if (domainFeed && !sharedDomain) reasons.push(`The sender's domain ${domain} is listed as phishing by ${domainFeed}.`);
    const dnsFlag = !sharedDomain && dns && dns.verdict === 'unsafe';
    const securityFlag = dnsFlag && !SENDER_DNS_NOT_SECURITY.has(dns.scanner);
    if (securityFlag) reasons.push(`The sender's domain ${domain} is flagged by a security service: ${dns.reason || dns.scanner}.`);
    // Mail from your own organization is never moved (a domain-wide or community finding there would
    // hit colleagues); it is still flagged so the warning shows.
    if (reasons.length) return { status: 'flagged', reasons, move: !own };
    if (dnsFlag) return { status: 'caution', reasons: [`The sender's domain ${domain} is blocked by ${dns.scanner}: ${dns.reason || 'filtered'}.`], move: false };
    // Never green by default: your own domain and big shared providers can't be judged by domain
    // checks (anyone can sign up at gmail.com, and an own-domain From can be forged), so they stay
    // "not verified" unless something flags them or you trust them.
    if (own) return { status: 'unverified', reasons: [`Sent from your own organization's domain (${domain}); the sender isn't verified beyond that.`], move: false };
    if (sharedDomain) return { status: 'unverified', reasons: [addressChecked
        ? `${domain} is a well-known email provider or company that anyone can send from; this address is on no phishing-sender list, but that doesn't prove who sent it.`
        : `${domain} is a well-known email provider or company; the address itself wasn't checked.`], move: false };
    if (!dns || dnsChecked === false) return { status: 'unverified', reasons: ['The sender\'s domain wasn\'t checked (threat checks are off or offline).'], move: false };
    if (dns.verdict === 'safe') return { status: 'clean', reasons: ['Checked: no security service or list flags this sender.'], move: false };
    // A domain that doesn't exist can't send genuine mail (and replies can't reach it): forged.
    if (/doesn't exist/.test(dns.note || '')) return { status: 'flagged', reasons: [`The sender's domain ${domain} doesn't exist, so the address is forged and replies can't reach it.`], move: !own };
    return { status: 'unverified', reasons: [`The sender's domain couldn't be checked${dns.note ? ` (${String(dns.note).replace(/\.$/, '')})` : ''}.`], move: false };
}

// The site a sending domain belongs to, for its icon and label: mail-system prefixes are dropped
// ("email.notifications.paypal.com" → "paypal.com"), never anything else, so the label always ends
// with the sender's real domain.
const MAIL_PREFIX_LABEL = /^(e|em|email|emails|mail|mailer|mailing|mg|mgs|m|news|newsletter|newsletters|info|notify|notification|notifications|alert|alerts|bounce|bounces|reply|replies|send|sender|smtp|mta|out|outbound|post|marketing|comms|communications|go|t|link|links|click|mkt|crm|msg|messages|updates|noreply|no-reply)\d*$/;
function siteOfSender(domain) {
    const labels = String(domain || '').toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
    while (labels.length > 2 && MAIL_PREFIX_LABEL.test(labels[0]) && registrableDomain(labels.join('.')) !== labels.join('.')) labels.shift();
    return labels.join('.');
}

// ---------------------------------------------------------------------------
// SIGNS OF A FORGED OR JUNK EMAIL (Gmail). Each sign has a weight; together with the sender's
// verdict they decide the email's status (see applyEmailSignals). Weights: 3 = strong (something
// genuine mail systems never produce), 2 = medium, 1 = weak.
// ---------------------------------------------------------------------------
const SIGNAL_FLAG_SCORE = 5;           // at least this much: flagged (moved to Spam if that's on)
const SIGNAL_CAUTION_SCORE = 3;        // at least this much: caution

// "=?UTF-8?B?cHNzbWZyYW5jZS5mcg==?=" → "pssmfrance.fr" (RFC 2047; best effort, never throws).
function decodeEncodedWords(s) {
    return String(s || '').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (m, charset, enc, text) => {
        try {
            const bytes = enc.toLowerCase() === 'b'
                ? Uint8Array.from(atob(text.replace(/[^A-Za-z0-9+/=]/g, '')), c => c.charCodeAt(0))
                : Uint8Array.from(text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), c => c.charCodeAt(0) & 255);
            return new TextDecoder(/^utf-?8$/i.test(charset) ? 'utf-8' : 'latin1').decode(bytes);
        } catch (e) { return m; }
    });
}

// A sender address as written, even a broken one: { address, local, domain, malformed: [signs] }, or
// null when there is no "@" at all. A broken address is impossible in genuine mail (mail systems
// refuse to send it), so each of these signs is enough on its own to flag the email.
function parseSenderAddress(raw) {
    let v = String(raw || '').trim().replace(/^mailto:/i, '').replace(/^<|>$/g, '');
    if (!v.includes('@')) return null;
    const malformed = [];
    if (/=\?[^?]+\?[bq]\?[^?]*\?=/i.test(v)) {
        malformed.push({ weight: 5, text: 'The sender\'s address contains an encoded (disguised) part, which genuine mail systems never send.' });
        v = decodeEncodedWords(v);
    }
    const at = v.lastIndexOf('@');
    const local = v.slice(0, at).trim(), domain = v.slice(at + 1).trim().toLowerCase().replace(/\.$/, '').replace(/[>\s"]+$/, '');
    if (local.includes('@')) malformed.push({ weight: 5, text: 'The sender\'s address has more than one "@".' });
    if (local.length > 64) malformed.push({ weight: 5, text: `The sender's address has ${local.length} characters before the "@"; real addresses have at most 64.` });
    if (!SENDER_DOMAIN_RE.test(domain)) malformed.push({ weight: 5, text: `The sender's domain “${domain.slice(0, 60)}” isn't a valid domain name.` });
    return { address: `${local}@${domain}`.toLowerCase(), local, domain, malformed };
}

// The display name: decorations and padding that genuine senders don't use.
const INVISIBLE_CHARS_RE = /[\u115F\u1160\u3164\uFFA0\u2800\u200B\u200C\u2060-\u2064\uFEFF\u180E\u034F\u17B4\u17B5\u00AD]/g;
function displayNameAnomalies(name) {
    const n = String(name || '');
    const out = [];
    if (/["“”]{3,}|[•°˜º¤∙·◦★☆♥♦✓✔"“”]{3,}|[\t\r\n]|\s{6,}/.test(n) || n.length > 90) {
        out.push({ weight: 2, text: 'The sender\'s name is padded with symbols, quotes or blank space, a trick to slip past filters.' });
    }
    // Characters that print as nothing (the Hangul and braille "fillers", zero-width spaces): no one
    // types them into a name; they hide words or make a name look like a different one.
    if ((n.match(INVISIBLE_CHARS_RE) || []).length >= 3) {
        out.push({ weight: 3, text: 'The sender\'s name is padded with invisible characters, a trick to disguise it.' });
    }
    return out;
}

// When a Received or similar line was written: its date after ";", else a Gmail id like ".2025.11.09.".
function receivedTime(v) {
    const d = Date.parse(String(v).split(';').pop().trim());
    if (Number.isFinite(d)) return d;
    const m = /\.(20\d\d)\.(\d\d)\.(\d\d)\.\d\d\.\d\d\.\d\d\b/.exec(v);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
}

// Signs of forgery in an email's headers (Gmail "Show original"): [{ weight, text }].
const ESP_HEADER_MARKERS = [
    ['Mailgun', /^x-mailgun-/], ['SendGrid', /^x-sg-(id|eid)$/], ['Emarsys', /^x-emarsys-/], ['beehiiv', /^x-beehiiv-/],
    ['ActiveCampaign', /^x-report-abuse$/], ['250ok', /^x-250ok-/], ['MDaemon', /^x-mdaemon-|^x-md(arrival|helo)/], ['Postmark', /^x-pmmail-/],
    ['Cisco IronPort', /^x-ironport-/], ['Mailchimp', /^x-mc-user$/], ['Amazon SES', /^x-ses-/], ['cPanel', /^x-antiabuse$/]
];
// Bumped whenever headerAnomalies learns new signs, so results saved by an older version are worked
// out again (see messageInfo in content.js).
const HEADER_SIGNS_VERSION = 5;
// receiver: the webmail's receiving mail system, whose own records can be trusted:
// { host: 'mx.google.com', name: 'Gmail' } (see the `mail.headers` entry of WEBMAIL_SITES).
function headerAnomalies(raw, accountAddress, receiver = {}) {
    const headers = parseRawHeaders(raw);
    const out = [];
    const get = (n) => headers.filter(([h]) => h === n).map(([, v]) => v);
    // Delivery records ("Received:") are written as an email travels, minutes apart, newest on top
    // (the one Gmail writes on arrival). One dated long before that was written by the sender, copied
    // from other, older emails to look like a normal delivery: an extra record by the receiver more than
    // 2 days older (it writes one per arrival), or any record more than a week older (longer than any
    // mail server keeps retrying).
    const received = get('received');
    const newest = received.map(receivedTime).find(Number.isFinite);
    if (Number.isFinite(newest)) {
        const by = receiver.host ? receivedByRe(receiver.host) : null;
        const receiverHop = (v) => !!by && by.test(v);
        let receiverSeen = 0;
        const forged = received.filter(v => {
            const t = receivedTime(v), first = receiverHop(v) && receiverSeen++ === 0;
            return Number.isFinite(t) && (newest - t > 7 * 864e5 || (receiverHop(v) && !first && newest - t > 2 * 864e5));
        });
        if (forged.length) {
            const years = [...new Set(forged.map(v => new Date(receivedTime(v)).getUTCFullYear()))].sort();
            const n = forged.length, gm = forged.every(receiverHop);
            const what = `${n} fake ${gm && receiver.name ? receiver.name + ' ' : ''}delivery record${n === 1 ? '' : 's'}`;
            // One old record can be genuine (mail imported from an old mailbox), and so can two written
            // minutes apart (forwarded between two addresses, then imported). Records for two or more
            // other people (not this account), written more than 12 hours apart, were copied from
            // different emails: no genuine email has that.
            const own = new Set([...get('delivered-to'), accountAddress].map(a => String(a || '').trim().toLowerCase()).filter(Boolean));
            const others = forged.map(v => ({ to: (/\bfor\s+<?([^\s<>;]+@[^\s<>;]+?)>?[\s;]/i.exec(v + ' ') || [])[1], t: receivedTime(v) }))
                .filter(x => x.to && !own.has(x.to.toLowerCase()));
            const people = new Set(others.map(x => x.to.toLowerCase())).size;
            const spread = others.length ? Math.max(...others.map(x => x.t)) - Math.min(...others.map(x => x.t)) : 0;
            if (people >= 2 && spread > 12 * 36e5) out.push({ weight: 5, text: `Its headers contain ${what} copied from emails to ${people} other people${gm ? '' : ` (dated ${years.join(', ')})`}, which no genuine email has.` });
            else out.push({ weight: 3, text: `Its headers contain ${what} (copied from other, older emails${gm ? '' : `; dated ${years.join(', ')}`}).` });
        }
    }
    // The sender's own verification (DMARC), as Gmail itself recorded it on arrival. When the domain
    // in the From line publishes "quarantine" or "reject", its owner says mail that fails is not
    // theirs. A mailing list or forwarder can break DMARC for genuine mail, so a real mailing list
    // (a well-formed List-ID) or a trusted forwarding chain (ARC) only makes it a strong sign.
    const auth = parseAuthResults(raw, receiver.host);
    const listId = get('list-id')[0] || '';
    const realList = /<[a-z0-9][^<>\s]*\.[a-z]{2,}>/i.test(listId) && !/\.(local|localhost|invalid|test|example)>/i.test(listId);
    if (auth && auth.dmarc === 'fail') {
        const d = auth.headerFrom || 'its domain';
        if (auth.dmarcPolicy === 'quarantine' || auth.dmarcPolicy === 'reject') {
            out.push({ weight: auth.arc === 'pass' || realList ? 3 : 5,
                text: `It failed its sender's verification (DMARC): it wasn't sent by ${d}, whose owner asks for such mail to be ${auth.dmarcPolicy === 'reject' ? 'rejected' : 'treated as spam'}.` });
        } else {
            // Even where the owner only watches (p=none), a failure is worth a caution (amber); for a
            // real mailing list or a trusted forwarding chain, which often break DMARC, it stays a weak sign.
            out.push({ weight: auth.arc === 'pass' || realList ? 2 : 3, text: `It failed its sender's verification (DMARC), so it may not have been sent by ${d}.` });
        }
    }
    if (listId && !realList) out.push({ weight: 1, text: 'Its mailing-list ID is malformed (made up to look like a newsletter).' });
    // Format markers that only exist in one form: MIME-Version is always 1.0, and the transfer
    // encodings are a fixed set. Anything else is hand-made.
    const mime = (get('mime-version')[0] || '').trim();             // "1.0", maybe with a comment: "1.0 (Mac OS X Mail …)"
    if (mime && !/^1\.0(\s|\(|$)/.test(mime)) out.push({ weight: 2, text: `Its headers claim MIME version ${mime.split(/[\s(]/)[0].slice(0, 10)}, which doesn't exist (it is always 1.0).` });
    const cte = (get('content-transfer-encoding')[0] || '').trim().toLowerCase();
    if (cte && !/^(7bit|8bit|binary|quoted-printable|base64)$/.test(cte)) out.push({ weight: 2, text: `Its headers name an encoding that doesn't exist (“${cte.slice(0, 20)}”).` });
    if (headers.some(([h]) => /^re(c|s)i?v?ed$/.test(h) && h !== 'received')) out.push({ weight: 2, text: 'Its headers contain a misspelled delivery record (“Recived”), a sign of hand-made headers.' });
    // From
    const from = (get('from')[0] || '');
    const fm = /<([^>]*)>\s*$/.exec(from);
    const parsed = parseSenderAddress(fm ? fm[1] : (from.match(EMAIL_IN_TEXT_RE) || [''])[0] || from);
    if (parsed) out.push(...parsed.malformed);
    if (fm) out.push(...displayNameAnomalies(decodeEncodedWords(from.slice(0, fm.index))));
    // To: a display name that is an email address other than the real one, or a broken address.
    for (const to of get('to').slice(0, 3)) {
        const tm = /^\s*"?([^"<]*?)"?\s*<([^>]*)>/.exec(to);
        if (tm && /@/.test(tm[1]) && tm[1].trim().toLowerCase() !== tm[2].trim().toLowerCase()) {
            out.push({ weight: 2, text: 'Its “To” line shows one address but is really addressed to another.' });
            break;
        }
        if (tm && (tm[2].match(/@/g) || []).length > 1) { out.push({ weight: 3, text: 'Its “To” address is broken (two “@”).' }); break; }
    }
    // Subject: walls of blank space or long runs of random capitals; or filler and a random tail that
    // makes each copy unique ("125$ FOR YOU!_______kvksrphdly").
    const subject = get('subject')[0] || '';
    if (subject.length > 300 || /\s{60,}/.test(subject) || /[A-Z]{60,}/.test(subject)) out.push({ weight: 2, text: 'Its subject is padded with blank space or random letters to hide from filters.' });
    else if (/[_~=*]{4,}\s*[A-Za-z0-9]{6,}\s*$/.test(decodeEncodedWords(subject))) out.push({ weight: 2, text: 'Its subject ends in filler and random letters, which make each copy unique to slip past filters.' });
    // Address lines holding web-page code (<strong>, <br/>…): pasted text, never written by a mail program.
    const markup = /<\/?(strong|em|br|div|span|p|b|i|u|font|table|td|tr|img|html|body|head)(\s[^<>]*)?\/?>/i;
    if (['to', 'cc', 'bcc', 'reply-to', 'from'].some(n => get(n).some(v => markup.test(v)))) out.push({ weight: 3, text: 'Its address lines contain web-page code, which no mail program writes there.' });
    // A reply names the email it answers by its Message-ID (<id@host>), never by an address.
    const irt = (get('in-reply-to')[0] || '').trim();
    if (irt && !/</.test(irt) && /@/.test(irt)) out.push({ weight: 2, text: 'Its “In-Reply-To” line holds an address instead of a message ID: a made-up reply.' });
    // A signature in the name of a big mail provider (gmail.com…) whose key the provider doesn't have,
    // as the receiver recorded it: the providers publish every key they sign with, so it was made up.
    const results = headers.find(([n, v]) => n === 'authentication-results' && receiver.host && v.split(';')[0].trim().toLowerCase() === receiver.host);
    const fakeSig = results && [...results[1].matchAll(/dkim=permerror\s*\(no key[^)]*\)\s*header\.(?:i=@?|d=)([^\s;]+)/gi)].map(m => domainOfAddress(m[1])).find(isPersonalMailDomain);
    if (fakeSig) out.push({ weight: 3, text: `It carries a fake ${fakeSig} signature (with a key ${fakeSig} doesn't have).` });
    // A mail system it passed through (often the sender's own provider) already found it was spam.
    if (get('x-spam-flag').some(v => /^\s*yes\b/i.test(v)) || get('x-spam-status').some(v => /^\s*yes\b/i.test(v))) out.push({ weight: 3, text: 'A mail system it passed through had already marked it as spam.' });
    // An unsubscribe link or tracking image on the sender's own computer (127.0.0.1, localhost) or a
    // private network: a home-made bulk-mail tool. (Only those: other links to localhost are normal in
    // developers' mail, such as quoted bug reports.)
    const local = String.raw`(?:https?:)?//(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d+)?(?=[/?#"'>\s]|$)`;
    const body = String(raw || '').replace(/\r\n/g, '\n').split(/\n\n/).slice(1).join('\n\n').slice(0, 200000).replace(/=\n/g, '').replace(/=3D/gi, '=');
    if (get('list-unsubscribe').some(v => new RegExp(local, 'i').test(v)) || new RegExp(`${local}[^\\s"'<>]*(unsub|opt-?out)`, 'i').test(body)
        || new RegExp(`<img\\b[^>]*\\bsrc=["']?${local}`, 'i').test(body)) {
        out.push({ weight: 3, text: 'Its unsubscribe link or tracking image points to the sender\'s own computer (such as 127.0.0.1), a sign of a home-made bulk-mail tool.' });
    }
    // Headers claiming several unrelated sending services at once.
    const names = new Set(headers.map(([h]) => h));
    const esps = ESP_HEADER_MARKERS.filter(([, re]) => [...names].some(h => re.test(h))).map(([n]) => n);
    if (esps.length >= 3) out.push({ weight: 3, text: `Its headers claim it was sent by ${esps.length} unrelated email services at once (${esps.slice(0, 4).join(', ')}), so they were copied together to look legitimate.` });
    // Unfilled template placeholders such as "(_IE6rxc5)" or "[RANDOM1]".
    const placeholder = headers.map(([, v]) => v).join('\n').match(/\(_[A-Za-z0-9]{4,12}\)|\[RANDOM\d*\]|__Random_/g);
    if (placeholder && placeholder.length >= 3) out.push({ weight: 2, text: 'Its headers contain unfilled placeholders from a bulk-mailing tool.' });
    // Headers that must appear once.
    const dup = ['from', 'subject', 'date', 'message-id', 'mime-version'].filter(n => get(n).length > 1);
    if (new Set(get('content-length').map(v => v.trim())).size > 1) dup.push('content-length');   // two different sizes
    if (dup.length) out.push({ weight: 2, text: `Its headers repeat ${dup.map(d => d.replace(/(^|-)([a-z])/g, (m, a, b) => a + b.toUpperCase())).join(', ')}, which a mail program writes only once.` });
    return out;
}

// The email's status from the sender's verdict and the signs found in this particular email
// (headers, name, links, attachments). Returns a new verdict; base is not changed.
function applyEmailSignals(base, signals) {
    if (!base) return null;
    const list = (signals || []).filter(Boolean);
    if (!list.length) return base;
    const score = list.reduce((a, x) => a + (x.weight || 0), 0);
    const texts = [...new Set(list.map(x => x.text))].filter(t => !base.reasons.includes(t));
    const plain = base.reasons.filter(r => !/^Checked:|well-known email provider|^Sent from your own|wasn't checked|couldn't be checked/.test(r));
    if (base.status === 'flagged') return Object.assign({}, base, { reasons: [...base.reasons, ...texts], score });
    if (score >= SIGNAL_FLAG_SCORE) {
        return Object.assign({}, base, { status: 'flagged', reasons: [...texts, ...plain], move: base.status !== 'trusted' && !base.own, score });
    }
    if (score >= SIGNAL_CAUTION_SCORE && base.status !== 'trusted') return Object.assign({}, base, { status: 'caution', reasons: [...texts, ...plain], move: false, score });
    return Object.assign({}, base, { reasons: [...base.reasons, ...texts], score });
}
