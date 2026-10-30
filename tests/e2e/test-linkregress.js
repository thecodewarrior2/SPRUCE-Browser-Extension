// Links in an email opened from a label (not the inbox) are still checked.
const { launch, servePage, waitFor, check, done } = require('./harness');
(async () => {
  const { ctx } = await launch();
  await servePage(ctx, 'fake-gmail-thread.html');
  const page = await ctx.newPage();
  await page.goto('https://mail.google.com/mail/u/0/?from=someone@example.org#label/x/abc');
  const t0 = Date.now();
  const ok = await waitFor(() => page.evaluate(() => (document.querySelector('.ii.gt a') || { dataset: {} }).dataset.unshortened === 'true'), 30000, 250);
  check(`email opened from a label: its link is checked (${Date.now() - t0} ms)`, !!ok);
  await ctx.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
