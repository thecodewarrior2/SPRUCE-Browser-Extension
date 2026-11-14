#!/usr/bin/env node
// tools/build.js — builds the extension for each browser from the same files.
//
//     node tools/build.js                    every browser, from the last commit (for a release)
//     node tools/build.js chrome firefox     only those browsers
//     node tools/build.js --working-tree     from the files as they are now, committed or not (tests, trying
//                                            a change); never for a release
//
// Output in build/:
//     chrome/                                  the Chrome and Edge extension (Load unpacked)
//     spruce-<version>-chrome-manual-install.zip  for testing before a release: one folder, S.P.R.U.C.E+-<version>,
//                                              with INSTALL.md; keeps "key", so every test copy has the
//                                              same extension ID and policies reach it
//     spruce-<version>-webstore.zip            to upload to the Chrome Web Store and Edge Add-ons: without
//                                              "key", which the stores refuse on a new item's first upload
//     firefox/                                 the Firefox add-on (about:debugging → Load Temporary Add-on)
//     spruce-<version>-firefox.zip             to upload to addons.mozilla.org for signing; Firefox installs
//                                              only signed add-ons, so never publish this file itself
//     safari/extension/                        the input for Apple's converter (tools/build-safari.sh, on a Mac)
//
// The top-level manifest.json is the Chrome one (so the repository itself loads in Chrome as it is); the
// Firefox and Safari manifests are made from it here, so a permission added for one browser is added for
// all. Everything that differs between the browsers' packages is in BROWSERS below.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'build');

const BROWSERS = {
    chrome: {
        // Firefox and Safari run the background in this page; Chrome uses background.js as a service worker.
        without: ['background.html'],
        manifest: (m) => m
    },
    firefox: {
        // scanner.html is Chrome's offscreen document; schema.json is Chrome's policy schema (Firefox reads
        // policy from policies.json and needs no schema).
        without: ['scanner.html', 'schema.json'],
        manifest: (m) => {
            delete m.key;
            delete m.storage;                                   // managed_schema (Chrome only)
            m.permissions = m.permissions.filter(p => p !== 'offscreen');
            m.background = { page: 'background.html' };
            return withAfter(m, 'description', 'browser_specific_settings', {
                gecko: {
                    id: 'spruce@spruce-browser-extension',
                    strict_min_version: '140.0',
                    data_collection_permissions: { required: ['websiteContent', 'personalCommunications'] }
                }
            });
        }
    },
    safari: {
        // The app bundle also leaves out the top-level documents (README, CHANGELOG, PRIVACY).
        without: ['scanner.html', 'schema.json', 'README.md', 'CHANGELOG.md', 'PRIVACY.md'],
        manifest: (m) => {
            delete m.key;
            delete m.storage;
            delete m.optional_permissions;                      // "management": Safari has no such API
            m.permissions = m.permissions.filter(p => p !== 'offscreen');
            m.background = { page: 'background.html', persistent: false };
            // Safari supports match_origin_as_fallback only from 18.4; this build supports 18.2.
            m.content_scripts = m.content_scripts.map(cs => { const c = Object.assign({}, cs); delete c.match_origin_as_fallback; return c; });
            return withAfter(m, 'version', 'browser_specific_settings', { safari: { strict_min_version: '18.2' } });
        }
    }
};

// A copy of the manifest with `key` set to `value`, placed right after `after` (key order is cosmetic,
// but keeps the generated manifests readable next to the Chrome one).
function withAfter(m, after, key, value) {
    const out = {};
    for (const [k, v] of Object.entries(m)) {
        if (k === key) continue;
        out[k] = v;
        if (k === after) out[key] = value;
    }
    if (!(key in out)) out[key] = value;
    return out;
}

function manifestFor(browser, chromeManifest) {
    return BROWSERS[browser].manifest(JSON.parse(JSON.stringify(chromeManifest)));
}

