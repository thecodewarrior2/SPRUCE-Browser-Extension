// ai.js — EXPERIMENT (branch llm_testing): the extension's own small language model reads an opened
// email and gives its opinion on whether it is phishing, and which sentences made it think so.
//
// The model (models/phish-tiny/) is a BERT-tiny classifier (2 layers, 4.4 million parameters, about
// 4.5 MB with 8-bit weights) that WE train, in TinyPhishLLM, the model's own repository (shared with
// S.P.R.U.C.E Mail Protection Service); tools/sync-model.js copies it here (models/phish-tiny/SOURCE.json). It runs right here, in plain JavaScript (no WebAssembly, no download, nothing
// sent anywhere), in Chrome's service worker, Firefox's and Safari's background page, and in Node for
// the tests, which check it against PyTorch's own numbers (tests/fixtures/ai-vectors.json).
//
// Ground rules, enforced here and in the callers:
//   - ADVISORY ONLY. The model's opinion can add a warning, never remove one: it never makes an email or
//     link "safe", never clears a flag and never moves anything to Spam (aiAdvice).
//   - ON THIS COMPUTER ONLY. Each opened email is analyzed as it opens (aiAutoAnalyze, on by default),
//     or only when the person clicks "Ask the AI"; nothing is sent anywhere or stored.
//   - LESS PERSONAL DATA. Addresses keep only their domain, phone numbers and long numbers are replaced
//     (redactForAi) before the text reaches the model, as in training.
//   - TEXT THAT VOUCHES FOR ITSELF counts toward phishing (selfVouchingSigns in shared.js; the training
//     data teaches the model the same).
// Loaded after shared.js (registrableDomain, selfVouchingSigns, isSharedMailbox).

// ---------------------------------------------------------------------------------------------------
// The model's input: one text built from the email's facts. TinyPhishLLM builds its training emails with
// the same lines (its training/model-input.js), so training and use see the same format; the unit tests
// hold this copy to its reference (tests/fixtures/ai-input-format.jsonl, synced with the model).
// facts: { subject, senderName, senderAddress, auth: { dmarc } | null,
//          links: [{ text, host, destHost, finding }], bodyText,
//          org: 'inside' | 'outside' | undefined (the user's own organization, when the account has one),
//          recipient: the reader's own mailbox name (the part before @), replaced by "your name" wherever
//                     it appears, so the model sees the trick ("READER! Apply…", a sender named after
//                     you) without ever seeing the name,
//          layout: ['images only' | 'text after a large blank gap'] (how the email hides its text),
//          mailChecks: kinds of headerAnomalies findings (AI_MAIL_CHECKS),
//          --- format 2 (phish-tiny 0.16.0): the facts a program's own checks already found, so the model
//          judges the words in context ---
//          auth: also { spf, dkim }: said only when they fail,
//          identity: { brand, owner, lookalike, colleague } who the sender's name claims to be and whether
//                    the domain is theirs, from the program's own sender checks (aiSenderIdentity):
//                    brand: the brand or agency the name claims ('' none); owner: 'yes' (the domain is
//                    the brand's) | 'no' | 'unsure' (not known to be) | 'personal' (a free mailbox);
//                    lookalike: the domain imitates a well-known brand; colleague: the name is someone
//                    in the organization's, on an outside address,
//          replyTo: addresses (or domains) replies go to; only those not the sender's own domain count,
//          attachments: [{ name, type }] (file name and MIME type; only their kind is said, never the name) }
// Capitals (a subject or text written in capitals) are found here, from the text itself: the model's
// tokenizer reads lower case, so it can't see them otherwise.
// ---------------------------------------------------------------------------------------------------
const AI_MAX_LINKS = 8;

const AI_EMAIL_RE = /\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g;
const AI_PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)[\s.-]?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g;
const AI_LONG_NUMBER_RE = /\b\d[\d -]{5,}\d\b/g;

// Email addresses keep their domain (where mail comes from matters, who it is for doesn't); phone
// numbers and long numbers (accounts, cards, codes) are replaced by what they are.
function redactForAi(text) {
    return String(text || '')
        .replace(AI_EMAIL_RE, (m, local, domain) => `address at ${domain.toLowerCase()}`)
        .replace(AI_PHONE_RE, 'phone number')
        .replace(AI_LONG_NUMBER_RE, 'number');
}

