// Makes the Chrome Web Store images: four 1280×800 screenshots and the 440×280 promo tile.
// The real extension runs on made-up mail pages (mock-inbox.html, mock-email.html: fictional names
// and addresses only) and on its own Settings page; each capture is framed with a headline.
//     node store/source/make-images.js        (needs Playwright, as for the tests)
const fs = require('fs'), path = require('path');
const { launch, sleep, until } = require('../../tests/e2e/harness');
const OUT = path.resolve(__dirname, '..');
const SRC = __dirname;
const BRAND = { ink: '#261A3D', mint: '#5BD6B3', gold: '#F2B544', paper: '#EAF4F0' };
const ICON = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(SRC, '..', '..', 'branding', 'icon.svg')).toString('base64');
const SCAM_SENDERS = ['invoice@quick-payments.example'];

async function serve(ctx, file) {
  await ctx.route('https://mail.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(SRC, file), 'utf8') }));
}
async function capture(ctx, url, file, shot, ready, size = { width: 1180, height: 640 }) {
  const page = await ctx.newPage();
  await page.setViewportSize(size);
  await page.goto(url);
  if (ready) await until(() => page.evaluate(ready).catch(() => false), v => v, 30000);
  await sleep(1200);
  const buf = await page.screenshot(shot || {});
  await page.close();
  return buf;
}

// One 1280×800 store screenshot: a headline over a capture in a window frame.
function frame(title, sub, png) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; } body { margin: 0; width: 1280px; height: 800px; overflow: hidden; font-family: Inter, Arial, sans-serif;
      background: radial-gradient(1200px 600px at 85% -10%, #3b2a5c 0%, ${BRAND.ink} 60%); color: ${BRAND.paper}; }
    .head { display: flex; align-items: center; gap: 14px; padding: 30px 60px 0; font-weight: 800; letter-spacing: 1px; font-size: 20px; }
    .head img { width: 34px; height: 34px; } .dot { color: ${BRAND.mint}; } .plus { color: ${BRAND.gold}; }
    h1 { margin: 18px 60px 6px; font-size: 40px; line-height: 1.15; font-weight: 800; }
    p { margin: 0 60px; font-size: 19px; color: #cfc6e6; }
    .win { position: absolute; left: 50px; right: 50px; bottom: 0; height: 560px; border-radius: 14px 14px 0 0; overflow: hidden;
      background: #fff; box-shadow: 0 20px 60px rgba(0,0,0,.45); }
    .bar { height: 28px; background: #e8e6ee; display: flex; align-items: center; gap: 7px; padding: 0 12px; }
    .bar i { width: 11px; height: 11px; border-radius: 50%; background: #c9c4d6; display: block; }
    .win img { display: block; width: 100%; }
  </style></head><body>
    <div class="head"><img src="${ICON}">S<span class="dot">.</span>P<span class="dot">.</span>R<span class="dot">.</span>U<span class="dot">.</span>C<span class="dot">.</span>E<span class="plus">+</span></div>
    <h1>${title}</h1><p>${sub}</p>
    <div class="win"><div class="bar"><i></i><i></i><i></i></div><img src="data:image/png;base64,${png.toString('base64')}"></div>
  </body></html>`;
}
const PROMO = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; width: 440px; height: 280px; overflow: hidden; font-family: Inter, Arial, sans-serif;
    background: radial-gradient(420px 280px at 90% 0%, #3b2a5c 0%, ${BRAND.ink} 70%); color: ${BRAND.paper};
    display: flex; align-items: center; gap: 18px; padding: 0 30px; box-sizing: border-box; }
  img { width: 118px; height: 118px; flex: none; }
  .name { font-size: 37px; font-weight: 800; letter-spacing: 1px; white-space: nowrap; }
  .dot { color: ${BRAND.mint}; } .plus { color: ${BRAND.gold}; }
  .tag { font-size: 16px; line-height: 1.35; color: #cfc6e6; margin-top: 8px; }
  .tag2 { font-size: 14px; color: ${BRAND.mint}; margin-top: 10px; font-weight: 600; }
</style></head><body><img src="${ICON}"><div>
  <div class="name">S<span class="dot">.</span>P<span class="dot">.</span>R<span class="dot">.</span>U<span class="dot">.</span>C<span class="dot">.</span>E<span class="plus">+</span></div>
  <div class="tag">Spam &amp; Phishing Risk<br>URL Checker Extension+</div>
  <div class="tag2">Catches phishing before you click.</div>
</div></body></html>`;

// The 1400×560 marquee: the name and promise on the left, the inbox capture (red labels) on the right.
function marquee(png) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; width: 1400px; height: 560px; overflow: hidden; font-family: Inter, Arial, sans-serif; position: relative;
    background: radial-gradient(900px 560px at 95% 0%, #3b2a5c 0%, ${BRAND.ink} 65%); color: ${BRAND.paper}; }
  .left { position: absolute; left: 80px; top: 0; bottom: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand img { width: 96px; height: 96px; }
  .name { font-size: 52px; font-weight: 800; letter-spacing: 2px; white-space: nowrap; }
  .dot { color: ${BRAND.mint}; } .plus { color: ${BRAND.gold}; }
  .tag { font-size: 19px; color: #cfc6e6; margin-top: 4px; }
  h1 { font-size: 46px; line-height: 1.12; font-weight: 800; margin: 38px 0 14px; }
  p { font-size: 20px; line-height: 1.45; color: #cfc6e6; margin: 0; }
  .win { position: absolute; left: 700px; top: 70px; width: 820px; height: 520px; border-radius: 14px; overflow: hidden;
    background: #fff; box-shadow: 0 24px 70px rgba(0,0,0,.5); transform: rotate(-3deg); transform-origin: top left; }
  .bar { height: 26px; background: #e8e6ee; display: flex; align-items: center; gap: 7px; padding: 0 12px; }
  .bar i { width: 11px; height: 11px; border-radius: 50%; background: #c9c4d6; display: block; }
  .win img { display: block; width: 1180px; margin-left: -150px; }
</style></head><body>
  <div class="left">
    <div class="brand"><img src="${ICON}"><div>
      <div class="name">S<span class="dot">.</span>P<span class="dot">.</span>R<span class="dot">.</span>U<span class="dot">.</span>C<span class="dot">.</span>E<span class="plus">+</span></div>
      <div class="tag">Spam &amp; Phishing Risk URL Checker Extension+</div></div></div>
    <h1>Catch phishing<br>before you click</h1>
    <p>Red flags on dangerous emails in Gmail, hidden link destinations revealed, scams moved to Spam. Private: it all runs on your device.</p>
  </div>
  <div class="win"><div class="bar"><i></i><i></i><i></i></div><img src="data:image/png;base64,${png.toString('base64')}"></div>
</body></html>`;
}

async function render(ctx, html, size, file) {
  const page = await ctx.newPage();
  await page.setViewportSize(size);
  await page.setContent(html, { waitUntil: 'load' });
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, file) });
  await page.close();
  console.log('wrote', file);
}

(async () => {
  const { ctx, sw } = await launch();
  const id = new URL(sw.url()).host;
  const settings = (s) => sw.evaluate(async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }, s);
  const base = { __testScamSenders: SCAM_SENDERS, enableDnsThreatCheck: false, enableAutoSpam: false, uiTheme: 'light' };
  const flagged = (n) => () => document.querySelectorAll('.unshortener-sender-chip[data-status="flagged"]').length >= n;

  // 1. The inbox: red labels on the dangerous emails, nothing opened.
  await settings(base);
  await serve(ctx, 'mock-inbox.html');
  const inbox = await capture(ctx, 'https://mail.google.com/mail/u/0/#inbox', null, null, flagged(4));

  // 2. An opened phishing email: the warning banner and the marked links.
  await settings(base);
  await serve(ctx, 'mock-email.html');
  const email = await capture(ctx, 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQ', null, null,
    () => !!document.querySelector('.unshortener-email-banner') && /flagged/i.test(document.querySelector('.unshortener-email-banner').textContent));

  // 3. Moved to Spam: the same inbox once the flagged emails were reported as spam.
  await settings(Object.assign({}, base, { enableAutoSpam: true }));
  await serve(ctx, 'mock-inbox.html');
  const moved = await capture(ctx, 'https://mail.google.com/mail/u/0/#inbox', null, null,
    () => /moved to Spam/.test((document.querySelector('.unshortener-spam-notice') || {}).textContent || ''));

  // 4. Settings: the sender checks, each with its own switch.
  await settings({ uiTheme: 'light' });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1180, height: 640 });
  await page.goto(`chrome-extension://${id}/options.html`);
  await sleep(800);
  await page.evaluate(() => { const h = [...document.querySelectorAll('h3')].find(e => /Senders/.test(e.textContent)); window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 90); });
  await sleep(500);
  const opts = await page.screenshot();
  await page.close();

  await render(ctx, frame('Phishing flagged in your inbox,<br>before you open it', 'Red labels on fake brand names, look-alike addresses, known scam senders and "call this number" scams.', inbox), { width: 1280, height: 800 }, 'screenshot-1-inbox.png');
  await render(ctx, frame('See where links really go', 'An opened email gets a clear warning, and its dangerous links are marked before you click.', email), { width: 1280, height: 800 }, 'screenshot-2-email.png');
  await render(ctx, frame('Dangerous email moved to Spam for you', 'With your webmail\'s own Report spam. Take one back out and it stays out.', moved), { width: 1280, height: 800 }, 'screenshot-3-moved.png');
  await render(ctx, frame('Every check has its own switch', 'Checks run on your device. Schools and businesses can set them for everyone by policy.', opts), { width: 1280, height: 800 }, 'screenshot-4-settings.png');
  await render(ctx, PROMO, { width: 440, height: 280 }, 'promo-440x280.png');
  await render(ctx, marquee(inbox), { width: 1400, height: 560 }, 'marquee-1400x560.png');
  await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