// The extension's files: from the last commit (git archive) or from the working tree (git's list of
// files, tracked or new but not ignored). Either way without what .gitattributes marks export-ignore
// (tests, docs, store material, …) and without tools/.
function sourceFiles(workingTree) {
    const git = (args, input) => execFileSync('git', args, { cwd: ROOT, input, maxBuffer: 64 * 1024 * 1024 });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spruce-src-'));
    if (!workingTree) {
        const tar = path.join(dir, '..', path.basename(dir) + '.tar');
        fs.writeFileSync(tar, git(['archive', '--format=tar', 'HEAD']));
        execFileSync('tar', ['-xf', tar, '-C', dir]);
        fs.rmSync(tar);
    } else {
        const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).toString().split('\0').filter(Boolean);
        // export-ignore on a folder (tests, docs…) belongs to the folder, not to the files in it, so every
        // file's parent folders are asked too, as git archive does.
        const paths = new Set();
        for (const f of files) { const parts = f.split('/'); for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join('/')); }
        const attrs = git(['check-attr', '-z', '--stdin', 'export-ignore'], [...paths].join('\0') + '\0').toString().split('\0');
        const ignored = new Set();
        for (let i = 0; i + 2 < attrs.length; i += 3) if (attrs[i + 2] === 'set') ignored.add(attrs[i]);
        const isIgnored = (f) => { const parts = f.split('/'); for (let i = 1; i <= parts.length; i++) if (ignored.has(parts.slice(0, i).join('/'))) return true; return false; };
        for (const f of files) {
            if (isIgnored(f) || !fs.existsSync(path.join(ROOT, f))) continue;
            fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
            fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
        }
    }
    fs.rmSync(path.join(dir, 'tools'), { recursive: true, force: true });
    return dir;
}

function copyTree(from, to, without) {
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true, filter: (src) => !without.includes(path.relative(from, src)) });
}

function writeManifest(dir, m) {
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
}

function zipDir(dir, zip) {
    fs.rmSync(zip, { force: true });
    execFileSync('zip', ['-qr', '-X', zip, '.'], { cwd: dir });
}

// Third-party code bundled as it is, pinned to the exact files of its release (SHA-256). A changed or
// swapped file stops the build. To update PDF.js: take pdf.min.mjs and pdf.worker.min.mjs from the
// pdfjs-dist package of the new version (npm), check them, and put the new version and hashes here.
const PINNED_FILES = {
    'lib/pdf.min.mjs':        { from: 'pdfjs-dist 5.6.205 (npm), build/pdf.min.mjs',        sha256: '2221020ea508479dcc1221f36f2731656339230097c69ba1f78802832c0ad685' },
    'lib/pdf.worker.min.mjs': { from: 'pdfjs-dist 5.6.205 (npm), build/pdf.worker.min.mjs', sha256: '51a2fd1ea47f1a9b0814e65e0c336c739c54957795ee774e8f93cb81e8028dd1' }
};
function checkPinnedFiles(dir) {
    const crypto = require('crypto');
    for (const [file, pin] of Object.entries(PINNED_FILES)) {
        const p = path.join(dir, file);
        if (!fs.existsSync(p)) throw new Error(`${file} is missing (expected ${pin.from}).`);
        const got = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        if (got !== pin.sha256) throw new Error(`${file} is not ${pin.from}: its SHA-256 is ${got}. If PDF.js was updated on purpose, update PINNED_FILES in tools/build.js.`);
    }
}

// EXPERIMENT (llm_testing): the AI model (phish-tiny) isn't in the repository. models/phish-tiny/SOURCE.json
// pins one commit of TinyPhishLLM, the model's own public repository, and each file's SHA-256, and every
// package gets the files from there (tools/fetch-model.js: this checkout's copy when it is the pinned one,
// else downloaded). A missing or different file stops the build. Packages without SOURCE.json (the
// branches without the AI model) are left as they are.
function addModel(dir) {
    const pin = path.join(dir, 'models', 'phish-tiny', 'SOURCE.json');
    if (!fs.existsSync(pin)) return null;
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'fetch-model.js'), '--pin', pin, '--root', dir, '--quiet'], { stdio: ['ignore', 'inherit', 'inherit'] });
    const source = JSON.parse(fs.readFileSync(pin, 'utf8'));
    const crypto = require('crypto');
    for (const [to, f] of Object.entries(source.files).filter(([to]) => to.startsWith('models/'))) {
        const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, to))).digest('hex');
        if (got !== f.sha256) throw new Error(`${to} is not TinyPhishLLM's at ${source.commit.slice(0, 7)} (SHA-256 ${got}).`);
    }
    return source;
}

