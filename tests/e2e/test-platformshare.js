// [5.102] Shares sent through a platform, in an opened Gmail email (fake page, no network: threat checks off).
//   share:     a real Google Docs notification (google.com, DMARC pass for it) from an account at another district,
//              naming the reader's superintendent (a learned colleague), copied to 29 of the district's people:
//              flagged, its reasons say it was shared from outside, names a colleague and was copied to many;
//   unlearned: the same with no colleague learned: caution (outside, copied to many);
//   inside:    a colleague's own share from the district's domain, naming the superintendent: no warning;
//   mismatch:  "(via Dropbox)" sent from google.com: flagged, the platform named and the one that sent it differ.
// Fictional people, districts and addresses only.
const { launch, servePage, until, settled, check, part, runParts } = require('./harness');

const OWN = 'school.org';   // the fake page's account: teacher@school.org
const RAW = ({ name, replyTo, ccOwn = 0 }) => [
  `Delivered-To: teacher@${OWN}`,
  'Received: from mail-sor-f69.google.com (mail-sor-f69.google.com. [209.85.220.69]) by mx.google.com with SMTPS id y; Sat, 14 Nov 2026 03:40:41 +0000',
  'Authentication-Results: mx.google.com; dkim=pass header.i=@google.com header.s=20260707; spf=pass smtp.mailfrom=x@doclist.bounces.google.com; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=google.com',
  `From: "${name}" <drive-shares-dm-noreply@google.com>`,
  ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
  `To: teacher@${OWN}`,
  ...(ccOwn ? [`Cc: ${Array.from({ length: ccOwn }, (_, i) => `staff${i + 1}@${OWN}`).join(', ')}, someone@gmail.com`] : []),
  'Subject: Document shared with you',
  'MIME-Version: 1.0', '', 'body'].join('\r\n');

const verdict = (page) => page.evaluate(() => {
  const a = document.querySelector('.unshortener-sender-address');
  const b = document.querySelector('.unshortener-email-banner');
  return { status: a ? a.dataset.status || '' : '', banner: b ? b.textContent : '' };
});

async function open({ links, name, replyTo, ccOwn, learn = [] }) {
  global.RAW_MESSAGES = { 'msg-f:3001': RAW({ name, replyTo, ccOwn }) };
  const { ctx, sw } = await launch();
  await sw.evaluate(async ({ own, learn }) => {
    await chrome.storage.local.set({ enableDnsThreatCheck: false, enableAutoSpam: false, colleagueNameHashes: learn.map(n => colleagueNameHash(n)) });
  }, { own: OWN, learn });
  await servePage(ctx, 'fake-gmail-thread.html');
  const page = await ctx.newPage();
  await page.goto(`https://mail.google.com/mail/u/0/?links=${links}&from=${encodeURIComponent('drive-shares-dm-noreply@google.com')}&name=${encodeURIComponent(name)}&subj=${encodeURIComponent('Document shared with you')}#inbox/FMfcgzShare`);
  return { ctx, page };
}
const settledVerdict = async (page, want) => { const v = await until(() => verdict(page), x => x && x.status && x.status !== 'pending' && (!want || want(x)), 20000); await settled(page); return Object.assign(v, await verdict(page)); };

part('share', async () => {
  const { ctx, page } = await open({ links: 'share', name: 'Robin Castillo (via Google Docs)', replyTo: 'Robin Castillo <rcastillo@ridgeview-ufsd.example>', ccOwn: 29, learn: ['Dana Whitfield'] });
  const v = await settledVerdict(page, x => x.status === 'flagged');
  check('an outside account\'s share naming our superintendent, copied to 29 of our people (30 with the reader): flagged', v.status === 'flagged', v);
  check('…because it was shared from outside, names a colleague, and was copied to many of our people',
    /sent it for someone outside your organization \(ridgeview-ufsd\.example\)/.test(v.banner) && /names someone in your organization/.test(v.banner) && /with 30 people of your organization at once/.test(v.banner), v.banner);
  await ctx.close();
});

part('unlearned', async () => {
  const { ctx, page } = await open({ links: 'share', name: 'Robin Castillo (via Google Docs)', replyTo: 'Robin Castillo <rcastillo@ridgeview-ufsd.example>', ccOwn: 29 });
  const v = await settledVerdict(page, x => x.status === 'caution');
  check('the same with no colleague learned: caution (outside, copied to many)', v.status === 'caution' && !/names someone in your organization/.test(v.banner), v);
  await ctx.close();
});

part('inside', async () => {
  const { ctx, page } = await open({ links: 'shareinside', name: 'Casey Tanaka (via Google Docs)', replyTo: `Casey Tanaka <ctanaka@${OWN}>`, ccOwn: 0, learn: ['Dana Whitfield', 'Casey Tanaka'] });
  await page.waitForSelector('#doc', { timeout: 15000 });
  const v = await settledVerdict(page);
  check('a colleague\'s own share from our domain, naming the superintendent: no warning', !['flagged', 'caution'].includes(v.status) && !/outside your organization|names someone/.test(v.banner), v);
  await ctx.close();
});

part('mismatch', async () => {
  const { ctx, page } = await open({ links: 'share', name: 'Robin Castillo (via Dropbox)', replyTo: 'Robin Castillo <rcastillo@ridgeview-ufsd.example>' });
  const v = await settledVerdict(page, x => x.status === 'flagged');
  check('"via Dropbox" sent from google.com: flagged, the platform named and the one that sent it differ', v.status === 'flagged' && /says it comes via Dropbox \(Dropbox's\), but it was sent from google\.com, which is Google's/.test(v.banner), v);
  await ctx.close();
});

runParts();
