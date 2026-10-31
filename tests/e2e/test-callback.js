// "Call this number" scams: a subject with a phone number and the scam's wording is red from the list
// (whoever sent it, even a company's own system); a plain number with "call" is a caution only; the
// setting switches it off. Opened, the subject and body count too. (Fictional 555 numbers only.)
const { launch, servePage, until, settled: settledPage, ready, check, part, runParts } = require('./harness');
const SCAM = 'Your order of Windows Defender was successfully purchased. If this purchase was not made by you, please contact Microsoft Customer Support Immediately at 1(555)010-0188.';
const label = (page, t) => page.evaluate((t) => {
  const el = document.querySelector(`[data-thread-id="#thread-f:${t}"]`);
  const chip = el && el.closest('tr').querySelector('.unshortener-sender-chip');
  return chip ? { status: chip.dataset.status, title: chip.title } : null;
}, t);
const settled = (l) => l && l.status && l.status !== 'pending';

async function list(settings = {}) {
  const { ctx, sw } = await launch();
  await sw.evaluate((s) => chrome.storage.local.set(Object.assign({ enableDnsThreatCheck: false, enableAutoSpam: false }, s)), settings);
  await servePage(ctx, 'fake-gmail-list.html');
  const page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/#inbox');
  await ready(page);
  await page.evaluate((scam) => window.__arrive([
    { t: 9301, email: 'msonlineservicesteam@microsoftonline.com', name: 'msonlineservicesteam@microsoftonline.com', subj: scam, unread: true },
    { t: 9302, email: 'orders@shop.example', name: 'Example Shop', subj: 'Your order is ready - call (555) 010-0123 to pick it up', unread: true }]), SCAM);
  return { ctx, page };
}

part('list', async () => {
  const { ctx, page } = await list();
  const a = await until(() => label(page, 9301), l => l && l.status === 'flagged', 10000);
  check('a "call this number" subject is red from the list, even from Microsoft\'s own address', a && a.status === 'flagged' && /call this number/.test(a.title), a);
  const b = await until(() => label(page, 9302), settled, 8000);
  check('a shop\'s "call to pick it up" subject is a caution at most', b && b.status !== 'flagged', b);
  await ctx.close();
});

part('off', async () => {
  const { ctx, page } = await list({ enableCallbackScamCheck: false });
  await until(() => label(page, 9301), settled, 8000);
  await settledPage(page);
  const a = await label(page, 9301);
  check('switched off: not flagged for it', a && !/call this number/.test(a.title), a);
  await ctx.close();
});

part('opened', async () => {
  const { ctx, sw } = await launch();
  global.RAW_MESSAGES = { 'msg-f:3001': 'Received: from a.example by mx.google.com; Fri, 18 Jul 2025 14:16:52 +0000\nFrom: msonlineservicesteam@microsoftonline.com\nMIME-Version: 1.0\n\nx' };
  await servePage(ctx, 'fake-gmail-thread.html');
  await sw.evaluate(() => chrome.storage.local.set({ enableDnsThreatCheck: false, enableAutoSpam: false }));
  const page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/?from=' + encodeURIComponent('msonlineservicesteam@microsoftonline.com') + '&name=' + encodeURIComponent('Microsoft') + '&subj=' + encodeURIComponent(SCAM) + '#label/x/abc');
  const r = await until(() => page.evaluate(() => {
    const el = document.querySelector('.unshortener-sender-address');
    return el ? { status: el.dataset.status, title: el.title, banner: (document.querySelector('.unshortener-email-banner') || {}).textContent || '' } : null;
  }), r => r && r.status === 'flagged' && /call this number/.test(r.banner), 10000);
  check('opened: the subject flags it, with a red banner that says why', r && r.status === 'flagged' && /call this number/.test(r.banner), r);
  await ctx.close();
});

runParts().catch(e => { console.error(e); process.exit(1); });
