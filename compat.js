// compat.js — shims for recent JavaScript features used by pdf.js 5 that Firefox 140 ESR lacks, loaded
// in the background page before pdf.js. Each one only applies when the browser doesn't already provide it.
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
})();
