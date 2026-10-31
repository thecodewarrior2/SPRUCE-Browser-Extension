const fs = require('fs');
const { launch, servePage, waitFor, until, settled, check, done } = require('./harness');
const FX = __dirname + '/../fixtures/';
const scam1 = fs.readFileSync(FX + 'scam1.eml', 'utf8');
const legit = fs.readFileSync(FX + 'legit.eml', 'utf8');
const scam3 = fs.readFileSync(FX + 'scam3.eml', 'utf8');
// Message ids: the list rows use legacy hex (t*7); the thread page uses msg-f:3001.
const rowMsg = (t) => `msg-f:${t * 7 + 0x10000000}`;
global.RAW_MESSAGES = {
  'msg-f:3001': scam1,
  [rowMsg(5002)]: scam1.replace(/^From: .*$/m, 'From: National Debt Relief <contact@relief-sample.example>'),
  [rowMsg(5004)]: legit,
  [rowMsg(5005)]: scam3
};
(async () => {
  const { ctx, sw } = await launch();
  const set = (o) => sw.evaluate(async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }, o);

  // 1. The opened scam (sample 1): its sender alone looks fine, but its headers are forged and every link
  //    is a cloud-storage phishing page. Opened from the inbox: flagged and moved.
  await servePage(ctx, 'fake-gmail-thread.html');
  await set({ enableDnsThreatCheck: false });
  let page = await ctx.newPage();
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto('https://mail.google.com/mail/u/0/?links=cloud&from=' + encodeURIComponent('contact_support.adi@=?UTF-8?B?cmVsaWVmLXNhbXBsZS5leGFtcGxl?=') + '&name=' + encodeURIComponent('"""National Debt Relief"""') + '#label/x/abc');
  let r = await until(() => page.evaluate(() => ({ chip: (document.querySelector('.unshortener-sender-address') || {}).textContent, status: (document.querySelector('.unshortener-sender-address') || { dataset: {} }).dataset.status, title: (document.querySelector('.unshortener-sender-address') || {}).title,
    banner: (document.querySelector('.unshortener-email-banner') || {}).textContent || '', danger: [...document.querySelectorAll('.ii.gt a')].filter(a => a.dataset.unshortened === 'true').length })),
    r => r.status === 'flagged' && /This email is flagged/.test(r.banner) && /links? (is|are) flagged/.test(r.title || ''));
  console.log(r);
  check('sample 1: the encoded address\'s label names the decoded domain', /relief-sample\.example/.test(r.title || ''), r.title);
  check('sample 1 opened: flagged (no more "checked" next to red links)', r.status === 'flagged', r.status);
  check('sample 1: reasons name the forged headers and the dangerous links', /fake Gmail delivery/.test(r.title) && /links? (is|are) flagged/.test(r.title) && /encoded/.test(r.title), r.title);
  check('sample 1: email banner says it is flagged', /This email is flagged/.test(r.banner), r.banner.slice(0, 200));
  await page.close();
  page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/?links=cloud&t=2010&from=' + encodeURIComponent('contact_support.adi@=?UTF-8?B?cmVsaWVmLXNhbXBsZS5leGFtcGxl?=') + '#inbox/abc');
  r = await until(() => page.evaluate(() => window.__spammed), r => r.length >= 1);
  check('sample 1 opened from the inbox: moved to Spam', r.length === 1, r);
  await page.close();

  // 2. Inbox list: sample 2 (103-character local part) unread → flagged from the address alone and moved;
  //    a READ row whose headers are forged (sample 1 with a normal-looking address) → flagged and moved;
  //    gmail.com friend and a normal newsletter → not.
  await ctx.unroute('https://mail.google.com/**');
  await servePage(ctx, 'fake-gmail-list.html');
  await set({ enableDnsThreatCheck: false, customTrustedSenders: ['friend@gmail.com'] });
  page = await ctx.newPage();
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto('https://mail.google.com/mail/u/0/?set=r2#label/x');
  r = await until(() => page.evaluate(() => [...document.querySelectorAll('tr.zA')].map(tr => { const c = tr.querySelector('.unshortener-sender-chip'); return [tr.querySelector('[data-thread-id]').getAttribute('data-thread-id'), c && c.dataset.status, c && c.textContent, c && c.title]; })),
    rows => rows.length >= 5 && rows.every(x => x[1] && x[1] !== 'pending') && ['#thread-f:5002', '#thread-f:5005'].every(t => rows.some(x => x[0] === t && x[1] === 'flagged')));
  await settled(page);                               // everything checked: a later signal must not change them
  console.log(r.map(x => x.slice(0, 3)));
  const st = Object.fromEntries(r.map(x => [x[0], x]));
  check('sample 2 (unread): badge shown and flagged from its malformed address', st['#thread-f:5001'] && st['#thread-f:5001'][1] === 'flagged' && /characters before the "@"/.test(st['#thread-f:5001'][3]), st['#thread-f:5001']);
  check('read row with forged headers: flagged', st['#thread-f:5002'] && st['#thread-f:5002'][1] === 'flagged', st['#thread-f:5002']);
  check('trusted sender (your list): Trusted', st['#thread-f:5003'] && st['#thread-f:5003'][1] === 'trusted', st['#thread-f:5003']);
  const tLook = await page.evaluate(() => { const c = document.querySelector('[data-thread-id="#thread-f:5003"]').closest('tr').querySelector('.unshortener-sender-chip'); return { mark: c.querySelector('.unshortener-sender-mark').textContent, bg: getComputedStyle(c).backgroundColor }; });
  check('trusted sender: the only green label, with ✓', tLook.mark === '✓' && tLook.bg === 'rgb(230, 244, 234)', tLook);
  check('sample 3 (read; DMARC fails a quarantine policy, forged records, MIME 2.0): flagged', st['#thread-f:5005'] && st['#thread-f:5005'][1] === 'flagged' && /DMARC/.test(st['#thread-f:5005'][3]) && /fake delivery records/.test(st['#thread-f:5005'][3]), st['#thread-f:5005']);
  check('normal newsletter with clean headers: not flagged', st['#thread-f:5004'] && st['#thread-f:5004'][1] !== 'flagged' && st['#thread-f:5004'][1] !== 'caution', st['#thread-f:5004']);
  await page.close();
  page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/?set=r2#inbox');
  r = await until(() => page.evaluate(() => window.__spammed), r => r.length >= 3);
  await settled(page);                               // everything checked and decided: no fourth one
  r = await page.evaluate(() => window.__spammed);
  check('inbox: the three scams moved, trusted and clean ones not', r.length === 3 && r.includes('#thread-f:5001') && r.includes('#thread-f:5002') && r.includes('#thread-f:5005'), r);
  await page.close();

  // 3. Logging → Senders and Moved to Spam show what happened, readably.
  const ID = new URL(sw.url()).host;
  await waitFor(() => sw.evaluate(async () => ((await chrome.storage.local.get('recentActivity')).recentActivity || []).filter(a => a.type === 'Moved to Spam').length >= 3), 8000);
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${ID}/options.html`);
  await opt.waitForSelector('#logNav [data-log="spam"]', { state: 'attached' });
  await opt.evaluate(() => document.querySelector('.tab-btn[data-tab="logging"], [data-tab="logging"]') && document.querySelector('[data-tab="logging"]').click());
  await opt.evaluate(() => document.querySelector('#logNav [data-log="spam"]').click());
  const spamRows = await until(() => opt.$$eval('#spamLogTable tbody tr', t => t.map(r => r.textContent)), rows => rows.length >= 2 && rows.some(x => /Moved to Spam/.test(x)), 10000);
  console.log(spamRows.map(x => x.slice(0, 160)));
  check('Moved to Spam log lists the moves with sender and why', spamRows.length >= 2 && spamRows.some(x => /Moved to Spam/.test(x) && /characters before/.test(x)), spamRows.length);
  await opt.evaluate(() => document.querySelector('#logNav [data-log="senders"]').click());
  const senderRows = await until(() => opt.$$eval('#senderTable tbody tr', t => t.map(r => r.textContent)), rows => rows.length >= 4 && rows.some(x => /Checked:/.test(x)), 10000);
  console.log(senderRows.map(x => x.slice(0, 160)));
  check('Senders log lists checked senders with status and what was checked', senderRows.length >= 4 && senderRows.some(x => /Trusted/.test(x)) && senderRows.some(x => /Checked:/.test(x)), senderRows.length);
  const applog = await sw.evaluate(() => new Promise(res => chrome.storage.local.get('errorLogs', res)));
  const lines = (applog.errorLogs || []).filter(e => e.source === 'Sender checks').map(e => e.message);
  console.log(lines.slice(0, 6).map(l => l.slice(0, 220)));
  check('application log has readable sender-check and move entries', lines.some(l => /^Moved to Spam: an email from/.test(l)) && lines.some(l => /^Sender .*Checked:/.test(l)), lines.length);

  // 4. Icons (online): a site with an icon gets it; one without gets a blank space, never a globe.
  await set({});
  const res = await sw.evaluate(async () => [await senderIcon('paypal.com'), await senderIcon('this-domain-does-not-exist-zz9q.com')]);
  check('icon fetched for a site that has one (data: URL)', /^data:image\//.test(res[0]), res[0].slice(0, 30));
  check('no icon (Google\'s 404 globe) for a site without one', res[1] === '', res[1].slice(0, 30));
  const cached = await sw.evaluate(async () => { const t = Date.now(); await senderIcon('paypal.com'); return Date.now() - t; });
  check('icon remembered (second request answered from the cache)', cached < 50, cached);
  const stored = await sw.evaluate(async () => { const r = await iconStore.get('paypal.com'); const n = await iconStore.get('this-domain-does-not-exist-zz9q.com'); return { bytes: r && r.bytes && r.bytes.byteLength, type: r && r.type, none: n && n.bytes === null, legacy: (await chrome.storage.local.get('faviconCache')).faviconCache }; });
  check('icon stored as raw bytes in IndexedDB (not text in settings storage)', stored.bytes > 100 && stored.bytes < 8192 && stored.type === 'image/png' && stored.none && stored.legacy === undefined, stored);
  // Stand-ins (online): DuckDuckGo's multi-size .ico is redrawn as one small 32-pixel PNG in the background.
  const ico = await sw.evaluate(async () => { const r = await fetchIconFrom('https://icons.duckduckgo.com/ip3/usps.com.ico', [404]); const n = r && await normalizeIcon(r); return { inType: r && r.type, inBytes: r && r.bytes.byteLength, out: n && n.type, outBytes: n && n.bytes.byteLength }; });
  check('DuckDuckGo .ico redrawn as a small PNG in the background', ico.out === 'image/png' && ico.outBytes > 100 && ico.outBytes < 4096 && (ico.inBytes > ico.outBytes || !/icon/.test(ico.inType)), ico);
  const none = await sw.evaluate(async () => { await senderIcon('this-domain-does-not-exist-zz9q.com'); return (await iconStore.get('this-domain-does-not-exist-zz9q.com')).source; });
  check('no icon anywhere (Google, parent, DuckDuckGo): recorded as none, never a globe', none === 'none', none);
  const optPage = await ctx.newPage();
  await optPage.goto(`chrome-extension://${ID}/options.html`);
  const fromOptions = await until(() => optPage.evaluate(async () => (await iconStore.all()).map(r => r.site)), sites => sites.includes('paypal.com'), 10000);
  check('Settings page reads the same icon store', fromOptions.includes('paypal.com'), fromOptions);
  await optPage.close();
  await ctx.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