// Tags that mail systems add to EVERY outside email ("[EXTERNAL] …", "EXT: …", "CAUTION: …"): they say
// nothing about phishing (both kinds carry them), so the model never sees them.
function stripExternalTag(subject) {
    let s = String(subject || '');
    for (let i = 0; i < 3; i++) s = s.replace(/^\s*(\[\s*(external|ext|caution|warning|outside sender|non-district|external sender)[^\]]{0,30}\]|\*{0,3}\s*(external|ext|caution)\s*\*{0,3}\s*:)\s*/i, '');
    return s.trim();
}

// What a mail system along the way already found in the headers (headerAnomalies kinds), in words.
const AI_MAIL_CHECKS = Object.freeze({
    'spam-flag': 'already marked as spam by a mail system', 'local-tool': 'sent with a home-made bulk-mail tool',
    'broken-to': 'broken to address', 'placeholders': 'unfilled template placeholders', 'markup': 'web code in address lines',
    'forged-received': 'forged delivery records', 'duplicate-headers': 'repeated headers', 'fake-signature': 'fake signature'
});
const AI_LAYOUTS = new Set(['images only', 'text after a large blank gap']);

// Format 2: the input format's version (model.json's inputFormat says which one a model reads).
const AI_INPUT_FORMAT = 2;

// Who the sender claims to be, in words (identity, from the program's sender checks).
const AI_IDENTITY_OWNER = Object.freeze({ yes: (b) => `the domain is ${b}'s`, no: (b) => `the domain is not ${b}'s`,
    unsure: (b) => `the domain is not known to be ${b}'s`, personal: () => 'sent from a personal mailbox' });
