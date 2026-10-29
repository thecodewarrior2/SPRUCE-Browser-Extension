// scanner.js — runs in the background page (background.html). Decodes QR codes in images and PDF
// attachments, and lists the links inside PDFs. Everything happens on this device: images come either
// as bytes from the Gmail tab or from Google's image proxy (never from the sender's own server).
import * as pdfjsLib from './lib/pdf.min.mjs';
// The background page is already separate from Gmail, so pdf.js runs here directly instead of
// starting a worker. Loading pdf.js's worker code into this page makes pdf.js use it in place.
import './lib/pdf.worker.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.mjs');

const MAX_SIDE = 2000;          // pixels: larger images and pages are scaled down
const MAX_PDF_PAGES = 10;
const MAX_BYTES = 10 * 1024 * 1024;

function canvasFor(w, h) {
    const s = Math.min(1, MAX_SIDE / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    return c;
}

function decodeCanvas(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const r = QRDecoder.decode(img.data, canvas.width, canvas.height);
    return r ? [r.text] : [];
}

async function scanImage(blob) {
    const bmp = await createImageBitmap(blob);
    const c = canvasFor(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return { codes: decodeCanvas(c).map(text => ({ text })), links: [] };
}

async function scanPdf(bytes) {
    // verbosity ERRORS: pdf.js otherwise prints routine notices as warnings in the extension's console:
    // "Setting up fake worker" (by design, see the import above) and "Indexing all PDF objects" (a PDF
    // with a damaged index, which pdf.js repairs). Real errors still surface.
    const pdf = await pdfjsLib.getDocument({
        data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
        verbosity: pdfjsLib.VerbosityLevel.ERRORS
    }).promise;
    const codes = [], links = [];
    const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
    for (let i = 1; i <= pages; i++) {
        const page = await pdf.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(3, 1600 / Math.max(base.width, base.height)) });
        const c = document.createElement('canvas');
        c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
        // intent 'print': pdf.js then draws without requestAnimationFrame, which never fires in the
        // (hidden) background page and would leave rendering waiting forever.
        await page.render({ canvasContext: c.getContext('2d'), viewport, intent: 'print' }).promise;
        for (const text of decodeCanvas(c)) codes.push({ text, page: i });
        for (const a of await page.getAnnotations()) if (a.subtype === 'Link' && a.url && !links.some(l => l.url === a.url)) links.push({ url: a.url, page: i });
        page.cleanup();
        c.width = c.height = 0;                       // release the page bitmap
    }
    const total = pdf.numPages;
    await pdf.destroy();
    return { codes, links, pagesScanned: pages, pagesTotal: total };
}

async function scan(msg) {
    let bytes, mime = msg.mime || '';
    if (msg.url) {
        const res = await fetch(msg.url, { credentials: 'omit' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (blob.size > MAX_BYTES) throw new Error('file too large');
        mime = mime || blob.type;
        bytes = new Uint8Array(await blob.arrayBuffer());
    } else {
        bytes = Uint8Array.from(atob(msg.b64 || ''), c => c.charCodeAt(0));
    }
    const isPdf = /pdf/i.test(mime) || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
    const result = isPdf ? await scanPdf(bytes) : await scanImage(new Blob([bytes], { type: mime || 'image/png' }));
    return Object.assign({ ok: true, kind: isPdf ? 'pdf' : 'image' }, result);
}

// background.js defines registerLocalScanner and calls this for every scan.
globalThis.registerLocalScanner((msg) => scan(msg).catch((e) => ({ ok: false, error: String((e && e.message) || e) })));
