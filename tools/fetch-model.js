#!/usr/bin/env node
'use strict';
// tools/fetch-model.js — EXPERIMENT (llm_testing): gets the AI model (phish-tiny) from TinyPhishLLM, the
// model's own public repository, at the commit models/phish-tiny/SOURCE.json pins, and checks each file's
// SHA-256.
//
//     node tools/fetch-model.js                  into models/phish-tiny/ here (the tests run it first)
//     node tools/fetch-model.js --from <folder>  take the files from a TinyPhishLLM checkout instead (offline)
//     node tools/fetch-model.js --check          download nothing: exit 1 if a file is missing or different
//     node tools/fetch-model.js --pin <SOURCE.json> --root <folder>
//                                                into another folder (tools/build.js: the package being built)
//
// The model's files are not kept in this repository: tools/build.js adds them to every package it builds
// (from here when this copy is the pinned one, else downloaded), so the model always comes from
// TinyPhishLLM, at exactly the commit and bytes the version was tested with. A file whose SHA-256 differs is
// never used: the download (and the build) stops. The request is a plain one for a public file: no token,
// nothing about the user. SPRUCE_MODEL_BASE replaces https://raw.githubusercontent.com/<owner>/<repo>
// (a mirror; the tests).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PIN = path.join(ROOT, 'models', 'phish-tiny', 'SOURCE.json');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// The files to get: SOURCE.json's files under models/ (the references in tests/fixtures are kept in the
// repository; the unit tests check them against the same hashes).
function plan(source = JSON.parse(fs.readFileSync(PIN, 'utf8'))) {
    if (!source || !/^[0-9a-f]{40}$/.test(String(source.commit || '')) || !source.files) throw new Error('models/phish-tiny/SOURCE.json pins no commit (run node tools/sync-model.js <TinyPhishLLM folder>)');
    const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(source.repository || ''));
    if (!m) throw new Error(`SOURCE.json's repository isn't a GitHub repository: ${source.repository}`);
    const files = Object.entries(source.files).filter(([to]) => to.startsWith('models/')).map(([to, f]) => ({ to, from: f && f.from, sha256: f && f.sha256 }));
    if (!files.length || files.some(f => !f.from || !/^[0-9a-f]{64}$/.test(String(f.sha256)) || f.to.includes('..') || f.from.includes('..'))) throw new Error('SOURCE.json\'s files are incomplete');
    return { repository: source.repository, owner: m[1], repo: m[2], commit: source.commit, files };
}

const read = (file) => { try { return fs.readFileSync(file); } catch (e) { return null; } };

async function download(url) {
    let last;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(url, { headers: { 'user-agent': 'spruce-extension-build' }, signal: AbortSignal.timeout(120000) });
            if (res.ok) return Buffer.from(await res.arrayBuffer());
            last = new Error(`HTTP ${res.status}`);
            if (res.status === 404) break;
        } catch (e) { last = e; }
        await new Promise(r => setTimeout(r, 2000 * attempt));
    }
    throw new Error(`${url}: ${last && (last.cause && last.cause.code || last.message)}`);
}

async function fetchModel({ pin = PIN, root = ROOT, from = null, check = false, quiet = false, base = process.env.SPRUCE_MODEL_BASE, source } = {}) {
    const p = plan(source || JSON.parse(fs.readFileSync(pin, 'utf8')));
    const rootBase = base ? base.replace(/\/+$/, '') : `https://raw.githubusercontent.com/${p.owner}/${p.repo}`;
    let fetched = 0, copied = 0;
    for (const f of p.files) {
        const dest = path.join(root, f.to);
        const have = read(dest);
        if (have && sha256(have) === f.sha256) continue;
        if (check) throw new Error(`${f.to} is missing or isn't TinyPhishLLM's (commit ${p.commit.slice(0, 7)}): run node tools/fetch-model.js`);
        // This checkout's copy, when it is the pinned one (a build into another folder), else the source.
        const local = path.resolve(root) !== ROOT ? read(path.join(ROOT, f.to)) : null;
        let buf;
        if (local && sha256(local) === f.sha256) { buf = local; copied++; }
        else { buf = from ? fs.readFileSync(path.join(path.resolve(from), f.from)) : await download(`${rootBase}/${p.commit}/${f.from}`); fetched++; }
        if (sha256(buf) !== f.sha256) throw new Error(`${f.from} from ${from || rootBase} (commit ${p.commit.slice(0, 7)}) has SHA-256 ${sha256(buf)}, not ${f.sha256}: not used`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(`${dest}.part`, buf);
        fs.renameSync(`${dest}.part`, dest);
    }
    if (fetched) console.log(`phish-tiny: ${fetched} of ${p.files.length} files from ${from || (base ? rootBase : p.repository)} at ${p.commit.slice(0, 7)}, SHA-256 checked.`);
    else if (!quiet) console.log(`phish-tiny: all ${p.files.length} files are TinyPhishLLM's at ${p.commit.slice(0, 7)} (SHA-256 checked).`);
    return { fetched, copied, files: p.files.length, commit: p.commit };
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
    fetchModel({ pin: opt('--pin') ? path.resolve(opt('--pin')) : PIN, root: opt('--root') ? path.resolve(opt('--root')) : ROOT,
                 from: opt('--from') || null, check: args.includes('--check'), quiet: args.includes('--quiet') })
        .catch((e) => { console.error(`The AI model wasn't added: ${e.message}`); process.exit(1); });
}
module.exports = { fetchModel, plan };
