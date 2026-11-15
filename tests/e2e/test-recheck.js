// [5.94.28] EXPERIMENT (llm_testing): Settings → Re-check. Counting finds the last N days' conversations in
// Gmail's search, page by page, and says how many and about how long; the re-check reads each one's original
// in its own small Gmail window, shows it as an inert hidden email so the extension's own checks judge it, and
// lists what is flagged with why; "Open in Gmail" opens the conversation, "Mark as phishing: move to Spam"
// presses Report spam in it. An email's markup never runs (scripts, event handlers, remote images). Every
// sender, address and email here is made up.
const { launch, servePage, until, optionsReady, check, done, waitForLog } = require('./harness');

// Gmail's ids are long (the fixture's: 0x10000000 + a small number).
const GID = (n) => 0x10000000 + n;
const T = (n) => `thread-f:${GID(n)}`;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
const RAW = (lines) => lines.join('\r\n');
global.RAW_MESSAGES = {
  // A password lure: Microsoft's name on a domain that isn't Microsoft's, its sender check failing.
  [`msg-f:${GID(8001)}`]: RAW(['Authentication-Results: mx.google.com; dkim=fail header.i=@ms-verify.example; spf=fail; dmarc=fail header.from=ms-verify.example',
    'From: Microsoft Security <no-reply@ms-verify.example>', 'To: teacher@school.org', 'Subject: Your password expires today', 'Date: Mon, 10 Nov 2026 09:00:00 +0000',
    'Message-ID: <lure1@ms-verify.example>', 'MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="b1"', '',
    '--b1', 'Content-Type: text/plain; charset=utf-8', '', 'Your password expires in 2 hours.', '--b1', 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
    b64('<p>Dear user, your Microsoft 365 password expires in 2 hours.</p><p><a href="https://ms-verify.example/keep">Keep my current password</a></p><p>Act now to avoid losing access to your mailbox.</p>'),
    '--b1--', '']),
  // A colleague's ordinary email.
  [`msg-f:${GID(8002)}`]: RAW(['Authentication-Results: mx.google.com; dkim=pass header.i=@school.org; spf=pass; dmarc=pass header.from=school.org',
    'From: Pat Principal <principal@school.org>', 'To: teacher@school.org', 'Subject: Staff meeting Friday', 'Date: Tue, 11 Nov 2026 09:00:00 +0000',
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', 'Reminder: the staff meeting is Friday at 3 in the library.', '']),
  // Markup that would run if it weren't made inert.
  [`msg-f:${GID(8003)}`]: RAW(['Authentication-Results: mx.google.com; dkim=pass header.i=@xss-test.example; spf=pass; dmarc=pass header.from=xss-test.example',
    'From: Events <events@xss-test.example>', 'To: teacher@school.org', 'Subject: Spring fair', 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '',
    '<p>The spring fair is on Saturday.</p><img src="https://tracker.xss-test.example/pixel.gif" onerror="window.__pwned=1"><script>window.__pwned=2</script>',
    '<a href="javascript:window.__pwned=3" onclick="window.__pwned=4">Details</a><div style="background:url(https://tracker.xss-test.example/bg.png)" onmouseover="window.__pwned=5">Map</div>',
    '<svg onload="window.__pwned=6"></svg><iframe src="https://tracker.xss-test.example/frame"></iframe><form action="https://tracker.xss-test.example/f"><input name="p"></form>', '']),
  // Quoted-printable text with a web address in it.
  [`msg-f:${GID(8004)}`]: RAW(['Authentication-Results: mx.google.com; dkim=pass header.i=@plain-vendor.example; spf=pass; dmarc=pass header.from=plain-vendor.example',
    'From: Billing <billing@plain-vendor.example>', 'To: teacher@school.org', 'Subject: Invoice 2231', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable', '', 'Invoice 2231 for the field trip is attached. Pay online: https://plain-vendor.example/=', 'pay =E2=80=94 thank you.', '']),
  // A newsletter.
  [`msg-f:${GID(8005)}`]: RAW(['Authentication-Results: mx.google.com; dkim=pass header.i=@school-news.example; spf=pass; dmarc=pass header.from=school-news.example',
    'From: School News <news@school-news.example>', 'To: teacher@school.org', 'Subject: November newsletter', 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '',
    '<p>This month: the winter concert dates and the new lunch menu.</p>', ''])
};

(async () => {
  const { ctx, sw } = await launch();
  const ID = new URL(sw.url()).host;
  await servePage(ctx, 'fake-gmail-recheck.html');
  const tracker = [];
  await ctx.route('https://tracker.xss-test.example/**', (route) => { tracker.push(route.request().url()); route.fulfill({ status: 204, body: '' }); });
  const pages = [];
  // A tab or window the extension opens itself loads its first page before the test's routes apply to it (so
  // it reaches the real Gmail, or its sign-in page): it is sent to the same address once more, on the fake Gmail.
  ctx.on('page', (p) => {
    pages.push(p);
    p.waitForLoadState('domcontentloaded').then(() => {
      const u = p.url();
      if (/^https:\/\/(accounts\.google\.com|mail\.google\.com)\//.test(u) && !p.__rerouted) {
        p.__rerouted = true;
        const hash = u.includes('#') ? u.slice(u.indexOf('#')) : '#inbox';
        p.goto(`https://mail.google.com/mail/u/0/${hash}`).catch(() => {});
      }
    }).catch(() => {});
  });
  const errors = [];

  const opt = await ctx.newPage();
  opt.on('pageerror', e => errors.push(e.message));
  opt.on('dialog', d => d.accept());
  // Gmail only: with Outlook the email last used (and no Gmail tab open), the tab isn't offered and can't start.
  await sw.evaluate(() => chrome.storage.local.set({ webmailInUse: { site: 'outlook', name: 'Outlook on the web', at: Date.now() } }));
  await opt.goto(`chrome-extension://${ID}/options.html`);
  await optionsReady(opt);
  const tabShown = () => opt.$eval('.tab-btn[data-tab="recheck"]', b => !b.hidden && !b.disabled && getComputedStyle(b).display !== 'none');
  check('Outlook in use: the Re-check tab is hidden and off', !await until(tabShown, v => v === false, 5000));
  const refused = await opt.evaluate(() => new Promise(r => chrome.runtime.sendMessage({ action: 'recheckStart', days: 30, mode: 'count' }, r)));
  check('…and the background won\'t start one, saying why', refused && /Gmail only/.test(refused.error) && /Outlook on the web/.test(refused.error), refused);
  // Back in Gmail (its tab says so when it comes into view): the tab is offered again, without reloading Settings.
  const gmailTab = await ctx.newPage();
  await gmailTab.goto('https://mail.google.com/mail/u/0/#inbox');
  check('Gmail in use again: the Re-check tab is shown', await until(tabShown, v => v === true, 10000));
  const inUse = await sw.evaluate(async () => (await chrome.storage.local.get('webmailInUse')).webmailInUse);
  check('only which webmail and when is kept', inUse && inUse.site === 'gmail' && Object.keys(inUse).sort().join() === 'at,name,site', inUse);
  await gmailTab.close();
  // (The made-up domains don't exist: that check is off here, as in the other suites.)
  await sw.evaluate(() => chrome.storage.local.set({ enableDnsThreatCheck: false }));
  await opt.click('.tab-btn[data-tab="recheck"]');
  check('the Re-check tab is there, with the number of days (30 by default)', await opt.$eval('#recheckDays', e => e.value) === '30');
  const state = () => sw.evaluate(async () => (await chrome.storage.local.get('recheckState')).recheckState || null);
  const results = () => sw.evaluate(async () => (await chrome.storage.local.get('recheckResults')).recheckResults || []);

  // Counting: Gmail's search for the last 14 days, three pages of results; nothing is checked.
  await opt.fill('#recheckDays', '14');
  await opt.click('#recheckCountBtn');
  const counted = await until(state, s => s && s.phase === 'counted', 60000);
  check('counting finds the 5 conversations over the 3 pages of results', counted && counted.total === 5 && counted.days === 14, counted);
  const scanPage = pages.find(p => p.url().startsWith('https://mail.google.com/'));
  const query = scanPage && !scanPage.isClosed() ? await scanPage.evaluate(() => window.__query).catch(() => null) : null;
  check('Gmail is searched for the last 14 days, without sent mail, drafts, chats or the user\'s own', !scanPage || query === null || query === 'newer_than:14d -in:sent -in:drafts -in:chats -from:me', query);
  const est = await until(() => opt.$eval('#recheckEstimate', e => e.hidden ? '' : e.textContent), t => /5 emails/.test(t), 10000);
  check('the estimate says how many emails, about how long, and what happens', /5 emails in the last 14 days/.test(est) && /about \d+ seconds/.test(est) && /small Gmail window/.test(est) && /Nothing is marked read, moved or sent/.test(est), est);
  check('nothing was checked by counting', (await results()).length === 0);
  await until(() => Promise.resolve(scanPage ? scanPage.isClosed() : true), v => v, 20000);
  check('the counting window closed', !scanPage || scanPage.isClosed());

  // The re-check.
  await opt.click('#recheckStartBtn');
  const fin = await until(state, s => s && (s.phase === 'done' || s.phase === 'error'), 180000);
  check('the re-check went through every email', fin && fin.phase === 'done' && fin.total === 5 && fin.done === 5, fin);
  const found = await results();
  const lure = found.find(r => r.thread === T(7001));
  check('the password lure is listed as flagged, with why', lure && lure.status === 'flagged' && lure.reasons.length > 0 && lure.subject === 'Your password expires today' && lure.address === 'no-reply@ms-verify.example', lure);
  check('the colleague\'s email and the newsletter aren\'t listed', !found.some(r => r.thread === T(7002) || r.thread === T(7005)), found.map(r => [r.thread, r.status, r.reasons]));
  check('only what is flagged or needs caution is kept', found.every(r => ['flagged', 'caution'].includes(r.status) || (r.ai && ['danger', 'caution'].includes(r.ai.level))), found.map(r => r.status));
  const scan2 = pages.filter(p => p.url().startsWith('https://mail.google.com/')).pop();
  check('the email\'s markup never ran in the re-check window (scripts, event handlers, javascript: links)', !scan2 || scan2.isClosed() || !await scan2.evaluate(() => window.__pwned).catch(() => null));
  check('no remote image, background, frame or form of an email was loaded', tracker.length === 0, tracker);
  check('the re-check window closed when it ended', !scan2 || scan2.isClosed());
  const shown = await until(() => opt.$$eval('#recheckResults .recheck-item', els => els.map(e => e.textContent)), v => v.length >= 1, 10000);
  check('the tab lists it with its reasons, Open in Gmail and Mark as phishing', shown.some(t => /Flagged/.test(t) && /Your password expires today/.test(t) && /Open in Gmail/.test(t) && /Mark as phishing: move to Spam/.test(t)), shown);
  const sum = await opt.$eval('#recheckSummary', e => e.textContent);
  check('the summary says how many were checked and found', /5 of 5 emails checked/.test(sum) && /flagged or needing caution/.test(sum), sum);
  const log = await waitForLog(sw, /Re-check finished/, 10000);
  check('the log says the re-check finished, and no verdict of each email was logged', log.some(m => /Re-check finished: 5 of 5 emails checked/.test(m)) && !log.some(m => /^Email from no-reply@ms-verify\.example/.test(m)), log.slice(-6));
  const seen = await sw.evaluate(async () => { const r = await senderHistory([]); return r; });
  check('re-checked senders weren\'t recorded as first seen today', !!seen);

  // Open in Gmail: the conversation by its legacy id.
  const before = pages.length;
  await opt.click('#recheckResults .recheck-item.flagged .btn-primary');
  const gm = await until(() => Promise.resolve(pages.slice(before).find(p => /^https:\/\/mail\.google\.com\/.*#all\//.test(p.url()))), v => v, 15000);
  check('Open in Gmail opens the whole conversation', gm && /\/mail\/u\/0\/#all\/([0-9a-f]+)$/.test(gm.url()) && gm.url().endsWith(GID(7001).toString(16)), gm && gm.url());
  if (gm) await gm.close();

  // Mark as phishing: Gmail opens the conversation and Report spam is pressed (automatic moving is off).
  await sw.evaluate(() => chrome.storage.local.set({ enableAutoSpam: false }));
  const before2 = pages.length;
  await opt.click('#recheckResults .recheck-item.flagged .del-btn');
  const sp = await until(() => Promise.resolve(pages.slice(before2).find(p => /^https:\/\/mail\.google\.com\//.test(p.url()))), v => v, 15000);
  const spammed = sp ? await until(() => sp.evaluate(() => window.__spammed).catch(() => []), v => v && v.length, 30000) : [];
  check('Mark as phishing presses Report spam in that conversation, whatever the automatic-move setting', JSON.stringify(spammed) === JSON.stringify([T(7001)]), spammed);
  const after = await until(results, r => r.some(x => x.thread === T(7001) && x.spam === 'moved'), 15000);
  check('the result says it was moved', after.some(x => x.thread === T(7001) && x.spam === 'moved'), after.map(x => [x.thread, x.spam]));
  const moved = await until(() => opt.$eval('#recheckResults', e => e.textContent), t => /moved to Spam/.test(t), 10000);
  check('the tab shows it as moved to Spam', /Marked as phishing and moved to Spam/.test(moved), moved.slice(0, 300));

  // Clearing.
  await opt.click('#recheckClearBtn');
  const cleared = await until(results, r => r.length === 0, 10000);
  check('Clear the results empties the list', cleared.length === 0);
  check('no errors on the Settings page', errors.length === 0, errors);
  await ctx.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
