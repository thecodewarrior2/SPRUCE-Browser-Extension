// Row highlighter and warnings about overlapping extensions (simulated Gmail and Outlook pages).
const fs = require('fs');
const { launch, servePage, sleep, waitFor, check, part, runParts } = require('./harness');
// A fresh browser per part (the parts run in parallel). The extension's id comes from the browser.
async function setup() {
  const { ctx, sw } = await launch();
  await servePage(ctx, 'fake-gmail-list.html');
  await ctx.route('https://outlook.office.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(__dirname + '/fake-outlook.html', 'utf8') }));
  const set = (s) => sw.evaluate(async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }, s);
  const base = { enableDnsThreatCheck: false, enableAutoSpam: false };
  const hovered = async (page, rowSel) => {
    const box = await page.locator(rowSel).first().boundingBox();
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await sleep(300);
    return page.evaluate((sel) => { const r = document.querySelector(sel); const cell = r.querySelector('td') || r; const cs = getComputedStyle(cell), rs = getComputedStyle(r);
      return { image: cs.backgroundImage, outline: rs.outlineStyle + ' ' + rs.outlineColor, style: !!document.getElementById('unshortener-row-highlight') }; }, rowSel);
  };

  const ID = new URL(sw.url()).host;
  return { ctx, sw, set, base, hovered, ID };
}

