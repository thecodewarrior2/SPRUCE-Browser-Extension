// Sender pictures in the inbox list with no email opened: a circle over each row's checkbox with the
// company's BIMI logo, else the site's icon; nothing beside the sender. (BIMI lookups themselves are
// unit-tested; here the logos are already known, as after a lookup.)
const { launch, servePage, waitFor, until, check, done } = require('./harness');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#c00"/></svg>';
(async () => {
  const { ctx, sw } = await launch();
  await servePage(ctx, 'fake-gmail-list.html');
  await ctx.route('https://logos.brandlogo.example/**', r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }));
  await ctx.route('https://logos.broken.example/**', r => r.fulfill({ status: 404, body: 'no' }));
  await sw.evaluate(async ([png]) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ enableDnsThreatCheck: true, enableAutoSpam: false, __testScamSenders: ['billing@forgedbrand.example'] });
    const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0)).buffer;
    const link = (u) => new TextEncoder().encode(u).buffer;
    await iconStore.put('bimi:brandlogo.example', 'text/uri-list', link('https://logos.brandlogo.example/logo.svg'), 'bimi', 'https://logos.brandlogo.example/logo.svg');
    await iconStore.put('bimi:forgedbrand.example', 'text/uri-list', link('https://logos.brandlogo.example/logo.svg'), 'bimi', 'https://logos.brandlogo.example/logo.svg');
    await iconStore.put('bimi:broken.example', 'text/uri-list', link('https://logos.broken.example/logo.svg'), 'bimi', 'https://logos.broken.example/logo.svg');
    // These made-up companies enforce DMARC (as if looked up): logos may be shown for them.
    const reject = new TextEncoder().encode(JSON.stringify({ p: 'reject', sp: '', pct: 100 })).buffer;
    for (const d of ['brandlogo.example', 'broken.example', 'plainsite.example', 'forgedbrand.example']) await iconStore.put('dmarc:' + d, 'application/json', reject, 'dmarc');
    for (const d of ['brandlogo.example', 'broken.example', 'plainsite.example']) {
      await iconStore.put(d, 'image/png', bytes, 'favicon');
      if (d !== 'brandlogo.example' && d !== 'broken.example') await iconStore.put('bimi:' + d, '', null, 'none');
    }
  }, [PNG]);
  const page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/#inbox');
  await page.evaluate(() => window.__arrive([
    { t: 8101, email: 'news@brandlogo.example', name: 'Brand', subj: 'Offer', unread: true },
    { t: 8102, email: 'news@broken.example', name: 'Broken', subj: 'Hello', unread: true },
    { t: 8103, email: 'person@plainsite.example', name: 'Person', subj: 'Hi', unread: false },
    { t: 8104, email: 'billing@forgedbrand.example', name: 'Brand billing', subj: 'Pay now', unread: true }]));
  const read = () => page.evaluate(() => Object.fromEntries([8101, 8102, 8103].map(t => {
    const row = document.querySelector(`[data-thread-id="#thread-f:${t}"]`).closest('tr');
    const c = row.querySelector('.unshortener-row-avatar');
    return [t, c && { kind: c.dataset.kind, src: c.src.slice(0, 40), loaded: c.complete && c.naturalWidth > 0, overCheckbox: c.parentElement === row.querySelector('[role=checkbox]').parentElement,
      inline: !!row.querySelector('.unshortener-sender-icon img') }];
  })));
  const r = await until(read, r => r[8101] && r[8101].loaded && r[8102] && r[8102].kind === 'icon' && r[8103], 10000);
  check('no email opened: the company\'s BIMI logo is a circle over the checkbox', r[8101] && r[8101].kind === 'logo' && r[8101].src.startsWith('https://logos.brandlogo.example') && r[8101].loaded && r[8101].overCheckbox, r[8101]);
  check('a BIMI logo that won\'t load: the site\'s icon instead', r[8102] && r[8102].kind === 'icon' && r[8102].src.startsWith('data:image/png'), r[8102]);
  check('no photo or logo: the site\'s icon in the circle', r[8103] && r[8103].kind === 'icon' && r[8103].src.startsWith('data:image/png') && r[8103].overCheckbox, r[8103]);
  const forged = await until(() => page.evaluate(() => { const row = document.querySelector('[data-thread-id="#thread-f:8104"]').closest('tr'); const c = row.querySelector('.unshortener-row-avatar'), chip = row.querySelector('.unshortener-sender-chip');
    return { status: chip && chip.dataset.status, placed: !!c, shown: !!c && getComputedStyle(c).display !== 'none' }; }), f => f.status === 'flagged' && f.placed, 10000);
  check('a flagged sender gets no circle at all (no logo, icon or initial): its checkbox and red label show', forged.status === 'flagged' && !forged.shown, forged);
  // Coming back from an email (Back), Gmail focuses that email's row: its picture stays.
  const focused = await page.evaluate(() => { const row = document.querySelector('[data-thread-id="#thread-f:8101"]').closest('tr'); row.tabIndex = -1; row.focus(); return getComputedStyle(row.querySelector('.unshortener-row-avatar')).display; });
  check('the row of the email you came back from keeps its picture (focus doesn\'t hide it)', focused !== 'none', focused);
  // A site icon sits on a soft tint of its own color, with no border.
  const tint = await page.evaluate(() => { const c = document.querySelector('[data-thread-id="#thread-f:8103"]').closest('tr').querySelector('.unshortener-row-avatar'); const cs = getComputedStyle(c); return { bg: cs.backgroundColor, border: cs.borderTopWidth }; });
  check('a site icon\'s circle: tinted from the icon, not white, no border', tint.bg !== 'rgb(255, 255, 255)' && tint.border === '0px', tint);
  check('nothing beside the sender in inbox rows (the circle replaces the icon)', [8101, 8102, 8103].every(t => r[t] && !r[t].inline), r);
  await ctx.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
