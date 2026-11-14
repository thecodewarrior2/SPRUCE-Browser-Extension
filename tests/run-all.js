#!/usr/bin/env node
// Runs the end-to-end suites (test-*.js) and the unit tests in parallel.
//   node tests/run-all.js                 every suite, JOBS at a time (default: number of CPUs)
//   node tests/run-all.js avatars stuck   only suites whose name contains one of the words
//   EXT=/path/to/build node tests/run-all.js   test another build (the Firefox one, for example)
//   JOBS=2 SUITE_TIMEOUT=180 node tests/run-all.js
// Each suite runs in its own process group: one that runs past SUITE_TIMEOUT seconds is killed with
// its browser, so a hang can never stop the run. Output goes to tests/logs/<suite>.log; the summary lists
// each suite's checks, failures and time. Slowest suites (from the last run) are started first.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(__dirname, 'e2e');
const LOGS = path.join(__dirname, 'logs');
const TIMINGS = path.join(__dirname, '.timings.json');
const JOBS = Math.max(1, Number(process.env.JOBS) || os.cpus().length);
const TIMEOUT_S = Number(process.env.SUITE_TIMEOUT) || 240;
const filters = process.argv.slice(2);

fs.mkdirSync(LOGS, { recursive: true });
// EXPERIMENT (llm_testing): the AI model's files (not in the repository) from TinyPhishLLM, at the commit
// models/phish-tiny/SOURCE.json pins, before any suite loads the extension from this folder.
if (!process.env.EXT && fs.existsSync(path.join(__dirname, '..', 'models', 'phish-tiny', 'SOURCE.json'))) {
    require('child_process').execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'fetch-model.js'), '--quiet'], { stdio: 'inherit' });
}
// EXPERIMENT (llm_testing): ONNX Runtime Web's files (not in the repository either), from the tarball lib/ort/SOURCE.json pins.
if (!process.env.EXT && fs.existsSync(path.join(__dirname, '..', 'lib', 'ort', 'SOURCE.json'))) {
    require('child_process').execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'fetch-ort.js'), '--quiet'], { stdio: 'inherit' });
}
let timings = {};
try { timings = JSON.parse(fs.readFileSync(TIMINGS, 'utf8')); } catch (e) { /* first run */ }

