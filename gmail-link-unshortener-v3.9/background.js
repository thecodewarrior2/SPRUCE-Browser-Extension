self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        if (self.registration.navigationPreload) {
            await self.registration.navigationPreload.disable();
        }
    })());
});

const defaultShorteners = [
    'bit.ly', 't.co', 'tinyurl.com', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly', 
    'rebrand.ly', 'bl.ink', 'rb.gy', 'v.gd', 'j.mp', 'lnkd.in', 'db.tt', 
    'qr.ae', 'snip.ly', 'adf.ly', 'shorte.st', 't2m.io', 'kurzelinks.de', 
    'goo.gl', 'wp.me', 'short.io', 'x.co', 'tiny.cc', 'clk.im', 'b.link',
    'klclick.com', 'klclick1.com', 'klclick2.com', 'klclick3.com', 'klaviyo.com', 'klaviyomail.com',
    'rs6.net', 'mktoweb.com', 'exacttarget.com', 'acemlna.com', 'acems1.com', 
    'kit-mail3.com', 'ck.page', 'convertkit-mail.com', 'awstrack.me', 
    'list-manage.com', 'sendgrid.net', 'hubapi.com', 'omnisend.com',
    'campaign-archive.com', 'mailchi.mp', 'aweber.com', 'infusionsoft.com',
    'keap-link.com', 'sg.us-west-2.awstrack.me', 'ct.sendgrid.net',
    'sparkpost.com', 'sparkpostmail.com', 'sparkpostmail2.com', 'e.sparkpost.com', 'spmta.com',
    'click.pstmrk.it', 'mandrillapp.com', 'mailgun.net',
    'pardot.com', 'iterable.com', 'braze.com', 'sendinblue.com'
];

function logError(errorMessage) {
    chrome.storage.local.get({ errorLogs: [], recentActivity: [] }, (result) => {
        let logs = result.errorLogs;
        logs.unshift({ time: new Date().toLocaleTimeString(), message: errorMessage });
        if (logs.length > 20) logs.pop();

        let activity = result.recentActivity;
        activity.unshift({ time: new Date().toLocaleTimeString(), type: 'Error', text: errorMessage });
        if (activity.length > 10) activity.pop();

        chrome.storage.local.set({ errorLogs: logs, recentActivity: activity });
    });
}

function logHistory(shortUrl, finalUrl, isSafe, reason, resolvedIp, resolverUsed, isPixel = false) {
    chrome.storage.local.get({ resolutionHistory: [], recentActivity: [] }, (result) => {
        let history = result.resolutionHistory;
        history.unshift({
            timestamp: new Date().toLocaleString(),
            shortUrl: shortUrl,
            finalUrl: finalUrl,
            isSafe: isSafe,
            reason: reason || 'Clean',
            resolvedIp: resolvedIp || 'N/A'
        });
        if (history.length > 50) history.pop();

        let activity = result.recentActivity;
        if (isPixel) {
            activity.unshift({
                time: new Date().toLocaleTimeString(),
                type: 'Pixel Blocked',
                text: `${reason}: ${shortUrl}`
            });
        } else {
            const statusText = isSafe ? 'Resolved (Safe)' : `Flagged (${reason || 'Unsafe'})`;
            activity.unshift({
                time: new Date().toLocaleTimeString(),
                type: isSafe ? 'Success' : 'Security Warning',
                text: `${shortUrl} → ${finalUrl} [${statusText}]`
            });
        }
        
        if (activity.length > 10) activity.pop();

        chrome.storage.local.set({ resolutionHistory: history, recentActivity: activity });
    });
}

