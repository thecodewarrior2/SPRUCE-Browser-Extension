// compat.js — small shims for recent JavaScript features used by pdf.js 5, loaded before pdf.js wherever
// the scanner runs (Chrome's offscreen document scanner.html; the background page in Firefox and Safari).
// Each one only applies when the browser doesn't already provide it, so each browser gets only what it
// lacks (for example the Map methods before Chrome 145 and Firefox 144, the stream reader before Safari 27).
(() => {
    'use strict';
    for (const C of [Map, WeakMap]) {
        if (!C.prototype.getOrInsert) {
            Object.defineProperty(C.prototype, 'getOrInsert', { configurable: true, writable: true, value(key, value) {
                if (!this.has(key)) this.set(key, value);
                return this.get(key);
            } });
        }
        if (!C.prototype.getOrInsertComputed) {
            Object.defineProperty(C.prototype, 'getOrInsertComputed', { configurable: true, writable: true, value(key, fn) {
                if (!this.has(key)) this.set(key, fn(key));
                return this.get(key);
            } });
        }
    }
    if (!Promise.withResolvers) {
        Promise.withResolvers = function () { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
    }
    if (!Uint8Array.prototype.toHex) {
        Object.defineProperty(Uint8Array.prototype, 'toHex', { configurable: true, writable: true, value() {
            return Array.from(this, b => b.toString(16).padStart(2, '0')).join('');
        } });
    }
    if (!Uint8Array.prototype.toBase64) {
        Object.defineProperty(Uint8Array.prototype, 'toBase64', { configurable: true, writable: true, value() {
            let s = ''; for (let i = 0; i < this.length; i += 0x8000) s += String.fromCharCode.apply(null, this.subarray(i, i + 0x8000)); return btoa(s);
        } });
    }
    if (!Uint8Array.fromBase64) {
        Uint8Array.fromBase64 = (str) => Uint8Array.from(atob(String(str).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    }
    if (!Uint8Array.fromHex) {
        Uint8Array.fromHex = (str) => Uint8Array.from(String(str).match(/../g) || [], h => parseInt(h, 16));
    }
    if (!ArrayBuffer.prototype.transferToFixedLength) {
        Object.defineProperty(ArrayBuffer.prototype, 'transferToFixedLength', { configurable: true, writable: true, value(len) {
            return this.slice(0, len === undefined ? this.byteLength : len);
        } });
    }
    if (!Math.sumPrecise) Math.sumPrecise = (it) => { let s = 0; for (const v of it) s += v; return s; };
    // Reading a stream with for await…of (pdf.js does this with DecompressionStream's output; Safari).
    if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
        const values = async function* ({ preventCancel = false } = {}) {
            const reader = this.getReader();
            let finished = false;
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) { finished = true; return; }
                    yield value;
                }
            } finally {
                if (!finished && !preventCancel) await reader.cancel().catch(() => {});
                reader.releaseLock();
            }
        };
        Object.defineProperty(ReadableStream.prototype, 'values', { configurable: true, writable: true, value: values });
        Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, { configurable: true, writable: true, value: values });
    }
})();
