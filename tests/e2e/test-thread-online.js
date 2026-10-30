const { launch, servePage, sleep, until, check, done } = require('./harness');
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
  const read1 = () => page.evaluate(() => ({ spammed: window.__spammed, chip: (document.querySelector('.unshortener-sender-chip') || {}).textContent, title: (document.querySelector('.unshortener-sender-chip') || {}).title,
    flag: document.querySelector('.unshortener-sender-flag') && document.querySelector('.unshortener-sender-flag').title, link: (document.querySelector('.ii.gt a') || {dataset:{}}).dataset.unshortened, banner: (document.querySelector('.unshortener-email-banner') || {}).textContent, img: !!document.querySelector('.unshortener-sender-icon img'), blank: !!document.querySelector('.unshortener-sender-blank') }));
  let r = await until(read1, r => r.link === 'true' && /Flagged sender/.test(r.chip || '') && /This email is flagged/.test(r.banner || '') && /Sent from a server in/.test(r.flag || '') && r.blank, 15000);
  await sleep(2000);                                 // long enough for a (wrong) move to have happened
  r = Object.assign(await read1(), { });
  console.log(r);
  check('regression: links in the opened email are still checked', r.link === 'true', r.link);
  check('label view: opened flagged email not moved', r.spammed.length === 0, r.spammed);
  check('opened email: chip says flagged', /evil-scam\.test · Flagged sender/.test(r.chip || ''), r.chip);
  check('opened email: chip tooltip has DMARC result', /DMARC fail/.test(r.title || ''), r.title);
  check('opened email: banner explains flagged email', /This email is flagged/.test(r.banner || ''), r.banner);
  check('online: a site without an icon gets a blank space (no globe)', !r.img && r.blank, r);
  check('server country from Gmail delivery header (8.8.8.8 → US)', /Sent from a server in United States/.test(r.flag || ''), r.flag);
  await page.close();

  // A conversation where a colleague also wrote: not moved, even from the inbox.
  page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/?with=colleague@example.com&t=2009#inbox/mixed');
  await until(() => page.evaluate(() => (document.querySelector('.unshortener-sender-chip') || { dataset: {} }).dataset.status), st => st && st !== 'pending', 10000);
  await sleep(3000);                                 // long enough for a (wrong) move to have happened
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
  await until(() => page.evaluate(() => (document.querySelector('.unshortener-sender-chip') || {}).textContent || ''), t => /Flagged/.test(t), 10000);
  await sleep(3000);                                 // long enough for a (wrong) move to have happened
  r = await page.evaluate(() => ({ spammed: window.__spammed, chip: (document.querySelector('.unshortener-sender-chip') || {}).textContent }));
  check('rescued conversation not moved again', r.spammed.length === 0 && /Flagged/.test(r.chip || ''), r);
  await page.close();

  // A clean sender, online: real DNS threat checks.
  page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/?from=someone@example.com&t=2002#inbox/abc');
  r = await until(() => page.evaluate(() => { const c = document.querySelector('.unshortener-sender-chip'); return c && c.dataset.status; }), st => st === 'clean', 15000);
  r = await page.evaluate(() => { const c = document.querySelector('.unshortener-sender-chip'); return { spammed: window.__spammed, status: c && c.dataset.status, chip: c && c.textContent, title: c && c.title, bg: c && getComputedStyle(c).backgroundColor }; });
  console.log(r);
  check('online clean domain (example.com): checked, not moved', r.status === 'clean' && /Checked/.test(r.title || '') && r.spammed.length === 0, r);
  check('checked sender: plain label (domain only, no mark, neutral color)', r.chip === 'example.com' && r.bg === 'rgb(241, 243, 244)', r);
  await page.close();

  const logs = await sw.evaluate(() => new Promise(res => chrome.storage.local.get(['errorLogs', 'geoCache', 'senderDomainCache'], res)));
  console.log((logs.errorLogs || []).map(e => `${e.level} ${e.source}: ${e.message}`).join('\n'));
  console.log('geoCache', logs.geoCache, 'domains', Object.keys(logs.senderDomainCache || {}));
  check('no errors logged', !(logs.errorLogs || []).some(e => e.level === 'error'));
  await ctx.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
