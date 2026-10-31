const { launch, servePage, until, settled, check, done } = require('./harness');
(async () => {
  const { ctx, sw } = await launch();
  await sw.evaluate(() => chrome.storage.local.set({
    __testScamSenders: ['phisher@evil-scam.test', 'billing@evil-scam.test', 'rescued@evil-scam.test'],
    spamMovedThreads: { 'thread-f:1005': Date.now() - 1000 },
    enableDnsThreatCheck: false
  }));
  await servePage(ctx, 'fake-gmail-list.html');
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()); });
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto('https://mail.google.com/mail/u/0/#inbox');
  await until(() => page.evaluate(() => window.__spammed.length), n => n >= 2, 15000);
  await until(() => page.locator('.unshortener-spam-notice').textContent().catch(() => ''), t => /2 emails/.test(t || ''), 8000);
  await settled(page);                               // everything checked and decided: no (wrong) third move
  const spammed = await page.evaluate(() => window.__spammed);
  check('flagged unread rows moved (1001, 1007)', spammed.includes('#thread-f:1001') && spammed.includes('#thread-f:1007'), spammed);
  check('rescued thread 1005 not moved again', !spammed.includes('#thread-f:1005'), spammed);
  check('clean rows not moved', spammed.length === 2, spammed);
  const notice = await page.locator('.unshortener-spam-notice').textContent().catch(() => null);
  check('notice shows 2 moved', /2 emails from flagged senders were moved to Spam/.test(notice || ''), notice);
  const href = await page.locator('.unshortener-spam-notice a').getAttribute('href').catch(() => null);
  check('notice links to #spam', href === '#spam', href);
  const chips = await page.$$eval('tr.zA', rows => rows.map(r => {
    const c = r.querySelector('.unshortener-sender-chip');
    const f = r.querySelector('.unshortener-sender-flag');
    return { thread: r.querySelector('[data-thread-id]').getAttribute('data-thread-id'), chip: c && c.textContent, status: c && c.dataset.status, flag: f && f.textContent, img: !!r.querySelector('.unshortener-sender-icon img'), circle: !!r.querySelector('.unshortener-row-avatar') };
  }));
  console.log(chips);
  const by = Object.fromEntries(chips.map(c => [c.thread, c]));
  check('gmail.com sender not verified (never green by default)', by['#thread-f:1002'] && by['#thread-f:1002'].status === 'unverified', by['#thread-f:1002']);
  check('example.de shows DE flag + site label', by['#thread-f:1003'] && by['#thread-f:1003'].flag === '🇩🇪' && /example\.de/.test(by['#thread-f:1003'].chip), by['#thread-f:1003']);
  check('offline: example.de unverified', by['#thread-f:1003'] && by['#thread-f:1003'].status === 'unverified', by['#thread-f:1003']);
  check('own row (me) not decorated', by['#thread-f:1004'] && by['#thread-f:1004'].chip === null, by['#thread-f:1004']);
  check('rescued 1005 still shown flagged', by['#thread-f:1005'] && by['#thread-f:1005'].status === 'flagged', by['#thread-f:1005']);
  check('own org sender not verified (never green by default)', by['#thread-f:1006'] && by['#thread-f:1006'].status === 'unverified', by['#thread-f:1006']);
  const look = await page.$$eval('.unshortener-sender-chip', cs => cs.map(c => ({ status: c.dataset.status, mark: c.querySelector('.unshortener-sender-mark').textContent, bg: getComputedStyle(c).backgroundColor })));
  const neutral = look.filter(x => x.status === 'unverified' || x.status === 'clean');
  check('not verified / checked labels: no mark, neutral grey', neutral.length >= 2 && neutral.every(x => x.mark === '' && x.bg === 'rgb(241, 243, 244)'), look);
  check('flagged labels: ⛔ and red', look.filter(x => x.status === 'flagged').every(x => x.mark === '⛔' && x.bg === 'rgb(252, 232, 230)') && look.some(x => x.status === 'flagged'), look);
  check('offline: no icon fetched; nothing beside the sender (the circles show initials)', chips.filter(c => c.chip).every(c => !c.img), chips);
  // Gmail rewrites the rows in place (tab shown again): the icons and labels come back.
  const before = await page.evaluate(() => document.querySelectorAll('tr.zA .unshortener-sender-chip').length);
  await page.evaluate(() => window.__rewriteRows());
  const wiped = await page.evaluate(() => document.querySelectorAll('tr.zA .unshortener-sender-chip').length);
  const after = await until(() => page.evaluate(() => document.querySelectorAll('tr.zA .unshortener-sender-chip').length), n => n === before, 15000);
  check(`rows rewritten in place get their labels back (${before} → ${wiped} → ${after})`, before > 0 && wiped === 0 && after === before, { before, wiped, after });
  const mem = await sw.evaluate(() => new Promise(r => chrome.storage.local.get(['spamMovedThreads', 'recentActivity', 'errorLogs'], r)));
  check('memory records moved threads', mem.spamMovedThreads['thread-f:1001'] && mem.spamMovedThreads['thread-f:1007'] && mem.spamMovedThreads['thread-f:1005'], mem.spamMovedThreads);
  const mem2 = await until(() => sw.evaluate(() => new Promise(r => chrome.storage.local.get(['recentActivity', 'errorLogs', 'spamMovedThreads'], r))), m => (m.recentActivity || []).some(a => a.type === 'Moved to Spam'), 10000);
  console.log('memory later:', mem2.spamMovedThreads);
  check('recent activity shows the move', (mem2.recentActivity || []).some(a => a.type === 'Moved to Spam'), mem2.recentActivity);
  const errs = (mem2.errorLogs || []).filter(e => e.level === 'error');
  check('no errors logged', errs.length === 0, errs);
  console.log((mem2.errorLogs || []).map(e => `${e.level} ${e.source}: ${e.message}`).join('\n'));
  await ctx.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
