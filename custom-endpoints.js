// custom-endpoints.js — talks to the CUSTOM THREAT RESOLVER and CUSTOM UNSHORTENER that a user or
// administrator configures in Settings → Your own services (or by policy). Pure functions only, so
// every format can be tested without a browser. Loaded by the background page.
//
// Placeholders, usable in the endpoint address and in the request body:
//   {hostname}      the link's host only, e.g. example.com          (threat resolver and unshortener)
//   {url}           the full link                                   (threat resolver and unshortener)
//   {url_noscheme}  the full link without "https://" (Bitly style)  (unshortener)
// In the endpoint address every value is percent-encoded. In a body that starts with "{" or "["
// it is inserted JSON-escaped (write the quotes yourself: "url":"{url}"); in any other body it is
// form-encoded (host={hostname}).

// "Name: value" lines => headers object. Lines without a colon are ignored.
function parseHeaderLines(text) {
    const headers = {};
    String(text || '').split(/\r?\n/).forEach(line => {
        const i = line.indexOf(':');
        if (i < 1) return;
        const name = line.slice(0, i).trim();
        const value = line.slice(i + 1).trim();
        if (/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) headers[name] = value;
    });
    return headers;
}

function fillTemplate(template, vars, escape) {
    return String(template || '').replace(/\{(hostname|url|url_noscheme)\}/g, (m, key) =>
        vars[key] === undefined ? m : escape(vars[key]));
}

const jsonEscape = (v) => JSON.stringify(String(v)).slice(1, -1);

