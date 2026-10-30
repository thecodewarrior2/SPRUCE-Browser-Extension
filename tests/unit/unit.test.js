// Unit tests: node --test unit.test.js  (EXT=path to the extension)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const EXT = process.env.EXT || path.resolve(__dirname, '..', '..');

// Background context with a minimal chrome stub (storage in memory).
function loadBackground(local = {}, extra = {}) {
  const store = { ...local };
  const listeners = () => ({ addListener() {} });
  const area = {
    get(keys, cb) {
      let r = {};
      if (keys === null) r = { ...store };
      else if (typeof keys === 'string') r = keys in store ? { [keys]: store[keys] } : {};
      else if (Array.isArray(keys)) keys.forEach(k => { if (k in store) r[k] = store[k]; });
      else for (const [k, d] of Object.entries(keys)) r[k] = k in store ? store[k] : d;
      if (cb) setTimeout(() => cb(r), 0); else return Promise.resolve(r);
    },
    set(o, cb) { Object.assign(store, o); if (cb) setTimeout(cb, 0); return Promise.resolve(); },
    remove(k, cb) { [].concat(k).forEach(x => delete store[x]); if (cb) setTimeout(cb, 0); return Promise.resolve(); }
  };
  const chrome = {
    runtime: { id: 'x', lastError: null, onMessage: listeners(), onInstalled: listeners(), getManifest: () => ({ version: 't' }), getURL: (p) => p },
    storage: { local: area, managed: { get: (k, cb) => cb ? cb({}) : Promise.resolve({}) }, onChanged: listeners() },
    alarms: { get: (n, cb) => cb && cb({ periodInMinutes: 1440 }), create() {}, onAlarm: listeners() },
    tabs: { onUpdated: listeners(), onRemoved: listeners(), sendMessage() {} },
    action: { setIcon() {}, setBadgeText() {}, setBadgeBackgroundColor() {}, setTitle() {} }
  };
  const fetchLog = [];
  const ctx = { chrome, console, setTimeout, clearTimeout, URL, URLSearchParams, TextDecoder, TextEncoder, AbortController, atob, btoa, Intl, BigInt,
    fetch: async (u) => { fetchLog.push(String(u)); throw new Error('offline'); }, self: { addEventListener() {} } };
  Object.assign(ctx, extra);
  ctx.importScripts = (...files) => files.forEach(f => vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), ctx, { filename: f }));
  vm.createContext(ctx);
  const bgSrc = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
  // Firefox build: background.html loads these before background.js (no importScripts).
  if (!/importScripts\(/.test(bgSrc)) ctx.importScripts('shared.js', 'decoders.js', 'custom-endpoints.js', 'qr-decoder.js', ...(fs.existsSync(path.join(EXT, 'icon-store.js')) ? ['icon-store.js'] : []));
  vm.runInContext(bgSrc, ctx, { filename: 'background.js' });
  ctx.__store = store; ctx.__fetchLog = fetchLog;
  return ctx;
}

const bg = loadBackground();
const S = (code) => vm.runInContext(code, bg);

test('normalizeSenderEntry accepts addresses and domains only', () => {
  const n = S('normalizeSenderEntry');
  assert.equal(n(' Bad@Evil.COM '), 'bad@evil.com');
  assert.equal(n('@evil.com'), 'evil.com');
  assert.equal(n('*@evil.com'), 'evil.com');
  assert.equal(n('mailto:a@b.co'), 'a@b.co');
  assert.equal(n('<x@y.org>'), 'x@y.org');
  for (const bad of ['evil', 'com', 'a b@c.com', '@', 'x@', '', null, 'a@b', 'a@-b.com']) assert.equal(n(bad), '', String(bad));
});

test('senderListMatch: exact address, domain and parent domains, never siblings', () => {
  const set = new Set(S('normalizeSenderList')(['evil.com', 'bad@x.org']));
  const m = S('senderListMatch');
  assert.equal(m('a@mail.evil.com', set), 'evil.com');
  assert.equal(m('BAD@x.org', set), 'bad@x.org');
  assert.equal(m('good@x.org', set), null);
  assert.equal(m('a@notevil.com', set), null);
  assert.equal(m('a@evil.com.attacker.io', set), null);
});

test('combineSenderVerdict: only flagged senders move', () => {
  const c = S('combineSenderVerdict');
  const flag = { verdict: 'unsafe', scanner: 'Quad9', reason: 'Malware or Phishing (Quad9)' };
  assert.deepEqual([c({ address: 'a@evil.xyz', dns: flag }).status, c({ address: 'a@evil.xyz', dns: flag }).move], ['flagged', true]);
  assert.equal(c({ address: 'a@evil.xyz', dns: { verdict: 'unsafe', scanner: 'Cloudflare Family' } }).move, false);
  assert.equal(c({ address: 'a@evil.xyz', dns: { verdict: 'unsafe', scanner: 'AdGuard (backup)' } }).status, 'caution');
  assert.equal(c({ address: 'a@ok.com', dns: { verdict: 'safe' } }).status, 'clean');
  assert.equal(c({ address: 'a@ok.com', dns: { verdict: 'unknown', note: 'No threat-intelligence resolver could be reached' } }).status, 'unverified');
  const nx = c({ address: 'a@nx.com', dns: { verdict: 'unknown', note: "The domain doesn't exist, so this link can't work" } });
  assert.equal(nx.status, 'flagged'); assert.equal(nx.move, true);
  assert.equal(c({ address: 'a@ok.com', dnsChecked: false }).status, 'unverified');
  for (const st of ['clean', 'unverified', 'unknown', 'caution', 'trusted']) {
    // no non-flagged status ever moves
    assert.ok(![c({ address: 'a@ok.com', dns: { verdict: 'safe' } }), c({ address: 'a@ok.com' })].some(v => v.move));
  }
});

