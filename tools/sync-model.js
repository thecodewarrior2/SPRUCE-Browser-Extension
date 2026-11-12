#!/usr/bin/env node
// tools/sync-model.js — EXPERIMENT (llm_testing): brings the AI model phish-tiny from TinyPhishLLM, the
// model's own repository, which S.P.R.U.C.E+ Mail Protection uses too (one model, trained in one place).
//
//     node tools/sync-model.js <TinyPhishLLM folder>
//
// The folder must be a clean checkout (no uncommitted changes) at the commit to use. This:
//   1. runs TinyPhishLLM's own check (training/check.js);
//   2. checks that this extension builds the model's input exactly as the model was trained
//      (modelInputText in ai.js against TinyPhishLLM's model/reference/input-format.jsonl); if it doesn't,
//      nothing is copied: change ai.js first (TinyPhishLLM's changelog says how the format changed);
//   3. copies the model and its references:
//        model/phish-tiny/{model.bin,model.json,vocab.txt,MODEL_CARD.md} -> models/phish-tiny/
//        model/reference/ai-vectors.json        -> tests/fixtures/ai-vectors.json
//        model/reference/regressions.jsonl      -> tests/fixtures/ai-regressions.jsonl
//        model/reference/input-format.jsonl     -> tests/fixtures/ai-input-format.jsonl
//        training/eval-handwritten.jsonl        -> tests/fixtures/ai-handwritten.jsonl
//      (model.onnx is not needed: the extension runs model.bin in plain JavaScript);
//   4. writes models/phish-tiny/SOURCE.json: the repository, the commit, the model's version and each
//      copied file's SHA-256. The unit tests fail if a file no longer matches it.
// Then run the tests (cd tests && node run-all.js) and follow CLAUDE.md for the version and changelog.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
    ['model/phish-tiny/model.bin', 'models/phish-tiny/model.bin'],
    ['model/phish-tiny/model.json', 'models/phish-tiny/model.json'],
    ['model/phish-tiny/vocab.txt', 'models/phish-tiny/vocab.txt'],
    ['model/phish-tiny/MODEL_CARD.md', 'models/phish-tiny/MODEL_CARD.md'],
    ['model/reference/ai-vectors.json', 'tests/fixtures/ai-vectors.json'],
    ['model/reference/regressions.jsonl', 'tests/fixtures/ai-regressions.jsonl'],
    ['model/reference/input-format.jsonl', 'tests/fixtures/ai-input-format.jsonl'],
    ['training/eval-handwritten.jsonl', 'tests/fixtures/ai-handwritten.jsonl']
];
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fail = (msg) => { console.error(`Not synced: ${msg}`); process.exit(1); };

const src = process.argv[2] ? path.resolve(process.argv[2]) : fail('give the TinyPhishLLM folder: node tools/sync-model.js <folder>');
const git = (...a) => execFileSync('git', a, { cwd: src }).toString().trim();
let commit;
try { commit = git('rev-parse', 'HEAD'); } catch (e) { fail(`${src} is not a git checkout of TinyPhishLLM.`); }
if (git('status', '--porcelain', '--untracked-files=no')) fail(`${src} has uncommitted changes: sync from a commit.`);
let repository = '';
try { repository = git('remote', 'get-url', 'origin').replace(/\.git$/, '').replace(/^https:\/\/[^@/]*@/, 'https://'); } catch (e) { /* no remote */ }

// 1. TinyPhishLLM's own check.
try { execFileSync(process.execPath, [path.join(src, 'training', 'check.js')], { cwd: src, stdio: 'pipe' }); }
catch (e) { fail(`TinyPhishLLM's training/check.js failed:\n${(e.stdout || '').toString()}`); }

// 2. This extension's input format against the model's.
const ctx = { console, URL, TextDecoder, chrome: { runtime: { getURL: (p) => p } } };
vm.createContext(ctx);
for (const f of ['shared.js', 'ai.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const cases = fs.readFileSync(path.join(src, 'model/reference/input-format.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
const different = cases.filter(c => ctx.modelInputText(c.facts) !== c.text).map(c => c.name);
if (different.length) fail(`ai.js builds a different input than the model was trained with (${different.length} of ${cases.length}: ${different.slice(0, 5).join(', ')}).`);

// 3. Copy, 4. record.
const files = {};
for (const [from, to] of FILES) {
    fs.mkdirSync(path.dirname(path.join(ROOT, to)), { recursive: true });
    fs.copyFileSync(path.join(src, from), path.join(ROOT, to));
    files[to] = sha256(path.join(ROOT, to));
}
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'models/phish-tiny/model.json'), 'utf8'));
const source = { repository: repository || 'TinyPhishLLM', commit, model: `${manifest.name} ${manifest.version}`, synced: new Date().toISOString().slice(0, 10),
                 note: 'Copied by tools/sync-model.js from TinyPhishLLM, the model\'s own repository. Don\'t edit these files here: change TinyPhishLLM and sync again.', files };
fs.writeFileSync(path.join(ROOT, 'models/phish-tiny/SOURCE.json'), JSON.stringify(source, null, 2) + '\n');
console.log(`Synced ${source.model} from ${source.repository} at ${commit.slice(0, 7)}: ${FILES.length} files; the input format matches on all ${cases.length} cases.`);
