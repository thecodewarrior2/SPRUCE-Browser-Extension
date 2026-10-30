// Shared Playwright harness: loads the extension and serves fake Gmail pages.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const EXT = process.env.EXT || path.resolve(__dirname, '..', '..');

// A suite never hangs: past SUITE_TIMEOUT seconds it reports TIMEOUT and ends (run-all.js also kills
// it with its browser). The temporary browser profile is always removed.
const profiles = [];
const watchdog = setTimeout(() => { console.log(`FAIL  suite timed out after ${process.env.SUITE_TIMEOUT || 240}s`); process.exit(3); }, (Number(process.env.SUITE_TIMEOUT) || 240) * 1000);
watchdog.unref();
process.on('exit', () => { for (const d of profiles) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* in use */ } } });
process.on('unhandledRejection', (e) => { console.log(`FAIL  unhandled error: ${e && e.stack || e}`); process.exit(1); });

async function launch() {
  const userDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'e2e-profile-'));
  profiles.push(userDir);
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--proxy-server=${process.env.HTTPS_PROXY}`, '--ignore-certificate-errors'],
  });
  // Short default waits: a missing element fails in seconds instead of hanging for 30.
  ctx.setDefaultTimeout(Number(process.env.STEP_TIMEOUT) || 10000);
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  // Administrator policy for tests: chrome.storage.managed answers with local.__testManaged.
  await sw.evaluate(() => {
    chrome.storage.managed.get = (keys, cb) => {
      chrome.storage.local.get('__testManaged', (r) => {
        const policy = (r && r.__testManaged) || {};
        let out = {};
        if (keys === null || keys === undefined) out = { ...policy };
        else for (const k of (Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys))) if (k in policy) out[k] = policy[k];
        cb(out);
      });
    };
    invalidateConfig();
    // Community scam-sender list for tests: local.__testScamSenders is added to the downloaded copy.
    const realLoadFeedSets = loadFeedSets;
    loadFeedSets = async () => {
      const sets = await realLoadFeedSets();
      const r = await chrome.storage.local.get('__testScamSenders');
      const extra = new Set((r.__testScamSenders || []).map(a => String(a).toLowerCase()));
      const address = { size: sets.address.size + extra.size, has: (k) => extra.has(k) || sets.address.has(k),
                        get: (k) => extra.has(k) ? 'Test scam-sender list' : sets.address.get(k) };
      return Object.assign({}, sets, { address });
    };
  });
  const logs = [];
  return { ctx, sw, logs, userDir };
}

async function servePage(ctx, file) {
  await ctx.route('https://mail.google.com/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.searchParams.get('view') === 'om') {
      const id = u.searchParams.get('permmsgid');
      const raw = (global.RAW_MESSAGES || {})[id];
      if (!raw) return route.fulfill({ status: 404, body: 'nf' });
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<html><body><pre id="raw_message_text">${raw.replace(/</g, '&lt;')}</pre></body></html>` });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, file), 'utf8') });
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Polls fn (sync or async) until it returns something truthy, and returns that; after timeout ms it
// returns the last value (falsy), so the check that follows fails with what was seen instead of
// the suite hanging. Use in place of a fixed sleep wherever there is something to wait for.
async function waitFor(fn, timeout = 8000, interval = 150) {
  const end = Date.now() + timeout;
  let v;
  for (;;) {
    try { v = await fn(); } catch (e) { v = undefined; }
    if (v || Date.now() >= end) return v;
    await sleep(interval);
  }
}
// After loading a simulated inbox: moves > 0 waits until that many emails were moved and the moves
// recorded (so a later storage reset can't catch the write); none expected waits until the sender
// badges are drawn, then long enough for a move to have happened (they come about 2 s after loading).
async function listSettled(page, sw, moves) {
  if (moves) {
    await waitFor(() => page.evaluate((n) => window.__spammed.length >= n, moves), 10000);
    await waitFor(() => sw.evaluate(async (n) => ((await chrome.storage.local.get('recentActivity')).recentActivity || []).filter(a => a.type === 'Moved to Spam').length >= n, moves), 5000);
  } else {
    await waitFor(() => page.evaluate(() => document.querySelectorAll('.unshortener-sender-chip, .unshortener-sender-icon').length > 0), 2000);
    await sleep(2800);
  }
}
// Reads (read()) until cond(value) holds, and returns the last value read: the check that follows
// passes as soon as the page gets there, and fails with what was last seen after timeout ms.
async function until(read, cond, timeout = 12000) {
  let v;
  await waitFor(async () => { v = await read(); return cond(v); }, timeout);
  return v;
}
// The extension's application log messages (Settings → Logging), newest last.
const logMessages = (sw) => sw.evaluate(async () => ((await chrome.storage.local.get('errorLogs')).errorLogs || []).map(e => e.message || ''));
// Waits until a log message matches re; returns all messages.
async function waitForLog(sw, re, timeout = 8000) {
  let all = [];
  await waitFor(async () => { all = await logMessages(sw); return all.some(m => re.test(m)); }, timeout);
  return all;
}
let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra !== undefined ? '  →  ' + JSON.stringify(extra) : ''}`);
  if (!cond) failures++;
}
// Parts: a suite can be split into independent parts, each with its own browser, so the runner can run
// them in parallel like separate suites. part(name, fn) registers one; runParts() runs them all, or
// only the one named by PART=<name> (what run-all.js does), and prints their names for --list-parts.
const parts = [];
function part(name, fn) { parts.push({ name, fn }); }
async function runParts() {
  if (process.argv.includes('--list-parts')) { console.log(JSON.stringify(parts.map(p => p.name))); return; }
  const want = process.env.PART;
  if (want && !parts.some(p => p.name === want)) { console.log(`FAIL  no part named ${want}`); process.exitCode = 1; return; }
  for (const p of parts) if (!want || p.name === want) await p.fn();
  done();
}
function done() { console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED'); process.exitCode = failures ? 1 : 0; }
module.exports = { until, listSettled, launch, servePage, sleep, waitFor, waitForLog, logMessages, check, done, part, runParts };
