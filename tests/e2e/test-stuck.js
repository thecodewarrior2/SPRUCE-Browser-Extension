// Moving to Spam must keep working without a reload: Gmail ignoring clicks, the list hidden for a
// moment, emails arriving one after another. Each part has its own browser (run in parallel).
const { launch, servePage, sleep, waitFor, ready, check, part, runParts } = require('./harness');
const scam = (t, unread = true) => ({ t, email: `scam${t}@evil-scam.test`, name: 'Scam ' + t, subj: 'Pay now ' + t, unread });
const SENDERS = Array.from({ length: 40 }, (_, i) => `scam${6000 + i}@evil-scam.test`);
const base = { __testScamSenders: ['phisher@evil-scam.test', 'billing@evil-scam.test', ...SENDERS], enableDnsThreatCheck: false };

// A fresh browser with the base settings and the simulated inbox list.
async function start(query = '') {
  const { ctx, sw } = await launch();
  await servePage(ctx, 'fake-gmail-list.html');
  await sw.evaluate(async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }, base);
  const page = await ctx.newPage();
  await page.goto(`https://mail.google.com/mail/u/0/${query}#inbox`);
  const spammed = () => page.evaluate(() => window.__spammed.slice());
  // Waits until exactly n emails have been moved; answers what was moved.
  const movedCount = async (n, timeout) => (await waitFor(async () => { const s = await spammed(); return s.length === n && s; }, timeout)) || spammed();
  return { ctx, page, spammed, movedCount };
}

part('waves', async () => {
  const { ctx, page, movedCount } = await start();
  check('first wave moved', (await movedCount(2, 8000)).length === 2, await movedCount(2, 0));
  let s;
  for (let w = 0; w < 4; w++) {
    await page.evaluate((rows) => window.__arrive(rows), [scam(6000 + 2 * w), scam(6001 + 2 * w)]);
    s = await movedCount(4 + 2 * w, 10000);
  }
  check('four more waves, one after another: all moved without a reload', s.length === 10, s);
  await ctx.close();
});

part('flaky', async () => {
  // Gmail ignores the first 4 clicks: the mover pauses, then recovers on its own.
  const { ctx, page, movedCount } = await start('?flaky=4');
  await ready(page);
  await page.evaluate((rows) => window.__arrive(rows), [scam(6010)]);
  const t0 = Date.now();
  const s = await movedCount(3, 180000);
  check(`Gmail ignored 4 clicks: recovered without a reload (${Math.round((Date.now() - t0) / 1000)} s)`, s.length === 3, s);
  const sel = await page.evaluate(() => document.querySelectorAll('tr.zA.x7').length);
  check('nothing left selected after the ignored clicks', sel === 0, sel);
  await ctx.close();
});

part('hidden-list', async () => {
  // The list is hidden (an email opened) while moves are waiting, then shown again.
  const { ctx, page, movedCount } = await start();
  // The flagged rows are labelled: their moves are queued.
  await waitFor(() => page.evaluate(() => document.querySelectorAll('.unshortener-sender-chip[data-status="flagged"]').length >= 2), 20000);
  await page.evaluate(() => window.__hideList(4000));
  const s = await movedCount(2, 30000);
  check('list hidden for a moment while moves waited: still moved afterwards', s.length === 2, s);
  await ctx.close();
});

part('hidden-at-load', async () => {
  // The list is hidden from the start (before the extension first looks) and shown again without its
  // contents changing: the rows are still checked and moved.
  const { ctx, page, movedCount } = await start();
  await page.evaluate(() => window.__hideList(4000));
  const s = await movedCount(2, 30000);
  check('list hidden when first scanned, shown again unchanged: still checked and moved', s.length === 2, s);
  await ctx.close();
});

part('user-busy', async () => {
  // The user's own activity: nothing moves until 10 seconds after their last click or key.
  const { ctx, page, spammed, movedCount } = await start();
  await ready(page);
  const tA = Date.now();
  // The scenario itself is timed: the user clicks every 2 s (intended timing, not a wait).
  for (let i = 0; i < 4; i++) { await page.mouse.click(5, 300); await sleep(2000); }      // allow-sleep: the user's clicks
  const waiting = await waitFor(() => page.evaluate(() => document.documentElement.dataset.unshortenerSpamWait === 'recent activity'), 20000);
  check('while the user keeps clicking: nothing moved (the mover waits for their activity to stop)', (await spammed()).length === 0 && waiting, { spammed: await spammed(), waiting });
  const lastClick = tA + 6000;
  const s = await movedCount(2, 30000);
  const quietFor = Math.round((Date.now() - lastClick) / 1000);
  // The 10-second quiet period is the extension's own rule; the upper bound leaves room for a slow computer.
  check(`moved once the user was idle 10 s (after ${quietFor} s idle)`, s.length === 2 && quietFor >= 9 && quietFor <= 25, quietFor);
  await ctx.close();
});

part('user-selection', async () => {
  // A row selected by the user blocks moving only while it's selected.
  const { ctx, page, spammed, movedCount } = await start();
  // The row is there (before any verdict, so nothing can move first).
  await waitFor(() => page.evaluate(() => !!document.querySelector('[data-thread-id="#thread-f:1002"]')), 20000);
  const tick = () => page.evaluate(() => document.querySelector('[data-thread-id="#thread-f:1002"]').closest('tr').querySelector('[role=checkbox]').click());
  await tick();
  // The mover has tried and is waiting because of the selection.
  const waiting = await waitFor(() => page.evaluate(() => document.documentElement.dataset.unshortenerSpamWait === 'selection'), 20000);
  check('while the user has an email selected: nothing moved (the mover waits for the selection)', (await spammed()).length === 0 && waiting, { spammed: await spammed(), waiting });
  await tick();
  await page.mouse.move(0, 0);
  const s = await movedCount(2, 16000);
  check('after the user unselects: moved without a reload', s.length === 2, s);
  await ctx.close();
});

runParts().catch(e => { console.error(e); process.exit(1); });