part('highlighter', async () => {
  const { ctx, sw, set, base, hovered, ID } = await setup();
  // Row highlighter: default (yellow, color and outline).
  await set(base);
  let page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/#inbox');
  await waitFor(() => page.evaluate(() => !!document.getElementById('unshortener-row-highlight')), 8000);
  let h = await hovered(page, 'tr.zA');
  check('row under the mouse: see-through color and outline (default)', /linear-gradient/.test(h.image) && /rgba\(255, 213, 0, 0\.3/.test(h.image) && /^solid/.test(h.outline), h);
  await page.mouse.move(5, 5); await sleep(300);
  const away = await page.evaluate(() => getComputedStyle(document.querySelector('tr.zA td')).backgroundImage);
  check('the highlight goes away when the mouse leaves', away === 'none', away);
  await page.close();
  // Blue, color only.
  await set(Object.assign({}, base, { rowHighlightColor: 'blue', rowHighlightStyle: 'fill' }));
  page = await ctx.newPage(); await page.goto('https://mail.google.com/mail/u/0/#inbox'); await waitFor(() => page.evaluate(() => !!document.getElementById('unshortener-row-highlight')), 8000);
  h = await hovered(page, 'tr.zA');
  check('blue, color only: blue fill, no outline', /rgba\(26, 115, 232/.test(h.image) && /^none/.test(h.outline), h);
  await page.close();
  // Selected rows stay highlighted.
  await set(base);
  page = await ctx.newPage(); await page.goto('https://mail.google.com/mail/u/0/#inbox'); await waitFor(() => page.evaluate(() => !!document.getElementById('unshortener-row-highlight')), 8000);
  await page.evaluate(() => document.querySelectorAll('tr.zA')[1].querySelector('[role=checkbox]').click());
  await page.mouse.move(5, 5); await sleep(400);
  const sel = await page.evaluate(() => getComputedStyle(document.querySelectorAll('tr.zA')[1].querySelector('td')).backgroundImage);
  check('a ticked email keeps a highlight, in its own color (blue by default, not the mouse\'s yellow)', /linear-gradient/.test(sel) && /rgba\(26, 115, 232/.test(sel), sel);
  await page.evaluate(() => { document.querySelectorAll('tr.zA')[1].id = 'tickrow'; }); h = await hovered(page, '#tickrow');
  check('a ticked email under the mouse shows the mouse color', /rgba\(255, 213, 0, 0\.3/.test(h.image), h);
  await page.close();
  // Settings: the same color for both is allowed, with a warning.
  const optHl = await ctx.newPage(); await optHl.goto(`chrome-extension://${ID}/options.html`); await optHl.waitForSelector('#rowHlSameWarning', { state: 'attached' }); await sleep(300);
  const warn = () => optHl.evaluate(() => !document.getElementById('rowHlSameWarning').hidden);
  const w0 = await warn();
  await optHl.selectOption('select[data-setting="rowHighlightSelectedColor"]', 'yellow'); await sleep(800);
  const w1 = await warn();
  const saved = await sw.evaluate(async () => (await chrome.storage.local.get('rowHighlightSelectedColor')).rowHighlightSelectedColor);
  check('Settings: different colors by default, no warning', w0 === false, w0);
  check('Settings: the same color for both is saved, with a warning', w1 === true && saved === 'yellow', { w1, saved });
  await optHl.close();
  // Off, and locked off by policy.
  await set(Object.assign({}, base, { enableRowHighlighter: false }));
  page = await ctx.newPage(); await page.goto('https://mail.google.com/mail/u/0/#inbox'); await sleep(4000);
  h = await hovered(page, 'tr.zA');
  check('switched off: no highlight', !h.style && h.image === 'none', h);
  await page.close();
  await set(Object.assign({}, base, { __testManaged: { managedEnableRowHighlighter: false }, enableRowHighlighter: true }));
  await sw.evaluate(() => invalidateConfig());
  page = await ctx.newPage(); await page.goto('https://mail.google.com/mail/u/0/#inbox'); await sleep(4000);
  h = await hovered(page, 'tr.zA');
  check('locked off by policy: no highlight even with the user\'s setting on', !h.style, h);
  await page.close();
  // Generic site (Outlook-like page).
  await set(base);
  await sw.evaluate(() => invalidateConfig());
  page = await ctx.newPage(); await page.goto('https://outlook.office.com/mail/inbox'); await waitFor(() => page.evaluate(() => !!document.getElementById('unshortener-row-highlight')), 8000);
  h = await hovered(page, '[role=option]');
  check('works on a generic site too (Outlook-like list rows)', /linear-gradient/.test(h.image), h);
  await page.close();

  await ctx.close();
});

part('conflicts', async () => {
  const { ctx, sw, set, base, hovered, ID } = await setup();
  // Overlapping extensions.
  const notice = (p) => p.evaluate(() => { const n = document.querySelector('.unshortener-conflict-notice'); return n && { text: n.textContent, buttons: [...n.querySelectorAll('button')].map(b => b.textContent) }; });
  await set(base);
  page = await ctx.newPage(); await page.goto('https://mail.google.com/mail/u/0/?ext=1#inbox'); await waitFor(() => page.evaluate(() => !!document.querySelector('.unshortener-conflict-notice')), 10000);
  let n = await notice(page);
  check('a known extension in the page (Gmail Sender Icons): warned, recommends keeping ours', n && /Gmail Sender Icons also does sender icons in the inbox/.test(n.text) && /recommend keeping Gmail Link Unshortener on/.test(n.text), n);
  check('…with the three choices', n && n.buttons.some(b => /Turn off Gmail Sender Icons/.test(b)) && n.buttons.some(b => /Turn off ours \(sender icons and labels\)/.test(b)) && n.buttons.includes('Ignore'), n && n.buttons);
  await page.locator('.unshortener-conflict-notice button', { hasText: 'Turn off ours' }).click();
  await sleep(800);
  const off = await sw.evaluate(async () => (await chrome.storage.local.get('enableSenderIdentity')).enableSenderIdentity);
  check('"Turn off ours" turns our matching feature off', off === false, off);
  await page.close();
  // Settings → Other extensions lists it.
  const opt = await ctx.newPage(); await opt.goto(`chrome-extension://${ID}/options.html#conflicts`); await sleep(1500);
  const listed = await opt.evaluate(() => { const i = document.querySelector('#conflictList .conflict-item'); return i && { text: i.textContent, buttons: [...i.querySelectorAll('button')].map(b => b.textContent) }; });
  check('Settings → Other extensions lists it, with a one-click "Turn off" (Chrome)', listed && /Gmail Sender Icons/.test(listed.text) && listed.buttons.some(b => /Turn off Gmail Sender Icons/.test(b)), listed);
  await opt.close();
  // Ignore: not warned again.
  await set(base);
  page = await ctx.newPage(); await page.goto('https://mail.google.com/mail/u/0/?ext=1#inbox'); await waitFor(() => page.evaluate(() => !!document.querySelector('.unshortener-conflict-notice')), 10000);
  await page.locator('.unshortener-conflict-notice button', { hasText: 'Ignore' }).click();
  await sleep(500); await page.close();
  page = await ctx.newPage(); await page.goto('https://mail.google.com/mail/u/0/?ext=1#inbox'); await sleep(4000);
  check('ignored: not warned again', !(await notice(page)));
  await page.close();
  // An extension overlapping with two of ours (Simplify Gmail): turn off only one of ours.
  await set(base);
  page = await ctx.newPage(); await page.goto('https://mail.google.com/mail/u/0/?ext=simplify#inbox'); await waitFor(() => page.evaluate(() => !!document.querySelector('.unshortener-conflict-notice')), 10000);
  n = await notice(page);
  check('two overlapping settings: a button for each, and one for all', n && n.buttons.includes('Turn off only our sender photos and company logos') && n.buttons.includes('Turn off only our tracking-pixel blocking') && n.buttons.includes('Turn off all of ours'), n && n.buttons);
  await page.locator('.unshortener-conflict-notice button', { hasText: 'Turn off only our sender photos' }).click();
  await sleep(800); await page.close();
  const st = await sw.evaluate(async () => chrome.storage.local.get(['enableSenderAvatars', 'enableTrackingPixelBlocking', 'keptConflictFeatures']));
  check('only that setting is turned off; the other stays on', st.enableSenderAvatars === false && st.enableTrackingPixelBlocking !== false, st);
  page = await ctx.newPage(); await page.goto('https://mail.google.com/mail/u/0/?ext=simplify#inbox'); await sleep(4000);
  check('settled: not warned again while it stays off', !(await notice(page)));
  await page.close();
  await sw.evaluate(async () => chrome.storage.local.set({ enableSenderAvatars: true }));
  page = await ctx.newPage(); await page.goto('https://mail.google.com/mail/u/0/?ext=simplify#inbox'); await waitFor(() => page.evaluate(() => !!document.querySelector('.unshortener-conflict-notice')), 10000);
  n = await notice(page);
  check('turned back on: warned again', n && /Simplify Gmail/.test(n.text), n);
  await page.close();
  // Settings: pressing Ignore and Warn me again never lists an extension twice.
  const opt2 = await ctx.newPage(); await opt2.goto(`chrome-extension://${ID}/options.html#conflicts`); await sleep(1500);
  const count = () => opt2.evaluate(() => [...document.querySelectorAll('#conflictList .conflict-item')].filter(i => /Simplify Gmail/.test(i.textContent)).length);
  const simplifyItem = opt2.locator('#conflictList .conflict-item', { hasText: 'Simplify Gmail' });
  await simplifyItem.locator('button', { hasText: 'Ignore' }).click(); await sleep(1200);
  const c1 = await count();
  await simplifyItem.locator('button', { hasText: 'Warn me again' }).click(); await sleep(1200);
  const c2 = await count();
  check('Settings: Ignore / Warn me again never duplicates an entry', c1 === 1 && c2 === 1, { c1, c2 });
  const btns = await simplifyItem.evaluate(i => [...i.querySelectorAll('button')].map(b => b.textContent));
  check('Settings: a button for each overlapping setting of ours', btns.includes('Turn off only our tracking-pixel blocking') && btns.includes('Turn off all of ours'), btns);
  await opt2.close();
  // An unknown extension's effect: favicons in the sender cells that aren't ours.
  await set(base);
  page = await ctx.newPage(); await page.goto('https://mail.google.com/mail/u/0/?fakeicons=1#inbox'); await waitFor(() => page.evaluate(() => !!document.querySelector('.unshortener-conflict-notice')), 10000);
  n = await notice(page);
  check('an unknown extension drawing sender icons is noticed too', n && /Another extension also shows sender icons/.test(n.text), n);
  await page.close();
  // Suppressed by the administrator: nothing shown.
  await set(Object.assign({}, base, { __testManaged: { managedEnableConflictWarnings: false } }));
  await sw.evaluate(() => invalidateConfig());
  page = await ctx.newPage(); await page.goto('https://mail.google.com/mail/u/0/?ext=1&fakeicons=1#inbox'); await sleep(4000);
  check('administrator suppressed the warnings: nothing shown', !(await notice(page)));
  await page.close();
  await ctx.close();
});

runParts().catch(e => { console.error(e); process.exit(1); });
