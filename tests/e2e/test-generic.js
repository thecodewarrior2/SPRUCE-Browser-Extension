// The generic profile on sites without an entry of their own (simulated Outlook and Yahoo pages built
// from their accessibility structure): read-only sender features, the webmail's own warnings, and
// never a click.
const fs = require('fs');
const { launch, until, settled, check, done } = require('./harness');
const serve = (ctx, pattern, file) => ctx.route(pattern, r => r.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(__dirname + '/' + file, 'utf8') }));
const chips = (page) => page.evaluate(() => [...document.querySelectorAll('.unshortener-sender-chip')].map(c => ({ status: c.dataset.status, title: c.title, inRow: !!c.closest('[role=option],[role=listitem]') })));
(async () => {
  const { ctx, sw } = await launch();
  await serve(ctx, 'https://outlook.office.com/**', 'fake-outlook.html');
  await serve(ctx, 'https://mail.yahoo.com/**', 'fake-yahoo.html');
  const set = (s) => sw.evaluate(async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }, s);
  const base = { __testScamSenders: ['billing@evil-scam.test', 'phisher@evil-scam.test'], enableDnsThreatCheck: false };

  // Outlook-like page, no warning.
  await set(base);
  let page = await ctx.newPage();
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto('https://outlook.office.com/mail/inbox');
  let c = await until(() => chips(page), c => c.length >= 3 && c.every(x => x.status && x.status !== 'pending'));
  console.log(c.map(x => x.status + (x.inRow ? ' (row)' : ' (opened)')));
  const rows = c.filter(x => x.inRow);
  check('generic list: a label on each row that shows an address (2 of 3)', rows.length === 2, rows);
  check('generic list: the scam-list sender is flagged', rows.some(x => x.status === 'flagged' && /billing@evil-scam\.test/.test(x.title)), rows);
  check('generic list: a gmail.com friend is not flagged', rows.some(x => x.status === 'unverified' && /friend@gmail\.com/.test(x.title)), rows);
  const opened = c.filter(x => !x.inRow);
  check('generic opened email: the sender above the body is found (not the To address)', opened.length === 1 && /service@paypa1-secure\.test/.test(opened[0].title), opened);
  check('generic opened email: a brand\'s name on an address that isn\'t the brand\'s is red, as in the inbox list', opened.length === 1 && opened[0].status === 'flagged' && /isn't PayPal's address/.test(opened[0].title), opened);
  const linkChecked = await page.evaluate(() => !!document.querySelector('[aria-label="Message body"] a[data-unshortened]'));
  check('link checks still run on the site', linkChecked, linkChecked);
  await settled(page);                               // everything checked and decided: no (wrong) click
  let clicks = await page.evaluate(() => window.__clicks);
  check('never a click on a generic site: no checkbox, no Junk button (flagged sender in the list)', clicks.length === 0, clicks);
  await page.close();

  // The same page with Outlook's own fraud warning above the email.
  await set(base);
  page = await ctx.newPage();
  await page.goto('https://outlook.office.com/mail/inbox?warn=1');
  c = await until(() => chips(page), c => c.some(x => !x.inRow && x.status === 'flagged'));
  await until(() => page.evaluate(() => !!document.querySelector('.unshortener-email-banner')), v => v, 5000);
  await settled(page);                               // everything checked and decided: no (wrong) click
  const o = c.filter(x => !x.inRow);
  check('the webmail\'s own warning flags the opened email, quoting it', o.length === 1 && o[0].status === 'flagged' && /Outlook on the web itself warns about this sender: “This sender failed our fraud detection checks/.test(o[0].title), o);
  const banner = await page.evaluate(() => (document.querySelector('.unshortener-email-banner') || {}).textContent || '');
  check('…and the email banner says so', /This email is flagged/.test(banner) && /fraud detection/.test(banner), banner.slice(0, 200));
  clicks = await page.evaluate(() => window.__clicks);
  check('still no click with a flagged opened email', clicks.length === 0, clicks);
  await page.close();

  // A genuine Microsoft notification carrying "call this number" scam text, opened in Outlook.
  await set(base);
  page = await ctx.newPage();
  await page.goto('https://outlook.office.com/mail/inbox?callback=1');
  c = await until(() => chips(page), c => c.some(x => !x.inRow && x.status === 'flagged'), 10000);
  const cb = c.filter(x => !x.inRow);
  const cbBanner = await until(() => page.evaluate(() => (document.querySelector('.unshortener-email-banner') || {}).textContent || ''), t => /call this number/.test(t), 5000);
  check('Outlook: a "call this number" scam in a genuine Microsoft email is flagged when opened', cb.length === 1 && cb[0].status === 'flagged' && /call this number/.test(cb[0].title) && /mathematical/.test(cb[0].title), cb);
  check('…and the banner says why', /This email is flagged/.test(cbBanner) && /call this number/.test(cbBanner), cbBanner.slice(0, 200));
  await page.close();

  // Yahoo-like page.
  await set(base);
  page = await ctx.newPage();
  await page.goto('https://mail.yahoo.com/d/folders/1');
  c = await until(() => chips(page), c => c.filter(x => x.inRow).length === 2 && c.some(x => x.inRow && x.status === 'flagged') && c.some(x => !x.inRow));
  console.log(c.map(x => x.status + (x.inRow ? ' (row)' : ' (opened)')));
  check('Yahoo-like list: both rows labelled, the scam sender flagged', c.filter(x => x.inRow).length === 2 && c.some(x => x.inRow && x.status === 'flagged' && /phisher@evil-scam\.test/.test(x.title)), c);
  check('Yahoo-like opened email: sender found above the body', c.some(x => !x.inRow && /news@example\.com/.test(x.title)), c);
  await page.close();

  // Sender features off: nothing drawn on a generic site either.
  await set(Object.assign({}, base, { enableSenderIdentity: false, enableSenderDomainCheck: false, enableSenderAddressCheck: false }));
  page = await ctx.newPage();
  await page.goto('https://outlook.office.com/mail/inbox?warn=1');
  await settled(page);
  c = await chips(page);
  check('sender features off: no labels on a generic site', c.length === 0, c);
  await page.close();
  // The site switched off: nothing at all.
  await set(Object.assign({}, base, { enableOutlookSupport: false }));
  page = await ctx.newPage();
  await page.goto('https://outlook.office.com/mail/inbox');
  await settled(page);
  const any = await page.evaluate(() => document.querySelectorAll('[class*="unshortener-"], a[data-unshortened]').length);
  check('Outlook support switched off: the extension leaves the page alone', any === 0, any);
  await page.close();
  await ctx.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
