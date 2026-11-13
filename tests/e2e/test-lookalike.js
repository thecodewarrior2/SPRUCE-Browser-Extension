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
    // Brand ownership answers, as if looked up (own:<domain>|<brand>): proven Amazon's, only likely, and nothing known.
    await iconStore.put('own:amazonmusic.example|Amazon', 'application/json', json({ state: 'owned', how: 'registered to Amazon Technologies, Inc. through MarkMonitor Inc.' }), 'own');
    await iconStore.put('own:amazon-notices.example|Amazon', 'application/json', json({ state: 'likely', how: 'its DMARC reports go to amazon.com; registered through MarkMonitor Inc., a corporate registrar' }), 'own');
    await iconStore.put('own:random-shop.example|PayPal', 'application/json', json({ state: 'unknown', how: '' }), 'own');
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
    { t: 8307, email: 'billing@paypal-support.example', name: 'Support', subj: 'Trusted vendor', unread: true },
    { t: 8308, email: 'no-reply@amazonmusic.example', name: 'Amazon Music', subj: 'Your Halloween soundtrack awaits', unread: true },
    { t: 8309, email: 'news@amazon-notices.example', name: 'Amazon', subj: 'Your order', unread: true },
    // [5.99-1] Someone sharing the colleague's name at a vendor, greeting from the vendor's own address; and the
    // same name with a title after it, as only someone inside would write it.
    { t: 8310, email: 'pat.colleague@learnbridge-vendor.example', name: 'Pat Colleague', subj: 'Nice meeting you', unread: true },
    { t: 8311, email: 'pat.c@learnbridge-vendor.example', name: 'Pat Colleague, Principal', subj: 'Staff update', unread: true }]));
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
  const vendor = await until(() => status(8310), s => s && s.status !== 'pending' && /same name as someone in your organization/.test(s.title), 8000);
  check('[5.99-1] a colleague\'s name at a vendor, greeting from its own address: not amber, a note says people share names', vendor && vendor !== 'moved' && vendor.status !== 'caution' && vendor.status !== 'flagged' && /Nothing in the email claims to be from inside your organization/.test(vendor.title), vendor);
  const titled = await until(() => status(8311), s => s && s.status === 'caution', 8000);
  check('[5.99-1] the colleague\'s name with a title after it, from outside: amber, saying why', titled && titled.status === 'caution' && /title or your organization's name in the sender's name/.test(titled.title), titled);
  const trusted = await status(8307);
  check('a trusted sender is never judged', trusted && trusted.status === 'trusted', trusted);
  const owned = await status(8308);
  check('a brand\'s name on a domain proven the brand\'s (public records): not flagged, not moved, the reason says why', owned && owned !== 'moved' && owned.status !== 'flagged' && owned.status !== 'caution' && /is Amazon's: registered to Amazon Technologies/.test(owned.title), owned);
  const likely = await until(() => status(8309), s => s && s.status === 'caution', 8000);
  check('a brand\'s name on a domain that looks like the brand\'s: amber, not moved, with the evidence', likely && likely.status === 'caution' && !after.includes('#thread-f:8309') && /looks like Amazon's \(its DMARC reports go to amazon\.com/.test(likely.title), likely);
  const log = await sw.evaluate(async () => ((await chrome.storage.local.get('errorLogs')).errorLogs || []).map(e => e.message).filter(x => /look-alike/.test(x)));
  check('the log says why (look-alike address)', log.some(x => /paypal-billing\.example/.test(x)) && log.some(x => /registered only 12 days ago/.test(x)), log);
  await ctx.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
