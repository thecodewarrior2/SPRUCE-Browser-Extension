// The Settings page: sender switches, trusted senders, logging and help, with no page errors.
const { launch, servePage, sleep, until, check, done } = require('./harness');
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
  await sleep(1000);                                 // late page errors, if any, are caught too
  check('ten sender switches (incl. stand-in icons, photos and BIMI logos), all on, unlocked', toggles.length === 10 && toggles.some(t => t[0] === 'enableSenderBimi') && toggles.some(t => t[0] === 'enableSenderIconFallback') && toggles.some(t => t[0] === 'enableSenderAvatars') && toggles.every(t => t[1] && !t[2]), toggles);
  await page.evaluate(() => { document.getElementById('trustedSenderInput').closest('details').open = true; });
  await page.fill('#trustedSenderInput', '@Evil-Scam.test');
  await page.click('#addTrustedSenderBtn');
  await sleep(500);
  await page.fill('#trustedSenderInput', 'not valid');
  await page.click('#addTrustedSenderBtn');
  await sleep(300);
  const stored = await sw.evaluate(() => new Promise(r => chrome.storage.local.get('customTrustedSenders', r)));
  check('add sender: normalized and stored', JSON.stringify(stored.customTrustedSenders) === '["evil-scam.test"]', stored);
  check('invalid entry rejected with a message', errors.some(e => /Enter an email address/.test(e)), errors);
  const rows = await page.$$eval('#trustedSenderTable tbody tr', t => t.map(r => r.textContent));
  check('table shows the entry with Remove', rows.length === 1 && /evil-scam\.test.*Remove/.test(rows[0]), rows);
  await page.click('#trustedSenderTable .del-btn');
  await sleep(500);
  const after = await sw.evaluate(() => new Promise(r => chrome.storage.local.get('customTrustedSenders', r)));
  check('remove works', after.customTrustedSenders.length === 0, after);
  // Toggle a switch: stored.
  await page.click('[data-setting="enableAutoSpam"] + .slider');
  await sleep(300);
  const t = await sw.evaluate(() => new Promise(r => chrome.storage.local.get('enableAutoSpam', r)));
  check('switch writes the setting', t.enableAutoSpam === false, t);
  // Help pages.
  await page.click('.tab-btn[data-tab="help"], button:has-text("Help")').catch(() => {});
  await page.evaluate(() => { const b = document.querySelector('#helpNav [data-help="senders"]'); b && b.click(); });
  await sleep(500);
  const helpText = await page.$eval('#help-senders', s => s.offsetParent !== null && s.textContent.length);
  check('Help → Sender icons & Spam renders', helpText > 1000, helpText);
  await page.evaluate(() => document.querySelector('#helpNav [data-help="privacy"]').click());
  await sleep(800);
  const priv = await page.$eval('#privacySendsTable', e => e.textContent);
  check('privacy table lists sender checks, icons and country', /Sender checks/.test(priv) && /Sender icons/.test(priv) && /country\.is/.test(priv), priv.slice(0, 200));
  await page.evaluate(() => document.querySelector('#helpNav [data-help="architecture"]').click());
  await sleep(1200);
  const arch = await page.$eval('#help-architecture', e => e.textContent);
  check('architecture: settings reference has the new keys', /managedEnableAutoSpam/.test(arch) && /managedTrustedSenders/.test(arch) && !/managedPhishingSenders/.test(arch) && /api\.country\.is/.test(arch) && /checkSenders/.test(arch), '');
  check('architecture lists the scam-sender list state', /Sefinek scam-sender list/.test(arch));
  check('no page errors', errors.filter(e => !/^dialog/.test(e)).length === 0, errors);
  // Popup renders.
  const pop = await ctx.newPage();
  const perr = [];
  pop.on('pageerror', e => perr.push(e.message));
  await pop.goto(`chrome-extension://${ID}/popup.html`);
  await sleep(1000);
  check('popup has no errors', perr.length === 0, perr);
  // Help → Which features work where: generated from the sites table.
  const hp = await ctx.newPage();
  await hp.setViewportSize({ width: 1280, height: 1000 });
  await hp.goto(`chrome-extension://${ID}/options.html`);
  await sleep(1500);
  await hp.evaluate(() => { document.querySelector('.tab-btn[data-tab="help"]').click(); document.querySelector('#helpNav button[data-help="compat"]').click(); });
  await sleep(500);
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
  await sleep(800);
  const eng = await hp.evaluate(() => [...document.querySelectorAll('#archEngine tbody tr')].map(r => r.textContent));
  check('architecture: live mail-engine table lists every site, Gmail trusting mx.google.com', eng.length === 9 && /Gmail.*trusts mx\.google\.com/.test(eng[0]), eng[0]);
  await hp.close();
  await ctx.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
