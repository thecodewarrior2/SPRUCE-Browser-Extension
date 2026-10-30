// compat.js — shims for recent JavaScript features used by pdf.js 5 that Safari (18.2 and later) lacks,
// loaded in the background page before pdf.js. Each one only applies when the browser doesn't already
// provide it.
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
    // Reading a stream with for await…of (pdf.js does this with DecompressionStream's output).
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
