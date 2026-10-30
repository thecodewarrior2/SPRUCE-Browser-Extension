// background.js — the service worker. Owns the link pipeline (resolveLink), threat checks, short-link
// lookups, the community-list sync and its safeguards, logging, cleanup alarms, the toolbar badge and
// the message API used by Gmail, the popup and the Options page. It holds no long-running work: every
// task is triggered by a message, an alarm or a storage change, and in-memory caches are bounded.

importScripts('shared.js', 'decoders.js', 'custom-endpoints.js', 'qr-decoder.js', 'icon-store.js');

// ---------------------------------------------------------------------------
// SETTINGS CACHE
// The effective settings (user values merged with policy) are read from storage once and kept in
// memory until something relevant changes, instead of being re-read for every link. Derived lookup
// sets (allowlist, blocklist, the synced shortener list…) are built once per settings version.
// ---------------------------------------------------------------------------
let configPromise = null;
function getConfig() {
    if (!configPromise) configPromise = loadEffectiveSettings().catch((e) => { configPromise = null; throw e; });
    return configPromise;
}

// Keys that never affect settings; changes to them don't invalidate the cache.
const NON_CONFIG_KEYS = new Set(['errorLogs', 'recentActivity', 'resolutionHistory', 'lastSyncTime', 'listState', 'cacheSchema', 'welcomeDismissed', 'uiTheme',
    'detectedConflicts', 'ignoredConflicts', 'keptConflictFeatures',
    'senderDomainCache', 'geoCache', 'spamMovedThreads', 'spamRescuedThreads', 'senderMessageCache', 'senderResultCache', 'faviconCache', 'spamMoveLog']);
function invalidateConfig() {
    configPromise = null;
    domainSafetyCache.clear();      // e.g. a resolver was switched off: don't reuse its verdicts
    if (typeof clearSenderDomainCache === 'function') clearSenderDomainCache();
    if (typeof cacheMemo !== 'undefined') cacheMemo.clear();        // nor link results remembered in memory
}
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'managed' || Object.keys(changes).some(k => !k.startsWith('http') && !NON_CONFIG_KEYS.has(k))) invalidateConfig();
    // Sender data cleared in Settings (Logging → Senders, or Delete now) is forgotten in memory too.
    if (area === 'local' && typeof senderResultCache !== 'undefined') {
        const caches = { senderResultCache, geoCache, senderDomainCache };
        for (const [k, c] of Object.entries(changes)) if (caches[k] && c.newValue === undefined) caches[k].forget();
    }
    // Stored link results removed by any path (Clear cache, expiry) leave the in-memory memo too.
    if (area === 'local' && typeof cacheMemo !== 'undefined') {
        for (const [k, c] of Object.entries(changes)) if (k.startsWith('http') && c.newValue === undefined) cacheMemo.delete(k);
    }
});

const derivedSets = new WeakMap();
function cfgSets(cfg) {
    let sets = derivedSets.get(cfg);
    if (!sets) {
        sets = {
            allow: new Set(cfg.allowlist),
            block: new Set(cfg.blocklist),
            managedBlock: new Set(cfg.managedBlocklist),
            remote: compactSet(cfg.remoteShorteners),
            trusted: new Set(cfg.trustedSenders)
        };
        derivedSets.set(cfg, sets);
    }
    return sets;
}

// ---------------------------------------------------------------------------
// LOGGING (serialized so concurrent writes can't overwrite each other)
//
// Where things are recorded:
//   Application log     (errorLogs)          every error, warning and informational event, with level,
//                                            source, full date and a repeat count
//   Resolution History  (resolutionHistory)  link results (safe / flagged / not verified / blocked)
//                                            and tracking-pixel events
//   Popup activity      (recentActivity)     link and pixel events, plus errors (not warnings/info)
//
// Application log messages only ever contain a link's origin (logUrl), never its path or query, so
// tokens and personal data in links never end up in the log.
// ---------------------------------------------------------------------------
const LOG_LEVELS = ['error', 'warning', 'info'];

let logQueue = Promise.resolve();
function enqueueLog(task) {
    logQueue = logQueue.then(task).catch((e) => console.warn('[Background] log write failed:', e));
    return logQueue;
}

// "https://host/…" for error messages: enough to identify the service, nothing more.
function logUrl(urlString) {
    try {
        const u = new URL(urlString);
        return u.pathname === '/' && !u.search ? u.origin : `${u.origin}/…`;
    } catch (e) {
        return '(invalid link)';
    }
}

function errorText(e) {
    if (!e) return 'unknown error';
    if (e.name === 'AbortError') return 'timed out';
    return String(e.message || e).slice(0, 300);
}

// Pure: returns the new error-log array (newest first) with the entry added or merged.
function addLogEntry(logs, level, source, message, now) {
    const list = Array.isArray(logs) ? logs.slice() : [];
    const i = list.slice(0, 30).findIndex(l => l && l.level === level && l.source === source && l.message === message &&
                                             now - (l.timestampMs || 0) < LOG_DEDUPE_MS);
    if (i > -1) {
        const merged = Object.assign({}, list[i], { count: (list[i].count || 1) + 1, timestampMs: now, time: new Date(now).toLocaleString() });
        list.splice(i, 1);
        list.unshift(merged);
        return { logs: list, merged: true };
    }
    list.unshift({ time: new Date(now).toLocaleString(), timestampMs: now, level, source, message, count: 1 });
    return { logs: list.slice(0, MAX_ERROR_LOGS), merged: false };
}

// Log events are buffered in memory and written together, so an email with 100 links causes one
// storage write instead of hundreds. LOG_FLUSH_MS is short enough that the service worker (kept
// alive by the event that produced the entry) always flushes before it can be stopped.
const LOG_FLUSH_MS = 500;
let logBuffer = [];          // [{ kind: 'log' | 'history', ... }] in the order they happened
let cacheBuffer = {};        // link results waiting to be written: { url: entry }

// In-memory front for the result cache: the same links recur constantly (signatures, footers,
// newsletter templates), so a bounded memo of recent hits and misses saves a storage read each time.
const CACHE_MEMO_MAX = 2000;
const cacheMemo = new Map();           // url → entry, or null for a known miss
function memoRemember(url, entry) {
    if (cacheMemo.size >= CACHE_MEMO_MAX) cacheMemo.delete(cacheMemo.keys().next().value);
    cacheMemo.set(url, entry);
}
async function readCachedResult(url) {
    if (cacheBuffer[url]) return cacheBuffer[url];
    if (cacheMemo.has(url)) return cacheMemo.get(url);
    const entry = (await storageGet('local', [url]))[url] || null;
    memoRemember(url, entry);
    return entry;
}

// Queues a link result for the cache; written with the next batch.
function cacheResult(url, entry) {
    cacheBuffer[url] = entry;
    memoRemember(url, entry);
    scheduleLogFlush();
}
let logFlushTimer = null;

function scheduleLogFlush() {
    if (!logFlushTimer) logFlushTimer = setTimeout(flushLogBuffers, LOG_FLUSH_MS);
}

function writeLog(level, source, message) {
    if (!LOG_LEVELS.includes(level)) level = 'error';
    source = String(source || 'Extension').slice(0, 60);
    message = String(message || '').slice(0, 500);
    if (level === 'error') console.warn(`[${source}] ${message}`);
    logBuffer.push({ kind: 'log', level, source, message, now: Date.now() });
    scheduleLogFlush();
}

const logError   = (message, source = 'Extension') => writeLog('error', source, message);
const logWarning = (message, source = 'Extension') => writeLog('warning', source, message);
const logInfo    = (message, source = 'Extension') => writeLog('info', source, message);

// An entry for the popup's recent activity only (e.g. emails moved to Spam).
function logActivity(type, text) {
    logBuffer.push({ kind: 'activity', type, text: String(text).slice(0, 300), now: Date.now() });
    scheduleLogFlush();
}

// verdict: 'safe' | 'unsafe' | 'unknown' (not verified) | 'blocked' (blocklisted, destination hidden) | 'pixel'
function logHistoryEntry({ shortUrl, finalUrl, verdict, reason, resolvedIp, resolver, dedupeMs = 0 }) {
    logBuffer.push({ kind: 'history', shortUrl, finalUrl, verdict, reason, resolvedIp, resolver, dedupeMs, now: Date.now() });
    scheduleLogFlush();
}

function historyActivity(h) {
    const time = new Date(h.now).toLocaleTimeString();
    if (h.verdict === 'pixel') return { time, timestampMs: h.now, type: 'Pixel Blocked', text: `${h.reason}: ${h.shortUrl}` };
    if (h.verdict === 'blocked') return { time, timestampMs: h.now, type: 'Blocked', text: `${h.shortUrl} [${h.reason}]` };
    const status = h.verdict === 'safe' ? 'Resolved (Safe)'
        : h.verdict === 'unknown' ? `Resolved (not verified${h.reason ? ': ' + h.reason : ''})` : `Flagged (${h.reason || 'Unsafe'})`;
    return { time, timestampMs: h.now, type: h.verdict === 'unsafe' ? 'Security Warning' : 'Success', text: `${h.shortUrl} → ${h.finalUrl} [${status}]` };
}

// Writes everything buffered in one read and one write. Returns the log queue promise.
function flushLogBuffers() {
    clearTimeout(logFlushTimer);
    logFlushTimer = null;
    if (!logBuffer.length && !Object.keys(cacheBuffer).length) return logQueue;
    const batch = logBuffer;
    const cacheBatch = cacheBuffer;
    logBuffer = [];
    cacheBuffer = {};
    return enqueueLog(async () => {
        const wantsHistory = batch.some(e => e.kind === 'history');
        const historyOn = wantsHistory ? (await getConfig()).values.enableHistoryLog : false;
        const stored = await storageGet('local', { errorLogs: [], recentActivity: [], resolutionHistory: [] });
        let logs = Array.isArray(stored.errorLogs) ? stored.errorLogs : [];
        let activity = Array.isArray(stored.recentActivity) ? stored.recentActivity : [];
        let history = Array.isArray(stored.resolutionHistory) ? stored.resolutionHistory : [];
        const updates = {};

        for (const e of batch) {
            if (e.kind === 'log') {
                const r = addLogEntry(logs, e.level, e.source, e.message, e.now);
                logs = r.logs;
                updates.errorLogs = logs;
                if (e.level === 'error' && !r.merged) {
                    activity.unshift({ time: new Date(e.now).toLocaleTimeString(), timestampMs: e.now, type: 'Error', text: `${e.source}: ${e.message}` });
                    updates.recentActivity = activity;
                }
            } else if (e.kind === 'activity') {
                activity.unshift({ time: new Date(e.now).toLocaleTimeString(), timestampMs: e.now, type: e.type, text: e.text });
                updates.recentActivity = activity;
            } else if (historyOn) {
                if (e.dedupeMs && history.slice(0, 20).some(h => h.shortUrl === e.shortUrl && h.verdict === e.verdict && e.now - (h.timestampMs || 0) < e.dedupeMs)) continue;
                history.unshift({
                    timestamp: new Date(e.now).toLocaleString(),
                    timestampMs: e.now,
                    shortUrl: e.shortUrl, finalUrl: e.finalUrl, verdict: e.verdict,
                    isSafe: e.verdict === 'safe' || e.verdict === 'unknown',
                    reason: e.reason || (e.verdict === 'safe' ? 'Clean' : e.verdict === 'unknown' ? 'Not verified' : ''),
                    resolvedIp: e.resolvedIp || 'N/A',
                    resolver: e.resolver || ''
                });
                activity.unshift(historyActivity(e));
                updates.resolutionHistory = history;
                updates.recentActivity = activity;
            }
        }
        if (updates.resolutionHistory) updates.resolutionHistory = history.slice(0, MAX_HISTORY);
        if (updates.recentActivity) updates.recentActivity = activity.slice(0, MAX_ACTIVITY);
        if (Object.keys(cacheBatch).length) {
            try {
                await chrome.storage.local.set(cacheBatch);
            } catch (e) {
                const a = addLogEntry(logs, 'error', 'Storage', `${Object.keys(cacheBatch).length} link result(s) could not be saved to the cache (${errorText(e)}). If storage is full, clear it under Logging → URL cache.`, Date.now());
                updates.errorLogs = a.logs;
                if (!a.merged) {
                    activity.unshift({ time: new Date().toLocaleTimeString(), timestampMs: Date.now(), type: 'Error', text: 'Storage: link results could not be cached' });
                    updates.recentActivity = activity.slice(0, MAX_ACTIVITY);
                }
            }
        }
        if (Object.keys(updates).length) await chrome.storage.local.set(updates);
    });
}

// Uncaught failures anywhere in the background are recorded instead of disappearing.
self.addEventListener('error', (event) => {
    logError(`Unexpected error: ${errorText(event.error || event)}${event.filename ? ` (${String(event.filename).split('/').pop()}:${event.lineno})` : ''}`, 'Background');
});
self.addEventListener('unhandledrejection', (event) => {
    logError(`Unhandled failure: ${errorText(event.reason)}`, 'Background');
});

// ---------------------------------------------------------------------------
// STORAGE MAINTENANCE
// ---------------------------------------------------------------------------
async function pruneExpiredData(retentionDays = 30) {
    const cutoffMs = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    iconStore.prune().catch(() => {});              // sender icons: their own 30 days and size limit
    const items = await storageGet('local', null);
    const keysToRemove = [];
    const updates = {};

    Object.keys(items).forEach(key => {
        if (key.startsWith('http://') || key.startsWith('https://')) {
            const entry = items[key];
            const itemTime = entry && entry.cachedTimestamp ? entry.cachedTimestamp : (entry && entry.cachedDate ? Date.parse(entry.cachedDate) : 0);
            if (!itemTime || itemTime < cutoffMs) keysToRemove.push(key);
        }
    });

    if (Array.isArray(items.resolutionHistory)) {
        const freshHistory = items.resolutionHistory.filter(entry => {
            const itemTime = entry.timestampMs || (entry.timestamp ? Date.parse(entry.timestamp) : 0);
            return itemTime >= cutoffMs;
        });
        if (freshHistory.length !== items.resolutionHistory.length) updates.resolutionHistory = freshHistory;
    }

    // The application log and popup activity follow the same retention (entries without a timestamp come
    // from older versions and are left to age out through the size limit).
    ['errorLogs', 'recentActivity'].forEach(key => {
        if (!Array.isArray(items[key])) return;
        const fresh = items[key].filter(e => !e || !e.timestampMs || e.timestampMs >= cutoffMs);
        if (fresh.length !== items[key].length) updates[key] = fresh;
    });

    // Sender data (server addresses per email, their countries) follows the same retention.
    if (items.senderMessageCache && typeof items.senderMessageCache === 'object') {
        const fresh = Object.fromEntries(Object.entries(items.senderMessageCache).filter(([, v]) => v && v.t >= cutoffMs && !v.from));
        if (Object.keys(fresh).length !== Object.keys(items.senderMessageCache).length) updates.senderMessageCache = fresh;
    }
    // The moved-to-Spam log too (the memory of which conversations were moved is kept: spamMovedThreads).
    if (Array.isArray(items.spamMoveLog)) {
        const fresh = items.spamMoveLog.filter(e => e && e.ts >= cutoffMs);
        if (fresh.length !== items.spamMoveLog.length) updates.spamMoveLog = fresh;
    }

    if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
        logInfo(`Removed ${keysToRemove.length} cached link result(s) older than ${retentionDays} days.`, 'Storage cleanup');
    }
    if (Object.keys(updates).length > 0) {
        await chrome.storage.local.set(updates);
        if (updates.resolutionHistory) logInfo(`Removed resolution history entries older than ${retentionDays} days.`, 'Storage cleanup');
    }
}

// Remove one-time URLs that earlier versions stored in the cache / history.
function purgeOneTimeEntries() {
    chrome.storage.local.get(null, (items) => {
        const isHttp = (k) => k.startsWith('http://') || k.startsWith('https://');
        const keysToRemove = Object.keys(items).filter(k =>
            isHttp(k) && (isSingleUseToken(k) || isSingleUseToken((items[k] && items[k].finalUrl) || ''))
        );
        const updates = {};
        if (Array.isArray(items.resolutionHistory)) {
            updates.resolutionHistory = items.resolutionHistory.filter(h =>
                !(isSingleUseToken(h.shortUrl || '') || isSingleUseToken(h.finalUrl || '')));
        }
        if (Array.isArray(items.recentActivity)) {
            updates.recentActivity = items.recentActivity.filter(a => !isSingleUseToken(a.text || ''));
        }
        if (keysToRemove.length) chrome.storage.local.remove(keysToRemove);
        if (Object.keys(updates).length) chrome.storage.local.set(updates);
    });
}

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

// The community lists are fetched from third-party repositories, so their entries are treated as
// untrusted input:
//  - size limits stop a runaway or hostile file from filling storage;
//  - major sites are never accepted (an entry like "google.com" would otherwise send every Google
//    Docs link to unshorten.me);
//  - entries only decide whether a short-looking link may be resolved; they never suppress
//    warnings or remove images.
// To pin a reviewed snapshot, replace "master" in REMOTE_LIST_URLS with a commit hash.

function sanitizeRemoteDomains(list) {
    const out = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
        const d = String(raw || '').trim().toLowerCase();
        if (!d || d.startsWith('#') || !DOMAIN_RE.test(d)) continue;
        if (PROTECTED_DOMAINS.has(registrableDomain(d))) continue;
        out.add(d);
        if (out.size >= REMOTE_LIST_MAX_DOMAINS) break;
    }
    return Array.from(out);
}

// ---------------------------------------------------------------------------
// COMMUNITY LIST SYNC WITH AUTO-UPDATE SAFEGUARDS
// Each list is tracked separately (listState.sources[url]) so one list failing never removes the
// other list's domains. Rules, per list:
//  - First successful download (or the first after a long gap / after sync was re-enabled) is the
//    new starting point and is used immediately.
//  - After that, a domain that is NEW in the list is held until it has been seen on three separate
//    days. Removals take effect immediately (removing is always the safe direction).
//  - A download that changes a large share of the list at once is not applied. If the change is
//    real it is accepted automatically after REMOTE_LIST_FRESH_START_MS without a successful sync.
//  - Until every list has a starting point, the bundled snapshot (or, after an upgrade, the
//    previously stored list) is used as a fallback, so coverage never starts empty.
// ---------------------------------------------------------------------------