// EXPERIMENT (llm_testing): ONNX Runtime Web (the AI engine's runtime, lib/ort/) isn't in the repository
// either: lib/ort/SOURCE.json pins its npm tarball and each file's SHA-256 (tools/fetch-ort.js).
function addOrt(dir) {
    if (!fs.existsSync(path.join(dir, 'lib', 'ort', 'SOURCE.json'))) return;
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'fetch-ort.js'), '--root', dir, '--quiet'], { stdio: ['ignore', 'inherit', 'inherit'] });
}

function build(browsers, workingTree) {
    const src = sourceFiles(workingTree);
    try {
        checkPinnedFiles(src);
        const model = addModel(src);
        addOrt(src);
        const chromeManifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
        const version = chromeManifest.version;
        fs.mkdirSync(OUT, { recursive: true });
        const made = [];
        for (const b of browsers) {
            const m = manifestFor(b, chromeManifest);
            const dir = b === 'safari' ? path.join(OUT, 'safari', 'extension') : path.join(OUT, b);
            copyTree(src, dir, BROWSERS[b].without);
            writeManifest(dir, m);
            made.push(path.relative(ROOT, dir) + '/');
            if (b === 'chrome') {
                if (!m.key) throw new Error('manifest.json has no "key": manual installs would each get a different extension ID.');
                const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spruce-zip-'));
                const folder = path.join(tmp, `S.P.R.U.C.E+-${version}`);
                fs.cpSync(dir, folder, { recursive: true });
                // The install steps, from the same commit (or working tree) as the rest.
                const install = workingTree ? fs.readFileSync(path.join(ROOT, 'docs', 'INSTALL-FOR-TESTERS.md'))
                    : execFileSync('git', ['show', 'HEAD:docs/INSTALL-FOR-TESTERS.md'], { cwd: ROOT });
                fs.writeFileSync(path.join(folder, 'INSTALL.md'), install);
                const manual = path.join(OUT, `spruce-${version}-chrome-manual-install.zip`);
                fs.rmSync(manual, { force: true });
                execFileSync('zip', ['-qr', '-X', manual, path.basename(folder)], { cwd: tmp });
                fs.rmSync(tmp, { recursive: true, force: true });
                const store = Object.assign({}, m); delete store.key;
                if ((store.description || '').length > 132) throw new Error('manifest.json: the description is over 132 characters, which the Chrome Web Store refuses.');
                const sdir = fs.mkdtempSync(path.join(os.tmpdir(), 'spruce-store-'));
                fs.cpSync(dir, sdir, { recursive: true });
                writeManifest(sdir, store);
                zipDir(sdir, path.join(OUT, `spruce-${version}-webstore.zip`));
                fs.rmSync(sdir, { recursive: true, force: true });
                made.push(`build/spruce-${version}-chrome-manual-install.zip`, `build/spruce-${version}-webstore.zip`);
            }
            if (b === 'firefox') {
                zipDir(dir, path.join(OUT, `spruce-${version}-firefox.zip`));
                made.push(`build/spruce-${version}-firefox.zip`);
            }
        }
        return { version, made, model: model && `${model.model} (TinyPhishLLM ${model.commit.slice(0, 7)})` };
    } finally {
        fs.rmSync(src, { recursive: true, force: true });
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const workingTree = args.includes('--working-tree');
    const unknown = args.filter(a => a.startsWith('--') && a !== '--working-tree');
    const browsers = args.filter(a => !a.startsWith('--'));
    const bad = browsers.filter(b => !BROWSERS[b]);
    if (unknown.length || bad.length) {
        console.error(`Usage: node tools/build.js [${Object.keys(BROWSERS).join('|')} …] [--working-tree]`);
        process.exit(2);
    }
    if (!workingTree) {
        const dirty = execFileSync('git', ['status', '--porcelain', '--', '.', ':!build'], { cwd: ROOT }).toString().trim();
        if (dirty) console.error('Note: uncommitted changes are not included (built from the last commit; --working-tree includes them).');
    }
    const { version, made, model } = build(browsers.length ? browsers : Object.keys(BROWSERS), workingTree);
    console.log(`S.P.R.U.C.E+ ${version}${workingTree ? ' (working tree)' : ''}${model ? `, AI model ${model}` : ''}:\n  ` + made.join('\n  '));
}

module.exports = { BROWSERS, manifestFor, build, PINNED_FILES, checkPinnedFiles, addModel };
