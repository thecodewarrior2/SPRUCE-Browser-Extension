// The Firefox suite: the add-on's Firefox build running in real Firefox. Covers what only Firefox can
// show: the background page (event page) and its QR/PDF scanner, the spam mover's clicks into Gmail,
// message frames (Firefox before 148 has no location.ancestorOrigins), permission requests (Firefox
// accepts them only directly inside a click), site access that the user can switch off, and policy.
//
//     tests/firefox/get-firefox.sh          once: downloads Firefox ESR into tests/.firefox/
//     node tests/firefox/run.js             builds build/firefox from this working tree and tests it
//     FXBIN=… FXEXT=… node tests/firefox/run.js   another Firefox, or another Firefox build
const fs = require('fs');
const path = require('path');
const { launch, openExt, serve, until, errorsOf, check, done, isFirefoxBuild, FXBIN, EXT } = require('./harness');

if (!isFirefoxBuild()) {
  console.log(`FAIL: ${EXT} isn't a Firefox build (its manifest has no background page). Leave FXEXT unset to build one with tools/build.js.`);
  process.exit(1);
}

const SCAM = 'billing@evil-scam.test\nphisher@evil-scam.test\nrescued@evil-scam.test';
const RAW = { 'msg-f:3001': ['Delivered-To: teacher@school.org',
  'Received: from mail.evil-scam.test (mail.evil-scam.test. [8.8.8.8]) by mx.google.com with ESMTPS id y; Thu, 29 Oct 2026 08:00:00 -0700',
  'Authentication-Results: mx.google.com; dkim=none; spf=pass smtp.mailfrom=phisher@evil-scam.test; dmarc=fail (p=NONE) header.from=evil-scam.test',
  'From: IT Support <phisher@evil-scam.test>', 'To: teacher@school.org', 'Subject: Your password expires', '', 'body'].join('\r\n') };
const settings = (page) => openExt(page, 'options.html', () => document.querySelectorAll('[data-setting]').length > 10);