async function updateRemoteLists() {
    try {
        const listUrls = [
            'https://raw.githubusercontent.com/PeterDaveHello/url-shorteners/master/list',
            'https://raw.githubusercontent.com/boutetnico/url-shorteners/master/list.txt'
        ];
        let allDomains = new Set();
        for (const url of listUrls) {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const text = await response.text();
                text.split('\n').forEach(line => {
                    const cleanLine = line.trim();
                    if (cleanLine && !cleanLine.startsWith('#') && !cleanLine.includes('/')) {
                        allDomains.add(cleanLine);
                    }
                });
            } catch (fetchErr) {
                console.warn(`[Background] Failed to fetch list from ${url}:`, fetchErr);
            }
        }
        if (allDomains.size === 0) throw new Error("Failed to fetch data from all remote lists.");
        
        await chrome.storage.local.set({ remoteShorteners: Array.from(allDomains), lastSyncTime: new Date().toLocaleString() });
        chrome.action.setBadgeText({ text: "" });
    } catch (error) {
        chrome.action.setBadgeText({ text: "ERR" });
        chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
        logError("Failed to sync remote tracking lists.");
    }
}

chrome.runtime.onInstalled.addListener(() => {
    updateRemoteLists();
    chrome.alarms.create('syncLists', { periodInMinutes: 1440 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'syncLists') updateRemoteLists();
});

function cleanTrackingParams(urlString) {
    try {
        const url = new URL(urlString);
        const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'fbclid', 'gclid', 'mc_cid', 'mc_eid', '_bta_tid'];
        paramsToRemove.forEach(param => url.searchParams.delete(param));
        return url.toString();
    } catch (e) {
        return urlString;
    }
}

function isSingleUseToken(urlString, linkText = '') {
    const combined = (urlString + ' ' + linkText).toLowerCase();
    if (/\/reset|\/verify|\/activate|\/confirm|\/login|\/invitation|\/unsubscribe|\/optout|unsubscrib|opt-out/.test(combined)) {
        return true;
    }
    if (/token=|code=|auth=|key=|nonce=|ticket=|sig=|magic=|unsubscribe=/.test(combined)) {
        return true;
    }
    return false;
}

// --- MULTI-PROVIDER SECURE RESOLUTION CHAIN ---

async function fetchRealDestinationIp(hostname) {
    try {
        const res = await fetch(`https://1.1.1.1/dns-query?name=${hostname}&type=A`, { headers: { 'accept': 'application/dns-json' } });
        const data = await res.json();
        if (data.Answer && data.Answer.length > 0) {
            const ipRecord = data.Answer.find(r => r.type === 1 && r.data !== '0.0.0.0');
            if (ipRecord) return ipRecord.data;
        }
    } catch (e) {}
    return 'N/A';
}

