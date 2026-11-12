#!/usr/bin/env node
// tools/sync-model.js — EXPERIMENT (llm_testing): moves the extension to a model of TinyPhishLLM, the AI
// model's own public repository, which S.P.R.U.C.E+ Mail Protection uses too (one model, trained in one
// place; the training itself is in the private TinyPhishLLM_Private_Training).
//
//     node tools/sync-model.js <TinyPhishLLM folder>
//
// The folder must be a clean checkout (no uncommitted changes) at a commit that is on TinyPhishLLM's main
// branch on GitHub (the build downloads the model from there). This:
//   1. runs TinyPhishLLM's own check (tools/check.js);
//   2. checks that this extension builds the model's input exactly as the model was trained
//      (modelInputText in ai.js against TinyPhishLLM's model/reference/input-format.jsonl); if it doesn't,
//      nothing changes: change ai.js first (TinyPhishLLM's changelog says how the format changed);
//   3. pins the model in models/phish-tiny/SOURCE.json: the repository, the commit, the model's version and
//      each file's SHA-256. The model's files are not committed: tools/build.js adds them to every package
//      (tools/fetch-model.js downloads them at that commit, and stops if a file's SHA-256 differs);
//   4. copies the references the unit tests use (committed, the same hashes in SOURCE.json):
//        model/reference/ai-vectors.json        -> tests/fixtures/ai-vectors.json
//        model/reference/input-format.jsonl     -> tests/fixtures/ai-input-format.jsonl
//      and the model's files into models/phish-tiny/ (ignored by git), so the tests run:
//        model/phish-tiny/{model.bin,model.json,vocab.txt,MODEL_CARD.md} (model.onnx is not needed: the
//        extension runs model.bin in plain JavaScript).
// Then run the tests (cd tests && node run-all.js) and follow CLAUDE.md for the version and changelog.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
// [TinyPhishLLM path, this repository's path]. Under models/: added by the build, not committed.
const FILES = [
    ['model/phish-tiny/model.bin', 'models/phish-tiny/model.bin'],
    ['model/phish-tiny/model.json', 'models/phish-tiny/model.json'],
    ['model/phish-tiny/vocab.txt', 'models/phish-tiny/vocab.txt'],
    ['model/phish-tiny/MODEL_CARD.md', 'models/phish-tiny/MODEL_CARD.md'],
    ['model/reference/ai-vectors.json', 'tests/fixtures/ai-vectors.json'],
    ['model/reference/input-format.jsonl', 'tests/fixtures/ai-input-format.jsonl']
];
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fail = (msg) => { console.error(`Not synced: ${msg}`); process.exit(1); };

function main() {
    const src = process.argv[2] ? path.resolve(process.argv[2]) : fail('give the TinyPhishLLM folder: node tools/sync-model.js <folder>');
    const git = (...a) => execFileSync('git', a, { cwd: src }).toString().trim();
    let commit;
    try { commit = git('rev-parse', 'HEAD'); } catch (e) { fail(`${src} is not a git checkout of TinyPhishLLM.`); }
    if (git('status', '--porcelain', '--untracked-files=no')) fail(`${src} has uncommitted changes: sync from a commit.`);
    let repository = '';
    try { repository = git('remote', 'get-url', 'origin').replace(/\.git$/, '').replace(/^https:\/\/[^@/]*@/, 'https://').replace(/^git@github\.com:/, 'https://github.com/'); } catch (e) { /* no remote */ }
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repository)) fail(`${src}'s origin isn't TinyPhishLLM on GitHub (${repository || 'none'}): the build downloads the model from there.`);
    try { git('fetch', '-q', 'origin', 'main'); } catch (e) { fail(`couldn't read TinyPhishLLM's main branch from GitHub (${repository}): the build downloads the model from there.`); }
    try { git('merge-base', '--is-ancestor', commit, 'FETCH_HEAD'); } catch (e) { fail(`commit ${commit.slice(0, 7)} isn't on TinyPhishLLM's main branch on GitHub: push it there first (the build downloads it from there).`); }

    // 1. TinyPhishLLM's own check.
    try { execFileSync(process.execPath, [path.join(src, 'tools', 'check.js')], { cwd: src, stdio: 'pipe' }); }
    catch (e) { fail(`TinyPhishLLM's tools/check.js failed:\n${(e.stdout || '').toString()}`); }

    // 2. This extension's input format against the model's.
    const ctx = { console, URL, TextDecoder, chrome: { runtime: { getURL: (p) => p } } };
    vm.createContext(ctx);
    for (const f of ['shared.js', 'ai.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    const cases = fs.readFileSync(path.join(src, 'model/reference/input-format.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    const different = cases.filter(c => ctx.modelInputText(c.facts) !== c.text).map(c => c.name);
    if (different.length) fail(`ai.js builds a different input than the model was trained with (${different.length} of ${cases.length}: ${different.slice(0, 5).join(', ')}).`);

    // 3. Pin, 4. copy.
    const files = {};
    for (const [from, to] of FILES) {
        fs.mkdirSync(path.dirname(path.join(ROOT, to)), { recursive: true });
        fs.copyFileSync(path.join(src, from), path.join(ROOT, to));
        files[to] = { from, sha256: sha256(path.join(ROOT, to)) };
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(src, 'model/phish-tiny/model.json'), 'utf8'));
    const source = { repository, commit, model: `${manifest.name} ${manifest.version}`, synced: new Date().toISOString().slice(0, 10),
        note: 'Pinned by tools/sync-model.js. The model\'s files (models/phish-tiny/*) are not in this repository: tools/build.js adds them to every package from TinyPhishLLM at this commit (tools/fetch-model.js) and only with these SHA-256. Don\'t edit them here: change the model in TinyPhishLLM and sync again.',
        files };
    fs.writeFileSync(path.join(ROOT, 'models/phish-tiny/SOURCE.json'), JSON.stringify(source, null, 2) + '\n');
    console.log(`Pinned ${source.model} from ${repository} at ${commit.slice(0, 7)}: ${FILES.length} files; the input format matches on all ${cases.length} cases.`);
}

if (require.main === module) main();
module.exports = { FILES };
