// ai-engine.js — EXPERIMENT (branch llm_testing): the AI model (phish-tiny, models/phish-tiny/model.onnx)
// in ONNX Runtime Web, on the graphics card (WebGPU) when the browser gives one, else in WebAssembly.
// The runtime is in the package (lib/ort/, pinned by lib/ort/SOURCE.json): nothing is loaded from the
// web, and the email never leaves this computer.
//
// Where it runs: Chrome's hidden offscreen document (scanner.html; its service worker can't load
// WebAssembly modules or use WebGPU), and in Firefox and Safari the background page itself
// (background.html). background.js asks it (aiEngineAnalyze) and, when it can't answer (no runtime,
// no document, a timeout), uses the JavaScript runtime in ai.js instead, so the opinion always comes.
// The input text, the tokenizer and the explanation are ai.js's own (modelInputParts, WordPiece), loaded
// before this module in the same page: the three runtimes read exactly the same text and agree to 0.001
// (the unit tests hold the JavaScript one to PyTorch's numbers, the e2e tests this one to it).
import * as ort from './lib/ort/ort.webgpu.bundle.min.mjs';

const BATCH = 32;                 // texts in one run at most (the explanation passes of one email: up to 26)
const MARGINS_KEPT = 2000;        // answers remembered, by text (an email's sentences repeat across emails)

ort.env.wasm.wasmPaths = chrome.runtime.getURL('lib/ort/');
ort.env.wasm.numThreads = 1;      // extension pages aren't cross-origin isolated: no SharedArrayBuffer, one thread
ort.env.wasm.proxy = false;
ort.env.logLevel = 'error';

async function read(p, kind) {
    const res = await fetch(chrome.runtime.getURL(p));
    if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
    return kind === 'json' ? res.json() : kind === 'text' ? res.text() : res.arrayBuffer();
}

// The session: WebGPU when the browser has an adapter and the runtime accepts it, else WebAssembly.
async function createSession(bytes) {
    const tried = [];
    if (typeof navigator !== 'undefined' && navigator.gpu) {
        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (adapter) {
                const session = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
                return { session, engine: 'WebGPU', tried };
            }
            tried.push('WebGPU: no adapter');
        } catch (e) { tried.push(`WebGPU: ${String(e && e.message || e).slice(0, 160)}`); }
    } else tried.push('WebGPU: not in this browser');
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return { session, engine: 'WebAssembly', tried };
}

class OrtPhishModel {
    constructor(manifest, session, vocabText, engine, tried, loadMs) {
        this.meta = manifest; this.cfg = manifest.config; this.session = session; this.engine = engine; this.tried = tried; this.loadMs = loadMs;
        this.tok = new WordPiece(vocabText);
        this.margins = new Map();
    }
    // Phishing logit minus genuine logit for each text (what ai.js's margin() gives), in batches.
    async marginsOf(texts) {
        const out = new Array(texts.length), todo = [];
        texts.forEach((t, i) => {
            const hit = this.margins.get(t);
            if (hit !== undefined) { this.margins.delete(t); this.margins.set(t, hit); out[i] = hit; }
            else todo.push({ i, ids: this.tok.encode(t, this.cfg.maxLen) });
        });
        for (let s = 0; s < todo.length; s += BATCH) {
            const part = todo.slice(s, s + BATCH), B = part.length, T = Math.max(...part.map(x => x.ids.length));
            const ids = new BigInt64Array(B * T), mask = new Float32Array(B * T);
            part.forEach((x, b) => { for (let t = 0; t < x.ids.length; t++) { ids[b * T + t] = BigInt(x.ids[t]); mask[b * T + t] = 1; } });
            const res = await this.session.run({ input_ids: new ort.Tensor('int64', ids, [B, T]), attention_mask: new ort.Tensor('float32', mask, [B, T]) });
            const l = res.logits.data;
            part.forEach((x, b) => {
                const m = l[b * 2 + 1] - l[b * 2];
                out[x.i] = m;
                if (this.margins.size >= MARGINS_KEPT) this.margins.delete(this.margins.keys().next().value);
                this.margins.set(texts[x.i], m);
            });
        }
        return out;
    }
    // The same answer and explanation as PhishModel.analyze in ai.js, with the margins from the session.
    async analyze(facts) {
        const parts = modelInputParts(facts, this.meta.inputFormat || 1);
        const [m] = await this.marginsOf([`${parts.head} text: ${parts.sentences.join(' ')}`]);
        const p = 1 / (1 + Math.exp(-m));
        const reasons = [];
        if (p >= 0.5) {
            const sentences = parts.sentences.slice(0, 25).filter(s => s.length >= 12);
            const ws = await this.marginsOf([...sentences.map(s => `text: ${s}`), `${parts.head} text:`]);
            sentences.forEach((s, i) => { if (ws[i] > 0) reasons.push({ sentence: s.slice(0, 200), weight: ws[i] }); });
            const w = ws[sentences.length];
            if (w > 0) reasons.push({ sentence: 'Who sent it, the sender check and where its links go', weight: w, facts: true });
        }
        reasons.sort((a, b) => b.weight - a.weight);
        return { probability: p, reasons: reasons.slice(0, 3), model: this.meta.name, version: this.meta.version, engine: this.engine };
    }
    status() {
        return { ok: true, engine: this.engine, runtime: `ONNX Runtime Web ${(ort.env.versions && ort.env.versions.web) || ''}`.trim(), loadMs: this.loadMs, tried: this.tried,
                 model: `${this.meta.name} ${this.meta.version}` };
    }
}

let enginePromise = null;
function engine() {
    if (!enginePromise) {
        enginePromise = (async () => {
            const t0 = Date.now();
            const [manifest, bytes, vocab] = await Promise.all([read('models/phish-tiny/model.json', 'json'), read('models/phish-tiny/model.onnx', 'bin'), read('models/phish-tiny/vocab.txt', 'text')]);
            const { session, engine: name, tried } = await createSession(bytes);
            return new OrtPhishModel(manifest, session, vocab, name, tried, Date.now() - t0);
        })().catch((e) => { enginePromise = null; throw e; });
    }
    return enginePromise;
}

const failed = (e) => ({ ok: false, error: String(e && e.message || e).slice(0, 300) });
const api = {
    analyze: (facts) => engine().then(m => m.analyze(facts)).then(result => ({ ok: true, result }), failed),
    status: () => engine().then(m => m.status(), failed)
};

// In the background page (Firefox, Safari), background.js has defined registerLocalAiEngine and calls the
// engine directly. In Chrome's offscreen document, the background asks through messages.
if (typeof globalThis.registerLocalAiEngine === 'function') {
    globalThis.registerLocalAiEngine(api);
} else {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg || msg.target !== 'ai' || sender.id !== chrome.runtime.id) return;
        (msg.action === 'status' ? api.status() : api.analyze(msg.facts || {})).then(sendResponse, (e) => sendResponse(failed(e)));
        return true;
    });
}
