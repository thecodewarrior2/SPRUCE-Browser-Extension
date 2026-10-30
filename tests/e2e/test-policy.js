// Administrator policy: chrome.storage.managed is stubbed (Linux Chromium doesn't load extension
// policies from files), in the background and on the options page, exactly as Chrome would supply it.
const { launch, servePage, sleep, listSettled, check, part, runParts } = require('./harness');
const stub = (policy) => {
  const get = (keys, cb) => {
    let r = {};
    if (keys === null || keys === undefined) r = { ...policy };
    else for (const k of (Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys))) if (k in policy) r[k] = policy[k];
    if (cb) setTimeout(() => cb(r), 0); else return Promise.resolve(r);
  };
  chrome.storage.managed.get = get;
};
async function run(policy, local, moves = 0, url = 'https://mail.google.com/mail/u/0/#inbox') {
  policy = Object.assign({}, (local && local.__testManaged) || {}, policy);
  const { ctx, sw } = await launch();
  await ctx.addInitScript(`(${stub.toString()})(${JSON.stringify(policy)})`);
  await sw.evaluate(`(${stub.toString()})(${JSON.stringify(policy)}); invalidateConfig();`);
  await sw.evaluate((s) => chrome.storage.local.set(s), Object.assign({ enableDnsThreatCheck: false, spamMovedThreads: { 'thread-f:1005': 1 } }, local));
  await sleep(300);
  await servePage(ctx, 'fake-gmail-list.html');
  const page = await ctx.newPage();
  await page.goto(url);
  await listSettled(page, sw, moves);
  const r = await page.evaluate(() => ({ spammed: window.__spammed, chips: [...document.querySelectorAll('.unshortener-sender-chip')].map(c => c.dataset.status + ':' + c.title.split('\n')[1]) }));
  r.ctx = ctx; r.sw = sw;
  return r;
}
async function options(ctx, sw) {
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${new URL(sw.url()).host}/options.html`);
  await sleep(1500);
  return opt;
}
// One part per policy case (each its own browser), run in parallel.
part('old-block-list', async () => {
  // The sender block list was removed: an old managedPhishingSenders policy is ignored.
  const r = await run({ managedPhishingSenders: ['billing@evil-scam.test', 'evil-scam.test'], managedTrustedSenders: ['partner@trusted.test', 'junk'] }, { __testScamSenders: ['phisher@evil-scam.test'] }, 1);
  check('old managedPhishingSenders policy ignored; community list flags and moves', r.spammed.length === 1 && r.spammed[0] === '#thread-f:1001', r.spammed);
  const act = await r.sw.evaluate(() => new Promise(res => chrome.storage.local.get('recentActivity', res)));
  check('list name recorded with the move', (act.recentActivity || []).some(a => /Test scam-sender list/.test(a.text)), act.recentActivity);
  const opt = await options(r.ctx, r.sw);
  const rows = await opt.$$eval('#trustedSenderTable tbody tr', trs => trs.map(t => t.textContent));
  check('options: organization trusted senders shown as managed (invalid entry dropped)', rows.length === 1 && /partner@trusted\.test/.test(rows[0]) && /Managed/.test(rows[0]), rows);
  await r.ctx.close();
});

part('donate-button', async () => {
  // The Donate button in About, unless the organization hides it.
  for (const [policy, want] of [[{}, true], [{ managedHideDonateButton: true }, false]]) {
    const r = await run(policy, {});
    const opt = await options(r.ctx, r.sw);
    const shown = await opt.evaluate(() => { const d = document.getElementById('donateRow'); return !!d && !d.hidden && /paypal\.com\/donate/.test(d.querySelector('a').href); });
    check(want ? 'About shows the Donate button' : 'managedHideDonateButton hides the Donate button', shown === want, { policy, shown });
    await r.ctx.close();
  }
});

part('auto-spam-locked', async () => {
  const r = await run({ managedEnableAutoSpam: false }, { __testScamSenders: ['phisher@evil-scam.test'], enableAutoSpam: true });
  check('managed auto-spam off wins over the user\'s setting', r.spammed.length === 0 && r.chips.some(c => c.startsWith('flagged')), r.spammed);
  const opt = await options(r.ctx, r.sw);
  const lock = await opt.evaluate(() => { const el = document.querySelector('[data-setting="enableAutoSpam"]'); return el && { checked: el.checked, disabled: el.disabled, note: !!el.closest('.setting-row').querySelector('.lock-note') }; });
  check('options page: auto-spam locked by the organization', lock && lock.disabled && !lock.checked && lock.note, lock);
  await r.ctx.close();
});

part('simulation-domain', async () => {
  const r = await run({ managedPhishSimulationDomains: ['evil-scam.test'] }, { __testScamSenders: ['phisher@evil-scam.test', 'billing@evil-scam.test'] });
  check('phishing-simulation sender domain: never moved', r.spammed.length === 0, r.spammed);
  await r.ctx.close();
});

part('simulation-links', async () => {
  const r = await run({ managedPhishSimulationDomains: ['training-links.example'] }, { __testScamSenders: ['phisher@evil-scam.test', 'billing@evil-scam.test'] });
  check('simulation link domains set: never moved from the list (links unknown there)', r.spammed.length === 0, r.spammed);
  await r.ctx.close();
});

part('simulation-headers', async () => {
  const r = await run({ managedPhishSimulationRules: [{ name: 'KnowBe4', header: 'X-PHISHTEST', value: 'secret' }] }, { __testScamSenders: ['phisher@evil-scam.test', 'billing@evil-scam.test'] });
  check('simulation header rules + unread email (headers not read): not moved', r.spammed.length === 0, r.spammed);
  await r.ctx.close();
});

part('all-off', async () => {
  const r = await run({ managedEnableSenderIdentity: false, managedEnableSenderAddressCheck: false, managedEnableSenderDomainCheck: false }, { __testScamSenders: ['phisher@evil-scam.test'], enableSenderIdentity: true });
  check('all sender features off by policy: nothing drawn or moved', r.spammed.length === 0 && r.chips.length === 0, r.spammed);
  await r.ctx.close();
});

runParts().catch(e => { console.error(e); process.exit(1); });
