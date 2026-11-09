// docx-reader.js — [5.95-2] reads a Word document (.docx, .docm: a ZIP archive of XML files and pictures)
// on this device, for the attachment scanner (scanner.js): the web links it holds and its pictures,
// which are then searched for QR codes. Loaded by the scanner's page (scanner.html; background.html in
// Firefox and Safari) before scanner.js. Nothing is run or shown: only the parts named below are
// unpacked, each with a size limit, so a damaged or booby-trapped file can't use up memory.
'use strict';

const DOCX_LIMITS = Object.freeze({
    entries: 5000,                   // files listed in the archive
    xmlBytes: 5 * 1024 * 1024,       // each XML part, unpacked
    imageBytes: 10 * 1024 * 1024,    // each picture, unpacked
    totalBytes: 40 * 1024 * 1024,    // everything unpacked together
    images: 20,                      // pictures searched for QR codes
    links: 50
});
const DOCX_IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };

// The files in a ZIP archive, from its central directory: [{ name, method, flags, compressedSize, size,
// offset }], or null for something that isn't a ZIP archive this reader handles (ZIP64, split archives).
function docxZipEntries(bytes) {
    const b = bytes, n = b.length;
    const u16 = (p) => b[p] | (b[p + 1] << 8);
    const u32 = (p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
    // End of central directory: 22 bytes, then a comment of up to 65,535 bytes.
    let eocd = -1;
    for (let p = n - 22; p >= Math.max(0, n - 22 - 65535); p--) {
        if (b[p] === 0x50 && b[p + 1] === 0x4B && b[p + 2] === 0x05 && b[p + 3] === 0x06) { eocd = p; break; }
    }
    if (eocd < 0) return null;
    const count = u16(eocd + 10), cdSize = u32(eocd + 12), cdOffset = u32(eocd + 16);
    if (count === 0xFFFF || cdOffset === 0xFFFFFFFF || cdOffset + cdSize > n || count > DOCX_LIMITS.entries) return null;
    const out = [];
    let p = cdOffset;
    const decoder = new TextDecoder();
    for (let i = 0; i < count; i++) {
        if (p + 46 > n || u32(p) !== 0x02014B50) return null;
        const nameLen = u16(p + 28), extraLen = u16(p + 30), commentLen = u16(p + 32);
        if (p + 46 + nameLen > n) return null;
        out.push({ name: decoder.decode(b.subarray(p + 46, p + 46 + nameLen)), flags: u16(p + 8), method: u16(p + 10),
                   compressedSize: u32(p + 20), size: u32(p + 24), offset: u32(p + 42) });
        p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
}

// One file's bytes, unpacked (stored or deflated), or null: encrypted, another packing method, larger
// than `limit` (also when the archive understates the size), or damaged.
async function docxZipRead(bytes, entry, limit) {
    const b = bytes;
    const u16 = (p) => b[p] | (b[p + 1] << 8);
    const u32 = (p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;
    if ((entry.flags & 1) || entry.size > limit) return null;
    const p = entry.offset;
    if (p + 30 > b.length || u32(p) !== 0x04034B50) return null;
    const start = p + 30 + u16(p + 26) + u16(p + 28), end = start + entry.compressedSize;
    if (end > b.length) return null;
    const data = b.subarray(start, end);
    if (entry.method === 0) return data.length <= limit ? data : null;
    if (entry.method !== 8 || typeof DecompressionStream !== 'function') return null;
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > limit) { reader.cancel().catch(() => {}); return null; }
            chunks.push(value);
        }
    } catch (e) { return null; }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
}

function docxXmlText(s) {
    return String(s).replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (m, hex, dec, named) => {
        if (named) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named.toLowerCase()];
        const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
        try { return String.fromCodePoint(cp); } catch (e) { return ''; }
    });
}

// A Word document's web links (the targets of its hyperlinks, in the text, headers, footers and notes,
// and HYPERLINK fields) and its pictures. Returns { links: [url], images: [{ name, type, bytes }],
// imagesTotal }, or null for a file that isn't a Word document.
async function readDocx(bytes) {
    const entries = docxZipEntries(bytes);
    if (!entries || !entries.some(e => e.name === 'word/document.xml')) return null;
    let budget = DOCX_LIMITS.totalBytes;
    const take = async (e, limit) => {
        const data = await docxZipRead(bytes, e, Math.min(limit, budget));
        if (data) budget -= data.length;
        return data;
    };
    const decoder = new TextDecoder();
    const links = [];
    const add = (raw) => {
        const url = docxXmlText(raw).trim();
        if (/^https?:\/\/[^\s"<>]+$/i.test(url) && !links.includes(url) && links.length < DOCX_LIMITS.links) links.push(url);
    };
    for (const e of entries) {
        if (/^word\/_rels\/[^/]+\.xml\.rels$/i.test(e.name)) {
            const data = await take(e, DOCX_LIMITS.xmlBytes);
            if (!data) continue;
            for (const m of decoder.decode(data).matchAll(/<Relationship\b[^>]*>/gi)) {
                if (!/\bType\s*=\s*"[^"]*\/hyperlink"/i.test(m[0])) continue;
                const t = /\bTarget\s*=\s*"([^"]*)"/i.exec(m[0]);
                if (t) add(t[1]);
            }
        } else if (/^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/i.test(e.name)) {
            const data = await take(e, DOCX_LIMITS.xmlBytes);
            if (!data) continue;
            // HYPERLINK fields: the instruction may be split over several pieces of text.
            const xml = decoder.decode(data);
            const fields = [...xml.matchAll(/<w:instrText\b[^>]*>([^<]*)<\/w:instrText>/gi)].map(m => m[1]).join('')
                + ' ' + [...xml.matchAll(/\bw:instr\s*=\s*"([^"]*)"/gi)].map(m => m[1]).join(' ');
            for (const m of docxXmlText(fields).matchAll(/HYPERLINK\s+"([^"]+)"/gi)) add(m[1]);
        }
    }
    const pictures = entries.filter(e => /^word\/media\/[^/]+$/i.test(e.name) && DOCX_IMAGE_TYPES[(e.name.split('.').pop() || '').toLowerCase()]);
    const images = [];
    for (const e of pictures) {
        if (images.length >= DOCX_LIMITS.images) break;
        const data = await take(e, DOCX_LIMITS.imageBytes);
        if (data) images.push({ name: e.name.slice('word/media/'.length), type: DOCX_IMAGE_TYPES[e.name.split('.').pop().toLowerCase()], bytes: data });
    }
    return { links, images, imagesTotal: pictures.length };
}
