// Moving to Spam only when it is safe: the account, the toolbar's language, the view.
const { launch, servePage, listSettled, check, done } = require('./harness');
const BASE = { __testScamSenders: ['phisher@evil-scam.test', 'billing@evil-scam.test'], enableDnsThreatCheck: false };
(async () => {
  const { ctx, sw } = await launch();
  await servePage(ctx, 'fake-gmail-list.html');
  const go = async (q, moves = 0, hash = '#inbox') => {
    await sw.evaluate(async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }, BASE);
    const page = await ctx.newPage();
    await page.goto('https://mail.google.com/mail/u/0/?' + q + hash);
    await listSettled(page, sw, moves);
    const r = await page.evaluate(() => ({ spammed: window.__spammed, chips: [...document.querySelectorAll('.unshortener-sender-chip')].map(c => c.dataset.status) }));
    await page.close();
    return r;
  };
  // A subject containing an address must not make that address's domain "your own organization".
  let r = await go('title=' + encodeURIComponent('Re: from phisher@evil-scam.test - teacher@school.org - Gmail'), 2);
  check('address in the subject is not taken as the account', r.spammed.length === 2, r);
  r = await go('title=' + encodeURIComponent('Inbox - phisher@evil-scam.test - Gmail'));
  check('own organization: never moved, even when on the scam-sender list (still flagged)', r.spammed.length === 0 && r.chips.includes('flagged'), r);
  // Non-English toolbar label: act="9" accepted only when the label still says spam.
  r = await go('label=' + encodeURIComponent('Als Spam melden'), 2);
  check('German label with act=9: moved', r.spammed.length === 2, r);
  r = await go('label=' + encodeURIComponent('Löschen'));
  check('act=9 whose label is not about spam: never clicked', r.spammed.length === 0, r);
  // Split view: nothing moved.
  r = await go('split=1');
  check('split view (conversation beside the list): nothing moved', r.spammed.length === 0, r);
  await ctx.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
