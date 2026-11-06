// The extension writes into the webmail page itself (labels, banners, tooltips, the AI's answer). Email
// content is attacker-written: sender names, subjects, link texts and addresses that carry markup must
// show as text, never become elements, and nothing in them may run. (content.js builds everything with
// createElement and textContent, never innerHTML; this keeps it that way.)
const { launch, servePage, until, check, done, logMessages } = require('./harness');
(async () => {
  const { ctx, sw } = await launch();
  await servePage(ctx, 'fake-gmail-thread.html');
  const errors = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  // Sender name and subject with markup, entity-escaped so the page shows them as text (as Gmail does).
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const name = esc('PayPal "><img src=x onerror="window.__pwned=8"><svg onload=window.__pwned=9>');
  const subj = esc('Urgent <script>window.__pwned=10</script> "><img src=x onerror=window.__pwned=11>');
  await page.goto(`https://mail.google.com/mail/u/0/?links=xss&name=${encodeURIComponent(name)}&subj=${encodeURIComponent(subj)}&from=${encodeURIComponent('service@paypa1-secure.example')}#inbox/FMfcgz`);
  const label = await until(() => page.$eval('.unshortener-sender-address', e => ({ status: e.dataset.status || '', title: e.title || '' })), v => !!v.status && v.status !== 'pending', 20000);
  check('the email was checked (the extension wrote its label)', !!label.status, label);
  // The AI's full answer quotes sentences; open it.
  const ai = await until(() => page.$eval('.unshortener-ai-box', b => ({ state: b.dataset.state, text: b.textContent })).catch(() => null), b => b && (b.state === 'done' || b.state === 'error'), 30000);
  const why = await page.$('.unshortener-ai-box button');
  if (why) await why.click();
  // Hover every link (tooltips, icons) and let late updates land.
  for (const id of ['x1', 'x2', 'x3']) { const a = await page.$('#' + id); if (a) await a.hover().catch(() => {}); }
  await until(() => page.$$eval('#x1, #x3', as => as.every(a => !!a.dataset.unshortened)), v => v, 15000).catch(() => null);
  const scan = await page.evaluate(() => {
    const onAttrs = [];
    for (const el of document.querySelectorAll('*')) for (const a of el.attributes) if (/^on/i.test(a.name)) onAttrs.push(`${el.tagName}[${a.name}]`);
    const ext = [...document.querySelectorAll('[class*="unshortener-"]')];
    return {
      pwned: window.__pwned,
      onAttrs,
      injected: document.querySelectorAll('img[src="x"], svg[onload], b[onclick]').length,
      scripts: document.querySelectorAll('script').length,
      extElements: ext.length,
      extMarkup: ext.filter(e => e.querySelector('script, iframe, object, embed, img[src="x"]')).length,
      extText: ext.map(e => (e.textContent || '') + ' ' + (e.title || '')).join(' ')
    };
  });
  check('nothing in the email ran', scan.pwned === undefined, scan.pwned);
  check('no event-handler attributes anywhere in the page', scan.onAttrs.length === 0, scan.onAttrs);
  check('no element was made from the email\'s text', scan.injected === 0 && scan.scripts === 1, { injected: scan.injected, scripts: scan.scripts });
  check('the extension wrote its own elements, none holding active content', scan.extElements > 0 && scan.extMarkup === 0, { n: scan.extElements, markup: scan.extMarkup });
  check('the sender\'s name appears in the extension\'s words as plain text', /“PayPal "><img src=x onerror="window\.__pwned=8">/.test(label.title + ' ' + scan.extText), label.title.slice(0, 300));
  check('the AI answered (its quotes are text too)', ai.state === 'done', ai);
  // The javascript: link is disarmed (no href that runs code).
  const js = await page.$eval('#x2', a => a.getAttribute('href') || '').catch(() => '');
  check('the javascript: link no longer runs code', !/^\s*javascript:/i.test(js), js);
  check('no page errors or dialogs', errors.length === 0, errors);
  const refused = (await logMessages(sw)).filter(x => /message was refused/.test(x));
  check('no message from the extension itself was refused', refused.length === 0, refused);
  await ctx.close();
  done();
})();