test('combineSenderVerdict: shared providers are judged only by exact address', () => {
  const c = S('combineSenderVerdict');
  const flag = { verdict: 'unsafe', scanner: 'Quad9', reason: 'x' };
  assert.equal(c({ address: 'x@gmail.com', addressChecked: true, dns: flag, domainFeed: 'Phishing Army' }).status, 'unverified');
  assert.equal(c({ address: 'x@gmail.com', listHit: { source: 'community', entry: 'x@gmail.com', name: 'Sefinek' } }).move, true);
  assert.equal(c({ address: 'x@paypal.com', addressChecked: true, dns: flag }).move, false);
});

test('nothing is green by default', () => {
  const c = S('combineSenderVerdict');
  // Only a completed check or an explicit trust list may be green.
  for (const input of [{ address: 'x@gmail.com', addressChecked: true }, { address: 'x@gmail.com' }, { address: 'b@school.org', ownDomain: 'school.org' },
                       { address: 'a@ok.com' }, { address: 'a@ok.com', dns: {} }, { address: 'a@ok.com', dns: { verdict: 'unknown' } }, { address: 'a@ok.com', dns: { verdict: 'safe' }, dnsChecked: false }, {}]) {
    const v = c(input);
    assert.ok(v.status !== 'clean' && v.status !== 'trusted', JSON.stringify(input) + ' -> ' + v.status);
  }
});

test('combineSenderVerdict: own organization and allowlist', () => {
  const c = S('combineSenderVerdict');
  assert.equal(c({ address: 'x@sub.school.org', ownDomain: 'school.org', domainFeed: 'Phishing Army' }).move, false);
  assert.equal(c({ address: 'x@school.org', ownDomain: 'school.org', listHit: { source: 'community', entry: 'x@school.org' } }).move, false);
  assert.equal(c({ address: 'x@school.org', ownDomain: 'school.org', listHit: { source: 'community', entry: 'x@school.org' } }).status, 'flagged');
  assert.equal(c({ address: 'x@ok.com', trustedHit: 'ok.com', dns: { verdict: 'unsafe', scanner: 'Quad9' } }).status, 'trusted');
  // The allow list always wins: there is no block list to override it.
  assert.equal(c({ address: 'x@ok.com', trustedHit: 'ok.com', listHit: { source: 'community', entry: 'x@ok.com' } }).status, 'trusted');
  assert.equal(c({ address: 'x@ok.com', allowlisted: true, dns: { verdict: 'unsafe', scanner: 'Quad9' } }).status, 'trusted');
  assert.equal(c({ address: 'x@ok.com', allowlisted: true, listHit: { source: 'community', entry: 'x@ok.com' } }).status, 'trusted');
});

test('country helpers', () => {
  assert.equal(S('countryFromDomain("a.co.uk")'), 'GB');
  assert.equal(S('countryFromDomain("x.de")'), 'DE');
  assert.equal(S('countryFromDomain("x.io")'), null);
  assert.equal(S('countryFromDomain("x.com")'), null);
  assert.equal(S('countryFlag("US")'), '🇺🇸');
  assert.equal(S('countryFlag("usa")'), '');
  assert.equal(S('countryName("JP")'), 'Japan');
});

test('viewAllowsAutoSpam with the Gmail profile: inbox and its tabs only; no profile: never', () => {
  const views = S('WEBMAIL_SITES').find(w => w.id === 'gmail').mail.views;
  const f = (h) => S('viewAllowsAutoSpam')(h, views);
  assert.equal(S('viewAllowsAutoSpam')('#inbox', undefined), false);
  for (const ok of ['', '#', '#inbox', '#inbox/FMfcgz', '#category/social', '#category/promotions/abc']) assert.equal(f(ok), true, ok);
  for (const no of ['#spam', '#spam/abc', '#trash', '#sent', '#drafts', '#all', '#search/in%3Ainbox', '#label/inbox', '#starred', '#snoozed', '#imp', '#inboxes', '#category/']) assert.equal(f(no), false, no);
});

test('siteOfSender drops mail prefixes but never the real domain', () => {
  const f = S('siteOfSender');
  assert.equal(f('email.notifications.paypal.com'), 'paypal.com');
  assert.equal(f('email.co.uk'), 'email.co.uk');
  assert.equal(f('paypal.com.evil.io'), 'paypal.com.evil.io');
  assert.equal(f('example.k12.fl.us'), 'example.k12.fl.us');
});

test('sanitizeFeed (address): exact addresses only, no big-brand corporate addresses', () => {
  const feed = S('PHISH_FEEDS').find(f => f.kind === 'address');
  const out = [...S('sanitizeFeed')(feed, ['# comment', 'Scammer@Gmail.com', 'evil.com', 'noreply@google.com', 'billing@paypal.com', 'x@evil-scam.test  extra', 'not an address', 'a@b.co'].join('\n'))];
  assert.deepEqual(out.sort(), ['a@b.co', 'scammer@gmail.com', 'x@evil-scam.test']);
});

