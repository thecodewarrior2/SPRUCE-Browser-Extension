// Firefox harness: runs the add-on in real Firefox (WebDriver BiDi through puppeteer-core), serves the
// simulated webmail pages at their real addresses, and opens the add-on's own pages.
//   FXBIN  the Firefox binary (default: tests/.firefox/esr/firefox/firefox, from get-firefox.sh)
//   FXEXT  the add-on folder (default: this checkout)
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..', '..');
const EXT = process.env.FXEXT || ROOT;
const E2E = path.join(__dirname, '..', 'e2e');
const FXBIN = process.env.FXBIN || path.join(__dirname, '..', '.firefox', 'esr', 'firefox', 'firefox');
const ADDON = 'spruce@spruce-browser-extension';
const UUID = '11111111-2222-4333-8444-555555555555';   // fixed, so the add-on's pages have a known address
const BASE = `moz-extension://${UUID}`;
const WAIT_SCALE = Number(process.env.WAIT_SCALE) || 1;

// The Firefox build has a background page; the Chrome build (a service worker) can't run in Firefox.
function isFirefoxBuild() {
  const m = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  return !!(m.background && (m.background.page || m.background.scripts));
}

async function launch(prefs = {}) {
  if (!fs.existsSync(FXBIN)) throw new Error(`No Firefox at ${FXBIN}: run tests/firefox/get-firefox.sh, or set FXBIN.`);
  const browser = await puppeteer.launch({
    browser: 'firefox', executablePath: FXBIN, headless: true, protocol: 'webDriverBiDi', acceptInsecureCerts: true,
    args: ['--remote-allow-system-access'],                       // lets the test open moz-extension:// pages
    extraPrefsFirefox: Object.assign({
      'extensions.webextensions.uuids': JSON.stringify({ [ADDON]: UUID }),
      'xpinstall.signatures.required': false,
      // Outside requests fail at once (a closed local port) instead of waiting: the add-on runs offline.
      'network.proxy.type': 1, 'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': 9,
      'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': 9, 'network.proxy.no_proxies_on': 'localhost,127.0.0.1',
      // Optional permissions are granted without the prompt nobody could answer in a headless browser.
      'extensions.webextOptionalPermissionPrompts': false
    }, prefs)
  });
  await browser.installExtension(EXT);
  return browser;
}

// Polls fn until ok(value) (or the deadline), and returns the last value.
async function until(fn, ok = (v) => !!v, ms = 15000) {
  const end = Date.now() + ms * WAIT_SCALE;
  let v;
  for (;;) {
    try { v = await fn(); } catch (e) { v = undefined; }
    if (ok(v) || Date.now() > end) return v;
    await new Promise(r => setTimeout(r, 200));
  }
}

// Extension pages don't report BiDi load events reliably: the navigation is started, then the page polled.
async function openExt(browser, file, ready) {
  const page = await browser.newPage();
  page.goto(`${BASE}/${file}`, { timeout: 0 }).catch(() => {});
  const ok = await until(() => page.evaluate(ready), (v) => !!v, 20000);
  if (!ok) throw new Error(`${file} never became ready`);
  return page;
}

// Serves the simulated webmail at its real address. Gmail's "Show original" (view=om) answers from raw.
async function serve(page, host, file, raw = {}) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.hostname !== host) return req.abort('failed').catch(() => {});
    if (u.searchParams.get('view') === 'om') {
      const r = raw[u.searchParams.get('permmsgid')];
      return r ? req.respond({ status: 200, contentType: 'text/html', body: `<html><body><pre id="raw_message_text">${r.replace(/</g, '&lt;')}</pre></body></html>` })
               : req.respond({ status: 404, contentType: 'text/plain', body: 'nf' });
    }
    return req.respond({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(E2E, file), 'utf8') });
  });
}

// Records page errors, including the add-on's own uncaught ones (Firefox reports those to the page).
function errorsOf(page) {
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  return errs;
}

let failures = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log(`  PASS  ${name}`); }
  else { failures++; console.log(`  FAIL  ${name}  →  ${JSON.stringify(detail === undefined ? null : detail).slice(0, 600)}`); }
}
function done() {
  console.log(failures ? `\n${failures} FAILED, ${passes} passed` : `\nALL PASSED: ${passes} checks`);
  process.exit(failures ? 1 : 0);
}

module.exports = { launch, openExt, serve, until, errorsOf, check, done, isFirefoxBuild, EXT, FXBIN, ROOT };
