// qr-decoder.js — self-contained QR Code reader (ISO/IEC 18004), no dependencies and no network.
// Used wherever the browser has no built-in BarcodeDetector (Chrome on Windows and Linux, Firefox, Safari).
//
//   QRDecoder.decode(rgbaData, width, height) → { text, version, ecLevel } | null
//
// Pipeline: grayscale → binarize (local block thresholds, then a global fallback) → find the three
// finder patterns → estimate size and the alignment pattern → perspective-correct sampling of the
// module grid → read format/version info → unmask → de-interleave → Reed-Solomon error correction
// → decode numeric / alphanumeric / byte / kanji segments.

const QRDecoder = (() => {
    'use strict';

    // ------------------------------------------------------------------ GF(256), primitive 0x11D
    const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
    (() => {
        let x = 1;
        for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
        for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    })();
    const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
    const gdiv = (a, b) => (a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0);
    const gpow = (a, n) => (n === 0 ? 1 : a ? EXP[(LOG[a] * n) % 255] : 0);

    // Reed-Solomon correction of one block (data then EC codewords, highest-degree first).
    // QR uses generator roots α^0 … α^(nsym-1). Returns the corrected block, or null if uncorrectable.
    function rsCorrect(msg, nsym) {
        const n = msg.length;
        const evalAt = (poly, x) => { let y = 0; for (let i = 0; i < poly.length; i++) y = gmul(y, x) ^ poly[i]; return y; };
        const synd = new Array(nsym);
        let clean = true;
        for (let i = 0; i < nsym; i++) { synd[i] = evalAt(msg, EXP[i]); if (synd[i]) clean = false; }
        if (clean) return msg;

        // Berlekamp-Massey: error locator Λ (lowest degree first)
        let C = [1], B = [1], L = 0, m = 1, b = 1;
        for (let k = 0; k < nsym; k++) {
            let d = synd[k];
            for (let i = 1; i <= L; i++) d ^= gmul(C[i] || 0, synd[k - i]);
            if (d === 0) { m++; continue; }
            const coef = gdiv(d, b);
            const next = C.slice();
            while (next.length < B.length + m) next.push(0);
            for (let i = 0; i < B.length; i++) next[i + m] ^= gmul(coef, B[i]);
            if (2 * L <= k) { B = C; L = k + 1 - L; b = d; m = 1; } else { m++; }
            C = next;
        }
        if (L * 2 > nsym) return null;

        // Chien search
        const lamAt = (x) => { let v = 0; for (let i = C.length - 1; i >= 0; i--) v = gmul(v, x) ^ (C[i] || 0); return v; };
        const positions = [];
        for (let j = 0; j < n; j++) {
            const p = n - 1 - j;                       // power of the term at index j
            if (lamAt(EXP[(255 - p) % 255]) === 0) positions.push(j);
        }
        if (positions.length !== L) return null;

        // Forney: Ω(x) = S(x)·Λ(x) mod x^nsym ; error value e = X · Ω(X⁻¹) / Λ'(X⁻¹)
        const omega = new Array(nsym).fill(0);
        for (let i = 0; i < nsym; i++) for (let k = 0; k <= i && k < C.length; k++) omega[i] ^= gmul(synd[i - k], C[k] || 0);
        const out = msg.slice();
        for (const j of positions) {
            const p = n - 1 - j, X = EXP[p], Xinv = EXP[(255 - p) % 255];
            let num = 0; for (let i = nsym - 1; i >= 0; i--) num = gmul(num, Xinv) ^ omega[i];
            let den = 0; for (let i = 1; i < C.length; i += 2) den ^= gmul(C[i] || 0, gpow(Xinv, i - 1));
            if (!den) return null;
            out[j] ^= gmul(X, gdiv(num, den));
        }
        for (let i = 0; i < nsym; i++) if (evalAt(out, EXP[i])) return null;   // verify
        return out;
    }

    // ------------------------------------------------------------------ symbol structure
    // Error-correction tables [L, M, Q, H] indexed by version (1–40).
    const ECC_PER_BLOCK = [
        [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
        [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
        [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
        [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
    ];
    const NUM_BLOCKS = [
        [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
        [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
        [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
        [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
    ];
    const EC_NAMES = ['L', 'M', 'Q', 'H'];
    const FORMAT_EC_BITS_TO_INDEX = { 1: 0, 0: 1, 3: 2, 2: 3 };   // format bits → [L, M, Q, H] index

    function alignmentPositions(ver) {
        if (ver === 1) return [];
        const num = Math.floor(ver / 7) + 2, size = ver * 4 + 17;
        const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (num * 2 - 2)) * 2;
        const result = [6];
        for (let pos = size - 7; result.length < num; pos -= step) result.splice(1, 0, pos);
        return result;
    }

    function rawDataModules(ver) {
        let r = (16 * ver + 128) * ver + 64;
        if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
        return r;
    }

    function functionMask(ver) {
        const size = ver * 4 + 17;
        const f = Array.from({ length: size }, () => new Uint8Array(size));
        const mark = (x, y) => { if (x >= 0 && x < size && y >= 0 && y < size) f[y][x] = 1; };
        for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
        for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
            for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) mark(cx + dx, cy + dy);
        }
        const ap = alignmentPositions(ver);
        for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) {
            if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(ap[i] + dx, ap[j] + dy);
        }
        for (let i = 0; i <= 8; i++) { mark(8, i); mark(i, 8); }
        for (let i = 0; i < 8; i++) { mark(size - 1 - i, 8); mark(8, size - 1 - i); }
        if (ver >= 7) for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), b = Math.floor(i / 3); mark(a, b); mark(b, a); }
        return f;
    }

    const FORMAT_WORDS = (() => {
        const words = [];
        for (let data = 0; data < 32; data++) {
            let rem = data;
            for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
            words.push({ data, word: ((data << 10) | rem) ^ 0x5412 });
        }
        return words;
    })();
    const VERSION_WORDS = (() => {
        const words = [];
        for (let v = 7; v <= 40; v++) {
            let rem = v;
            for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
            words.push({ v, word: (v << 12) | rem });
        }
        return words;
    })();
    const popcount = (x) => { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; };
    const nearest = (words, bits, key) => {
        let best = null, bestD = 99;
        for (const w of words) { const d = popcount(w.word ^ bits); if (d < bestD) { bestD = d; best = w[key]; } }
        return { value: best, distance: bestD };
    };

    const MASKS = [
        (x, y) => (x + y) % 2 === 0,
        (x, y) => y % 2 === 0,
        (x, y) => x % 3 === 0,
        (x, y) => (x + y) % 3 === 0,
        (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
        (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
        (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
        (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
    ];

    // grid[y][x] = 1 for dark. Returns { text, version, ecLevel } or null.
    function decodeGrid(grid) {
        const size = grid.length;
        if ((size - 17) % 4 !== 0 || size < 21 || size > 177) return null;
        let ver = (size - 17) / 4;
        const g = (x, y) => grid[y][x];

        // format info: both copies, take the best match
        let f1 = 0, f2 = 0;
        for (let i = 0; i <= 5; i++) f1 |= g(8, i) << i;
        f1 |= g(8, 7) << 6; f1 |= g(8, 8) << 7; f1 |= g(7, 8) << 8;
        for (let i = 9; i < 15; i++) f1 |= g(14 - i, 8) << i;
        for (let i = 0; i < 8; i++) f2 |= g(size - 1 - i, 8) << i;
        for (let i = 8; i < 15; i++) f2 |= g(8, size - 15 + i) << i;
        const a = nearest(FORMAT_WORDS, f1, 'data'), b = nearest(FORMAT_WORDS, f2, 'data');
        const fmt = a.distance <= b.distance ? a : b;
        if (fmt.distance > 3) return null;
        const ecIndex = FORMAT_EC_BITS_TO_INDEX[fmt.value >> 3];
        const mask = MASKS[fmt.value & 7];

        if (ver >= 7) {
            let v1 = 0, v2 = 0;
            for (let i = 0; i < 18; i++) { const p = size - 11 + (i % 3), q = Math.floor(i / 3); v1 |= g(p, q) << i; v2 |= g(q, p) << i; }
            const va = nearest(VERSION_WORDS, v1, 'v'), vb = nearest(VERSION_WORDS, v2, 'v');
            const best = va.distance <= vb.distance ? va : vb;
            if (best.distance <= 3 && best.value !== ver) return null;   // caller retries other sizes
        }

        // read codewords in zig-zag order
        const isFn = functionMask(ver);
        const rawCodewords = Math.floor(rawDataModules(ver) / 8);
        const bytes = new Uint8Array(rawCodewords);
        let bit = 0;
        for (let right = size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (let vert = 0; vert < size; vert++) {
                for (let j = 0; j < 2; j++) {
                    const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
                    if (isFn[y][x] || bit >= rawCodewords * 8) continue;
                    let v = g(x, y);
                    if (mask(x, y)) v ^= 1;
                    if (v) bytes[bit >>> 3] |= 0x80 >>> (bit & 7);
                    bit++;
                }
            }
        }

        // de-interleave, correct, concatenate data
        const numBlocks = NUM_BLOCKS[ecIndex][ver], eccLen = ECC_PER_BLOCK[ecIndex][ver];
        const numShort = numBlocks - (rawCodewords % numBlocks), shortLen = Math.floor(rawCodewords / numBlocks);
        const blocks = Array.from({ length: numBlocks }, () => new Array(shortLen + 1).fill(0));
        let k = 0;
        for (let i = 0; i < shortLen + 1; i++) {
            for (let j = 0; j < numBlocks; j++) {
                if (i === shortLen - eccLen && j < numShort) continue;      // short blocks have no byte here
                blocks[j][i] = bytes[k++];
            }
        }
        const data = [];
        for (let j = 0; j < numBlocks; j++) {
            let blk = blocks[j];
            if (j < numShort) blk = blk.slice(0, shortLen - eccLen).concat(blk.slice(shortLen - eccLen + 1));
            const fixed = rsCorrect(blk, eccLen);
            if (!fixed) return null;
            for (let i = 0; i < fixed.length - eccLen; i++) data.push(fixed[i]);
        }
        const text = decodeSegments(data, ver);
        return text === null ? null : { text, version: ver, ecLevel: EC_NAMES[ecIndex] };
    }

    const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
    function decodeSegments(data, ver) {
        let pos = 0;
        const total = data.length * 8;
        const read = (n) => {
            if (pos + n > total) throw new Error('eof');
            let v = 0;
            for (let i = 0; i < n; i++, pos++) v = (v << 1) | ((data[pos >>> 3] >>> (7 - (pos & 7))) & 1);
            return v;
        };
        const group = ver <= 9 ? 0 : ver <= 26 ? 1 : 2;
        let out = '';
        let bytes = [];
        const flushBytes = () => {
            if (!bytes.length) return;
            const arr = new Uint8Array(bytes);
            try { out += new TextDecoder('utf-8', { fatal: true }).decode(arr); }
            catch (e) { out += Array.from(arr, c => String.fromCharCode(c)).join(''); }   // ISO-8859-1
            bytes = [];
        };
        try {
            while (pos + 4 <= total) {
                const mode = read(4);
                if (mode === 0) break;
                if (mode === 1) {
                    flushBytes();
                    let n = read([10, 12, 14][group]);
                    while (n >= 3) { out += String(read(10)).padStart(3, '0'); n -= 3; }
                    if (n === 2) out += String(read(7)).padStart(2, '0'); else if (n === 1) out += String(read(4));
                } else if (mode === 2) {
                    flushBytes();
                    let n = read([9, 11, 13][group]);
                    while (n >= 2) { const v = read(11); out += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; n -= 2; }
                    if (n === 1) out += ALNUM[read(6)];
                } else if (mode === 4) {
                    const n = read([8, 16, 16][group]);
                    for (let i = 0; i < n; i++) bytes.push(read(8));
                } else if (mode === 8) {
                    flushBytes();
                    const n = read([8, 10, 12][group]);
                    const sjis = [];
                    for (let i = 0; i < n; i++) {
                        let v = read(13);
                        v = Math.floor(v / 0xC0) << 8 | (v % 0xC0);
                        v += v < 0x1F00 ? 0x8140 : 0xC140;
                        sjis.push(v >> 8, v & 0xFF);
                    }
                    try { out += new TextDecoder('shift_jis').decode(new Uint8Array(sjis)); } catch (e) { /* skip */ }
                } else if (mode === 7) {                // ECI designator: 1–3 bytes
                    const first = read(8);
                    if ((first & 0x80) !== 0) read((first & 0x40) === 0 ? 8 : 16);
                } else if (mode === 3) { read(16); }    // structured append header
                else if (mode === 5) { /* FNC1 first position */ }
                else if (mode === 9) { read(8); }       // FNC1 second position
                else break;
            }
        } catch (e) { /* ran out of bits: keep what was decoded */ }
        flushBytes();
        return out.length ? out : null;
    }

    // ------------------------------------------------------------------ image processing
    function toGray(rgba, w, h) {
        const g = new Uint8Array(w * h);
        for (let i = 0, j = 0; i < g.length; i++, j += 4) {
            const a = rgba[j + 3] / 255;   // transparent pixels count as white background
            g[i] = Math.round((0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) * a + 255 * (1 - a));
        }
        return g;
    }

    // Local thresholds over 8×8 blocks (5×5 block neighborhood), like ZXing's HybridBinarizer.
    function binarizeLocal(gray, w, h) {
        const B = 8, bw = Math.ceil(w / B), bh = Math.ceil(h / B);
        const black = new Float32Array(bw * bh);
        for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
            let sum = 0, mn = 255, mx = 0, n = 0;
            for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) {
                const v = gray[y * w + x]; sum += v; n++; if (v < mn) mn = v; if (v > mx) mx = v;
            }
            let avg = sum / n;
            if (mx - mn <= 24) {
                avg = mn / 2;
                if (by > 0 && bx > 0) {
                    const nb = (black[(by - 1) * bw + bx] + 2 * black[by * bw + bx - 1] + black[(by - 1) * bw + bx - 1]) / 4;
                    if (mn < nb) avg = nb;
                }
            }
            black[by * bw + bx] = avg;
        }
        const out = new Uint8Array(w * h);
        for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
            let sum = 0, n = 0;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
                const yy = Math.min(bh - 1, Math.max(0, by + dy)), xx = Math.min(bw - 1, Math.max(0, bx + dx));
                sum += black[yy * bw + xx]; n++;
            }
            const t = sum / n;
            for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) {
                out[y * w + x] = gray[y * w + x] <= t ? 1 : 0;
            }
        }
        return out;
    }

    function binarizeGlobal(gray) {
        const hist = new Uint32Array(256);
        for (const v of gray) hist[v]++;
        let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
        let sumB = 0, wB = 0, best = 0, t = 128;
        for (let i = 0; i < 256; i++) {
            wB += hist[i]; if (!wB) continue;
            const wF = gray.length - wB; if (!wF) break;
            sumB += i * hist[i];
            const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
            if (between > best) { best = between; t = i; }
        }
        const out = new Uint8Array(gray.length);
        for (let i = 0; i < gray.length; i++) out[i] = gray[i] <= t ? 1 : 0;
        return out;
    }

    // ------------------------------------------------------------------ finder patterns
    function ratioOK(c) {
        const total = c[0] + c[1] + c[2] + c[3] + c[4];
        if (total < 7) return false;
        const m = total / 7, tol = m * 0.6;
        return Math.abs(m - c[0]) < tol && Math.abs(m - c[1]) < tol && Math.abs(3 * m - c[2]) < 3 * tol &&
               Math.abs(m - c[3]) < tol && Math.abs(m - c[4]) < tol;
    }

    // Counts dark/light/dark/light/dark runs through (cx, cy) along direction (dx, dy). Returns the
    // refined center along that axis and the pattern width, or null if the 1:1:3:1:1 ratio fails.
    function crossCheck(bin, w, h, cx, cy, dx, dy, maxCount) {
        const at = (t) => {
            const x = Math.round(cx + dx * t), y = Math.round(cy + dy * t);
            return x >= 0 && y >= 0 && x < w && y < h ? bin[y * w + x] : -1;
        };
        const c = [0, 0, 0, 0, 0];
        let t = 0;
        while (at(t) === 1) { c[2]++; t--; }
        while (at(t) === 0 && c[1] <= maxCount) { c[1]++; t--; }
        while (at(t) === 1 && c[0] <= maxCount) { c[0]++; t--; }
        t = 1;
        while (at(t) === 1) { c[2]++; t++; }
        while (at(t) === 0 && c[3] <= maxCount) { c[3]++; t++; }
        while (at(t) === 1 && c[4] <= maxCount) { c[4]++; t++; }
        if (!c[2] || !ratioOK(c)) return null;
        const center = t - c[4] - c[3] - c[2] / 2;      // t is the first pixel past the pattern
        return { total: c[0] + c[1] + c[2] + c[3] + c[4], x: cx + dx * center, y: cy + dy * center };
    }

    function findFinders(bin, w, h) {
        const centers = [];
        const step = Math.max(1, Math.floor(h / 600));
        const consider = (c, xEnd, y) => {
            const total = c[0] + c[1] + c[2] + c[3] + c[4];
            const cx = Math.round(xEnd - c[4] - c[3] - c[2] / 2);
            const v = crossCheck(bin, w, h, cx, y, 0, 1, total);
            if (!v || Math.abs(v.total - total) > 0.4 * total) return;
            const hz = crossCheck(bin, w, h, cx, Math.round(v.y), 1, 0, total);
            if (!hz || Math.abs(hz.total - total) > 0.4 * total) return;
            const fx = hz.x, fy = v.y, ms = (hz.total + v.total) / 14;
            const near = centers.find(p => Math.abs(p.x - fx) < ms * 3 && Math.abs(p.y - fy) < ms * 3 && Math.abs(p.ms - ms) < ms * 0.6);
            if (near) {
                near.x = (near.x * near.n + fx) / (near.n + 1);
                near.y = (near.y * near.n + fy) / (near.n + 1);
                near.ms = (near.ms * near.n + ms) / (near.n + 1);
                near.n++;
            } else {
                centers.push({ x: fx, y: fy, ms, n: 1 });
            }
        };
        for (let y = 0; y < h; y += step) {
            const c = [0, 0, 0, 0, 0];
            let state = 0;
            for (let x = 0; x < w; x++) {
                if (bin[y * w + x]) {                       // dark
                    if (state & 1) state++;
                    c[state]++;
                } else if (!(state & 1)) {                  // light while counting a dark run
                    if (state === 4) {
                        if (ratioOK(c)) consider(c, x, y);
                        c[0] = c[2]; c[1] = c[3]; c[2] = c[4]; c[3] = 1; c[4] = 0; state = 3;
                    } else {
                        state++;
                        c[state]++;
                    }
                } else {
                    c[state]++;
                }
            }
            if (state === 4 && ratioOK(c)) consider(c, w, y);
        }
        return centers;
    }

    function chooseTriple(centers) {
        const cand = centers.slice().sort((a, b) => b.n - a.n).slice(0, 12);
        const triples = [];
        for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) for (let k = j + 1; k < cand.length; k++) {
            const p = [cand[i], cand[j], cand[k]];
            const msMax = Math.max(...p.map(q => q.ms)), msMin = Math.min(...p.map(q => q.ms));
            if (msMax / msMin > 1.5) continue;
            const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
            const sides = [[d(p[1], p[2]), 0], [d(p[0], p[2]), 1], [d(p[0], p[1]), 2]].sort((a, b) => a[0] - b[0]);
            const [s1, s2, s3] = sides;
            if (s1[0] < msMin * 7) continue;
            const legs = Math.abs(s1[0] - s2[0]) / s2[0], hyp = Math.abs(s3[0] - Math.hypot(s1[0], s2[0])) / s3[0];
            if (legs > 0.25 || hyp > 0.15) continue;
            triples.push({ score: legs + hyp + (msMax / msMin - 1) - Math.min(p[0].n + p[1].n + p[2].n, 30) / 300, tl: p[s3[1]], others: p.filter((_, idx) => idx !== s3[1]) });
        }
        triples.sort((a, b) => a.score - b.score);
        return triples.slice(0, 3).map(t => {
            const [p1, p2] = t.others, tl = t.tl;
            const cross = (p1.x - tl.x) * (p2.y - tl.y) - (p1.y - tl.y) * (p2.x - tl.x);
            return cross > 0 ? { tl, tr: p1, bl: p2 } : { tl, tr: p2, bl: p1 };
        });
    }

    // ------------------------------------------------------------------ geometry
    // Perspective transform mapping the unit square to a quadrilateral (and its inverse), as in ZXing.
    function squareToQuad(x0, y0, x1, y1, x2, y2, x3, y3) {
        const dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3;
        if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
            return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
        }
        const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
        const den = dx1 * dy2 - dx2 * dy1;
        const a13 = (dx3 * dy2 - dx2 * dy3) / den, a23 = (dx1 * dy3 - dx3 * dy1) / den;
        return [x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0, y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0, a13, a23, 1];
    }
    function adjoint(m) {
        const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = m;
        return [a22 * a33 - a23 * a32, a23 * a31 - a21 * a33, a21 * a32 - a22 * a31,
                a13 * a32 - a12 * a33, a11 * a33 - a13 * a31, a12 * a31 - a11 * a32,
                a12 * a23 - a13 * a22, a13 * a21 - a11 * a23, a11 * a22 - a12 * a21];
    }
    function times(a, b) {
        const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = a, [b11, b21, b31, b12, b22, b32, b13, b23, b33] = b;
        return [a11 * b11 + a21 * b12 + a31 * b13, a11 * b21 + a21 * b22 + a31 * b23, a11 * b31 + a21 * b32 + a31 * b33,
                a12 * b11 + a22 * b12 + a32 * b13, a12 * b21 + a22 * b22 + a32 * b23, a12 * b31 + a22 * b32 + a32 * b33,
                a13 * b11 + a23 * b12 + a33 * b13, a13 * b21 + a23 * b22 + a33 * b23, a13 * b31 + a23 * b32 + a33 * b33];
    }
    function quadToQuad(src, dst) {
        const qToS = adjoint(squareToQuad(...src));
        const sToQ = squareToQuad(...dst);
        return times(sToQ, qToS);
    }
    function apply(m, x, y) {
        const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = m;
        const den = a13 * x + a23 * y + a33;
        return [(a11 * x + a21 * y + a31) / den, (a12 * x + a22 * y + a32) / den];
    }

    function findAlignment(bin, w, h, est, ux, uy) {
        // Template match of the 5×5 alignment pattern around the estimate, using the module axes.
        const at = (x, y) => { const xi = Math.round(x), yi = Math.round(y); return xi >= 0 && yi >= 0 && xi < w && yi < h ? bin[yi * w + xi] : 0; };
        const ms = Math.hypot(ux[0], ux[1]);
        const radius = Math.ceil(ms * 6);
        let best = null, bestScore = 0;
        for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
            const cx = est[0] + ox, cy = est[1] + oy;
            let score = 0;
            for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
                const want = Math.max(Math.abs(i), Math.abs(j)) === 1 ? 0 : 1;
                if (at(cx + i * ux[0] + j * uy[0], cy + i * ux[1] + j * uy[1]) === want) score++;
            }
            const s = score - Math.hypot(ox, oy) / (radius * 4);
            if (s > bestScore) { bestScore = s; best = [cx, cy]; }
        }
        return bestScore >= 21 ? best : null;
    }

    function sampleGrid(bin, w, h, tl, tr, bl, dim, align) {
        const br = align
            ? { gx: dim - 6.5, gy: dim - 6.5, x: align[0], y: align[1] }
            : { gx: dim - 3.5, gy: dim - 3.5, x: tr.x + bl.x - tl.x, y: tr.y + bl.y - tl.y };
        const t = quadToQuad([3.5, 3.5, dim - 3.5, 3.5, br.gx, br.gy, 3.5, dim - 3.5],
                             [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
        const grid = [];
        for (let y = 0; y < dim; y++) {
            const row = new Uint8Array(dim);
            for (let x = 0; x < dim; x++) {
                const [px, py] = apply(t, x + 0.5, y + 0.5);
                const xi = Math.round(px), yi = Math.round(py);
                row[x] = xi >= 0 && yi >= 0 && xi < w && yi < h ? bin[yi * w + xi] : 0;
            }
            grid.push(row);
        }
        return grid;
    }

    let finderHint = 0;   // most finder candidates seen in the current decode() call
    function tryLocate(bin, w, h) {
        const centers = findFinders(bin, w, h);
        finderHint = Math.max(finderHint, centers.length);
        if (centers.length < 3) return null;
        for (const { tl, tr, bl } of chooseTriple(centers)) {
            const ms = (tl.ms + tr.ms + bl.ms) / 3;
            const est = Math.round((Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(bl.x - tl.x, bl.y - tl.y)) / 2 / ms) + 7;
            let base = est;
            switch (est & 3) { case 0: base++; break; case 2: base--; break; case 3: base -= 2; break; }
            for (const dim of [base, base + 4, base - 4, base + 8, base - 8]) {
                if (dim < 21 || dim > 177) continue;
                const ver = (dim - 17) / 4;
                const span = dim - 7;
                const ux = [(tr.x - tl.x) / span, (tr.y - tl.y) / span], uy = [(bl.x - tl.x) / span, (bl.y - tl.y) / span];
                let align = null;
                if (ver >= 2) {
                    const corr = 1 - 3 / span;
                    const brx = tr.x - tl.x + bl.x, bry = tr.y - tl.y + bl.y;
                    align = findAlignment(bin, w, h, [tl.x + corr * (brx - tl.x), tl.y + corr * (bry - tl.y)], ux, uy);
                }
                for (const a of align ? [align, null] : [null]) {
                    const grid = sampleGrid(bin, w, h, tl, tr, bl, dim, a);
                    const r = decodeGrid(grid);
                    if (r) return r;
                    // a mirrored symbol (transposed reading) as a last resort
                    const tg = grid.map((_, y) => Uint8Array.from(grid, row => row[y]));
                    const rt = decodeGrid(tg);
                    if (rt) return rt;
                }
            }
        }
        return null;
    }

    // Public entry point. Very large images are scaled down (by area averaging, which preserves fine
    // modules far better than skipping pixels) to keep CPU use bounded.
    function decode(rgba, width, height) {
        const MAX = 2000;
        let w = width, h = height, px = rgba;
        if (Math.max(w, h) > MAX) {
            const s = MAX / Math.max(w, h), nw = Math.round(w * s), nh = Math.round(h * s);
            const out = new Uint8ClampedArray(nw * nh * 4);
            for (let y = 0; y < nh; y++) {
                const y0 = Math.floor(y / s), y1 = Math.min(h, Math.max(y0 + 1, Math.floor((y + 1) / s)));
                for (let x = 0; x < nw; x++) {
                    const x0 = Math.floor(x / s), x1 = Math.min(w, Math.max(x0 + 1, Math.floor((x + 1) / s)));
                    let r = 0, g = 0, b = 0, a = 0, n = 0;
                    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
                        const i = (yy * w + xx) * 4; r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3]; n++;
                    }
                    const d = (y * nw + x) * 4;
                    out[d] = r / n; out[d + 1] = g / n; out[d + 2] = b / n; out[d + 3] = a / n;
                }
            }
            px = out; w = nw; h = nh;
        }
        finderHint = 0;
        const first = decodeAt(px, w, h);
        if (first) return first;
        if (finderHint < 2) return null;     // nothing QR-like at all: don't spend time on an enlarged retry
        // Second chance: small or finely printed codes decode far more reliably when enlarged
        // (bilinear), because each module then spans several pixels.
        const k = Math.min(2, MAX / Math.max(w, h));
        if (k >= 1.3) {
            const nw = Math.round(w * k), nh = Math.round(h * k);
            return decodeAt(upscale(px, w, h, nw, nh), nw, nh);
        }
        return null;
    }

    function decodeAt(px, w, h) {
        const gray = toGray(px, w, h);
        for (const bin of [binarizeLocal(gray, w, h), binarizeGlobal(gray)]) {
            const r = tryLocate(bin, w, h);
            if (r) return r;
        }
        // light-on-dark codes
        const inv = binarizeGlobal(gray).map(v => 1 - v);
        return tryLocate(inv, w, h);
    }

    function upscale(px, w, h, nw, nh) {
        const out = new Uint8ClampedArray(nw * nh * 4);
        const sx = (w - 1) / Math.max(1, nw - 1), sy = (h - 1) / Math.max(1, nh - 1);
        for (let y = 0; y < nh; y++) {
            const fy = y * sy, y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
            for (let x = 0; x < nw; x++) {
                const fx = x * sx, x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
                const d = (y * nw + x) * 4;
                for (let c = 0; c < 4; c++) {
                    const a = px[(y0 * w + x0) * 4 + c], b = px[(y0 * w + x1) * 4 + c];
                    const cc = px[(y1 * w + x0) * 4 + c], dd = px[(y1 * w + x1) * 4 + c];
                    out[d + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + dd * tx) * ty;
                }
            }
        }
        return out;
    }

    return { decode, decodeGrid, _internal: { rsCorrect, alignmentPositions, rawDataModules, functionMask } };
})();

if (typeof module !== 'undefined') module.exports = QRDecoder;
