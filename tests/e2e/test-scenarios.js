const { launch, servePage, waitFor, until, settled, listSettled, check, part, runParts } = require('./harness');
const BASE = { __testScamSenders: ['phisher@evil-scam.test', 'billing@evil-scam.test', 'rescued@evil-scam.test'], spamMovedThreads: { 'thread-f:1005': 1 }, enableDnsThreatCheck: false };
// moves: how many emails should be moved (waits until they are); 0 or none: waits until the badges are
// drawn, then long enough for a move to have happened (they take about 2 s after the page loads).
async function scenario(ctx, sw, name, storage, url, before, moves) {
  await sw.evaluate(async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }, storage);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`[${name}] pageerror:`, e.message));
  if (before) await before(page);
  await page.goto(url);
  await listSettled(page, sw, moves);
  const r = await page.evaluate(() => ({ spammed: window.__spammed, dialog: window.__dialogClicked || null, chips: document.querySelectorAll('.unshortener-sender-chip').length,
    icons: document.querySelectorAll('.unshortener-sender-icon').length, selected: [...document.querySelectorAll('tr.zA.x7')].map(r => r.querySelector('[data-thread-id]').getAttribute('data-thread-id')),
    notice: (document.querySelector('.unshortener-spam-notice') || {}).textContent || null }));
  r.page = page;
  return r;
}
// A fresh browser per part, so the parts can run in parallel.
async function browser() { const b = await launch(); await servePage(b.ctx, 'fake-gmail-list.html'); return b; }

part('dialogs-selection', async () => {
  const { ctx, sw } = await browser();
  let r;
  r = await scenario(ctx, sw, 'unsub dialog', BASE, 'https://mail.google.com/mail/u/0/?dialog=unsub#inbox', null, 2);
  check('dialog: plain "Report spam" chosen, never unsubscribe', r.dialog === 'Report spam' && r.spammed.length === 2, r);
  await r.page.close();

  r = await scenario(ctx, sw, 'unknown dialog', BASE, 'https://mail.google.com/mail/u/0/?dialog=weird#inbox');
  check('unclear dialog: cancelled, nothing moved', r.dialog === 'Escape' && r.spammed.length === 0, r);
  check('unclear dialog: our selection undone', r.selected.length === 0, r.selected);
  check('unclear dialog: no notice', r.notice === null, r.notice);
  const mem = await sw.evaluate(() => new Promise(res => chrome.storage.local.get('spamMovedThreads', res)));
  check('unclear dialog: remembered as attempted (never tried again), not logged as moved', !!mem.spamMovedThreads['thread-f:1001'], mem);
  const act = await sw.evaluate(() => new Promise(res => chrome.storage.local.get('recentActivity', res)));
  check('unclear dialog: no "Moved to Spam" activity', !(act.recentActivity || []).some(a => a.type === 'Moved to Spam'), act.recentActivity);
  await r.page.close();

  r = await scenario(ctx, sw, 'user selection', BASE, 'https://mail.google.com/mail/u/0/#inbox', async (page) => {
    await page.addInitScript(() => { setTimeout(() => { const cb = document.querySelector('tr.zA:nth-child(2) [role=checkbox]'); cb && cb.click(); }, 600); });
  });
  check('user has a row selected: nothing moved, selection untouched', r.spammed.length === 0 && r.selected.length === 1 && r.selected[0] === '#thread-f:1002', r);
  await r.page.evaluate(() => document.querySelector('tr.zA:nth-child(2) [role=checkbox]').click());
  await r.page.evaluate(() => document.body.appendChild(document.createElement('tr')));   // any change: next scan
  await r.page.evaluate(() => { const tr = document.createElement('tr'); tr.className = 'zA'; document.getElementById('list').appendChild(tr); });
  const later = (await waitFor(() => r.page.evaluate(() => window.__spammed.length >= 2 && window.__spammed), 12000)) || await r.page.evaluate(() => window.__spammed);
  check('after the user deselects, flagged rows are moved', later.length === 2, later);
  await r.page.close();
  await ctx.close();
});

part('views', async () => {
  const { ctx, sw } = await browser();
  let r;
  for (const view of ['#spam', '#trash', '#search/in%3Atrash+evil', '#label/work', '#all', '#sent']) {
    r = await scenario(ctx, sw, 'view ' + view, BASE, 'https://mail.google.com/mail/u/0/' + view);
    check(`view ${view}: nothing moved (badges still shown)`, r.spammed.length === 0 && r.chips > 0, r);
    await r.page.close();
  }
  // Search results are moved like the inbox (test-search.js covers the rest).
  r = await scenario(ctx, sw, 'search', BASE, 'https://mail.google.com/mail/u/0/#search/evil', null, 2);
  check('search results: moved', r.spammed.length === 2, r);
  await r.page.close();
  r = await scenario(ctx, sw, 'category', BASE, 'https://mail.google.com/mail/u/0/#category/promotions', null, 2);
  check('inbox category tab: moved', r.spammed.length === 2, r);
  await r.page.close();

  await ctx.close();
});

