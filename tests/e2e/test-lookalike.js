// Look-alike senders in the inbox list, with nothing opened: imitations are flagged and moved to Spam,
// weaker cases get amber, real companies with similar old names and trusted senders are left alone.
// (The lists, DMARC policies and registration dates are given here as if already looked up.)
const { launch, servePage, until, settled, ready, check, done } = require('./harness');
(async () => {
  const { ctx, sw } = await launch();
  await servePage(ctx, 'fake-gmail-list.html');
  await sw.evaluate(async () => {
    await syncPopularDomains();                      // the install-time download finishes first (not over our list)
    const now = Date.now(), day = 86400000;
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      enableSenderDomainCheck: false,              // no live DNS threat checks of these made-up domains
      customTrustedSenders: ['paypal-support.example'],
      popularDomains: { updated: now, entries: 'brandsite.example' }
    });
    const json = (o) => new TextEncoder().encode(JSON.stringify(o)).buffer;
    await iconStore.put('dmarc:brandsite.example', 'application/json', json({ p: 'reject', sp: '', pct: 100 }), 'dmarc');
    await iconStore.put('age:brandsitte.example', 'application/json', json({ created: now - 12 * day }), 'rdap');
    await iconStore.put('age:brandsitee.example', 'application/json', json({ created: now - 4000 * day }), 'rdap');
    invalidateConfig();
  });
  const page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/#inbox');
  await ready(page);
  // A colleague first (their name is learned, as a hash), then the rest.
  await page.evaluate(() => window.__arrive([{ t: 8301, email: 'pat.colleague@school.org', name: 'Pat Colleague', subj: 'Staff meeting', unread: false }]));
  await settled(page);                               // the colleague's row checked: their name is learned
  await page.evaluate(() => window.__arrive([
    { t: 8302, email: 'alerts@paypal-billing.example', name: 'Account alerts', subj: 'Your account is limited', unread: true },
    { t: 8303, email: 'news@brandsitte.example', name: 'Brandsite', subj: 'Confirm your details', unread: true },
    { t: 8304, email: 'news@brandsitee.example', name: 'Brandsitee', subj: 'Our newsletter', unread: true },
    { t: 8305, email: 'help@random-shop.example', name: 'PayPal Service', subj: 'Payment received', unread: true },
    { t: 8306, email: 'pat.colleague.home@gmail.com', name: 'Pat Colleague', subj: 'Quick favor', unread: true },
    { t: 8307, email: 'billing@paypal-support.example', name: 'Support', subj: 'Trusted vendor', unread: true }]));
  const status = (t) => page.evaluate((t) => { const c = document.querySelector(`[data-thread-id="#thread-f:${t}"]`); const chip = c && c.closest('tr').querySelector('.unshortener-sender-chip'); return chip ? { status: chip.dataset.status, title: chip.title } : (c ? null : 'moved'); }, t);
  const moved = () => page.evaluate(() => window.__spammed.slice());
  const m = await until(moved, s => ['#thread-f:8302', '#thread-f:8303', '#thread-f:8305'].every(t => s.includes(t)), 20000);
  check('a brand name plus a scare word (paypal-billing…): moved to Spam without being opened', m.includes('#thread-f:8302'), m);
  check('one letter off a popular domain, registered 12 days ago: moved to Spam', m.includes('#thread-f:8303'), m);
  check('a brand\'s name on an address that isn\'t the brand\'s: moved to Spam', m.includes('#thread-f:8305'), m);
  await settled(page);                               // everything checked and decided
  const after = await moved();
  check('nothing else moved (old similar name, colleague\'s name outside, trusted sender)', after.length === 3, after);
  const old = await status(8304);
  check('one letter off but registered years ago (a real company): not flagged', old && old.status !== 'flagged' && old.status !== 'caution', old);
  const col = await until(() => status(8306), s => s && s.status === 'caution', 8000);
  check('a colleague\'s name on an outside address: amber, with the reason', col && col.status === 'caution' && /name of someone in your organization/.test(col.title), col);
  const trusted = await status(8307);
  check('a trusted sender is never judged', trusted && trusted.status === 'trusted', trusted);
  const log = await sw.evaluate(async () => ((await chrome.storage.local.get('errorLogs')).errorLogs || []).map(e => e.message).filter(x => /look-alike/.test(x)));
  check('the log says why (look-alike address)', log.some(x => /paypal-billing\.example/.test(x)) && log.some(x => /registered only 12 days ago/.test(x)), log);
  await ctx.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
