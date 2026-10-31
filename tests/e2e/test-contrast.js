// Sender icons stay readable in Gmail's dark and light themes: a black icon with a see-through
// background gets a light circle on the dark theme (and a light plate beside the flag in Compact), a
// white one gets a dark circle on the light theme, and an icon that already shows keeps its own tint.
const { launch, servePage, until, settled, ready, check, part, runParts } = require('./harness');

// A fresh browser with three site icons drawn as see-through rings: black, white and blue.
async function start(density, theme) {
  const { ctx, sw } = await launch();
  await servePage(ctx, 'fake-gmail-list.html');
  await sw.evaluate(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ enableDnsThreatCheck: true, enableAutoSpam: false, customTrustedSenders: ['blackicon.example', 'whiteicon.example', 'blueicon.example'] });
    const ring = async (color) => {
      const c = new OffscreenCanvas(32, 32), g = c.getContext('2d');
      g.strokeStyle = color; g.lineWidth = 5; g.beginPath(); g.arc(16, 16, 11, 0, Math.PI * 2); g.stroke();
      return (await c.convertToBlob({ type: 'image/png' })).arrayBuffer();
    };
    for (const [d, color] of [['blackicon.example', '#000'], ['whiteicon.example', '#fff'], ['blueicon.example', '#1967d2']]) {
      await iconStore.put(d, 'image/png', await ring(color), 'favicon');
      await iconStore.put('bimi:' + d, '', null, 'none');
    }
  });
  const page = await ctx.newPage();
  await page.goto(`https://mail.google.com/mail/u/0/?density=${density}#inbox`);
  if (theme === 'dark') await page.evaluate(() => { document.body.style.background = '#202124'; document.body.style.color = '#e8eaed'; });
  await ready(page);
  await page.evaluate(() => window.__arrive([
    { t: 8401, email: 'news@blackicon.example', name: 'Black Icon', subj: 'Dark logo', unread: true },
    { t: 8402, email: 'news@whiteicon.example', name: 'White Icon', subj: 'Light logo', unread: true },
    { t: 8403, email: 'news@blueicon.example', name: 'Blue Icon', subj: 'Colored logo', unread: true }]));
  await page.evaluate((d) => window.__setDensity(d), density);
  return { ctx, page };
}
// The background behind a row's icon (circle or inline plate), and its contrast with the icon's color.
const look = (page, t, ink) => page.evaluate(([t, ink]) => {
  const row = document.querySelector(`[data-thread-id="#thread-f:${t}"]`).closest('tr');
  const el = row.querySelector('.unshortener-row-avatar') || row.querySelector('.unshortener-sender-icon img');
  if (!el) return null;
  const bg = getComputedStyle(el).backgroundColor;
  const m = (bg.match(/[\d.]+/g) || []).map(Number);
  const lum = (c) => { const l = c.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
  const see = m.length === 4 && m[3] === 0;
  return { circle: el.classList.contains('unshortener-row-avatar'), plate: el.classList.contains('unshortener-icon-plate'), bg, see,
    contrast: see ? null : +((Math.max(lum(m), lum(ink)) + 0.05) / (Math.min(lum(m), lum(ink)) + 0.05)).toFixed(2) };
}, [t, ink]);

part('dark', async () => {
  const { ctx, page } = await start('default', 'dark');
  const black = await until(() => look(page, 8401, [0, 0, 0]), l => l && l.circle && l.contrast >= 3, 8000);
  check('dark theme: a black icon sits on a light circle (at least 3:1)', black && black.circle && black.contrast >= 3, black);
  const white = await until(() => look(page, 8402, [255, 255, 255]), l => l && l.circle && l.bg !== 'rgb(241, 243, 244)', 8000);
  check('dark theme: a white icon keeps a dark circle', white && white.contrast >= 3, white);
  const blue = await until(() => look(page, 8403, [25, 103, 210]), l => l && l.circle && l.bg !== 'rgb(241, 243, 244)', 8000);
  check('dark theme: a blue icon keeps its own dark tint', blue && /^rgb\((\d+), (\d+), (\d+)\)$/.test(blue.bg) && +RegExp.$3 < 120, blue);
  await ctx.close();
});

part('light', async () => {
  const { ctx, page } = await start('default', 'light');
  const white = await until(() => look(page, 8402, [255, 255, 255]), l => l && l.circle && l.contrast >= 3, 8000);
  check('light theme: a white icon sits on a dark circle (at least 3:1)', white && white.contrast >= 3, white);
  const black = await until(() => look(page, 8401, [0, 0, 0]), l => l && l.circle && l.bg !== 'rgb(241, 243, 244)', 8000);
  check('light theme: a black icon keeps a light circle', black && black.contrast >= 3 && /^rgb\((\d+)/.test(black.bg) && +RegExp.$1 > 180, black);
  await ctx.close();
});

part('compact-dark', async () => {
  const { ctx, page } = await start('compact', 'dark');
  const black = await until(() => look(page, 8401, [0, 0, 0]), l => l && !l.circle && l.plate, 8000);
  check('Compact, dark theme: a black icon beside the flag gets a light plate', black && !black.circle && black.plate && black.contrast >= 3, black);
  await settled(page);
  const blue = await look(page, 8403, [25, 103, 210]);
  check('…a blue icon there needs none', blue && !blue.circle && !blue.plate, blue);
  await ctx.close();
});

runParts().catch(e => { console.error(e); process.exit(1); });
