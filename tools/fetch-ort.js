#!/usr/bin/env node
'use strict';
// tools/fetch-ort.js — EXPERIMENT (llm_testing): puts ONNX Runtime Web's two files (the WebGPU/WebAssembly
// runtime, MIT) in lib/ort/, from the npm tarball lib/ort/SOURCE.json pins, so the AI model can run in it
// (ai-engine.js). The runtime is then part of every package: nothing is loaded from the web when the
// extension runs.
//
//     node tools/fetch-ort.js                   lib/ort/ gets the files it lacks (checked by SHA-256)
//     node tools/fetch-ort.js --check           download nothing: exit 1 if a file is missing or different
//     node tools/fetch-ort.js --root <folder>   into a package being built (this checkout's copies when they
//                                               are the pinned ones, else the tarball)
//     node tools/fetch-ort.js --tarball <file>  from a tarball already downloaded (its integrity is checked)
//
// The tarball is checked against SOURCE.json's integrity (SHA-512, as npm records it) before anything is
// read from it, and each file against its SHA-256; a different byte is never used. tools/build.js and the
// tests (tests/run-all.js, tests/firefox/harness.js) call this before loading the extension.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const PIN = path.join(ROOT, 'lib', 'ort', 'SOURCE.json');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const read = (f) => { try { return fs.readFileSync(f); } catch (e) { return null; } };

// The entries of a tar archive (ustar; the pax and GNU long-name headers npm doesn't use are skipped).
function untar(buf) {
    const out = new Map();
    let off = 0;
    while (off + 512 <= buf.length) {
        const h = buf.subarray(off, off + 512);
        if (h.every(b => b === 0)) break;
        const str = (a, n) => h.subarray(a, a + n).toString('utf8').replace(/\0[\s\S]*$/, '');
        let name = str(0, 100);
        const prefix = str(345, 155);
        if (prefix) name = `${prefix}/${name}`;
        const size = parseInt(str(124, 12).trim() || '0', 8);
        const type = str(156, 1) || '0';
        const data = buf.subarray(off + 512, off + 512 + size);
        off += 512 + Math.ceil(size / 512) * 512;
        if (type === '0' || type === '') out.set(name, data);
    }
    return out;
}

function plan(source) {
    if (!source || !/^https:\/\/registry\.npmjs\.org\/[\w./@-]+\.tgz$/.test(String(source.tarball || ''))) throw new Error("lib/ort/SOURCE.json pins no npm tarball");
    const m = /^sha512-([A-Za-z0-9+/=]+)$/.exec(String(source.integrity || ''));
    if (!m) throw new Error("lib/ort/SOURCE.json has no sha512 integrity");
    const files = Object.entries(source.files || {}).map(([to, f]) => ({ to, from: f.from, sha256: f.sha256 }));
    if (!files.length || files.some(f => !f.from || !/^[0-9a-f]{64}$/.test(String(f.sha256)) || f.to.includes('..') || f.from.includes('..'))) throw new Error("SOURCE.json's files are incomplete");
    return { tarball: source.tarball, integrity: Buffer.from(m[1], 'base64'), files, version: source.version };
}

async function download(url) {
    let last;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(url, { headers: { 'user-agent': 'spruce-extension-build' }, signal: AbortSignal.timeout(300000) });
            if (res.ok) return Buffer.from(await res.arrayBuffer());
            last = new Error(`HTTP ${res.status}`);
            if (res.status === 404) break;
        } catch (e) { last = e; }
        await new Promise(r => setTimeout(r, 2000 * attempt));
    }
    throw new Error(`${url}: ${last && (last.cause && last.cause.code || last.message)}`);
}

async function fetchOrt({ pin = PIN, root = ROOT, tarball = null, check = false, quiet = false, source } = {}) {
    const p = plan(source || JSON.parse(fs.readFileSync(pin, 'utf8')));
    const missing = p.files.filter(f => { const have = read(path.join(root, f.to)); return !(have && sha256(have) === f.sha256); });
    if (!missing.length) {
        if (!quiet) console.log(`ONNX Runtime Web ${p.version}: all ${p.files.length} files are the pinned ones (SHA-256 checked).`);
        return { fetched: 0, copied: 0, files: p.files.length };
    }
    if (check) throw new Error(`${missing.map(f => f.to).join(', ')}: missing or not ONNX Runtime Web ${p.version}'s: run node tools/fetch-ort.js`);
    let fetched = 0, copied = 0, entries = null;
    for (const f of missing) {
        // This checkout's copy, when it is the pinned one (a build into another folder), else the tarball.
        const local = path.resolve(root) !== ROOT ? read(path.join(ROOT, f.to)) : null;
        let buf;
        if (local && sha256(local) === f.sha256) { buf = local; copied++; }
        else {
            if (!entries) {
                const tgz = tarball ? fs.readFileSync(tarball) : await download(p.tarball);
                const digest = crypto.createHash('sha512').update(tgz).digest();
                if (!digest.equals(p.integrity)) throw new Error(`${tarball || p.tarball}: SHA-512 ${digest.toString('base64')} is not SOURCE.json's integrity: not used`);
                entries = untar(zlib.gunzipSync(tgz));
            }
            buf = entries.get(f.from);
            if (!buf) throw new Error(`${f.from} is not in ${tarball || p.tarball}`);
            fetched++;
        }
        if (sha256(buf) !== f.sha256) throw new Error(`${f.from} has SHA-256 ${sha256(buf)}, not ${f.sha256}: not used`);
        const dest = path.join(root, f.to);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(`${dest}.part`, buf);
        fs.renameSync(`${dest}.part`, dest);
    }
    if (fetched) console.log(`ONNX Runtime Web ${p.version}: ${fetched} of ${p.files.length} files from ${tarball || p.tarball} (integrity and SHA-256 checked).`);
    else if (!quiet) console.log(`ONNX Runtime Web ${p.version}: ${copied} file(s) copied from this checkout (SHA-256 checked).`);
    return { fetched, copied, files: p.files.length };
}

if (require.main === module) {
    const a = process.argv.slice(2);
    const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
    fetchOrt({ pin: opt('--pin') || PIN, root: opt('--root') ? path.resolve(opt('--root')) : ROOT, tarball: opt('--tarball') || null, check: a.includes('--check'), quiet: a.includes('--quiet') })
        .catch((e) => { console.error(`ONNX Runtime Web: ${e.message}`); process.exit(1); });
}
module.exports = { fetchOrt, plan, untar };
