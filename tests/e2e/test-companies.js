// 5.90 company matching, in an opened Gmail email (fake page, no network: threat checks off).
//   [5.90-2] a link to the company's own ending (go.amex) under text showing its main site: not marked;
//   [5.90-3] a link whose text shows the site of the email's verified sender but goes to a domain not
//            known to be the company's: red at first, amber once the sender is verified, and the
//            email isn't moved to Spam for it; without the verification it stays red;
//            (also when every link was red at first: no move to Spam);
//   [5.90-4] a company's name under another ending (amazon.de under text amazon.com): amber, as no
//            lookups may show whose it is.
// Fictional mailboxes only (company domains, made-up addresses).
const { launch, servePage, until, settled, check, part, runParts } = require('./harness');

const RAW = (from, dmarc) => [
  'Delivered-To: teacher@school.org',
  'Received: from mail.welcome.americanexpress.com (mail.welcome.americanexpress.com. [203.0.113.7]) by mx.google.com with ESMTPS id y; Thu, 29 Oct 2026 08:00:00 -0700',
  `Authentication-Results: mx.google.com; dkim=${dmarc === 'pass' ? 'pass' : 'fail'} header.i=@${from}; spf=pass smtp.mailfrom=news@${from}; dmarc=${dmarc} (p=REJECT sp=REJECT dis=NONE) header.from=${from}`,
  `From: American Express <news@${from}>`,
  'To: teacher@school.org',
  'Subject: Your monthly update',
  '', 'body'].join('\r\n');

// What the extension made of a link: how it's drawn (red or amber) and what its hover card says.
const linkState = (page, id) => page.evaluate((id) => {
  const a = document.getElementById(id);
  if (!a) return null;
  const bg = a.style.backgroundColor;
  return { checked: a.dataset.unshortened, look: bg === 'rgb(217, 48, 37)' ? 'red' : bg === 'rgb(254, 247, 224)' ? 'amber' : 'none', info: a.dataset.unshortenerInfo || '' };
}, id);
const bannerText = (page) => page.evaluate(() => (document.querySelector('.unshortener-email-banner') || {}).textContent || '');

async function open(links, raw, from = 'news@welcome.americanexpress.com', name = 'American Express', settings = {}) {
  global.RAW_MESSAGES = { 'msg-f:3001': raw };
  const { ctx, sw } = await launch();
  await sw.evaluate((s) => chrome.storage.local.set(Object.assign({ enableDnsThreatCheck: false }, s)), settings);
  await servePage(ctx, 'fake-gmail-thread.html');
  const page = await ctx.newPage();
  await page.goto(`https://mail.google.com/mail/u/0/?links=${links}&from=${encodeURIComponent(from)}&name=${encodeURIComponent(name)}&t=2101#inbox/FMfcgzCompanies`);
  return { ctx, page };
}

part('verified', async () => {
  const { ctx, page } = await open('company', RAW('welcome.americanexpress.com', 'pass'));
  const other = await until(() => linkState(page, 'other'), s => s && s.checked === 'true' && s.look === 'amber', 15000);
  await settled(page);
  const own = await linkState(page, 'own');
  const banner = await bannerText(page);
  const spammed = await page.evaluate(() => window.__spammed);
  check('[5.90-2] text americanexpress.com, link go.amex (the company\'s own ending): not marked', own && own.checked === 'true' && own.look === 'none', own);
  check('[5.90-3] text showing the verified sender\'s own site, link elsewhere: amber, not red', other && other.look === 'amber' && /verified sender/.test(other.info), other);
  check('[5.90-3] the banner calls no link dangerous', !/flagged as dangerous/.test(banner), banner);
  check('[5.90-3] not moved to Spam', spammed.length === 0, spammed);
  await ctx.close();
});

part('forged', async () => {
  // Moving it to Spam is off here: a forged sender is moved, which empties the fake page before it can be read.
  const { ctx, page } = await open('company', RAW('welcome.americanexpress.com', 'fail'), undefined, undefined, { enableAutoSpam: false });
  const other = await until(() => linkState(page, 'other'), s => s && s.checked === 'true' && s.look === 'red', 15000);
  await settled(page);
  const banner = await bannerText(page);
  check('[5.90-3] sender verification failed: the same link stays red', other && other.look === 'red', other);
  check('[5.90-3] sender verification failed: the banner calls the link dangerous', /dangerous/.test(banner), banner);
  await ctx.close();
});

// Every link red at first would make the email flagged and moved to Spam (as 5.89 did with a genuine
// email like this); once the sender is verified they are amber, and nothing is moved.
part('allred', async () => {
  const { ctx, page } = await open('allred', RAW('welcome.americanexpress.com', 'pass'));
  const both = await until(() => Promise.all([linkState(page, 'r1'), linkState(page, 'r2')]), v => v.every(s => s && s.checked === 'true' && s.look === 'amber'), 15000);
  await settled(page);
  const spammed = await page.evaluate(() => window.__spammed);
  check('[5.90-3] every link showing the verified sender\'s site: all amber', both.every(s => s && s.look === 'amber'), both);
  check('[5.90-3] and the email is not moved to Spam for them', spammed.length === 0, spammed);
  await ctx.close();
});

part('name', async () => {
  const { ctx, page } = await open('name', RAW('amazon.com', 'pass').replace(/American Express/g, 'Amazon'), 'shipment@amazon.com', 'Amazon');
  const s = await until(() => linkState(page, 'name'), s => s && s.checked === 'true', 15000);
  await settled(page);
  const after = await linkState(page, 'name');
  check('[5.90-4] text amazon.com, link amazon.de with no lookups allowed: amber, with the reason', after && after.look === 'amber' && /amazon\.de carries Amazon's name/.test(after.info), { s, after });
  await ctx.close();
});

runParts();