test('isPublicIp', () => {
  const f = S('isPublicIp');
  for (const ok of ['8.8.8.8', '209.85.220.41', '2a00:1450:4864::1']) assert.equal(f(ok), true, ok);
  for (const no of ['10.0.0.1', '192.168.1.1', '172.16.5.5', '127.0.0.1', '100.64.0.1', '169.254.1.1', '::1', 'fd00::1', 'fe80::1', '', 'x', '224.0.0.1']) assert.equal(f(no), false, no);
});

test('checkSender offline: list hit flagged, no network; shared domains never sent to DNS', async () => {
  const b = loadBackground({ __m: 1, enableDnsThreatCheck: false });
  vm.runInContext(`loadFeedSets = async () => ({ url: new Map(), domain: new Map(), address: new Map([['phisher@evil.test', 'Test list']]) });`, b);
  const r = await vm.runInContext(`checkSenders([{ address: 'Phisher@Evil.test' }, { address: 'friend@gmail.com' }, { address: 'x@example.de' }], 'school.org')`, b);
  assert.equal(r[0].status, 'flagged'); assert.equal(r[0].move, true);
  assert.equal(r[1].status, 'unverified');
  assert.equal(r[2].status, 'unverified'); assert.equal(r[2].country, 'DE'); assert.equal(r[2].countrySource, 'domain');
  assert.deepEqual(b.__fetchLog, []);
});

test('checkSender online: DNS asked only when it can change the verdict', async () => {
  const b = loadBackground({ customTrustedSenders: ['friend@trusted.test'], customAllowlist: ['trusted.test'] });
  vm.runInContext(`loadFeedSets = async () => ({ url: new Map(), domain: new Map(), address: new Map([['phisher@evil.test', 'Test list']]) });`, b);
  const asked = [];
  vm.runInContext('globalThis.__asked = []; checkDomainSafety = async (u) => { __asked.push(new URL(u).hostname); return { verdict: "safe", scanner: "Multi-DoH", resolvedIp: "N/A" }; };', b);
  const r = await vm.runInContext(`checkSenders([{ address: 'phisher@evil.test' }, { address: 'a@gmail.com' }, { address: 'a@trusted.test' }, { address: 'b@sub.school.org' }, { address: 'c@other.test' }], 'school.org')`, b);
  assert.deepEqual([...vm.runInContext('__asked', b)], ['other.test']);
  assert.deepEqual(r.map(x => x.status), ['flagged', 'unverified', 'trusted', 'unverified', 'clean']);
});

test('recordSpamMoves: no time limit, newest 50,000 kept, first time kept; rescues kept apart', async () => {
  const b = loadBackground({ spamMovedThreads: { 'thread-f:1': Date.now() - 4000 * 864e5, 'thread-f:2': 5 } });
  const ok = await vm.runInContext(`recordSpamMoves([{ thread: 'thread-f:3', address: 'a@b.co', reason: 'r' }, { thread: 'thread-f:2' }], false)`, b);
  assert.equal(ok, true);
  assert.deepEqual(Object.keys(b.__store.spamMovedThreads).sort(), ['thread-f:1', 'thread-f:2', 'thread-f:3']);
  assert.equal(b.__store.spamMovedThreads['thread-f:2'], 5);
  const many = {}; for (let i = 0; i < 50005; i++) many['thread-f:' + i] = i + 1;
  const b2 = loadBackground({ spamMovedThreads: many, spamRescuedThreads: { 'thread-f:r1': 1 } });
  await vm.runInContext(`recordSpamMoves([{ thread: 'thread-f:99999999' }], false)`, b2);
  const keys = Object.keys(b2.__store.spamMovedThreads);
  assert.equal(keys.length, 50000); assert.ok(keys.includes('thread-f:99999999')); assert.ok(!keys.includes('thread-f:0'));
  // A full moved list never pushes out the user's rescues, and a rescue goes to its own list.
  assert.deepEqual(b2.__store.spamRescuedThreads, { 'thread-f:r1': 1 });
  await vm.runInContext(`recordSpamMoves([{ thread: 'thread-f:r2' }], 'rescued')`, b2);
  assert.ok(b2.__store.spamRescuedThreads['thread-f:r2'] && b2.__store.spamRescuedThreads['thread-f:r1']);
  assert.ok(!b2.__store.spamMovedThreads['thread-f:r2']);
});

test('backup includes and restores the phishing-sender list', () => {
  const backup = S('buildBackup')({ customTrustedSenders: ['A@B.co', 'junk'] }, 't');
  assert.deepEqual(backup.customTrustedSenders, ['a@b.co']);
  const plan = S('planImport')({ exportFormat: 2, customTrustedSenders: ['x@y.org'], settings: { enableAutoSpam: false } }, { customTrustedSenders: ['a@b.co'] }, 'merge');
  assert.deepEqual(plan.updates.customTrustedSenders, ['a@b.co', 'x@y.org']);
  assert.equal(plan.updates.enableAutoSpam, false);
  const old = S('planImport')({ exportFormat: 2, settings: {} }, { customTrustedSenders: ['a@b.co'] }, 'overwrite');
  assert.ok(!('customTrustedSenders' in old.updates), 'an older backup leaves the list alone');
});

