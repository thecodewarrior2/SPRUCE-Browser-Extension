// ---------------------------------------------------------------------------
// SENDER ICON STORE (Gmail sender icons), shared by the background and the Settings page.
// Icons are kept in the extension's own IndexedDB database as the raw image bytes Google sends (about
// 600 bytes for a 32-pixel icon), one record per site: a quarter smaller than text (base64), and each
// new icon is one small write instead of rewriting every icon. A site without an icon is kept as a
// record without bytes. Records older than ICON_STORE_TTL_MS are ignored and pruned; beyond
// ICON_STORE_MAX the oldest go first.
// Never loaded in the Gmail page (it would open Gmail's database, not the extension's).
// If IndexedDB can't be opened, every call fails quietly: icons are then fetched again when needed.
// ---------------------------------------------------------------------------
const ICON_STORE_DB = 'senderIcons';
const ICON_STORE_NAME = 'icons';
const ICON_STORE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ICON_STORE_MAX = 1500;

const iconStore = (() => {
    let dbPromise = null;
    const open = () => {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available')); return; }
                const req = indexedDB.open(ICON_STORE_DB, 1);
                req.onupgradeneeded = () => {
                    const store = req.result.createObjectStore(ICON_STORE_NAME, { keyPath: 'site' });
                    store.createIndex('ts', 'ts');
                };
                req.onsuccess = () => {
                    const db = req.result;
                    db.onversionchange = () => { db.close(); dbPromise = null; };
                    resolve(db);
                };
                req.onerror = () => reject(req.error || new Error('IndexedDB could not be opened'));
                req.onblocked = () => reject(new Error('IndexedDB is blocked by another page of the extension'));
            }).catch((e) => { dbPromise = null; throw e; });
        }
        return dbPromise;
    };
    // Runs fn(store) in one transaction; resolves with fn's result once the transaction has finished.
    const run = async (mode, fn) => {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(ICON_STORE_NAME, mode);
            let result;
            Promise.resolve(fn(tx.objectStore(ICON_STORE_NAME))).then(r => { result = r; }, reject);
            tx.oncomplete = () => resolve(result);
            tx.onerror = tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction failed'));
        });
    };
    const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const fresh = (rec) => !!rec && Date.now() - rec.ts < ICON_STORE_TTL_MS;
    let putsSincePrune = 0;

    return {
        // { site, type, bytes (ArrayBuffer, or null for "no icon"), ts } or null.
        async get(site) {
            const rec = await run('readonly', s => req(s.get(site)));
            return fresh(rec) ? rec : null;
        },
        async put(site, type, bytes) {
            await run('readwrite', s => req(s.put({ site, type: bytes ? type : '', bytes: bytes || null, ts: Date.now() })));
            if (++putsSincePrune >= 50) { putsSincePrune = 0; this.prune().catch(() => {}); }
        },
        // Every fresh record, newest first (Settings → Logging → Senders).
        async all() {
            const recs = await run('readonly', s => req(s.getAll()));
            return recs.filter(fresh).sort((a, b) => b.ts - a.ts);
        },
        async clear() { await run('readwrite', s => req(s.clear())); },
        // Drops expired records, then the oldest beyond ICON_STORE_MAX. Resolves to the number removed.
        async prune() {
            return run('readwrite', s => new Promise((resolve, reject) => {
                const cutoff = Date.now() - ICON_STORE_TTL_MS;
                let removed = 0;
                const countReq = s.count();
                countReq.onerror = () => reject(countReq.error);
                countReq.onsuccess = () => {
                    let excess = countReq.result - ICON_STORE_MAX;
                    const cur = s.index('ts').openCursor();          // oldest first
                    cur.onerror = () => reject(cur.error);
                    cur.onsuccess = () => {
                        const c = cur.result;
                        if (!c || (c.value.ts >= cutoff && excess <= 0)) { resolve(removed); return; }
                        c.delete(); removed++; excess--;
                        c.continue();
                    };
                };
            }));
        }
    };
})();

// A stored icon as a data: URL for an <img>, or '' when the site has none.
function iconDataUrl(rec) {
    if (!rec || !rec.bytes || !/^image\/[a-z0-9.+-]+$/i.test(rec.type || '')) return '';
    const bytes = new Uint8Array(rec.bytes);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return `data:${rec.type};base64,${btoa(bin)}`;
}
