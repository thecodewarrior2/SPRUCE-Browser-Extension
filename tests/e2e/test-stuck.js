// Moving to Spam must keep working without a reload: Gmail ignoring clicks, the list hidden for a
// moment, emails arriving one after another, the user active (clicks wait 10 s, mere mouse movement
// only 2 s), parked moves resuming the moment the view is back, and the row guard (swallowed clicks,
// Move now, Keep it). Each part has its own browser (run in parallel).
const { launch, servePage, sleep, waitFor, ready, check, part, runParts } = require('./harness');
const scam = (t, unread = true) => ({ t, email: `scam${t}@evil-scam.test`, name: 'Scam ' + t, subj: 'Pay now ' + t, unread });
const SENDERS = Array.from({ length: 40 }, (_, i) => `scam${6000 + i}@evil-scam.test`);
const base = { __testScamSenders: ['phisher@evil-scam.test', 'billing@evil-scam.test', ...SENDERS], enableDnsThreatCheck: false };

// A fresh browser with the base settings and the simulated inbox list.
async function start(query = '', hash = '#inbox') {
  const { ctx, sw } = await launch();
  await servePage(ctx, 'fake-gmail-list.html');
  await sw.evaluate(async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }, base);
  const page = await ctx.newPage();
  await page.goto(`https://mail.google.com/mail/u/0/${query}${hash}`);
  const spammed = () => page.evaluate(() => window.__spammed.slice());
  // Waits until exactly n emails have been moved; answers what was moved.
  const movedCount = async (n, timeout) => (await waitFor(async () => { const s = await spammed(); return s.length === n && s; }, timeout)) || spammed();
  return { ctx, sw, page, spammed, movedCount };
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

part('gesture', async () => {
  // The mouse merely moving over the list is not a 10-second wait: nothing moves while it keeps
  // moving, and moves follow about 2 seconds after it rests (the old one-tier rule waited 10+).
  const { ctx, page, spammed, movedCount } = await start();
  await ready(page);
  // The user keeps the mouse moving over the sender column at a human pace (intended timing: the
  // scenario is continuous movement, not a wait).
  let waiting = false;
  for (let i = 0; i < 200 && !waiting; i++) {
    await page.mouse.move(120 + (i % 2) * 60, 100 + (i % 5) * 25);
    await sleep(100);                                                        // allow-sleep: the user's mouse keeps moving
    if (i % 5 === 4) waiting = await page.evaluate(() => document.documentElement.dataset.unshortenerSpamWait === 'recent activity');
  }
  check('while the mouse keeps moving over the list: nothing moved', (await spammed()).length === 0 && waiting, { spammed: await spammed(), waiting });
  const tStop = Date.now();
  const s = await movedCount(2, 30000);
  const quietFor = Math.round((Date.now() - tStop) / 100) / 10;
  // The 2-second gesture rule is the extension's own; the upper bound leaves room for a slow computer
  // but stays far below the 10-second action rule, which must not apply to mouse movement.
  check(`moved about 2 s after the mouse rested (after ${quietFor} s)`, s.length === 2 && quietFor >= 1.5 && quietFor <= 9, quietFor);
  await ctx.close();
});

part('unpark-view', async () => {
  // Parked moves don't wait out a backoff once the user is back: flagged in a view moves never
  // happen from (a label), then the user returns to the inbox, and the moves follow promptly.
  const { ctx, page, spammed, movedCount } = await start('', '#label/keepout');
  await ready(page);
  const parked = await waitFor(() => page.evaluate(() => document.documentElement.dataset.unshortenerSpamWait === 'view'), 20000);
  check('flagged in a label view: queued but nothing moved (moves never happen there)', parked && (await spammed()).length === 0, { parked, spammed: await spammed() });
  const t0 = Date.now();
  await page.evaluate(() => { location.hash = '#inbox'; });
  const s = await movedCount(2, 20000);
  const took = Math.round((Date.now() - t0) / 100) / 10;
  check(`back in the inbox: moved within seconds, no reload (${took} s)`, s.length === 2 && took <= 8, { spammed: s, took });
  await ctx.close();
});

