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
  // Event stubs keep their listeners, so a test can fire one (chrome.runtime.onInstalled.fire(...)).
  const listeners = () => { const fns = []; return { addListener(f) { fns.push(f); }, fire: (...a) => Promise.all(fns.map(f => f(...a))) }; };
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
    Blob, Response, CompressionStream, DecompressionStream, TextDecoderStream,
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

test('sender domain with no DNS records of its own under an existing organization domain is not "doesn\'t exist"', async () => {
  // Like hello.blink.com: its DNS answers "no such domain" for the name itself (only names below it
  // exist: the bounce address, the DKIM key), while the company's own domain exists.
  const exists = { 'brand.example': '203.0.113.9' };
  const fetch = async (u) => {
    u = String(u);
    if (/[?&]dns=/.test(u)) throw new Error('wire format not simulated');
    const name = decodeURIComponent((/[?&]name=([^&]+)/.exec(u) || [])[1] || '');
    const ip = exists[name];
    return { ok: true, status: 200, json: async () => ip ? { Status: 0, Answer: [{ type: 1, data: ip }] } : { Status: 3 } };
  };
  const b = loadBackground({}, { fetch });
  const run = (c) => vm.runInContext(c, b);
  b.__S = (await run('getConfig()')).values;
  const sub = await run('senderDomainDns("hello.brand.example", __S)');
  assert.ok(!/doesn't exist/.test(sub.note || ''), JSON.stringify(sub));
  assert.equal(sub.verdict, 'safe', 'checked through its organization\'s domain');
  assert.notEqual(S('combineSenderVerdict')({ address: 'team@hello.brand.example', dns: sub }).status, 'flagged', 'not flagged');
  const gone = await run('senderDomainDns("mail.nowhere.example", __S)');
  assert.ok(/doesn't exist/.test(gone.note || ''), 'the organization\'s domain doesn\'t exist either: still "doesn\'t exist"');
  const top = await run('senderDomainDns("nowhere.example", __S)');
  assert.ok(/doesn't exist/.test(top.note || ''), 'an organization domain that doesn\'t exist');
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

test('header signs: delivery records copied from emails to other people, on different days, flag on their own (sample 4)', () => {
  const RX = S('WEBMAIL_SITES').find(w => w.id === 'gmail').mail.headers.receiver;
  const H = (raw) => S('headerAnomalies')(raw, '', RX);
  const score = (raw) => H(raw).reduce((a, x) => a + x.weight, 0);
  const sample = fs.readFileSync(FX + 'scam4.eml', 'utf8');
  const forged = H(sample).find(x => /fake .*delivery record/.test(x.text));
  assert.ok(forged && forged.weight === 5 && /2 other people/.test(forged.text), JSON.stringify(H(sample)));
  assert.ok(score(sample) >= 5, 'flagged');
  // Genuine shapes stay amber at most: an old record from an imported mailbox (one), or two old records
  // written minutes apart (mail forwarded between two old addresses, then imported).
  const top = 'Delivered-To: user@example.org\nReceived: by 2002:a05::1 with SMTP id x; Thu, 7 Nov 2024 11:52:24 -0800 (PST)\nReceived: from a.example by mx.google.com with ESMTPS id q.2024.11.07.11.52.23 for <user@example.org>; Thu, 07 Nov 2024 11:52:24 -0800 (PST)\n';
  const old = (who, when) => `Received: from b.example by mx.google.com with ESMTPS id r for <${who}>; ${when}\n`;
  const end = 'From: A <a@example.com>\nMIME-Version: 1.0\n\nx';
  assert.equal(score(top + old('old-account@example.net', 'Sun, 24 Dec 2023 12:40:28 -0800') + end), 3, 'one old record');
  assert.equal(score(top + old('alias@example.net', 'Sun, 24 Dec 2023 12:40:28 -0800') + old('old-account@example.net', 'Sun, 24 Dec 2023 12:38:02 -0800') + end), 3, 'two, minutes apart');
  assert.equal(score(top + old('user@example.org', 'Sun, 24 Dec 2023 12:40:28 -0800') + old('user@example.org', 'Mon, 08 Jan 2024 11:19:58 -0800') + end), 3, 'two old records for this account itself');
});

test('header signs: DMARC failing a quarantine policy, records forged years earlier, MIME 2.0 (sample 3)', () => {
  const RX = S('WEBMAIL_SITES').find(w => w.id === 'gmail').mail.headers.receiver;
  const H = (raw) => S('headerAnomalies')(raw, '', RX);
  const signs = H(fs.readFileSync(FX + 'scam3.eml', 'utf8'));
  const has = (re, w) => signs.some(x => re.test(x.text) && x.weight === w);
  assert.ok(has(/DMARC.*newsletter-tool\.example.*treated as spam/, 5), 'dmarc quarantine');
  assert.ok(has(/3 fake delivery records copied from emails to 2 other people.*2018, 2019/, 5), 'forged records, copied from emails to two other people');
  assert.ok(has(/MIME version 2\.0/, 2) && has(/mailing-list ID is malformed/, 1));
  assert.ok(signs.reduce((a, x) => a + x.weight, 0) >= 5);
  // Genuine mail is left alone.
  const base = 'Received: by 2002:a05::1 with SMTP id x; Mon, 13 Feb 2023 12:46:47 -0800 (PST)\nAuthentication-Results: mx.google.com; spf=pass smtp.mailfrom=a@school.org; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=school.org\nFrom: A <a@school.org>\n';
  const score = (raw) => H(raw).reduce((a, x) => a + x.weight, 0);
  assert.equal(score(base + 'MIME-Version: 1.0 (Mac OS X Mail 16.0 \\(3731.500.231\\))\nContent-Transfer-Encoding: 7BIT\n\nx'), 0, 'Apple Mail');
  assert.equal(score(base + 'Received: from a by b; Fri, 10 Feb 2023 12:00:00 -0800\nMIME-Version: 1.0\n\nx'), 0, 'mail retried for 3 days');
  // A genuine mailing list breaking DMARC: only a strong sign (caution), never a flag on its own.
  assert.equal(score(base.replace('dmarc=pass', 'dmarc=fail') + 'List-ID: <staff.lists.school.org>\n\nx'), 3);
  assert.equal(score(base.replace('dmarc=pass (p=REJECT', 'dmarc=fail (p=NONE') + '\nx'), 3);   // a failure is at least amber (5.61)
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
  assert.deepEqual({ ...caps(W.find(w => w.id === 'outlook')) }, { list: 'generic', opened: 'generic', headers: false, move: false, compose: false, avatars: false, account: false, attachments: false });
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
  // Logos are never downloaded here (most logo servers don't allow it, and each refusal is an error in
  // the browser's extension log): the inbox page shows them by their address, as pictures, which can't
  // run scripts.
  assert.equal(await run('bimiLogo("brand.example")'), 'https://logos.brand.example/logo.svg', 'kept by its address for the page');
  assert.equal((await run('iconStore.get("bimi:brand.example")')).source, 'bimi');
  // A subdomain sender: only the organization domain is looked up, never the subdomain.
  asked.length = 0;
  assert.equal(await run('bimiLogo("mail.brand.example")'), 'https://logos.brand.example/logo.svg');
  assert.ok(!asked.some(u => /_bimi\.mail\.brand/.test(u)), 'subdomain never looked up');
  assert.equal(asked.length, 0, 'cached: no lookup at all the second time');
  assert.equal(await run('bimiLogo("nocors.example")'), 'https://vmc.issuer.example/nocors.svg', 'a server that allows no download: same');
  assert.equal(await run('bimiLogo("lax.example")'), '', 'DMARC p=none: no logo');
  assert.equal(await run('bimiLogo("evil.example")'), 'https://logos.evil.example/logo.svg', 'shown as a picture, so its scripts never run');
  assert.ok(!asked.some(u => /\.svg$/.test(u)), 'no logo was ever fetched by the extension');
  assert.equal(await run('bimiLogo("nobimi.example")'), '', 'no record');
  assert.equal(await run('bimiLogo("gmail.com")'), '', 'personal email service: never looked up');
  assert.equal((await run('iconStore.get("bimi:nobimi.example")')).source, 'none', 'remembered as none');
});

test('initials: letter from the name (else the address), steady color per sender, readable white text', () => {
  const b = loadBackground();
  const run = (c) => vm.runInContext(c, b);
  assert.equal(run('senderInitial("Olivia Example", "x@example.org")'), 'O');
  assert.equal(run('senderInitial("\\"  (Billing) Team", "x@example.org")'), 'B', 'punctuation skipped');
  assert.equal(run('senderInitial("", "zoe@example.org")'), 'Z', 'no name: the address');
  assert.equal(run('senderInitial("élodie", "")'), 'É', 'accented letters kept');
  assert.equal(run('senderInitial("", "")'), '');
  assert.equal(run('initialColor("a@example.org")'), run('initialColor("A@Example.org")'), 'same sender, same color');
  const colors = run('INITIAL_COLORS');
  const lum = (h) => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  for (const h of colors) assert.ok(1.05 / (lum(h) + 0.05) >= 4.5, `${h} too light for white text`);
  const used = new Set(Array.from({ length: 200 }, (_, i) => run(`initialColor("user${i}@example.org")`)));
  assert.equal(used.size, colors.length, 'senders spread over all colors');
});

test('icon contrast: a dark icon gets a light circle on the dark theme and the reverse; others keep their tint', () => {
  const size = 32;
  // An icon: `paint(x, y)` gives a pixel's [r, g, b, a] (or null for see-through).
  const icon = (paint) => { const d = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const c = paint(x, y); if (c) d.set(c.length === 4 ? c : [...c, 255], (y * size + x) * 4); }
    return S('iconPixelLook')(d, size); };
  const ring = (inside, edge) => (x, y) => { const r = Math.hypot(x - 15.5, y - 15.5); return r < 9 ? inside : r < 14 ? edge : null; };
  const lum = (c) => S('relativeLuminance')(c), cr = (a, b) => S('contrastRatio')(lum(a), lum(b));
  const circle = (look, dark) => S('iconCircleColor')(look, dark);
  const DARK = [32, 33, 36], WHITE = [255, 255, 255];
  // A black glyph with nothing behind it (as in the reported inbox): unreadable on the dark tint.
  const black = icon(ring(null, [0, 0, 0]));
  assert.ok(black.seeThrough && black.edge.length > 0);
  assert.ok(cr(circle(black, true), [0, 0, 0]) >= 3, 'dark theme: black icon on a light circle');
  assert.ok(lum(circle(black, false)) > 0.5, 'light theme: it keeps its light circle');
  // A white glyph: the mirror case.
  const white = icon(ring(null, [255, 255, 255]));
  assert.equal(white.tint, null, 'a white icon has no tint of its own');
  assert.ok(cr(circle(white, false), WHITE) >= 3, 'light theme: white icon on a dark circle');
  assert.ok(lum(circle(white, true)) < 0.1, 'dark theme: it keeps its dark circle');
  // A colored logo on its own white disc (like Google's G): fine on a light circle although the disc blends in.
  const onDisc = icon((x, y) => { const r = Math.hypot(x - 15.5, y - 15.5); return r >= 15 ? null : (r > 5 && r < 9 ? [66, 133, 244] : [255, 255, 255]); });
  assert.ok(lum(circle(onDisc, false)) > 0.5, 'light theme: a logo on its own white disc keeps the light circle');
  // A mid-blue icon shows on both: the theme's own tint either way.
  const blue = icon(ring([25, 103, 210], [25, 103, 210]));
  assert.deepEqual(circle(blue, true), S('iconTintOver')(blue.tint, true));
  assert.deepEqual(circle(blue, false), S('iconTintOver')(blue.tint, false));
  // A solid icon (its own square background) always keeps the theme's tint.
  const solidBlack = icon(() => [0, 0, 0]);
  assert.ok(!solidBlack.seeThrough);
  assert.deepEqual(circle(solidBlack, true), S('iconTintOver')(solidBlack.tint, true));
  // Inline beside the flag: a plate only when needed.
  const plate = (look, surface) => S('contrastingBackground')(look, surface, [S('iconTintOver')(look.tint, !(surface === DARK)), S('ICON_MID_GREY')]);
  assert.notEqual(plate(black, DARK), DARK, 'black icon on a dark row: a plate');
  assert.equal(plate(black, WHITE), WHITE, 'black icon on a light row: none');
  assert.equal(plate(blue, DARK), DARK, 'blue icon on a dark row: none');
  assert.equal(S('contrastingBackground')(null, DARK, [WHITE]), DARK, 'an icon that couldn\'t be read: unchanged');
});

test('DMARC: failures always get at least amber; pictures only for domains that enforce DMARC', async () => {
  const RX = S('WEBMAIL_SITES').find(w => w.id === 'gmail').mail.headers.receiver;
  const raw = (policy, extra = '') => `Received: from mail.sender.example by mx.google.com; Mon, 13 Feb 2023 12:46:46 -0800\nAuthentication-Results: mx.google.com; dkim=none; spf=fail; dmarc=fail (p=${policy} sp=${policy} dis=NONE) header.from=sender.example\n${extra}From: A <a@sender.example>\nMIME-Version: 1.0\n\nx`;
  const dmarcWeight = (r) => (S('headerAnomalies')(r, '', RX).find(x => /DMARC/.test(x.text)) || {}).weight;
  assert.equal(dmarcWeight(raw('NONE')), 3, 'p=none failure: amber (caution)');
  assert.equal(dmarcWeight(raw('NONE', 'List-ID: Team news <news.lists.sender-list.org>\n')), 2, 'real mailing list: weak sign only');
  assert.equal(dmarcWeight(raw('REJECT')), 5, 'p=reject failure: red');
  const { IDBFactory } = require('fake-indexeddb');
  const dns = { '_dmarc.full.example': 'v=DMARC1;p=reject;sp=none', '_dmarc.half.example': 'v=DMARC1; p=quarantine; pct=50', '_dmarc.watch.example': 'v=DMARC1; p=none' };
  const fetch = async (u) => { const q = /name=([^&]+)&type=TXT/.exec(String(u)); const t = q && dns[decodeURIComponent(q[1])];
    return { ok: true, status: 200, json: async () => ({ Status: t ? 0 : 3, Answer: t ? [{ type: 16, data: `"${t}"` }] : [] }) }; };
  const b = loadBackground({}, { indexedDB: new IDBFactory(), fetch });
  const run = (c) => vm.runInContext(c, b);
  assert.equal(await run('dmarcEnforced("full.example")'), true, 'p=reject');
  assert.equal(await run('dmarcEnforced("mail.full.example")'), false, 'subdomain with sp=none: not enforced');
  assert.equal(await run('dmarcEnforced("half.example")'), false, 'pct=50: not enforced');
  assert.equal(await run('dmarcEnforced("watch.example")'), false, 'p=none: not enforced');
  assert.equal(await run('dmarcEnforced("none.example")'), false, 'no DMARC record');
});

test('registrable domains: US school and locality domains, UK school domains', () => {
  const r = (h) => S('registrableDomain')(h);
  assert.equal(r('mail.example.k12.fl.us'), 'example.k12.fl.us', 'a school district is its own domain');
  assert.equal(r('example.k12.fl.us'), 'example.k12.fl.us');
  assert.equal(r('ci.example.fl.us'), 'example.fl.us', 'a city under a state');
  assert.equal(r('school.pvt.k12.ma.us'), 'school.pvt.k12.ma.us');
  assert.equal(r('library.lib.tx.us'), 'library.lib.tx.us');
  assert.equal(r('stmarys.sch.uk'), 'stmarys.sch.uk');
  assert.equal(r('news.example.co.uk'), 'example.co.uk');
  assert.equal(r('a.b.example.org'), 'example.org');
});

test('popular sites: Chrome UX Report list read as a stream and stopped at the top N; Tranco parsed', async () => {
  const zlib = require('zlib');
  const rows = ['origin,rank'];
  for (let i = 0; i < 50; i++) rows.push(`https://www.site${i}.example,1000`, `https://m.site${i}.example,1000`);
  rows.push('https://later.example,5000');
  const gz = zlib.gzipSync(rows.join('\n') + '\n');
  const b = loadBackground({}, { DecompressionStream, TextDecoderStream, Blob });
  vm.runInContext('globalThis.__stream = (buf) => new Blob([buf]).stream()', b);
  b.__gz = gz;
  const all = await vm.runInContext('readPopularDomains(__stream(__gz), 1000)', b);
  assert.equal(all.size, 51, 'www. and m. of the same site count once; registrable domains');
  const top = await vm.runInContext('readPopularDomains(__stream(__gz), 10)', b);
  assert.equal(top.size, 5, 'stops after the top rows');
  const tr = vm.runInContext('parseTrancoList("1,google.com\\n2,mail.example.co.uk\\n3,not a domain\\n")', b);
  assert.deepEqual([...tr].sort(), ['example.co.uk', 'google.com']);
});

test('look-alike senders: strong imitations, young near-misses, protected only when DMARC is enforced', async () => {
  const { IDBFactory } = require('fake-indexeddb');
  const url = require('url');
  const day = 86400000, now = Date.now();
  const dmarc = { '_dmarc.brandsite.example': 'v=DMARC1; p=reject', '_dmarc.mirrorsite.example': 'v=DMARC1; p=none' };
  const created = { 'brandsitte.example': now - 10 * day, 'brandsitee.example': now - 2000 * day, 'mirrorsitte.example': now - 5 * day, 'amazom.example': now - 3000 * day,
    'brandsite-help.example': now - 4000 * day, 'brandsite-billing.example': now - 10 * day, 'vendorco-payment.example': now - 3 * day };
  const fetch = async (u) => {
    u = String(u);
    const q = /dns-query\?name=([^&]+)&type=TXT/.exec(u);
    if (q) { const t = dmarc[decodeURIComponent(q[1])]; return { ok: true, status: 200, json: async () => ({ Status: t ? 0 : 3, Answer: t ? [{ type: 16, data: `"${t}"` }] : [] }) }; }
    if (u === 'https://data.iana.org/rdap/dns.json') return { ok: true, status: 200, json: async () => ({ services: [[['example'], ['https://rdap.registry.example/']]] }) };
    const d = /\/domain\/([^/?]+)$/.exec(u);
    if (d) { const c = created[decodeURIComponent(d[1])]; return c ? { ok: true, status: 200, json: async () => ({ events: [{ eventAction: 'registration', eventDate: new Date(c).toISOString() }] }) } : { ok: false, status: 404, json: async () => ({}) }; }
    throw new Error('unexpected ' + u);
  };
  const b = loadBackground({ popularDomains: { updated: now, entries: ['brandsite.example', 'mirrorsite.example'].join('\n') }, verifiedDomains: { 'vendorco.example': now } },
    { indexedDB: new IDBFactory(), fetch });
  const v = async (d, own = '') => { const r = await vm.runInContext(`lookalikeVerdict(${JSON.stringify(d)}, ${JSON.stringify(own)}, { enableDnsThreatCheck: true })`, b); return r && r.level; };
  // Strong, whatever the age.
  assert.equal(await v('paypal-billing.com'), 'strong', 'a built-in brand plus a scare word');
  assert.equal(await v(url.domainToASCII('pаypal.com')), 'strong', 'a Cyrillic letter (punycode)');
  assert.equal(await v('paypal.com.verify-acct.net'), 'strong', 'a brand domain worn at the start');
  assert.equal(await v('example-k12.org', 'example.k12.fl.us'), 'strong', 'your organization run together');
  assert.equal(await v('example.k12.f1.us', 'example.k12.fl.us'), 'strong', 'your organization one letter off');
  // Near: by age.
  assert.equal(await v('brandsitte.example'), 'strong', 'one letter off a popular domain, 10 days old');
  assert.equal(await v('brandsitee.example'), null, 'one letter off, but years old (real companies with similar names)');
  assert.equal(await v('mirrorsitte.example'), null, 'a popular domain that doesn\'t enforce DMARC is not protected');
  assert.equal(await v('amazom.example'), 'caution', 'a built-in brand one letter off, old: amber');
  assert.equal(await v('vendorc.example'), null, 'learned domain one letter off, unknown age: nothing');
  // A popular or learned name plus a scare word: by age too (their names are often ordinary words, like
  // "simple" in simple-help.com); a built-in brand plus a scare word stays strong at any age.
  assert.equal(await v('brandsite-help.example'), null, 'popular name plus "help", registered years ago: a real company');
  assert.equal(await v('brandsite-support.example'), null, 'popular name plus a scare word, unknown age: nothing');
  assert.equal(await v('brandsite-billing.example'), 'strong', 'popular name plus a scare word, 10 days old');
  assert.equal(await v('vendorco-payment.example'), 'strong', 'a learned name plus a scare word, 3 days old');
  // The real ones never match.
  assert.equal(await v('brandsite.example'), null);
  assert.equal(await v('paypal.com'), null);
  assert.equal(await v('vendorco.example'), null, 'a learned domain isn\'t its own look-alike');
  assert.equal(await v('example.k12.fl.us', 'example.k12.fl.us'), null);
  assert.equal(await v('gmail.com'), null);
});

test('an update re-judges senders: verdicts cached by the previous version are dropped', async () => {
  const b = loadBackground();
  const run = (c) => vm.runInContext(c, b);
  await run('senderResultCache.set("someone@example.org|||", { r: { status: "flagged" } })');
  assert.ok(await run('senderResultCache.get("someone@example.org|||")'), 'cached');
  await run('chrome.runtime.onInstalled.fire({ reason: "chrome_update" })');
  assert.ok(await run('senderResultCache.get("someone@example.org|||")'), 'a browser update keeps it');
  await run('chrome.runtime.onInstalled.fire({ reason: "update", previousVersion: "5.63" })');
  assert.equal(await run('senderResultCache.get("someone@example.org|||")'), null, 'an extension update drops it');
});

test('name and address: a brand\'s name elsewhere is red; a colleague\'s name outside is amber; hashes only', () => {
  const b = loadBackground();
  const run = (c) => vm.runInContext(c, b);
  assert.equal(run('colleagueNameHash("Smith, John")'), run('colleagueNameHash("John Smith")'), 'word order doesn\'t matter');
  assert.equal(run('colleagueNameHash("John Smith (Superintendent)")'), run('colleagueNameHash("john  SMITH")'), 'brackets and case ignored');
  assert.equal(run('colleagueNameHash("Admin")'), '', 'one-word names are not kept');
  assert.ok(!run('colleagueNameHash("John Smith")').includes('john'), 'a hash, not the name');
  run('globalThis.__col = new Set([colleagueNameHash("Pat Colleague")])');
  const signs = (name, addr) => run(`nameAddressSigns(${JSON.stringify(name)}, ${JSON.stringify(addr)}, "school.org", __col)`).map(x => x.weight);
  assert.deepEqual(signs('PayPal Service', 'help@random-shop.example'), [5], 'brand name on another address: red');
  assert.deepEqual(signs('PayPal', 'service@paypal.com'), [], 'the brand itself');
  assert.deepEqual(signs('Pat Colleague', 'pat.personal@gmail.com'), [3], 'a colleague\'s name outside: amber');
  assert.deepEqual(signs('Pat Colleague', 'pat.colleague@school.org'), [], 'the colleague themself');
  assert.deepEqual(signs('Someone Else', 'someone@gmail.com'), []);
});

test('own name: a sender named as your own address or mailbox name, on someone else\'s address, is red (sample 5)', () => {
  const own = (name, addr, me = 'sampleuser@example.org') => S('ownNameSigns')(name, addr, me).map(x => x.weight);
  // The cloud-storage scam found in Spam: "sampleuser" <random@…> to sampleuser@example.org.
  const raw = fs.readFileSync(FX + 'scam5.eml', 'utf8');
  const from = /^From: (.*) <([^>]+)>/m.exec(raw);
  assert.deepEqual(own(from[1], from[2]), [5], 'the sample: red without opening');
  assert.ok(/your own mailbox name/.test(S('ownNameSigns')(from[1], from[2], 'sampleuser@example.org')[0].text));
  assert.deepEqual(own('sampleuser@example.org', 'alerts@random.example'), [5], 'the whole address as the name');
  assert.deepEqual(own('"SampleUser@Example.org"', 'alerts@random.example'), [5], 'the address in any case, in quotes');
  // Left alone: a real person's name, written their own way; a name that only contains it; the user's
  // own address; an address containing the mailbox name (their other account); the organization's own
  // senders; shared mailbox names; very short ones.
  assert.deepEqual(own('Sampleuser', 'someone@random.example'), [], 'at an organization, a name written as a name');
  assert.deepEqual(own('sampleuser via Forms', 'forms@random.example'), [], 'only contains it');
  assert.deepEqual(own('sampleuser', 'sampleuser@example.org'), [], 'the user');
  assert.deepEqual(own('sampleuser', 'sampleuser@other-mail.example'), [], 'same mailbox elsewhere');
  assert.deepEqual(own('sampleuser', 'sampleuser.work@other-mail.example'), [], 'contains it');
  assert.deepEqual(own('sampleuser', 'helpdesk@example.org', 'sampleuser@example.org'), [], 'own organization');
  assert.deepEqual(own('sampleuser', 'helpdesk@it.example.org', 'sampleuser@example.org'), [], 'own organization\'s subdomain');
  assert.deepEqual(own('sample_user', 'x@gmail.com', 'sample_user@gmail.com'), [5], 'a personal domain is no organization');
  assert.deepEqual(own('office', 'noreply@vendor.example', 'office@example.org'), [], 'shared mailbox name');
  assert.deepEqual(own('pat', 'noreply@vendor.example', 'pat@example.org'), [], 'too short');
  assert.deepEqual(own('sampleuser', 'x@random.example', ''), [], 'account unknown');
  // On a big provider the mailbox name is nobody's real name, so it counts in any case (sample 8).
  const raw8 = fs.readFileSync(FX + 'scam8.eml', 'utf8');
  const from8 = /^from: (.*) <([^>]+)>/mi.exec(raw8);
  assert.deepEqual(own(from8[1], from8[2], 'sample_user@gmail.com'), [5], 'sample 8: "Sample_user" to sample_user@gmail.com');
  assert.deepEqual(own('SAMPLE_USER', 'x@random.example', 'sample_user@gmail.com'), [5], 'any case');
  // Its headers: two different Content-Length sizes.
  const RX = S('WEBMAIL_SITES').find(w => w.id === 'gmail').mail.headers.receiver;
  const signs = S('headerAnomalies')(raw, 'sampleuser@example.org', RX);
  assert.ok(signs.some(x => /repeat Content-Length/.test(x.text) && x.weight === 2), JSON.stringify(signs));
  const same = 'From: A <a@example.com>\nContent-Length: 41\nContent-Length: 41\nMIME-Version: 1.0\n\nx';
  assert.ok(!S('headerAnomalies')(same, '', RX).some(x => /Content-Length/.test(x.text)), 'the same size twice is left alone');
});

test('header signs: four scams Gmail put in Spam are flagged (samples 6-9); genuine shapes are left alone', () => {
  const RX = S('WEBMAIL_SITES').find(w => w.id === 'gmail').mail.headers.receiver;
  const H = (raw) => S('headerAnomalies')(raw, 'sample_user@gmail.com', RX);
  const sum = (signs) => signs.reduce((a, x) => a + x.weight, 0);
  const has = (signs, re, w) => signs.some(x => re.test(x.text) && x.weight === w);
  // 6: a "Fidelity Life" offer: invisible padding in the name, page code in the Bcc line, a reply to an address.
  const s6 = H(fs.readFileSync(FX + 'scam6.eml', 'utf8'));
  assert.ok(has(s6, /padded with invisible characters/, 3) && has(s6, /address lines contain web-page code/, 3) && has(s6, /In-Reply-To/, 2), JSON.stringify(s6));
  assert.ok(has(s6, /3 unrelated email services.*cPanel/, 3) && sum(s6) >= 5);
  // 7: a casino ad: a fake gmail.com signature, DMARC failed, a random tail on the subject.
  const s7 = H(fs.readFileSync(FX + 'scam7.eml', 'utf8'));
  assert.ok(has(s7, /fake gmail\.com signature/, 3) && has(s7, /subject ends in filler and random letters/, 2) && sum(s7) >= 5, JSON.stringify(s7));
  // 9: an IPTV ad: already marked as spam by the sender's own provider; unsubscribe link on 127.0.0.1.
  const s9 = H(fs.readFileSync(FX + 'scam9.eml', 'utf8'));
  assert.ok(has(s9, /already marked it as spam/, 3) && has(s9, /127\.0\.0\.1/, 3) && sum(s9) >= 5, JSON.stringify(s9));
  // Genuine shapes: a developer's mail quoting localhost links, ellipses in a subject, RTL marks and
  // one zero-width space in a name, a reply with a real Message-ID, a missing key for a company's own signature.
  const top = 'Delivered-To: user@example.org\nReceived: from a.example by mx.google.com with ESMTPS id q for <user@example.org>; Thu, 07 Nov 2024 11:52:24 -0800 (PST)\n';
  const g = (hdrs, body = 'x') => sum(H(top + hdrs + 'MIME-Version: 1.0\n\n' + body));
  assert.equal(g('From: Dev <dev@example.com>\nSubject: Bug in login\n', 'Steps: open http://localhost:3000/login and <a href="http://127.0.0.1:8080/">this</a>'), 0, 'localhost links quoted in a bug report');
  assert.equal(g('From: Shop <news@shop.example>\nSubject: Wait for it.... tomorrow\n'), 0, 'ellipsis');
  assert.equal(g('From: Shop <news@shop.example>\nSubject: Sale ---- weekend\n'), 0, 'dashes');
  assert.equal(g('From: =?UTF-8?B?4oCP16nXqNeUIOKAjw==?= <s@example.co.il>\nSubject: hi\n'), 0, 'RTL marks');
  assert.equal(g('From: Pat​ Doe <pat@example.com>\nSubject: hi\nIn-Reply-To: <abc@mail.example.com>\n'), 0, 'one zero-width space; a real reply');
  assert.equal(g('From: A <a@example.com>\nSubject: hi\nAuthentication-Results: mx.google.com; dkim=permerror (no key for signature) header.i=@example.com header.s=old; spf=pass\n'), 0, 'a company\'s own missing key');
  assert.equal(g('From: A <a@example.com>\nSubject: hi\nX-Spam-Flag: NO\nList-Unsubscribe: <https://example.com/unsub>\n'), 0, 'X-Spam-Flag: NO');
});

test('moving: search results (not in Spam, Trash, Sent, Drafts or everywhere) only when allowed', () => {
  const views = S('WEBMAIL_SITES').find(w => w.id === 'gmail').mail.views;
  const f = (h, search = true) => S('viewAllowsAutoSpam')(h, views, search);
  for (const ok of ['#search/invoice', '#search/from%3Abilling+invoice', '#search/invoice/FMfcgz', '#search/in%3Aall+offer', '#advanced-search/from=a&subset=all&query=x'])
    assert.equal(f(ok), true, ok);
  for (const no of ['#search/in%3Aspam+x', '#search/in:trash x', '#search/in%3Aanywhere+x', '#search/in%3Asent', '#search/is%3Adrafts', '#search/in%3Achats+x',
                    '#advanced-search/subset=spam&query=x', '#search/', '#label/x', '#all', '#trash'])
    assert.equal(f(no), false, no);
  assert.equal(f('#search/invoice', false), false, 'switched off');
  assert.equal(f('#inbox', false), true, 'the inbox either way');
});

test('"call this number" scams: subject strong with the scam wording, body a caution; OneDrive is Microsoft\'s (sample 10)', () => {
  const sub = (t) => S('subjectScamSigns')(t).map(x => x.weight);
  const raw = fs.readFileSync(FX + 'scam10.eml', 'utf8');
  const subject = S('decodeEncodedWords')(S('parseRawHeaders')(raw).find(([n]) => n === 'subject')[1]);
  assert.deepEqual(sub(subject), [5, 2], 'sample 10: a genuine Microsoft email with scam text and look-alike letters');
  assert.ok(S('SCAM_PHONE_RE').test('at 1(555)010-0188.') && S('SCAM_PHONE_RE').test('+1 (555) 010-0177') && S('SCAM_PHONE_RE').test('555-010-0100'), 'phone formats');
  assert.deepEqual(sub('PayPal: you were charged $499.00, call 1-555-010-0101 to dispute'), [5]);
  assert.deepEqual(sub('Your order is ready - call (555) 010-0123 to pick it up'), [3], 'a shop\'s number: caution');
  assert.deepEqual(sub('Your receipt from Example Store #1234'), []);
  assert.deepEqual(sub('Meeting at 10:30 re: invoice 555-0100'), [], 'no phone number');
  const body = (t) => S('bodyScamSigns')(t).map(x => x.weight);
  assert.deepEqual(body('If you did not make this purchase of $499.99, call 1 (555) 010-0123 now to cancel.'), [3]);
  assert.deepEqual(body('Thank you for your order. Questions? Call 1-800-555-0100.'), [], 'a receipt with a support number');
  assert.deepEqual(body('Fraud alert: if you did not make this purchase, call the number on the back of your card.'), [], 'a bank alert without a number');
  // A genuine OneDrive email ("OneDrive" <photos@onedrive.com>) was flagged as a brand name on another address.
  assert.deepEqual(S('nameAddressSigns')('OneDrive', 'photos@onedrive.com', '', new Set()), [], 'onedrive.com is Microsoft\'s');
  assert.equal(S('evaluateSender')({ displayName: 'OneDrive', address: 'photos@onedrive.com' }).findings.length, 0);
  assert.deepEqual(S('nameAddressSigns')('OneDrive', 'photos@onedrive-share.example', '', new Set()).map(x => x.weight), [5], 'still red elsewhere');
});

test('list storage: compressed, each entry once; old plain copies still read; a failed list keeps its domains', async () => {
  const b = loadBackground();
  const run = (c) => vm.runInContext(c, b);
  const text = Array.from({ length: 5000 }, (_, i) => `domain${i}.example`).sort().join('\n');
  b.__t = text;
  const packed = await run('packText(__t)');
  assert.ok(packed.length < text.length / 3, `compressed: ${packed.length} vs ${text.length}`);
  b.__p = packed;
  assert.equal(await run('unpackText(__p)'), text, 'round trip');
  // A phishing list stored compressed is looked up like a plain one.
  const b2 = loadBackground({ feed_phishingarmy: { updated: Date.now(), count: 3, gz: await run('packText("bad.test\\nmid.test\\nzz-bad.test")') } });
  assert.ok(await vm.runInContext('feedHit("https://login.bad.test/x")', b2), 'compressed list matched');
  // Popular sites: each domain once with its sources; a list that fails keeps its previous domains.
  const now = Date.now();
  const cruxDomains = Array.from({ length: 3500 }, (_, i) => `c${i}.example`), shared = Array.from({ length: 100 }, (_, i) => `both${i}.example`);
  const trancoDomains = Array.from({ length: 3500 }, (_, i) => `t${i}.example`);
  const zlib = require('zlib');
  const csv = ['origin,rank', ...[...cruxDomains, ...shared].map(d => `https://www.${d},1000`)].join('\n');
  let trancoUp = true;
  const fetch = async (u) => {
    u = String(u);
    if (u.includes('crux-top-lists')) return { ok: true, status: 200, body: new Blob([zlib.gzipSync(csv)]).stream() };
    if (u.endsWith('/top-1m-id')) { if (!trancoUp) throw new Error('down'); return { ok: true, status: 200, text: async () => 'ABC12' }; }
    if (u.includes('tranco-list.eu/download/')) return { ok: true, status: 200, text: async () => [...trancoDomains, ...shared].map((d, i) => `${i + 1},${d}`).join('\n') };
    throw new Error('unexpected ' + u);
  };
  const b3 = loadBackground({}, { fetch, indexedDB: new (require('fake-indexeddb').IDBFactory)() });
  const r1 = await vm.runInContext('syncPopularDomains(true)', b3);
  assert.equal(r1.count, 7100, 'the shared domains are stored once');
  const stored = await vm.runInContext('chrome.storage.local.get("popularDomains")', b3);
  assert.ok(stored.popularDomains.gz && !stored.popularDomains.entries, 'stored compressed only');
  const m1 = await vm.runInContext('(async () => readPopularList((await chrome.storage.local.get("popularDomains")).popularDomains))()', b3);
  assert.equal(m1.get('both0.example'), 3); assert.equal(m1.get('c0.example'), 1); assert.equal(m1.get('t0.example'), 2);
  trancoUp = false;
  const r2 = await vm.runInContext('syncPopularDomains(true)', b3);
  assert.equal(r2.count, 7100, 'Tranco failed: its previous domains are kept');
});