(async () => {
  console.log(`Firefox suite: ${EXT} in ${FXBIN}`);
  const browser = await launch();
  console.log(`  (${await browser.version()})`);

  // --- The background page answers, and the settings page loads cleanly.
  const opt = await settings(browser);
  const optErrors = errorsOf(opt);
  // Seeded first: the background reads the downloaded lists once and keeps them (only its own list
  // updates replace them), so they must be in place before anything makes it read them.
  await opt.evaluate((entries) => chrome.storage.local.set({
    feed_sefinekemails: { updated: Date.now(), count: 3, entries },     // the scam-sender list, as downloaded
    spamMovedThreads: { 'thread-f:1005': Date.now() - 1000 }, enableDnsThreatCheck: false
  }), SCAM);
  const bg = await opt.evaluate(async () => ({
    settings: !!((await chrome.runtime.sendMessage({ action: 'getSettings' })) || {}).values,
    unwrap: ((await chrome.runtime.sendMessage({ action: 'testUnwrap', url: 'https://www.google.com/url?q=https://example.com/x' })) || {}).unwrappedUrl,
    // [5.90-2] The single-company endings (the bundled copy, read by the background page).
    endings: await chrome.runtime.sendMessage({ action: 'getCompanyEndings' }).then(d => d && d.endings && d.operators ? { amex: d.operators[d.endings.amex] || '', app: 'app' in d.endings, count: Object.keys(d.endings).length } : null)
  }));
  check('background page answers (settings, link decoding)', bg.settings && bg.unwrap === 'https://example.com/x', bg);
  check('[5.90-2] background page hands out the single-company endings (ICANN\'s list: .amex, not .app)', bg.endings && /American Express/.test(bg.endings.amex) && !bg.endings.app && bg.endings.count >= 100, bg.endings);
  const variants = await opt.evaluate(() => ({
    browser: document.documentElement.dataset.browser,
    ownCard: !!document.getElementById('copyFirefoxPolicyBtn') && !!document.getElementById('checkExtensionsBtn'),
    othersGone: !document.getElementById('copyPolicyJsonBtn') && !document.getElementById('copyRegScriptBtn'),
    allMarkedShown: [...document.querySelectorAll('[data-only]')].every(e => e.hasAttribute('data-shown') && e.getAttribute('data-only').split(' ').includes('firefox')),
    deployHelp: /policies\.json/.test(document.getElementById('help-deploy').textContent) && !/Google Admin console/.test(document.getElementById('help-deploy').textContent)
  }));
  check('settings page: Firefox\'s own passages kept (policies.json tools and Help), Chrome\'s and Safari\'s removed', variants.browser === 'firefox' && variants.ownCard && variants.othersGone && variants.allMarkedShown && variants.deployHelp, variants);

  // --- Inbox: labels, and moving flagged emails with Gmail's own Report spam.
  const inbox = await browser.newPage();
  const inboxErrors = errorsOf(inbox);
  await serve(inbox, 'mail.google.com', 'fake-gmail-list.html', RAW);
  inbox.goto('https://mail.google.com/mail/u/0/#inbox', { timeout: 0 }).catch(() => {});
  const spammed = await until(() => inbox.evaluate(() => window.__spammed), (s) => s && s.length >= 2, 25000);
  check('inbox: the two flagged emails are moved to Spam (the clicks reach Gmail)', spammed && spammed.includes('#thread-f:1001') && spammed.includes('#thread-f:1007') && !spammed.includes('#thread-f:1005'), spammed);
  const notice = await until(() => inbox.evaluate(() => (document.querySelector('.unshortener-spam-notice') || {}).textContent || ''), (t) => /2 emails/.test(t), 8000);
  check('inbox: the moved-to-Spam notice is shown', /2 emails from flagged senders were moved to Spam/.test(notice || ''), notice);
  const rows = await inbox.evaluate(() => Object.fromEntries([...document.querySelectorAll('tr.zA')].map(r => { const c = r.querySelector('.unshortener-sender-chip'); return [r.querySelector('[data-thread-id]').getAttribute('data-thread-id'), { status: c && c.dataset.status, flag: (r.querySelector('.unshortener-sender-flag') || {}).textContent || null, avatar: !!r.querySelector('.unshortener-row-avatar') }]; })));
  check('inbox: a conversation taken out of Spam stays, still labelled flagged', rows['#thread-f:1005'] && rows['#thread-f:1005'].status === 'flagged', rows['#thread-f:1005']);
  check('inbox: country flag and picture circles', rows['#thread-f:1003'] && rows['#thread-f:1003'].flag === '🇩🇪' && Object.values(rows).some(r => r.avatar), rows);
  const busy = await until(() => inbox.evaluate(() => document.documentElement.dataset.unshortenerBusy), (b) => b === '0', 15000);
  check('inbox: everything checked and decided', busy === '0', busy);
  check('inbox: no errors in the webmail page (none reported from the add-on either)', inboxErrors.length === 0, inboxErrors);
  await inbox.close();

  // --- Opened email: links, the original headers, the warning, the copy button.
  const mail = await browser.newPage();
  const mailErrors = errorsOf(mail);
  await serve(mail, 'mail.google.com', 'fake-gmail-thread.html', RAW);
  mail.goto('https://mail.google.com/mail/u/0/#label/work/FMfcgz', { timeout: 0 }).catch(() => {});
  const opened = await until(() => mail.evaluate(() => { const a = document.querySelector('.unshortener-sender-address'); const l = document.querySelector('.ii.gt a'); const b = document.querySelector('.unshortener-email-banner');
    return { status: a && a.dataset.status, title: a && a.title, link: l && l.dataset.unshortened, banner: b && b.textContent }; }),
    (v) => v && v.status === 'flagged' && v.link && /DMARC fail/.test(v.title || '') && /flagged/.test(v.banner || ''), 25000);
  check('opened email: links checked, sender flagged, Gmail\'s DMARC result read, banner shown', opened && opened.link === 'true' && opened.status === 'flagged' && /DMARC fail/.test(opened.title || '') && /This email is flagged/.test(opened.banner || ''), opened);
  await mail.click('.unshortener-copy-address');
  const copied = await until(() => mail.evaluate(() => (document.querySelector('.unshortener-copy-status') || {}).textContent), (t) => !!t, 4000);
  check('opened email: the copy button copies (Firefox needs the click itself)', copied === 'Copied', copied);
  check('opened email: no errors in the webmail page', mailErrors.length === 0, mailErrors);
  await mail.close();

  // --- QR codes and PDF attachments: scanned in the background page (pdf.js as a module there).
  const fixture = (f) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', f)).toString('base64');
  const img = await opt.evaluate((b64) => chrome.runtime.sendMessage({ action: 'scanQr', b64, mime: 'image/png' }), fixture('qr.png'));
  check('QR code in an image decoded', img && img.ok && (img.codes || []).some(c => /qr-target\.example/.test(c.text)), img);
  const pdf = await opt.evaluate((b64) => chrome.runtime.sendMessage({ action: 'scanQr', b64, mime: 'application/pdf', name: 'invoice.pdf' }), fixture('qr.pdf'));
  check('PDF attachment: its QR code and its link found', pdf && pdf.ok && (pdf.codes || []).some(c => /qr-target\.example/.test(c.text)) && (pdf.links || []).some(l => /pdf-link\.example/.test(l.url)), pdf);

  // --- Message frames, in the four ways webmail apps make them (Proton, iCloud, Zoho, GMX).
  const frames = await browser.newPage();
  await serve(frames, 'mail.proton.me', 'fake-proton.html');
  frames.goto('https://mail.proton.me/u/0/inbox', { timeout: 0 }).catch(() => {});
  const readFrames = async () => {
    const out = {};
    for (const fr of frames.frames()) {
      if (fr === frames.mainFrame()) continue;
      const r = await fr.evaluate(() => { const a = document.querySelector('a'); return a ? [a.href.slice(-1), a.dataset.unshortened || null] : null; }).catch(() => null);
      if (r) out['frame' + r[0]] = r[1];
    }
    return out;
  };
  const fr = await until(readFrames, (o) => o && ['frame1', 'frame2', 'frame3', 'frame4'].every(k => o[k]), 15000);
  check('message frames: same-origin, opaque sandboxed, blob: and sandboxed same-origin frames all checked', fr && ['frame1', 'frame2', 'frame3', 'frame4'].every(k => fr[k]), fr);

  // --- "Check installed extensions": Firefox refuses a permission request that isn't made directly
  // in the click; with the request inside the click it's granted (no prompt in this test browser).
  await opt.evaluate(() => document.getElementById('conflicts').scrollIntoView());
  await opt.click('#checkExtensionsBtn');
  const checkedNote = await until(() => opt.evaluate(() => document.getElementById('checkExtensionsNote').textContent), (t) => /Checked|Not checked/.test(t || ''), 8000);
  check('Check installed extensions: the permission is asked for and granted', /Checked just now/.test(checkedNote || ''), checkedNote);
  check('settings page: no errors', optErrors.length === 0, optErrors);

  // --- Site access switched off for Gmail: nothing runs there; the popup says so and turns it back on.
  const gm = await browser.newPage();
  await serve(gm, 'mail.google.com', 'fake-gmail-list.html', RAW);
  const chipsIn = () => gm.evaluate(() => document.querySelectorAll('.unshortener-sender-chip').length);
  gm.goto('https://mail.google.com/mail/u/0/?a=1#inbox', { timeout: 0 }).catch(() => {});
  await until(chipsIn, (n) => n > 0, 15000);                       // access on: checked as usual
  const pop = await openExt(browser, 'popup.html', () => document.documentElement.dataset.loaded === '1');
  const gmailTab = await pop.evaluate(async () => (await chrome.tabs.query({ url: 'https://mail.google.com/*' }))[0]);
  await pop.evaluate(() => chrome.permissions.remove({ origins: ['https://mail.google.com/*'] }));
  gm.goto('https://mail.google.com/mail/u/0/?a=2#inbox', { timeout: 0 }).catch(() => {});
  await until(() => gm.evaluate(() => location.search === '?a=2' && document.querySelectorAll('tr.zA').length), (n) => n > 0, 15000);
  const unlabelled = await until(chipsIn, (n) => n > 0, 4000);   // given time to (wrongly) appear
  check('site access off: nothing is checked in Gmail', unlabelled === 0, unlabelled);
  const shown = await pop.evaluate((tab) => renderSiteAccess(tab).then(r => ({ r, visible: !document.getElementById('siteAccess').hidden, label: document.getElementById('siteAccessBtn').textContent })), { id: gmailTab.id, url: gmailTab.url });
  check('site access off: the popup says so, with an Allow button', shown.r === true && shown.visible && shown.label === 'Allow on mail.google.com', shown);
  await pop.click('#siteAccessBtn').catch(() => {});                // the popup closes itself once access is back
  const relabelled = await until(chipsIn, (n) => n > 0, 20000);
  check('Allow: access granted and the Gmail tab reloaded, so it is checked again', relabelled > 0, relabelled);
  await browser.close();

  // --- Organization policy (policies.json → 3rdparty → Extensions), in this suite's own Firefox only.
  const distribution = path.join(path.dirname(FXBIN), 'distribution');
  if (FXBIN.includes(`${path.sep}.firefox${path.sep}`)) {
    fs.mkdirSync(distribution, { recursive: true });
    fs.writeFileSync(path.join(distribution, 'policies.json'), JSON.stringify({ policies: { '3rdparty': { Extensions: { 'spruce@spruce-browser-extension': {
      managedEnableAutoSpam: false, managedRetentionDays: 30, managedTrustedSenders: ['partner.org'],
      managedPhishSimulationRules: [{ name: 'KnowBe4', header: 'X-PHISHTEST', ips: ['147.160.167.0/26'] }] } } } } }));
    try {
      const b2 = await launch();
      const o2 = await settings(b2);
      const pol = await until(() => o2.evaluate(async () => { const cfg = await loadEffectiveSettings(); const t = document.querySelector('[data-setting="enableAutoSpam"]');
        return { locked: Object.keys(cfg.locked), autoSpam: cfg.values.enableAutoSpam, days: cfg.values.retentionDays, trusted: cfg.trustedSenders, rules: (cfg.policy.phishSimRules || []).length, toggle: t && t.disabled && !t.checked }; }),
        (v) => v && v.locked.includes('enableAutoSpam') && v.toggle, 8000);   // the page's own render (bindSettings) applies the lock a moment after the policy can be read
      check('policy: settings locked (shown disabled), values applied, trusted senders and simulation rules read',
        pol && pol.autoSpam === false && pol.days === 30 && pol.toggle && (pol.trusted || []).includes('partner.org') && pol.rules === 1, pol);
      await b2.close();
    } finally { fs.rmSync(path.join(distribution, 'policies.json'), { force: true }); }
  } else console.log('  SKIP  policy (only in the suite\'s own Firefox from get-firefox.sh, which it may change)');
  done();
})().catch((e) => { console.error(e); process.exit(1); });
