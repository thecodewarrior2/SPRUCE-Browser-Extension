#!/usr/bin/env node
// Refreshes shortener-snapshot.txt from the community lists the extension syncs daily.
// Run from the extension folder on an internet-connected computer (Node 18 or newer):
//     node tools/refresh-snapshot.js
// The extension still filters every entry when it loads the file (major sites are removed,
// malformed lines ignored), exactly as it does for the daily download.
const fs = require('fs');
const path = require('path');

const LISTS = [
    'https://raw.githubusercontent.com/PeterDaveHello/url-shorteners/master/list',
    'https://raw.githubusercontent.com/boutetnico/url-shorteners/master/list.txt'
];
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const OUT = path.join(__dirname, '..', 'shortener-snapshot.txt');

(async () => {
    const domains = new Set();
    for (const url of LISTS) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        let count = 0;
        for (const line of (await res.text()).split('\n')) {
            const d = line.trim().toLowerCase();
            if (d && !d.startsWith('#') && DOMAIN_RE.test(d)) { domains.add(d); count++; }
        }
        console.log(`${url}: ${count} domains`);
    }
    if (domains.size < 100) throw new Error(`Only ${domains.size} domains found; snapshot left unchanged.`);
    const header = [
        '# Bundled shortener snapshot: used on a fresh install until the community lists have been',
        '# downloaded once, and as a fallback while a list cannot be reached.',
        `# Generated ${new Date().toISOString().slice(0, 10)} by tools/refresh-snapshot.js from:`,
        ...LISTS.map(u => `#   ${u}`),
        ''
    ];
    fs.writeFileSync(OUT, header.join('\n') + [...domains].sort().join('\n') + '\n');
    console.log(`Wrote ${domains.size} domains to shortener-snapshot.txt`);
})().catch(e => { console.error('Snapshot not refreshed:', e.message); process.exit(1); });