test('every new setting is on by default and has a policy key in schema.json', () => {
  const hasSchema = fs.existsSync(path.join(EXT, 'schema.json'));
  const schema = hasSchema ? JSON.parse(fs.readFileSync(path.join(EXT, 'schema.json'), 'utf8')) : null;
  let example = JSON.parse(fs.readFileSync(path.join(EXT, 'policy-example.json'), 'utf8'));
  if (example.policies) example = example.policies['3rdparty'].Extensions['link-unshortener@gmail-link-scanner'];
  for (const d of S('SETTING_DEFS')) {
    if (schema) assert.ok(schema.properties[d.managedKey], 'schema: ' + d.managedKey);
    if (/Sender|Spam/.test(d.managedKey)) assert.ok(d.managedKey in example, 'example: ' + d.managedKey);
  }
  assert.ok(!('managedPhishingSenders' in example));
  for (const k of ['enableSenderIdentity', 'enableSenderCountry', 'enableSenderDomainCheck', 'enableSenderAddressCheck', 'enableAutoSpam', 'enableSpamNotice']) assert.equal(S('SETTING_BY_KEY')[k].def, true, k);
  if (schema) assert.ok(!schema.properties.managedPhishingSenders && schema.properties.managedTrustedSenders);
});

const FX = path.join(__dirname, '..', 'fixtures') + '/';
test('header signs: both scam samples flagged, a normal newsletter clean', () => {
  const RX = S('WEBMAIL_SITES').find(w => w.id === 'gmail').mail.headers.receiver;
  const score = (f) => S('headerAnomalies')(fs.readFileSync(FX + f, 'utf8'), '', RX).reduce((a, x) => a + x.weight, 0);
  assert.ok(score('scam1.eml') >= 5, 'scam1'); assert.ok(score('scam2.eml') >= 5, 'scam2'); assert.equal(score('legit.eml'), 0);
});

test('header signs: DMARC failing a quarantine policy, records forged years earlier, MIME 2.0 (sample 3)', () => {
  const RX = S('WEBMAIL_SITES').find(w => w.id === 'gmail').mail.headers.receiver;
  const H = (raw) => S('headerAnomalies')(raw, '', RX);
  const signs = H(fs.readFileSync(FX + 'scam3.eml', 'utf8'));
  const has = (re, w) => signs.some(x => re.test(x.text) && x.weight === w);
  assert.ok(has(/DMARC.*newsletter-tool\.example.*treated as spam/, 5), 'dmarc quarantine');
  assert.ok(has(/3 fake delivery records.*2018, 2019/, 3), 'forged records');
  assert.ok(has(/MIME version 2\.0/, 2) && has(/mailing-list ID is malformed/, 1));
  assert.ok(signs.reduce((a, x) => a + x.weight, 0) >= 5);
  // Genuine mail is left alone.
  const base = 'Received: by 2002:a05::1 with SMTP id x; Mon, 13 Feb 2023 12:46:47 -0800 (PST)\nAuthentication-Results: mx.google.com; spf=pass smtp.mailfrom=a@school.org; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=school.org\nFrom: A <a@school.org>\n';
  const score = (raw) => H(raw).reduce((a, x) => a + x.weight, 0);
  assert.equal(score(base + 'MIME-Version: 1.0 (Mac OS X Mail 16.0 \\(3731.500.231\\))\nContent-Transfer-Encoding: 7BIT\n\nx'), 0, 'Apple Mail');
  assert.equal(score(base + 'Received: from a by b; Fri, 10 Feb 2023 12:00:00 -0800\nMIME-Version: 1.0\n\nx'), 0, 'mail retried for 3 days');
  // A genuine mailing list breaking DMARC: only a strong sign (caution), never a flag on its own.
  assert.equal(score(base.replace('dmarc=pass', 'dmarc=fail') + 'List-ID: <staff.lists.school.org>\n\nx'), 3);
  assert.equal(score(base.replace('dmarc=pass (p=REJECT', 'dmarc=fail (p=NONE') + '\nx'), 2);
  // Only Gmail's own topmost result counts: a "pass" the sender added lower down changes nothing.
  assert.equal(score('Received: from e by mx.google.com; Mon, 13 Feb 2023 12:46:47 -0800\nAuthentication-Results: mx.google.com; dmarc=fail (p=REJECT) header.from=paypal.com\nAuthentication-Results: mx.google.com; dmarc=pass header.from=paypal.com\nFrom: P <s@paypal.com>\n\nx'), 5);
});
test('malformed addresses are parsed and flagged on their own', () => {
  const p = S('parseSenderAddress');
  const enc = p('contact_support.adi@=?UTF-8?B?cmVsaWVmLXNhbXBsZS5leGFtcGxl?=');
  assert.equal(enc.domain, 'relief-sample.example'); assert.equal(enc.malformed[0].weight, 5);
  assert.equal(p('a'.repeat(70) + '@x.com').malformed.length, 1);
  assert.equal(p('ok@example.com').malformed.length, 0);
  assert.equal(p('no-at-sign'), null);
  const base = { status: 'clean', reasons: ['Checked: no security service or list flags this sender.'], move: false, own: false };
  assert.equal(S('applyEmailSignals')(base, enc.malformed).status, 'flagged');
  assert.equal(S('applyEmailSignals')(Object.assign({}, base, { status: 'trusted' }), enc.malformed).move, false);
  assert.equal(S('applyEmailSignals')(base, [{ weight: 3, text: 'x' }]).status, 'caution');
  assert.equal(S('applyEmailSignals')(base, [{ weight: 2, text: 'x' }]).status, 'clean');
});
test('display names padded with symbols', () => {
  const f = S('displayNameAnomalies');
  assert.equal(f('Fidelity Life •°”˜.•°”˜˜.•°”˜').length, 1);
  assert.equal(f('""""""National Debt Relief""""""').length, 1);
  assert.equal(f('Jane Smith').length, 0);
});

