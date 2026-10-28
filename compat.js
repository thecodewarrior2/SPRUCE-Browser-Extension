// compat.js — small shims for recent JavaScript features used by pdf.js 5, loaded in the scanner
// document before pdf.js. Each one only applies when the browser doesn't already provide it.
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
})();
