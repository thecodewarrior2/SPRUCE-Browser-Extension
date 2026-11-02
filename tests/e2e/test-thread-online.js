const { launch, servePage, until, settled, check, done } = require('./harness');
global.RAW_MESSAGES = {
  'msg-f:3001': [
    'Delivered-To: teacher@school.org',
    'Received: by 2002:a05:6400:1::1 with SMTP id x; Thu, 29 Oct 2026 08:00:00 -0700',
    'Received: from mail.evil-scam.test (mail.evil-scam.test. [8.8.8.8]) by mx.google.com with ESMTPS id y; Thu, 29 Oct 2026 08:00:00 -0700',
    'Authentication-Results: mx.google.com; dkim=none; spf=pass (google.com: domain of x) smtp.mailfrom=phisher@evil-scam.test; dmarc=fail (p=NONE) header.from=evil-scam.test',
    'From: IT Support <phisher@evil-scam.test>',
    'To: teacher@school.org',
    'Subject: Your password expires',
    '', 'body'].join('\r\n')
};
(async () => {
  const { ctx, sw } = await launch();
  await servePage(ctx, 'fake-gmail-thread.html');
  await sw.evaluate(async () => { await chrome.storage.local.set({ __testScamSenders: ['phisher@evil-scam.test'] }); });

  // Opened in a label view: never moved, but marked and explained in the email's banner.
  let page = await ctx.newPage();
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto('https://mail.google.com/mail/u/0/#label/work/FMfcgz');
  // In an opened Gmail email the sender's own address is the label (no separate label is drawn).
  const read1 = () => page.evaluate(() => ({ spammed: window.__spammed, status: (document.querySelector('.unshortener-sender-address') || { dataset: {} }).dataset.status, chip: (document.querySelector('.unshortener-sender-address') || {}).textContent, title: (document.querySelector('.unshortener-sender-address') || {}).title, pills: document.querySelectorAll('.unshortener-sender-chip').length,
    flag: document.querySelector('.unshortener-sender-flag') && document.querySelector('.unshortener-sender-flag').title, link: (document.querySelector('.ii.gt a') || {dataset:{}}).dataset.unshortened, banner: (document.querySelector('.unshortener-email-banner') || {}).textContent, img: !!document.querySelector('.unshortener-sender-icon img'), blank: !!document.querySelector('.unshortener-sender-blank') }));
  let r = await until(read1, r => r.link === 'true' && r.status === 'flagged' && /This email is flagged/.test(r.banner || '') && /Sent from a server in/.test(r.flag || '') && r.blank, 15000);
  await settled(page);                               // everything checked and decided: no (wrong) move
  r = Object.assign(await read1(), { });
  console.log(r);
  check('regression: links in the opened email are still checked', r.link === 'true', r.link);
  check('label view: opened flagged email not moved', r.spammed.length === 0, r.spammed);
  check('opened email: the sender\'s address itself is the label, marked flagged (no separate label)', r.status === 'flagged' && /evil-scam\.test/.test(r.chip || '') && r.pills === 0, r);
  check('opened email: the address\'s explanation has the DMARC result', /DMARC fail/.test(r.title || ''), r.title);
  check('opened email: banner explains flagged email', /This email is flagged/.test(r.banner || ''), r.banner);
  check('online: a site without an icon gets a blank space (no globe)', !r.img && r.blank, r);
  check('server country from Gmail delivery header (8.8.8.8 → US)', /Sent from a server in United States/.test(r.flag || ''), r.flag);
  await page.close();

  // A conversation where a colleague also wrote: not moved, even from the inbox.
  page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/?with=colleague@example.com&t=2009#inbox/mixed');
  await until(() => page.evaluate(() => (document.querySelector('.unshortener-sender-address') || { dataset: {} }).dataset.status), st => st && st !== 'pending', 10000);
  await settled(page);                               // everything checked and decided: no (wrong) move
  r = await page.evaluate(() => window.__spammed);
  check('open conversation with a non-flagged sender too: not moved', r.length === 0, r);
  await page.close();

  // Opened from the inbox: moved with the conversation's Report spam button.
  page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/#inbox/FMfcgz');
  await until(() => page.evaluate(() => !!document.querySelector('.unshortener-spam-notice')), v => v, 10000);
  r = await page.evaluate(() => ({ spammed: window.__spammed, hash: location.hash, notice: (document.querySelector('.unshortener-spam-notice') || {}).textContent || null }));
  check('inbox thread view: conversation reported as spam', r.spammed.length === 1 && r.spammed[0] === 'thread-f:2001', r);
  check('inbox thread view: notice shown', /1 email from flagged senders was moved to Spam/.test(r.notice || ''), r.notice);
  await page.close();

  // The user took it back out of Spam: opening it again from the inbox leaves it there.
  page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/#inbox/FMfcgz');
  await until(() => page.evaluate(() => (document.querySelector('.unshortener-sender-address') || { dataset: {} }).dataset.status), st => st === 'flagged', 10000);
  await settled(page);                               // everything checked and decided: no (wrong) move
  r = await page.evaluate(() => ({ spammed: window.__spammed, status: (document.querySelector('.unshortener-sender-address') || { dataset: {} }).dataset.status }));
  check('rescued conversation not moved again (still marked flagged)', r.spammed.length === 0 && r.status === 'flagged', r);
  await page.close();

  // A clean sender, online: real DNS threat checks.
  page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/?from=someone@example.com&t=2002#inbox/abc');
  r = await until(() => page.evaluate(() => { const c = document.querySelector('.unshortener-sender-address'); return c && c.dataset.status; }), st => st === 'clean', 15000);
  r = await page.evaluate(() => { const c = document.querySelector('.unshortener-sender-address'); return { spammed: window.__spammed, status: c && c.dataset.status, mark: c && c.dataset.mark, title: c && c.title, bg: c && getComputedStyle(c).backgroundColor }; });
  console.log(r);
  check('online clean domain (example.com): checked, not moved', r.status === 'clean' && /Checked/.test(r.title || '') && r.spammed.length === 0, r);
  check('checked sender: the address looks unchanged (no mark, no color); the explanation shows on pointing', r.mark === '' && r.bg === 'rgba(0, 0, 0, 0)' && /Checked/.test(r.title || ''), r);
  await page.close();

  // 5.87 regression: leaving the conversation isn't proof of a move. Gmail ignores the press here
  // (?keepspam=1) and the user goes back to an inbox that still shows the row: the move must be
  // logged as failed, never as moved.
  page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/?t=2077&keepspam=1&listafter=1#inbox/kp');
  await until(() => page.evaluate(() => window.__spammed.length), n => n >= 1, 20000);
  await page.evaluate(() => window.__back());                     // the user leaves on their own
  const kp = await until(() => sw.evaluate(() => new Promise(res => chrome.storage.local.get({ spamMoveLog: [] }, r => res(r.spamMoveLog.filter(e => e.thread === 'thread-f:2077').map(e => [e.action, e.how || '']))))), l => l && l.length > 0, 30000);
  check('ignored Report spam + user navigation: logged as failed (row still in the inbox), never as moved',
    kp && kp.length > 0 && kp.every(([a]) => a === 'failed') && /row was still in the inbox/.test(kp[0][1]), kp);
  r = await page.evaluate(() => ({ rows: document.querySelectorAll('tr.zA').length, notice: !!document.querySelector('.unshortener-spam-notice') }));
  check('ignored press: the row stays and no "moved to Spam" notice appears', r.rows === 1 && !r.notice, r);
  await page.close();

  // The true positive with the same list visible: the row is gone, so the move counts.
  page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/?t=2078&listafter=1#inbox/la');
  await until(() => page.evaluate(() => window.__spammed.length), n => n >= 1, 20000);
  const la = await until(() => sw.evaluate(() => new Promise(res => chrome.storage.local.get({ spamMoveLog: [] }, r => res(r.spamMoveLog.filter(e => e.thread === 'thread-f:2078').map(e => e.action))))), l => l && l.includes('moved'), 30000);
  check('move confirmed by the row being gone from the list', la && la.includes('moved') && !la.includes('failed'), la);
  await page.close();

  const logs = await sw.evaluate(() => new Promise(res => chrome.storage.local.get(['errorLogs', 'geoCache', 'senderDomainCache'], res)));
  console.log((logs.errorLogs || []).map(e => `${e.level} ${e.source}: ${e.message}`).join('\n'));
  console.log('geoCache', logs.geoCache, 'domains', Object.keys(logs.senderDomainCache || {}));
  check('no errors logged', !(logs.errorLogs || []).some(e => e.level === 'error'));
  await ctx.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