test('a link is safe only when every host the click reaches was checked', async () => {
  const b = loadBackground({});
  vm.runInContext('checkDomainSafety = async (u) => new URL(u).hostname === "wrap.test" ? verdictResult("unknown", { note: "No threat-intelligence resolver could be reached" }) : verdictResult("safe");', b);
  const r = await vm.runInContext('getConfig().then(cfg => assessSafety("https://wrap.test/x", "https://dest.test/", cfg))', b);
  assert.equal(r.verdict, 'unknown');
  const ok = await vm.runInContext('getConfig().then(cfg => assessSafety("https://dest.test/a", "https://dest.test/", cfg))', b);
  assert.equal(ok.verdict, 'safe');
});

test('compactSet answers exactly like a Set (random, unsorted, duplicates, unicode, old unsorted copies)', () => {
  const C = S('compactSet');
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const word = () => Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => 'abcxyz.-_é0Ω'[Math.floor(rnd() * 12)]).join('');
  for (let round = 0; round < 20; round++) {
    const items = Array.from({ length: Math.floor(rnd() * 400) }, word);
    const ref = new Set(items.filter(Boolean));
    for (const c of [C(items), C(items.join('\n')), C([...ref].sort().join('\n')), C([...ref].sort())]) {
      assert.equal(c.size >= ref.size, true);
      for (const w of ref) assert.equal(c.has(w), true, w);
      for (let k = 0; k < 200; k++) { const w = word(); assert.equal(c.has(w), ref.has(w), w); }
      assert.equal(c.has(''), false);
    }
  }
  assert.equal(C([]).has('a'), false); assert.equal(C('').size, 0);
});

test('feeds are stored sorted and looked up through compact lists', async () => {
  const b = loadBackground({ feed_phishingarmy: { updated: Date.now(), count: 3, entries: 'zz-bad.test\nbad.test\nmid.test' } });
  const r = await vm.runInContext('feedHit("https://login.bad.test/x")', b);
  assert.equal(r, 'Phishing Army (extended)');
  assert.equal(await vm.runInContext('feedHit("https://good.test/")', b), null);
  assert.equal(await vm.runInContext('feedHit("https://zz-bad.test/")', b), 'Phishing Army (extended)');
});

