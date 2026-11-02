// The Settings page: sender switches, trusted senders, logging and help, with no page errors.
const { launch, until, optionsReady, check, done } = require('./harness');
(async () => {
  const { ctx, sw } = await launch();
  const ID = new URL(sw.url()).host;
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  await page.goto(`chrome-extension://${ID}/options.html`);
  const toggles = await until(() => page.$$eval('[data-setting^="enableSender"], [data-setting="enableAutoSpam"], [data-setting="enableSpamNotice"]', els => els.map(e => [e.dataset.setting, e.checked, e.disabled])),
    t => t.length === 10 && t.every(x => x[1]), 10000);
  await optionsReady(page);                          // every control bound: loading is over (its errors, if any, are caught)
  check('ten sender switches (incl. stand-in icons, photos and BIMI logos), all on, unlocked', toggles.length === 10 && toggles.some(t => t[0] === 'enableSenderBimi') && toggles.some(t => t[0] === 'enableSenderIconFallback') && toggles.some(t => t[0] === 'enableSenderAvatars') && toggles.every(t => t[1] && !t[2]), toggles);
  await page.evaluate(() => { document.getElementById('trustedSenderInput').closest('details').open = true; });
  await page.fill('#trustedSenderInput', '@Evil-Scam.test');
  await page.click('#addTrustedSenderBtn');
  const trusted = () => sw.evaluate(() => new Promise(r => chrome.storage.local.get('customTrustedSenders', r)));
  await until(trusted, v => (v.customTrustedSenders || []).length === 1, 8000);
  await page.fill('#trustedSenderInput', 'not valid');
  await page.click('#addTrustedSenderBtn');
  await until(() => errors.slice(), e => e.some(x => /Enter an email address/.test(x)), 8000);
  const stored = await trusted();
  check('add sender: normalized and stored', JSON.stringify(stored.customTrustedSenders) === '["evil-scam.test"]', stored);
  check('invalid entry rejected with a message', errors.some(e => /Enter an email address/.test(e)), errors);
  const rows = await page.$$eval('#trustedSenderTable tbody tr', t => t.map(r => r.textContent));
  check('table shows the entry with Remove', rows.length === 1 && /evil-scam\.test.*Remove/.test(rows[0]), rows);
  await page.click('#trustedSenderTable .del-btn');
  const after = await until(trusted, v => (v.customTrustedSenders || []).length === 0, 8000);
  check('remove works', after.customTrustedSenders.length === 0, after);
  // 5.87: the allow/block lists accept a pasted URL (reduced to its domain) and refuse junk; an old
  // junk entry is marked as having no effect; a malformed cache entry doesn't break the cache table.
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));
  await page.fill('#domainBlockInput', 'https://Bad-Site.example/login?x=1');
  await page.click('#addBlockBtn');
  const block = () => sw.evaluate(() => new Promise(r => chrome.storage.local.get('customBlocklist', r)));
  let bl = await until(block, v => (v.customBlocklist || []).length === 1, 8000);
  check('block list: a pasted URL is stored as its domain', JSON.stringify(bl.customBlocklist) === '["bad-site.example"]', bl);
  await page.fill('#domainBlockInput', 'not a domain!!');
  await page.click('#addBlockBtn');
  await until(() => errors.slice(), e => e.some(x => /doesn't look like a site domain/.test(x)), 8000);
  bl = await block();
  check('block list: junk refused with a message', (bl.customBlocklist || []).length === 1, bl);
  await sw.evaluate(() => chrome.storage.local.set({
    customBlocklist: ['bad-site.example', 'not a domain'],
    'https://junk.example/x': null,
    'https://junk2.example/x': { isSafe: true },
    'https://ok.example/x': { finalUrl: 'https://real.example/', resolver: 'Test', isSafe: true, cachedDate: '1/1/2026', cachedTimestamp: Date.now() }
  }));
  // The policy tables re-render on the page's own actions, not on outside writes: reload to see them.
  await page.reload();
  await optionsReady(page);
  await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));
  const inert = await until(() => page.$$eval('#blockTable tbody tr', t => t.map(r => r.textContent)), rs => rs.some(r => /not a domain/.test(r)), 8000);
  check('a stored non-domain entry is marked as having no effect', inert.some(r => /not a domain/.test(r) && /no effect/.test(r)), inert);
  await page.evaluate(() => document.querySelector('.tab-btn[data-tab="logging"]').click());
  await page.evaluate(() => document.querySelector('#logNav button[data-log="cache"]').click());
  const cacheRows = await until(() => page.$$eval('#cacheTable tbody tr', t => t.map(r => r.textContent)), rs => rs.some(r => /real\.example/.test(r)), 8000);
  check('URL cache table renders even with malformed entries', cacheRows.some(r => /real\.example/.test(r)) && cacheRows.some(r => /junk2\.example/.test(r)) && cacheRows.some(r => /junk\.example/.test(r)), cacheRows.length);
  await sw.evaluate(() => chrome.storage.local.remove(['https://junk.example/x', 'https://junk2.example/x', 'https://ok.example/x']).then(() => chrome.storage.local.set({ customBlocklist: [] })));
  await page.evaluate(() => document.querySelector('.tab-btn[data-tab="settings"]').click());
  // Toggle a switch: stored.
  await page.click('[data-setting="enableAutoSpam"] + .slider');
  const t = await until(() => sw.evaluate(() => new Promise(r => chrome.storage.local.get('enableAutoSpam', r))), v => v.enableAutoSpam === false, 8000);
  check('switch writes the setting', t.enableAutoSpam === false, t);
  // Help pages.
  await page.click('.tab-btn[data-tab="help"], button:has-text("Help")').catch(() => {});
  await page.evaluate(() => { const b = document.querySelector('#helpNav [data-help="senders"]'); b && b.click(); });
  const helpText = await until(() => page.$eval('#help-senders', s => s.offsetParent !== null && s.textContent.length), n => n > 1000, 8000);
  check('Help → Sender icons & Spam renders', helpText > 1000, helpText);
  await page.evaluate(() => document.querySelector('#helpNav [data-help="privacy"]').click());
  const priv = await until(() => page.$eval('#privacySendsTable', e => e.textContent), t => /Sender checks/.test(t) && /country\.is/.test(t), 8000);
  check('privacy table lists sender checks, icons and country', /Sender checks/.test(priv) && /Sender icons/.test(priv) && /country\.is/.test(priv), priv.slice(0, 200));
  await page.evaluate(() => document.querySelector('#helpNav [data-help="architecture"]').click());
  const arch = await until(() => page.$eval('#help-architecture', e => e.textContent), t => /managedEnableAutoSpam/.test(t) && /Sefinek scam-sender list/.test(t), 10000);
  check('architecture: settings reference has the new keys', /managedEnableAutoSpam/.test(arch) && /managedTrustedSenders/.test(arch) && !/managedPhishingSenders/.test(arch) && /api\.country\.is/.test(arch) && /checkSenders/.test(arch), '');
  check('architecture lists the scam-sender list state', /Sefinek scam-sender list/.test(arch));
  // Every downloaded list is in the deep dive, and every list and online service is credited.
  const lists = await until(() => page.evaluate(() => [...document.querySelectorAll('#archAllLists tbody tr')].map(r => r.cells[0].textContent)), l => l.length >= 7, 8000);
  check('architecture: all seven downloaded lists, with their state', lists.length === 7 && ['url-shorteners', 'OpenPhish', 'Phishing Army', 'Sefinek', 'Chrome UX Report', 'Tranco'].every(n => lists.some(l => l.includes(n))), lists);
  const layout = await page.evaluate(() => ({
    columns: [...document.querySelectorAll('#archAllLists thead th')].map(th => th.textContent),
    safeguards: [...document.querySelectorAll('#archLists thead th')].map(th => th.textContent),
    state: document.getElementById('archState').textContent }));
  check('architecture: lists show entries in use, entries on hold and last update; one safeguards table for all three kinds of list',
    ['In use', 'New entries on hold', 'Last update'].every(c => layout.columns.includes(c)) && ['Short-link lists', 'Phishing and scam lists', 'Popular-site lists'].every(c => layout.safeguards.includes(c)), layout);
  check('architecture: "This installation right now" doesn\'t repeat the lists', !/OpenPhish|url-shorteners|Synced shortener/.test(layout.state) && /see Downloaded lists above/.test(layout.state), layout.state.slice(0, 300));
  const credits = await page.$eval('#help-about', e => e.textContent);
  const missing = ['PeterDaveHello', 'boutetnico', 'OpenPhish', 'Phishing Army', 'Sefinek', 'Chrome UX Report', 'Tranco', 'unshorten.me', 'DuckDuckGo', 'country.is', 'IANA'].filter(n => !credits.includes(n));
  check('About & credits names every list and online service', missing.length === 0, missing);
  check('no page errors', errors.filter(e => !/^dialog/.test(e)).length === 0, errors);
  // Popup renders.
  const pop = await ctx.newPage();
  const perr = [];
  pop.on('pageerror', e => perr.push(e.message));
  await pop.goto(`chrome-extension://${ID}/popup.html`);
  await pop.waitForSelector('html[data-loaded]', { state: 'attached' });   // settings applied: loading is over
  check('popup has no errors', perr.length === 0, perr);
  // Drop-down menus in the dark appearance: the open list uses the menu's own colors (Firefox), so the
  // menu and its options must have an opaque dark background and readable text.
  await sw.evaluate(() => chrome.storage.local.set({ uiTheme: 'dark' }));
  for (const pg of [pop, page]) {
    await pg.reload(); await pg.waitForFunction(() => document.documentElement.dataset.resolved === 'dark');
    const menus = await pg.evaluate(() => {
      const lum = (c) => { const m = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      return [...document.querySelectorAll('select')].map(sel => { const o = getComputedStyle(sel.options[0] || sel), m = getComputedStyle(sel);
        return { id: sel.id || sel.dataset.setting, opaque: !/rgba\(.*, 0\)$/.test(m.backgroundColor) && !/rgba\(.*, 0\)$/.test(o.backgroundColor), dark: lum(o.backgroundColor) < 0.1, contrast: Math.round(ratio(o.color, o.backgroundColor) * 10) / 10 }; });
    });
    check(`dark appearance: every drop-down menu (${pg === pop ? 'popup' : 'Settings'}) is dark with readable options`, menus.length > 0 && menus.every(x => x.opaque && x.dark && x.contrast >= 4.5), menus.filter(x => !(x.opaque && x.dark && x.contrast >= 4.5)));
  }
  await sw.evaluate(() => chrome.storage.local.remove('uiTheme'));
  // Help → Which features work where: generated from the sites table.
  const hp = await ctx.newPage();
  await hp.setViewportSize({ width: 1280, height: 1000 });
  await hp.goto(`chrome-extension://${ID}/options.html`);
  await optionsReady(hp);
  await hp.evaluate(() => { document.querySelector('.tab-btn[data-tab="help"]').click(); document.querySelector('#helpNav button[data-help="compat"]').click(); });
  await hp.waitForSelector('#compatTable table thead th', { state: 'attached' });
  const chart = await hp.evaluate(() => {
    const t = document.querySelector('#compatTable table');
    const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent);
    const row = (name) => [...t.querySelectorAll('tbody tr')].find(r => r.firstElementChild.textContent.startsWith(name));
    const cells = (r) => [...r.querySelectorAll('td')].map(td => td.textContent);
    return { heads, move: cells(row('Flagged emails moved to Spam')), links: cells(row('Links:')), status: cells(row('Support')), list: cells(row('Sender icon, country flag and label in the inbox list')) };
  });
  check('compatibility chart: one column per webmail, Gmail first', chart.heads.length === 10 && chart.heads[1] === 'Gmail' && chart.heads.includes('Outlook') && chart.heads.includes('GMX'), chart.heads);
  check('compatibility chart: link checks on every site; moving to Spam on Gmail only', chart.links.every(c => c === '✓') && chart.move[0] === '✓' && chart.move.slice(1).every(c => c === '—'), chart);
  check('compatibility chart: inbox labels full on Gmail, Basic elsewhere', chart.list[0] === '✓' && chart.list.slice(1).every(c => c === 'Basic'), chart.list);
  check('compatibility chart: Gmail full, others experimental', chart.status[0] === 'Full' && chart.status.slice(1).every(c => c === 'Experimental'), chart.status);
  await hp.locator('#help-compat').screenshot({ path: __dirname + '/../compat-chart.png' });
  await hp.evaluate(() => document.querySelector('#helpNav button[data-help="architecture"]').click());
  const eng = await until(() => hp.evaluate(() => [...document.querySelectorAll('#archEngine tbody tr')].map(r => r.textContent)), rows => rows.length >= 9, 10000);
  check('architecture: live mail-engine table lists every site, Gmail trusting mx.google.com', eng.length === 9 && /Gmail.*trusts mx\.google\.com/.test(eng[0]), eng[0]);
  await hp.close();
  await ctx.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