function identityLine(id) {
    if (!id || typeof id !== 'object') return '';
    const parts = [];
    const brand = String(id.brand || '').replace(/[^A-Za-z0-9&.' -]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
    if (brand && AI_IDENTITY_OWNER[id.owner]) parts.push(`name claims ${brand}; ${AI_IDENTITY_OWNER[id.owner](brand)}`);
    if (id.lookalike) parts.push('the domain imitates a well-known brand');
    if (id.colleague) parts.push('the name is a colleague\'s but the address is outside');
    return parts.length ? `identity: ${parts.join('; ')}.` : '';
}

// Where replies go, when that isn't the sender's own domain (or one of its subdomains).
function replyToLine(replyTo, senderDomain) {
    const own = String(senderDomain || '').toLowerCase();
    const same = (d) => d === own || d.endsWith('.' + own) || own.endsWith('.' + d);
    const domains = [...new Set([].concat(replyTo || []).map(a => String(a || '').toLowerCase().trim().split('@').pop())
        .filter(d => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) && !same(d)))].slice(0, 2);
    return domains.length ? `reply-to: goes to ${domains.join(', ')} (not the sender's domain).` : '';
}

// What kind of files are attached, from the file name's ending and the MIME type (never the name itself).
const AI_ATTACHMENT_KINDS = [
    ['program or script', /\.(exe|scr|com|bat|cmd|msi|js|jse|vbs|vbe|wsf|wsh|ps1|lnk|jar|hta|cpl|reg|apk|appx|msix)$/, /x-msdownload|x-msdos|x-executable|javascript|x-sh\b|java-archive|x-ms-shortcut|hta/],
    ['disk image', /\.(iso|img|vhdx?|dmg)$/, /iso9660|x-raw-disk|apple-diskimage/],
    ['archive', /\.(zip|rar|7z|gz|tgz|tar|cab|ace|arj|xz|bz2|z)$/, /zip|rar|7z|compressed|x-tar|gzip|x-xz|bzip/],
    ['macro document', /\.(docm|dotm|xlsm|xltm|xlsb|xlam|pptm|potm|ppsm)$/, /macroenabled/],
    ['web page', /\.(html?|shtml|xhtml|svgz?|mht|mhtml)$/, /html|svg|multipart\/related/],
    ['calendar invite', /\.ics$/, /calendar/],
    ['pdf', /\.pdf$/, /pdf/],
    ['spreadsheet', /\.(xlsx?|ods|csv|numbers)$/, /spreadsheet|ms-excel|csv/],
    ['document', /\.(docx?|dotx|odt|rtf|txt|pptx?|odp|pages|key)$/, /msword|wordprocessing|presentation|powerpoint|opendocument|rtf|text\/plain/],
    ['picture', /\.(png|jpe?g|gif|bmp|webp|heic|tiff?)$/, /^image\//],
    ['audio or video', /\.(mp3|wav|m4a|ogg|mp4|mov|avi|wmv|webm)$/, /^(audio|video)\//]
];
function attachmentKind(name, type) {
    const n = String(name || '').toLowerCase().replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim(), t = String(type || '').toLowerCase();
    for (const [kind, ext, mime] of AI_ATTACHMENT_KINDS) if (ext.test(n)) return kind;
    for (const [kind, ext, mime] of AI_ATTACHMENT_KINDS) if (t && mime.test(t)) return kind;
    return 'other file';
}
function attachmentsLine(attachments) {
    const kinds = [];
    for (const a of [].concat(attachments || []).slice(0, 20)) {
        if (!a || typeof a !== 'object') continue;
        const raw = String(a.name || '');
        kinds.push(attachmentKind(raw, a.type));
        // A name that hides its real type: text-direction characters, or a harmless ending before the real one
        // ("invoice.pdf.exe", "scan.pdf      .html").
        if (/[\u202a-\u202e\u2066-\u2069]/.test(raw) || /\.(pdf|docx?|xlsx?|jpe?g|png|txt)\s*\.[a-z0-9]{2,5}$/i.test(raw.trim())) kinds.push('a file name that hides its type');
    }
    const unique = [...new Set(kinds)].slice(0, 4);
    return unique.length ? `attachments: ${unique.join('; ')}.` : '';
}

// Text written in capitals (the tokenizer reads lower case, so the model is told).
function capitalsLayout(subject, body) {
    const ratio = (t) => { const letters = String(t || '').match(/\p{L}/gu) || []; const up = String(t || '').match(/\p{Lu}/gu) || []; return { n: letters.length, r: letters.length ? up.length / letters.length : 0 }; };
    const out = [], s = ratio(subject), b = ratio(body);
    if (s.n >= 8 && s.r > 0.8) out.push('subject in capitals');
    if (b.n >= 40 && b.r > 0.6) out.push('text mostly in capitals');
    return out;
}

// The reader's own mailbox name, wherever it appears, becomes "your name" (whole words only, and only
// names of 3 or more letters, so "al" in "also" stays).
function maskRecipient(text, recipient) {
    const r = String(recipient || '').trim().toLowerCase();
    if (r.length < 3) return String(text || '');
    const esc = r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return String(text || '').replace(new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?=$|[^\\p{L}\\p{N}])`, 'giu'), '$1your name');
}

// format: the input format to build (AI_INPUT_FORMAT unless a program runs an older model; 1 has none of
// format 2's lines).
function modelInputParts(facts, format = AI_INPUT_FORMAT) {
    const f = facts || {};
    const v2 = format >= 2;
    const mask = (t) => maskRecipient(redactForAi(t), f.recipient);
    const addr = String(f.senderAddress || '').toLowerCase();
    const domain = addr.split('@')[1] || 'unknown';
    const head = [];
    head.push(`subject: ${mask(stripExternalTag(f.subject) || 'none').slice(0, 160)}.`);
    const where = f.org === 'inside' ? ' (your organization)' : f.org === 'outside' ? ' (outside your organization)' : '';
    head.push(`from: "${mask(f.senderName || '').slice(0, 80)}" at ${domain}${where}${typeof isSharedMailbox === 'function' && isSharedMailbox(addr) ? ' (shared mailbox)' : ''}.`);
    const checks = [...new Set((f.mailChecks || []).map(k => AI_MAIL_CHECKS[k]).filter(Boolean))].slice(0, 4);
    const idLine = v2 ? identityLine(f.identity) : '';
    if (idLine) head.push(idLine);
    // SPF and DKIM are said only when they fail (DMARC already sums up a pass).
    const fails = [];
    if (v2) {
        if (f.auth && /^(fail|softfail|permerror)$/.test(String(f.auth.spf || '').toLowerCase())) fails.push(`spf ${String(f.auth.spf).toLowerCase()}`);
        if (f.auth && /^(fail|permerror)$/.test(String(f.auth.dkim || '').toLowerCase())) fails.push(`dkim ${String(f.auth.dkim).toLowerCase()}`);
    }
    head.push(`sender check: ${f.auth && f.auth.dmarc ? `dmarc ${f.auth.dmarc}` : 'unknown'}${fails.length ? `; ${fails.join('; ')}` : ''}${checks.length ? `; ${checks.join('; ')}` : ''}.`);
    const rtLine = v2 ? replyToLine(f.replyTo, domain) : '';
    if (rtLine) head.push(rtLine);
    const links = (f.links || []).slice(0, AI_MAX_LINKS).map(l => {
        const text = mask(String(l.text || '').trim()).slice(0, 40) || 'image';
        const dest = l.destHost && l.destHost !== l.host ? `${l.host} then ${l.destHost}` : (l.host || 'unknown');
        return `"${text}" goes to ${dest}${l.finding ? ` (warning: ${redactForAi(l.finding).slice(0, 80)})` : ''}`;
    });
    head.push(links.length ? `links: ${links.join('; ')}.` : 'links: none.');
    const attLine = v2 ? attachmentsLine(f.attachments) : '';
    if (attLine) head.push(attLine);
    const layout = [...new Set([...(f.layout || []).filter(x => AI_LAYOUTS.has(x)), ...(v2 ? capitalsLayout(stripExternalTag(f.subject), f.bodyText) : [])])];
    if (layout.length) head.push(`layout: ${layout.join('; ')}.`);
    const body = mask(String(f.bodyText || '')).replace(/\s+/g, ' ').trim();
    return { head: head.join(' '), sentences: splitSentences(body) };
}

// Sentences (and line-like fragments), for the explanation; kept in order.
function splitSentences(text) {
    // Only at an end mark followed by a space, so addresses (www.example.com) and numbers stay whole.
    return String(text || '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 1).slice(0, 60);
}

function modelInputText(facts, format = AI_INPUT_FORMAT) {
    const p = modelInputParts(facts, format);
    return `${p.head} text: ${p.sentences.join(' ')}`;
}

// ---------------------------------------------------------------------------------------------------
// WordPiece tokenizer, as BERT's uncased tokenizer (lower case, accents removed, punctuation split).
// ---------------------------------------------------------------------------------------------------
function isBertPunct(ch) {
    const c = ch.codePointAt(0);
    if ((c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)) return true;
    return /\p{P}/u.test(ch);
}

class WordPiece {
    constructor(vocabText) {
        this.vocab = new Map();
        String(vocabText).split('\n').forEach((t, i) => { const w = t.replace(/\r$/, ''); if (w && !this.vocab.has(w)) this.vocab.set(w, i); });
        this.unk = this.vocab.get('[UNK]'); this.cls = this.vocab.get('[CLS]'); this.sep = this.vocab.get('[SEP]');
    }
    basic(text) {
        let t = '';
        for (const ch of String(text)) {
            const c = ch.codePointAt(0);
            if (c === 0 || c === 0xfffd || (/\p{Cc}|\p{Cf}/u.test(ch) && !/[\t\n\r]/.test(ch))) continue;
            // CJK ideographs become words of their own, as in BERT
            if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) || (c >= 0x20000 && c <= 0x2A6DF) || (c >= 0xF900 && c <= 0xFAFF)) { t += ` ${ch} `; continue; }
            t += /\s/.test(ch) ? ' ' : ch;
        }
        t = t.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');
        const out = [];
        for (const word of t.split(/\s+/).filter(Boolean)) {
            let cur = '';
            for (const ch of word) {
                if (isBertPunct(ch)) { if (cur) out.push(cur); out.push(ch); cur = ''; } else cur += ch;
            }
            if (cur) out.push(cur);
        }
        return out;
    }
    wordpiece(word) {
        if ([...word].length > 100) return [this.unk];
        const ids = [];
        let start = 0;
        while (start < word.length) {
            let end = word.length, found = null;
            while (start < end) {
                const piece = (start > 0 ? '##' : '') + word.slice(start, end);
                if (this.vocab.has(piece)) { found = this.vocab.get(piece); break; }
                end--;
            }
            if (found === null) return [this.unk];
            ids.push(found);
            start = end;
        }
        return ids;
    }
    encode(text, maxLen) {
        const ids = [this.cls];
        for (const w of this.basic(text)) {
            for (const id of this.wordpiece(w)) { if (ids.length >= maxLen - 1) break; ids.push(id); }
            if (ids.length >= maxLen - 1) break;
        }
        ids.push(this.sep);
        return ids;
    }
}

// ---------------------------------------------------------------------------------------------------
// BERT forward pass in plain JavaScript. Weights come from model.bin as described by model.json:
// 8-bit tensors (one scale per row) are turned back into floats once, when the model loads.
// ---------------------------------------------------------------------------------------------------
function loadTensors(manifest, buffer) {
    const T = {};
    for (const t of manifest.tensors) {
        const n = t.shape.reduce((a, b) => a * b, 1);
        if (t.dtype === 'f32') T[t.name] = new Float32Array(buffer, t.offset, n);
        else if (t.dtype === 'i8') {
            const q = new Int8Array(buffer, t.offset, n), scales = new Float32Array(buffer, t.scales, t.shape[0]);
            const cols = n / t.shape[0], out = new Float32Array(n);
            for (let r = 0; r < t.shape[0]; r++) { const s = scales[r]; for (let c = 0; c < cols; c++) out[r * cols + c] = q[r * cols + c] * s; }
            T[t.name] = out;
        } else throw new Error(`unknown tensor type ${t.dtype}`);
    }
    return T;
}

// y[T×out] = x[T×in] · Wᵀ + b, with W stored [out×in] as in PyTorch.
function linear(x, T, inDim, W, b, outDim) {
    const y = new Float32Array(T * outDim);
    for (let t = 0; t < T; t++) {
        const xo = t * inDim, yo = t * outDim;
        for (let o = 0; o < outDim; o++) {
            let s = b[o];
            const wo = o * inDim;
            for (let k = 0; k < inDim; k++) s += x[xo + k] * W[wo + k];
            y[yo + o] = s;
        }
    }
    return y;
}

function layerNorm(x, T, H, g, b, eps) {
    for (let t = 0; t < T; t++) {
        const o = t * H;
        let m = 0; for (let i = 0; i < H; i++) m += x[o + i]; m /= H;
        let v = 0; for (let i = 0; i < H; i++) { const d = x[o + i] - m; v += d * d; } v /= H;
        const inv = 1 / Math.sqrt(v + eps);
        for (let i = 0; i < H; i++) x[o + i] = (x[o + i] - m) * inv * g[i] + b[i];
    }
    return x;
}

// erf to about 1e-7 (the Numerical Recipes erfc approximation; Abramowitz and Stegun 7.1.26 is too coarse).
function erf(x) {
    const s = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.5 * x);
    const y = 1 - t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return s * y;
}
const gelu = (x) => 0.5 * x * (1 + erf(x / Math.SQRT2));

class PhishModel {
    constructor(manifest, buffer, vocabText) {
        this.cfg = manifest.config;
        this.meta = manifest;
        this.W = loadTensors(manifest, buffer);
        this.tok = new WordPiece(vocabText);
    }
    // ids: token ids → [logit legitimate, logit phishing]
    forward(ids) {
        const { hidden: H, heads, layers, intermediate: I, eps } = this.cfg;
        const W = this.W, T = ids.length, dh = H / heads, P = 'bert.';
        let x = new Float32Array(T * H);
        const we = W[P + 'embeddings.word_embeddings.weight'], pe = W[P + 'embeddings.position_embeddings.weight'], te = W[P + 'embeddings.token_type_embeddings.weight'];
        for (let t = 0; t < T; t++) for (let i = 0; i < H; i++) x[t * H + i] = we[ids[t] * H + i] + pe[t * H + i] + te[i];
        layerNorm(x, T, H, W[P + 'embeddings.LayerNorm.weight'], W[P + 'embeddings.LayerNorm.bias'], eps);
        for (let l = 0; l < layers; l++) {
            const L = `${P}encoder.layer.${l}.`;
            const q = linear(x, T, H, W[L + 'attention.self.query.weight'], W[L + 'attention.self.query.bias'], H);
            const k = linear(x, T, H, W[L + 'attention.self.key.weight'], W[L + 'attention.self.key.bias'], H);
            const v = linear(x, T, H, W[L + 'attention.self.value.weight'], W[L + 'attention.self.value.bias'], H);
            const ctx = new Float32Array(T * H), scores = new Float32Array(T), scale = 1 / Math.sqrt(dh);
            for (let h = 0; h < heads; h++) {
                const ho = h * dh;
                for (let i = 0; i < T; i++) {
                    let max = -Infinity;
                    for (let j = 0; j < T; j++) {
                        let s = 0;
                        for (let d = 0; d < dh; d++) s += q[i * H + ho + d] * k[j * H + ho + d];
                        scores[j] = s * scale; if (scores[j] > max) max = scores[j];
                    }
                    let sum = 0;
                    for (let j = 0; j < T; j++) { scores[j] = Math.exp(scores[j] - max); sum += scores[j]; }
                    for (let j = 0; j < T; j++) {
                        const p = scores[j] / sum;
                        for (let d = 0; d < dh; d++) ctx[i * H + ho + d] += p * v[j * H + ho + d];
                    }
                }
            }
            const att = linear(ctx, T, H, W[L + 'attention.output.dense.weight'], W[L + 'attention.output.dense.bias'], H);
            for (let i = 0; i < att.length; i++) att[i] += x[i];
            layerNorm(att, T, H, W[L + 'attention.output.LayerNorm.weight'], W[L + 'attention.output.LayerNorm.bias'], eps);
            const mid = linear(att, T, H, W[L + 'intermediate.dense.weight'], W[L + 'intermediate.dense.bias'], I);
            for (let i = 0; i < mid.length; i++) mid[i] = gelu(mid[i]);
            const out = linear(mid, T, I, W[L + 'output.dense.weight'], W[L + 'output.dense.bias'], H);
            for (let i = 0; i < out.length; i++) out[i] += att[i];
            x = layerNorm(out, T, H, W[L + 'output.LayerNorm.weight'], W[L + 'output.LayerNorm.bias'], eps);
        }
        const pooled = linear(x.subarray(0, H), 1, H, W[P + 'pooler.dense.weight'], W[P + 'pooler.dense.bias'], H).map(Math.tanh);
        return Array.from(linear(pooled, 1, H, W['classifier.weight'], W['classifier.bias'], 2));
    }
    // How strongly the model leans to phishing (its two scores' difference), and as a probability.
    margin(text) { const [a, b] = this.forward(this.tok.encode(text, this.cfg.maxLen)); return b - a; }
    probability(text) { return 1 / (1 + Math.exp(-this.margin(text))); }
    // The opinion, and what made it: each sentence is scored on its own ("does this sentence alone read
    // like phishing?"), and so are the facts about the sender and links without the text. The ones
    // that lean furthest toward phishing are named. (Leaving sentences out one at a time says little
    // when an email repeats its tricks, which phishing usually does.)
    analyze(facts) {
        // The input format the model was trained on (model.json inputFormat; 1 for a model that names none).
        const parts = modelInputParts(facts, this.meta.inputFormat || 1);
        const m = this.margin(`${parts.head} text: ${parts.sentences.join(' ')}`);
        const p = 1 / (1 + Math.exp(-m));
        const reasons = [];
        if (p >= 0.5) {
            for (const s of parts.sentences.slice(0, 25)) {
                if (s.length < 12) continue;
                const w = this.margin(`text: ${s}`);
                if (w > 0) reasons.push({ sentence: s.slice(0, 200), weight: w });
            }
            const w = this.margin(`${parts.head} text:`);
            if (w > 0) reasons.push({ sentence: 'Who sent it, the sender check and where its links go', weight: w, facts: true });
        }
        reasons.sort((a, b) => b.weight - a.weight);
        return { probability: p, reasons: reasons.slice(0, 3), model: this.meta.name, version: this.meta.version };
    }
}

// ---------------------------------------------------------------------------------------------------
// Which language an email is written in, as far as the model is concerned: phish-tiny was trained on
// English only (its card says so), so on an email in another language its opinion means little, and it
// gives none: the person is told it can't read it (aiAnalyzeEmail). The extension's own checks don't
// depend on the language. Offline, no library: the letters' writing system (Cyrillic, Arabic, Chinese…),
// and for the Latin alphabet the share of each language's commonest short words. "Not English" only when
// that is clear: an email with a real English part (a bilingual newsletter) counts as English, and a
// short one as unknown (the model reads both). The same as S.P.R.U.C.E Mail Protection Service's
// src/engine/language.js (0.5.10), which is its own copy.
//
// detectLanguage(text) → { code: 'en' | 'es' | … | null, name: 'English' | 'Spanish' | …, english: bool, reason }
// ---------------------------------------------------------------------------------------------------
const AI_LANGUAGE_SCRIPTS = [
    ['Cyrillic', 'ru', 'Russian or another language written in Cyrillic'],
    ['Greek', 'el', 'Greek'],
    ['Arabic', 'ar', 'Arabic, or another language written in Arabic script'],
    ['Hebrew', 'he', 'Hebrew'],
    ['Hangul', 'ko', 'Korean'],
    ['Hiragana', 'ja', 'Japanese'], ['Katakana', 'ja', 'Japanese'],
    ['Han', 'zh', 'Chinese'],
    ['Thai', 'th', 'Thai'], ['Lao', 'lo', 'Lao'], ['Khmer', 'km', 'Khmer'], ['Myanmar', 'my', 'Burmese'],
    ['Devanagari', 'hi', 'Hindi, or another language written in Devanagari'], ['Bengali', 'bn', 'Bengali'],
    ['Gurmukhi', 'pa', 'Punjabi'], ['Gujarati', 'gu', 'Gujarati'], ['Tamil', 'ta', 'Tamil'], ['Telugu', 'te', 'Telugu'],
    ['Armenian', 'hy', 'Armenian'], ['Georgian', 'ka', 'Georgian'], ['Ethiopic', 'am', 'Amharic, or another language written in Ge\'ez script']
].map(([script, code, name]) => ({ code, name, re: new RegExp(`\\p{Script=${script}}`, 'u') }));

// The commonest short words of each language, without words that are also common in English ("a", "in",
// "no", "is", "to"…): a hit is evidence for that language.
const AI_LANGUAGE_WORDS = {
    en: 'the and to of you your for that this with are be on we will please have it our from not by an or at can if been has was would should here all any been they their there which what when who about into than then them these those',
    es: 'el la los las de del que y en por para con una un su sus se al lo como más pero este esta estos estas usted ustedes nuestro nuestra gracias hola estimado estimada favor cuenta correo aquí haga información también está están ser hay sobre cuando desde muy todos puede',
    pt: 'o os de do da dos das que e em para com um uma não por se mais seu sua você é está obrigado obrigada olá prezado prezada conta clique aqui também ao à pelo pela isso este esta são foi ser muito quando',
    fr: 'le la les des du de et est en un une que qui pour dans sur pas vous votre vos nous notre avec ce cette au aux merci bonjour compte cliquez ici sont être plus mais ou très tout tous elle il ils',
    de: 'der die das und ist nicht sie ich wir ihr ihre ihren mit für auf dem den ein eine einen zu von bitte sehr geehrte geehrter konto hier klicken werden wird sind auch oder aber im zum zur danke',
    it: 'il lo la gli le di del della che e è per con un una non sono alla nel nella si suo sua vostro gentile grazie ciao conto clicca qui anche più questo questa',
    nl: 'de het een en van niet voor met op te dat die zijn uw u wij ons onze je jouw bedankt alstublieft klik worden wordt ook maar aan bij',
    vi: 'của và các là cho được này với trong không có những một người bạn chúng tôi đã sẽ để khi từ theo vui lòng tài khoản xin cảm ơn',
    pl: 'w z na nie się jest do że jak ale od za po dla tak czy są pan pani konto proszę kliknij tutaj dziękujemy oraz',
    tr: 've bir bu için ile da de değil çok daha olarak olan gibi sizin hesabınız lütfen tıklayın teşekkürler merhaba ama veya mi ne',
    id: 'yang dan di ke dari untuk dengan ini itu tidak akan anda kami kita pada adalah atau juga sudah bisa akun silakan klik terima kasih harap',
    tl: 'ang ng sa mga na at ay ito ko mo ka po para hindi salamat kayo namin natin inyong',
    ht: 'ak nan pou li yo se ki ou mwen nou pa gen sa te kounye mèsi bonjou lekòl paran timoun',
    so: 'iyo waa ka ku oo la uu ay ee aad si ah waxaa waxay lacag fadlan mahadsanid'
};
const AI_LANGUAGE_NAMES = { en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian', nl: 'Dutch', vi: 'Vietnamese', pl: 'Polish',
                tr: 'Turkish', id: 'Indonesian or Malay', tl: 'Tagalog', ht: 'Haitian Creole', so: 'Somali' };
const AI_LANGUAGE_SETS = Object.fromEntries(Object.entries(AI_LANGUAGE_WORDS).map(([k, v]) => [k, new Set(v.split(' '))]));

const AI_LANGUAGE_MIN_LETTERS = 20, AI_LANGUAGE_MIN_WORDS = 12;

function detectLanguage(text) {
    const t = String(text || '').slice(0, 6000);
    // 1. The writing system: most letters outside the Latin alphabet name the language (or its script).
    let latin = 0, other = 0;
    const byScript = new Map();
    for (const ch of t) {
        if (!/\p{L}/u.test(ch)) continue;
        if (/\p{Script=Latin}/u.test(ch)) { latin++; continue; }
        other++;
        const s = AI_LANGUAGE_SCRIPTS.find(x => x.re.test(ch));
        if (s) byScript.set(s, (byScript.get(s) || 0) + 1);
    }
    if (latin + other >= AI_LANGUAGE_MIN_LETTERS && other / (latin + other) >= 0.5) {
        let best = null;
        for (const [s, n] of byScript) if (!best || n > best[1]) best = [s, n];
        // Japanese mixes kana with Chinese characters: any kana makes it Japanese.
        if (best && best[0].code === 'zh' && [...byScript.keys()].some(s => s.code === 'ja')) best = [AI_LANGUAGE_SCRIPTS.find(s => s.code === 'ja'), best[1]];
        return best ? { code: best[0].code, name: best[0].name, english: false, reason: 'script' }
            : { code: null, name: 'a language not written in the Latin alphabet', english: false, reason: 'script' };
    }
    // 2. The Latin alphabet: the commonest short words of each language.
    const words = t.toLowerCase().match(/[\p{L}']+/gu) || [];
    if (words.length < AI_LANGUAGE_MIN_WORDS) return { code: null, name: 'unknown', english: true, reason: 'short' };
    const hits = Object.fromEntries(Object.keys(AI_LANGUAGE_SETS).map(k => [k, 0]));
    for (const w of words) for (const k in AI_LANGUAGE_SETS) if (AI_LANGUAGE_SETS[k].has(w)) hits[k]++;
    let best = null;
    for (const k in hits) if (k !== 'en' && (!best || hits[k] > hits[best])) best = k;
    const en = hits.en;
    if (best && hits[best] >= 5 && hits[best] >= 2.5 * Math.max(en, 1) && hits[best] / words.length >= 0.1) {
        return { code: best, name: AI_LANGUAGE_NAMES[best], english: false, reason: 'words' };
    }
    return en / words.length >= 0.04 ? { code: 'en', name: 'English', english: true, reason: 'words' } : { code: null, name: 'unknown', english: true, reason: 'unclear' };
}

// What the person is told when the model doesn't read the email (another language). Text that talks to
// AI tools is still a danger sign (aiAdvice says so first), whatever the language.
function aiNotEnglishAdvice(language, extensionStatus, vouching) {
    const v = (vouching || []).slice().sort((a, b) => b.weight - a.weight)[0];
    if (v && v.weight >= 5) return aiAdvice({ probability: 0 }, extensionStatus, vouching);
    const ownWarns = extensionStatus === 'flagged' || extensionStatus === 'caution';
    const name = language && language.name && language.name !== 'unknown' ? language.name : 'another language';
    return { level: 'info', headline: 'The model can\'t read this email: it reads English only.',
             note: `This email looks like it is in ${name}, so the model gives no opinion of it. The extension's own checks don't depend on the language and ran as usual${ownWarns ? ': they warn about this email, so trust them' : ''}. Be careful with links, attachments and requests for money or passwords.` };
}

// ---------------------------------------------------------------------------------------------------
// What the person is told. Never "safe": a low probability is "no strong signs found", and when the
// extension's own checks warn, they are named as the ones to trust. Text that vouches for itself is
// a warning however the model scored it. Returns { level: 'danger'|'caution'|'info', headline, note }.
// ---------------------------------------------------------------------------------------------------
function aiAdvice(result, extensionStatus, vouching) {
    const ownWarns = extensionStatus === 'flagged' || extensionStatus === 'caution';
    const keepOwn = ownWarns ? 'The extension\'s own checks also warn about this email; they rest on verified facts, so trust them over the model.' : '';
    const pct = Math.min(99, Math.round(((result && result.probability) || 0) * 100));   // no model is ever 100% sure
    const v = (vouching || []).sort((a, b) => b.weight - a.weight)[0];
    if (v && v.weight >= 5) return { level: 'danger', headline: 'This email tries to talk to AI tools and filters.', note: `${v.text} ${keepOwn}`.trim() };
    // A safety claim is only a small weight in the extension's own verdict: here it is mentioned when the
    // model warns anyway, and never makes a warning of its own.
    if (pct >= 85) return { level: 'danger', headline: `The model thinks this is likely phishing (${pct}%).`, note: `${v ? v.text + ' ' : ''}${keepOwn}`.trim() };
    if (pct >= 50) return { level: 'caution', headline: `The model finds this email suspicious (${pct}%).`, note: `${v ? v.text + ' ' : ''}${keepOwn}`.trim() };
    return { level: 'info', headline: `The model found no strong signs of phishing (${pct}%).`,
             note: keepOwn || 'That is an opinion, not a check: phishing can look ordinary. Still be careful with links, attachments and requests for money or passwords.' };
}

// The model, loaded once from the extension's own files (or handed in by the tests).
let phishModelPromise = null;
function loadPhishModel(readFile) {
    if (!phishModelPromise) {
        phishModelPromise = (async () => {
            const read = readFile || (async (path, kind) => {
                const res = await fetch(chrome.runtime.getURL(path));
                if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
                return kind === 'json' ? res.json() : kind === 'text' ? res.text() : res.arrayBuffer();
            });
            const [manifest, bin, vocab] = await Promise.all([read('models/phish-tiny/model.json', 'json'), read('models/phish-tiny/model.bin', 'bin'), read('models/phish-tiny/vocab.txt', 'text')]);
            return new PhishModel(manifest, bin, vocab);
        })().catch((e) => { phishModelPromise = null; throw e; });
    }
    return phishModelPromise;
}
