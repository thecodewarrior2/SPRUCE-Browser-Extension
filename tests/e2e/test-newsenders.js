// EXPERIMENT (llm_testing): an email from outside the user's organization, and the first email from an
// address, add small weights that are explained in the sender's label but never make it amber alone.
const { launch, servePage, until, check, done } = require('./harness');
(async () => {
  const { ctx, sw } = await launch();
  await servePage(ctx, 'fake-gmail-thread.html');
  const day = 24 * 60 * 60 * 1000;
  const open = async () => {
    const page = await ctx.newPage();
    await page.goto('https://mail.google.com/mail/u/0/#inbox/FMfcgz');      // account teacher@school.org; sender phisher@evil-scam.test
    const r = await until(() => page.$eval('.unshortener-sender-address', e => ({ status: e.dataset.status || '', title: e.title || '' })), v => !!v.status && v.status !== 'pending', 15000);
    await page.close();
    return r;
  };
  // Learning (just installed): outside the organization counts, first-time doesn't yet.
  await sw.evaluate(() => chrome.storage.local.set({ enableDnsThreatCheck: false }));
  let r = await open();
  check('while learning: "outside your organization" is noted, nobody is first-time yet', /outside your organization \(school\.org\)/.test(r.title) && !/first email/.test(r.title), r);
  check('…and that alone never makes the email amber or red', !['caution', 'flagged'].includes(r.status), r.status);
  // After the learning period, an address never seen before is a first-time sender.
  await sw.evaluate((d) => chrome.storage.local.set({ seenSendersSince: Date.now() - 15 * d, seenSenders: {} }), day);
  await sw.evaluate(() => { seenSenders.forget(); });
  r = await open();
  check('after learning: a new address is "the first email you\'ve received", still not amber on its own',
    /first email you've received from phisher@evil-scam\.test/.test(r.title) && !['caution', 'flagged'].includes(r.status), r);
  // Written to storage a few seconds after a change.
  const stored = await until(() => sw.evaluate(() => chrome.storage.local.get('seenSenders').then(x => Object.keys(x.seenSenders || {}))), v => v.length >= 1, 10000);
  check('only hashes of addresses are stored', stored.length >= 1 && stored.every(k => /^[0-9a-f]{16}$/.test(k)), stored);
  // Turned off: neither weight.
  await sw.evaluate(() => chrome.storage.local.set({ weighSenderHistory: false }));
  r = await open();
  check('switched off: neither note', !/outside your organization|first email/.test(r.title), r.title);
  await ctx.close();
  done();
})();