test('sender icons: raw bytes in IndexedDB, 404 remembered as none, errors not remembered, old icons moved over', async () => {
  const { IDBFactory } = require('fake-indexeddb');
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
  const png2 = Buffer.from('89504e470d0a1a0a0000000d4948445200000002', 'hex');
  // Google: by ?domain=; DuckDuckGo: by /ip3/<site>.ico
  const google = { 'has-icon.test': [200, 'image/png', png], 'filtered.test': [403, 'text/html', Buffer.from('<html>blocked</html>')], 'huge.test': [200, 'image/png', Buffer.alloc(9000)],
                   'brand.test': [200, 'image/png', png2], 'down.test': [500, 'text/html', Buffer.from('err')] };
  const ddg = { 'ddg-only.test': [200, 'image/png', png2], 'blocked-ddg.test': [403, 'text/html', Buffer.from('<html>blocked</html>')], 'empty.test': [200, 'text/plain', Buffer.alloc(0)] };
  const fetched = [];
  const fetch = async (u) => {
    const url = new URL(u);
    const g = url.hostname === 'www.google.com', d = g ? url.searchParams.get('domain') : decodeURIComponent(url.pathname.replace('/ip3/', '').replace(/\.ico$/, ''));
    fetched.push((g ? 'g:' : 'd:') + d);
    const [status, type, body] = (g ? google : ddg)[d] || [404, 'image/png', png];
    return { status, ok: status >= 200 && status < 300, headers: { get: () => type }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) };
  };
  const count = (k) => fetched.filter(x => x === k).length;
  const legacy = { faviconCache: { 'old.test': { ts: Date.now(), d: 'data:image/png;base64,' + png.toString('base64') }, 'oldnone.test': { ts: Date.now(), d: '' } } };
  const b = loadBackground(legacy, { indexedDB: new IDBFactory(), fetch });
  const run = (code) => vm.runInContext(code, b);
  const url = (buf) => 'data:image/png;base64,' + buf.toString('base64');
  const rec = (site) => run(`iconStore.get(${JSON.stringify(site)})`);

  // The site's own icon, remembered.
  assert.equal(await run('senderIcon("has-icon.test")'), url(png));
  assert.equal(await run('senderIcon("has-icon.test")'), url(png));
  assert.equal(count('g:has-icon.test'), 1);
  assert.equal((await rec('has-icon.test')).source, 'favicon');
  assert.equal((await rec('has-icon.test')).bytes.byteLength, png.length, 'raw bytes, not text');
  // Parent domain's icon as a stand-in.
  assert.equal(await run('senderIcon("alerts.brand.test")'), url(png2));
  const pr = await rec('alerts.brand.test'); assert.equal(pr.source, 'parent'); assert.equal(pr.from, 'brand.test');
  // DuckDuckGo as the last stand-in.
  assert.equal(await run('senderIcon("ddg-only.test")'), url(png2));
  assert.equal((await rec('ddg-only.test')).source, 'duckduckgo');
  // Nothing anywhere: none, remembered (no new requests right away).
  assert.equal(await run('senderIcon("nothing.test")'), ''); await run('senderIcon("nothing.test")');
  assert.equal(count('g:nothing.test') + count('d:nothing.test'), 2);
  assert.equal((await rec('nothing.test')).source, 'none');
  // DuckDuckGo's empty answer means none; DuckDuckGo blocked by a filter: Google's answer is still remembered.
  assert.equal(await run('senderIcon("empty.test")'), '');
  assert.equal(await run('senderIcon("blocked-ddg.test")'), ''); await run('senderIcon("blocked-ddg.test")');
  assert.equal(count('d:blocked-ddg.test'), 1, 'not asked again on every page');
  // Google failing (block page, server error): nothing remembered, asked again.
  assert.equal(await run('senderIcon("filtered.test")'), ''); await run('senderIcon("filtered.test")');
  assert.equal(count('g:filtered.test'), 2);
  assert.equal(await run('senderIcon("down.test")'), '');
  assert.equal(await rec('down.test'), null);
  // Larger than 8 KB and no image tools here (Node): left blank.
  assert.equal(await run('senderIcon("huge.test")'), '');

  // Weekly recheck: the site's own icon replaces a stand-in once it has one.
  const age = (site) => run(`(async () => { const r = await iconStore.get(${JSON.stringify(site)}); const db = await new Promise(res => { const q = indexedDB.open("senderIcons", 1); q.onsuccess = () => res(q.result); }); await new Promise(res => { const tx = db.transaction("icons", "readwrite"); tx.objectStore("icons").put(Object.assign(r, { ts: Date.now() - 8 * 864e5 })); tx.oncomplete = res; }); })()`);
  await age('ddg-only.test');
  google['ddg-only.test'] = [200, 'image/png', png];
  assert.equal(await run('senderIcon("ddg-only.test")'), url(png));
  assert.equal((await rec('ddg-only.test')).source, 'favicon');
  // A recheck never makes it worse: the stand-in stays if the parent loses its icon.
  await age('alerts.brand.test');
  delete google['brand.test'];
  assert.equal(await run('senderIcon("alerts.brand.test")'), url(png2));
  assert.equal((await rec('alerts.brand.test')).source, 'parent');
  // A site's own icon isn't rechecked weekly.
  await age('has-icon.test'); await run('senderIcon("has-icon.test")');
  assert.equal(count('g:has-icon.test'), 1);

  // Stand-ins off: no parent or DuckDuckGo requests, and a DuckDuckGo icon already stored isn't shown.
  const before = fetched.length;
  assert.equal(await run('senderIcon("nothing2.test", { fallback: false })'), '');
  assert.deepEqual(fetched.slice(before), ['g:nothing2.test']);
  ddg['ddg2.test'] = [200, 'image/png', png2];
  assert.equal(await run('senderIcon("ddg2.test")'), url(png2));
  assert.equal(await run('senderIcon("ddg2.test", { fallback: false })'), '');

  // Icons saved by older versions moved over, then the old copy removed.
  assert.equal(await run('senderIcon("old.test")'), url(png));
  assert.equal(await run('senderIcon("oldnone.test")'), '');
  assert.ok(!fetched.includes('g:old.test') && !fetched.includes('g:oldnone.test'));
  assert.equal(b.__store.faviconCache, undefined);
  // Pruning: expired records go.
  await run('(async () => { const db = await new Promise(r => { const q = indexedDB.open("senderIcons", 1); q.onsuccess = () => r(q.result); }); await new Promise(r => { const tx = db.transaction("icons", "readwrite"); tx.objectStore("icons").put({ site: "stale.test", type: "image/png", bytes: new ArrayBuffer(4), source: "favicon", ts: 1 }); tx.oncomplete = r; }); })()');
  assert.equal(await rec('stale.test'), null);
  assert.ok(await run('iconStore.prune()') >= 1);
  const all = await run('iconStore.all()');
  assert.ok(!all.some(r => r.site === 'stale.test') && all.some(r => r.site === 'has-icon.test'));
});

test('sender icons without IndexedDB: still shown, just fetched again', async () => {
  let n = 0;
  const png = Buffer.from('89504e47', 'hex');
  const b = loadBackground({}, { fetch: async () => { n++; return { status: 200, ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.length) }; } });
  assert.match(await vm.runInContext('senderIcon("a.test")', b), /^data:image\/png;base64,/);
  await vm.runInContext('senderIcon("a.test")', b);
  assert.equal(n, 2);
});

test('mail profiles: header lines are trusted only from the receiving system the profile names', () => {
  const raw = 'Received: from e by mx.google.com; Mon, 13 Feb 2023 12:46:47 -0800\nAuthentication-Results: mx.google.com; dmarc=fail (p=REJECT) header.from=paypal.com\nFrom: P <s@paypal.com>\n\nx';
  assert.equal(S('parseAuthResults')(raw, 'mx.google.com').dmarc, 'fail');
  assert.equal(S('parseAuthResults')(raw, undefined), null, 'no receiver known: nothing trusted');
  assert.equal(S('parseAuthResults')(raw, 'mx.other.example'), null, 'another receiver: nothing trusted');
  assert.equal(S('headerAnomalies')(raw, '', {}).length, 0, 'no receiver: no DMARC sign');
  assert.equal(S('deliveringIp')(S('parseRawHeaders')('Received: from a ([1.2.3.4]) by mx.google.com; x\n\n'), 'mx.google.com'), '1.2.3.4');
  assert.equal(S('deliveringIp')(S('parseRawHeaders')('Received: from a ([1.2.3.4]) by mx.google.com; x\n\n'), undefined), null);
  // Every site is in the one table; Gmail is an entry like the others.
  assert.equal(S('webmailSiteFor')('https://mail.google.com/mail/u/0/#inbox').id, 'gmail');
  assert.equal(S('webmailSiteFor')('https://outlook.office.com/mail/').id, 'outlook');
});