part('guard', async () => {
  // The row guard: a queued row says "Moving to Spam", swallows real clicks (no accidental opening
  // or selecting), "Keep it" leaves the email in the inbox for good, and "Move now" moves it at
  // once, without waiting out the quiet period.
  const { ctx, sw, page, spammed, movedCount } = await start();
  await ready(page);
  const bannerOn = (t) => page.evaluate((t) => { const el = document.querySelector(`[data-thread-id="#thread-f:${t}"]`); const tr = el && el.closest('tr'); return !!(tr && tr.classList.contains('unshortener-moving') && tr.querySelector('.unshortener-move-banner')); }, t);
  // The user's mouse moves over the list until both flagged rows are queued and guarded.
  let guarded = false;
  for (let i = 0; i < 200 && !guarded; i++) {
    await page.mouse.move(120 + (i % 2) * 60, 100 + (i % 5) * 25);
    await sleep(100);                                                        // allow-sleep: the user's mouse keeps moving
    if (i % 5 === 4) guarded = (await bannerOn(1001)) && (await bannerOn(1007));
  }
  check('queued rows carry the guard (struck through, "Moving to Spam" banner)', guarded, guarded);
  const box = async (t) => { const b = await page.evaluate((t) => { const el = document.querySelector(`[data-thread-id="#thread-f:${t}"]`); const tr = el && el.closest('tr'); const cb = tr && tr.querySelector('[role=checkbox]'); const r = cb.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, t); return b; };
  const checkedOf = (t) => page.evaluate((t) => document.querySelector(`[data-thread-id="#thread-f:${t}"]`).closest('tr').querySelector('[role=checkbox]').getAttribute('aria-checked'), t);
  // A normal row's checkbox still works (the control)…
  const b2 = await box(1002);
  await page.mouse.click(b2.x, b2.y);
  check('a normal row can still be selected', (await checkedOf(1002)) === 'true', await checkedOf(1002));
  await page.mouse.click(b2.x, b2.y);                                        // …and is unselected again
  // …but a real click on the guarded row is swallowed: nothing selected, nothing opened.
  const b1 = await box(1001);
  await page.mouse.click(b1.x, b1.y);
  check('a click on the guarded row is swallowed (not selected)', (await checkedOf(1001)) === 'false', await checkedOf(1001));
  // Keep it: the email stays in the inbox for good, remembered like one taken out of Spam.
  await page.click('tr.unshortener-moving .unshortener-move-banner[data-unshortener-thread="thread-f:1007"] button:has-text("Keep it")');
  const kept = await waitFor(() => sw.evaluate(async () => { const r = Object.keys((await chrome.storage.local.get('spamRescuedThreads')).spamRescuedThreads || {}); return r.includes('thread-f:1007') && r; }), 10000);
  check('Keep it: remembered like an email taken out of Spam', Array.isArray(kept) && kept.includes('thread-f:1007'), kept);
  const freed = await waitFor(() => page.evaluate(() => { const el = document.querySelector('[data-thread-id="#thread-f:1007"]'); const tr = el && el.closest('tr'); return tr && !tr.querySelector('.unshortener-move-banner') && !tr.classList.contains('unshortener-moving'); }), 10000);
  check('Keep it: the row stays, without the guard', !!freed, freed);
  // Move now: moved at once although the user clicked a moment ago (the 10-second action rule). The
  // fresh toggle just before anchors the quiet period, so a slow computer can't blur the proof.
  await page.mouse.click(b2.x, b2.y);
  await page.mouse.click(b2.x, b2.y);
  const tNow = Date.now();
  await page.click('tr.unshortener-moving .unshortener-move-banner[data-unshortener-thread="thread-f:1001"] button:has-text("Move now")');
  const s = await movedCount(1, 15000);
  const sinceAction = Math.round((Date.now() - tNow) / 100) / 10;
  check(`Move now: moved without waiting out the quiet period (${sinceAction} s after the user's click)`, s.length === 1 && s[0] === '#thread-f:1001' && sinceAction < 9.5, { spammed: s, sinceAction });
  check('the kept email was not moved', !(await spammed()).includes('#thread-f:1007'), await spammed());
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
