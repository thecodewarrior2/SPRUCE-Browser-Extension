// options.js — the Options page: Settings (privacy level, switches, lists, your own services,
// backup), the Link Inspector, and the Logging sections (application log, history, URL cache).
// Help and its live architecture tables are in help.js. Data is always rendered with textContent
// or escaped before insertion.

installPageErrorLogging('Options page');

// Status shown for a Resolution History entry. Entries written before 5.14 have no "verdict".
function historyStatus(item) {
    let verdict = item.verdict;
    if (!verdict) verdict = /^Tracking Pixel/i.test(item.reason || '') ? 'pixel' : (item.isSafe ? 'safe' : 'unsafe');
    // Earlier versions logged undecodable email trackers as "Safe"; only the tracker's own domain was checked.
    if (verdict === 'safe' && item.finalUrl === item.shortUrl && emailTrackerProvider(item.shortUrl)) {
        return { cls: 'badge-neutral', text: 'Not verified: email tracking link' };
    }
    switch (verdict) {
        case 'safe':    return { cls: 'badge-safe',    text: 'Safe' };
        case 'unknown': return { cls: 'badge-neutral', text: `Not verified${item.reason && item.reason !== 'Not verified' ? ': ' + item.reason : ''}` };
        case 'blocked': return { cls: 'badge-unsafe',  text: `Blocked: ${item.reason || 'blocklist'}` };
        case 'pixel':   return { cls: 'badge-neutral', text: item.reason || 'Tracking pixel' };
        default:        return { cls: 'badge-unsafe',  text: `Unsafe: ${item.reason || 'Flagged'}` };
    }
}

// "Same as original" instead of a duplicate address when a link did not need unmasking.
function sameAsOriginalCell(td, originalUrl, finalUrl, resolver) {
    const span = document.createElement('span');
    span.className = 'same-as';
    const tracker = /^Email tracker/.test(resolver || '') || (typeof emailTrackerProvider === 'function' && emailTrackerProvider(originalUrl));
    span.textContent = tracker ? 'Not revealed (email tracking link)' : 'Same as original';
    span.title = tracker ? 'The destination is kept by the email provider and is only revealed by following the link, which this extension never does.'
                         : 'This link goes directly to its destination; nothing needed unmasking.';
    td.appendChild(span);
}

