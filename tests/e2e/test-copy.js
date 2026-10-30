// The copy button after the sender's address in an opened email: copies the address, confirms it,
// works from the keyboard, is independent of the sender checks, and has its own switch.
const { launch, servePage, until, sleep, check, done } = require('./harness');
(async () => {
  const { ctx, sw } = await launch();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://mail.google.com' });
  await servePage(ctx, 'fake-gmail-thread.html');
  const set = (s) => sw.evaluate(async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }, s);
  const open = async () => { const p = await ctx.newPage(); await p.goto('https://mail.google.com/mail/u/0/?from=someone@example.org&name=Someone#inbox/abc'); return p; };
  const button = (p) => p.evaluate(() => { const b = document.querySelector('.unshortener-copy-address'); return b && { tag: b.tagName, label: b.getAttribute('aria-label'), afterAddress: !!(b.previousElementSibling && b.previousElementSibling.matches('.go')) }; });

  await set({ enableDnsThreatCheck: false });
  let p = await open();
  const b = await until(() => button(p), v => !!v, 8000);
  check('a copy button sits right after the sender\'s address (a real, labelled button)', b && b.tag === 'BUTTON' && b.afterAddress && /someone@example\.org/.test(b.label), b);
  await p.click('.unshortener-copy-address');
  const copied = await until(() => p.evaluate(() => navigator.clipboard.readText()), t => t === 'someone@example.org', 3000);
  check('clicking it copies the address', copied === 'someone@example.org', copied);
  const said = await p.evaluate(() => (document.querySelector('.unshortener-copy-status') || {}).textContent);
  check('…and confirms "Copied" (announced to screen readers)', said === 'Copied', said);
  await p.evaluate(() => navigator.clipboard.writeText('something else'));
  await p.focus('.unshortener-copy-address');
  await p.keyboard.press('Enter');
  const byKey = await until(() => p.evaluate(() => navigator.clipboard.readText()), t => t === 'someone@example.org', 3000);
  check('works from the keyboard', byKey === 'someone@example.org', byKey);
  const stillOpen = await p.evaluate(() => !!document.querySelector('.a3s'));
  check('the click doesn\'t reach the email header (the email stays open)', stillOpen);
  await p.close();

  // Independent of the sender checks.
  await set({ enableDnsThreatCheck: false, enableSenderIdentity: false, enableSenderDomainCheck: false, enableSenderAddressCheck: false });
  p = await open();
  check('sender checks all off: the copy button is still there', !!(await until(() => button(p), v => !!v, 8000)));
  await p.close();
  // Its own switch.
  await set({ enableDnsThreatCheck: false, enableCopyAddress: false });
  p = await open();
  await sleep(2500);
  check('switched off: no copy button', !(await button(p)));
  await p.close();
  await ctx.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