function buildDnsWireQuery(hostname) {
    const packet = [0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    hostname.split('.').forEach(part => {
        packet.push(part.length);
        for (let i = 0; i < part.length; i++) packet.push(part.charCodeAt(i));
    });
    packet.push(0x00, 0x00, 0x01, 0x00, 0x01); // Type A, Class IN
    const binary = String.fromCharCode(...packet);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function queryQuad9(hostname) {
    try {
        const wire = buildDnsWireQuery(hostname);
        const res = await fetch(`https://dns.quad9.net/dns-query?dns=${wire}`, {
            headers: { 'Accept': 'application/dns-message' }
        });
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        const view = new DataView(buf);
        const rcode = view.getUint8(3) & 0x0F;
        // Quad9 blocks malware/phishing by returning NXDOMAIN (RCODE 3)
        if (rcode === 3) {
            return { isSafe: false, reason: "Malware or Phishing (Quad9)" };
        }
    } catch (e) {
        console.warn('Quad9 query failed:', e);
    }
    return null;
}


// --- MULTI-LAYER OFFLINE DECODERS ---

function decodeMicrosoftSafeLinks(url) {
    if (!url.includes('.safelinks.protection.outlook.com') && !url.includes('.safelinks.office.com')) return null;
    try {
        const urlObj = new URL(url);
        const target = urlObj.searchParams.get('url');
        return target ? decodeURIComponent(target) : null;
    } catch (e) { return null; }
}

function decodeProofpoint(url) {
    if (!url.includes('urldefense.com') && !url.includes('urldefense.proofpoint.com')) return null;
    const v2Match = url.match(/urldefense(?:\.proofpoint)?\.com\/(v[12])\/url\?[^#]*\bu=([^&]+)/i);
    if (v2Match) {
        let raw = v2Match[2];
        if (v2Match[1] === 'v2') raw = raw.replace(/-/g, '%').replace(/_/g, '/');
        try { return decodeURIComponent(raw); } catch (e) { return unescape(raw); }
    }
    const v3Match = url.match(/urldefense(?:\.proofpoint)?\.com\/v3\/__(.+?)__;([A-Za-z0-9_-]+)!/i);
    if (v3Match) {
        try {
            const urlPart = v3Match[1];
            let encBytes = v3Match[2];
            const padding = encBytes.length % 4;
            if (padding) encBytes += '='.repeat(4 - padding);
            const decBytes = atob(encBytes.replace(/-/g, '+').replace(/_/g, '/'));
            const runMapping = {};
            let runLength = 2;
            const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
            for (let i = 0; i < alphabet.length; i++) { runMapping[alphabet[i]] = runLength++; }
            let curPos = 0, result = '', i = 0;
            while (i < urlPart.length) {
                if (urlPart.substring(i, i + 2) === '**') {
                    const lengthChar = urlPart[i + 2] || '';
                    const runLen = Math.floor((runMapping[lengthChar] || 2) / 2);
                    result += decBytes.substring(curPos, curPos + runLen);
                    curPos += runLen;
                    i += 3;
                } else if (urlPart[i] === '*') {
                    result += decBytes.substring(curPos, curPos + 1);
                    curPos += 1;
                    i += 1;
                } else {
                    result += urlPart[i];
                    i += 1;
                }
            }
            return decodeURIComponent(result);
        } catch (e) { return null; }
    }
    return null;
}

function decodeAmazonSes(url) {
    const sesMatch = url.match(/\/CL0\/(https?:\/\/|https?:%2F%2F|https?%3A%2F%2F)(.+?)(\/\d+\/|$)/i);
    if (sesMatch) {
        try { return decodeURIComponent(sesMatch[1] + sesMatch[2]); } catch (e) {}
    }
    return null;
}

function decodeBase64Pattern(url) {
    try {
        const b64Match = url.match(/(aHR0c[a-zA-Z0-9+/=_-]+)/);
        if (b64Match) {
            const b64String = b64Match[0].replace(/-/g, '+').replace(/_/g, '/');
            return atob(b64String);
        }
    } catch(e) {}
    return null;
}

function decodeKnownRedirectShims(url) {
    try {
        const urlObj = new URL(url);
        const host = urlObj.hostname.toLowerCase();
        if (host.endsWith('google.com') && urlObj.pathname === '/url') return urlObj.searchParams.get('q') || urlObj.searchParams.get('url');
        if (host.includes('facebook.com') && urlObj.pathname.includes('/l.php')) return urlObj.searchParams.get('u');
        if (host.endsWith('linkedin.com') && (urlObj.pathname.includes('/redir') || urlObj.pathname.includes('/safety/go'))) return urlObj.searchParams.get('url');
        if (host.endsWith('slack-redir.net') && urlObj.pathname === '/link') return urlObj.searchParams.get('url');
        if (host.endsWith('youtube.com') && urlObj.pathname === '/redirect') return urlObj.searchParams.get('q');
    } catch (e) {}
    return null;
}

function decodeQueryCatalog(url) {
    try {
        const urlObj = new URL(url);
        const redirectKeys = ['url', 'u', 'dest', 'destination', 'target', 'redirect', 'redirect_url', 'redir', 'r', 'goto', 'to', 'link', 'next', 'forward', 'uri', 'href', 'return_to'];
        for (const key of redirectKeys) {
            const val = urlObj.searchParams.get(key);
            if (val && (val.startsWith('http://') || val.startsWith('https://'))) return val;
        }
    } catch (e) {}
    return null;
}

async function unwrapNestedUrl(inputUrl) {
    let currentUrl = inputUrl;
    let changed = true;
    let iterations = 0;
    const maxIterations = 5;
    let steps = [];

    while (changed && iterations < maxIterations) {
        changed = false;
        iterations++;
        const before = currentUrl;
        let decoderName = '';

        const pp = decodeProofpoint(currentUrl);
        if (pp && pp !== currentUrl) {
            currentUrl = pp;
            decoderName = 'Proofpoint TAP (URL Defense)';
            changed = true;
        } else {
            const sl = decodeMicrosoftSafeLinks(currentUrl);
            if (sl && sl !== currentUrl) {
                currentUrl = sl;
                decoderName = 'Microsoft Defender SafeLinks';
                changed = true;
            } else {
                const ses = decodeAmazonSes(currentUrl);
                if (ses && ses !== currentUrl) {
                    currentUrl = ses;
                    decoderName = 'Amazon SES Fast-Path';
                    changed = true;
                } else {
                    const b64 = decodeBase64Pattern(currentUrl);
                    if (b64 && b64 !== currentUrl) { 
                        try {
                            new URL(b64);
                            currentUrl = b64;
                            decoderName = 'Base64 Parameter Payload';
                            changed = true;
                        } catch(e){}
                    }
                    if (!changed) {
                        const shim = decodeKnownRedirectShims(currentUrl);
                        if (shim && shim !== currentUrl) {
                            currentUrl = shim;
                            decoderName = 'Platform Link Shim';
                            changed = true;
                        } else {
                            const param = decodeQueryCatalog(currentUrl);
                            if (param && param !== currentUrl) {
                                currentUrl = param;
                                decoderName = 'URL Query Redirect Parameter';
                                changed = true;
                            }
                        }
                    }
                }
            }

        }

        if (changed) {
            steps.push({
                layer: iterations,
                decoder: decoderName,
                inputUrl: before,
                outputUrl: currentUrl
            });
        }
    }

    return {
        unwrappedUrl: currentUrl,
        strategyPath: steps.map(s => s.decoder).join(' -> '),
        steps: steps
    };
}

async function checkDomainSafety(urlString, customResolver) {
    try {
        const hostname = new URL(urlString).hostname;
        let realIp = await fetchRealDestinationIp(hostname);

        if (customResolver) {
            try {
                let customUrl = customResolver.replace('{hostname}', hostname);
                if (!customUrl.includes(hostname) && !customUrl.includes('{')) {
                    const joiner = customUrl.includes('?') ? '&' : '?';
                    customUrl = `${customUrl}${joiner}name=${hostname}&type=A`;
                }
                
                const res = await fetch(customUrl, { headers: { 'accept': 'application/dns-json' } });
                const data = await res.json();
                
                // Allow user to write their own generic JSON parsing or standard DoH response checking
                if (data.Answer && data.Answer.some(r => r.data === '0.0.0.0' || r.data.includes('block') || r.data === '127.0.0.1')) {
                    return { isSafe: false, reason: "Blocked by Custom Resolver", resolvedIp: realIp, scanner: 'Custom DoH' };
                } else if (data.matches && data.matches.length > 0) { // Catch-all for Google Safe Browsing style responses
                    return { isSafe: false, reason: "Flagged by Custom API", resolvedIp: realIp, scanner: 'Custom API' };
                }
            } catch (e) {
                console.warn('Custom resolver failed, falling back...', e);
            }
        }

        // Check Quad9 Wireformat first
        const q9Result = await queryQuad9(hostname);
        if (q9Result && !q9Result.isSafe) {
            return { isSafe: false, reason: q9Result.reason, resolvedIp: realIp, scanner: 'Quad9' };
        }

        const dohProviders = [
            { name: 'AdGuard Public', url: `https://dns.adguard-dns.com/resolve?name=${hostname}&type=A` },
            { name: 'Cloudflare Security', url: `https://security.cloudflare-dns.com/dns-query?name=${hostname}&type=A` },
            { name: 'Cloudflare Family', url: `https://family.cloudflare-dns.com/dns-query?name=${hostname}&type=A` },
            { name: 'Google DNS', url: `https://dns.google/resolve?name=${hostname}&type=A` }
        ];

        for (const provider of dohProviders) {
            try {
                const res = await fetch(provider.url, { headers: { 'Accept': 'application/dns-json' } });
                if (!res.ok) continue; 
                
                const data = await res.json();
                if (data.Answer && data.Answer.some(record => record.data === '0.0.0.0' || record.data === '127.0.0.1')) {
                    const reason = provider.name.includes('Family') ? "Adult Content" : "Malware or Phishing";
                    return { isSafe: false, reason: `${reason} (${provider.name})`, resolvedIp: realIp, scanner: provider.name };
                }
            } catch (e) {
                console.warn(`${provider.name} DoH failed, failing over...`, e);
            }
        }

        return { isSafe: true, reason: null, resolvedIp: realIp, scanner: 'Multi-DoH' };
    } catch (error) {
        return { isSafe: true, reason: null, resolvedIp: 'N/A', scanner: 'Failed - Default Safe' }; 
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'testUnwrap') {
        (async () => {
            const result = await unwrapNestedUrl(request.url);
            const cleaned = cleanTrackingParams(result.unwrappedUrl);
            if (cleaned !== result.unwrappedUrl) {
                result.steps.push({
                    layer: result.steps.length + 1,
                    decoder: 'Marketing Parameter Sanitizer (UTM / Tracking Query Removal)',
                    inputUrl: result.unwrappedUrl,
                    outputUrl: cleaned
                });
                result.unwrappedUrl = cleaned;
            }
            const safety = await checkDomainSafety(result.unwrappedUrl);
            result.isSafe = safety.isSafe;
            result.reason = safety.reason;
            result.resolvedIp = safety.resolvedIp;
            result.scanner = safety.scanner;
            return result;
        })().then(sendResponse);
        return true;
    }

    if (request.action === 'forceSync') {
        updateRemoteLists().then(() => sendResponse({status: "Sync complete"}));
        return true;
    }

    if (request.action === 'logPixel') {
        const actionText = request.removed ? 'Removed' : 'Blocked placeholder';
        logHistory(request.url, request.url, false, `Tracking Pixel (${actionText})`, 'N/A', 'Pixel Detector', true);
        sendResponse({status: "Logged"});
        return true;
    }

    if (request.action === 'testResolver') {
        const testResolver = async () => {
            try {
                let url = request.url;

                if (url.includes('quad9.net')) {
                    const wire = buildDnsWireQuery('example.com');
                    const res = await fetch(`https://dns.quad9.net/dns-query?dns=${wire}`, {
                        headers: { 'Accept': 'application/dns-message' }
                    });
                    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
                    return { success: true, message: "Connected! RFC 8484 Wireformat OK" };
                }

                url = url.replace('{hostname}', 'example.com');
                if (!url.includes('example.com') && !url.includes('{')) {
                    const joiner = url.includes('?') ? '&' : '?';
                    url = `${url}${joiner}name=example.com&type=A`;
                }

                // Try both GET and POST for custom APIs
                let res;
                try {
                    res = await fetch(url, { headers: { 'Accept': 'application/dns-json' } });
                } catch (e) {
                    res = await fetch(url, { 
                        method: 'POST', 
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ "client": { "clientId": "test" }, "threatInfo": { "threatTypes": ["MALWARE"], "platformTypes": ["ANY_PLATFORM"], "threatEntryTypes": ["URL"], "threatEntries": [{"url": "http://example.com"}] } })
                    });
                }
                
                if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
                const data = await res.json();
                
                if (data.Status !== undefined || data.Answer !== undefined || data.matches !== undefined || data.query_status !== undefined) {
                    return { success: true, message: `Connected! Valid API response received.` };
                } else {
                    return { success: false, message: "Connected, but response was not a standard DoH or Threat API format." };
                }
            } catch (error) {
                return { success: false, message: `Failed: ${error.message}` };
            }
        };
        testResolver().then(sendResponse);
        return true;
    }
    
    if (request.action === 'resolveUrl') {
        const resolve = async () => {
            const shortUrl = request.url;
            const linkText = request.linkText || '';
            let finalUrl = shortUrl;
            let resolverUsed = 'Zero-Touch Scanner';

            const storage = await chrome.storage.local.get(['customBlocklist', 'customAllowlist', 'remoteShorteners', 'customDohEndpoint', shortUrl]);
            const managed = await new Promise(res => chrome.storage.managed.get(['managedAllowlist', 'managedBlocklist', 'managedDohEndpoint'], res));
            
            const allowlist = [...(storage.customAllowlist || []), ...(managed.managedAllowlist || [])];
            const blocklist = [...(storage.customBlocklist || []), ...(managed.managedBlocklist || []), ...(storage.remoteShorteners || []), ...defaultShorteners];
            const customResolver = managed.managedDohEndpoint || storage.customDohEndpoint || null;

            let hostname = '';
            try { hostname = new URL(shortUrl).hostname.toLowerCase(); } catch(e) { return null; }

            if (allowlist.some(d => hostname === d || hostname.endsWith('.' + d))) {
                return { finalUrl: shortUrl, isSafe: true, reason: 'Allowlisted', resolvedIp: 'N/A', isAllowlisted: true };
            }

            if (storage[shortUrl]) {
                const c = storage[shortUrl];
                return { finalUrl: c.finalUrl, isSafe: c.isSafe, reason: c.reason, resolvedIp: c.resolvedIp || 'N/A', isAllowlisted: false };
            }

            const { unwrappedUrl, strategyPath } = await unwrapNestedUrl(shortUrl);
            if (unwrappedUrl !== shortUrl) {
                finalUrl = unwrappedUrl;
                resolverUsed = strategyPath + ' Fast-Path';
            }

            const isKnownTracker = blocklist.some(d => hostname === d || hostname.endsWith('.' + d)) || /^(click[0-9]*|trk[0-9]*|ctrk[0-9]*|track[0-9]*|tracking|redirect|redir|go|link[0-9]*|links|url|mkt|email|mail|ct|cl|c|em|e|r|l|t)\./i.test(hostname) || /^\/(l|r|c|cl|track|click|clicks|redirect|redir|wf\/click|ls\/click)\//i.test(new URL(shortUrl).pathname);
            const isSingleUse = isSingleUseToken(shortUrl, linkText);

            if (finalUrl === shortUrl && isKnownTracker) {
                if (!isSingleUse) {
                    try {
                        const apiUrl = `https://unshorten.me/json/${encodeURIComponent(shortUrl)}`;
                        const apiRes = await fetch(apiUrl);
                        const data = await apiRes.json();
                        if (data.success && data.resolved_url) {
                            finalUrl = data.resolved_url;
                            resolverUsed = 'unshorten.me API';
                        }
                    } catch (error) {}
                } else {
                    try {
                        const response = await fetch(shortUrl, { method: 'HEAD', redirect: 'manual' });
                        if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
                            finalUrl = response.headers.get('location');
                            resolverUsed = 'Manual Redirect (Safe)';
                        }
                    } catch (error) {
                        resolverUsed = 'Skipped (Single-Use Token Protection)';
                    }
                }
            }

            finalUrl = cleanTrackingParams(finalUrl);

            const safetyStatus = await checkDomainSafety(finalUrl, customResolver);
            
            await chrome.storage.local.set({
                [shortUrl]: {
                    finalUrl: finalUrl,
                    resolver: resolverUsed,
                    isSafe: safetyStatus.isSafe,
                    reason: safetyStatus.reason || 'Clean',
                    resolvedIp: safetyStatus.resolvedIp,
                    cachedDate: new Date().toLocaleString()
                }
            });

            logHistory(shortUrl, finalUrl, safetyStatus.isSafe, safetyStatus.reason, safetyStatus.resolvedIp, resolverUsed);

            return { finalUrl: finalUrl, isSafe: safetyStatus.isSafe, reason: safetyStatus.reason, resolvedIp: safetyStatus.resolvedIp, isAllowlisted: false };
        };

        resolve().then(result => {
            if (result) sendResponse(result);
        });
        
        return true; 
    }
    
    if (request.action === 'updateBadge') {
        const total = (request.linkCount || 0) + (request.pixelCount || 0);
        if (total > 0) {
            chrome.action.setBadgeText({ text: total.toString(), tabId: sender.tab.id });
            chrome.action.setBadgeBackgroundColor({ color: '#d93025', tabId: sender.tab.id });
        } else {
            chrome.action.getBadgeText({}, (text) => {
                if (text !== "ERR") chrome.action.setBadgeText({ text: "", tabId: sender.tab.id });
            });
        }
        sendResponse({ status: "Badge updated" });
        return true; 
    }
});
