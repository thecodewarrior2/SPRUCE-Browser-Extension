// Real DNS threat services (online): a blocked domain, an adult-content-only block, a clean and a
// non-existent domain.
const { launch, servePage, sleep, until, check, done } = require('./harness');
(async () => {
  const { ctx, sw } = await launch();
  await servePage(ctx, 'fake-gmail-list.html');
  const page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/?set=dns#inbox');
  const read = () => page.evaluate(() => ({ spammed: window.__spammed, rows: [...document.querySelectorAll('tr.zA')].map(tr => { const c = tr.querySelector('.unshortener-sender-chip'); return [tr.querySelector('[data-thread-id]').getAttribute('data-thread-id'), c && c.dataset.status, c && c.title]; }) }));
  let r = await until(read, r => r.rows.length >= 2 && r.rows.every(x => x[1] && x[1] !== 'pending') && r.spammed.includes('#thread-f:4001') && r.spammed.includes('#thread-f:4004'), 25000);
  await sleep(2000);                                 // long enough for a (wrong) move of the others
  r = await read();
  console.log(JSON.stringify(r, null, 1));
  const st = Object.fromEntries(r.rows.map(x => [x[0], x[1]]));
  check('DNS-flagged sender domain (Cloudflare Security) moved', r.spammed.includes('#thread-f:4001'), r.spammed);
  check('adult-content-only block: caution, not moved', st['#thread-f:4002'] === 'caution' && !r.spammed.includes('#thread-f:4002'), st);
  check('clean domain: clean, not moved', st['#thread-f:4003'] === 'clean' && !r.spammed.includes('#thread-f:4003'), st);
  check('non-existent domain: flagged (red) and moved', r.spammed.includes('#thread-f:4004'), r.spammed);
  await ctx.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