test('generic profile and the webmail\'s own warnings', () => {
  const caps = S('mailCapabilities');
  const W = S('WEBMAIL_SITES');
  assert.deepEqual({ ...caps(W.find(w => w.id === 'outlook')) }, { list: 'generic', opened: 'generic', headers: false, move: false, compose: false, avatars: false, attachments: false });
  assert.equal(caps(W.find(w => w.id === 'gmail')).move, true);
  assert.equal(caps({ mail: null }).opened, false);
  const warn = S('serviceWarningSigns');
  assert.equal(warn('This sender failed our fraud detection checks and may not be who they appear to be.', 'Outlook')[0].weight, 5);
  assert.equal(warn('Be careful with this message. The sender hasn\'t authenticated it.', 'Gmail')[0].weight, 3);
  assert.equal(warn('Your invoice is attached. Please pay soon.', 'Gmail').length, 0);
  assert.ok(S('UNREAD_WORDS').test('Unread, from IT Support') && !S('UNREAD_WORDS').test('from Friend, Lunch'));
});

test('sender photos and logos: remembered per address, replaced when changed, shown before the site icon', async () => {
  const { IDBFactory } = require('fake-indexeddb');
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
  const png2 = Buffer.from('89504e470d0a1a0a0000000d4948445200000002', 'hex');
  const fetched = [];
  const body = { 'https://lh3.googleusercontent.com/a/photo1=s40': png, 'https://lh3.googleusercontent.com/a/photo2=s40': png2 };
  const fetch = async (u) => { fetched.push(String(u)); const b = body[u]; return b ? { status: 200, ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) } : { status: 404, ok: false, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(0) }; };
  const b = loadBackground({}, { indexedDB: new IDBFactory(), fetch });
  const run = (c) => vm.runInContext(c, b);
  assert.equal(await run('rememberAvatar({ address: "pat@school.org" }, "https://lh3.googleusercontent.com/a/photo1=s40")'), 'saved');
  assert.equal(await run('avatarFor("pat@school.org", "school.org")'), 'data:image/png;base64,' + png.toString('base64'));
  assert.equal(await run('rememberAvatar({ address: "pat@school.org" }, "https://lh3.googleusercontent.com/a/photo1=s40")'), 'same');
  assert.equal(fetched.length, 1, 'the same photo is not fetched again within a week');
  assert.equal(await run('rememberAvatar({ address: "pat@school.org" }, "https://lh3.googleusercontent.com/a/photo2=s40")'), 'updated');
  assert.equal(await run('avatarFor("pat@school.org", "school.org")'), 'data:image/png;base64,' + png2.toString('base64'));
  assert.equal((await run('iconStore.get("@pat@school.org")')).source, 'avatar-personal');
  assert.equal(await run('rememberAvatar({ address: "x@school.org" }, "https://lh3.googleusercontent.com/a/missing")'), 'failed');
  assert.equal(await run('avatarFor("x@school.org", "school.org")'), '');
  // Only image hosts a webmail entry names for avatars.
  assert.equal(run('avatarHostAllowed("https://lh3.googleusercontent.com/a/x")'), true);
  assert.equal(run('avatarHostAllowed("https://evil.example/a/x")'), false);
});

