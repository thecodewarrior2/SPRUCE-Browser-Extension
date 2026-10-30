// Sender photos and logos harvested from opened emails (simulated Gmail, in the formats the real page
// uses): which ones are used, and how a change is picked up.
const { launch, servePage, sleep, waitFor, check, done } = require('./harness');
(async () => {
  const { ctx, sw } = await launch();
  await servePage(ctx, 'fake-gmail-thread.html');
  const set = (s) => sw.evaluate(async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }, s);
  const logs = () => sw.evaluate(async () => ((await chrome.storage.local.get('errorLogs')).errorLogs || []).map(e => e.message || ''));
  // Opens an email and waits until the log has a new entry about its sender (used, refused or failed),
  // instead of a fixed pause; quiet: nothing is expected, so a short fixed window.
  const mentions = async (who) => (await logs()).filter(m => m.includes(who) && /photo|logo/.test(m)).length;
  const open = async (q, quiet) => {
    const who = decodeURIComponent(/from=([^&]+)/.exec(q)[1]);
    const before = await mentions(who);
    const p = await ctx.newPage(); await p.goto('https://mail.google.com/mail/u/0/?' + q + '#inbox/abc');
    if (quiet) await sleep(4000); else await waitFor(async () => (await mentions(who)) > before, 12000);
    await p.close();
  };
  const about = (l, who) => l.filter(m => m.includes(who) && /photo|logo/.test(m));
  const used = (l, who) => about(l, who).filter(m => /could not be fetched|remembered|replaced/.test(m));
  const pass = (domain) => ({ 'msg-f:3001': `Received: from mail.${domain} ([203.0.113.5]) by mx.google.com; Mon, 13 Feb 2023 12:46:46 -0800\nAuthentication-Results: mx.google.com; dkim=pass header.i=@${domain}; spf=pass smtp.mailfrom=news@${domain}; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=${domain}\nFrom: Brand <news@${domain}>\nMIME-Version: 1.0\n\nhello` });
  // Photos in both address formats Gmail uses (fake addresses: the download fails, which the log
  // reports, proving the photo was asked for).
  const photoNew = encodeURIComponent('https://lh3.googleusercontent.com/a/ACg8ocTESTPHOTO-not-real=s40-p');
  const photoOld = encodeURIComponent('https://lh3.googleusercontent.com/-TESTxyz/AAAAAAAAAAI/AAAAAAAAAAA/notreal/s40-c/photo.jpg');
  const svg = (fill) => encodeURIComponent('data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="${fill}"/></svg>`).toString('base64'));
  await set({ enableDnsThreatCheck: true });
  // Own organization (the account is teacher@school.org): each colleague's own photo, both formats.
  await open(`from=pat.colleague@school.org&name=Pat&t=7001&avatar=${photoNew}`);
  await open(`from=lee.colleague@school.org&name=Lee&t=7002&avatar=${photoOld}`);
  await open(`from=it@school.org&name=IT&t=7010&avatar=${svg('green')}`);
  // Personal email service: nothing.
  await open(`from=stranger@gmail.com&name=Stranger&t=7003&avatar=${photoOld}`);
  // Another company, verification failed: nothing.
  await open(`from=brand@evil-scam.test&name=Brand&t=7004&avatar=${svg('red')}`);
  global.RAW_MESSAGES = pass('example.com');
  await open(`from=news@example.com&name=Bank&t=7005&avatar=${svg('red')}`);
  // A person at that company with their own photo: never used.
  await open(`from=bob.person@example.com&name=Bob&t=7011&avatar=${photoNew}`);
  // A company's shared mailbox with a picture from Gmail's photo host: asked for as the company's logo.
  global.RAW_MESSAGES = pass('example.org');
  await open(`from=contact@example.org&name=Company&t=7012&avatar=${photoNew}`);
  let l = await logs();
  check('a colleague\'s photo (new address format) is used', used(l, 'pat.colleague@school.org').length > 0, about(l, 'pat.colleague@school.org'));
  check('a colleague\'s photo in the older "/-xxxx/AAAAAAAAAAI/…/photo.jpg" format is used', used(l, 'lee.colleague@school.org').length > 0, about(l, 'lee.colleague@school.org'));
  check('your own organization\'s logo is never used (colleagues get their own photos)', used(l, 'it@school.org').length === 0 && about(l, 'it@school.org').some(m => /colleagues are shown with their own photos/.test(m)), about(l, 'it@school.org'));
  check('a personal email service sender\'s photo is never used, and the log says why', used(l, 'stranger@gmail.com').length === 0 && about(l, 'stranger@gmail.com').some(m => /personal email service/.test(m)), about(l, 'stranger@gmail.com'));
  check('a logo for an email that failed DMARC is not used', used(l, 'brand@evil-scam.test').length === 0 && about(l, 'brand@evil-scam.test').some(m => /passed \(DMARC\)/.test(m)), about(l, 'brand@evil-scam.test'));
  check('an embedded logo for an email that passed DMARC becomes the company\'s logo (nothing downloaded)', l.some(m => /Company logo for example\.com \(from news@example\.com\): remembered \(embedded by the webmail; nothing downloaded\)/.test(m)), about(l, 'news@example.com'));
  check('a person\'s own photo at another company is never used', used(l, 'bob.person@example.com').length === 0 && about(l, 'bob.person@example.com').some(m => /person's own photo; example\.com's logo is shown/.test(m)), about(l, 'bob.person@example.com'));
  check('a company\'s shared mailbox picture (Gmail photo host) is asked for as the company logo', l.some(m => /logo for example\.org \(from contact@example\.org\)/.test(m)), l.filter(m => /example\.org/.test(m)));
  // The company's logo changes: the new one replaces it.
  global.RAW_MESSAGES = pass('example.com');
  await open(`from=news@example.com&name=Bank&t=7006&avatar=${svg('blue')}`);
  l = await logs();
  check('a changed logo replaces the old one', l.some(m => /Company logo for example\.com .*changed, replaced/.test(m)), l.filter(m => /example\.com/.test(m)));
  const stored = await sw.evaluate(async () => { const r = await iconStore.get('logo:example.com'); return r && { type: r.type, source: r.source }; });
  check('stored once for the company, as an SVG logo', stored && stored.type === 'image/svg+xml' && stored.source === 'avatar-logo', stored);
  // …and in the inbox list it is a circle over the checkbox, for another person at that company too
  // (no photo of their own); the icon next to the sender stays the site's own.
  await ctx.unroute('https://mail.google.com/**');
  await servePage(ctx, 'fake-gmail-list.html');
  const p = await ctx.newPage();
  await p.goto('https://mail.google.com/mail/u/0/#inbox');
  await p.evaluate(() => window.__arrive([{ t: 7007, email: 'someone.else@example.com', name: 'Someone', subj: 'Hello', unread: true }]));
  const rowSel = 'tr.zA:has([data-thread-id="#thread-f:7007"])';
  const over = await waitFor(() => p.evaluate((sel) => {
    const row = document.querySelector(sel), i = row && row.querySelector('.unshortener-row-avatar');
    if (!i) return null;
    const box = row.querySelector('[role=checkbox]');
    return { src: i.src.slice(0, 26), radius: getComputedStyle(i).borderRadius, inCheckboxCell: i.parentElement === box.parentElement, shown: getComputedStyle(i).display !== 'none',
             clickThrough: getComputedStyle(i).pointerEvents === 'none', inline: !!row.querySelector('.unshortener-sender-icon img.unshortener-sender-avatar') };
  }, rowSel), 8000);
  check('inbox list: the company logo is a circle over the checkbox, for every address at the company', over && over.src === 'data:image/svg+xml;base64,' && over.radius === '50%' && over.inCheckboxCell && over.shown, over);
  check('inbox list: the picture never takes clicks, and is not drawn next to the sender', over && over.clickThrough && !over.inline, over);
  const box = await p.locator(rowSel).boundingBox();
  await p.mouse.move(box.x + 20, box.y + box.height / 2);
  await sleep(200);
  const onHover = await p.evaluate((sel) => getComputedStyle(document.querySelector(sel + ' .unshortener-row-avatar')).display, rowSel);
  check('inbox list: on hover the picture steps aside and the checkbox shows', onHover === 'none', onHover);
  await p.locator(rowSel + ' [role=checkbox]').click();
  await p.mouse.move(5, 5); await sleep(200);
  const ticked = await p.evaluate((sel) => ({ checked: document.querySelector(sel + ' [role=checkbox]').getAttribute('aria-checked'), shown: getComputedStyle(document.querySelector(sel + ' .unshortener-row-avatar')).display }), rowSel);
  check('inbox list: the checkbox works, and a ticked row shows its checkbox, not the picture', ticked.checked === 'true' && ticked.shown === 'none', ticked);
  // Colleagues' photos from anywhere Gmail shows them (a hover card here), without opening their
  // emails; never a picture inside an email, an outsider's, or one from Gmail's image proxy.
  await p.evaluate(() => {
    const add = (html) => { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d); };
    add('<div role="dialog" class="hovercard"><img data-hovercard-id="kim.colleague@school.org" src="https://lh3.googleusercontent.com/a/ACg8ocHOVERCARD-not-real=s64-p"></div>');
    add('<div class="ii gt"><img data-hovercard-id="ceo.colleague@school.org" src="https://lh3.googleusercontent.com/a/ACg8ocINBODY-not-real=s64-p"></div>');
    add('<div class="chat"><img data-hovercard-id="outsider@example.org" src="https://lh3.googleusercontent.com/a/ACg8ocOUTSIDE-not-real=s64-p"></div>');
    add('<div class="chat"><img data-hovercard-id="lee2.colleague@school.org" src="https://ci3.googleusercontent.com/meips/proxy-not-real"></div>');
  });
  const harvested = await waitFor(async () => (await logs()).some(m => /kim\.colleague@school\.org/.test(m)), 10000);
  await sleep(3500);                                   // one more 3-second check, for the others
  const hl = await logs();
  check('a colleague\'s photo shown anywhere in Gmail (a hover card) is learned without opening an email', harvested && hl.some(m => /photo for kim\.colleague@school\.org/.test(m)), hl.filter(m => /kim\./.test(m)));
  check('never a picture inside an email, an outsider\'s, or one from Gmail\'s image proxy', !hl.some(m => /ceo\.colleague|outsider@example\.org|lee2\.colleague/.test(m)), hl.filter(m => /ceo\.|outsider|lee2/.test(m)));
  await p.close();
  await ctx.unroute('https://mail.google.com/**');
  await servePage(ctx, 'fake-gmail-thread.html');
  global.RAW_MESSAGES = {};
  // Switched off: nothing harvested.
  await set({ enableDnsThreatCheck: true, enableSenderAvatars: false });
  await open(`from=sam.colleague@school.org&name=Sam&t=7008&avatar=${photoNew}`, true);

  check('setting off: no photo harvested', about(await logs(), 'sam.colleague@school.org').length === 0);
  await ctx.close();
  done();
})().catch(e => { console.error(e); process.exit(1); });
