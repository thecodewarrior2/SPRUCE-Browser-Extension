// [5.101-1] An opened email's sender picture: a company sender gets the picture its inbox row shows (the
// company's logo) over Gmail's own letter circle; colleagues and personal accounts keep Gmail's picture; a
// flagged email shows none of ours; the setting off draws nothing. Made-up senders only.
const { launch, servePage, until, settled, check, part, runParts } = require('./harness');
const SCAM = 'Your order of Windows Defender was successfully purchased. If this purchase was not made by you, please contact Microsoft Customer Support Immediately at 1(555)010-0188.';
// Gmail's picture for a sender without a photo (its letter circle), as an image from its photo host.
const LETTER = 'https://lh3.googleusercontent.com/a/ACg8ocLETTER-not-real=s40-p';
const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#1a73e8"/></svg>';

async function open(params, settings = {}) {
  const { ctx, sw } = await launch();
  global.RAW_MESSAGES = {};
  await servePage(ctx, 'fake-gmail-thread.html');
  await sw.evaluate(async ({ s, logo }) => {
    await chrome.storage.local.set(Object.assign({ enableDnsThreatCheck: true, enableAutoSpam: false, enableSenderDomainCheck: false }, s));
    // The company's logo, as if learned from an earlier verified email of its shared mailbox, and its DMARC
    // policy, as if looked up (a logo is shown only for a domain that enforces DMARC, in the list as here).
    await iconStore.put('logo:datafeed-vendor.example', 'image/svg+xml', new TextEncoder().encode(logo).buffer, 'avatar-logo');
    await iconStore.put('dmarc:datafeed-vendor.example', 'application/json', new TextEncoder().encode(JSON.stringify({ p: 'reject', sp: '', pct: 100 })).buffer, 'dmarc');
    invalidateConfig();
  }, { s: settings, logo: LOGO });
  const page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/?' + new URLSearchParams(Object.assign({ avatar: LETTER }, params)) + '#inbox/abc');
  return { ctx, page };
}
const picture = (page) => page.evaluate(() => {
  const slot = document.querySelector('.aCi'), pic = slot && slot.querySelector('.unshortener-msg-avatar'), gmail = slot && slot.querySelector('img.ajn');
  const addr = document.querySelector('.unshortener-sender-address');
  return { status: addr ? addr.dataset.status : null, ours: !!pic, src: pic ? pic.src.slice(0, 26) : '', shown: !!pic && getComputedStyle(pic).display !== 'none',
           radius: pic ? getComputedStyle(pic).borderRadius : '', clickThrough: !!pic && getComputedStyle(pic).pointerEvents === 'none',
           size: pic ? [pic.offsetWidth, pic.offsetHeight] : null, gmailKept: !!gmail && gmail.isConnected };
});

part('company', async () => {
  const { ctx, page } = await open({ from: 'm.person@datafeed-vendor.example', name: 'M Person', subj: 'Rep intro', plain: '1' });
  const p = await until(() => picture(page), p => p.ours && p.shown, 10000);
  check('a company sender in an opened email: its logo over Gmail\'s letter circle, as in the inbox list', p.ours && p.shown && p.src === 'data:image/svg+xml;base64,' && p.radius === '50%', p);
  check('the picture takes no clicks (Gmail\'s hover card still opens), Gmail\'s own stays underneath', p.clickThrough && p.gmailKept, p);
  check('as large as Gmail\'s picture', p.size && p.size[0] === 40 && p.size[1] === 40, p);
  await ctx.close();
});

part('colleague-and-personal', async () => {
  for (const [from, what] of [['pat.colleague@school.org', 'a colleague'], ['m.person.1980@gmail.com', 'a personal account']]) {
    const { ctx, page } = await open({ from, name: 'M Person', subj: 'Hello', plain: '1' });
    await until(() => picture(page), p => p.status && p.status !== 'pending', 10000);
    await settled(page);
    const p = await picture(page);
    check(`${what}: Gmail's own picture is kept`, !p.ours && p.gmailKept, p);
    await ctx.close();
  }
});

part('collapsed', async () => {
  // The conversation's collapsed earlier messages: a company's gets its logo; a personal account's keeps Gmail's.
  for (const [collapsed, ours, what] of [['m.person@datafeed-vendor.example', true, 'a company sender\'s collapsed message: its logo over Gmail\'s letter circle'],
                                         ['m.person.1980@gmail.com', false, 'a personal account\'s collapsed message: Gmail\'s own picture']]) {
    const { ctx, page } = await open({ from: 'pat.colleague@school.org', name: 'Pat', subj: 'Rep intro', plain: '1', collapsed });
    const look = () => page.evaluate(() => { const pic = document.querySelector('#collapsed .unshortener-msg-avatar'); return { ours: !!pic, shown: !!pic && getComputedStyle(pic).display !== 'none', src: pic ? pic.src.slice(0, 26) : '', size: pic ? [pic.offsetWidth, pic.offsetHeight] : null }; });
    let c;
    if (ours) c = await until(look, c => c.ours && c.shown, 10000);
    else { await until(() => picture(page), p => p.status && p.status !== 'pending', 10000); await settled(page); c = await look(); }
    check(what, ours ? (c.shown && c.src === 'data:image/svg+xml;base64,' && c.size && c.size[0] === 40) : !c.ours, c);
    await ctx.close();
  }
});

part('flagged', async () => {
  const { ctx, page } = await open({ from: 'm.person@datafeed-vendor.example', name: 'M Person', subj: SCAM, plain: '1' });
  const p = await until(() => picture(page), p => p.status === 'flagged', 10000);
  await settled(page);
  const q = await picture(page);
  check('a flagged email shows none of our pictures (a forged email can\'t borrow a company\'s logo)', p.status === 'flagged' && !q.shown, q);
  await ctx.close();
});

part('off', async () => {
  const { ctx, page } = await open({ from: 'm.person@datafeed-vendor.example', name: 'M Person', subj: 'Rep intro', plain: '1' }, { enableSenderAvatars: false });
  await until(() => picture(page), p => p.status && p.status !== 'pending', 10000);
  await settled(page);
  const p = await picture(page);
  check('setting "Sender photos and company logos" off: Gmail\'s own picture only', !p.ours && p.gmailKept, p);
  await ctx.close();
});

runParts().catch(e => { console.error(e); process.exit(1); });