part('settings', async () => {
  const { ctx, sw } = await browser();
  let r;
  r = await scenario(ctx, sw, 'autoSpam off', Object.assign({}, BASE, { enableAutoSpam: false }), 'https://mail.google.com/mail/u/0/#inbox');
  check('auto-spam off: nothing moved, chips shown', r.spammed.length === 0 && r.chips === 6, r);
  await r.page.close();

  r = await scenario(ctx, sw, 'notice off', Object.assign({}, BASE, { enableSpamNotice: false }), 'https://mail.google.com/mail/u/0/#inbox', null, 2);
  check('notice off: moved, no notice', r.spammed.length === 2 && r.notice === null, r);
  await r.page.close();

  r = await scenario(ctx, sw, 'identity off', Object.assign({}, BASE, { enableSenderIdentity: false }), 'https://mail.google.com/mail/u/0/#inbox', null, 2);
  check('identity off: no badges, flagged still moved', r.spammed.length === 2 && r.chips === 0 && r.icons === 0, r);
  await r.page.close();

  r = await scenario(ctx, sw, 'address check off', Object.assign({}, BASE, { enableSenderAddressCheck: false }), 'https://mail.google.com/mail/u/0/#inbox');
  check('address check off: list not used, nothing moved', r.spammed.length === 0, r);
  await r.page.close();

  r = await scenario(ctx, sw, 'all off', Object.assign({}, BASE, { enableSenderIdentity: false, enableSenderAddressCheck: false, enableSenderDomainCheck: false }), 'https://mail.google.com/mail/u/0/#inbox');
  check('all sender features off: nothing drawn or moved', r.spammed.length === 0 && r.chips === 0 && r.icons === 0, r);
  // Turning identity back on while the page is open draws the badges without a reload.
  await sw.evaluate(() => chrome.storage.local.set({ enableSenderIdentity: true, enableAutoSpam: false }));
  const chipsNow = (await waitFor(() => r.page.evaluate(() => document.querySelectorAll('.unshortener-sender-chip').length === 6 && 6), 6000)) || await r.page.evaluate(() => document.querySelectorAll('.unshortener-sender-chip').length);
  check('setting switched on live: badges appear', chipsNow === 6, chipsNow);
  await sw.evaluate(() => chrome.storage.local.set({ enableSenderIdentity: false }));
  const chipsOff = await waitFor(() => r.page.evaluate(() => document.querySelectorAll('.unshortener-sender-chip, .unshortener-sender-icon').length === 0), 6000) ? 0 : await r.page.evaluate(() => document.querySelectorAll('.unshortener-sender-chip, .unshortener-sender-icon').length);
  check('setting switched off live: badges removed', chipsOff === 0, chipsOff);
  await r.page.close();

  r = await scenario(ctx, sw, 'allowlisted', Object.assign({}, BASE, { __testScamSenders: [], customAllowlist: ['evil-scam.test'] }), 'https://mail.google.com/mail/u/0/#inbox');
  check('domain on the trusted list and no explicit entry: nothing moved', r.spammed.length === 0, r);
  await r.page.close();

  r = await scenario(ctx, sw, 'old block-list policy', Object.assign({}, BASE, { __testScamSenders: [], __testManaged: { managedPhishingSenders: ['@evil-scam.test', 'phisher@evil-scam.test'] } }), 'https://mail.google.com/mail/u/0/#inbox');
  check('removed sender block list: an old policy flags and moves nothing', r.spammed.length === 0, r);
  await r.page.close();

  await ctx.close();
});

part('memory', async () => {
  const { ctx, sw } = await browser();
  let r;
  r = await scenario(ctx, sw, 'mixed conversation', BASE, 'https://mail.google.com/mail/u/0/?mixed=1#inbox');
  check('row with a flagged and a clean sender: not moved; others still moved', !r.spammed.includes('#thread-f:1001') && r.spammed.includes('#thread-f:1007'), r);
  await r.page.close();

  r = await scenario(ctx, sw, 'multiple inboxes', BASE, 'https://mail.google.com/mail/u/0/?multi=1#inbox');
  check('several list sections on the inbox page: nothing moved from the list', r.spammed.length === 0, r);
  await r.page.close();

  // Gmail itself put a conversation in Spam; the user takes it out with Not spam: never moved back.
  r = await scenario(ctx, sw, 'rescue', Object.assign({}, BASE, { spamMovedThreads: {} }), 'https://mail.google.com/mail/u/0/#spam');
  await r.page.evaluate(() => document.querySelector('[data-thread-id="#thread-f:1001"]').closest('tr').querySelector('[role=checkbox]').click());
  await r.page.mouse.move(0, 0);
  const nb = await r.page.$('#notSpamBtn');
  await nb.click();
  const mem2 = await until(() => sw.evaluate(() => new Promise(res => chrome.storage.local.get(['spamMovedThreads', 'spamRescuedThreads'], res))), m => !!(m.spamRescuedThreads || {})['thread-f:1001'], 10000);
  check('Not spam in the Spam folder: remembered in its own list', !!(mem2.spamRescuedThreads || {})['thread-f:1001'] && !(mem2.spamMovedThreads || {})['thread-f:1001'], mem2);
  await r.page.close();
  const page2 = await ctx.newPage();
  await page2.goto('https://mail.google.com/mail/u/0/#inbox');
  await waitFor(() => page2.evaluate(() => window.__spammed.includes('#thread-f:1007')), 10000);
  await settled(page2);                                // everything checked and decided: 1001 would have been moved by now
  const sp2 = await page2.evaluate(() => window.__spammed);
  check('rescued conversation not moved from the inbox; others are', !sp2.includes('#thread-f:1001') && sp2.includes('#thread-f:1007'), sp2);
  await page2.close();

  await ctx.close();
});

runParts().catch(e => { console.error(e); process.exit(1); });
