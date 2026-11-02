// Messages shown in frames (Proton, iCloud, Zoho, GMX): every kind of message frame gets its links
// checked, by the extension's script inside the frame or by the page reading it, and none is skipped.
const fs = require('fs');
const path = require('path');
const { launch, until, check, done } = require('./harness');
(async () => {
  const { ctx, sw } = await launch();
  await sw.evaluate(() => chrome.storage.local.set({ enableDnsThreatCheck: false }));
  await ctx.route('https://mail.proton.me/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, 'fake-proton.html'), 'utf8') }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('https://mail.proton.me/u/0/inbox');
  const read = async () => {
    const out = {};
    for (const fr of page.frames()) {
      if (fr === page.mainFrame()) continue;
      const r = await fr.evaluate(() => { const a = document.querySelector('a'); return a ? { n: a.href.slice(-1), done: a.dataset.unshortened || null } : null; }).catch(() => null);
      if (r) out['frame' + r.n] = r.done;
    }
    return out;
  };
  const r = await until(read, o => o && ['frame1', 'frame2', 'frame3', 'frame4'].every(k => o[k]), 15000);
  check('same-origin about:blank message frame checked', r && r.frame1, r);
  check('sandboxed frame without same-origin access checked (script runs inside it)', r && r.frame2, r);
  check('blob: message frame checked', r && r.frame3, r);
  check('sandboxed same-origin frame (the usual webmail setup) checked', r && r.frame4, r);
  check('no page errors', errors.length === 0, errors);
  await ctx.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