// No fixed pauses in the tests: a test waits for what it checks (until/waitFor), or for the extension to
// report it has finished (harness settled/ready), never for a guessed number of milliseconds, which
// passes on a fast computer and fails on a slow one. A pause that is part of the scenario itself (the
// user clicking every 2 seconds) is marked "allow-sleep" with the reason on the same line.
const pauses = [];
for (const f of fs.readdirSync(DIR).filter(f => /^test-.*\.js$/.test(f))) {
    fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').forEach((line, i) => {
        if (/\b(sleep|waitForTimeout)\(/.test(line) && !/allow-sleep/.test(line)) pauses.push(`  ${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
}
if (pauses.length) {
    console.error(`Fixed pauses found; wait for the outcome instead (until, waitFor, settled, ready):\n${pauses.join('\n')}`);
    process.exit(2);
}

// A suite split into parts (harness part()) runs as one job per part: "stuck:flaky" and so on.
const { execFileSync } = require('child_process');
const suites = [];
for (const f of fs.readdirSync(DIR).filter(f => /^test-.*\.js$/.test(f))) {
    const name = f.replace(/^test-|\.js$/g, ''), file = path.join(DIR, f);
    let parts = [];
    if (/\brunParts\(/.test(fs.readFileSync(file, 'utf8'))) {
        try { parts = JSON.parse(execFileSync(process.execPath, [file, '--list-parts'], { cwd: DIR, encoding: 'utf8' }).trim().split('\n').pop()); } catch (e) { parts = []; }
    }
    if (!parts.length) suites.push({ name, cmd: process.execPath, args: [file], cwd: DIR, env: {} });
    else for (const p of parts) suites.push({ name: `${name}:${p}`, cmd: process.execPath, args: [file], cwd: DIR, env: { PART: p } });
}
const unitDir = path.join(__dirname, 'unit');
if (fs.existsSync(path.join(unitDir, 'unit.test.js'))) suites.push({ name: 'unit', cmd: process.execPath, args: ['--test', 'unit.test.js'], cwd: unitDir, env: {} });
const chosen = suites.filter(s => !filters.length || filters.some(w => s.name.includes(w)))
    .sort((a, b) => (timings[b.name] || 60) - (timings[a.name] || 60));
if (!chosen.length) { console.error(`No suite matches: ${filters.join(', ')}`); process.exit(2); }

const results = [];
const running = new Set();
const started = Date.now();

function run(s) {
    return new Promise(resolve => {
        const t0 = Date.now();
        const log = fs.createWriteStream(path.join(LOGS, `${s.name.replace(':', '-')}.log`));
        const child = spawn(s.cmd, s.args, { cwd: s.cwd, detached: true, env: Object.assign({}, process.env, s.env), stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        const take = (d) => { out += d; log.write(d); };
        child.stdout.on('data', take); child.stderr.on('data', take);
        running.add(child);
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; killGroup(child, 'SIGKILL'); }, TIMEOUT_S * 1000);
        child.on('close', (code) => {
            clearTimeout(timer);
            running.delete(child);
            log.end();
            const secs = (Date.now() - t0) / 1000;
            // node --test reports "# pass N / # fail N"; the suites print PASS/FAIL lines.
            const unitPass = /^# pass (\d+)/m.exec(out), unitFail = /^# fail (\d+)/m.exec(out);
            const passed = unitPass ? Number(unitPass[1]) : (out.match(/^PASS /gm) || []).length;
            const failed = unitFail ? Number(unitFail[1]) : (out.match(/^FAIL /gm) || []).length;
            const ok = !timedOut && code === 0 && failed === 0;
            const r = { name: s.name, ok, passed, failed, secs, timedOut, code, failLines: out.split('\n').filter(l => /^FAIL |^not ok |Error/.test(l)).slice(0, 8) };
            results.push(r);
            if (!timedOut) timings[s.name] = Math.round(secs);
            console.log(`${ok ? '✓' : '✗'} ${s.name.padEnd(22)} ${String(passed).padStart(3)} passed${failed ? `, ${failed} failed` : ''}${timedOut ? `, TIMED OUT after ${TIMEOUT_S}s` : code && !failed ? `, exit ${code}` : ''}  ${secs.toFixed(1)}s`);
            resolve();
        });
    });
}
function killGroup(child, sig) { try { process.kill(-child.pid, sig); } catch (e) { try { child.kill(sig); } catch (e2) { /* gone */ } } }
// Ctrl-C or a kill of the runner takes every suite (and its browser) with it.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { for (const c of running) killGroup(c, 'SIGKILL'); process.exit(130); });

(async () => {
    console.log(`Running ${chosen.length} suite${chosen.length === 1 ? '' : 's'}, ${Math.min(JOBS, chosen.length)} at a time (timeout ${TIMEOUT_S}s each)${process.env.EXT ? `, build ${process.env.EXT}` : ''}`);
    const queue = chosen.slice();
    await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => { while (queue.length) await run(queue.shift()); }));
    fs.writeFileSync(TIMINGS, JSON.stringify(timings, null, 1));
    const bad = results.filter(r => !r.ok);
    const total = results.reduce((n, r) => n + r.passed, 0);
    console.log(`\n${bad.length ? `${bad.length} SUITE${bad.length === 1 ? '' : 'S'} FAILED` : 'ALL PASSED'}: ${total} checks in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    for (const r of bad) { console.log(`\n--- ${r.name} (tests/logs/${r.name.replace(':', '-')}.log)`); r.failLines.forEach(l => console.log('  ' + l)); }
    process.exit(bad.length ? 1 : 0);
})();
