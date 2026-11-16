// (5.94.38) Messages that show the reader's own address (teacher@school.org on the fake page). One the reader sent
// (no incoming checks in its headers): no AI opinion, and a link that doesn't work is named above it (a site that
// doesn't exist), never a one-time link. One that only shows the reader's address (it came from outside and
// failed its sender check): a red "Forged" note in its banner, and the AI reads it as any email. Made-up mailboxes.
const { launch, servePage, until, settled, check, part, runParts } = require('./harness');

const RAW = (auth) => [
  ...(auth ? ['Delivered-To: teacher@school.org', 'Received: from mail.bulk-sender.example (mail.bulk-sender.example. [203.0.113.9]) by mx.google.com with ESMTPS id z; Thu, 29 Oct 2026 08:00:00 -0700',
              `Authentication-Results: mx.google.com; spf=fail smtp.mailfrom=teacher@school.org; dmarc=${auth} (p=NONE sp=NONE dis=NONE) header.from=school.org`] : ['Received: by 2002:a05:6a10:e19:b0:76f with SMTP id vc25; Thu, 29 Oct 2026 08:00:00 -0700']),
  'From: Teacher <teacher@school.org>', 'To: parent@freemail.example', 'Subject: Re: field trip', '', 'body'].join('\r\n');
const bannerText = (page) => page.evaluate(() => (document.querySelector('.unshortener-email-banner') || {}).textContent || '');

async function open(raw, links = 'own') {
  global.RAW_MESSAGES = { 'msg-f:3001': raw };
  const { ctx, sw } = await launch();
  await sw.evaluate(() => chrome.storage.local.set({ enableDnsThreatCheck: true, enableAutoSpam: false }));
  await servePage(ctx, 'fake-gmail-thread.html');
  const page = await ctx.newPage();
  await page.goto(`https://mail.google.com/mail/u/0/?links=${links}&from=${encodeURIComponent('teacher@school.org')}&name=Teacher&subj=${encodeURIComponent('Re: field trip')}&t=2201#inbox/FMfcgzOwn`);
  return { ctx, page };
}

part('sent', async () => {
  const { ctx, page } = await open(RAW(null));
  const note = await until(() => page.evaluate(() => (document.querySelector('.unshortener-own-links') || {}).textContent || ''), t => !!t, 30000);
  await settled(page);
  const ai = await page.evaluate(() => !!document.querySelector('.unshortener-ai-box'));
  check('a message you sent gets no AI opinion (nothing shown)', !ai, ai);
  check('a link to a site that doesn\'t exist is named above it', /A link in your email doesn't work/.test(note) && /slides\.no-such-site\.invalid/.test(note) && /doesn't exist/.test(note), note);
  check('a working link and a one-time link are not named', !/example\.com\/[^ ]*:|www\.example\.com/.test(note) && !/reset\?token/.test(note), note);
  check('no "Forged" note on a message you sent', !/Forged/.test(await bannerText(page)));
  await ctx.close();
});

part('forged', async () => {
  const { ctx, page } = await open(RAW('fail'), 'plain');
  const banner = await until(() => bannerText(page), t => /Forged/.test(t), 30000);
  const ai = await until(() => page.evaluate(() => (document.querySelector('.unshortener-ai-box') || {}).dataset || null).then(d => d ? d.state || 'button' : null), s => !!s, 30000);
  check('an email showing your own address that failed its sender check: a "Forged" note in its banner', /Forged: this email says it comes from you \(teacher@school\.org\), but you didn't send it/.test(banner) && /DMARC/.test(banner), banner);
  check('…and the AI still reads it', !!ai, ai);
  check('no broken-link note on a forged email', !(await page.evaluate(() => !!document.querySelector('.unshortener-own-links'))));
  await ctx.close();
});

runParts();
