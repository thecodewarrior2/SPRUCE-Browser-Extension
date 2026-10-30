// Sender picture sizes follow Gmail's display density: Default 36 px circles, Comfortable 32 px,
// Compact no circles (the site's icon beside the country flag at the flag's size); colored initials
// for senders with no picture (not in Compact); the size setting overrides the density.
const { launch, servePage, until, sleep, check, part, runParts } = require('./harness');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// A fresh browser with known site icons (iconsite.example has one, noicon.example has none).
async function start(density, settings = {}) {
  const { ctx, sw } = await launch();
  await servePage(ctx, 'fake-gmail-list.html');
  await sw.evaluate(async ([png, settings]) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set(Object.assign({ enableDnsThreatCheck: true, enableAutoSpam: false }, settings));
    const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0)).buffer;
    await iconStore.put('iconsite.example', 'image/png', bytes, 'favicon');
    await iconStore.put('noicon.example', '', null, 'none');
    for (const d of ['iconsite.example', 'noicon.example']) await iconStore.put('bimi:' + d, '', null, 'none');
  }, [PNG, settings]);
  const page = await ctx.newPage();
  await page.goto(`https://mail.google.com/mail/u/0/?density=${density}#inbox`);
  await sleep(500);
  await page.evaluate(() => window.__arrive([
    { t: 8201, email: 'news@iconsite.example', name: 'Iconsite News', subj: 'Has a site icon', unread: true },
    { t: 8202, email: 'olivia@noicon.example', name: 'Olivia Example', subj: 'No picture at all', unread: true },
    { t: 8203, email: 'olivia@noicon.example', name: 'Olivia Example', subj: 'Same sender again', unread: false }]));
  await page.evaluate((d) => window.__setDensity(d), density);       // chips/paperclip on the top row
  return { ctx, sw, page };
}
// What one row shows: its circle (kind, size, letter, color) and any icon beside the flag.
const rowLook = (page, t) => page.evaluate((t) => {
  const row = document.querySelector(`[data-thread-id="#thread-f:${t}"]`).closest('tr');
  const c = row.querySelector('.unshortener-row-avatar'), inline = row.querySelector('.unshortener-sender-icon img');
  const r = c && c.getBoundingClientRect(), cs = c && getComputedStyle(c);
  return { mode: document.documentElement.dataset.unshortenerPictures,
    circle: c && { kind: c.dataset.kind, w: Math.round(r.width), h: Math.round(r.height), letter: c.textContent, color: cs.color, bg: cs.backgroundColor,
      inner: c.dataset.kind === 'icon' ? Math.round(r.width - 2 * parseFloat(cs.paddingLeft) - 2 * parseFloat(cs.borderLeftWidth)) : null },
    inline: inline && { w: Math.round(inline.getBoundingClientRect().width), h: Math.round(inline.getBoundingClientRect().height) } };
}, t);

part('default', async () => {
  const { ctx, page } = await start('default');
  const a = await until(() => rowLook(page, 8201), l => l.circle && l.circle.kind === 'icon');
  check('Default density: 36 px circles over the checkbox, the site icon 20 px inside', a.mode === 'large' && a.circle.w === 36 && a.circle.h === 36 && a.circle.inner === 20 && !a.inline, a);
  const b = await until(() => rowLook(page, 8202), l => l.circle && l.circle.kind === 'initial');
  check('no picture and no icon: a colored circle with the sender\'s initial (white letter)', b.circle && b.circle.kind === 'initial' && b.circle.letter === 'O' && b.circle.color === 'rgb(255, 255, 255)' && b.circle.w === 36, b);
  const c = await until(() => rowLook(page, 8203), l => l.circle && l.circle.kind === 'initial');
  check('the same sender always gets the same color', c.circle && c.circle.bg === b.circle.bg, { first: b.circle && b.circle.bg, again: c.circle && c.circle.bg });
  await ctx.close();
});

part('comfortable', async () => {
  const { ctx, page } = await start('comfortable');
  const a = await until(() => rowLook(page, 8201), l => l.mode === 'medium' && l.circle && l.circle.kind === 'icon' && l.circle.w === 32);
  check('Comfortable density: 32 px circles, the site icon 18 px inside', a.mode === 'medium' && a.circle && a.circle.w === 32 && a.circle.inner === 18, a);
  const b = await until(() => rowLook(page, 8202), l => l.circle && l.circle.kind === 'initial' && l.circle.w === 32);
  check('Comfortable: initials in 32 px circles too', b.circle && b.circle.kind === 'initial' && b.circle.w === 32, b);
  await ctx.close();
});

part('compact', async () => {
  const { ctx, page } = await start('compact');
  const a = await until(() => rowLook(page, 8201), l => l.mode === 'inline' && l.inline);
  check('Compact density: no circles; the site icon beside the flag at the flag\'s size (15 px)', a.mode === 'inline' && !a.circle && a.inline && a.inline.w === 15 && a.inline.h === 15, a);
  await sleep(1500);
  const b = await rowLook(page, 8202);
  check('Compact: no initials (and no circle) for a sender with no picture', !b.circle, b);
  await ctx.close();
});

part('live-change', async () => {
  // The user switches Gmail's density while the inbox is open: the pictures follow.
  const { ctx, page } = await start('default');
  await until(() => rowLook(page, 8201), l => l.circle && l.circle.w === 36);
  await page.evaluate(() => window.__setDensity('compact'));
  const a = await until(() => rowLook(page, 8201), l => l.mode === 'inline' && !l.circle && l.inline);
  check('density switched to Compact while open: circles replaced by inline icons', a.mode === 'inline' && !a.circle && a.inline && a.inline.w === 15, a);
  await page.evaluate(() => window.__setDensity('comfortable'));
  const b = await until(() => rowLook(page, 8201), l => l.mode === 'medium' && l.circle && l.circle.w === 32);
  check('…and back to Comfortable: 32 px circles again', b.mode === 'medium' && b.circle && b.circle.w === 32 && !b.inline, b);
  await ctx.close();
});

part('setting', async () => {
  // The size setting wins over the density.
  let { ctx, page } = await start('default', { senderPictureSize: 'medium' });
  const a = await until(() => rowLook(page, 8201), l => l.circle && l.circle.w === 32);
  check('setting "Medium circles": 32 px even in Default density', a.mode === 'medium' && a.circle && a.circle.w === 32, a);
  await ctx.close();
  ({ ctx, page } = await start('default', { senderPictureSize: 'inline' }));
  const b = await until(() => rowLook(page, 8201), l => l.mode === 'inline' && l.inline);
  check('setting "Small, beside the flag": no circles even in Default density', b.mode === 'inline' && !b.circle && b.inline && b.inline.w === 15, b);
  await ctx.close();
});

part('offline', async () => {
  // Network checks off (privacy level): no icons can be fetched; circles show initials.
  const { ctx, page } = await start('default', { enableDnsThreatCheck: false, enableSenderAvatars: false });
  const a = await until(() => rowLook(page, 8201), l => l.circle && l.circle.kind === 'initial');
  check('offline: every row still gets a circle, with the sender\'s initial', a.circle && a.circle.kind === 'initial' && a.circle.letter === 'I', a);
  await ctx.close();
});

runParts().catch(e => { console.error(e); process.exit(1); });
