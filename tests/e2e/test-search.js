// Search results: flagged emails found by a search are moved to Spam as in the inbox (also when Gmail
// splits the results into sections), but never from a search in Spam, Trash or Sent, and not when
// the setting is off. A sender named as the user's own mailbox name in any case is red at Gmail.
const { launch, servePage, until, sleep, check, part, runParts } = require('./harness');

// The default fake list: 1001 and 1007 are flagged senders, 1005 was taken back out of Spam before.
async function start(hash, settings = {}, query = '') {
  const { ctx, sw } = await launch();
  await sw.evaluate((s) => chrome.storage.local.set(Object.assign({
    __testScamSenders: ['phisher@evil-scam.test', 'billing@evil-scam.test', 'rescued@evil-scam.test'],
    spamMovedThreads: { 'thread-f:1005': Date.now() - 1000 },
    enableDnsThreatCheck: false
  }, s)), settings);
  await servePage(ctx, 'fake-gmail-list.html');
  const page = await ctx.newPage();
  await page.goto(`https://mail.google.com/mail/u/0/${query}#${hash}`);
  return { ctx, sw, page };
}
const spammed = (page) => page.evaluate(() => window.__spammed);
const flaggedShown = (page) => page.evaluate(() => document.querySelectorAll('.unshortener-sender-chip[data-status="flagged"]').length);

part('moves', async () => {
  const { ctx, page } = await start('search/invoice');
  const moved = await until(() => spammed(page), s => s.length >= 2, 15000);
  await sleep(1500);                                  // long enough for a (wrong) third move
  const all = await spammed(page);
  check('search results: flagged emails are moved (1001, 1007)', moved.includes('#thread-f:1001') && moved.includes('#thread-f:1007'), all);
  check('search results: the one taken back out of Spam, and clean ones, are not', all.length === 2 && !all.includes('#thread-f:1005'), all);
  await ctx.close();
});

part('sections', async () => {
  // Gmail can split search results into sections (two tables); moving still happens there.
  const { ctx, page } = await start('search/invoice', {}, '?multi=1');
  const moved = await until(() => spammed(page), s => s.length >= 2, 15000);
  check('search results in sections: flagged emails are moved', moved.includes('#thread-f:1001') && moved.includes('#thread-f:1007'), moved);
  await ctx.close();
});

part('excluded', async () => {
  for (const hash of ['search/in%3Atrash+invoice', 'search/in%3Asent+invoice', 'search/in%3Aanywhere+invoice']) {
    const { ctx, page } = await start(hash);
    await until(() => flaggedShown(page), n => n >= 2, 10000);
    await sleep(3000);
    const all = await spammed(page);
    check(`#${hash}: marked red, but nothing is moved`, all.length === 0 && (await flaggedShown(page)) >= 2, all);
    await ctx.close();
  }
});

part('off', async () => {
  const { ctx, page } = await start('search/invoice', { enableAutoSpamInSearch: false });
  await until(() => flaggedShown(page), n => n >= 2, 10000);
  await sleep(3000);
  const all = await spammed(page);
  check('setting off: nothing moved from search results (still marked red)', all.length === 0, all);
  await ctx.close();
});

part('own-name-any-case', async () => {
  // Signed in at Gmail as sample_user@gmail.com: "Sample_user" from a stranger's address is red.
  const { ctx, page } = await start('inbox', { enableAutoSpam: false }, '?title=' + encodeURIComponent('Inbox - sample_user@gmail.com - Gmail'));
  await sleep(500);
  await page.evaluate(() => window.__arrive([{ t: 9201, email: 'order_sender@gmail.com', name: 'Sample_user', subj: 'Your Order Acknowledgement', unread: true }]));
  const l = await until(() => page.evaluate(() => {
    const chip = document.querySelector('[data-thread-id="#thread-f:9201"]').closest('tr').querySelector('.unshortener-sender-chip');
    return chip ? { status: chip.dataset.status, title: chip.title } : null;
  }), x => x && x.status === 'flagged', 10000);
  check('Gmail account: your mailbox name, capitalized, from a stranger is red without opening', l && l.status === 'flagged' && /your own mailbox name/.test(l.title), l);
  await ctx.close();
});

runParts().catch(e => { console.error(e); process.exit(1); });