// Pure function (no storage, no network) so the rules can be tested directly.
// prev: { active: [], pending: { domain: { count, last } }, lastSuccess } or undefined.
function applyListUpdate(prev, incoming, now, forceFresh = false) {
    const fresh = forceFresh || !prev || !prev.lastSuccess || (now - prev.lastSuccess) > REMOTE_LIST_FRESH_START_MS;
    if (fresh) {
        return { accepted: true, kind: 'baseline', added: incoming.length, removed: 0, promoted: 0,
                 state: { active: incoming.slice(), pending: {}, lastSuccess: now } };
    }
    const active = new Set(prev.active || []);
    const pending = prev.pending || {};
    const seenBefore = new Set([...active, ...Object.keys(pending)]);
    const inc = new Set(incoming);

    let added = 0, removed = 0;
    inc.forEach(d => { if (!seenBefore.has(d)) added++; });
    seenBefore.forEach(d => { if (!inc.has(d)) removed++; });
    const limit = Math.max(REMOTE_LIST_MIN_CHANGE_LIMIT, Math.ceil(seenBefore.size * REMOTE_LIST_MAX_CHANGE_RATIO));
    if (added + removed > limit) {
        return { accepted: false, kind: 'rejected', added, removed, promoted: 0, state: prev };
    }

    const nextActive = [...active].filter(d => inc.has(d));      // removals are immediate
    const nextPending = {};
    let promoted = 0;
    inc.forEach(d => {
        if (active.has(d)) return;
        let { count, last } = pending[d] || { count: 0, last: 0 };
        if (now - last >= REMOTE_LIST_SIGHTING_GAP_MS) { count++; last = now; }   // one sighting per day
        if (count >= REMOTE_LIST_HOLD_SIGHTINGS) { nextActive.push(d); promoted++; }
        else nextPending[d] = { count, last };
    });
    return { accepted: true, kind: 'update', added, removed, promoted,
             state: { active: nextActive, pending: nextPending, lastSuccess: now } };
}

// Domains the extension actually uses: every list's active domains, plus the fallback
// (bundled snapshot or pre-upgrade list) while any list still lacks a starting point.
function combineListState(listState) {
    const out = new Set();
    let allEstablished = true;
    for (const url of REMOTE_LIST_URLS) {
        const src = listState.sources[url];
        if (src && src.lastSuccess) (src.active || []).forEach(d => out.add(d));
        else allEstablished = false;
    }
    if (!allEstablished) (listState.fallback || []).forEach(d => out.add(d));
    return Array.from(out).sort();                       // sorted: loads as a compact list without sorting
}

async function loadBundledSnapshot() {
    try {
        const res = await fetch(chrome.runtime.getURL('shortener-snapshot.txt'));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return sanitizeRemoteDomains((await res.text()).split('\n'));
    } catch (e) {
        logError(`The bundled shortener snapshot could not be loaded (${errorText(e)}); coverage starts with the built-in list until the first download.`, 'List sync');
        return [];
    }
}

// Creates the list state on first run. Fresh installs start from the bundled snapshot; existing
// users upgrading keep their current stored list as the fallback, so nothing changes on the day of
// the update.
async function ensureListState() {
    const items = await storageGet('local', ['listState', 'remoteShorteners']);
    if (items.listState && items.listState.sources) return items.listState;
    const previous = sanitizeRemoteDomains(items.remoteShorteners);
    const listState = previous.length
        ? { sources: {}, fallback: previous, fallbackKind: 'previous', syncDisabledSince: null }
        : { sources: {}, fallback: await loadBundledSnapshot(), fallbackKind: 'snapshot', syncDisabledSince: null };
    await chrome.storage.local.set({ listState, remoteShorteners: combineListState(listState) });
    return listState;
}

let listSyncRunning = null;
function updateRemoteLists() {
    // One sync at a time: the alarm, install and "Force Sync" can overlap.
    if (!listSyncRunning) {
        listSyncRunning = runListSync()
            .catch((e) => { logError(`Shortener list sync failed: ${errorText(e)}`, 'List sync'); return { skipped: false, error: true }; })
            .finally(() => { listSyncRunning = null; });
    }
    return listSyncRunning;
}

async function runListSync() {
    const cfg = await getConfig();
    const listState = await ensureListState();
    const now = Date.now();

    // Third-party lists are downloaded at most once a day, whatever asked for the update.
    const { lastSyncTime } = await storageGet('local', ['lastSyncTime']);
    if (cfg.values.enableRemoteListSync && lastSyncTime && now - lastSyncTime < THIRD_PARTY_LIST_MIN_INTERVAL_MS) {
        return { skipped: true, fresh: true, nextAt: lastSyncTime + THIRD_PARTY_LIST_MIN_INTERVAL_MS };
    }

    if (!cfg.values.enableRemoteListSync) {
        // Remember that sync was off, so turning it back on starts fresh instead of comparing a
        // months-old list with today's (which would look like a suspicious mass change).
        if (!listState.syncDisabledSince) {
            listState.syncDisabledSince = now;
            await chrome.storage.local.set({ listState });
        }
        chrome.action.setBadgeText({ text: "" });
        return { skipped: true };
    }

    const forceFresh = !!listState.syncDisabledSince;
    const summaries = [];   // [level, message]
    let anySuccess = false;

    for (const url of REMOTE_LIST_URLS) {
        const name = url.split('/').slice(3, 5).join('/');
        let incoming;
        try {
            const response = await fetchWithTimeout(url, {}, 15000);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();
            if (text.length > REMOTE_LIST_MAX_BYTES) throw new Error(`list too large (${text.length} bytes)`);
            incoming = sanitizeRemoteDomains(text.split('\n'));
            if (incoming.length === 0) throw new Error('list was empty');
        } catch (fetchErr) {
            summaries.push(['warning', `${name}: download failed (${errorText(fetchErr)}); kept the current list.`]);
            continue;
        }

        const r = applyListUpdate(listState.sources[url], incoming, now, forceFresh);
        listState.sources[url] = r.state;
        if (r.kind === 'baseline') {
            anySuccess = true;
            summaries.push(['info', `${name}: starting point set with ${incoming.length} domains.`]);
        } else if (r.kind === 'update') {
            anySuccess = true;
            if (r.added || r.removed || r.promoted) {
                summaries.push(['info', `${name}: ${r.removed} removed, ${r.promoted} now in use after 3 days, ` +
                               `${Object.keys(r.state.pending).length} new domain(s) on hold.`]);
            }
        } else {
            summaries.push(['warning', `${name}: not applied — ${r.added} added and ${r.removed} removed at once is an unusually large change. ` +
                           `It will be accepted automatically if it is still there in 7 days.`]);
        }
    }

    if (anySuccess) listState.syncDisabledSince = null;
    const remoteShorteners = combineListState(listState);
    const updates = { listState, remoteShorteners };
    if (anySuccess) updates.lastSyncTime = new Date().toLocaleString();
    await chrome.storage.local.set(updates);
    summaries.forEach(([level, message]) => writeLog(level, 'List sync', message));

    if (!anySuccess) {
        chrome.action.setBadgeText({ text: "ERR" });
        chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
        logError('No shortener list could be downloaded; the extension keeps using its current list and will retry at the next daily sync.', 'List sync');
        return { skipped: false, error: true };
    }
    chrome.action.setBadgeText({ text: "" });
    return { skipped: false };
}

// Re-enabling sync (by the user, a restored backup or a policy change) syncs right away.
chrome.storage.onChanged.addListener((changes, area) => {
    const relevant = (area === 'local' && 'enableRemoteListSync' in changes) ||
                     (area === 'managed' && 'managedEnableRemoteListSync' in changes);
    if (relevant) updateRemoteLists();
});

// v5.9/5.10 changed how verdicts are computed (wrapper-host checks, resolver roles, blocklist), so
// results cached by earlier versions are dropped once, and an already-synced list is re-sanitized.
const CACHE_SCHEMA = 4;   // 4: email trackers are no longer cached as "safe"
async function migrateStoredData() {
    const items = await storageGet('local', null);
    if (items.cacheSchema === CACHE_SCHEMA) return;
    const urlKeys = Object.keys(items).filter(k => k.startsWith('http://') || k.startsWith('https://'));
    if (urlKeys.length) {
        await chrome.storage.local.remove(urlKeys);
        cacheMemo.clear();
        logInfo(`Cleared ${urlKeys.length} cached link result(s) after an update, because results are now computed differently.`, 'Update');
    }
    const updates = { cacheSchema: CACHE_SCHEMA };
    if (Array.isArray(items.remoteShorteners) && !items.listState) updates.remoteShorteners = sanitizeRemoteDomains(items.remoteShorteners);
    await chrome.storage.local.set(updates);
}

function ensureAlarms() {
    ['syncLists', 'pruneExpiredEntries'].forEach(name => {
        chrome.alarms.get(name, (existing) => {
            if (!existing) chrome.alarms.create(name, { periodInMinutes: 1440 });
        });
    });
}

// Phishing lists: checked once a day (each list is only downloaded when a day has passed).
chrome.alarms.get('syncPhishFeeds', (existing) => {
    if (!existing || existing.periodInMinutes !== 1440) chrome.alarms.create('syncPhishFeeds', { delayInMinutes: 1, periodInMinutes: 1440 });
});
ensureAlarms();

chrome.runtime.onInstalled.addListener(async (details) => {
    try {
        if (details && details.reason === 'update') purgeOneTimeEntries();
        await migrateStoredData();
        await ensureListState();      // bundled snapshot on a fresh install: coverage before any download
        ensureAlarms();
        const cfg = await getConfig();
        updateRemoteLists();
        syncPhishFeeds().catch(() => {});          // a list added by this version is fetched now, not tomorrow
        await pruneExpiredData(cfg.values.retentionDays);
        if (details && (details.reason === 'install' || details.reason === 'update')) {
            logInfo(details.reason === 'install' ? `Installed version ${chrome.runtime.getManifest().version}.`
                                                 : `Updated from ${details.previousVersion || 'an earlier version'} to ${chrome.runtime.getManifest().version}.`, 'Update');
        }
    } catch (e) {
        logError(`Setup after ${details && details.reason || 'install'} failed: ${errorText(e)}`, 'Update');
    }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    try {
        if (alarm.name === 'syncLists') updateRemoteLists();
        if (alarm.name === 'syncPhishFeeds') await syncPhishFeeds();
        if (alarm.name === 'pruneExpiredEntries') {
            const cfg = await getConfig();
            await pruneExpiredData(cfg.values.retentionDays);
        }
    } catch (e) {
        logError(`Scheduled task "${alarm.name}" failed: ${errorText(e)}`, 'Storage cleanup');
    }
});

// ---------------------------------------------------------------------------
// URL HELPERS
// ---------------------------------------------------------------------------
function cleanTrackingParams(urlString) {
    try {
        const url = new URL(urlString);
        const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'fbclid', 'gclid', 'mc_cid', 'mc_eid', '_bta_tid'];
        // Only rebuild the URL if something is actually removed: URLSearchParams re-encodes the whole
        // query on write, which would otherwise change links that had no tracking parameters at all.
        if (!paramsToRemove.some(param => url.searchParams.has(param))) return urlString;
        paramsToRemove.forEach(param => url.searchParams.delete(param));
        return url.toString();
    } catch (e) {
        return urlString;
    }
}

