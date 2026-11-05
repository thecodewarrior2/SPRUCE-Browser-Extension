// The Link Inspector explains why a link may be malicious: each service's own answer and how many
// agree, red flags in the address, second-opinion links and the optional VirusTotal lookup. Every
// network answer is stubbed in the background, so the result never depends on the real services.
const { launch, until, optionsReady, check, done } = require('./harness');
(async () => {
  const { ctx, sw } = await launch();
  const ID = new URL(sw.url()).host;
  // Stubbed network: Cloudflare Security blocks one site (0.0.0.0), every other resolver answers clean,
  // VirusTotal knows one link. Requests are recorded so the test can see what was sent where.
  await sw.evaluate(() => {
    self.__sent = [];
    const wire = (rcode) => { const b = new Uint8Array(12); b[2] = 0x81; b[3] = 0x80 | rcode; return b.buffer; };
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    self.fetch = async (input, init) => {
      const url = String(input && input.url || input);
      self.__sent.push({ url, headers: init && init.headers, method: init && init.method, credentials: init && init.credentials, referrerPolicy: init && init.referrerPolicy });
      const u = new URL(url);
      // A SendGrid click link, followed on request, ends at its destination (fetch reports the final address).
      if (u.hostname.endsWith('ct.sendgrid.net')) return { url: 'https://landing.example/offer', status: 200, ok: true };
      const name = u.searchParams.get('name') || '';
      if (u.hostname === 'www.virustotal.com') {
        if (u.pathname.startsWith('/api/v3/urls/')) return json({ data: { attributes: {
          last_analysis_stats: { malicious: 1, suspicious: 0, harmless: 60, undetected: 9 },
          last_analysis_results: { Foo: { engine_name: 'FooAV', category: 'malicious', result: 'phishing' }, Bar: { engine_name: 'BarAV', category: 'harmless', result: 'clean' } },
          last_analysis_date: 1760000000, reputation: 0, categories: { x: 'business' } } } });
        return json({ error: { code: 'NotFoundError' } }, 404);
      }
      if (/dns-message/.test(JSON.stringify(init && init.headers || {})) || u.searchParams.has('dns')) return new Response(wire(0));
      const blocked = u.hostname === 'security.cloudflare-dns.com' && /flagged-once\.test$/.test(name);
      return json({ Status: 0, Answer: [{ type: 1, data: blocked ? '0.0.0.0' : '203.0.113.7' }] });
    };
    invalidateConfig();
  });
  await sw.evaluate(() => chrome.storage.local.set({ enablePhishingFeeds: false, virusTotalApiKey: 'a'.repeat(64) }));

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.dismiss());
  await page.goto(`chrome-extension://${ID}/options.html`);
  await optionsReady(page);
  await page.evaluate(() => document.querySelector('[data-tab="tester"]').click());
  const inspect = async (url) => {
    await page.fill('#inspectorInput', url);
    await page.click('#inspectLinkBtn');
    await until(() => page.$eval('#inspectLinkBtn', b => !b.disabled && !!document.querySelector('#inspectorSecondOpinion')), v => v, 20000);
    return page.evaluate(() => ({
      dest: document.querySelector('#finalDestinationContainer .url-box').textContent,
      steps: [...document.querySelectorAll('#inspectorStepsContainer .step-header')].map(e => e.textContent),
      consensus: (document.querySelector('.inspector-analysis .callout-warn') || {}).textContent || '',
      flags: [...document.querySelectorAll('#inspectorRedFlags .red-flag')].map(e => e.textContent),
      services: [...document.querySelectorAll('#inspectorServices tr')].map(tr => [tr.cells[0].textContent, tr.cells[1].textContent]),
      opinions: [...document.querySelectorAll('#inspectorSecondOpinion a')].map(a => a.href),
      vtButton: !!document.getElementById('virusTotalBtn'),
      badge: (document.querySelector('#finalDestinationContainer .badge') || {}).textContent || '',
      label: document.getElementById('inspectLinkBtn').textContent
    }));
  };

  // 1. An iContact click-tracking link is decoded; the destination is checked.
  let r = await inspect('https://click-175967.icptrack.com/icp/relay.php?r=22660662&msgid=323472&act=20D0&c=175967&pid=3140608&destination=https%3A%2F%2Ftoptransportationteams.com%2F&cf=1088&v=0646a1d5');
  check('iContact link decoded to its destination', r.dest === 'https://toptransportationteams.com/' && r.steps.some(s => /iContact/.test(s)), r);
  check('the button says "Inspect link" again afterwards', r.label === 'Inspect link', r.label);

  // 2. One service flags a site, the others don't: the Inspector says so and names it.
  r = await inspect('https://www.flagged-once.test/privacy-policy/');
  const cf = r.services.find(s => s[0] === 'Cloudflare Security');
  const q9 = r.services.find(s => s[0] === 'Quad9');
  check('each service\'s own answer is listed', cf && /Flagged/.test(cf[1]) && q9 && /Nothing found/.test(q9[1]), r.services);
  check('only one of several flags it: explained as a possible false positive', /Only 1 of \d+ security services \(Cloudflare Security\)/.test(r.consensus) && /false positive/.test(r.consensus), r.consensus);
  check('a flagged destination says "Flagged" and why (not "Not verified")', /^Flagged: Malware or Phishing \(Cloudflare Security\)/.test(r.badge), r.badge);
  check('second-opinion links carry the site name only', r.opinions.length === 4 && r.opinions.every(h => !/privacy-policy/.test(h)) && r.opinions.some(h => /virustotal\.com\/gui\/domain\/flagged-once\.test/.test(h)), r.opinions);

  // 3. Red flags in the address itself, with what they mean.
  r = await inspect('http://paypal.com.account-verify.test:8080/login/update.exe');
  const titles = r.flags.join(' | ');
  check('red flags: brand in front of another domain, port, plain http, program download, sign-in words',
    /brand's name in front|starts with "paypal\.com"/i.test(titles) && /Unusual port/.test(titles) && /Not encrypted/.test(titles) && /program or script/.test(titles), r.flags);

  // 4. One-time links: only the site name would go to VirusTotal, and the button says so.
  check('a sign-in link offers a site-only VirusTotal lookup', r.vtButton && await page.$eval('#virusTotalBtn', b => /the site/.test(b.textContent)), r.vtButton);

  // 5. VirusTotal: the person's key is sent only to VirusTotal, only on click; the vendors that flag it are named.
  r = await inspect('https://www.flagged-once.test/about-us');
  const vtBefore = await sw.evaluate(() => self.__sent.filter(s => /virustotal/.test(s.url)).length);
  check('nothing is sent to VirusTotal until the button is clicked', vtBefore === 0 && r.vtButton, vtBefore);
  await page.click('#virusTotalBtn');
  const vt = await until(() => page.$eval('.vt-result', e => e.textContent), t => /VirusTotal:/.test(t) || /could not|refused|no report/.test(t), 15000);
  check('VirusTotal result: counts, the flagging vendor and its verdict, single detection explained', /1 malicious, 0 suspicious, out of 70 vendors/.test(vt) && /FooAV: phishing/.test(vt) && /Only one vendor/.test(vt) && !/BarAV/.test(vt), vt);
  const sentKey = await sw.evaluate(() => self.__sent.filter(s => s.headers && s.headers['x-apikey']).map(s => new URL(s.url).hostname));
  check('the API key goes to www.virustotal.com only', sentKey.length >= 1 && sentKey.every(h => h === 'www.virustotal.com'), sentKey);
  // 6. SendGrid: an open pixel is explained (nothing to reveal); an encrypted click link can be followed on request.
  r = await inspect('https://u36668736.ct.sendgrid.net/wf/open?upn=u001.L-2BeAUwyUZHYs25ZhPKgVBAw1P6uRDOQexvZhkGbHobA7bxWWsBfb8BvdgaYTDe3699drMG86kIOXq-2Fw4wQ-3D');
  const pixelNotes = await page.$eval('#finalDestinationContainer', e => e.textContent);
  check('a SendGrid open pixel is explained as a pixel, with nothing to follow', /Open-tracking pixel \(SendGrid\), not a link/.test(pixelNotes) && !(await page.$('#followLinkBtn')), pixelNotes.slice(0, 300));
  const sentBefore = await sw.evaluate(() => self.__sent.filter(s => /^https:\/\/[^\/?]*\.sendgrid\.net\//.test(s.url)).length);
  r = await inspect('https://u36668736.ct.sendgrid.net/ls/click?upn=u001.KJgh0IxlUiM1aV8LiJpBJsbPyAbUwctC-2F1fgvjQM2JJDZWfsKJzPD0R0-2Fcbrr-3D-3Dchfa_Z9M7');
  check('an encrypted SendGrid click link: explained, a Follow button offered, nothing sent to SendGrid by inspecting',
    !!(await page.$('#followLinkBtn')) && /encrypts the destination/.test(await page.$eval('#finalDestinationContainer', e => e.textContent)) &&
    (await sw.evaluate(() => self.__sent.filter(s => /^https:\/\/[^\/?]*\.sendgrid\.net\//.test(s.url)).length)) === sentBefore);
  const followed = await sw.evaluate(() => followLink('https://u36668736.ct.sendgrid.net/ls/click?upn=u001.abc'));
  const req = await sw.evaluate(() => self.__sent.filter(s => /^https:\/\/[^\/?]*\.sendgrid\.net\//.test(s.url)).pop());
  check('following it: one HEAD request without cookies or referrer, reporting where it ended', followed.finalUrl === 'https://landing.example/offer' &&
    req && req.method === 'HEAD' && req.credentials === 'omit' && req.referrerPolicy === 'no-referrer', { followed, req });
  check('no page errors', errors.length === 0, errors);
  await ctx.close();
  done();
})();