test('embedded logos: stored directly, fingerprint spots a change; photo host accepts the older address format', async () => {
  const { IDBFactory } = require('fake-indexeddb');
  const fetched = [];
  const b = loadBackground({}, { indexedDB: new IDBFactory(), fetch: async (u) => { fetched.push(u); throw new Error('no network expected'); } });
  const run = (c) => vm.runInContext(c, b);
  const svg = (fill) => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="${fill}"/></svg>`).toString('base64');
  assert.equal(await run(`rememberEmbeddedLogo({ address: "news@bank.example", domain: "bank.example" }, ${JSON.stringify(svg('red'))})`), 'saved');
  assert.equal(await run(`rememberEmbeddedLogo({ address: "news@bank.example", domain: "bank.example" }, ${JSON.stringify(svg('red'))})`), 'same');
  const rec = await run('iconStore.get("logo:bank.example")');
  assert.equal(rec.type, 'image/svg+xml'); assert.equal(rec.source, 'avatar-logo'); assert.match(rec.from, /^embedded:/);
  assert.equal(await run(`rememberEmbeddedLogo({ address: "news@bank.example", domain: "bank.example" }, ${JSON.stringify(svg('blue'))})`), 'updated');
  assert.match(await run('avatarFor("news@bank.example", "bank.example")'), /^data:image\/svg\+xml;base64,/);
  // One logo for the whole company: every address there (and its mail subdomains) gets it.
  assert.match(await run('avatarFor("bob.person@bank.example", "bank.example")'), /^data:image\/svg\+xml;base64,/);
  assert.match(await run('avatarFor("", "mail.bank.example")'), /^data:image\/svg\+xml;base64,/);
  assert.equal(await run('avatarFor("someone@other.example", "other.example")'), '');
  assert.equal(await run(`rememberEmbeddedLogo({ address: "big@bank.example", domain: "bank.example" }, "data:image/svg+xml;base64," + "A".repeat(50000))`), 'unusable');
  assert.equal(await run(`rememberEmbeddedLogo({ address: "x@bank.example", domain: "bank.example" }, "data:text/html;base64,PGI+")`), 'refused');
  assert.equal(fetched.length, 0, 'nothing downloaded for embedded logos');
  assert.equal(run('avatarHostAllowed("https://lh3.googleusercontent.com/-abcDEF/AAAAAAAAAAI/AAAAAAAAAAA/xyz/s40-c/photo.jpg")'), true);
});

test('enum settings accept any spelling and keep the defined value', () => {
  const c = S('coerceSetting'), d = S('SETTING_BY_KEY');
  assert.equal(c(d.customDohMethod, 'post'), 'POST');
  assert.equal(c(d.rowHighlightColor, 'Blue'), 'blue');
  assert.equal(c(d.rowHighlightStyle, 'OUTLINE'), 'outline');
  assert.equal(c(d.rowHighlightColor, 'orange'), undefined);
});

test('shared company mailboxes are told apart from people', () => {
  const b = loadBackground();
  const shared = (a) => vm.runInContext(`isSharedMailbox(${JSON.stringify(a)})`, b);
  for (const a of ['contact@example.org', 'info@example.org', 'support@example.org', 'no-reply@example.org', 'noreply@example.org', 'news.letter@example.org', 'notifications+x@example.org', 'Hello@Example.org'])
    assert.equal(shared(a), true, a);
  for (const a of ['bob@example.org', 'pat.colleague@example.org', 'contactme.bob@example.org', 'informant@example.org', '', 'nobody'])
    assert.equal(shared(a), false, a);
});

test('conflicts: settled only while every overlapping feature still on was kept on purpose', () => {
  const b = loadBackground();
  const settled = (f, k) => vm.runInContext(`conflictSettled(${JSON.stringify(f)}, ${JSON.stringify(k)})`, b);
  assert.equal(settled(['enableTrackingPixelBlocking'], ['enableTrackingPixelBlocking']), true);
  assert.equal(settled(['enableTrackingPixelBlocking', 'enableSenderAvatars'], ['enableTrackingPixelBlocking']), false, 'one turned back on');
  assert.equal(settled(['enableSenderAvatars'], undefined), false, 'never chosen');
  assert.equal(settled([], []), true);
});

test('BIMI logos: DMARC enforced, organization domain only, downloaded or kept by address, unsafe refused', async () => {
  const { IDBFactory } = require('fake-indexeddb');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny-ps" viewBox="0 0 10 10"><title>Brand</title><rect width="10" height="10" fill="#c00"/></svg>';
  const dns = {
    'default._bimi.brand.example': 'v=BIMI1; l=https://logos.brand.example/logo.svg; a=;',
    '_dmarc.brand.example': 'v=DMARC1; p=reject; rua=mailto:dmarc@brand.example',
    'default._bimi.nocors.example': 'v=BIMI1; l=https://vmc.issuer.example/nocors.svg',
    '_dmarc.nocors.example': 'v=DMARC1; p=quarantine',
    'default._bimi.lax.example': 'v=BIMI1; l=https://logos.lax.example/logo.svg',
    '_dmarc.lax.example': 'v=DMARC1; p=none',
    'default._bimi.evil.example': 'v=BIMI1; l=https://logos.evil.example/logo.svg',
    '_dmarc.evil.example': 'v=DMARC1; p=reject'
  };
  const asked = [];
  const fetch = async (u) => {
    u = String(u); asked.push(u);
    const q = /dns-query\?name=([^&]+)&type=TXT/.exec(u);
    if (q) { const name = decodeURIComponent(q[1]); const t = dns[name];
      return { ok: true, status: 200, json: async () => ({ Status: t ? 0 : 3, Answer: t ? [{ type: 16, data: `"${t}"` }] : [] }) }; }
    const body = (s) => ({ ok: true, status: 200, headers: { get: () => 'image/svg+xml' }, arrayBuffer: async () => new TextEncoder().encode(s).buffer });
    if (u === 'https://logos.brand.example/logo.svg') return body(svg);
    if (u === 'https://logos.evil.example/logo.svg') return body(svg.replace('<rect', '<rect onload="alert(1)"'));
    if (u === 'https://vmc.issuer.example/nocors.svg') throw new TypeError('Failed to fetch');      // no CORS
    throw new Error('unexpected ' + u);
  };
  const b = loadBackground({}, { indexedDB: new IDBFactory(), fetch });
  const run = (c) => vm.runInContext(c, b);
  assert.match(await run('bimiLogo("brand.example")'), /^data:image\/svg\+xml;base64,/, 'downloaded and kept');
  assert.equal((await run('iconStore.get("bimi:brand.example")')).source, 'bimi');
  // A subdomain sender: only the organization domain is looked up, never the subdomain.
  asked.length = 0;
  assert.match(await run('bimiLogo("mail.brand.example")'), /^data:image\/svg\+xml/);
  assert.ok(!asked.some(u => /_bimi\.mail\.brand/.test(u)), 'subdomain never looked up');
  assert.equal(asked.length, 0, 'cached: no lookup at all the second time');
  assert.equal(await run('bimiLogo("nocors.example")'), 'https://vmc.issuer.example/nocors.svg', 'no CORS: kept by its address for the page');
  assert.equal(await run('bimiLogo("lax.example")'), '', 'DMARC p=none: no logo');
  assert.equal(await run('bimiLogo("evil.example")'), '', 'event handler in the SVG: refused');
  assert.equal(await run('bimiLogo("nobimi.example")'), '', 'no record');
  assert.equal(await run('bimiLogo("gmail.com")'), '', 'personal email service: never looked up');
  assert.equal((await run('iconStore.get("bimi:nobimi.example")')).source, 'none', 'remembered as none');
});