function fetchWithTimeout(url, options = {}, ms = 6000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// DNS THREAT INTELLIGENCE
// Only the destination HOSTNAME is ever sent to these resolvers (never the path or query).
// ---------------------------------------------------------------------------

// Non-filtering reference lookup. Used to learn the real IP and to tell "blocked by a
// filtering resolver" apart from "domain does not exist".
async function referenceLookup(hostname) {
    try {
        const res = await fetchWithTimeout(`https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`, { headers: { 'accept': 'application/dns-json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const ipRecord = (data.Answer || []).find(r => r.type === 1 && r.data !== '0.0.0.0');
        return { ok: true, status: data.Status, ip: ipRecord ? ipRecord.data : 'N/A' };
    } catch (e) {
        logWarning(`Cloudflare 1.1.1.1 reference lookup failed (${errorText(e)}). Destination IP addresses cannot be shown, and Quad9 blocks cannot be told apart from missing domains.`, 'DNS checks');
        return { ok: false, status: null, ip: 'N/A' };
    }
}

// RFC 1035 query for an A record: 12-byte header (ID 0x1234, recursion desired, one question),
// then the name as length-prefixed labels, type A, class IN.
function buildDnsWireQuery(hostname) {
    const packet = [0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    hostname.replace(/\.$/, '').split('.').filter(Boolean).forEach(part => {   // "example.com." is a valid hostname
        packet.push(part.length);
        for (let i = 0; i < part.length; i++) packet.push(part.charCodeAt(i));
    });
    packet.push(0x00, 0x00, 0x01, 0x00, 0x01); // Type A, Class IN
    const binary = String.fromCharCode(...packet);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function queryQuad9(hostname) {
    try {
        const wire = buildDnsWireQuery(hostname);
        const res = await fetchWithTimeout(`https://dns.quad9.net/dns-query?dns=${wire}`, { headers: { 'Accept': 'application/dns-message' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (buf.byteLength < 12) throw new Error('reply too short');
        return { ok: true, rcode: new DataView(buf).getUint8(3) & 0x0F };
    } catch (e) {
        logWarning(`Quad9 did not answer (${errorText(e)}).`, 'DNS checks');
        return { ok: false };
    }
}

// Resolver roles:
//  'primary' : security resolver (malware / phishing). Counts as threat coverage; a block flags the link.
//  'content' : Cloudflare Family adult-content filter. A block flags the link (on by default, users
//              can turn it off), but it is not a security check, so it never makes a link "verified".
//  'backup'  : AdGuard. Only queried when NO primary security resolver could answer, so it fills in
//              during outages instead of seeing every hostname. A block flags the link, except on
//              known email-tracker / shortener hosts, which AdGuard blocks by design.
// (Quad9 and the custom resolver are primary resolvers handled separately below.)

async function queryJsonProvider(provider, hostname) {
    try {
        const res = await fetchWithTimeout(provider.url(encodeURIComponent(hostname)), { headers: { 'Accept': 'application/dns-json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const blocked = (data.Answer || []).some(r => r.data === '0.0.0.0' || r.data === '127.0.0.1');
        return { ok: true, blocked, status: data.Status };
    } catch (e) {
        logWarning(`${provider.name} did not answer (${errorText(e)}).`, 'DNS checks');
        return { ok: false };
    }
}

// Settings => custom threat resolver configuration (see custom-endpoints.js).
function customThreatConf(S) {
    return { endpoint: S.customDohEndpoint, method: S.customDohMethod, body: S.customDohBody,
             headers: S.customDohHeaders, flagField: S.customDohFlagField };
}

function customThreatUsesFullUrl(conf) {
    return /\{url(_noscheme)?\}/.test(`${conf.endpoint || ''} ${conf.body || ''}`);
}

// Queries the custom threat resolver. Only {hostname} is sent unless the administrator's template
// asks for {url}; one-time links never send more than their origin.
// Returns { ok, blocked, reason }. ok = the reply was understood (an error reply is not an answer).
async function queryCustomResolver(conf, urlString, opts = {}) {
    try {
        const u = new URL(urlString);
        const safeUrl = opts.oneTime ? `${u.origin}/` : urlString;
        const req = buildCustomRequest(conf, {
            hostname: u.hostname.toLowerCase(), url: safeUrl, url_noscheme: safeUrl.replace(/^https?:\/\//i, '')
        }, true);
        if (!req) {
            logError(`The configured address (${logUrl(conf.endpoint)}) is not a valid https:// address.`, 'Custom threat resolver');
            return { ok: false };
        }
        const res = await fetchWithTimeout(req.url, req.init);
        if (!res.ok) {
            logWarning(`${logUrl(conf.endpoint)} answered HTTP ${res.status}${res.status === 401 || res.status === 403 ? ' (check the API key in the request headers)' : ''}.`, 'Custom threat resolver');
            return { ok: false, httpStatus: res.status };
        }
        let data;
        try { data = await res.json(); } catch (e) {
            logWarning(`${logUrl(conf.endpoint)} did not reply with JSON.`, 'Custom threat resolver');
            return { ok: false };
        }
        const r = parseThreatResponse(data, conf.flagField);
        if (!r.recognized) {
            logWarning(`The reply from ${logUrl(conf.endpoint)} was not understood (for example an error or an unknown format), so it was not counted as a check. Use the Test button in Settings → Your own services, or set "Flag field".`, 'Custom threat resolver');
            return { ok: false, unrecognized: true };
        }
        return { ok: true, blocked: !!r.blocked, reason: r.reason || 'Flagged by Custom Resolver' };
    } catch (e) {
        logWarning(`${logUrl(conf.endpoint)} could not be reached (${errorText(e)}). If it is a new address, click Save service in Settings → Your own services to grant access.`, 'Custom threat resolver');
        return { ok: false };
    }
}

// Session-level cache of definite verdicts ("safe" from the primary services, and "unsafe"), for
// SAFE_CACHE_MS. "Unknown" is never cached. Cleared whenever settings change; bounded in size.
const domainSafetyCache = new Map();
const DOMAIN_CACHE_MAX = 1000;
// Checks in progress, so parallel links to the same site share one round of DNS requests.
const domainSafetyInFlight = new Map();

function rememberVerdict(key, result) {
    if (domainSafetyCache.size >= DOMAIN_CACHE_MAX) domainSafetyCache.delete(domainSafetyCache.keys().next().value); // oldest first
    domainSafetyCache.set(key, { ts: Date.now(), result });
}

async function checkDomainSafety(urlString, customConf, settings, opts = {}) {
    let hostname;
    try { hostname = new URL(urlString).hostname.toLowerCase(); } catch (e) { return runDomainSafety(urlString, customConf, settings, opts); }
    if (!settings.enableDnsThreatCheck) return runDomainSafety(urlString, customConf, settings, opts);
    const fullUrlKey = customConf && customConf.endpoint && customThreatUsesFullUrl(customConf) && !opts.oneTime;
    const key = (fullUrlKey ? urlString : hostname) + (opts.oneTime ? '\u0000one-time' : '') + (opts.sender ? '\u0000sender' : '');

    const cached = domainSafetyCache.get(key);
    if (cached && Date.now() - cached.ts < SAFE_CACHE_MS) return cached.result;
    if (domainSafetyInFlight.has(key)) return domainSafetyInFlight.get(key);

    const pending = runDomainSafety(urlString, customConf, settings, opts)
        .then((result) => {
            // Only conclusive answers from the primary services are remembered (never the AdGuard backup alone).
            if (result.verdict === 'unsafe' || (result.verdict === 'safe' && result.scanner === 'Multi-DoH')) rememberVerdict(key, result);
            return result;
        })
        .finally(() => domainSafetyInFlight.delete(key));
    domainSafetyInFlight.set(key, pending);
    return pending;
}

function verdictResult(verdict, extra) {
    return Object.assign({ verdict, isSafe: verdict !== 'unsafe', reason: null, note: null, resolvedIp: 'N/A', scanner: 'Multi-DoH' }, extra);
}

// verdict: 'safe' (checked, nothing found) | 'unsafe' (a resolver flagged it) |
//          'unknown' (could not be checked — NEVER treated as proof of safety and never cached)
// Reads an RFC 1035 reply: rcode plus the IPv4/IPv6 addresses in the answer section.
function parseDnsReply(buf) {
    const v = new DataView(buf);
    const rcode = v.getUint8(3) & 0x0F, qd = v.getUint16(4), an = v.getUint16(6);
    let p = 12;
    const skipName = () => {
        while (p < buf.byteLength) {
            const len = v.getUint8(p);
            if (len === 0) { p++; return; }
            if ((len & 0xC0) === 0xC0) { p += 2; return; }
            p += len + 1;
        }
    };
    for (let i = 0; i < qd; i++) { skipName(); p += 4; }
    const addrs = [];
    for (let i = 0; i < an && p < buf.byteLength; i++) {
        skipName();
        const type = v.getUint16(p), rdlen = v.getUint16(p + 8);
        p += 10;
        if (type === 1 && rdlen === 4) addrs.push([0, 1, 2, 3].map(k => v.getUint8(p + k)).join('.'));
        if (type === 28 && rdlen === 16) addrs.push(Array.from({ length: 8 }, (_, k) => v.getUint16(p + 2 * k).toString(16)).join(':').replace(/(^|:)0(:0)+(:|$)/, '::'));
        p += rdlen;
    }
    return { rcode, addrs };
}

const SINKHOLE_RE = /^(0\.0\.0\.0|127\.|::$|::1$|0:0:0:0:0:0:0:0)/;

async function queryWireProvider(provider, hostname) {
    try {
        const res = await fetchWithTimeout(`${provider.url}?dns=${buildDnsWireQuery(hostname)}`, { headers: { 'Accept': 'application/dns-message' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (buf.byteLength < 12) throw new Error('reply too short');
        return Object.assign({ ok: true }, parseDnsReply(buf));
    } catch (e) {
        logWarning(`${provider.name} did not answer (${errorText(e)}).`, 'DNS checks');
        return { ok: false };
    }
}

async function runDomainSafety(urlString, customConf, settings, opts = {}) {
    let hostname;
    try { hostname = new URL(urlString).hostname.toLowerCase(); }
    catch (e) { return verdictResult('unknown', { note: 'Invalid URL', scanner: 'None' }); }

    if (!settings.enableDnsThreatCheck) {
        return verdictResult('unknown', { note: 'DNS threat checks are turned off', scanner: 'Disabled' });
    }

    // A resolver that receives full links answers per link, not per domain, so cache per link.
    const useCustom = !!(customConf && buildCustomRequest(customConf, { hostname, url: urlString, url_noscheme: urlString }, true));

    const firstRound = JSON_DNS_PROVIDERS.filter(p => p.role !== 'backup' && settings[p.id]);
    const backup = JSON_DNS_PROVIDERS.find(p => p.role === 'backup' && settings[p.id]);
    const useQuad9 = !!settings.dnsQuad9;

    const wireProviders = WIRE_DNS_PROVIDERS.filter(p => settings[p.id]);
    const [ref, custom, quad9, wireResults, ...jsonResults] = await Promise.all([
        referenceLookup(hostname),
        useCustom ? queryCustomResolver(customConf, urlString, opts) : Promise.resolve(null),
        useQuad9 ? queryQuad9(hostname) : Promise.resolve(null),
        Promise.all(wireProviders.map(p => queryWireProvider(p, hostname))),
        ...firstRound.map(p => queryJsonProvider(p, hostname))
    ]);

    const realIp = ref.ip;
    let securityAnswered = 0;
    const flags = []; // in priority order

    if (custom && custom.ok) {
        securityAnswered++;
        if (custom.blocked) flags.push({ reason: custom.reason, scanner: 'Custom Resolver' });
    }

    let nonexistent = false;
    if (quad9 && quad9.ok) {
        // Quad9 signals a block with NXDOMAIN, which is also what a non-existent domain returns, so an
        // NXDOMAIN only counts as an answer when the reference lookup tells the two cases apart.
        // Any other DNS error (SERVFAIL, REFUSED…) is not an answer at all.
        if (quad9.rcode === 0) {
            securityAnswered++;
        } else if (quad9.rcode === 3 && ref.ok && ref.status === 0) {
            securityAnswered++;
            flags.push({ reason: 'Malware or Phishing (Quad9)', scanner: 'Quad9' });
        } else if (quad9.rcode === 3 && ref.ok && ref.status === 3) {
            securityAnswered++;
            nonexistent = true;
        } else if (quad9.rcode !== 3) {
            logWarning(`Quad9 answered with DNS error code ${quad9.rcode}, so its answer was not counted.`, 'DNS checks');
        }
    }

    // Control D / DNS4EU: a sinkhole address, or NXDOMAIN for a name that really exists, is a block.
    wireProviders.forEach((p, i) => {
        const r = wireResults[i];
        if (!r || !r.ok) return;
        if (r.rcode === 0) {
            securityAnswered++;
            if (r.addrs.some(a => SINKHOLE_RE.test(a))) flags.push({ reason: p.reason, scanner: p.name });
        } else if (r.rcode === 3 && ref.ok) {
            securityAnswered++;
            if (ref.status === 0) flags.push({ reason: p.reason, scanner: p.name });
        }
    });

    firstRound.forEach((p, i) => {
        const r = jsonResults[i];
        if (!r || !r.ok) return;
        if (p.role === 'primary') securityAnswered++;
        if (r.blocked) flags.push({ reason: p.reason, scanner: p.name });
        // Cloudflare's filters block with 0.0.0.0, so their NXDOMAIN means the name really doesn't
        // exist; it stands in for the reference lookup when that one couldn't be made.
        if (p.role === 'primary' && r.status === 3 && !ref.ok) nonexistent = true;
    });

    // BACKUP: only when no primary security resolver answered.
    let backupNote = null;
    let scanner = 'Multi-DoH';
    if (securityAnswered === 0 && backup) {
        logWarning('No primary security resolver (Quad9, Cloudflare Security or custom) could be reached, so the AdGuard backup resolver was used.', 'DNS checks');
        const r = await queryJsonProvider(backup, hostname);
        if (r && r.ok) {
            const isKnownTracker = hostInSet(hostname, BUILTIN_TRACKER_SET);
            if (r.blocked && isKnownTracker) {
                backupNote = 'Only the backup resolver (AdGuard) answered, and it blocks email-tracking and shortener domains like this one by design';
            } else {
                securityAnswered++;
                scanner = backup.name;
                if (r.blocked) flags.push({ reason: backup.reason, scanner: backup.name });
            }
        }
    }

    if (flags.length > 0) {
        return verdictResult('unsafe', { reason: flags[0].reason, scanner: flags[0].scanner, resolvedIp: realIp });
    }
    // A link that can't work is not "Safe": the domain doesn't exist, or exists without any address
    // (IPv4 or IPv6), so nobody can reach it.
    if (nonexistent || (ref.ok && ref.status === 3)) {
        return verdictResult('unknown', { note: 'The domain doesn\'t exist, so this link can\'t work', resolvedIp: realIp });
    }
    // A sender's domain only needs to exist: many send mail without having a website.
    if (!opts.sender && ref.ok && ref.status === 0 && realIp === 'N/A') {
        let hasIpv6 = true;
        try { hasIpv6 = (await dnsHasAddress(hostname)) === 'ok'; } catch (e) { /* unknown: leave as is */ }
        if (!hasIpv6) return verdictResult('unknown', { note: 'The domain has no website address, so this link can\'t work', resolvedIp: realIp });
    }
    if (securityAnswered === 0) {
        if (!backupNote) logWarning('No threat-check resolver could be reached, so links are being shown as "not verified". Check the network or firewall, or Settings → Your own services.', 'DNS checks');
        return verdictResult('unknown', { note: backupNote || 'No threat-intelligence resolver could be reached', resolvedIp: realIp });
    }

    // Caching is done by checkDomainSafety (results from the backup alone are not cached).
    return verdictResult('safe', { resolvedIp: realIp, scanner });
}

// Blocklist: a link whose own host OR destination is on the user's or the organization's blocklist
// is flagged, with no network request needed. The blocklist wins over the allowlist.
function blocklistHit(urls, cfg) {
    const { managedBlock: managedSet, block: allSet } = cfgSets(cfg);
    for (const u of urls) {
        const h = hostOf(u);
        if (!h) continue;
        if (hostInSet(h, managedSet)) return `Blocked by organization policy (${h})`;
        if (hostInSet(h, allSet)) return `On your blocklist (${h})`;
    }
    return null;
}

// Assesses every host the click can actually reach:
//  - the destination (finalUrl), which is where a rewritten link goes, and
//  - the link's own host (originalUrl), which is where the click goes whenever the href is NOT
//    rewritten (visual overrides off, or a wrapper that only claims to point elsewhere).
// The worst result wins.
async function assessSafety(originalUrl, finalUrl, cfg, opts = {}) {
    const S = cfg.values;
    const blocked = blocklistHit([originalUrl, finalUrl], cfg);
    if (blocked) return verdictResult('unsafe', { reason: blocked, scanner: 'Blocklist', source: 'blocklist' });

    if (S.enablePhishingFeeds) {
        const listed = (await feedHit(finalUrl)) || (finalUrl !== originalUrl ? await feedHit(originalUrl) : null);
        if (listed) return verdictResult('unsafe', { reason: `Listed as phishing by ${listed}`, scanner: listed, source: 'feed' });
    }

    const origHost = hostOf(originalUrl);
    const destHost = hostOf(finalUrl);
    const checkOuter = origHost && destHost && origHost !== destHost;

    const [dest, outer] = await Promise.all([
        checkDomainSafety(finalUrl, customThreatConf(S), S, opts),
        checkOuter ? checkDomainSafety(originalUrl, customThreatConf(S), S, opts) : Promise.resolve(null)
    ]);

    let result = dest;
    // Both hosts the click can reach must check out before a link counts as safe.
    if (dest.verdict === 'safe' && outer && outer.verdict !== 'safe' && outer.verdict !== 'unsafe') {
        result = verdictResult('unknown', { note: `the link itself goes through ${origHost}, which couldn't be checked${outer.note ? ` (${String(outer.note).replace(/\.$/, '')})` : ''}`, resolvedIp: dest.resolvedIp });
    }
    if (dest.verdict !== 'unsafe' && outer && outer.verdict === 'unsafe') {
        result = verdictResult('unsafe', {
            reason: `The link itself goes through ${origHost}, which is flagged: ${outer.reason}`,
            scanner: outer.scanner,
            resolvedIp: outer.resolvedIp
        });
    }
    return result;
}

// ---------------------------------------------------------------------------
// MULTI-LAYER OFFLINE DECODERS (no network requests)
// ---------------------------------------------------------------------------

// Offline decoders live in decoders.js (parseUrl, hostOf, unwrapNestedUrl, decoderContext, ...).

// ---------------------------------------------------------------------------
// NETWORK RESOLUTION RULES (shared by the Gmail pipeline and the Link Inspector)
// ---------------------------------------------------------------------------
// Shape of a typical short link: no query, fragment or credentials, at most two short path segments.
// Required for domains that are ONLY on a synced community list, so a bad list entry cannot cause
// long, token-bearing URLs to be sent to a third party.
function hasShortLinkPath(urlString) {
    const u = parseUrl(urlString);
    if (!u || u.search || u.hash || u.username || u.password) return false;
    const segments = u.pathname.split('/').filter(Boolean);
    return segments.length >= 1 && segments.length <= 2 && segments.every(seg => seg.length <= 32);
}

// opts.reveal: the user explicitly asked to reveal a blocklisted link (see resolveLink).
// Blocklisted links are never sent anywhere otherwise.
function networkEligibility(shortUrl, hostname, cfg, opts = {}) {
    if (!cfg.values.enableThirdPartyResolution) return { eligible: false, reason: 'third-party resolution is turned off' };
    const builtinSet = PUBLIC_SHORTENER_SET;
    const remoteSet = cfgSets(cfg).remote;
    if (hostInSet(hostname, ESP_TRACKER_SET) || emailTrackerProvider(shortUrl)) {
        if (opts.reveal && cfg.values.enableTrackerReveal) return { eligible: true, reason: 'you chose to reveal this email tracking link' };
        return { eligible: false, reason: 'email tracking links are only looked up if you choose to reveal them' };
    }
    const blocked = hostInSet(hostname, cfgSets(cfg).block);
    if (blocked && !opts.reveal) return { eligible: false, reason: 'blocklisted links are never sent to unshorten.me unless you choose to reveal them' };
    if (blocked && opts.reveal) return { eligible: true, reason: 'you chose to reveal this blocklisted link' };
    if (hostInSet(hostname, builtinSet)) return { eligible: true, reason: 'known public shortener' };
    if (hostInSet(hostname, remoteSet)) {
        if (hasShortLinkPath(shortUrl)) return { eligible: true, reason: 'listed in a synced shortener list' };
        return { eligible: false, reason: 'listed in a synced shortener list, but this URL is not shaped like a short link, so it was not sent' };
    }
    if (looksLikeShortLink(shortUrl)) return { eligible: true, reason: 'unrecognized domain, but the link has the shape of a short link' };
    return { eligible: false, reason: 'not a known shortener and not shaped like a short link, so no request was made' };
}

// Settings => custom unshortener configuration (see custom-endpoints.js).
function customUnshortenerConf(S) {
    return { endpoint: S.customUnshortenerEndpoint, method: S.customUnshortenerMethod, body: S.customUnshortenerBody,
             headers: S.customUnshortenerHeaders, field: S.customUnshortenerField };
}

function hasCustomUnshortener(S) {
    return /^https:\/\//i.test(S.customUnshortenerEndpoint || '');
}

// The services a short link would be sent to, in order (custom first, unshorten.me as fallback).
function lookupChain(S) {
    const chain = [];
    if (hasCustomUnshortener(S)) chain.push({ id: 'custom', label: `your custom unshortener (${hostOf(S.customUnshortenerEndpoint)})` });
    if (!hasCustomUnshortener(S) || S.useUnshortenMeFallback) chain.push({ id: 'unshortenme', label: 'unshorten.me' });
    return chain;
}

async function queryCustomUnshortener(conf, shortUrl) {
    try {
        const req = buildCustomRequest(conf, {
            url: shortUrl, url_noscheme: shortUrl.replace(/^https?:\/\//i, ''), hostname: hostOf(shortUrl)
        });
        if (!req) return { ok: false, error: 'not a valid https:// address' };
        const res = await fetchWithTimeout(req.url, req.init, 10000);
        const text = await res.text();
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, body: text.slice(0, 300) };
        const dest = parseUnshortenResponse(text, conf.field, shortUrl);
        return dest ? { ok: true, url: dest } : { ok: false, error: 'no destination found in the reply', body: text.slice(0, 300) };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// unshorten.me stores addresses in a 100-character field and rejects longer ones ("value too long for
// type character varying(100)"); such links are not sent at all.
const UNSHORTEN_ME_MAX_URL = 100;

// Returns the destination, or { failed, permanent, why } explaining why there is none.
async function queryUnshortenMe(shortUrl) {
    if (shortUrl.length > UNSHORTEN_ME_MAX_URL) {
        return { failed: true, permanent: true, why: `too long for unshorten.me, which accepts up to ${UNSHORTEN_ME_MAX_URL} characters` };
    }
    try {
        const res = await fetchWithTimeout(`https://unshorten.me/json/${encodeURIComponent(shortUrl)}`, {}, 10000);
        if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 429 ? ' (rate limit reached)' : ''}`);
        const data = await res.json();
        if (data.success && typeof data.resolved_url === 'string' && /^https?:\/\//i.test(data.resolved_url)) return data.resolved_url;
        logInfo(`unshorten.me could not expand a link on ${logUrl(shortUrl)}${data.error ? ` (${String(data.error).slice(0, 120)})` : ''}.`, 'unshorten.me');
        return { failed: true, permanent: true, why: 'unshorten.me could not expand it' };
    } catch (e) {
        logWarning(`unshorten.me could not be reached (${errorText(e)}).`, 'unshorten.me');
        return { failed: true, permanent: false, why: 'unshorten.me could not be reached' };
    }
}

// Failed lookups are remembered so the same link isn't looked up (and logged) again every time an
// email is re-scanned: temporary failures (network, rate limit) for 30 minutes, permanent ones
// (too long, the service can't expand it) for a day. Memory only, bounded.
const FAILED_LOOKUP_TTL = { temporary: 30 * 60 * 1000, permanent: 24 * 60 * 60 * 1000 };
const FAILED_LOOKUP_MAX = 500;
const failedLookups = new Map();     // short URL → { until, why }

function rememberFailedLookup(shortUrl, why, permanent) {
    if (failedLookups.size >= FAILED_LOOKUP_MAX) failedLookups.delete(failedLookups.keys().next().value);
    failedLookups.set(shortUrl, { until: Date.now() + (permanent ? FAILED_LOOKUP_TTL.permanent : FAILED_LOOKUP_TTL.temporary), why });
}

// Tries each service in lookupChain() until one returns a destination.
// Returns { url, via }, or { url: null, why } when no service could tell.
async function lookupShortLink(shortUrl, cfg) {
    const known = failedLookups.get(shortUrl);
    if (known && known.until > Date.now()) return { url: null, why: known.why };     // already tried; not logged again
    let why = 'no lookup service could tell', permanent = true;
    for (const step of lookupChain(cfg.values)) {
        if (step.id === 'custom') {
            const conf = customUnshortenerConf(cfg.values);
            const r = await queryCustomUnshortener(conf, shortUrl);
            if (r.ok) return { url: r.url, via: step.label };
            const hint = /HTTP 40[13]/.test(r.error || '') ? ' (check the token in the request headers)'
                       : /fetch/i.test(r.error || '') ? ' (if it is a new address, click Save service in Settings → Your own services to grant access)' : '';
            logWarning(`${logUrl(conf.endpoint)}: ${r.error}${hint}.`, 'Custom unshortener');
            why = 'your organization\'s lookup service could not expand it'; permanent = false;
        } else {
            const r = await queryUnshortenMe(shortUrl);
            if (typeof r === 'string') return { url: r, via: step.label };
            why = r.why; permanent = permanent && r.permanent;
        }
    }
    rememberFailedLookup(shortUrl, why, permanent);
    logWarning(`Could not find where a short link on ${logUrl(shortUrl)} goes (${why}); it is marked "Caution: destination unknown". Tip: your organization's own lookup service has no such limits (Help → Limitations).`, 'Link analysis');
    return { url: null, why };
}

// ---------------------------------------------------------------------------
// PHISHING LISTS (OpenPhish community feed, Phishing Army)
// Downloaded on a schedule (a plain download; nothing about the user is sent) and matched in memory.
// Same safeguards as the shortener lists: size limits, a minimum size, and the previous copy is kept
// whenever a download fails or looks broken. Major sites are never blocked by these lists.
// ---------------------------------------------------------------------------
let feedSets = null;            // Promise of { url, domain, address } lookups, loaded once and shared; reset when a list changes

function sanitizeFeed(feed, text) {
    const out = new Set();
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith('!')) continue;
        if (feed.kind === 'url') {
            const n = normalizeFeedUrl(line);
            if (!n) continue;
            const h = hostOf(n);
            if (!h || PROTECTED_DOMAINS.has(registrableDomain(h))) continue;
            out.add(n);
        } else if (feed.kind === 'domain') {
            const d = line.split(/\s+/).pop().toLowerCase().replace(/^\*\./, '');
            if (!DOMAIN_RE.test(d) || PROTECTED_DOMAINS.has(registrableDomain(d)) || cloudStoragePage(`https://${d}/x.html`)) continue;
            out.add(d);
        } else if (feed.kind === 'address') {
            // Full addresses only (never a whole domain), and never a company's own address on a major
            // brand's domain: a wrong entry there would send that company's genuine mail to Spam.
            const a = normalizeSenderEntry(line.split(/[\s,;]+/)[0]);
            const d = a.slice(a.lastIndexOf('@') + 1);
            if (!a.includes('@') || (PROTECTED_DOMAINS.has(registrableDomain(d)) && !isPersonalMailDomain(d))) continue;
            out.add(a);
        }
        if (out.size >= PHISH_FEED_MAX_ENTRIES) break;
    }
    return out;
}

async function syncPhishFeeds(force = false) {
    const cfg = await getConfig();
    if (!cfg.values.enablePhishingFeeds) return { skipped: true };
    const stored = await storageGet('local', PHISH_FEEDS.map(f => `feed_${f.id}`));
    let changed = false, failures = 0;
    for (const feed of PHISH_FEEDS) {
        if (feed.requires && !cfg.values[feed.requires]) continue;
        const prev = stored[`feed_${feed.id}`];
        // At most once a day. (`force` exists only for the automated tests.)
        if (!force && prev && Date.now() - prev.updated < THIRD_PARTY_LIST_MIN_INTERVAL_MS) continue;
        try {
            const res = await fetchWithTimeout(feed.url, {}, 30000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            if (text.length > PHISH_FEED_MAX_BYTES) throw new Error(`list too large (${text.length} bytes)`);
            const entries = sanitizeFeed(feed, text);
            if (entries.size < PHISH_FEED_MIN_ENTRIES) throw new Error(`only ${entries.size} entries; keeping the previous copy`);
            // Stored sorted, so it loads as a compact list without sorting (see compactSet).
            await chrome.storage.local.set({ [`feed_${feed.id}`]: { updated: Date.now(), count: entries.size, entries: [...entries].sort().join('\n') } });
            changed = true;
            logInfo(`${feed.name}: updated (${entries.size.toLocaleString()} entries).`, 'Phishing lists');
        } catch (e) {
            failures++;
            logWarning(`${feed.name} could not be updated (${errorText(e)}); the previous copy is kept.`, 'Phishing lists');
        }
    }
    if (changed) feedSets = null;
    return { skipped: false, failures };
}

function loadFeedSets() {
    if (!feedSets) feedSets = readFeedSets().catch((e) => { feedSets = null; throw e; });
    return feedSets;                                     // parallel links share one read
}

// One lookup per kind of entry over that kind's lists: has(entry), get(entry) → the list's name.
function feedLookup(parts) {
    const find = (k) => parts.find(p => p.list.has(k));
    return { size: parts.reduce((n, p) => n + p.list.size, 0), has: (k) => !!find(k), get: (k) => { const p = find(k); return p ? p.name : undefined; } };
}
async function readFeedSets() {
    const stored = await storageGet('local', PHISH_FEEDS.map(f => `feed_${f.id}`));
    const parts = { url: [], domain: [], address: [] };
    for (const feed of PHISH_FEEDS) {
        const rec = stored[`feed_${feed.id}`];
        if (rec && rec.entries) parts[feed.kind].push({ name: feed.name, list: compactSet(rec.entries) });
    }
    return { url: feedLookup(parts.url), domain: feedLookup(parts.domain), address: feedLookup(parts.address) };
}

// Name of the list that has this URL (or its host) as phishing, else null.
async function feedHit(urlString) {
    const sets = await loadFeedSets();
    if (!sets.url.size && !sets.domain.size) return null;
    const n = normalizeFeedUrl(urlString);
    if (n && sets.url.has(n)) return sets.url.get(n);
    const host = hostOf(urlString);
    if (!host) return null;
    // A whole-site entry (just the domain, no path) counts for the host — never on shared hosting.
    if (!cloudStoragePage(urlString)) {
        for (const scheme of ['https://', 'http://']) if (sets.url.has(scheme + host)) return sets.url.get(scheme + host);
    }
    const parts = host.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
        const cand = parts.slice(i).join('.');
        if (sets.domain.has(cand)) return sets.domain.get(cand);
    }
    return null;
}

// ---------------------------------------------------------------------------
// SENDER CHECKS AND SENDER IDENTITY (Gmail inbox and opened emails)
// For each sender address: the community scam-sender list,
// the trusted senders list, the phishing lists for its domain, the DNS threat services for its domain
// (site name only), whether the address itself is malformed, its site icon (Google's icon service) and
// a country. The country of the server that delivered a particular email comes from Gmail's own
// delivery header and is looked up at country.is (senderCountry). Everything is remembered across
// restarts of the background, so an inbox doesn't trigger new lookups every time it's opened:
//   senderResultCache   address → the last verdict        (SAFE_CACHE_MS; shown in Logging → Senders)
//   senderDomainCache   domain → DNS threat verdict        (SAFE_CACHE_MS)
//   geoCache            IP address → country               (30 days)
//   icons               site → icon bytes, or none          (30 days; IndexedDB, see icon-store.js)
// ---------------------------------------------------------------------------
const GEO_CACHE_MS = 30 * 24 * 60 * 60 * 1000;

// A Map kept in chrome.storage.local under one key: read once, written at most every few seconds,
// entries older than ttl dropped, the oldest dropped first beyond max.
function persistentMap(key, max, ttl) {
    let map = null, timer = null;
    const load = () => {
        if (!map) map = storageGet('local', { [key]: {} }).then(r => new Map(Object.entries((r && r[key] && typeof r[key] === 'object') ? r[key] : {})));
        return map;
    };
    const save = () => {
        if (timer) return;
        timer = setTimeout(async () => {
            timer = null;
            const m = await load();
            const now = Date.now();
            for (const [k, v] of m) if (!v || !(now - v.ts < ttl)) m.delete(k);
            while (m.size > max) m.delete(m.keys().next().value);
            try { await chrome.storage.local.set({ [key]: Object.fromEntries(m) }); }
            catch (e) { logWarning(`Saving ${key} failed (${errorText(e)}).`, 'Sender checks'); }
        }, 3000);
    };
    return {
        async get(k) { const v = (await load()).get(k); return v && Date.now() - v.ts < ttl ? v : null; },
        async set(k, v) { const m = await load(); m.delete(k); m.set(k, Object.assign({ ts: Date.now() }, v)); save(); },
        forget() { map = null; },
        clear() { map = Promise.resolve(new Map()); chrome.storage.local.remove(key, () => void chrome.runtime.lastError); }
    };
}
const senderResultCache = persistentMap('senderResultCache', 3000, SAFE_CACHE_MS);
const senderDomainCache = persistentMap('senderDomainCache', 2000, SAFE_CACHE_MS);
const geoCache = persistentMap('geoCache', 3000, GEO_CACHE_MS);
// Icons saved by versions before 5.47 (data: URLs in storage.local "faviconCache") move to the icon
// store once, then the old copy is removed.
let legacyIconsMoved = null;
function moveLegacyIcons() {
    if (!legacyIconsMoved) legacyIconsMoved = (async () => {
        const old = (await storageGet('local', { faviconCache: null })).faviconCache;
        if (!old || typeof old !== 'object') return;
        let moved = 0;
        for (const [site, v] of Object.entries(old)) {
            if (!v || !(Date.now() - v.ts < ICON_STORE_TTL_MS)) continue;
            const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(v.d || '');
            const bytes = m ? Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)).buffer : null;
            await iconStore.put(site, m ? m[1] : '', bytes);
            moved++;
        }
        await chrome.storage.local.remove('faviconCache');
        logInfo(`Sender icons moved to the icon store (${moved} sites); they now take about a quarter less space.`, 'Sender checks');
    })().catch((e) => { legacyIconsMoved = null; logWarning(`Moving saved sender icons failed (${errorText(e)}); they are fetched again when needed.`, 'Sender checks'); });
    return legacyIconsMoved;
}
const geoInFlight = new Map();
const iconInFlight = new Map();

// A settings change (a resolver switched off, a list changed…) must not reuse old verdicts.
function clearSenderDomainCache() {
    senderDomainCache.clear();
    senderResultCache.clear();
}

// Public addresses only: private, loopback and link-local ones say nothing about a country.
function isPublicIp(ip) {
    const v = String(ip || '').toLowerCase();
    if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|22[4-9]\.|2[3-5]\d\.)/.test(v)) return false;
    if (v.includes(':')) return !/^(::1?$|f[cd]|fe[89ab]|::ffff:(10|127|192\.168)\.)/.test(v);
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(v);
}

// Country of an IP address ('US'), or null. Only the address is sent (to country.is), never anything
// about the email or the user; each address is looked up at most once a month.
async function countryOfIp(ip) {
    if (!isPublicIp(ip)) return null;
    const hit = await geoCache.get(ip);
    if (hit) return hit.c || null;
    if (geoInFlight.has(ip)) return geoInFlight.get(ip);
    const p = (async () => {
        try {
            const res = await fetchWithTimeout(`https://api.country.is/${encodeURIComponent(ip)}`, { credentials: 'omit', referrerPolicy: 'no-referrer' }, 5000);
            if (res.status === 404 || res.status === 422) { geoCache.set(ip, { c: '' }); return null; }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const c = data && isCountryCode(String(data.country || '').toUpperCase()) ? String(data.country).toUpperCase() : '';
            geoCache.set(ip, { c });
            logInfo(`Country lookup: the server ${ip} is in ${c ? `${countryName(c)} (${c})` : 'an unknown country'} (country.is; remembered for 30 days).`, 'Sender checks');
            return c || null;
        } catch (e) {
            logWarning(`The country of the sending server ${ip} could not be looked up (${errorText(e)}); the domain's ending is used instead where it names a country.`, 'Sender checks');
            return null;
        } finally {
            geoInFlight.delete(ip);
        }
    })();
    geoInFlight.set(ip, p);
    return p;
}

// The site icon for a sender's site, as a data: URL, or '' when the site has none. Google's icon
// service answers 404 (with a generic globe) for sites without an icon: those get no icon at all.
const SENDER_ICON_MAX_BYTES = 8 * 1024;
const SENDER_ICON_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;   // a site without its own icon is asked about again weekly
const ICON_SOURCE_RANK = { favicon: 3, parent: 2, duckduckgo: 1, none: 0 };
const ICON_SOURCE_TEXT = { favicon: "the site's own icon", parent: "its parent domain's icon", duckduckgo: "an icon from DuckDuckGo's icon service", none: 'none (left blank)' };

// An icon answer as { found: { type, bytes } | null, status } — found null with status 'none' when the
// service says there is no icon; throws on anything else (an outage, a filter's block page), which
// is never remembered.
async function fetchIconFrom(url, noneStatuses) {
    const res = await fetchWithTimeout(url, { credentials: 'omit', referrerPolicy: 'no-referrer' }, 6000);
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (noneStatuses.includes(res.status)) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (!buf.byteLength) return null;                                 // DuckDuckGo: an empty answer means no icon
    if (!/^image\//.test(type)) throw new Error(`not an image (${type || 'no type'})`);
    return { type, bytes: buf };
}

// Icons are kept exactly as sent when they're a small PNG, GIF, JPEG or WebP (Google's are: re-encoding
// them only made them larger). Anything else (a Windows .ico holding several sizes, which DuckDuckGo
// often sends, up to 32 KB; or an oversized image) is redrawn once as one 32-pixel PNG (about 1.5 KB).
// null if it can't be (no image tools here, or an unreadable image): the space is left blank.
async function normalizeIcon(icon) {
    if (/^image\/(png|gif|jpeg|webp)$/.test(icon.type) && icon.bytes.byteLength <= SENDER_ICON_MAX_BYTES) return icon;
    if (/svg/.test(icon.type) || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
    try {
        const bmp = await createImageBitmap(new Blob([icon.bytes], { type: icon.type }), { resizeWidth: 32, resizeHeight: 32, resizeQuality: 'high' });
        const canvas = new OffscreenCanvas(32, 32);
        canvas.getContext('2d').drawImage(bmp, 0, 0, 32, 32);
        const png = await canvas.convertToBlob({ type: 'image/png' });
        if (png.size > SENDER_ICON_MAX_BYTES) return null;
        return { type: 'image/png', bytes: await png.arrayBuffer() };
    } catch (e) { return null; }
}

// The icon for a site, in this order: the site's own (Google's icon service); its parent domain's
// (alerts.brand.com → brand.com); DuckDuckGo's icon service (opts.fallback). Where it came from is
// stored with it (Logging → Senders). A site without its own icon is asked about again weekly, and
// its own icon replaces the stand-in as soon as it has one; a recheck never replaces an icon with a
// worse one. Resolves to a data: URL, or '' for none.
async function senderIcon(site, opts = {}) {
    const s = normalizeDomain(site);
    if (!SENDER_DOMAIN_RE.test(s)) return '';
    const fallback = opts.fallback !== false;
    await moveLegacyIcons();
    const hit = await iconStore.get(s).catch(() => null);
    const recheck = hit && hit.source !== 'favicon' && Date.now() - hit.ts > SENDER_ICON_RECHECK_MS
        // A stand-in from DuckDuckGo is never shown once that service is switched off.
        || hit && hit.source === 'duckduckgo' && !fallback;
    if (hit && !recheck) return iconDataUrl(hit);
    const key = s + (fallback ? '' : '\u0000own');
    if (iconInFlight.has(key)) return iconInFlight.get(key);
    const p = (async () => {
        try {
            const google = (d) => fetchIconFrom(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=32`, [404]);
            let found = null, source = 'none', from = '';
            const own = await google(s);
            if (own) { found = own; source = 'favicon'; }
            const parent = registrableDomain(s);
            if (!found && fallback && parent && parent !== s) {
                const p2 = await google(parent);
                if (p2) { found = p2; source = 'parent'; from = parent; }
            }
            let ddgFailed = '';
            if (!found && fallback) {
                // Google's answer is definite by now, so a DuckDuckGo failure (an outage, or a web filter
                // that blocks it) doesn't stop the result being remembered: asked again in a week.
                try {
                    const ddg = await fetchIconFrom(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(s)}.ico`, [404]);
                    if (ddg) { found = ddg; source = 'duckduckgo'; }
                } catch (e) { ddgFailed = errorText(e); }
            }
            if (found) found = await normalizeIcon(found);
            if (!found) source = 'none';
            // A recheck never makes things worse (a stand-in icon isn't replaced by "none"); it only
            // refreshes the date then.
            if (hit && !(hit.source === 'duckduckgo' && !fallback) && ICON_SOURCE_RANK[source] < ICON_SOURCE_RANK[hit.source]) {
                await iconStore.put(s, hit.type, hit.bytes, hit.source, hit.from).catch(() => {});
                return iconDataUrl(hit);
            }
            await iconStore.put(s, found ? found.type : '', found ? found.bytes : null, source, from)
                .catch(e => logWarning(`Saving the icon for ${s} failed (${errorText(e)}); it is fetched again next time.`, 'Sender checks'));
            const upgraded = hit && hit.source !== source && source === 'favicon';
            logInfo(`Sender icon for ${s}: ${ICON_SOURCE_TEXT[source]}${from ? ` (${from})` : ''}${upgraded ? `, replacing ${ICON_SOURCE_TEXT[hit.source]}` : ''}; ` +
                    `${source === 'favicon' ? 'remembered for 30 days' : 'asked about again in a week'}${ddgFailed ? ` (DuckDuckGo's icon service couldn't be reached: ${ddgFailed})` : ''}.`, 'Sender checks');
            return iconDataUrl(found ? { type: found.type, bytes: found.bytes } : null);
        } catch (e) {
            // An outage or a block page: nothing is remembered; a stand-in already stored stays shown.
            logWarning(`The icon for ${s} could not be fetched (${errorText(e)}); ${hit && hit.bytes ? 'the stored one is kept' : 'left blank for now'} and asked again later.`, 'Sender checks');
            return hit ? iconDataUrl(hit) : '';
        } finally {
            iconInFlight.delete(key);
        }
    })();
    iconInFlight.set(key, p);
    return p;
}

// DNS threat verdict for a sender's domain (definite answers cached across restarts).
async function senderDomainDns(domain, S) {
    const hit = await senderDomainCache.get(domain);
    if (hit) return hit.dns;
    const r = await checkDomainSafety(`https://${domain}/`, customThreatConf(S), S, { sender: true });
    const dns = { verdict: r.verdict, reason: r.reason || null, scanner: r.scanner || '', note: r.note || null, ip: r.resolvedIp && r.resolvedIp !== 'N/A' ? r.resolvedIp : null };
    if (r.verdict === 'unsafe' || /doesn't exist/.test(r.note || '') || (r.verdict === 'safe' && r.scanner === 'Multi-DoH')) senderDomainCache.set(domain, { dns });
    return dns;
}

// SENDER PHOTOS AND COMPANY LOGOS. The picture the webmail itself shows beside a sender in an opened
// email (content.js decides which may be used) is kept in the icon store:
//   - a colleague's photo (own organization) under "@<address>";
//   - another company's logo under "logo:<site>", shown for every address at that site.
// Pictures from the webmail's own image host are fetched once; embedded ones (data:) are stored as
// they are. When the webmail later shows a different one, the new one replaces it (a changed photo or
// logo); the same one is only looked at again after a week. Shown before the site icon.
const AVATAR_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
const avatarInFlight = new Map();
const avatarKey = (target) => target.domain ? 'logo:' + target.domain : '@' + target.address;
const avatarWhat = (target) => target.domain ? `Company logo for ${target.domain} (from ${target.address})` : `Sender photo for ${target.address}`;
async function rememberAvatar(target, url) {
    const key = avatarKey(target);
    const hit = await iconStore.get(key).catch(() => null);
    if (hit && hit.from === url && hit.bytes && Date.now() - hit.ts < AVATAR_RECHECK_MS) return 'same';
    if (avatarInFlight.has(key)) return avatarInFlight.get(key);
    const p = (async () => {
        try {
            const icon = await fetchIconFrom(url, []);
            const found = icon && await normalizeIcon(icon);
            if (!found) return 'unusable';
            await iconStore.put(key, found.type, found.bytes, target.domain ? 'avatar-logo' : 'avatar-personal', url);
            logInfo(`${avatarWhat(target)}: ${hit && hit.bytes ? (hit.from === url ? 'checked again, unchanged' : 'changed, replaced') : 'remembered'}.`, 'Sender checks');
            return hit && hit.bytes && hit.from !== url ? 'updated' : 'saved';
        } catch (e) {
            logWarning(`The ${target.domain ? `logo for ${target.domain} (from ${target.address})` : `photo for ${target.address}`} could not be fetched (${errorText(e)}); the site icon is shown instead.`, 'Sender checks');
            return 'failed';
        } finally {
            avatarInFlight.delete(key);
        }
    })();
    avatarInFlight.set(key, p);
    return p;
}
// Only from an image host a webmail entry names for people's photos (Gmail: googleusercontent.com).
function avatarHostAllowed(url) {
    return WEBMAIL_SITES.some(w => w.mail && w.mail.message && w.mail.message.avatar && w.mail.message.avatar.photoHost && w.mail.message.avatar.photoHost.test(url));
}
// A logo the webmail embedded in the page (data: image): stored directly, nothing is downloaded. Its
// change is detected by a short fingerprint of the image (FNV-1a), kept with it. SVG logos (BIMI's
// format) are kept as they are, at most 32 KB: shown only as an image, where SVG can't run code.
const EMBEDDED_LOGO_MAX_BYTES = 32 * 1024;
function fingerprint(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0') + ':' + bytes.length;
}
async function rememberEmbeddedLogo(target, dataUrl) {
    const m = /^data:(image\/(?:png|gif|jpeg|webp|svg\+xml))(;base64)?,(.*)$/is.exec(dataUrl);
    if (!m) return 'refused';
    let bytes;
    try { bytes = m[2] ? Uint8Array.from(atob(m[3]), c => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3])); }
    catch (e) { return 'unusable'; }
    const type = m[1].toLowerCase();
    if (!bytes.length || bytes.length > EMBEDDED_LOGO_MAX_BYTES) return 'unusable';
    const key = avatarKey(target), print = 'embedded:' + fingerprint(bytes);
    const hit = await iconStore.get(key).catch(() => null);
    if (hit && hit.from === print && hit.bytes) return 'same';
    let found = { type, bytes: bytes.buffer };
    if (type !== 'image/svg+xml') found = await normalizeIcon(found);
    if (!found) return 'unusable';
    await iconStore.put(key, found.type, found.bytes, target.domain ? 'avatar-logo' : 'avatar-personal', print);
    logInfo(`${avatarWhat(target)}: ${hit && hit.bytes ? 'changed, replaced' : 'remembered'} (embedded by the webmail; nothing downloaded).`, 'Sender checks');
    return hit && hit.bytes ? 'updated' : 'saved';
}
// The picture for a sender: a colleague's own photo, else (another company) its logo, else ''.
async function avatarFor(address, site) {
    const keys = [address && '@' + address];
    const company = registrableDomain(site || '') || site;
    if (company && !isPersonalMailDomain(company)) keys.push('logo:' + company);
    for (const key of keys.filter(Boolean)) {
        const rec = await iconStore.get(key).catch(() => null);
        if (rec && rec.bytes) return iconDataUrl(rec);
    }
    return '';
}

// BIMI LOGOS (Brand Indicators for Message Identification): a company publishes its logo in DNS
// ("default._bimi.<domain>" TXT "v=BIMI1; l=https://…/logo.svg"), so it can be shown for every email
// from that domain without opening one. Used only when the domain also enforces DMARC (p=quarantine
// or p=reject, as BIMI itself requires), so a domain that doesn't stop others sending in its name
// never gets a logo. Only the organization domain (example.com, not x.example.com) is looked up: a
// sender can't make a lookup or a logo address per recipient out of throwaway subdomains (which
// would work like a read receipt for an email nobody opened).
// The logo is an SVG (BIMI's "Tiny PS" format), only ever shown as an image, where SVG can't run code.
// Downloaded once per domain by the background (no cookies or referrer) where the logo's server
// allows it: kept as it is if at most 32 KB with no scripts or event handlers. Most logo servers
// don't allow that kind of download (vmc.digicert.com, valimail…): then only the logo's address is
// kept, and the inbox page loads it as an image (no referrer), the way a web page shows a picture.
// Either way the company's logo server sees the computer's IP address (Gmail fetches BIMI logos on
// its own servers instead). Asked about again weekly; a domain without one is remembered ("none").
// Stored in the icon store under "bimi:<domain>". Off with enableSenderBimi, and only when network
// checks are allowed (privacy level).
const BIMI_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
const BIMI_MAX_BYTES = 32 * 1024;
const bimiInFlight = new Map();
// TXT records from Cloudflare (1.1.1.1; its security resolver when the address 1.1.1.1 itself is blocked,
// as some school and company networks do).
// The one that answered last is asked first, so a blocked one costs its wait only once.
const TXT_HOSTS = ['1.1.1.1', 'security.cloudflare-dns.com'];
async function dnsTxt(name) {
    let data = null, lastError = null;
    for (const host of TXT_HOSTS.slice()) {
        try {
            const res = await fetchWithTimeout(`https://${host}/dns-query?name=${encodeURIComponent(name)}&type=TXT`, { headers: { accept: 'application/dns-json' } }, 5000);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            data = await res.json();
            if (TXT_HOSTS[0] !== host) TXT_HOSTS.sort((a, b) => (b === host) - (a === host));
            break;
        } catch (e) { lastError = e; }
    }
    if (!data) throw lastError;
    // A TXT record can come in several quoted pieces: joined back together.
    return (data.Answer || []).filter(r => r.type === 16).map(r => String(r.data || '').replace(/^"|"$/g, '').replace(/"\s*"/g, ''));
}
// The tags of a "v=BIMI1; l=…" or "v=DMARC1; p=…" record, lower-case names.
function recordTags(txt) {
    const tags = {};
    for (const part of String(txt).split(';')) {
        const m = /^\s*([a-z]+)\s*=\s*(.*?)\s*$/i.exec(part);
        if (m) tags[m[1].toLowerCase()] = m[2];
    }
    return tags;
}
async function bimiRecordFor(org) {
    const rec = (await dnsTxt(`default._bimi.${org}`)).map(recordTags).find(t => /^bimi1$/i.test(t.v || ''));
    return rec ? { domain: org, logo: rec.l || '' } : null;
}
// A domain's DMARC policy ({ p, sp, pct } of its organization domain, or null for none), remembered
// for a week in the icon store under "dmarc:<org>".
const dmarcInFlight = new Map();
async function dmarcPolicy(org) {
    const key = 'dmarc:' + org;
    const hit = await iconStore.get(key).catch(() => null);
    if (hit && Date.now() - hit.ts < BIMI_RECHECK_MS) {
        try { return hit.bytes ? JSON.parse(new TextDecoder().decode(hit.bytes)) : null; } catch (e) { /* asked again */ }
    }
    if (dmarcInFlight.has(key)) return dmarcInFlight.get(key);
    const p = (async () => {
        try {
            const rec = (await dnsTxt(`_dmarc.${org}`)).map(recordTags).find(t => /^dmarc1$/i.test(t.v || ''));
            const pol = rec ? { p: String(rec.p || '').toLowerCase(), sp: String(rec.sp || '').toLowerCase(), pct: rec.pct === undefined ? 100 : Number(rec.pct) } : null;
            await iconStore.put(key, pol ? 'application/json' : '', pol ? new TextEncoder().encode(JSON.stringify(pol)).buffer : null, pol ? 'dmarc' : 'none').catch(() => {});
            return pol;
        } finally { dmarcInFlight.delete(key); }
    })();
    dmarcInFlight.set(key, p);
    return p;
}
// Whether mail claiming to be from this domain and failing DMARC is rejected or sent to spam: the
// organization's policy (its subdomain policy sp= for a subdomain), applied to all of it (pct=100).
// Only then can a picture shown for its senders not be borrowed by a forger.
async function dmarcEnforced(domain) {
    const d = normalizeDomain(domain);
    const org = registrableDomain(d) || d;
    const pol = await dmarcPolicy(org);
    if (!pol || !(pol.pct >= 100)) return false;
    return /^(quarantine|reject)$/.test(d !== org ? pol.sp || pol.p : pol.p);
}
// A logo kept only by its address (its server didn't allow a download): stored as text.
const BIMI_LINK_TYPE = 'text/uri-list';
function bimiResult(rec) {
    if (!rec || !rec.bytes) return '';
    if (rec.type === BIMI_LINK_TYPE) { const u = new TextDecoder().decode(rec.bytes); return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : ''; }
    return iconDataUrl(rec);
}
// A safe BIMI SVG, or null.
function bimiSvg(bytes) {
    if (!bytes.byteLength || bytes.byteLength > BIMI_MAX_BYTES) return null;
    const text = new TextDecoder().decode(bytes);
    if (!/<svg[\s>]/i.test(text) || /<script|\son[a-z]+\s*=|javascript:|<foreignObject/i.test(text)) return null;
    return { type: 'image/svg+xml', bytes };
}
// The company's BIMI logo: a data: URL, an https: address for the page to load, or ''.
async function bimiLogo(domain) {
    const d = normalizeDomain(domain);
    const org = registrableDomain(d) || d;
    if (!SENDER_DOMAIN_RE.test(org) || isPersonalMailDomain(org)) return '';
    // A subdomain sender gets the logo only when the subdomain policy is enforced too.
    if (d !== org && !await dmarcEnforced(d).catch(() => false)) return '';
    const key = 'bimi:' + org;
    const hit = await iconStore.get(key).catch(() => null);
    if (hit && Date.now() - hit.ts < BIMI_RECHECK_MS) return bimiResult(hit);
    if (bimiInFlight.has(key)) return bimiInFlight.get(key);
    const p = (async () => {
        try {
            const rec = await bimiRecordFor(org);
            const url = rec && /^https:\/\/[^\s"'<>]+$/i.test(rec.logo) ? rec.logo.slice(0, 500) : '';
            if (!url || !await dmarcEnforced(org)) {
                await iconStore.put(key, '', null, 'none');
                return '';
            }
            let found = null, how = 'downloaded';
            try {
                const res = await fetchWithTimeout(url, { credentials: 'omit', referrerPolicy: 'no-referrer' }, 6000);
                if (res.ok) found = bimiSvg(await res.arrayBuffer());
                if (!found) { await iconStore.put(key, '', null, 'none'); logInfo(`The BIMI logo of ${org} isn't used: ${res.ok ? 'not a plain SVG image of at most 32 KB' : `its address answered HTTP ${res.status}`}.`, 'Sender checks'); return ''; }
            } catch (e) {
                // The logo's server doesn't allow a download from here (no CORS): the page loads it.
                found = { type: BIMI_LINK_TYPE, bytes: new TextEncoder().encode(url).buffer };
                how = 'shown from its address';
            }
            await iconStore.put(key, found.type, found.bytes, 'bimi', url);
            if (!(hit && hit.bytes && hit.from === url)) logInfo(`BIMI logo for ${org}: ${hit && hit.bytes ? 'changed, replaced' : 'remembered'} (${how}).`, 'Sender checks');
            return bimiResult({ type: found.type, bytes: found.bytes });
        } catch (e) {
            // A failed DNS lookup keeps what was known (a logo isn't lost to an outage).
            logWarning(`The BIMI logo for ${org} couldn't be checked (${errorText(e)}).`, 'Sender checks');
            return bimiResult(hit);
        } finally {
            bimiInFlight.delete(key);
        }
    })();
    bimiInFlight.set(key, p);
    return p;
}

// The sender's exact address on the community scam-sender list (downloaded with the phishing lists).
async function phishingSenderHit(address, cfg) {
    if (!cfg.values.enablePhishingFeeds) return null;
    const feeds = await loadFeedSets();
    const a = String(address || '').toLowerCase();
    return feeds.address.has(a) ? { source: 'community', entry: a, name: feeds.address.get(a) } : null;
}

// One sender: { address, domain, status, reasons, move, own, country, countrySource, checks }.
//   s.address    as Gmail shows it, even malformed ("x@=?UTF-8?B?…?=", 100 characters before the @…)
//   ownDomain    the user's own organization domain (never moved to Spam)
// checks is a short human-readable account of what was checked, for the log and Logging → Senders.
async function checkSender(s, ownDomain, cfg) {
    const S = cfg.values;
    const parsed = parseSenderAddress(s.address);
    if (!parsed) return { address: String(s.address || ''), domain: '', status: 'unknown', reasons: ['Not an email address.'], move: false };
    const { address, domain } = parsed;
    const online = !!S.enableDnsThreatCheck;
    const domainChecks = !!S.enableSenderDomainCheck;
    const own = normalizeDomain(ownDomain || '');
    const sets = cfgSets(cfg);
    const allowlisted = hostInSet(domain, sets.allow);
    const trustedHit = senderListMatch(address, sets.trusted);
    const shared = senderDomainShared(domain, own);
    const validDomain = SENDER_DOMAIN_RE.test(domain);
    const [listHit, domainFeed] = await Promise.all([
        S.enableSenderAddressCheck ? phishingSenderHit(address, cfg) : null,
        domainChecks && S.enablePhishingFeeds && !shared && validDomain ? feedHit(`https://${domain}/`) : null
    ]);
    // The DNS services are asked only when their answer can still change the verdict.
    const dns = domainChecks && online && validDomain && !shared && !allowlisted && !trustedHit && !listHit && !domainFeed
        ? await senderDomainDns(domain, S).catch(() => null) : null;
    let verdict = combineSenderVerdict({
        address, ownDomain: own, allowlisted, trustedHit, listHit, addressChecked: !!S.enableSenderAddressCheck, domainFeed, dns,
        dnsChecked: domainChecks && online
    });
    verdict = applyEmailSignals(verdict, parsed.malformed);
    // Country: the domain's ending when it names one, else where its website is hosted. (The country
    // of the server that sent a particular email is looked up separately: senderCountry.)
    let country = null, countrySource = null;
    if (S.enableSenderIdentity && S.enableSenderCountry && validDomain) {          // shown only on the sender icon
        if ((country = countryFromDomain(domain))) countrySource = 'domain';
        else if (online && dns && dns.ip && (country = await countryOfIp(dns.ip))) countrySource = 'host';
    }
    const checks = [
        trustedHit ? `trusted senders: ${trustedHit}` : null,
        S.enableSenderAddressCheck ? `community scam-sender list: ${listHit ? `listed (${listHit.name || 'community list'})` : S.enablePhishingFeeds ? 'not listed' : 'off'}` : 'community scam-sender list: off',
        !domainChecks ? 'domain checks: off' : shared ? 'domain: big provider or your organization, not judged' : !validDomain ? 'domain: invalid'
            : `phishing lists: ${domainFeed ? `listed (${domainFeed})` : S.enablePhishingFeeds ? 'not listed' : 'off'}; threat services: ${dns ? (dns.verdict === 'unsafe' ? `blocked by ${dns.scanner}` : dns.verdict === 'safe' ? 'clean' : (dns.note || 'no answer')) : online ? 'not needed' : 'off (Offline only)'}`,
        parsed.malformed.length ? `address: malformed (${parsed.malformed.length} sign${parsed.malformed.length === 1 ? '' : 's'})` : null
    ].filter(Boolean).join('; ');
    return Object.assign({ address, domain, country, countrySource, checks }, verdict);
}

const STATUS_WORD = { flagged: 'Flagged', caution: 'Caution', clean: 'Checked, nothing found', trusted: 'Trusted', unverified: 'Not verified', unknown: 'Unknown' };
async function checkSenders(list, ownDomain) {
    const cfg = await getConfig();
    const S = cfg.values;
    if (!S.enableSenderIdentity && !S.enableSenderDomainCheck && !S.enableSenderAddressCheck) return [];
    const items = list.slice(0, 60);
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            const parsed = parseSenderAddress(items[i].address);
            const key = `${parsed ? parsed.address : String(items[i].address || '').trim()}|${parsed && parsed.malformed.length ? 'malformed' : ''}|${normalizeDomain(ownDomain || '')}`;
            try {
                const hit = await senderResultCache.get(key);
                if (hit && !hit.retry) { results[i] = hit.r; continue; }
                const r = await checkSender(items[i], ownDomain, cfg);
                results[i] = r;
                // Every sender is kept for Logging → Senders; a "not verified" one is checked again next time.
                senderResultCache.set(key, { r, retry: r.status === 'unverified' });
                const where = r.country ? `; country: ${countryName(r.country)} (${r.countrySource === 'host' ? 'website hosted there' : 'domain ending'})` : '';
                writeLog(r.status === 'flagged' ? 'warning' : 'info', 'Sender checks',
                    `Sender ${r.address}: ${STATUS_WORD[r.status] || r.status}${r.move ? ' (its email will be moved to Spam)' : ''}. ${r.reasons.join(' ')} Checked: ${r.checks}${where}.`);
            } catch (e) {
                results[i] = { address: String(items[i].address || ''), status: 'unverified', reasons: ['The check failed.'], move: false };
                logWarning(`Checking the sender ${String(items[i].address || '').slice(0, 120)} failed (${errorText(e)}).`, 'Sender checks');
            }
        }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return results;
}

// Conversations the extension moved (or was about to move) to Spam (spamMovedThreads), and those the
// user took out of Spam (spamRescuedThreads), remembered (thread id → time) so the extension never
// moves them (again). The two are kept apart so moves can never push out the user's decisions. Each
// keeps its newest SPAM_MEMORY_MAX; there is no time limit. When the moved list is full, its oldest
// entries go first: Gmail deletes Spam after 30 days, so those conversations no longer exist unless
// the user took them out of Spam, and a rescue clicked in Gmail on the web is in the other list.
// log: false (remember only) | 'moved' | 'failed' | 'rescued': written to the application log, the
// popup's activity and spamMoveLog (Logging → Moved to Spam). Resolves to true once saved.
const SPAM_LOG_MAX = 1000;
const SPAM_MEMORY_MAX = 50000;
let spamMemoryQueue = Promise.resolve();
let spamMemoryFullLogged = false;
function recordSpamMoves(moves, log = 'moved') {
    const saved = spamMemoryQueue.then(async () => {
        const key = log === 'rescued' ? 'spamRescuedThreads' : 'spamMovedThreads';
        const stored = await storageGet('local', { [key]: {} });
        const map = stored[key] && typeof stored[key] === 'object' ? stored[key] : {};
        const now = Date.now();
        for (const m of moves) if (!map[m.thread]) map[m.thread] = now;
        let entries = Object.entries(map);
        if (entries.length > SPAM_MEMORY_MAX) {
            entries = entries.sort((a, b) => b[1] - a[1]).slice(0, SPAM_MEMORY_MAX);
            if (!spamMemoryFullLogged) {
                spamMemoryFullLogged = true;
                const oldest = new Date(entries[entries.length - 1][1]).toLocaleDateString();
                logWarning(log === 'rescued'
                    ? `The list of conversations you took out of Spam is full (${SPAM_MEMORY_MAX.toLocaleString()}); the oldest are forgotten (now kept from ${oldest}). Add senders you trust to Settings → Senders → Trusted senders.`
                    : `The list of conversations moved to Spam is full (${SPAM_MEMORY_MAX.toLocaleString()}); the oldest are forgotten (now kept from ${oldest}). Gmail deletes Spam after 30 days, so those no longer exist; conversations you took out of Spam are kept separately.`, 'Sender checks');
            }
        }
        const updates = { [key]: Object.fromEntries(entries) };
        if (log) {
            const old = await storageGet('local', { spamMoveLog: [] });
            const entries = moves.map(m => ({ ts: now, action: log, thread: m.thread, sender: m.address || '', reason: m.reason || '', how: m.how || '' }));
            updates.spamMoveLog = [...entries, ...(Array.isArray(old.spamMoveLog) ? old.spamMoveLog : [])].slice(0, SPAM_LOG_MAX);
        }
        await chrome.storage.local.set(updates);
        return true;
    }).catch(e => {
        logError(`Emails moved to Spam could not be remembered (${errorText(e)}), so none were moved.`, 'Sender checks');
        return false;
    });
    spamMemoryQueue = saved;
    for (const m of moves) {
        if (log === 'moved') {
            logInfo(`Moved to Spam: an email from ${m.address} (conversation ${m.thread}), ${m.how || 'automatically'}. Why: ${m.reason} It won't be moved again if you take it out of Spam.`, 'Sender checks');
            logActivity('Moved to Spam', `${m.address}: ${m.reason}`);
        } else if (log === 'failed') {
            logWarning(`Not moved to Spam: an email from ${m.address} (conversation ${m.thread}) was flagged, but ${m.how || 'Gmail did not confirm the move'}. It is still marked. Why it was flagged: ${m.reason}`, 'Sender checks');
        } else if (log === 'rescued') logInfo(`Taken out of Spam by you: conversation ${m.thread}. The extension will never move it back.`, 'Sender checks');
    }
    return saved;
}

// Conversations Gmail was asked to move but didn't (the click changed nothing): forgotten, so they can
// be tried again. Only the moved list; the user's rescues are never touched.
function forgetSpamMoves(threads) {
    const done = spamMemoryQueue.then(async () => {
        if (!threads.length) return true;
        const stored = await storageGet('local', { spamMovedThreads: {} });
        const map = stored.spamMovedThreads && typeof stored.spamMovedThreads === 'object' ? stored.spamMovedThreads : {};
        let changed = false;
        for (const t of threads) if (t in map) { delete map[t]; changed = true; }
        if (changed) await chrome.storage.local.set({ spamMovedThreads: map });
        return true;
    }).catch(() => false);
    spamMemoryQueue = done;
    return done;
}

// Crops a drawn grid to its dark modules (the symbol without its quiet zone) and decodes it; tries
// the inverted colors too (light-on-dark drawings).
function decodeDrawnQr(grid) {
    if (grid.length > 400) return null;
    for (const invert of [false, true]) {
        const g = grid.map(r => r.map(v => (invert ? 1 - v : v)));
        let top = -1, bottom = -1, left = Infinity, right = -1;
        g.forEach((row, y) => row.forEach((v, x) => { if (v) { if (top < 0) top = y; bottom = y; left = Math.min(left, x); right = Math.max(right, x); } }));
        if (top < 0) continue;
        const size = Math.max(bottom - top, right - left) + 1;
        if (size < 21 || (size - 17) % 4 !== 0) continue;
        const sym = Array.from({ length: size }, (_, y) => Uint8Array.from({ length: size }, (_, x) => (g[top + y] && g[top + y][left + x]) ? 1 : 0));
        const r = QRDecoder.decodeGrid(sym);
        if (r) return { text: r.text };
    }
    return null;
}

// ---------------------------------------------------------------------------
// TOOLBAR ICON per tab: in color with the count while an email is being checked; greyed out with no
// count otherwise (the default everywhere, see manifest). A tab-specific badge of null falls back to
// the global badge, so an "ERR" warning stays visible.
// ---------------------------------------------------------------------------
const ICON_ACTIVE = { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' };
const ICON_IDLE = { 16: 'icons/icon16-off.png', 32: 'icons/icon32-off.png', 48: 'icons/icon48-off.png', 128: 'icons/icon128-off.png' };
const IDLE_TITLE = 'Gmail Link Unshortener: not active here. Open an email to have it checked.';

function setTabState(tabId, active, links, pixels) {
    const total = links + pixels;
    const ignore = () => void chrome.runtime.lastError;     // the tab may have closed meanwhile
    chrome.action.setIcon({ tabId, path: active ? ICON_ACTIVE : ICON_IDLE }, ignore);
    chrome.action.setBadgeText({ tabId, text: active && total > 0 ? String(total) : null }, ignore);
    if (active && total > 0) chrome.action.setBadgeBackgroundColor({ tabId, color: '#d93025' }, ignore);
    chrome.action.setTitle({ tabId, title: active
        ? `Gmail Link Unshortener: checking this email (${links} link${links === 1 ? '' : 's'} fixed or flagged, ${pixels} tracking pixel${pixels === 1 ? '' : 's'} blocked)`
        : IDLE_TITLE }, ignore);
}

// Combined state per tab: a tab is active when any of its frames shows a message being checked;
// counts and link statistics are added up across frames.
const tabFrames = new Map();                  // tabId → Map(frameId → last report)
const EMPTY_STATS = () => ({ total: 0, scanned: 0, safe: 0, caution: 0, unsafe: 0, notVerified: 0, unscanned: 0 });

function combinedState(tabId) {
    const frames = tabFrames.get(tabId);
    const out = { active: false, linkCount: 0, pixelCount: 0, links: EMPTY_STATS() };
    if (!frames) return null;
    for (const f of frames.values()) {
        if (!f.active) continue;
        out.active = true;
        out.linkCount += f.linkCount || 0;
        out.pixelCount += f.pixelCount || 0;
        for (const k of Object.keys(out.links)) out.links[k] += (f.links && f.links[k]) || 0;
    }
    return out;
}

function setFrameState(tabId, frameId, report) {
    if (!tabFrames.has(tabId)) tabFrames.set(tabId, new Map());
    tabFrames.get(tabId).set(frameId, {
        active: report.active !== false, linkCount: report.linkCount || 0, pixelCount: report.pixelCount || 0, links: report.links || null
    });
    const s = combinedState(tabId);
    setTabState(tabId, s.active, s.linkCount, s.pixelCount);
}

// After the service worker restarts it has forgotten the frames' reports, so it asks them again.
async function getTabState(tabId) {
    if (!tabFrames.has(tabId)) {
        try { chrome.tabs.sendMessage(tabId, { action: 'reportState' }, () => void chrome.runtime.lastError); } catch (e) { /* no content script */ }
        await new Promise(r => setTimeout(r, 400));
    }
    return combinedState(tabId);
}

// A tab that loads a new page starts out idle; the mail page reports itself once it's ready.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') { tabFrames.delete(tabId); setTabState(tabId, false, 0, 0); }
});
chrome.tabs.onRemoved.addListener((tabId) => tabFrames.delete(tabId));

// ---------------------------------------------------------------------------
// QR SCANNER (hidden offscreen document)
// Created only when an image or attachment needs scanning, at most SCANNER_PARALLEL scans at once,
// and closed after SCANNER_IDLE_MS without work, so it uses no memory between emails.
// ---------------------------------------------------------------------------
const SCANNER_IDLE_MS = 60 * 1000;
const SCANNER_PARALLEL = 2;
const QR_RESULT_CACHE_MAX = 300;
let scannerReady = null, scannerIdleTimer = null, scansRunning = 0;
const scanWaiters = [];
const qrResults = new Map();      // image URL → result (session memory, bounded)

function ensureScanner() {
    if (!scannerReady) {
        scannerReady = (async () => {
            const existing = chrome.runtime.getContexts ? await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }) : [];
            if (!existing.length) {
                await chrome.offscreen.createDocument({
                    url: 'scanner.html', reasons: ['BLOBS', 'DOM_PARSER'],
                    justification: 'Decode QR codes in email images and attachments on this device.'
                });
            }
        })().catch((e) => { scannerReady = null; throw e; });
    }
    return scannerReady;
}

function scheduleScannerClose() {
    clearTimeout(scannerIdleTimer);
    scannerIdleTimer = setTimeout(async () => {
        if (scansRunning) return scheduleScannerClose();
        try { await chrome.offscreen.closeDocument(); } catch (e) { /* already closed */ }
        scannerReady = null;
    }, SCANNER_IDLE_MS);
}

async function scanForQr(req) {
    const key = req.url || null;
    if (key && qrResults.has(key)) return qrResults.get(key);
    if (scansRunning >= SCANNER_PARALLEL) await new Promise(r => scanWaiters.push(r));
    scansRunning++;
    try {
        await ensureScanner();
        const res = await chrome.runtime.sendMessage({ target: 'scanner', url: req.url, b64: req.b64, mime: req.mime || '' });
        if (!res || !res.ok) throw new Error(res && res.error ? res.error : 'no answer from the scanner');
        if (key) {
            if (qrResults.size >= QR_RESULT_CACHE_MAX) qrResults.delete(qrResults.keys().next().value);
            qrResults.set(key, res);
        }
        if (res.codes && res.codes.length) logInfo(`Found ${res.codes.length} QR code(s) in ${req.name ? 'an attachment' : 'an email image'}.`, 'QR scanning');
        return res;
    } finally {
        scansRunning--;
        const next = scanWaiters.shift();
        if (next) next();
        scheduleScannerClose();
    }
}

// Reads a cloud-storage page's code (without running it, and without the #fragment, which is never
// sent) to find where it redirects. Only on the user's explicit request.
async function inspectCloudPage(pageUrl) {
    const u = new URL(pageUrl);
    u.hash = '';
    try {
        const res = await fetchWithTimeout(u.href, { credentials: 'omit' }, 10000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = (await res.text()).slice(0, 512 * 1024);
        const targets = extractRedirectTargets(html).filter(t => hostOf(t) && hostOf(t) !== u.hostname);
        logInfo(`Inspected a cloud-storage page on request: ${targets.length ? `it redirects to ${logUrl(targets[0])}` : 'no redirect target found in its code'}.`, 'Cloud-page inspection');
        return targets[0] || null;
    } catch (e) {
        logWarning(`A cloud-storage page could not be inspected (${errorText(e)}).`, 'Cloud-page inspection');
        return null;
    }
}

// Pages in public cloud storage are flagged whatever DNS checks say (those domains are never blocked).
function applyCloudCheck(safety, url, extra) {
    const cloud = cloudStoragePage(url);
    if (!cloud) return { safety, cloud: null };
    extra.cloudPlatform = cloud.platform;
    if (cloud.fragment) extra.cloudFragment = cloud.fragment.decoded;
    if (safety.verdict !== 'unsafe') {
        safety = verdictResult('unsafe', { reason: cloud.reason, scanner: 'Cloud-storage check', source: 'cloud', resolvedIp: safety.resolvedIp });
    }
    return { safety, cloud };
}

// ---------------------------------------------------------------------------
// LINK PIPELINES
// ---------------------------------------------------------------------------
// opts.reveal = true: the user clicked the reveal icon on a blocklisted link and confirmed.
// Only then is a blocklisted link decoded and (if it is a short link and third-party resolution is
// on) looked up via unshorten.me. One-time-link protection still applies during a reveal.
async function resolveLink(shortUrl, linkText, opts = {}) {
    // Links you're sending are checked the same way, but History is for links you received.
    const logHistory = opts.outgoing ? () => {} : logHistoryEntry;
    if (typeof shortUrl !== 'string') return null;
    const shortHost = hostOf(shortUrl);
    if (!shortHost) return null;
    const reveal = !!opts.reveal;

    const cfg = await getConfig();
    const S = cfg.values;
    const ctx = decoderContext(cfg);
    const allowSet = cfgSets(cfg).allow;
    let finalUrl = shortUrl;
    let resolverUsed = reveal ? 'Blocklist reveal' : 'Direct link (checked only)';
    let oneTime = S.enableOneTimeLinkProtection && isSingleUseToken(shortUrl, linkText);

    // --- BLOCKLIST (link's own host) ---
    // Flagged immediately, destination hidden: no decoding, no DNS, no unshortener, nothing cached.
    // The blocklist wins over the allowlist.
    const outerBlocked = blocklistHit([shortUrl], cfg);
    if (outerBlocked && !reveal) {
        // Whether a reveal would need unshorten.me: only if offline decoding finds nothing.
        // (Computed locally so the prompt is truthful; nothing is sent and the result is not shown.)
        const offline = await unwrapNestedUrl(shortUrl, oneTime, ctx);
        const revealUsesNetwork = !oneTime && offline.unwrappedUrl === shortUrl &&
            networkEligibility(shortUrl, shortHost, cfg, { reveal: true }).eligible;
        // Recorded like any other flagged link (once per 10 minutes, as blocklist verdicts are not cached).
        logHistory({ shortUrl: oneTime ? redactOneTimeUrl(shortUrl) : shortUrl, finalUrl: '(destination hidden: blocklisted)',
                     verdict: 'blocked', reason: outerBlocked, resolver: 'Blocklist', dedupeMs: LOG_DEDUPE_MS });
        return {
            finalUrl: shortUrl, isSafe: false, verdict: 'unsafe', reason: outerBlocked, resolvedIp: 'N/A',
            isAllowlisted: false, isBlocklisted: true, destinationHidden: true,
            blockedByPolicy: hostInSet(shortHost, cfgSets(cfg).managedBlock),
            // Lets the reveal prompt say truthfully whether anything will be sent to a third party.
            revealUsesNetwork,
            revealVia: revealUsesNetwork ? lookupChain(S).map(c => c.label).join(', then ') : ''
        };
    }

    // --- ALLOWLIST ---
    // Allowlisted hosts skip scanning, EXCEPT when the link is a redirect wrapper pointing somewhere
    // that is not allowlisted. The destination is then scanned like any other link.
    let preUnwrapped = null;
    if (!outerBlocked && hostInSet(shortHost, allowSet)) {
        const un = await unwrapNestedUrl(shortUrl, oneTime, ctx);
        let destAllowed = true;
        if (un.unwrappedUrl !== shortUrl) {
            const destHost = hostOf(un.unwrappedUrl);
            destAllowed = !destHost || hostInSet(destHost, allowSet);
        }
        if (destAllowed) {
            return { finalUrl: shortUrl, isSafe: true, verdict: 'safe', reason: 'Allowlisted', resolvedIp: 'N/A', isAllowlisted: true };
        }
        preUnwrapped = un;
    }

    // --- CACHE (ordinary links only; never for a reveal; the blocklist is re-applied) ---
    if (!reveal && !oneTime && S.enableResultCache) {
        const c = await readCachedResult(shortUrl);
        if (c && typeof c.finalUrl === 'string' && /^https?:\/\//i.test(c.finalUrl)) {
            const blocked = blocklistHit([c.finalUrl], cfg);
            if (blocked) {
                return { finalUrl: c.finalUrl, isSafe: false, verdict: 'unsafe', reason: blocked, resolvedIp: c.resolvedIp || 'N/A', isAllowlisted: false, isBlocklisted: true };
            }
            return { finalUrl: c.finalUrl, isSafe: !!c.isSafe, verdict: c.isSafe ? 'safe' : 'unsafe', reason: c.reason, resolvedIp: c.resolvedIp || 'N/A', isAllowlisted: false };
        }
    }

    // --- OFFLINE UNWRAPPING (one-time links: strict wrapper formats only) ---
    const { unwrappedUrl, strategyPath } = preUnwrapped || await unwrapNestedUrl(shortUrl, oneTime, ctx);
    if (unwrappedUrl !== shortUrl) {
        finalUrl = unwrappedUrl;
        resolverUsed = strategyPath + ' Fast-Path';
    }

    // A decoded inner URL may reveal a one-time link the outer URL did not.
    if (!oneTime && S.enableOneTimeLinkProtection && finalUrl !== shortUrl && isSingleUseToken(finalUrl, linkText)) oneTime = true;
    // A page in a public storage bucket is a static file with nothing to use up, whatever its wording
    // ("claim", "verify"…), so it is not treated as a one-time link; it is flagged by the cloud check.
    if (oneTime && cloudStoragePage(finalUrl)) oneTime = false;

    const extra = { isAllowlisted: false, isBlocklisted: !!outerBlocked, revealed: reveal, opaqueNote: describeOpaqueLink(finalUrl) };

    if (oneTime) {
        // NO network request to the link, NO cache entry, NO full URL in logs.
        let safety = await assessSafety(shortUrl, finalUrl, cfg, { oneTime: true });
        safety = applyCloudCheck(safety, finalUrl, extra).safety;
        if (!safety.isSafe) {
            logHistory({ shortUrl: redactOneTimeUrl(shortUrl), finalUrl: redactOneTimeUrl(finalUrl), verdict: 'unsafe', reason: safety.reason, resolvedIp: safety.resolvedIp, resolver: 'One-Time Link Protection' });
        }
        return Object.assign({ finalUrl, isSafe: safety.isSafe, verdict: safety.verdict, reason: safety.reason, note: safety.note, resolvedIp: safety.resolvedIp, isOneTime: true }, extra);
    }

    // --- NETWORK RESOLUTION (opt-in per host; rules in networkEligibility) ---
    const networkEligible = networkEligibility(shortUrl, shortHost, cfg, { reveal }).eligible;

    let networkAttemptFailed = false;
    if (finalUrl === shortUrl && networkEligible) {
        const resolved = await lookupShortLink(shortUrl, cfg);
        if (resolved.url) {
            finalUrl = resolved.url;
            resolverUsed = (reveal ? 'Revealed on request via ' : '') + resolved.via;
        } else {
            networkAttemptFailed = true;
            extra.shortLinkWhy = resolved.why;
        }
    }

    // The resolved destination may itself be a one-time link: keep it out of cache and logs.
    if (S.enableOneTimeLinkProtection && finalUrl !== shortUrl && isSingleUseToken(finalUrl, linkText)) {
        let safety = await assessSafety(shortUrl, finalUrl, cfg, { oneTime: true });
        safety = applyCloudCheck(safety, finalUrl, extra).safety;
        if (!safety.isSafe) {
            logHistory({ shortUrl: redactOneTimeUrl(shortUrl), finalUrl: redactOneTimeUrl(finalUrl), verdict: 'unsafe', reason: safety.reason, resolvedIp: safety.resolvedIp, resolver: resolverUsed });
        }
        return Object.assign({ finalUrl, isSafe: safety.isSafe, verdict: safety.verdict, reason: safety.reason, note: safety.note, resolvedIp: safety.resolvedIp, isOneTime: true }, extra);
    }

    finalUrl = cleanTrackingParams(finalUrl);

    let safety = await assessSafety(shortUrl, finalUrl, cfg);

    // An email tracker that could not be decoded: only the tracker's own domain was checked, which
    // says nothing about where the link goes, so the result is "not verified", never "safe".
    const trackerProvider = finalUrl === shortUrl ? emailTrackerProvider(shortUrl) : null;
    if (trackerProvider && safety.verdict !== 'unsafe') {
        safety = Object.assign({}, safety, { verdict: 'unknown', isSafe: true,
            note: `email tracking link (${trackerProvider}); the destination is kept by the provider and was not followed` });
    }
    // Offer a 🔍 reveal for an unresolved tracker, only if a lookup service could actually be asked.
    if (trackerProvider && !reveal && networkEligibility(shortUrl, shortHost, cfg, { reveal: true }).eligible) {
        extra.trackerRevealable = true;
        extra.trackerProvider = trackerProvider;
        extra.revealVia = lookupChain(S).map(c => c.label).join(', then ');
    }
    // Cloud-storage pages: flagged; on request, their code is read to find where they redirect.
    const cloudBefore = cloudStoragePage(finalUrl);
    if (cloudBefore && reveal && cloudBefore.inspectable && S.enableTrackerReveal) {
        const target = await inspectCloudPage(finalUrl);
        extra.cloudPlatform = cloudBefore.platform;
        if (cloudBefore.fragment) extra.cloudFragment = cloudBefore.fragment.decoded;
        if (target) {
            finalUrl = target;
            resolverUsed = `Cloud page inspected on request (${cloudBefore.platform})`;
            safety = await assessSafety(shortUrl, finalUrl, cfg);
        }
        if (safety.verdict !== 'unsafe') safety = verdictResult('unsafe', { reason: cloudBefore.reason, scanner: 'Cloud-storage check', source: 'cloud', resolvedIp: safety.resolvedIp });
    } else if (cloudBefore) {
        safety = applyCloudCheck(safety, finalUrl, extra).safety;
        if (!reveal && cloudBefore.inspectable && S.enableTrackerReveal) extra.cloudInspectable = true;
    }

    // Name what actually happened, rather than a generic scanner label.
    if (finalUrl === shortUrl && !networkAttemptFailed) {
        resolverUsed = trackerProvider ? `Email tracker (${trackerProvider}), not followed` : 'Direct link (checked only)';
    }

    // Never cache an inconclusive result (an "unknown" verdict or a failed network lookup), and never
    // cache a blocklist verdict or a reveal, so blocklist changes take effect immediately.
    if (S.enableResultCache && !reveal && safety.verdict !== 'unknown' && !networkAttemptFailed && safety.source !== 'blocklist' && safety.source !== 'cloud' && safety.source !== 'feed') {
        cacheResult(shortUrl, {
            finalUrl: finalUrl,
            resolver: resolverUsed,
            isSafe: safety.isSafe,
            reason: safety.reason || 'Clean',
            resolvedIp: safety.resolvedIp,
            cachedDate: new Date().toLocaleString(),
            cachedTimestamp: Date.now()
        });
    }

    if (safety.verdict !== 'unknown' || finalUrl !== shortUrl || trackerProvider) {
        const historyVerdict = safety.verdict === 'unknown' ? 'unknown' : (safety.isSafe ? 'safe' : 'unsafe');
        logHistory({ shortUrl, finalUrl, verdict: historyVerdict, reason: safety.reason || (historyVerdict === 'unknown' ? safety.note : null),
                     resolvedIp: safety.resolvedIp, resolver: resolverUsed,
                     // trackers are never cached, so record each one at most once per 10 minutes
                     dedupeMs: trackerProvider ? LOG_DEDUPE_MS : 0 });
    }

    if (safety.source === 'blocklist') extra.isBlocklisted = true;
    return Object.assign({ finalUrl: finalUrl, isSafe: safety.isSafe, verdict: safety.verdict, reason: safety.reason, note: safety.note, resolvedIp: safety.resolvedIp, shortLinkUnresolved: networkAttemptFailed }, extra);
}

// Link Inspector: mirrors resolveLink (same rules, same order) but never caches or logs anything,
// and explains each decision in plain language. A blocklisted link is decoded offline here (you
// pasted it deliberately), but it is never sent to unshorten.me from the Inspector.
async function inspectLink(inputUrl) {
    const cfg = await getConfig();
    const S = cfg.values;
    const ctx = decoderContext(cfg);
    const hostname = hostOf(inputUrl);
    if (!hostname) return null;
    const notes = [];
    const allowSet = cfgSets(cfg).allow;
    let oneTime = S.enableOneTimeLinkProtection && isSingleUseToken(inputUrl);

    const result = await unwrapNestedUrl(inputUrl, oneTime, ctx);

    const outerBlocked = blocklistHit([inputUrl], cfg);
    if (outerBlocked) {
        notes.push('This host is on the blocklist' + (hostInSet(hostname, allowSet) ? ' (and the allowlist; the blocklist wins)' : '') +
                   '. In Gmail the link is flagged with its destination hidden until you click the 🔍 reveal icon.');
    } else if (hostInSet(hostname, allowSet)) {
        let destAllowed = true;
        if (result.unwrappedUrl !== inputUrl) {
            const destHost = hostOf(result.unwrappedUrl);
            destAllowed = !destHost || hostInSet(destHost, allowSet);
        }
        if (destAllowed) {
            return { unwrappedUrl: inputUrl, steps: [], strategyPath: '', isSafe: true, verdict: 'safe', reason: 'Allowlisted', resolvedIp: 'N/A', scanner: 'Allowlist',
                     notes: ['This domain is on the allowlist, so scanning is skipped (as it is in Gmail).'] };
        }
        notes.push('The host is allowlisted, but it redirects to a destination that is not, so the destination is scanned.');
    }

    if (!oneTime && S.enableOneTimeLinkProtection && result.unwrappedUrl !== inputUrl && isSingleUseToken(result.unwrappedUrl)) oneTime = true;

    if (oneTime) {
        notes.push('One-time / unsubscribe link protection: this link was NOT requested, cached or logged. Only strict wrapper formats (Proofpoint, SafeLinks, SES) are decoded, so a token can never be dropped.');
    } else if (result.unwrappedUrl !== inputUrl) {
        notes.push('Decoded offline; no network lookup was needed.');
    } else {
        const net = networkEligibility(inputUrl, hostname, cfg);
        if (net.eligible) {
            const resolved = await lookupShortLink(inputUrl, cfg);
            if (resolved.url) {
                result.steps.push({ layer: result.steps.length + 1, decoder: `${resolved.via} lookup (network)`, inputUrl: inputUrl, outputUrl: resolved.url });
                result.unwrappedUrl = resolved.url;
                notes.push(`Looked up via ${resolved.via}: ${net.reason}.`);
                if (S.enableOneTimeLinkProtection && isSingleUseToken(resolved.url)) { oneTime = true; notes.push('The destination looks like a one-time link, so it would not be cached or logged.'); }
            } else {
                notes.push(`Looked up via ${lookupChain(S).map(c => c.label).join(', then ')} (${net.reason}) but no destination was returned (${resolved.why}), so the real destination is unknown.`);
            }
        } else {
            notes.push(`No network lookup: ${net.reason}.`);
        }
    }

    if (!oneTime) {
        const cleaned = cleanTrackingParams(result.unwrappedUrl);
        if (cleaned !== result.unwrappedUrl) {
            result.steps.push({
                layer: result.steps.length + 1,
                decoder: 'Marketing Parameter Sanitizer (UTM / Tracking Query Removal)',
                inputUrl: result.unwrappedUrl,
                outputUrl: cleaned
            });
            result.unwrappedUrl = cleaned;
        }
    }

    if (S.enableMismatchWarnings) {
        const problem = detectLinkProblem('', inputUrl, result.unwrappedUrl, new Set());
        if (problem) notes.push('⚠️ Warning: ' + problem + '.');
    }

    let safety = await assessSafety(inputUrl, result.unwrappedUrl, cfg);
    const trackerProvider = result.unwrappedUrl === inputUrl ? emailTrackerProvider(inputUrl) : null;
    if (trackerProvider && safety.verdict !== 'unsafe') {
        safety = Object.assign({}, safety, { verdict: 'unknown', isSafe: true,
            note: `Email tracking link (${trackerProvider}): the destination is kept by the provider and was not followed` });
    }
    if (hostOf(result.unwrappedUrl) !== hostname && safety.source !== 'blocklist') {
        notes.push(`Both the link's own host (${hostname}) and the destination were checked, because the click goes to the link's own host whenever Gmail shows the original link.`);
    }
    const opaque = describeOpaqueLink(result.unwrappedUrl);
    if (opaque) notes.push(opaque);
    if (safety.scanner === 'AdGuard (backup)') notes.push('The primary security resolvers could not be reached, so the AdGuard backup resolver was used.');

    result.isSafe = safety.isSafe;
    result.verdict = safety.verdict;
    result.reason = safety.reason;
    result.note = safety.note;
    result.resolvedIp = safety.resolvedIp;
    result.scanner = safety.scanner;
    result.notes = notes;
    return result;
}

// ---------------------------------------------------------------------------
// CHECKING LINKS BEFORE SENDING (Gmail). For each link in the email being sent:
//   1. offline: typos in the ending, no ending, look-alike brand domains, text showing another site
//   2. DNS: does the domain exist (Cloudflare 1.1.1.1, site name only)
//   3. safety: the full link pipeline (blocklist, phishing lists, DNS threat filters, short links)
//   4. reachability: one request from this browser, as when the reader clicks (no page content is
//      read); skipped for one-time links, which a visit would use up
// Steps 2-4 follow the privacy settings: with DNS threat checks off ("Offline only"), only step 1 runs.
// Returns [{ url, problems: [..], unverified: bool }].
// ---------------------------------------------------------------------------
async function dnsHasAddress(hostname) {
    const q = async (type) => {
        const res = await fetchWithTimeout(`https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, { headers: { accept: 'application/dns-json' } }, 5000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    };
    const a = await q('A');
    if (a.Status === 3) return 'nxdomain';
    if ((a.Answer || []).some(r => r.type === 1)) return 'ok';
    const aaaa = await q('AAAA');
    return (aaaa.Answer || []).some(r => r.type === 28) ? 'ok' : 'noaddress';
}

async function checkOutgoingLink(link, cfg) {
    const S = cfg.values;
    const problems = outgoingLinkOfflineProblems(link.url, link.text);
    const out = { url: link.url, problems, unverified: false };
    let u;
    try { u = new URL(link.url); } catch (e) { return out; }
    if (!/^https?:$/.test(u.protocol) || !S.enableDnsThreatCheck) return out;
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
    if (!isIp && host.includes('.')) {
        try {
            const dns = await dnsHasAddress(host);
            if (dns === 'nxdomain') { problems.push(`its domain ${host} doesn't exist (no such domain in DNS)`); return out; }
            if (dns === 'noaddress') { problems.push(`its domain ${host} exists but has no website address`); return out; }
        } catch (e) { out.unverified = true; }
    }
    try {
        const r = await resolveLink(link.url, link.text || '', { outgoing: true });
        if (r && !r.isSafe) problems.push(`is flagged as dangerous: ${r.reason || 'listed by a security service'}`);
    } catch (e) { out.unverified = true; }
    if (!problems.length && !(S.enableOneTimeLinkProtection && isSingleUseToken(link.url, link.text))) {
        // Browsers try HTTPS first for an http:// link (and "test.com" typed alone becomes http://), so
        // an http:// address counts as working if either form answers.
        const probe = (url) => fetchWithTimeout(url, { method: 'HEAD', mode: 'no-cors', credentials: 'omit', cache: 'no-store', redirect: 'follow', referrerPolicy: 'no-referrer' }, 8000);
        try {
            await probe(link.url);
        } catch (e) {
            let ok = false, slow = e && e.name === 'AbortError';
            if (!slow && u.protocol === 'http:') {
                try { await probe('https://' + link.url.slice('http://'.length)); ok = true; }
                catch (e2) { slow = e2 && e2.name === 'AbortError'; }
            }
            if (slow) out.unverified = true;                              // slow, not necessarily broken
            else if (!ok) problems.push('couldn\'t be reached (the website didn\'t answer, or its security certificate is invalid)');
        }
    }
    return out;
}

// Results are remembered for 10 minutes, so the links in a signature aren't re-checked (and their
// websites re-contacted) on every email sent.
const OUTGOING_MEMO_MS = 10 * 60 * 1000;
const outgoingMemo = new Map();        // url|text → { ts, result }
async function checkOutgoingLinks(links) {
    const cfg = await getConfig();
    const list = links.slice(0, 40);
    const results = new Array(list.length);
    let next = 0;
    const checkOne = async (link) => {
        const key = `${link.url}|${link.text || ''}`;
        const m = outgoingMemo.get(key);
        if (m && Date.now() - m.ts < OUTGOING_MEMO_MS) return m.result;
        const result = await checkOutgoingLink(link, cfg);
        if (outgoingMemo.size >= 500) outgoingMemo.delete(outgoingMemo.keys().next().value);
        if (!result.unverified) outgoingMemo.set(key, { ts: Date.now(), result });
        return result;
    };
    const worker = async () => { while (next < list.length) { const i = next++; results[i] = await checkOne(list[i]); } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    // One log line per check, listing every link and its result, so it's always clear what was checked.
    const summary = results.map(r => `${logUrl(r.url)}: ${r.problems.length ? r.problems.join('; ') : r.unverified ? 'not fully checked' : 'OK'}`);
    logInfo(`Before sending: checked ${results.length} link${results.length === 1 ? '' : 's'}. ${summary.join(' | ')}`, 'Send check');
    return results;
}

// ---------------------------------------------------------------------------
// MESSAGE HANDLERS
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // A QR code drawn with an HTML table or text characters: the Gmail tab sends the module grid.
    if (request.action === 'decodeQrMatrix') {
        if (!sender || sender.id !== chrome.runtime.id || !Array.isArray(request.grid)) { sendResponse(null); return false; }
        sendResponse(decodeDrawnQr(request.grid));
        return false;
    }

    if (request.action === 'checkOutgoingLinks') {
        if (!sender || sender.id !== chrome.runtime.id || !Array.isArray(request.links)) { sendResponse([]); return false; }
        checkOutgoingLinks(request.links.filter(l => l && typeof l.url === 'string')).then(sendResponse).catch(() => sendResponse(null));
        return true;
    }

    // Phishing-simulation check by link domains: the email's links, unwrapped offline (no network).
    if (request.action === 'unwrapLinksOffline') {
        if (!sender || sender.id !== chrome.runtime.id || !Array.isArray(request.urls)) { sendResponse(null); return false; }
        getConfig().then(async (cfg) => {
            const ctx = decoderContext(cfg);
            const out = [];
            for (const u of request.urls.slice(0, 200)) {
                if (typeof u !== 'string') continue;
                try { out.push((await unwrapNestedUrl(u, false, ctx)).unwrappedUrl); } catch (e) { out.push(u); }
            }
            sendResponse(out);
        }).catch(() => sendResponse(null));
        return true;
    }

    // Sender checks for the inbox list and opened emails (Gmail).
    if (request.action === 'checkSenders') {
        if (!sender || sender.id !== chrome.runtime.id || !Array.isArray(request.senders)) { sendResponse([]); return false; }
        checkSenders(request.senders.filter(x => x && typeof x.address === 'string'), typeof request.ownDomain === 'string' ? request.ownDomain : '')
            .then(sendResponse).catch((e) => { logError(`Sender checks failed: ${errorText(e)}`, 'Sender checks'); sendResponse([]); });
        return true;
    }
    // Country of the server that handed an email to Gmail (from the email's own headers).
    if (request.action === 'senderCountry') {
        if (!sender || sender.id !== chrome.runtime.id || typeof request.ip !== 'string') { sendResponse(null); return false; }
        getConfig().then(cfg => (cfg.values.enableSenderIdentity && cfg.values.enableSenderCountry && cfg.values.enableDnsThreatCheck ? countryOfIp(request.ip.trim()) : null))
            .then(c => sendResponse(c || null), () => sendResponse(null));
        return true;
    }
    // A sender's site icon (data: URL, or '' for none), fetched once and remembered.
    if (request.action === 'senderIcon') {
        if (!sender || sender.id !== chrome.runtime.id || typeof request.site !== 'string') { sendResponse(''); return false; }
        // The site's icon (d) and, apart from it, a remembered colleague's photo or company logo (a; no
        // network: they are only ever learned from opened emails), drawn over the row's checkbox.
        const address = typeof request.address === 'string' ? request.address.toLowerCase().slice(0, 320) : '';
        getConfig().then(async cfg => {
            const V = cfg.values;
            if (!V.enableSenderIdentity) return { d: '', a: '', k: '' };
            // The picture, best first: a colleague's own photo (only ever learned from opened emails),
            // the company's BIMI logo (DNS; no email has to be opened), a company logo learned from an
            // opened email, then the site's icon (its own, its parent domain's, or DuckDuckGo's).
            const domain = typeof request.domain === 'string' ? request.domain.toLowerCase().slice(0, 253) : request.site;
            const icon = V.enableDnsThreatCheck ? senderIcon(request.site, { fallback: !!V.enableSenderIconFallback }) : Promise.resolve('');
            // A photo or logo is shown only for a domain that enforces DMARC (forged mail claiming it is
            // rejected or sent to spam), so a forger can't borrow a colleague's photo or a company's logo.
            // That needs a DNS lookup: with network checks off, no photos or logos are shown.
            const enforced = V.enableDnsThreatCheck ? await dmarcEnforced(domain).catch(() => false) : false;
            const photo = enforced && V.enableSenderAvatars && address ? await avatarFor(address, '') : '';
            if (photo) return { d: await icon, a: photo, k: 'photo' };
            const bimi = enforced && V.enableSenderBimi ? await bimiLogo(domain).catch(() => '') : '';
            if (bimi) return { d: await icon, a: bimi, k: 'logo' };
            const learned = enforced && V.enableSenderAvatars ? await avatarFor('', request.site) : '';
            if (learned) return { d: await icon, a: learned, k: 'logo' };
            return { d: await icon, a: '', k: '' };
        }).then(r => sendResponse(r), () => sendResponse({ d: '' }));
        return true;
    }
    if (request.action === 'senderAvatar') {
        if (!sender || sender.id !== chrome.runtime.id || typeof request.address !== 'string' || typeof request.url !== 'string') { sendResponse('refused'); return false; }
        const address = request.address.toLowerCase().slice(0, 320);
        // kind 'personal': a colleague's photo, kept for the address; kind 'logo': a company's logo, kept
        // for its site (never a personal email service's).
        const domain = request.kind === 'logo' && typeof request.domain === 'string' ? request.domain.toLowerCase().slice(0, 253) : '';
        if (request.kind === 'logo' && (!SENDER_DOMAIN_RE.test(domain) || isPersonalMailDomain(domain) || registrableDomain(address.split('@')[1] || '') !== domain)) { sendResponse('refused'); return false; }
        if (request.kind !== 'logo' && request.kind !== 'personal') { sendResponse('refused'); return false; }
        const target = { address, domain };
        // Embedded in the page: stored directly (no network needed, so not tied to the privacy level).
        if (/^data:image\//i.test(request.url)) {
            if (request.url.length > 64 * 1024) { sendResponse('unusable'); return false; }
            getConfig().then(cfg => cfg.values.enableSenderIdentity && cfg.values.enableSenderAvatars ? rememberEmbeddedLogo(target, request.url) : 'off')
                .then(r => sendResponse(r), () => sendResponse('failed'));
            return true;
        }
        // From the webmail's own image host: downloaded here (the background isn't subject to the
        // webmail page's own rules for loading images).
        if (!avatarHostAllowed(request.url)) { sendResponse('refused'); return false; }
        getConfig().then(cfg => cfg.values.enableSenderIdentity && cfg.values.enableSenderAvatars && cfg.values.enableDnsThreatCheck
            ? rememberAvatar(target, request.url.slice(0, 2000)) : 'off')
            .then(r => sendResponse(r), () => sendResponse('failed'));
        return true;
    }
    // Other extensions that do the same job (content.js detectConflicts): remembered for Settings →
    // Other extensions (newest 50, with where and when they were seen); answers the ones the user
    // chose to ignore.
    if (request.action === 'reportConflicts') {
        if (!sender || sender.id !== chrome.runtime.id || !Array.isArray(request.conflicts)) { sendResponse([]); return false; }
        storageGet('local', { detectedConflicts: {}, ignoredConflicts: [], keptConflictFeatures: {} }).then(async (r) => {
            const map = r.detectedConflicts && typeof r.detectedConflicts === 'object' ? r.detectedConflicts : {};
            for (const c of request.conflicts.slice(0, 10)) {
                if (!c || typeof c.key !== 'string' || c.key.length > 80) continue;
                const known = OVERLAPPING_EXTENSIONS.find(x => x.ids.includes(c.key));
                const isNew = !map[c.key];
                map[c.key] = { key: c.key, name: known ? known.name : 'Another extension', does: known ? known.does : String(c.does || '').slice(0, 80),
                               features: (known ? known.features : (Array.isArray(c.features) ? c.features : [])).filter(k => SETTING_BY_KEY[k]),
                               via: c.via === 'effect' ? 'effect' : 'page', site: String(request.site || '').slice(0, 40), ts: Date.now() };
                if (isNew) logWarning(`${map[c.key].name} also does ${map[c.key].does} in ${map[c.key].site}; the two can conflict. Settings → Other extensions offers to turn one off.`, 'Other extensions');
            }
            const kept = Object.fromEntries(Object.entries(map).sort((a, b) => b[1].ts - a[1].ts).slice(0, 50));
            await chrome.storage.local.set({ detectedConflicts: kept });
            // Not warned about: ignored ones, and ones whose features still on were all kept on purpose.
            const keptOn = r.keptConflictFeatures && typeof r.keptConflictFeatures === 'object' ? r.keptConflictFeatures : {};
            const skip = (Array.isArray(r.ignoredConflicts) ? r.ignoredConflicts : []).concat(request.conflicts
                .filter(c => c && typeof c.key === 'string' && conflictSettled(c.features, keptOn[c.key])).map(c => c.key));
            sendResponse(skip);
        }).catch(() => sendResponse([]));
        return true;
    }
    if (request.action === 'ignoreConflict') {
        if (!sender || sender.id !== chrome.runtime.id || typeof request.key !== 'string') { sendResponse(false); return false; }
        storageGet('local', { ignoredConflicts: [] }).then(r => {
            const list = (Array.isArray(r.ignoredConflicts) ? r.ignoredConflicts : []).filter(k => k !== request.key).concat(request.key).slice(-100);
            return chrome.storage.local.set({ ignoredConflicts: list });
        }).then(() => sendResponse(true), () => sendResponse(false));
        return true;
    }
    if (request.action === 'openConflicts') {
        if (!sender || sender.id !== chrome.runtime.id) { sendResponse(false); return false; }
        chrome.tabs.create({ url: chrome.runtime.getURL('options.html#conflicts') }, () => sendResponse(!chrome.runtime.lastError));
        return true;
    }
    if (request.action === 'forgetSpamMoves') {
        if (!sender || sender.id !== chrome.runtime.id || !Array.isArray(request.threads)) { sendResponse(false); return false; }
        const threads = request.threads.filter(t => typeof t === 'string' && /^thread-f:\d{1,25}$/.test(t)).slice(0, 100);
        forgetSpamMoves(threads).then(sendResponse, () => sendResponse(false));
        return true;
    }
    if (request.action === 'recordSpamMoves') {
        if (!sender || sender.id !== chrome.runtime.id || !Array.isArray(request.moves)) { sendResponse(false); return false; }
        const moves = request.moves.filter(m => m && typeof m.thread === 'string' && /^thread-f:\d{1,25}$/.test(m.thread)).slice(0, 100)
            .map(m => ({ thread: m.thread, address: String(m.address || '').slice(0, 200), reason: String(m.reason || '').slice(0, 1000), how: String(m.how || '').slice(0, 200) }));
        if (!moves.length) { sendResponse(false); return false; }
        recordSpamMoves(moves, ['moved', 'failed', 'rescued'].includes(request.log) ? request.log : false).then(sendResponse, () => sendResponse(false));
        return true;
    }

    if (request.action === 'syncPhishFeeds') {
        syncPhishFeeds().then(r => sendResponse(r)).catch(() => sendResponse({ failures: 1 }));
        return true;
    }

    // QR codes in an email image (Google proxy URL) or an attachment (bytes from the Gmail tab).
    if (request.action === 'scanQr') {
        if (!sender || sender.id !== chrome.runtime.id) { sendResponse({ ok: false }); return false; }
        (async () => {
            const cfg = await getConfig();
            if (!cfg.values.enableQrScanning) return { ok: false, error: 'QR scanning is off' };
            if (request.b64 && !cfg.values.enableAttachmentScanning && request.name) return { ok: false, error: 'attachment scanning is off' };
            if (request.url && !/^https:\/\/[^/]*\.googleusercontent\.com\//.test(request.url)) return { ok: false, error: 'only images from Google\'s proxy are fetched' };
            if (request.b64 && request.b64.length > 14 * 1024 * 1024) return { ok: false, error: 'file too large' };
            return scanForQr(request);
        })().then(sendResponse, (e) => {
            logWarning(`A QR scan failed (${errorText(e)}).`, 'QR scanning');
            sendResponse({ ok: false, error: errorText(e) });
        });
        return true;
    }

    // Errors and events reported by the Gmail content script, the popup and the Options page.
    if (request.action === 'logEvent') {
        if (!sender || sender.id !== chrome.runtime.id) { sendResponse({ status: 'ignored' }); return false; }
        writeLog(LOG_LEVELS.includes(request.level) ? request.level : 'error', request.source || 'Extension', request.message);
        sendResponse({ status: 'logged' });
        return false;
    }

    if (request.action === 'getSettings') {
        // Only what the Gmail tab uses (the synced shortener list can hold thousands of domains and is
        // needed only here in the background).
        getConfig().then(cfg => sendResponse({ values: cfg.values, locked: cfg.locked, allowlist: cfg.allowlist, blocklist: cfg.blocklist, policy: cfg.policy })).catch((e) => { logError(`Settings could not be loaded: ${errorText(e)}`, 'Background'); sendResponse(null); });
        return true;
    }

    if (request.action === 'testUnwrap') {
        inspectLink(request.url).then(r => sendResponse(r || null))
            .catch((e) => { logError(`Inspecting ${logUrl(request.url)} failed: ${errorText(e)}`, 'Link Inspector'); sendResponse(null); });
        return true;
    }

    if (request.action === 'forceSync') {
        updateRemoteLists().then((r) => sendResponse({ status: !r ? 'update failed; see Logging → Application log'
            : r.fresh ? `already up to date; lists are downloaded at most once a day (next after ${new Date(r.nextAt).toLocaleString()})`
            : r.skipped ? 'updates are turned off' : r.error ? 'update failed; see Logging → Application log' : 'updated' }));
        return true;
    }

    if (request.action === 'logPixel') {
        logHistoryEntry({ shortUrl: request.url, finalUrl: request.url, verdict: 'pixel', reason: `Tracking pixel ${request.removed ? 'removed' : 'neutralized'}`, resolver: 'Pixel Detector' });
        sendResponse({ status: "Logged" });
        return true;
    }

    // Tests the custom threat resolver exactly as configured on the form (not yet saved).
    if (request.action === 'testCustomThreat') {
        (async () => {
            const conf = request.conf || {};
            const req = buildCustomRequest(conf, { hostname: 'example.com', url: 'https://example.com/', url_noscheme: 'example.com/' }, true);
            if (!req) return { success: false, message: 'The endpoint must be a valid https:// address.' };
            try {
                const res = await fetchWithTimeout(req.url, req.init);
                const text = await res.text();
                if (!res.ok) return { success: false, message: `HTTP ${res.status}. Reply: ${text.slice(0, 200)}` };
                let data;
                try { data = JSON.parse(text); } catch (e) { return { success: false, message: `The reply is not JSON: ${text.slice(0, 200)}` }; }
                const r = parseThreatResponse(data, conf.flagField);
                if (!r.recognized) {
                    return { success: false, message: `Connected, but the reply format was not recognized, so it would be treated as "no answer". ` +
                        `Set "Flag field" to the field that indicates a threat. Reply: ${text.slice(0, 200)}` };
                }
                return { success: true, message: `Connected. Test domain example.com ${r.blocked ? 'was FLAGGED (check your configuration)' : 'is clean'}; the reply format is understood.` };
            } catch (e) {
                return { success: false, message: `Failed: ${e.message}. Click Save service to grant access to this host, or make sure it sends CORS headers.` };
            }
        })().then(sendResponse);
        return true;
    }

    // Tests the custom unshortener as configured on the form, with a short link the user supplies.
    if (request.action === 'testCustomUnshortener') {
        (async () => {
            const testUrl = String(request.testUrl || '').trim();
            if (!/^https?:\/\//i.test(testUrl)) return { success: false, message: 'Enter a short link to test with (for example one from a recent email).' };
            const r = await queryCustomUnshortener(request.conf || {}, testUrl);
            if (r.ok) return { success: true, message: `Connected. ${testUrl} → ${r.url}` };
            return { success: false, message: `Failed: ${r.error}.` + (r.body ? ` Reply: ${r.body}` : '') +
                (/fetch|network|Failed to fetch/i.test(r.error || '') ? ' Click Save to grant access to this host, or make sure it sends CORS headers.' : '') };
        })().then(sendResponse);
        return true;
    }

    if (request.action === 'testResolver') {
        const wire = WIRE_DNS_PROVIDERS.find(p => typeof request.url === 'string' && request.url.startsWith(p.url));
        if (wire) {
            queryWireProvider(wire, 'example.com').then(r => sendResponse(r.ok
                ? { success: true, message: `Connected: ${wire.name} answered (${r.addrs.length ? r.addrs[0] : 'code ' + r.rcode}).` }
                : { success: false, message: `${wire.name} did not answer (see Logging → Application log).` }));
            return true;
        }
        const testResolver = async () => {
            try {
                let url = request.url;

                if (url.includes('quad9.net')) {
                    const wire = buildDnsWireQuery('example.com');
                    const res = await fetchWithTimeout(`https://dns.quad9.net/dns-query?dns=${wire}`, {
                        headers: { 'Accept': 'application/dns-message' }
                    });
                    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
                    return { success: true, message: "Connected! RFC 8484 Wireformat OK" };
                }

                url = url.replace('{hostname}', 'example.com');
                if (!url.includes('example.com') && !url.includes('{')) {
                    const joiner = url.includes('?') ? '&' : '?';
                    url = `${url}${joiner}name=example.com&type=A`;
                }

                // Try both GET and POST for custom APIs
                let res;
                try {
                    res = await fetchWithTimeout(url, { headers: { 'Accept': 'application/dns-json' } });
                } catch (e) {
                    res = await fetchWithTimeout(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ "client": { "clientId": "test" }, "threatInfo": { "threatTypes": ["MALWARE"], "platformTypes": ["ANY_PLATFORM"], "threatEntryTypes": ["URL"], "threatEntries": [{"url": "http://example.com"}] } })
                    });
                }

                if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
                const data = await res.json();

                if (data.Status !== undefined || data.Answer !== undefined || data.matches !== undefined || data.query_status !== undefined) {
                    return { success: true, message: `Connected! Valid API response received.` };
                } else {
                    return { success: false, message: "Connected, but response was not a standard DoH or Threat API format." };
                }
            } catch (error) {
                return { success: false, message: `Failed: ${error.message}. If this is a custom endpoint, make sure its host is permitted (Save service asks for access) or that it sends CORS headers.` };
            }
        };
        testResolver().then(sendResponse);
        return true;
    }

    if (request.action === 'resolveUrl') {
        resolveLink(request.url, request.linkText || '', { reveal: request.reveal === true })
            .then(r => sendResponse(r || null))
            .catch((e) => {
                logError(`Analyzing a link on ${logUrl(request.url)} failed: ${errorText(e)}. The link was left unchanged.`, 'Link analysis');
                sendResponse(null);
            });
        return true;
    }

    // Each part of a mail page (the page and any message frames) reports its own state.
    if (request.action === 'updateBadge') {
        const tabId = sender && sender.tab ? sender.tab.id : undefined;
        if (tabId === undefined) { sendResponse({ status: 'No tab' }); return false; }
        setFrameState(tabId, sender.frameId || 0, request);
        sendResponse({ status: 'Badge updated' });
        return false;
    }

    // The popup asks for the combined state of a tab.
    if (request.action === 'getTabState') {
        getTabState(request.tabId).then(sendResponse, () => sendResponse(null));
        return true;
    }
});