// conf: { endpoint, method, body, headers }  vars: { hostname, url, url_noscheme }
// legacyDoh: a GET address with no placeholder gets "?name=<host>&type=A" appended (how the
// threat resolver has always worked, so existing DoH endpoints keep working).
// Returns { url, init } for fetch(), or null if the endpoint is not a usable https:// address.
function buildCustomRequest(conf, vars, legacyDoh = false) {
    const endpoint = String(conf.endpoint || '').trim();
    if (!/^https:\/\//i.test(endpoint)) return null;
    const method = conf.method === 'POST' ? 'POST' : 'GET';
    let url = fillTemplate(endpoint, vars, encodeURIComponent);
    const usesPlaceholder = /\{(hostname|url|url_noscheme)\}/.test(endpoint);
    if (legacyDoh && method === 'GET' && !usesPlaceholder && vars.hostname) {
        url += (url.includes('?') ? '&' : '?') + `name=${encodeURIComponent(vars.hostname)}&type=A`;
    }
    try { new URL(url); } catch (e) { return null; }

    const headers = Object.assign({ 'Accept': 'application/json, application/dns-json;q=0.9, */*;q=0.5' }, parseHeaderLines(conf.headers));
    const init = { method, headers };
    if (method === 'POST') {
        const bodyTemplate = String(conf.body || '');
        const isJson = /^\s*[{[]/.test(bodyTemplate);
        init.body = fillTemplate(bodyTemplate, vars, isJson ? jsonEscape : encodeURIComponent);
        const hasType = Object.keys(headers).some(h => h.toLowerCase() === 'content-type');
        if (!hasType) headers['Content-Type'] = isJson ? 'application/json' : 'application/x-www-form-urlencoded';
    }
    return { url, init };
}

// Reads "a.b.c" (and "a.0.b" for arrays) from an object. Returns undefined if any part is missing.
function readPath(obj, path) {
    if (!path) return undefined;
    let cur = obj;
    for (const part of String(path).split('.')) {
        if (cur === null || typeof cur !== 'object' || !(part in cur)) return undefined;
        cur = cur[part];
    }
    return cur;
}

function isFlagValue(v) {
    if (v === undefined || v === null || v === false || v === 0) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    if (typeof v === 'string') return !/^(|0|false|no|none|clean|safe|harmless|ok_clean|no_results|not_found|unknown)$/i.test(v.trim());
    return true;
}

const GENERIC_FLAG_KEYS = ['malicious', 'is_malicious', 'blocked', 'is_blocked', 'unsafe', 'phishing', 'is_phishing', 'listed'];

// Threat-resolver reply => { recognized, blocked, reason }.
// "recognized" matters: an error reply (wrong key, quota exceeded) must count as "no answer",
// never as "checked and clean".
function parseThreatResponse(data, flagField) {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return { recognized: false };

    if (flagField) {
        const v = readPath(data, flagField);
        if (v !== undefined) return { recognized: true, blocked: isFlagValue(v), reason: 'Flagged by Custom Resolver' };
        // The configured field is missing: a clean reply may simply omit it ({} from Safe Browsing),
        // so fall through to the standard formats below.
    }
    // DNS-over-HTTPS (JSON): a sinkhole answer means blocked.
    if (Array.isArray(data.Answer) || typeof data.Status === 'number') {
        const blocked = Array.isArray(data.Answer) && data.Answer.some(r => {
            const d = String(r && r.data);
            return d === '0.0.0.0' || d === '127.0.0.1' || d === '::' || /block/i.test(d);
        });
        return { recognized: true, blocked, reason: 'Blocked by Custom Resolver' };
    }
    // Google Safe Browsing (v4 threatMatches:find): { matches: [{ threatType }] } when listed, {} when clean.
    if (Array.isArray(data.matches)) {
        const types = data.matches.map(m => m && m.threatType).filter(Boolean);
        return { recognized: true, blocked: data.matches.length > 0, reason: googleThreatReason('Google Safe Browsing', types) };
    }
    // Google Web Risk (v1 uris:search): { threat: { threatTypes: [...] } } when listed, {} when clean.
    if (data.threat && typeof data.threat === 'object') {
        const types = Array.isArray(data.threat.threatTypes) ? data.threat.threatTypes : [];
        return { recognized: true, blocked: true, reason: googleThreatReason('Google Web Risk', types) };
    }
    // URLhaus (abuse.ch): query_status "ok" = known malicious host/URL, "no_results" = not listed.
    if (typeof data.query_status === 'string') {
        if (data.query_status === 'ok') return { recognized: true, blocked: true, reason: 'Listed by URLhaus (Custom Threat API)' };
        if (/^(no_results|not_found)$/i.test(data.query_status)) return { recognized: true, blocked: false };
        return { recognized: false };   // e.g. "invalid_host", "unknown_auth_key"
    }
    // Simple APIs: { "malicious": true } and similar.
    for (const k of GENERIC_FLAG_KEYS) {
        if (k in data) return { recognized: true, blocked: isFlagValue(data[k]), reason: 'Flagged by Custom Threat API' };
    }
    // An empty object is how Safe Browsing reports "clean".
    if (Object.keys(data).length === 0) return { recognized: true, blocked: false };
    return { recognized: false };
}

// "Phishing (Google Web Risk)" from Google's threat-type codes.
function googleThreatReason(service, types) {
    const names = { SOCIAL_ENGINEERING: 'Phishing', MALWARE: 'Malware', UNWANTED_SOFTWARE: 'Unwanted software',
                    POTENTIALLY_HARMFUL_APPLICATION: 'Harmful app', SOCIAL_ENGINEERING_EXTENDED_COVERAGE: 'Phishing' };
    const label = [...new Set(types.map(t => names[t] || String(t).toLowerCase().replace(/_/g, ' ')))].join(', ');
    return `${label || 'Flagged'} (${service})`;
}

// Fields an unshortening API commonly uses for the destination, most specific first. "url" is
// last because many APIs echo the requested link in it.
const UNSHORTEN_FIELDS = ['resolved_url', 'final_url', 'long_url', 'longUrl', 'expanded_url', 'unshortened_url',
    'destination_url', 'destination', 'redirect_url', 'location', 'target_url', 'target', 'end_url', 'url'];

// Unshortener reply => destination URL or null. Accepts JSON (configured field, or the common
// fields above, at the top level or one level down, e.g. data.long_url) or a plain-text URL.
function parseUnshortenResponse(text, field, requestedUrl) {
    const usable = (v) => typeof v === 'string' && /^https?:\/\//i.test(v.trim()) && v.trim() !== requestedUrl
        ? v.trim() : null;
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (data === null) return usable(String(text || '').trim().split(/\s/)[0]);
    if (typeof data === 'string') return usable(data);
    if (typeof data !== 'object') return null;
    if (field) return usable(readPath(data, field));
    const layers = [data, ...Object.values(data).filter(v => v && typeof v === 'object' && !Array.isArray(v))];
    for (const layer of layers) {
        for (const f of UNSHORTEN_FIELDS) {
            const v = usable(layer[f]);
            if (v) return v;
        }
    }
    return null;
}