document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
        });
    });

    function createCopyBtn(textToCopy) {
        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.textContent = '📋 Copy';
        btn.addEventListener('click', () => {
            navigator.clipboard.writeText(textToCopy).then(() => {
                btn.textContent = '✓ Copied!';
                setTimeout(() => btn.textContent = '📋 Copy', 1500);
            }).catch((e) => {
                btn.textContent = 'Copy failed';
                reportToLog('warning', 'Options page', `Copying to the clipboard failed: ${e.message || e}`);
            });
        });
        return btn;
    }

    function createWhoisBtn(ip) {
        const a = document.createElement('a');
        a.href = `https://www.whois.com/whois/${encodeURIComponent(ip)}`;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'copy-btn';
        a.style.backgroundColor = 'var(--surface-3)';
        a.style.color = 'var(--accent)';
        a.textContent = '🔍 WHOIS';
        a.title = `Lookup IP info for ${ip} on Whois.com`;
        return a;
    }

    function refreshAllViews() {
        renderCache();
        renderHistory();
        renderPolicies();
        renderErrors();
        loadDohSettings();
        bindSettings();
    }


    // --- SETTINGS BINDING (user values + enterprise policy locks) ---
    async function bindSettings() {
        const cfg = await loadEffectiveSettings();
        let anyLocked = false;

        document.querySelectorAll('[data-setting]').forEach(el => {
            const key = el.dataset.setting;
            if (!SETTING_BY_KEY[key]) return;
            const locked = !!cfg.locked[key];
            if (locked) anyLocked = true;

            if (el.type === 'checkbox') el.checked = !!cfg.values[key];
            else if (locked && SETTING_BY_KEY[key].secret) el.value = cfg.values[key] ? '•••••• (set by your administrator)' : '';
            else el.value = cfg.values[key];
            el.disabled = locked;

            const anchor = el.closest('label.switch') || el;
            const next = anchor.nextElementSibling;
            if (next && next.classList.contains('lock-note')) next.remove();
            if (locked) {
                const note = document.createElement('span');
                note.className = 'lock-note';
                note.textContent = '🔒 Set by your organization';
                note.title = 'This setting is controlled by your organization\'s administrator.';
                anchor.insertAdjacentElement('afterend', note);
            }

            if (!el.dataset.bound) {
                el.dataset.bound = '1';
                el.addEventListener('change', () => {
                    const def = SETTING_BY_KEY[key];
                    let value = el.type === 'checkbox' ? el.checked : el.value;
                    if (def.type === 'integer') {
                        value = Math.min(def.max, Math.max(def.min, parseInt(value, 10) || def.def));
                        el.value = value;
                    }
                    chrome.storage.local.set({ [key]: value });
                });
            }
        });

        const notice = document.getElementById('managedAnyNotice');
        if (notice) notice.style.display = (anyLocked || cfg.managedAllowlist.length || cfg.managedBlocklist.length || cfg.locked.customDohEndpoint) ? 'block' : 'none';
        renderPresets(cfg);
        renderStatus(cfg);
    }

    // --- PRIVACY LEVEL ---
    function renderPresets(cfg) {
        const current = currentPreset(cfg.values);
        let anyUnavailable = false;
        document.querySelectorAll('.preset').forEach(label => {
            const id = label.dataset.preset;
            const available = presetAvailable(id, cfg);
            if (!available) anyUnavailable = true;
            label.classList.toggle('selected', id === current);
            label.classList.toggle('disabled', !available);
            label.querySelector('input').checked = id === current;
            label.querySelector('input').disabled = !available;
        });
        const note = document.getElementById('presetNote');
        const parts = [];
        if (current === 'custom') parts.push('Custom: individual lookup settings below have been changed. Choose a level to reset them.');
        if (anyUnavailable) parts.push('🔒 Some levels are unavailable because your organization manages these settings.');
        note.textContent = parts.join(' ');
    }

    document.querySelectorAll('.preset input').forEach(input => {
        input.addEventListener('change', async () => {
            const cfg = await loadEffectiveSettings();
            const id = input.value;
            if (!presetAvailable(id, cfg)) return;
            const updates = {};
            Object.entries(PRIVACY_PRESETS[id].values).forEach(([k, v]) => { if (!cfg.locked[k]) updates[k] = v; });
            chrome.storage.local.set(updates, () => {
                reportToLog('info', 'Settings', `Privacy level set to ${PRIVACY_PRESETS[id].label}.`);
                bindSettings();
            });
        });
    });

    // --- STATUS CARD ---
    function relativeTime(ms) {
        const mins = Math.round((Date.now() - ms) / 60000);
        if (mins < 2) return 'just now';
        if (mins < 60) return `${mins} minutes ago`;
        const hours = Math.round(mins / 60);
        if (hours < 36) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
        return `${Math.round(hours / 24)} days ago`;
    }

    function renderStatus(cfg) {
        chrome.storage.local.get({ errorLogs: [], listState: null }, (data) => {
            const card = document.getElementById('statusCard');
            const S = cfg.values;
            const now = Date.now();
            const recent = (Array.isArray(data.errorLogs) ? data.errorLogs : []).filter(l => l && l.timestampMs && now - l.timestampMs < 24 * 3600 * 1000);
            const errors = recent.filter(l => l.level === 'error');
            const dnsDown = S.enableDnsThreatCheck && recent.some(l => l.source === 'DNS checks' && now - l.timestampMs < 6 * 3600 * 1000 && /could be reached/.test(l.message));

            const details = [];
            const preset = currentPreset(S);
            details.push(`Privacy level: ${preset === 'custom' ? 'Custom' : PRIVACY_PRESETS[preset].label}`);
            if (!S.enableDnsThreatCheck) details.push('Threat checks off');
            else details.push(dnsDown ? 'Threat checks unavailable (your network may be blocking them)' : 'Threat checks on');
            const sources = data.listState && data.listState.sources ? Object.values(data.listState.sources) : [];
            const lastSync = Math.max(0, ...sources.map(src => src.lastSuccess || 0));
            if (!S.enableRemoteListSync) details.push('Shortener list updates off');
            else details.push(lastSync ? `Shortener list updated ${relativeTime(lastSync)}` : 'Using the built-in shortener list until the first update');

            let state = 'ok', icon = '✅', title = 'Protection is on';
            if (!S.enableLinkUnmasking) {
                state = 'off'; icon = '⏸️'; title = 'Link protection is switched off';
                details.unshift('Turn on "Reveal where links really go" below to resume');
            } else if (errors.length) {
                state = 'bad'; icon = '❗'; title = `Protection is on, but ${errors.length === 1 ? '1 error' : errors.length + ' errors'} in the last day ${errors.length === 1 ? 'needs' : 'need'} attention`;
            } else if (dnsDown) {
                state = 'warn'; icon = '⚠️'; title = 'Protection is on, with reduced checking';
            }
            card.className = `status-card ${state === 'ok' ? '' : state}`;
            document.getElementById('statusIcon').textContent = icon;
            document.getElementById('statusTitle').textContent = title;
            const det = document.getElementById('statusDetails');
            det.textContent = details.join(' · ');
            if (state === 'bad' || state === 'warn') {
                const a = document.createElement('a');
                a.href = '#'; a.dataset.gotoLog = 'applog'; a.textContent = ' · View the application log';
                det.appendChild(a);
            }
        });
    }

    // --- WELCOME LINE ---
    chrome.storage.local.get({ welcomeDismissed: false }, (r) => {
        document.getElementById('welcomeBanner').style.display = r.welcomeDismissed ? 'none' : 'flex';
    });
    document.getElementById('dismissWelcomeBtn').addEventListener('click', () => {
        chrome.storage.local.set({ welcomeDismissed: true });
        document.getElementById('welcomeBanner').style.display = 'none';
    });

    // --- RESET ---
    // Only the user's own choices are reset. Settings managed by the organization (Firefox enterprise
    // policy) are left completely alone, including the user's stored value underneath
    // them, so nothing changes if the organization later stops managing a setting.
    document.getElementById('resetDefaultsBtn').addEventListener('click', async () => {
        const cfg = await loadEffectiveSettings();
        const managed = SETTING_DEFS.filter(d => cfg.locked[d.key]);
        const resettable = SETTING_DEFS.filter(d => !cfg.locked[d.key]).map(d => d.key);
        const note = managed.length ? ` The ${managed.length} setting(s) managed by your organization are not changed.` : '';
        if (!confirm(`Reset your settings to their defaults? This includes the privacy level and your own services (and their API keys). Your allowed and blocked sites, history and cache are kept.${note}`)) return;
        chrome.storage.local.remove(resettable, () => {
            reportToLog('info', 'Settings', `Settings were reset to their defaults by the user${managed.length ? ` (${managed.length} managed setting(s) left unchanged)` : ''}.`);
            refreshAllViews();
        });
    });

    document.getElementById('headerVersion').textContent = 'v' + chrome.runtime.getManifest().version;

    // Appearance: Follow system (default) / Light / Dark — remembered, shared with the popup (theme.js).
    const themeSelect = document.getElementById('themeSelect');
    themeSelect.value = window.uiTheme.get();
    themeSelect.addEventListener('change', () => {
        window.uiTheme.set(themeSelect.value);
        reportToLog('info', 'Settings', `Appearance set to ${themeSelect.options[themeSelect.selectedIndex].text.replace(/^\S+\s/, '')}.`);
    });
    document.addEventListener('themechange', (e) => { themeSelect.value = e.detail.choice; });

    // React only to changes that affect this page: settings and lists re-render the settings; new
    // log entries or list updates refresh just the status card. Cache writes made while Gmail is in
    // use are ignored here (the Logging sections have their own listener).
    const STATUS_ONLY_KEYS = new Set(['errorLogs', 'listState', 'lastSyncTime']);
    const IGNORED_KEYS = new Set(['resolutionHistory', 'recentActivity', 'cacheSchema', 'welcomeDismissed', 'uiTheme']);
    let bindTimer = null, statusTimer = null;
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' && area !== 'managed') return;
        const keys = Object.keys(changes).filter(k => !k.startsWith('http') && !IGNORED_KEYS.has(k));
        if (area === 'managed' || keys.some(k => !STATUS_ONLY_KEYS.has(k))) {
            clearTimeout(bindTimer);
            bindTimer = setTimeout(bindSettings, 150);
        } else if (keys.length) {
            clearTimeout(statusTimer);
            statusTimer = setTimeout(() => loadEffectiveSettings().then(renderStatus), 300);
        }
    });

    document.getElementById('clearAllLocalDataBtn').addEventListener('click', () => {
        if (!confirm('Delete all cached links, resolution history and recent activity? Your settings and lists are kept.')) return;
        chrome.storage.local.get(null, (items) => {
            const keys = Object.keys(items).filter(k => k.startsWith('http://') || k.startsWith('https://'));
            // Sender data too (servers' addresses per email, countries, sender verdicts). Conversations
            // remembered as moved to or taken out of Spam are kept, so they're never moved again.
            chrome.storage.local.remove([...keys, 'senderMessageCache', 'geoCache', 'senderDomainCache', 'senderResultCache', 'faviconCache'], () => {
                chrome.storage.local.set({ resolutionHistory: [], recentActivity: [] }, () => {
                    reportToLog('info', 'Options page', `Cache, resolution history and activity deleted by the user (${keys.length} cached entries).`);
                    renderCache(); renderHistory();
                });
            });
        });
    });

    // Produces the JSON an administrator pastes into Admin console > Policy for extensions.
    // The policy for the current settings: install the add-on and lock every setting and both lists
    // (policies → 3rdparty → Extensions → add-on ID, read by the extension as storage.managed).
    const INSTALL_URL = 'https://addons.mozilla.org/firefox/downloads/latest/ADDON-SLUG/latest.xpi';
    async function currentPolicySettings() {
        const cfg = await loadEffectiveSettings();
        const settings = {};
        SETTING_DEFS.forEach(d => { settings[d.managedKey] = cfg.values[d.key]; });
        const local = await new Promise(r => chrome.storage.local.get({ customAllowlist: [], customBlocklist: [], customTrustedSenders: [] }, r));
        settings.managedAllowlist = normalizeDomainList(local.customAllowlist);
        settings.managedBlocklist = normalizeDomainList(local.customBlocklist);
        settings.managedTrustedSenders = normalizeSenderList(local.customTrustedSenders);
        return settings;
    }

    function buildPoliciesJson(settings) {
        const id = chrome.runtime.id;
        return JSON.stringify({ policies: {
            ExtensionSettings: { [id]: { installation_mode: 'force_installed', install_url: INSTALL_URL } },
            '3rdparty': { Extensions: { [id]: settings } }
        } }, null, 2);
    }

    // PowerShell for Intune (or any Windows management tool) that writes the same policy to the registry
    // Firefox reads (HKLM\SOFTWARE\Policies\Mozilla\Firefox). The add-on's settings go in as one JSON
    // string, which Firefox parses, so every value keeps its type. Keys are only created when missing:
    // New-Item -Force on an existing key would wipe other add-ons' values under 3rdparty\Extensions.
    function buildIntuneScript(settings) {
        const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
        return [
            '# Gmail Link Unshortener — Firefox policy for Windows (Microsoft Intune, Group Policy or any management tool).',
            `# Generated ${new Date().toISOString().slice(0, 10)} from the Options page (version ${chrome.runtime.getManifest().version}).`,
            '# Intune: Devices → Scripts and remediations → Platform scripts → Add (Windows 10 and later);',
            '# run as system (logged on credentials: No) in 64-bit PowerShell. Check the result at about:policies.',
            '#',
            "# IMPORTANT: replace ADDON-SLUG with the add-on's address on addons.mozilla.org (or set $InstallUrl to",
            '# your own signed .xpi). Delete any settings in $Settings you do not want to lock.',
            `$AddonId = ${q(chrome.runtime.id)}`,
            `$InstallUrl = ${q(INSTALL_URL)}`,
            `$Settings = ${q(JSON.stringify(settings))}`,
            '',
            "$Firefox = 'HKLM:\\SOFTWARE\\Policies\\Mozilla\\Firefox'",
            '$Install = "$Firefox\\ExtensionSettings\\$AddonId"',
            'if (-not (Test-Path $Install)) { New-Item -Path $Install -Force | Out-Null }',
            "New-ItemProperty -Path $Install -Name 'installation_mode' -PropertyType String -Value 'force_installed' -Force | Out-Null",
            "New-ItemProperty -Path $Install -Name 'install_url' -PropertyType String -Value $InstallUrl -Force | Out-Null",
            '$Extensions = "$Firefox\\3rdparty\\Extensions"',
            'if (-not (Test-Path $Extensions)) { New-Item -Path $Extensions -Force | Out-Null }',
            'New-ItemProperty -Path $Extensions -Name $AddonId -PropertyType String -Value $Settings -Force | Out-Null',
            ''
        ].join('\r\n');
    }

    for (const [btn, result, build, done] of [
        ['copyPolicyJsonBtn', 'copyPolicyResult', buildPoliciesJson, 'Copied. Replace ADDON-SLUG with the add-on\'s address on addons.mozilla.org, and delete any settings you do not want to lock.'],
        ['copyIntuneScriptBtn', 'copyIntuneResult', buildIntuneScript, 'Copied. Paste it into a .ps1 file and replace ADDON-SLUG before deploying.']
    ]) {
        document.getElementById(btn).addEventListener('click', async () => {
            const out = document.getElementById(result);
            try {
                await navigator.clipboard.writeText(build(await currentPolicySettings()));
                out.style.color = ''; out.textContent = done;
            } catch (e) {
                out.style.color = 'var(--danger-text)'; out.textContent = 'Copy failed.';
                reportToLog('warning', 'Options page', `Copying the policy (${btn}) failed: ${e.message || e}`);
            }
        });
    }

    // Endpoint address fields have a Save button (it asks the browser for access to the host).
    const ENDPOINT_FIELDS = [
        { key: 'customDohEndpoint', input: 'customDohInput', save: 'saveDohBtn', notice: 'managedDohNotice', label: 'Custom threat resolver' },
        { key: 'customUnshortenerEndpoint', input: 'customUnshortenerInput', save: 'saveUnshortenerBtn', notice: 'managedUnshortenerNotice', label: 'Custom unshortener' }
    ];

    async function loadDohSettings() {
        const cfg = await loadEffectiveSettings();
        ENDPOINT_FIELDS.forEach(f => {
            const input = document.getElementById(f.input);
            const locked = !!cfg.locked[f.key];
            input.value = cfg.values[f.key] || '';
            input.disabled = locked;
            document.getElementById(f.save).disabled = locked;
            document.getElementById(f.notice).style.display = locked ? 'block' : 'none';
        });
    }

    ENDPOINT_FIELDS.forEach(f => {
        document.getElementById(f.save).addEventListener('click', async () => {
            const val = document.getElementById(f.input).value.trim();
            if (val) {
                if (!isValidDohEndpoint(val)) {
                    reportToLog('warning', 'Settings', `${f.label}: not saved, because the address entered is not a valid https:// address.`);
                    alert('The address must be a valid https:// address, so links are never sent unencrypted.');
                    return;
                }
                const origin = new URL(val.replace(/\{(hostname|url|url_noscheme)\}/g, 'example.com')).origin;
                // Ask the browser for access to this one host (no-op if already allowed).
                let granted = false;
                try { granted = await chrome.permissions.request({ origins: [origin + '/*'] }); } catch (e) {}
                if (!granted) {
                    reportToLog('warning', 'Settings', `${f.label}: the browser did not grant access to ${origin}. It will only work if that server sends CORS headers.`);
                    alert('Access to ' + origin + ' was not granted. It will only work if that server sends CORS headers.');
                }
            }
            chrome.storage.local.set({ [f.key]: val }, () => {
                if (chrome.runtime.lastError) {
                    reportToLog('error', 'Settings', `${f.label} could not be saved: ${chrome.runtime.lastError.message}`);
                    alert(`${f.label} could not be saved.`);
                    return;
                }
                reportToLog('info', 'Settings', val ? `${f.label} set to ${new URL(val.replace(/\{(hostname|url|url_noscheme)\}/g, 'x')).origin}.` : `${f.label} removed.`);
                alert(val ? `${f.label} saved.` : `${f.label} removed.`);
            });
        });
    });

    // Current form values (saved or not), for the Test buttons.
    function formConf(prefix, endpointInput) {
        const get = (k) => { const el = document.querySelector(`[data-setting="${prefix}${k}"]`); return el ? el.value : ''; };
        return { endpoint: document.getElementById(endpointInput).value.trim(), method: get('Method'), body: get('Body'),
                 headers: get('Headers'), flagField: get('FlagField').trim(), field: get('Field').trim() };
    }

    function showTestResult(span, response, label) {
        if (label && (!response || !response.success)) {
            reportToLog('warning', 'Resolver test', `${label}: ${response ? response.message : 'no answer from the background service'}`);
        }
        span.style.display = 'inline-block';
        span.textContent = response ? response.message : 'Unknown Error';
        span.className = 'test-result ' + (response && response.success ? 'result-pass' : 'result-fail');
    }

    document.getElementById('testUnshortenerBtn').addEventListener('click', () => {
        const span = document.getElementById('unshortenerResult');
        showTestResult(span, { success: true, message: 'Testing...' }); span.className = 'test-result';
        chrome.runtime.sendMessage({ action: 'testCustomUnshortener', conf: formConf('customUnshortener', 'customUnshortenerInput'),
                                     testUrl: document.getElementById('unshortenerTestLink').value },
            (response) => showTestResult(span, response, 'Custom unshortener test'));
    });

    async function executeResolverTest(url, resultSpan) {
        resultSpan.style.display = 'inline-block';
        resultSpan.className = 'test-result';
        resultSpan.style.color = 'var(--text-muted)';
        resultSpan.style.backgroundColor = 'var(--surface-3)';
        resultSpan.textContent = 'Testing...';

        chrome.runtime.sendMessage({ action: 'testResolver', url: url }, (response) => {
            if (response && response.success) {
                resultSpan.textContent = response.message;
                resultSpan.className = 'test-result result-pass';
            } else {
                resultSpan.textContent = response ? response.message : 'Unknown Error';
                resultSpan.className = 'test-result result-fail';
                reportToLog('warning', 'Resolver test', `Test of ${(() => { try { return new URL(url.replace('{hostname}', 'example.com')).hostname; } catch (e) { return 'resolver'; } })()} failed: ${resultSpan.textContent}`);
            }
        });
    }

    document.getElementById('testCustomDohBtn').addEventListener('click', () => {
        const span = document.getElementById('customDohResult');
        const conf = formConf('customDoh', 'customDohInput');
        if (!conf.endpoint) { showTestResult(span, { success: false, message: 'Please enter an address first.' }); return; }
        showTestResult(span, { success: true, message: 'Testing...' }); span.className = 'test-result';
        chrome.runtime.sendMessage({ action: 'testCustomThreat', conf }, (response) => showTestResult(span, response, 'Custom threat resolver test'));
    });

    document.querySelectorAll('.test-builtin-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const url = e.target.getAttribute('data-url');
            let resSpan = e.target.nextElementSibling;
            if (!resSpan || !resSpan.classList.contains('test-result')) {
                resSpan = document.createElement('span');
                resSpan.style.marginLeft = '8px';
                e.target.parentNode.appendChild(resSpan);
            }
            executeResolverTest(url, resSpan);
        });
    });

    function formatIsoLocalDate(timestampMs, dateFallback) {
        let d = null;
        if (timestampMs) {
            d = new Date(timestampMs);
        } else if (dateFallback && dateFallback !== 'N/A') {
            const parsed = Date.parse(dateFallback);
            if (!isNaN(parsed)) d = new Date(parsed);
        }
        if (!d || isNaN(d.getTime())) return '';
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function renderCache() {
        chrome.storage.local.get(null, (items) => {
            const tbody = document.querySelector('#cacheTable tbody');
            tbody.innerHTML = '';

            const filterText = document.getElementById('cacheSearch').value.toLowerCase();
            const filterDate = document.getElementById('cacheDatePicker').value;

            renderCacheStats(items);
            // Newest first.
            Object.keys(items).filter(k => k.startsWith('http'))
                .sort((a, b) => ((items[b] && items[b].cachedTimestamp) || 0) - ((items[a] && items[a].cachedTimestamp) || 0))
                .forEach(key => {
                {   // keys are already restricted to cached links above
                    const shortUrl = key;
                    const cacheData = items[key];
                    const finalUrl = typeof cacheData === 'object' ? cacheData.finalUrl : cacheData;
                    const resolver = typeof cacheData === 'object' && cacheData.resolver ? cacheData.resolver : 'unshorten.me / Local';
                    const isSafe = typeof cacheData === 'object' ? cacheData.isSafe : true;
                    const reason = typeof cacheData === 'object' ? cacheData.reason : 'Clean';
                    const cachedDate = typeof cacheData === 'object' ? cacheData.cachedDate : 'N/A';
                    const cachedTimestamp = typeof cacheData === 'object' ? cacheData.cachedTimestamp : null;

                    const entryIsoDate = formatIsoLocalDate(cachedTimestamp, cachedDate);
                    const dateMatches = !filterDate || (entryIsoDate === filterDate);

                    const textMatches = shortUrl.toLowerCase().includes(filterText) || 
                                        finalUrl.toLowerCase().includes(filterText) || 
                                        resolver.toLowerCase().includes(filterText) || 
                                        cachedDate.toLowerCase().includes(filterText);

                    if (dateMatches && textMatches) {
                        const tr = document.createElement('tr');
                        
                        const tdShort = document.createElement('td');
                        const codeShort = document.createElement('code');
                        codeShort.textContent = shortUrl;
                        tdShort.appendChild(codeShort);

                        const tdFinal = document.createElement('td');
                        if (finalUrl === shortUrl) {
                            sameAsOriginalCell(tdFinal, shortUrl, finalUrl, resolver);
                        } else {
                            const codeFinal = document.createElement('code');
                            codeFinal.textContent = finalUrl;
                            tdFinal.appendChild(codeFinal);
                        }

                        const tdResolver = document.createElement('td');
                        const badgeResolver = document.createElement('span');
                        badgeResolver.style.fontSize = '11px';
                        badgeResolver.style.fontWeight = 'bold';
                        badgeResolver.style.color = 'var(--accent)';
                        badgeResolver.textContent = resolver;
                        tdResolver.appendChild(badgeResolver);

                        const tdStatus = document.createElement('td');
                        const badgeSpan = document.createElement('span');
                        badgeSpan.className = `badge ${isSafe ? 'badge-safe' : 'badge-unsafe'}`;
                        badgeSpan.textContent = isSafe ? 'Safe' : `Unsafe: ${reason}`;
                        tdStatus.appendChild(badgeSpan);

                        const tdDate = document.createElement('td');
                        tdDate.textContent = cachedDate;

                        tr.appendChild(tdShort);
                        tr.appendChild(tdFinal);
                        tr.appendChild(tdResolver);
                        tr.appendChild(tdStatus);
                        tr.appendChild(tdDate);
                        tbody.appendChild(tr);
                    }
                }
            });

            if (tbody.children.length === 0) {
                const total = Object.keys(items).filter(k => k.startsWith('http')).length;
                const td = node('td', { style: 'color: var(--text-muted);' }, total ? 'No cached links match your filter.' : 'No cached links yet. Results appear here as you open emails in Gmail.');
                td.colSpan = 5;
                tbody.replaceChildren(node('tr', null, td));
            }
        });
    }

    function renderHistory() {
        chrome.storage.local.get({ resolutionHistory: [] }, (result) => {
            const tbody = document.querySelector('#historyTable tbody');
            tbody.innerHTML = '';

            const filterText = document.getElementById('historySearch').value.toLowerCase();
            const filterDate = document.getElementById('historyDatePicker').value;

            renderHistoryStats(Array.isArray(result.resolutionHistory) ? result.resolutionHistory : []);
            (Array.isArray(result.resolutionHistory) ? result.resolutionHistory : []).forEach(item => {
                if (!item) return;
                item = Object.assign({ shortUrl: '', finalUrl: '', timestamp: '', reason: '' }, item);
                const entryIsoDate = formatIsoLocalDate(item.timestampMs, item.timestamp);
                const dateMatches = !filterDate || (entryIsoDate === filterDate);
                const status = historyStatus(item);
                const textMatches = [item.shortUrl, item.finalUrl, item.resolvedIp || '', item.timestamp, status.text, item.resolver || '']
                    .some(v => String(v).toLowerCase().includes(filterText));

                if (dateMatches && textMatches) {
                    const tr = document.createElement('tr');
                    const badgeClass = status.cls;
                    const badgeText = status.text;

                    const tdTime = document.createElement('td');
                    tdTime.textContent = item.timestamp;

                    const tdShort = document.createElement('td');
                    const codeShort = document.createElement('code');
                    codeShort.textContent = item.shortUrl;
                    tdShort.appendChild(codeShort);
                    const btnContainerShort = document.createElement('div');
                    btnContainerShort.style.marginTop = '6px';
                    btnContainerShort.appendChild(createCopyBtn(item.shortUrl));
                    tdShort.appendChild(btnContainerShort);

                    const tdFinal = document.createElement('td');
                  if (item.verdict === 'pixel' || /^Tracking Pixel/i.test(item.reason || '')) {
                    const span = document.createElement('span');
                    span.className = 'same-as';
                    span.textContent = '— (tracking image, not a link)';
                    tdFinal.appendChild(span);
                  } else if (item.finalUrl === item.shortUrl) {
                    sameAsOriginalCell(tdFinal, item.shortUrl, item.finalUrl, item.resolver);
                  } else {
                    const codeFinal = document.createElement('code');
                    codeFinal.textContent = item.finalUrl;
                    tdFinal.appendChild(codeFinal);
                    const btnContainerFinal = document.createElement('div');
                    btnContainerFinal.style.marginTop = '6px';
                    btnContainerFinal.appendChild(createCopyBtn(item.finalUrl));
                    tdFinal.appendChild(btnContainerFinal);
                  }

                    const tdIp = document.createElement('td');
                    const codeIp = document.createElement('code');
                    codeIp.textContent = item.resolvedIp || 'N/A';
                    tdIp.appendChild(codeIp);
                    if (item.resolvedIp && item.resolvedIp !== 'N/A') {
                        const btnContainerIp = document.createElement('div');
                        btnContainerIp.style.display = 'flex';
                        btnContainerIp.style.gap = '6px';
                        btnContainerIp.style.marginTop = '6px';
                        btnContainerIp.appendChild(createCopyBtn(item.resolvedIp));
                        btnContainerIp.appendChild(createWhoisBtn(item.resolvedIp));
                        tdIp.appendChild(btnContainerIp);
                    }

                    const tdStatus = document.createElement('td');
                    const badgeSpan = document.createElement('span');
                    badgeSpan.className = `badge ${badgeClass}`;
                    badgeSpan.textContent = badgeText;
                    tdStatus.appendChild(badgeSpan);

                    tr.appendChild(tdTime);
                    tr.appendChild(tdShort);
                    tr.appendChild(tdFinal);
                    tr.appendChild(tdIp);
                    tr.appendChild(tdStatus);
                    tbody.appendChild(tr);
                }
            });

            if (tbody.children.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="color: var(--text-muted);">No resolution history matches your filter.</td></tr>';
            }
        });
    }

    function renderPolicies() {
        chrome.storage.local.get({ customBlocklist: [], customAllowlist: [], customTrustedSenders: [] }, (localResult) => {
            const renderSenders = (managedSenders) => {
                const mine = normalizeSenderList(localResult.customTrustedSenders);
                renderPolicyTable('trustedSenderTable', [...new Set([...mine, ...managedSenders])], managedSenders, 'customTrustedSenders', 'No trusted senders added.');
            };
            if (chrome.storage.managed) {
                chrome.storage.managed.get(['managedAllowlist', 'managedBlocklist', 'managedTrustedSenders'], (managedResult) => {
                    if (chrome.runtime.lastError || !managedResult) managedResult = {};
                    
                    if (managedResult.managedAllowlist || managedResult.managedBlocklist) {
                        document.getElementById('managedPolicyNotice').style.display = 'block';
                    }
                    
                    const combinedAllow = [...new Set([...(localResult.customAllowlist || []), ...(managedResult.managedAllowlist || [])])];
                    const combinedBlock = [...new Set([...(localResult.customBlocklist || []), ...(managedResult.managedBlocklist || [])])];
                    
                    renderPolicyTable('allowTable', combinedAllow, managedResult.managedAllowlist || [], 'customAllowlist');
                    renderPolicyTable('blockTable', combinedBlock, managedResult.managedBlocklist || [], 'customBlocklist');
                    renderSenders(normalizeSenderList(managedResult.managedTrustedSenders));
                });
            } else {
                renderPolicyTable('allowTable', localResult.customAllowlist || [], [], 'customAllowlist');
                renderPolicyTable('blockTable', localResult.customBlocklist || [], [], 'customBlocklist');
                renderSenders([]);
            }
        });
    }

    function renderPolicyTable(tableId, allDomains, managedDomains, storageKey, emptyText = 'No domains in this list.') {
        const tbody = document.querySelector(`#${tableId} tbody`);
        tbody.innerHTML = '';

        allDomains.forEach(domain => {
            const tr = document.createElement('tr');
            const tdDomain = document.createElement('td');
            const codeDomain = document.createElement('code');
            codeDomain.textContent = domain;
            tdDomain.appendChild(codeDomain);

            const tdAction = document.createElement('td');
            
            if (managedDomains.includes(domain)) {
                const badge = document.createElement('span');
                badge.className = 'badge badge-neutral';
                badge.textContent = 'Managed Policy';
                tdAction.appendChild(badge);
            } else {
                const btn = document.createElement('button');
                btn.className = 'del-btn';
                btn.textContent = 'Remove';
                btn.addEventListener('click', () => {
                    chrome.storage.local.get({ [storageKey]: [] }, (res) => {
                        const arr = res[storageKey];
                        const idx = arr.indexOf(domain);
                        if (idx > -1) {
                            arr.splice(idx, 1);
                            chrome.storage.local.set({ [storageKey]: arr }, renderPolicies);
                        }
                    });
                });
                tdAction.appendChild(btn);
            }

            tr.appendChild(tdDomain);
            tr.appendChild(tdAction);
            tbody.appendChild(tr);
        });

        if (tbody.children.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 2;
            td.style.color = 'var(--text-muted)';
            td.textContent = emptyText;
            tr.appendChild(td);
            tbody.appendChild(tr);
        }
    }

    document.getElementById('addAllowBtn').addEventListener('click', () => {
        addDomainToPolicy('domainAllowInput', 'customAllowlist');
    });

    document.getElementById('addBlockBtn').addEventListener('click', () => {
        addDomainToPolicy('domainBlockInput', 'customBlocklist');
    });

    // Trusted senders: an address or a whole domain, normalized ("@example.com" → "example.com").
    document.getElementById('addTrustedSenderBtn').addEventListener('click', () => {
        const input = document.getElementById('trustedSenderInput');
        const entry = normalizeSenderEntry(input.value);
        if (!input.value.trim()) return;
        if (!entry) { alert('Enter an email address (name@example.com) or a domain (example.com).'); return; }
        chrome.storage.local.get({ customTrustedSenders: [] }, (result) => {
            const list = normalizeSenderList(result.customTrustedSenders);
            if (list.includes(entry)) { alert('This sender is already in the list.'); return; }
            list.push(entry);
            chrome.storage.local.set({ customTrustedSenders: list }, () => {
                input.value = '';
                reportToLog('info', 'Settings', `Trusted sender added: ${entry}. Its emails will never be flagged or moved to Spam.`);
                renderPolicies();
            });
        });
    });

    function addDomainToPolicy(inputId, storageKey) {
        const input = document.getElementById(inputId);
        const domain = input.value.trim().toLowerCase();

        if (domain) {
            chrome.storage.local.get({ [storageKey]: [] }, (result) => {
                const list = result[storageKey];
                if (!list.includes(domain)) {
                    list.push(domain);
                    chrome.storage.local.set({ [storageKey]: list }, () => {
                        input.value = '';
                        renderPolicies();
                    });
                } else {
                    alert("Domain is already in the list.");
                }
            });
        }
    }

    // ---------------- Statistics (each covers everything stored, not just the filtered rows)
    function renderStats(id, stats) {
        const box = document.getElementById(id);
        box.textContent = '';
        stats.forEach(([value, label, tone, title]) => {
            const d = document.createElement('div');
            d.className = `stat ${tone || ''}`;
            if (title) d.title = title;
            const b = document.createElement('b'); b.textContent = value;
            const sp = document.createElement('span'); sp.textContent = label;
            d.append(b, sp);
            box.appendChild(d);
        });
    }

    // Uses historyStatus() (the same classification as the table) so counts and rows always agree.
    function renderHistoryStats(history) {
        const v = history.filter(Boolean).map(h => ({ h, text: historyStatus(h).text }));
        const isPixel = (x) => x.h.verdict === 'pixel' || /^Tracking Pixel/i.test(x.h.reason || '');
        const links = v.filter(x => !isPixel(x));
        const isTracker = (x) => /^Email tracker/.test(x.h.resolver || '') || (x.h.finalUrl === x.h.shortUrl && !!emailTrackerProvider(x.h.shortUrl));
        renderStats('historyStats', [
            [links.length, 'links checked'],
            [links.filter(x => x.h.finalUrl && x.h.finalUrl !== x.h.shortUrl && !/^\(destination hidden/.test(x.h.finalUrl)).length, 'unmasked', 'good', 'The real destination differed from the link in the email'],
            [links.filter(x => /^(Unsafe|Blocked)/.test(x.text)).length, 'flagged', 'bad'],
            [links.filter(x => /^Not verified/.test(x.text)).length, 'not verified', 'warn', 'Could not be checked, or the destination is hidden by an email tracker'],
            [links.filter(isTracker).length, 'email trackers', '', 'Links whose destination is kept by an email provider'],
            [v.filter(isPixel).length, 'pixels blocked'],
            [`${history.length} / ${MAX_HISTORY}`, 'entries kept', '', `History keeps the ${MAX_HISTORY} most recent entries`]
        ]);
    }

    function renderCacheStats(items) {
        const entries = Object.keys(items).filter(k => k.startsWith('http')).map(k => [k, items[k]]).filter(([, v]) => v && typeof v === 'object');
        const by = (re) => entries.filter(([, v]) => re.test(v.resolver || '')).length;
        const lookedUp = by(/unshorten\.me|custom unshortener/i);
        const offline = entries.filter(([k, v]) => v.finalUrl !== k && !/unshorten\.me|custom unshortener/i.test(v.resolver || '')).length;
        const oldest = Math.min(...entries.map(([, v]) => v.cachedTimestamp || Date.now()));
        const bytes = new Blob([JSON.stringify(Object.fromEntries(entries))]).size;
        renderStats('cacheStats', [
            [entries.length, 'cached links'],
            [offline, 'decoded offline', 'good', 'Unwrapped on this device with no network request'],
            [lookedUp, 'looked up online', '', 'Expanded by unshorten.me or your own unshortener'],
            [entries.filter(([k, v]) => v.finalUrl === k).length, 'direct links', '', 'Links that went straight to their destination'],
            [entries.filter(([, v]) => !v.isSafe).length, 'flagged', 'bad'],
            [entries.length ? `${Math.max(0, Math.round((Date.now() - oldest) / 86400000))} d` : '—', 'oldest entry'],
            [bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`, 'storage used']
        ]);
    }

    function renderApplogStats(logs) {
        const recent = logs.filter(l => l && l.timestampMs && Date.now() - l.timestampMs < 86400000);
        const n = (lvl, list) => list.filter(l => (l.level || 'error') === lvl).reduce((a, l) => a + (l.count || 1), 0);
        renderStats('applogStats', [
            [n('error', recent), 'errors (24 h)', n('error', recent) ? 'bad' : 'good'],
            [n('warning', recent), 'warnings (24 h)', n('warning', recent) ? 'warn' : ''],
            [n('info', recent), 'info (24 h)'],
            [`${logs.length} / ${MAX_ERROR_LOGS}`, 'entries kept', '', `Repeats within ${LOG_DEDUPE_MS / 60000} minutes are counted on one entry`]
        ]);
    }

    // ---------------- Logging side menu
    document.querySelectorAll('#logNav button').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('#logNav button').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.log-section').forEach(sec => sec.classList.toggle('active', sec.id === `log-${btn.dataset.log}`));
        ({ applog: renderErrors, history: renderHistory, cache: renderCache, senders: renderSenderLog, spam: renderSpamLog })[btn.dataset.log]();
    }));

    // ---------------- Senders: icons & flags, and Moved to Spam (Gmail sender checks)
    const SENDER_BADGES = { flagged: ['badge-unsafe', '⛔ Flagged'], caution: ['badge-warning', '⚠ Caution'], clean: ['badge-safe', '✓ Checked'],
                            trusted: ['badge-safe', '✓ Trusted'], unverified: ['badge-neutral', 'Not verified'], unknown: ['badge-neutral', 'Unknown'] };
    const cell = (text, style) => { const td = document.createElement('td'); if (style) td.style.cssText = style; if (text !== undefined) td.textContent = text; return td; };
    const emptyRow = (tbody, cols, text) => { const tr = document.createElement('tr'); const td = cell(text, 'color: var(--text-muted);'); td.colSpan = cols; tr.appendChild(td); tbody.appendChild(tr); };
    const statItem = (label, value) => { const d = document.createElement('div'); d.className = 'stat'; const b = document.createElement('b'); b.textContent = value; d.append(b, ` ${label}`); return d; };

    function renderSenderLog() {
        chrome.storage.local.get({ senderResultCache: {}, faviconCache: {} }, (items) => {
            const tbody = document.querySelector('#senderTable tbody');
            if (!tbody) return;
            tbody.replaceChildren();
            const q = (document.getElementById('senderSearch').value || '').toLowerCase().trim();
            const rows = Object.values(items.senderResultCache || {}).filter(v => v && v.r).sort((a, b) => b.ts - a.ts);
            const counts = {};
            rows.forEach(v => { counts[v.r.status] = (counts[v.r.status] || 0) + 1; });
            const icons = Object.values(items.faviconCache || {});
            document.getElementById('senderStats').replaceChildren(statItem('senders remembered', rows.length), statItem('flagged', counts.flagged || 0),
                statItem('caution', counts.caution || 0), statItem('icons remembered', icons.filter(i => i.d).length), statItem('sites without an icon', icons.filter(i => !i.d).length));
            for (const v of rows) {
                const r = v.r;
                const text = `${r.address} ${r.domain} ${r.status} ${(r.reasons || []).join(' ')} ${r.checks || ''}`.toLowerCase();
                if (q && !text.includes(q)) continue;
                const tr = document.createElement('tr');
                const who = cell();
                const code = document.createElement('code'); code.textContent = r.address; who.appendChild(code);
                if (r.move) { const n = document.createElement('div'); n.style.cssText = 'font-size: 11px; color: var(--danger-text);'; n.textContent = 'Its emails are moved to Spam'; who.appendChild(n); }
                const look = cell();
                const fav = items.faviconCache[siteOfSender(r.domain)];
                if (fav && fav.d && /^data:image\//.test(fav.d)) { const img = document.createElement('img'); img.src = fav.d; img.width = 16; img.height = 16; img.alt = ''; img.style.marginRight = '6px'; look.appendChild(img); }
                else { const blank = document.createElement('span'); blank.style.cssText = 'display:inline-block;width:16px;margin-right:6px;'; blank.title = 'No icon'; look.appendChild(blank); }
                if (r.country) {
                    const f = document.createElement('span');
                    f.textContent = `${countryFlag(r.country)} ${countryName(r.country)}`;
                    f.title = r.countrySource === 'host' ? 'Where the sender\'s website is hosted' : 'The country the domain ending names';
                    look.appendChild(f);
                }
                const st = cell();
                const [cls, label] = SENDER_BADGES[r.status] || ['badge-neutral', r.status];
                const badge = document.createElement('span'); badge.className = `badge ${cls}`; badge.textContent = label; st.appendChild(badge);
                const why = cell();
                (r.reasons || []).forEach(t => { const d = document.createElement('div'); d.textContent = t; why.appendChild(d); });
                if (r.checks) { const d = document.createElement('div'); d.style.cssText = 'font-size: 11px; color: var(--text-muted); margin-top: 4px;'; d.textContent = `Checked: ${r.checks}`; why.appendChild(d); }
                tr.append(who, look, st, why, cell(new Date(v.ts).toLocaleString(), 'white-space: nowrap; font-size: 12px;'));
                tbody.appendChild(tr);
            }
            if (!tbody.children.length) emptyRow(tbody, 5, rows.length ? 'No sender matches your search.' : 'No senders checked yet. Open Gmail with sender checks on.');
        });
    }

    const SPAM_ACTIONS = { moved: ['badge-unsafe', 'Moved to Spam'], failed: ['badge-warning', 'Not moved (failed)'], rescued: ['badge-safe', 'Taken out of Spam by you'] };
    function renderSpamLog() {
        chrome.storage.local.get({ spamMoveLog: [] }, (items) => {
            const tbody = document.querySelector('#spamLogTable tbody');
            if (!tbody) return;
            tbody.replaceChildren();
            const log = Array.isArray(items.spamMoveLog) ? items.spamMoveLog : [];
            const q = (document.getElementById('spamLogSearch').value || '').toLowerCase().trim();
            const n = (a) => log.filter(e => e.action === a).length;
            document.getElementById('spamLogStats').replaceChildren(statItem('moved', n('moved')), statItem('not moved', n('failed')), statItem('taken out of Spam by you', n('rescued')));
            for (const e of log) {
                if (q && !`${e.sender} ${e.reason} ${e.how}`.toLowerCase().includes(q)) continue;
                const tr = document.createElement('tr');
                const act = cell();
                const [cls, label] = SPAM_ACTIONS[e.action] || ['badge-neutral', e.action];
                const badge = document.createElement('span'); badge.className = `badge ${cls}`; badge.textContent = label; act.appendChild(badge);
                const who = cell();
                if (e.sender) { const c = document.createElement('code'); c.textContent = e.sender; who.appendChild(c); } else who.textContent = '—';
                const why = cell();
                const r = document.createElement('div'); r.textContent = e.reason || (e.action === 'rescued' ? 'You took this conversation out of Spam; it will never be moved back.' : ''); why.appendChild(r);
                if (e.how) { const h = document.createElement('div'); h.style.cssText = 'font-size: 11px; color: var(--text-muted); margin-top: 4px;'; h.textContent = e.action === 'failed' ? `Why it wasn't moved: ${e.how}` : `How: ${e.how}`; why.appendChild(h); }
                tr.append(cell(new Date(e.ts).toLocaleString(), 'white-space: nowrap; font-size: 12px;'), act, who, why);
                tbody.appendChild(tr);
            }
            if (!tbody.children.length) emptyRow(tbody, 4, log.length ? 'Nothing matches your search.' : 'No emails have been moved to Spam.');
        });
    }
    document.getElementById('senderSearch').addEventListener('input', renderSenderLog);
    document.getElementById('spamLogSearch').addEventListener('input', renderSpamLog);
    document.getElementById('clearSenderCacheBtn').addEventListener('click', () => {
        if (!confirm('Forget the remembered sender checks, icons and countries? They are looked up again as you open Gmail.')) return;
        chrome.storage.local.remove(['senderResultCache', 'faviconCache', 'geoCache', 'senderDomainCache', 'senderMessageCache'], () => {
            reportToLog('info', 'Options page', 'Sender data (checks, icons, countries) cleared by the user.');
            renderSenderLog();
        });
    });
    document.getElementById('clearSpamLogBtn').addEventListener('click', () => {
        if (!confirm('Clear the list of emails moved to Spam? Conversations already moved are still never moved again.')) return;
        chrome.storage.local.set({ spamMoveLog: [] }, () => { reportToLog('info', 'Options page', 'Moved-to-Spam list cleared by the user.'); renderSpamLog(); });
    });

    const LEVEL_BADGES = { error: ['badge-unsafe', 'Error'], warning: ['badge-warning', 'Warning'], info: ['badge-info', 'Info'] };

    function renderErrors() {
        chrome.storage.local.get({ errorLogs: [] }, (result) => {
            const tbody = document.querySelector('#errorsTable tbody');
            tbody.innerHTML = '';
            const filterText = document.getElementById('errorsSearch').value.toLowerCase();
            const levelFilter = document.getElementById('errorsLevelFilter').value;
            renderApplogStats(Array.isArray(result.errorLogs) ? result.errorLogs : []);

            (Array.isArray(result.errorLogs) ? result.errorLogs : []).forEach(log => {
                if (!log) return;
                const level = LEVEL_BADGES[log.level] ? log.level : 'error';      // entries from before 5.14 have no level
                if (levelFilter && level !== levelFilter) return;
                const fields = [log.time, level, log.source, log.message].map(v => String(v || '').toLowerCase());
                if (filterText && !fields.some(f => f.includes(filterText))) return;

                const tr = document.createElement('tr');
                const tdTime = document.createElement('td');
                tdTime.textContent = log.time || '';
                const tdLevel = document.createElement('td');
                const badge = document.createElement('span');
                badge.className = `badge ${LEVEL_BADGES[level][0]}`;
                badge.textContent = LEVEL_BADGES[level][1];
                tdLevel.appendChild(badge);
                const tdSource = document.createElement('td');
                tdSource.textContent = log.source || '—';
                const tdMsg = document.createElement('td');
                tdMsg.textContent = log.message || '';
                if (log.count > 1) {
                    const c = document.createElement('span');
                    c.className = 'log-count';
                    c.textContent = `×${log.count}`;
                    c.title = `Happened ${log.count} times; the time shown is the most recent.`;
                    tdMsg.appendChild(c);
                }
                tr.append(tdTime, tdLevel, tdSource, tdMsg);
                tbody.appendChild(tr);
            });

            if (tbody.children.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="color: var(--text-muted);">No log entries match your filter.</td></tr>';
            }
        });
    }

    function renderRemoteTrackers() {
        chrome.storage.local.get({ remoteShorteners: [] }, (result) => {
            const tbody = document.querySelector('#remoteTrackersTable tbody');
            tbody.innerHTML = '';
            const filterText = document.getElementById('trackersSearch').value.toLowerCase();

            result.remoteShorteners.forEach(domain => {
                if (domain.toLowerCase().includes(filterText)) {
                    const tr = document.createElement('tr');
                    const tdDomain = document.createElement('td');
                    const codeDomain = document.createElement('code');
                    codeDomain.textContent = domain;
                    tdDomain.appendChild(codeDomain);
                    tr.appendChild(tdDomain);
                    tbody.appendChild(tr);
                }
            });

            if (tbody.children.length === 0) {
                tbody.innerHTML = '<tr><td style="color: var(--text-muted);">No synced domains match your filter.</td></tr>';
            }
        });
    }

    const trackersModal = document.getElementById('trackersModal');
    function renderFeedStatus() {
        chrome.storage.local.get(PHISH_FEEDS.map(f => `feed_${f.id}`), (items) => {
            const parts = PHISH_FEEDS.map(f => { const r = items[`feed_${f.id}`]; return r ? `${f.name.split(' ')[0]}: ${r.count.toLocaleString()}` : null; }).filter(Boolean);
            document.getElementById('feedStatus').textContent = parts.length ? `(${parts.join(' · ')} entries)` : '(not downloaded yet)';
        });
    }
    renderFeedStatus();
    document.getElementById('syncFeedsBtn').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('feedStatus').textContent = '(updating…)';
        chrome.runtime.sendMessage({ action: 'syncPhishFeeds' }, (r) => {
            if (r && r.skipped) document.getElementById('feedStatus').textContent = '(turned off)';
            else renderFeedStatus();
        });
    });

    document.getElementById('forceSyncBtn').addEventListener('click', (e) => {
        e.preventDefault();
        const out = document.getElementById('forceSyncResult');
        out.textContent = '(updating…)';
        chrome.runtime.sendMessage({ action: 'forceSync' }, (r) => {
            out.textContent = r ? `(${r.status})` : '(no answer; see Logging → Application log)';
            setTimeout(() => { out.textContent = ''; }, 6000);
        });
    });

    document.getElementById('showRemoteTrackersBtn').addEventListener('click', (e) => {
        e.preventDefault();
        renderRemoteTrackers();
        trackersModal.classList.add('active');
    });

    document.getElementById('closeTrackersModalBtn').addEventListener('click', () => {
        trackersModal.classList.remove('active');
    });

    document.getElementById('trackersSearch').addEventListener('input', renderRemoteTrackers);

    document.getElementById('clearCacheBtn').addEventListener('click', () => {
        chrome.storage.local.get(null, (items) => {
            const keysToRemove = Object.keys(items).filter(k => k.startsWith('http'));   // cached links only
            chrome.storage.local.remove(keysToRemove, () => { reportToLog('info', 'Options page', `URL cache cleared by the user (${keysToRemove.length} entries).`); renderCache(); });
        });
    });

    document.getElementById('clearHistoryBtn').addEventListener('click', () => {
        chrome.storage.local.set({ resolutionHistory: [] }, () => { reportToLog('info', 'Options page', 'Resolution history cleared by the user.'); renderHistory(); });
    });

    document.getElementById('clearErrorsBtn').addEventListener('click', () => {
        chrome.storage.local.set({ errorLogs: [] }, () => renderErrors());
    });

    document.getElementById('exportHistoryCsvBtn').addEventListener('click', () => {
        chrome.storage.local.get({ resolutionHistory: [] }, (result) => {
            const history = result.resolutionHistory;
            if (history.length === 0) { alert("No history to export."); return; }

            const q = (v) => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;
            const headers = ["Timestamp", "Original URL", "Resolved Destination", "Resolved IP", "Status", "Resolved By"];
            const csvRows = history.filter(Boolean).map(item =>
                [q(item.timestamp), q(item.shortUrl), q(item.finalUrl), q(item.resolvedIp || 'N/A'), q(historyStatus(item).text), q(item.resolver || '')].join(','));

            const blob = new Blob([[headers.join(','), ...csvRows].join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `gmail_unshortener_history_${new Date().toISOString().slice(0,10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);   // release the download's memory
        });
    });

    document.getElementById('downloadSettingsBtn').addEventListener('click', () => {
        chrome.storage.local.get(null, (allItems) => {
            // Only settings you actually changed are written, so restoring this file later never
            // overrides a default that a newer version has changed (see buildBackup in shared.js).
            const settingsData = buildBackup(allItems, chrome.runtime.getManifest().version);
            const blob = new Blob([JSON.stringify(settingsData, null, 2)], { type: 'application/json;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `gmail_unshortener_policies_${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
    });

    const importBtn = document.getElementById('importSettingsBtn');
    const importInput = document.getElementById('importFileInput');
    const importModal = document.getElementById('importModal');
    let pendingImportData = null;

    importBtn.addEventListener('click', () => importInput.click());

    // Fills the confirmation dialog from the same planImport() the restore itself uses.
    function showImportPreview() {
        if (!pendingImportData) return;
        const mode = document.querySelector('input[name="importMode"]:checked').value;
        chrome.storage.local.get({ customAllowlist: [], customBlocklist: [], customTrustedSenders: [] }, (current) => {
            let plan;
            try { plan = planImport(pendingImportData, current, mode); }
            catch (err) {
                reportToLog('warning', 'Restore', `The selected file was not restored: ${err.message}`);
                alert(err.message);
                importModal.classList.remove('active');
                pendingImportData = null;
                importInput.value = '';
                return;
            }
            const u = plan.updates;
            document.getElementById('modalAllowCount').textContent = normalizeDomainList(pendingImportData.customAllowlist).length;
            document.getElementById('modalBlockCount').textContent = normalizeDomainList(pendingImportData.customBlocklist).length;
            document.getElementById('modalDohEndpoint').textContent = 'customDohEndpoint' in u ? (u.customDohEndpoint || 'None') : 'Unchanged';
            document.getElementById('modalSettingsCount').textContent = plan.settingsCount;
            document.getElementById('modalPixelAction').textContent = 'removeTrackingPixels' in u
                ? (u.removeTrackingPixels ? 'Completely Delete (DOM Remove)' : 'Silently Neutralize (Hide)')
                : 'Unchanged (not in backup)';
            document.getElementById('modalOtherCount').textContent = plan.cacheCount;
            const notesEl = document.getElementById('modalNotes');
            notesEl.textContent = '';
            plan.notes.forEach(n => { const li = document.createElement('li'); li.textContent = n; notesEl.appendChild(li); });
            notesEl.style.display = plan.notes.length ? 'block' : 'none';
        });
    }

    importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                pendingImportData = JSON.parse(event.target.result);
            } catch (err) {
                reportToLog('warning', 'Restore', `The selected file is not valid JSON and was not restored (${err.message}).`);
                alert(`Invalid JSON format: ${err.message}`);
                importInput.value = '';
                return;
            }
            importModal.classList.add('active');
            showImportPreview();
        };
        reader.readAsText(file);
    });

    document.querySelectorAll('input[name="importMode"]').forEach(r => r.addEventListener('change', showImportPreview));

    document.getElementById('modalCancelBtn').addEventListener('click', () => {
        importModal.classList.remove('active');
        pendingImportData = null;
        importInput.value = '';
    });

    document.getElementById('modalConfirmBtn').addEventListener('click', () => {
        if (!pendingImportData) return;
        const mode = document.querySelector('input[name="importMode"]:checked').value;
        const data = pendingImportData;

        chrome.storage.local.get({ customAllowlist: [], customBlocklist: [], customTrustedSenders: [] }, (current) => {
            let plan;
            try { plan = planImport(data, current, mode); }
            catch (err) { alert(err.message); return; }

            const finish = () => {
                if (chrome.runtime.lastError) {
                    reportToLog('error', 'Restore', `Restoring the backup failed while saving: ${chrome.runtime.lastError.message}`);
                    alert('Restoring the backup failed. See Logging → Application log.');
                    return;
                }
                reportToLog('info', 'Restore', `Settings restored from a backup (${mode})` + (plan.notes.length ? `; ${plan.notes.length} item(s) skipped or adjusted: ${plan.notes.join(' ')}` : '.'));
                importModal.classList.remove('active');
                importInput.value = '';
                pendingImportData = null;
                refreshAllViews();
                alert('Policies and settings restored.' + (plan.notes.length ? '\n\n' + plan.notes.map(n => '• ' + n).join('\n') : ''));
            };
            chrome.storage.local.set(plan.updates, () => {
                if (chrome.runtime.lastError) return finish();
                if (plan.removeKeys.length) chrome.storage.local.remove(plan.removeKeys, finish);
                else finish();
            });
        });
    });

    document.getElementById('exportErrorsBtn').addEventListener('click', () => {
        chrome.storage.local.get({ errorLogs: [] }, (result) => {
            const logs = result.errorLogs;
            if (logs.length === 0) { alert("No diagnostic logs to export."); return; }

            const q = (v) => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;
            const headers = ["Timestamp", "Level", "Source", "Message", "Count"];
            const csvRows = logs.filter(Boolean).map(log => [q(log.time), q(log.level || 'error'), q(log.source || ''), q(log.message), q(log.count || 1)].join(','));

            const blob = new Blob([[headers.join(','), ...csvRows].join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `gmail_unshortener_diagnostic_logs_${new Date().toISOString().slice(0,10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);   // release the download's memory
        });
    });

    document.getElementById('cacheSearch').addEventListener('input', renderCache);
    document.getElementById('cacheDatePicker').addEventListener('change', renderCache);
    document.getElementById('clearCacheDateBtn').addEventListener('click', () => {
        document.getElementById('cacheDatePicker').value = '';
        renderCache();
    });

    document.getElementById('historySearch').addEventListener('input', renderHistory);
    document.getElementById('historyDatePicker').addEventListener('change', renderHistory);
    document.getElementById('clearHistoryDateBtn').addEventListener('click', () => {
        document.getElementById('historyDatePicker').value = '';
        renderHistory();
    });
    document.getElementById('errorsSearch').addEventListener('input', renderErrors);
    document.getElementById('errorsLevelFilter').addEventListener('change', renderErrors);
    // Keep the Logging sections current while the page is open.
    let logRenderTimer = null;
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        const cacheChanged = Object.keys(changes).some(k => k.startsWith('http://') || k.startsWith('https://'));
        if (!(changes.errorLogs || changes.resolutionHistory || cacheChanged || changes.senderResultCache || changes.faviconCache || changes.geoCache || changes.spamMoveLog)) return;
        clearTimeout(logRenderTimer);
        logRenderTimer = setTimeout(() => { renderErrors(); renderHistory(); renderCache(); renderSenderLog(); renderSpamLog(); }, 250);
    });

    
    // --- LINK INSPECTOR LAB WIRING ---
    const inspectBtn = document.getElementById('inspectLinkBtn');
    const inspectInput = document.getElementById('inspectorInput');
    const resultsArea = document.getElementById('inspectorResultsArea');
    const stepsContainer = document.getElementById('inspectorStepsContainer');
    const finalContainer = document.getElementById('finalDestinationContainer');
    const layersBadge = document.getElementById('layersCountBadge');

    inspectBtn.addEventListener('click', () => {
        const urlToInspect = inspectInput.value.trim();
        if (!urlToInspect) {
            alert("Please paste a URL to inspect.");
            return;
        }

        inspectBtn.disabled = true;
        inspectBtn.textContent = "Analyzing...";
        resultsArea.style.display = 'block';
        stepsContainer.innerHTML = '<div style="color: var(--text-muted); padding: 10px;">Decoding the link on this device and checking where it goes…</div>';
        finalContainer.innerHTML = '';

        chrome.runtime.sendMessage({ action: 'testUnwrap', url: urlToInspect }, (response) => {
            inspectBtn.disabled = false;
            inspectBtn.textContent = "Inspect & Decode";

            if (!response) {
                // A crash is logged by the background; an unparseable input is logged here.
                try { new URL(urlToInspect); } catch (e) { reportToLog('info', 'Link Inspector', 'The text entered is not a valid web address, so it could not be inspected.'); }
                stepsContainer.innerHTML = '<div style="color: var(--danger-text);">Failed to analyze link. If the address is valid, see Logging → Application log.</div>';
                return;
            }

            stepsContainer.innerHTML = '';
            const steps = response.steps || [];
            layersBadge.textContent = `${steps.length} Layer(s) Unwrapped`;

            if (steps.length === 0) {
                const directCard = document.createElement('div');
                directCard.className = 'step-card';
                directCard.style.borderLeftColor = 'var(--success-solid)';
                directCard.append(
                    node('div', { className: 'step-header', style: 'color: var(--success-text);' },
                        node('span', null, '✓ Direct link'), node('span', { className: 'step-label' }, 'Nothing to decode')),
                    node('div', { className: 'url-box' }, urlToInspect));
                stepsContainer.appendChild(directCard);
            } else {
                steps.forEach((step, idx) => {
                    const stepCard = document.createElement('div');
                    stepCard.className = 'step-card';
                    stepCard.append(
                        node('div', { className: 'step-header' },
                            node('span', null, `Layer ${step.layer}: ${step.decoder}`),
                            node('span', { className: 'step-label' }, `Pass ${idx + 1} of ${steps.length}`)),
                        node('div', { style: 'font-size: 11px; color: var(--text-muted); margin-bottom: 4px;' }, node('strong', null, 'Before:')),
                        node('div', { className: 'url-box', style: 'margin-bottom: 8px;' }, step.inputUrl),
                        node('div', { className: 'step-arrow' }, '⬇ decoded ⬇'),
                        node('div', { style: 'font-size: 11px; color: var(--success-text); margin-bottom: 4px;' }, node('strong', null, 'After:')),
                        node('div', { className: 'url-box url-box-good' }, step.outputUrl));
                    stepsContainer.appendChild(stepCard);
                });
            }

            // Render Final Destination & Threat Intelligence Card
            const isSafe = response.isSafe;
            const unverified = response.verdict === 'unknown';
            const destCard = document.createElement('div');
            destCard.className = `final-dest-card ${!isSafe ? 'unsafe' : unverified ? 'unverified' : ''}`;

            const badgeClass = unverified ? 'badge-neutral' : (isSafe ? 'badge-safe' : 'badge-unsafe');
            const statusLabel = unverified
                ? `Not verified: ${response.note || 'inconclusive'}`
                : (isSafe ? 'Checked: nothing found' : `Flagged: ${response.reason || 'dangerous'}`);

            destCard.append(
                node('div', { style: 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;' },
                    node('strong', { style: `font-size: 15px; color: ${!isSafe ? 'var(--danger-text)' : unverified ? 'var(--text-2)' : 'var(--success-text)'};` }, '🎯 Where the link goes'),
                    node('span', { className: `badge ${badgeClass}` }, statusLabel)),
                node('div', { className: 'url-box', style: 'margin-bottom: 10px;' }, response.unwrappedUrl || ''),
                node('div', { style: 'display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--text-muted);' },
                    node('div', null,
                        node('strong', null, 'Site address (IP):'), ' ', node('code', null, response.resolvedIp || 'N/A'),
                        node('span', { style: 'margin-left: 12px;' },
                            node('strong', null, 'Checked by:'), ' ', response.scanner === 'Multi-DoH' ? 'several security services' : (response.scanner || 'this device')))));

            if (Array.isArray(response.notes) && response.notes.length) {
                const hdr = document.createElement('div');
                hdr.style.cssText = 'margin-top: 12px; font-size: 12px; font-weight: bold; color: var(--text-2);';
                hdr.textContent = 'How this link was handled:';
                const ul = document.createElement('ul');
                ul.className = 'simple-list';
                ul.style.cssText = 'font-size: 12px; margin: 4px 0 0 0;';
                response.notes.forEach(n => { const li = document.createElement('li'); li.textContent = n; ul.appendChild(li); });
                destCard.appendChild(hdr);
                destCard.appendChild(ul);
            }

            const copyFinalBtn = createCopyBtn(response.unwrappedUrl);
            copyFinalBtn.style.marginTop = '10px';
            destCard.appendChild(copyFinalBtn);

            if (response.resolvedIp && response.resolvedIp !== 'N/A') {
                const whoisBtn = createWhoisBtn(response.resolvedIp);
                whoisBtn.style.marginTop = '10px';
                destCard.appendChild(whoisBtn);
            }

            finalContainer.appendChild(destCard);
        });
    });

    // Builds an element; text children become text nodes, so nothing is ever parsed as HTML.
    function node(tag, props, ...children) {
        const e = document.createElement(tag);
        if (props) {
            if (props.className) e.className = props.className;
            if (props.style) e.style.cssText = props.style;
        }
        e.append(...children.map(c => (c instanceof Node ? c : String(c))));
        return e;
    }

    refreshAllViews();
});

// ---------------------------------------------------------------------------
// ACCESSIBILITY (WCAG 2.1 AA): names, roles and keyboard support, added once the page is built so
// every control (including ones added later) gets them without repeating markup.
// ---------------------------------------------------------------------------
(function enhanceAccessibility() {
    // Tabs: proper tab roles, the selected state, and arrow-key / Home / End navigation.
    const tablist = document.querySelector('.nav-tabs');
    const tabs = [...document.querySelectorAll('.tab-btn')];
    tabs.forEach(b => {
        const panel = document.getElementById(`tab-${b.dataset.tab}`);
        b.setAttribute('role', 'tab');
        b.id = b.id || `tabbtn-${b.dataset.tab}`;
        if (panel) { b.setAttribute('aria-controls', panel.id); panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', b.id); }
    });
    const syncTabs = () => tabs.forEach(b => {
        const on = b.classList.contains('active');
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
    });
    syncTabs();
    new MutationObserver(syncTabs).observe(tablist, { subtree: true, attributes: true, attributeFilter: ['class'] });
    tablist.addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        let i = tabs.indexOf(document.activeElement);
        if (i < 0) return;
        i = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[i].focus();
        tabs[i].click();
        e.preventDefault();
    });

    // Side menus (Logging, Help): announce the current section.
    for (const nav of document.querySelectorAll('.help-nav')) {
        const sync = () => nav.querySelectorAll('button').forEach(b => {
            if (b.classList.contains('active')) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
        });
        sync();
        new MutationObserver(sync).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }

    // Switches and number fields are named after their setting (the row's title), or the service
    // name in a table row.
    document.querySelectorAll('input[data-setting]').forEach(inp => {
        if (inp.getAttribute('aria-label')) return;
        let label = '';
        const text = inp.closest('.setting-row') && inp.closest('.setting-row').querySelector('.setting-text');
        if (text) label = (text.childNodes[0] && text.childNodes[0].textContent || '').trim();
        if (!label) { const strong = inp.closest('tr') && inp.closest('tr').querySelector('td strong'); if (strong) label = strong.textContent.trim(); }
        inp.setAttribute('aria-label', label || inp.dataset.setting);
    });

    // Dialogs close with Escape.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const open = document.querySelector('.modal-overlay.active');
        if (open) open.classList.remove('active');
    });
})();

