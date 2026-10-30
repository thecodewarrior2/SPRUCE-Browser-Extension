// The Spam folder: emails that the same checks would move to Spam are red there, whether the extension
// moved them or not; unread ones are checked too (their headers are read). Anything else there isn't
// red and says Gmail or the user put it there. Reading an unread email's headers must never mark it
// read: if it ever does, the extension stops reading them.
const fs = require('fs'), path = require('path');
const { launch, servePage, until, sleep, check, part, runParts, waitForLog } = require('./harness');
const sample = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'scam4.eml'), 'utf8');   // forged records copied from 2 other people's emails
const FORGED = 'contact_support.pum@chariots.example';
const msgId = (t) => `msg-f:${t * 7 + 0x10000000}`;
const clean = (from) => `Received: from mail.example.com ([203.0.113.5]) by mx.google.com; Thu, 07 Nov 2024 11:52:24 -0800\nFrom: Someone <${from}>\nMIME-Version: 1.0\n\nhi`;

async function start(hash, settings = {}, rows) {
  const { ctx, sw } = await launch();
  global.RAW_MESSAGES = { [msgId(9101)]: sample, [msgId(9104)]: sample, [msgId(9102)]: clean('friend@example.com'), [msgId(9103)]: clean('news@example.org') };
  await servePage(ctx, 'fake-gmail-list.html');
  await sw.evaluate(async (settings) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set(Object.assign({
      enableDnsThreatCheck: false, enableAutoSpam: false,
      // The extension moved conversation 9103 earlier, because of its links (seen when it was opened).
      spamMovedThreads: { 'thread-f:9103': Date.now() - 3600e3 },
      spamMoveLog: [{ ts: Date.now() - 3600e3, action: 'moved', thread: 'thread-f:9103', sender: 'news@example.org', reason: 'All 3 of its links are flagged as dangerous.', how: 'when opened' }]
    }, settings));
  }, settings);
  const page = await ctx.newPage();
  await page.goto(`https://mail.google.com/mail/u/0/#${hash}`);
  await sleep(500);
  await page.evaluate((rows) => window.__arrive(rows), rows || [
    { t: 9101, email: FORGED, name: 'Benefits Card', subj: 'Login Verification', unread: true },
    { t: 9102, email: 'friend@example.com', name: 'Friend', subj: 'Lunch', unread: false },
    { t: 9103, email: 'news@example.org', name: 'News', subj: 'Offer', unread: true }]);
  return { ctx, sw, page };
}
const label = (page, t) => page.evaluate((t) => {
  const el = document.querySelector(`[data-thread-id="#thread-f:${t}"]`);
  const chip = el && el.closest('tr').querySelector('.unshortener-sender-chip');
  return chip ? { status: chip.dataset.status, title: chip.title } : null;
}, t);
const settled = (l) => l && l.status && l.status !== 'pending';

part('spam', async () => {
  const { ctx, page } = await start('spam');
  const a = await until(() => label(page, 9101), l => l && l.status === 'flagged', 10000);
  check('Spam, unread: its headers are read, and forged records copied from other people\'s emails make it red', a && a.status === 'flagged' && /copied from emails to 2 other people/.test(a.title), a);
  const c = await until(() => label(page, 9103), l => l && l.status === 'flagged', 8000);
  check('Spam: an email the extension moved is red, with why it was moved', c && c.status === 'flagged' && /moved it to Spam/.test(c.title) && /links are flagged as dangerous/.test(c.title), c);
  const b = await until(() => label(page, 9102), settled, 8000);
  check('Spam: an email no check flags isn\'t red, and says Gmail or you put it there', b && b.status !== 'flagged' && /Gmail put it in Spam, or you did/.test(b.title), b);
  await ctx.close();
});

part('inbox-unchanged', async () => {
  // In the inbox an unread email's headers are still never read.
  const { ctx, page } = await start('inbox');
  const a = await until(() => label(page, 9101), settled, 8000);
  await sleep(1500);
  const again = await label(page, 9101);
  check('inbox, unread: headers not read (not red), as before', again && again.status !== 'flagged' && !/copied from emails/.test(again.title), again);
  await ctx.close();
});

part('off', async () => {
  const { ctx, page } = await start('spam', { enableSpamFolderFlags: false });
  const a = await until(() => label(page, 9101), settled, 8000);
  await sleep(1500);
  const [again, moved] = [await label(page, 9101), await label(page, 9103)];
  check('switched off: unread emails in Spam aren\'t read, moved ones aren\'t marked', again && again.status !== 'flagged' && moved && !/moved it to Spam/.test(moved.title), { again, moved });
  await ctx.close();
});

part('mark-read-guard', async () => {
  const { ctx, sw, page } = await start('spam');
  await until(() => label(page, 9101), l => l && l.status === 'flagged', 10000);
  // Gmail shows that email as read although nobody opened it (as if reading its headers had marked it).
  await page.evaluate(() => { const tr = document.querySelector('[data-thread-id="#thread-f:9101"]').closest('tr');
    tr.replaceWith(row({ t: 9101, email: 'contact_support.pum@chariots.example', name: 'Benefits Card', subj: 'Login Verification', unread: false })); });
  const off = await until(() => sw.evaluate(async () => (await chrome.storage.local.get('spamUnreadHeadersOff')).spamUnreadHeadersOff), v => !!v, 8000);
  const logged = (await waitForLog(sw, /unread emails in Spam/)).some(m => /unread emails in Spam/.test(m));
  check('an email turned read after its headers were read: the extension stops reading unread ones, and says so', !!off && logged, { off, logged });
  await page.evaluate(() => window.__arrive([{ t: 9104, email: 'contact_support.pum@chariots.example', name: 'Benefits Card', subj: 'Login Verification 2', unread: true }]));
  const d = await until(() => label(page, 9104), settled, 8000);
  await sleep(1500);
  const again = await label(page, 9104);
  check('…the next unread email in Spam is checked without reading its headers', again && !/copied from emails/.test(again.title), again);
  await ctx.close();
});

runParts().catch(e => { console.error(e); process.exit(1); });
