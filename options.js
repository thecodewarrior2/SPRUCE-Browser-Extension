// options.js — the Options page: Settings (privacy level, switches, lists, your own services,
// backup), the Link Inspector, and the Logging sections (application log, history, URL cache).
// Help and its live architecture tables are in help.js. Data is always rendered with textContent
// or escaped before insertion.

installPageErrorLogging('Options page');

// Status shown for a Resolution History entry. Entries written before 5.14 have no "verdict".
function historyStatus(item) {
    let verdict = item.verdict;
    // Older entries can't tell "checked" from "not verified", so they are never shown as Safe.
    if (!verdict) verdict = /^Tracking Pixel/i.test(item.reason || '') ? 'pixel' : (item.isSafe ? 'unknown' : 'unsafe');
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

// A click handler for a control that only some browsers' pages have (the others' are removed from the
// page before this file runs: see data-only in options.html and shared.js).
function onClick(id, fn) { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); }

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
        // This installation's own extension ID wherever Help shows the Settings address.
        document.querySelectorAll('.ext-id').forEach(e => { e.textContent = chrome.runtime.id; });
        // The donate button in About, unless the organization hides it (managedHideDonateButton).
        const donate = document.getElementById('donateRow');
        if (donate) donate.hidden = !!(cfg.policy && cfg.policy.hideDonateButton);
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

            let state = 'ok', icon = '✅', title = 'Checks are on';
            if (!S.enableLinkUnmasking) {
                state = 'off'; icon = '⏸️'; title = 'Link checks are switched off';
                details.unshift('Turn on "Reveal where links really go" below to resume');
            } else if (errors.length) {
                state = 'bad'; icon = '❗'; title = `Checks are on, but ${errors.length === 1 ? '1 error' : errors.length + ' errors'} in the last day ${errors.length === 1 ? 'needs' : 'need'} attention`;
            } else if (dnsDown) {
                state = 'warn'; icon = '⚠️'; title = 'Checks are on, with reduced checking';
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
    // Only the user's own choices are reset. Settings managed by the organization (Google Workspace,
    // Intune or Group Policy; Firefox enterprise policy) are left completely alone, including the user's
    // stored value underneath them, so nothing changes if the organization later stops managing a setting.
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
            iconStore.clear().catch(() => {});
            chrome.storage.local.remove([...keys, 'senderMessageCache', 'geoCache', 'senderDomainCache', 'senderResultCache', 'faviconCache'], () => {
                chrome.storage.local.set({ resolutionHistory: [], recentActivity: [] }, () => {
                    reportToLog('info', 'Options page', `Cache, resolution history and activity deleted by the user (${keys.length} cached entries).`);
                    renderCache(); renderHistory();
                });
            });
        });
    });

    // Chrome: the JSON an administrator pastes into Admin console > Policy for extensions.
    onClick('copyPolicyJsonBtn', async () => {
        const cfg = await loadEffectiveSettings();
        const policy = {};
        SETTING_DEFS.forEach(d => { policy[d.managedKey] = { Value: cfg.values[d.key] }; });
        const local = await new Promise(r => chrome.storage.local.get({ customAllowlist: [], customBlocklist: [], customTrustedSenders: [] }, r));
        policy.managedAllowlist = { Value: normalizeDomainList(local.customAllowlist) };
        policy.managedBlocklist = { Value: normalizeDomainList(local.customBlocklist) };
        policy.managedTrustedSenders = { Value: normalizeSenderList(local.customTrustedSenders) };
        const out = document.getElementById('copyPolicyResult');
        try {
            await navigator.clipboard.writeText(JSON.stringify(policy, null, 2));
            out.textContent = 'Copied. Delete any lines you do not want to lock before pasting.';
        } catch (e) {
            out.style.color = 'var(--danger-text)';
            out.textContent = 'Copy failed.';
            reportToLog('warning', 'Options page', `Copying the policy JSON to the clipboard failed: ${e.message || e}`);
        }
    });

    // Firefox: the policy for the current settings, as policies.json or as a Windows script: install the add-on and
    // lock every setting and both lists (policies → 3rdparty → Extensions → add-on ID, read by the
    // extension as storage.managed). addons.mozilla.org finds an add-on by its ID as well as by its
    // address there, so the install address needs nothing filled in.
    const FIREFOX_INSTALL_URL = `https://addons.mozilla.org/firefox/downloads/latest/${chrome.runtime.id}/latest.xpi`;
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
            ExtensionSettings: { [id]: { installation_mode: 'force_installed', install_url: FIREFOX_INSTALL_URL } },
            '3rdparty': { Extensions: { [id]: settings } }
        } }, null, 2);
    }

    // PowerShell for Intune (or any Windows management tool) that writes the same policy to the registry
    // Firefox reads (HKLM\SOFTWARE\Policies\Mozilla\Firefox). The add-on's settings go in as one JSON
    // string, which Firefox parses, so every value keeps its type. Keys are only created when missing:
    // New-Item -Force on an existing key would wipe other add-ons' values under 3rdparty\Extensions.
    function buildFirefoxIntuneScript(settings) {
        const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
        return [
            '# S.P.R.U.C.E+ — Firefox policy for Windows (Microsoft Intune, Group Policy or any management tool).',
            `# Generated ${new Date().toISOString().slice(0, 10)} from the Options page (version ${chrome.runtime.getManifest().version}).`,
            '# Intune: Devices → Scripts and remediations → Platform scripts → Add (Windows 10 and later);',
            '# run as system (logged on credentials: No) in 64-bit PowerShell. Check the result at about:policies.',
            '#',
            '# The add-on is installed from addons.mozilla.org by its ID; to install your own signed .xpi instead,',
            '# set $InstallUrl to its address. Delete any settings in $Settings you do not want to lock.',
            `$AddonId = ${q(chrome.runtime.id)}`,
            `$InstallUrl = ${q(FIREFOX_INSTALL_URL)}`,
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
        ['copyFirefoxPolicyBtn', 'copyFirefoxPolicyResult', buildPoliciesJson, 'Copied. Delete any settings you do not want to lock (and change the install address only for your own signed .xpi).'],
        ['copyFirefoxIntuneBtn', 'copyFirefoxIntuneResult', buildFirefoxIntuneScript, 'Copied. Paste it into a .ps1 file; delete any settings you do not want to lock before deploying.']
    ]) {
        onClick(btn, async () => {
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
        {   // VirusTotal key: shown masked; locked when the administrator sets it.
            const input = document.getElementById('virusTotalKeyInput');
            const locked = !!cfg.locked.virusTotalApiKey;
            input.value = locked ? '' : (cfg.values.virusTotalApiKey || '');
            input.placeholder = locked ? (cfg.values.virusTotalApiKey ? '•••••• (set by your administrator)' : 'Turned off by your administrator') : 'Your VirusTotal API key';
            input.disabled = locked;
            document.getElementById('saveVirusTotalBtn').disabled = locked;
            document.getElementById('managedVirusTotalNotice').style.display = locked ? 'block' : 'none';
        }
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

    document.getElementById('saveVirusTotalBtn').addEventListener('click', async () => {
        const val = document.getElementById('virusTotalKeyInput').value.trim();
        if (val && !/^[A-Za-z0-9]{32,128}$/.test(val)) {
            alert('That doesn\'t look like a VirusTotal API key (a long string of letters and numbers). Copy it from your VirusTotal profile → API key.');
            return;
        }
        if (val) {
            let granted = false;
            try { granted = await chrome.permissions.request({ origins: ['https://www.virustotal.com/*'] }); } catch (e) {}
            if (!granted) {
                reportToLog('warning', 'Settings', 'VirusTotal: the browser did not grant access to www.virustotal.com, so lookups will fail.');
                alert('Access to www.virustotal.com was not granted, so the Link Inspector cannot look links up there.');
            }
        }
        chrome.storage.local.set({ virusTotalApiKey: val }, () => {
            if (chrome.runtime.lastError) {
                reportToLog('error', 'Settings', `VirusTotal key could not be saved: ${chrome.runtime.lastError.message}`);
                alert('The VirusTotal key could not be saved.');
                return;
            }
            reportToLog('info', 'Settings', val ? 'VirusTotal key saved.' : 'VirusTotal key removed.');
            alert(val ? 'VirusTotal key saved. The Link Inspector now shows "Look up on VirusTotal".' : 'VirusTotal key removed.');
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
                    // A malformed entry (null, or fields missing) must not break the whole table.
                    const isObj = cacheData !== null && typeof cacheData === 'object';
                    const finalUrl = String((isObj ? cacheData.finalUrl : cacheData) || '');
                    const resolver = isObj && cacheData.resolver ? cacheData.resolver : 'unshorten.me / Local';
                    const isSafe = isObj && cacheData.isSafe === true;
                    const isUnsafe = isObj && cacheData.isSafe === false;
                    const reason = (isObj ? cacheData.reason : 'Clean') || '';
                    const cachedDate = (isObj ? cacheData.cachedDate : 'N/A') || 'N/A';
                    const cachedTimestamp = isObj ? cacheData.cachedTimestamp : null;

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
                        badgeSpan.className = `badge ${isSafe ? 'badge-safe' : isUnsafe ? 'badge-unsafe' : 'badge-neutral'}`;
                        badgeSpan.textContent = isSafe ? 'Safe' : isUnsafe ? `Unsafe: ${reason}` : 'Not verified';
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

    // The mailbox an entry happened in (several accounts can be signed in), under the entry's time.
    // Entries from before 5.85, and ones not about a mailbox (list updates, Settings), have none.
    function accountNote(td, account) {
        if (!account) return;
        const d = document.createElement('div');
        d.className = 'log-account';
        d.textContent = account;
        d.title = 'The mailbox this happened in';
        td.appendChild(d);
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
                const textMatches = [item.shortUrl, item.finalUrl, item.resolvedIp || '', item.timestamp, status.text, item.resolver || '', item.account || '']
                    .some(v => String(v).toLowerCase().includes(filterText));

                if (dateMatches && textMatches) {
                    const tr = document.createElement('tr');
                    const badgeClass = status.cls;
                    const badgeText = status.text;

                    const tdTime = document.createElement('td');
                    tdTime.textContent = item.timestamp;
                    accountNote(tdTime, item.account);

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
            // The checks compare normalized domains; an entry that can't become one never matches.
            if (!SENDER_DOMAIN_RE.test(normalizeDomain(domain))) {
                const note = document.createElement('span');
                note.className = 'badge badge-neutral';
                note.style.marginLeft = '8px';
                note.title = 'This entry is not a domain name, so it never matches a site. Remove it and add the site\'s domain (like example.com).';
                note.textContent = 'not a domain — no effect';
                tdDomain.appendChild(note);
            }

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
        const raw = input.value.trim();
        if (!raw) return;
        // A pasted address or full URL is reduced to its domain, written the way the checks compare
        // it (lowercase, punycode). Anything that could never match a site is refused instead of
        // sitting in the list without effect.
        let domain = normalizeDomain(raw);
        try { domain = new URL('http://' + domain).hostname; } catch (e) { domain = ''; }
        if (!SENDER_DOMAIN_RE.test(domain)) {
            alert(`"${raw}" doesn't look like a site domain (like example.com), so it wasn't added.`);
            return;
        }
        chrome.storage.local.get({ [storageKey]: [] }, (result) => {
            const list = result[storageKey];
            if (list.some(e => normalizeDomain(e) === domain)) {
                alert("Domain is already in the list.");
            } else {
                list.push(domain);
                chrome.storage.local.set({ [storageKey]: list }, () => {
                    input.value = '';
                    renderPolicies();
                });
            }
        });
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
    const SENDER_BADGES = { flagged: ['badge-unsafe', '⛔ Flagged'], caution: ['badge-warning', '⚠ Caution'], clean: ['badge-neutral', 'Checked, nothing found'],
                            trusted: ['badge-safe', '✓ Trusted'], unverified: ['badge-neutral', 'Not verified'], unknown: ['badge-neutral', 'Unknown'] };
    const cell = (text, style) => { const td = document.createElement('td'); if (style) td.style.cssText = style; if (text !== undefined) td.textContent = text; return td; };
    const emptyRow = (tbody, cols, text) => { const tr = document.createElement('tr'); const td = cell(text, 'color: var(--text-muted);'); td.colSpan = cols; tr.appendChild(td); tbody.appendChild(tr); };
    const statItem = (label, value) => { const d = document.createElement('div'); d.className = 'stat'; const b = document.createElement('b'); b.textContent = value; d.append(b, ` ${label}`); return d; };

    function renderSenderLog() {
        Promise.all([new Promise(r => chrome.storage.local.get({ senderResultCache: {} }, r)), iconStore.all().catch(() => [])]).then(([items, iconRecs]) => {
            const iconBySite = new Map(iconRecs.map(rec => [rec.site, rec]));
            const tbody = document.querySelector('#senderTable tbody');
            if (!tbody) return;
            tbody.replaceChildren();
            const q = (document.getElementById('senderSearch').value || '').toLowerCase().trim();
            const rows = Object.values(items.senderResultCache || {}).filter(v => v && v.r).sort((a, b) => b.ts - a.ts);
            const counts = {};
            rows.forEach(v => { counts[v.r.status] = (counts[v.r.status] || 0) + 1; });
            const withIcon = iconRecs.filter(i => i.bytes);
            const iconKB = withIcon.reduce((n, i) => n + i.bytes.byteLength, 0) / 1024;
            const bySource = (src) => withIcon.filter(i => i.source === src).length;
            document.getElementById('senderStats').replaceChildren(statItem('senders remembered', rows.length), statItem('flagged', counts.flagged || 0),
                statItem('caution', counts.caution || 0), statItem(`icons remembered (${iconKB < 10 ? iconKB.toFixed(1) : Math.round(iconKB)} KB)`, withIcon.length),
                statItem('colleagues\' photos', bySource('avatar-personal')), statItem('company logos', bySource('avatar-logo')),
                statItem('stand-ins from the parent domain', bySource('parent')), statItem('stand-ins from DuckDuckGo', bySource('duckduckgo')),
                statItem('sites without an icon', iconRecs.length - withIcon.length));
            for (const v of rows) {
                const r = v.r;
                const seenIn = Array.isArray(v.seenIn) ? v.seenIn : [];
                const text = `${r.address} ${r.domain} ${r.status} ${(r.reasons || []).join(' ')} ${r.checks || ''} ${seenIn.join(' ')}`.toLowerCase();
                if (q && !text.includes(q)) continue;
                const tr = document.createElement('tr');
                const who = cell();
                const code = document.createElement('code'); code.textContent = r.address; who.appendChild(code);
                if (r.move) { const n = document.createElement('div'); n.style.cssText = 'font-size: 11px; color: var(--danger-text);'; n.textContent = 'Its emails are moved to Spam'; who.appendChild(n); }
                const look = cell();
                const iconRec = iconBySite.get(siteOfSender(r.domain));
                const fav = iconDataUrl(iconRec);
                if (fav) { const img = document.createElement('img'); img.src = fav;
                    img.title = iconRec.source === 'parent' ? `Stand-in: the parent domain's icon (${iconRec.from}); checked again weekly for the site's own`
                        : iconRec.source === 'duckduckgo' ? 'Stand-in: from DuckDuckGo\'s icon service; checked again weekly for the site\'s own' : 'The site\'s own icon'; img.width = 16; img.height = 16; img.alt = ''; img.style.marginRight = '6px'; look.appendChild(img); }
                else { const blank = document.createElement('span'); blank.style.cssText = 'display:inline-block;width:16px;margin-right:6px;'; blank.title = 'No icon'; look.appendChild(blank); }
                // The company's BIMI logo, or when it was last found to have none (asked again after a day).
                const org = registrableDomain(r.domain) || r.domain;
                const bimi = iconBySite.get('bimi:' + org);
                if (bimi && bimi.bytes) {
                    const url = bimi.type === 'text/uri-list' ? new TextDecoder().decode(bimi.bytes) : iconDataUrl(bimi);
                    if (/^(https:|data:image\/)/i.test(url)) { const logo = document.createElement('img'); logo.src = url; logo.referrerPolicy = 'no-referrer'; logo.width = 16; logo.height = 16; logo.alt = '';
                        logo.title = `Company logo (BIMI) for ${org}, shown in the inbox; checked again weekly`; logo.style.cssText = 'margin-right:6px;border-radius:50%;'; look.appendChild(logo); }
                } else if (bimi) look.title = `No company logo (BIMI) for ${org} when checked on ${new Date(bimi.ts).toLocaleString()}; asked again after a day`;
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
                const when = cell(new Date(v.ts).toLocaleString(), 'white-space: nowrap; font-size: 12px;');
                if (seenIn.length) { const d = document.createElement('div'); d.className = 'log-account'; d.textContent = `Seen in: ${seenIn.join(', ')}`; d.style.whiteSpace = 'normal'; when.appendChild(d); }
                tr.append(who, look, st, why, when);
                tbody.appendChild(tr);
            }
            if (!tbody.children.length) emptyRow(tbody, 5, rows.length ? 'No sender matches your search.' : 'No senders checked yet. Open Gmail with sender checks on.');
        });
    }

    const SPAM_ACTIONS = { moved: ['badge-unsafe', 'Moved to Spam'], failed: ['badge-warning', 'Not moved (failed)'], rescued: ['badge-safe', 'Taken out of Spam by you'],
                           kept: ['badge-safe', 'Kept in the inbox by you'] };
    function renderSpamLog() {
        chrome.storage.local.get({ spamMoveLog: [] }, (items) => {
            const tbody = document.querySelector('#spamLogTable tbody');
            if (!tbody) return;
            tbody.replaceChildren();
            const log = Array.isArray(items.spamMoveLog) ? items.spamMoveLog : [];
            const q = (document.getElementById('spamLogSearch').value || '').toLowerCase().trim();
            const n = (a) => log.filter(e => e.action === a).length;
            const accounts = new Set(log.map(e => e.account).filter(Boolean));
            document.getElementById('spamLogStats').replaceChildren(statItem('moved', n('moved')), statItem('not moved', n('failed')),
                statItem('taken out of Spam by you', n('rescued') + log.filter(e => e.rescuedTs).length), statItem('kept in the inbox by you', n('kept')),
                statItem(accounts.size === 1 ? 'account' : 'accounts', accounts.size));
            for (const e of log) {
                if (q && !`${e.sender} ${e.reason} ${e.how} ${e.account || ''}`.toLowerCase().includes(q)) continue;
                const tr = document.createElement('tr');
                const act = cell();
                const [cls, label] = SPAM_ACTIONS[e.action] || ['badge-neutral', e.action];
                const badge = document.createElement('span'); badge.className = `badge ${cls}`; badge.textContent = label; act.appendChild(badge);
                // A move the user undid later: the same line says so, with when.
                if (e.rescuedTs) {
                    const back = document.createElement('div'); back.style.marginTop = '4px';
                    const b2 = document.createElement('span'); b2.className = 'badge badge-safe'; b2.textContent = 'Taken out of Spam by you';
                    const t = document.createElement('div'); t.style.cssText = 'font-size: 11px; color: var(--text-muted); margin-top: 2px; white-space: nowrap;'; t.textContent = new Date(e.rescuedTs).toLocaleString();
                    back.append(b2, t); act.appendChild(back);
                }
                const who = cell();
                if (e.sender) { const c = document.createElement('code'); c.textContent = e.sender; who.appendChild(c); } else who.textContent = '—';
                const why = cell();
                const r = document.createElement('div'); r.textContent = e.reason || (e.action === 'rescued' ? 'You took this conversation out of Spam; it will never be moved back.' : ''); why.appendChild(r);
                if (e.rescuedTs || e.action === 'kept') { const k = document.createElement('div'); k.style.cssText = 'font-size: 11px; color: var(--text-muted); margin-top: 4px;';
                    k.textContent = e.action === 'kept' ? 'You chose Keep it before it was moved; it will never be moved.' : 'You took it back out of Spam; it will never be moved again.'; why.appendChild(k); }
                if (e.how) { const h = document.createElement('div'); h.style.cssText = 'font-size: 11px; color: var(--text-muted); margin-top: 4px;'; h.textContent = e.action === 'failed' ? `Why it wasn't moved: ${e.how}` : `How: ${e.how}`; why.appendChild(h); }
                const acct = cell(e.account || '—', 'font-size: 12px; word-break: break-all;');
                if (!e.account) acct.title = 'Recorded before accounts were noted (version 5.85)';
                tr.append(cell(new Date(e.ts).toLocaleString(), 'white-space: nowrap; font-size: 12px;'), acct, act, who, why);
                tbody.appendChild(tr);
            }
            if (!tbody.children.length) emptyRow(tbody, 5, log.length ? 'Nothing matches your search.' : 'No emails have been moved to Spam.');
        });
    }
    // Typing in a search box re-renders a large table (some renders re-read all of storage): one
    // render shortly after the typing pauses instead of one per keystroke.
    const debounced = (fn, ms = 150) => { let t = null; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
    document.getElementById('senderSearch').addEventListener('input', debounced(renderSenderLog));
    document.getElementById('spamLogSearch').addEventListener('input', debounced(renderSpamLog));
    document.getElementById('clearSenderCacheBtn').addEventListener('click', () => {
        if (!confirm('Forget the remembered sender checks, icons and countries? They are looked up again as you open Gmail.')) return;
        iconStore.clear().catch(() => {}).then(() => chrome.storage.local.remove(['senderResultCache', 'faviconCache', 'geoCache', 'senderDomainCache', 'senderMessageCache'], () => {
            reportToLog('info', 'Options page', 'Sender data (checks, icons, countries) cleared by the user.');
            renderSenderLog();
        }));
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
                const fields = [log.time, level, log.source, log.message, log.account].map(v => String(v || '').toLowerCase());
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
                accountNote(tdSource, log.account);
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

    // Chrome and Edge: PowerShell that writes the current settings as extension policy (Intune etc.).
    // Booleans and numbers → REG_DWORD, text → REG_SZ, lists → a subkey with values named 1, 2, 3…
    function buildRegistryScript(values, allow, block, senders = []) {
        const id = chrome.runtime.id;
        const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
        const lines = [
            '# S.P.R.U.C.E+ — extension policy for Microsoft Edge and Google Chrome on Windows.',
            `# Generated ${new Date().toISOString().slice(0, 10)} from the Options page (version ${chrome.runtime.getManifest().version}).`,
            '# Deploy with Intune (Devices → Scripts and remediations → Platform scripts; run as system, 64-bit),',
            '# Group Policy or any management tool. Check the result at edge://policy or chrome://policy.',
            '#',
            '# IMPORTANT: replace the ID below with the ID of the extension you deploy (store listing or chrome://extensions).',
            `$ExtensionId = ${q(id)}`,
            "$Browsers = @('HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge', 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome')",
            '',
            'foreach ($root in $Browsers) {',
            '    $key = "$root\\3rdparty\\extensions\\$ExtensionId\\policy"',
            '    New-Item -Path $key -Force | Out-Null'
        ];
        SETTING_DEFS.forEach(d => {
            const v = values[d.key];
            if (d.type === 'boolean') lines.push(`    New-ItemProperty -Path $key -Name ${q(d.managedKey)} -PropertyType DWord -Value ${v ? 1 : 0} -Force | Out-Null`);
            else if (d.type === 'integer') lines.push(`    New-ItemProperty -Path $key -Name ${q(d.managedKey)} -PropertyType DWord -Value ${Number(v) || 0} -Force | Out-Null`);
            else if (v !== '' && v !== undefined) lines.push(`    New-ItemProperty -Path $key -Name ${q(d.managedKey)} -PropertyType String -Value ${q(v)} -Force | Out-Null`);
        });
        for (const [name, list] of [['managedAllowlist', allow], ['managedBlocklist', block], ['managedTrustedSenders', senders]]) {
            if (!list.length) continue;
            lines.push(`    Remove-Item -Path "$key\\${name}" -Recurse -Force -ErrorAction SilentlyContinue`);
            lines.push(`    New-Item -Path "$key\\${name}" -Force | Out-Null`);
            list.forEach((dom, i) => lines.push(`    New-ItemProperty -Path "$key\\${name}" -Name '${i + 1}' -PropertyType String -Value ${q(dom)} -Force | Out-Null`));
        }
        lines.push('}', '');
        return lines.join('\r\n');
    }

    onClick('copyRegScriptBtn', async () => {
        const out = document.getElementById('copyRegResult');
        try {
            const cfg = await loadEffectiveSettings();
            await navigator.clipboard.writeText(buildRegistryScript(cfg.values, cfg.allowlist, cfg.blocklist, cfg.trustedSenders));
            out.style.color = ''; out.textContent = 'Copied. Paste it into a .ps1 file; replace the extension ID if it differs.';
        } catch (e) {
            out.style.color = 'var(--danger-text)'; out.textContent = 'Copy failed.';
            reportToLog('warning', 'Options page', `Copying the registry script failed: ${e.message || e}`);
        }
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

    document.getElementById('trackersSearch').addEventListener('input', debounced(renderRemoteTrackers));

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
            const headers = ["Timestamp", "Account", "Original URL", "Resolved Destination", "Resolved IP", "Status", "Resolved By"];
            const csvRows = history.filter(Boolean).map(item =>
                [q(item.timestamp), q(item.account || ''), q(item.shortUrl), q(item.finalUrl), q(item.resolvedIp || 'N/A'), q(historyStatus(item).text), q(item.resolver || '')].join(','));

            const blob = new Blob([[headers.join(','), ...csvRows].join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `spruce_history_${new Date().toISOString().slice(0,10)}.csv`;
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
            a.download = `spruce_policies_${new Date().toISOString().slice(0,10)}.json`;
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
            const headers = ["Timestamp", "Level", "Source", "Account", "Message", "Count"];
            const csvRows = logs.filter(Boolean).map(log => [q(log.time), q(log.level || 'error'), q(log.source || ''), q(log.account || ''), q(log.message), q(log.count || 1)].join(','));

            const blob = new Blob([[headers.join(','), ...csvRows].join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `spruce_diagnostic_logs_${new Date().toISOString().slice(0,10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);   // release the download's memory
        });
    });

    document.getElementById('cacheSearch').addEventListener('input', debounced(renderCache));
    document.getElementById('cacheDatePicker').addEventListener('change', renderCache);
    document.getElementById('clearCacheDateBtn').addEventListener('click', () => {
        document.getElementById('cacheDatePicker').value = '';
        renderCache();
    });

    document.getElementById('historySearch').addEventListener('input', debounced(renderHistory));
    document.getElementById('historyDatePicker').addEventListener('change', renderHistory);
    document.getElementById('clearHistoryDateBtn').addEventListener('click', () => {
        document.getElementById('historyDatePicker').value = '';
        renderHistory();
    });
    document.getElementById('errorsSearch').addEventListener('input', debounced(renderErrors));
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
            inspectBtn.textContent = "Inspect link";

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
            const unverified = isSafe && response.verdict !== 'safe';   // a flagged link is a finding, not "not verified"
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
            finalContainer.appendChild(renderAnalysis(response));
        });
    });

    // --- WHY A LINK MAY BE MALICIOUS: the services' verdicts, offline red flags, second opinions ---
    const LEVEL_STYLE = {
        danger:  { icon: '⛔', color: 'var(--danger-text)', badge: 'badge-unsafe', label: 'Danger' },
        caution: { icon: '⚠️', color: 'var(--warn-text)',   badge: 'badge-warning', label: 'Caution' },
        info:    { icon: 'ℹ️', color: 'var(--text-2)',      badge: 'badge-info', label: 'Note' },
        safe:    { icon: '✓',  color: 'var(--success-text)', badge: 'badge-safe', label: 'OK' }
    };
    const STATUS_TEXT = { flagged: ['Flagged', 'badge-unsafe'], caution: ['Reported', 'badge-warning'], clean: ['Nothing found', 'badge-safe'], 'no answer': ['No answer', 'badge-neutral'], off: ['Off', 'badge-neutral'] };   // caution: [5.98-1]

    function section(title, intro) {
        const box = node('div', { className: 'card', style: 'margin-top: 15px;' }, node('h4', null, title));
        if (intro) box.appendChild(node('p', { className: 'card-intro' }, intro));
        return box;
    }

    function renderAnalysis(r) {
        const wrap = node('div', { className: 'inspector-analysis' });

        // 1. Verdict summary: how many independent services agree.
        if (r.consensus) {
            const st = LEVEL_STYLE[r.consensus.level] || LEVEL_STYLE.info;
            wrap.appendChild(node('div', { className: 'callout-warn', style: `margin-top: 15px; border-left-color: ${st.color};` },
                node('strong', { style: `color: ${st.color};` }, `${st.icon} What the security services say: `), r.consensus.text));
        }

        // 2. Red flags found in the link itself.
        const flags = Array.isArray(r.redFlags) ? r.redFlags : [];
        const rf = section(`🚩 Red flags in the link (${flags.length})`, flags.length
            ? 'Signs found in the address itself, on this device. Each is a reason for care, not proof; several together are a strong warning.'
            : 'No warning signs were found in the address itself. Phishing links can still look ordinary, so this is not proof of safety.');
        rf.id = 'inspectorRedFlags';
        flags.forEach(f => {
            const st = LEVEL_STYLE[f.level] || LEVEL_STYLE.info;
            rf.appendChild(node('div', { className: 'step-card red-flag', style: `border-left-color: ${st.color}; padding: 10px 12px; margin-bottom: 8px;` },
                node('div', { className: 'step-header', style: `color: ${st.color}; margin-bottom: 4px;` },
                    node('span', null, `${st.icon} ${f.title}`), node('span', { className: `badge ${st.badge}` }, st.label)),
                node('div', { style: 'font-size: 12px; color: var(--text-2); line-height: 1.5;' }, f.detail)));
        });
        wrap.appendChild(rf);

        // 3. Each service's own answer, with what a flag from it means.
        const groups = Array.isArray(r.services) ? r.services : [];
        if (groups.length) {
            const sv = section('🛡️ Who checked it', 'Each service\'s own answer. A flag from one service only, while the others find nothing, is the usual sign of a false positive or a very new detection.');
            sv.id = 'inspectorServices';
            const info = r.serviceInfo || {};
            groups.forEach(g => {
                sv.appendChild(node('div', { style: 'font-size: 12px; font-weight: bold; margin: 10px 0 4px 0; color: var(--text-2);' },
                    g.role === 'destination' ? `Destination: ${g.host}` : `The link's own host: ${g.host}`));
                const table = node('table', { style: 'font-size: 12px;' });
                const body = node('tbody');
                g.services.forEach(s => {
                    const [label, badge] = STATUS_TEXT[s.status] || [s.status, 'badge-neutral'];
                    const about = info[s.name] ? info[s.name].what : '';
                    const what = node('td', { style: 'color: var(--text-muted);' }, s.status === 'flagged' && s.reason ? `${s.reason}. ` : (s.reason && s.status !== 'clean' ? `${s.reason}. ` : ''), about);
                    body.appendChild(node('tr', null,
                        node('td', { style: 'white-space: nowrap; font-weight: 600;' }, s.name + (s.security ? '' : ' (content filter)')),
                        node('td', { style: 'white-space: nowrap;' }, node('span', { className: `badge ${badge}` }, label)),
                        what));
                });
                table.appendChild(body);
                sv.appendChild(table);
            });
            wrap.appendChild(sv);
        }

        // 4. A tracking or short link with an unknown destination: follow it, only on request.
        if (r.revealable) wrap.appendChild(revealPanel(r));

        // 5. Second opinions: pages the person opens themselves (only the site name is in the link).
        const so = section('🔎 Get a second opinion', 'These free services open in a new tab with the site name filled in (never the full link). Useful when the services above disagree.');
        so.id = 'inspectorSecondOpinion';
        const ul = node('ul', { className: 'simple-list', style: 'font-size: 12px; margin: 0;' });
        (r.secondOpinion || []).forEach(l => {
            const a = node('a', null, l.name);
            a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
            ul.appendChild(node('li', null, a, ` — ${l.what}`));
        });
        so.appendChild(ul);
        so.appendChild(vtPanel(r));
        wrap.appendChild(so);
        return wrap;
    }

    function revealPanel(r) {
        const box = section('↪️ Reveal where it goes', 'The destination is hidden by the sender\'s tracking service (encrypted, or kept on its server), so it can\'t be decoded. Following the link reveals it: one request from this browser, without your cookies and without opening the page. It counts as a click, as if you had clicked it in the email: the sender sees that you did. If it could be an unsubscribe, sign-in or confirmation link, following it may act on it, so don\'t.');
        box.id = 'inspectorReveal';
        const out = node('div', { className: 'reveal-result', style: 'margin-top: 8px; font-size: 12px;' });
        const btn = node('button', { className: 'btn-action' }, 'Follow it to reveal the destination (counts as a click)');
        btn.id = 'followLinkBtn';
        btn.addEventListener('click', () => {
            // Asked inside the click itself (Firefox accepts permission requests only there).
            const asked = (() => { try { return chrome.permissions.request({ origins: ['https://*/*'] }); } catch (e) { return Promise.resolve(false); } })();
            btn.disabled = true;
            out.textContent = 'Following the link…';
            Promise.resolve(asked).catch(() => false).then((granted) => {
                if (!granted) reportToLog('info', 'Link Inspector', 'Access to websites was not granted, so the link may not be followable.');
                chrome.runtime.sendMessage({ action: 'followLink', url: r.unwrappedUrl }, (res) => {
                    btn.disabled = false;
                    out.textContent = '';
                    if (!res || res.error) { out.appendChild(node('span', { style: 'color: var(--danger-text);' }, (res && res.error) || 'No answer.')); return; }
                    const inspect = node('button', { className: 'btn-action', style: 'margin-left: 8px;' }, 'Inspect the destination');
                    inspect.addEventListener('click', () => { inspectInput.value = res.finalUrl; inspectBtn.click(); });
                    out.append(node('div', { style: 'font-weight: bold;' }, 'It goes to:'), node('div', { className: 'url-box', style: 'margin: 4px 0;' }, res.finalUrl), inspect);
                });
            });
        });
        box.append(btn, out);
        return box;
    }

    // VirusTotal: only with the person's own key, only on click.
    function vtPanel(r) {
        const box = node('div', { className: 'vt-panel', style: 'margin-top: 12px;' });
        if (!r.virusTotalReady) {
            box.appendChild(node('p', { className: 'card-intro', style: 'margin: 0;' },
                'Want the results right here? Add a free VirusTotal API key in Settings → Privacy level → Your own services.'));
            return box;
        }
        const out = node('div', { className: 'vt-result', style: 'margin-top: 8px; font-size: 12px;' });
        const btn = node('button', { className: 'btn-action' }, r.oneTime ? 'Look up the site on VirusTotal' : 'Look up on VirusTotal');
        btn.id = 'virusTotalBtn';
        btn.addEventListener('click', () => runVt({ mode: 'lookup', url: r.unwrappedUrl }, out, r));
        box.append(btn, out);
        if (r.oneTime) box.appendChild(node('p', { className: 'card-intro', style: 'margin: 6px 0 0 0;' }, 'This looks like a one-time link, so only its site name is sent to VirusTotal.'));
        return box;
    }

    function runVt(req, out, r) {
        out.textContent = req.mode === 'submit' ? 'Submitting to VirusTotal…' : 'Asking VirusTotal…';
        chrome.runtime.sendMessage(Object.assign({ action: 'virusTotal' }, req), (res) => {
            out.textContent = '';
            if (!res || res.error) { out.appendChild(node('span', { style: 'color: var(--danger-text);' }, (res && res.error) || 'No answer.')); return; }
            if (res.submitted) { pollVt(res.id, out, r, 0); return; }
            showVt(res, out, r);
        });
    }

    // A submitted scan takes about a minute; the free key allows 4 requests a minute, so it is asked 3 times, 20 s apart.
    function pollVt(id, out, r, tries) {
        out.textContent = `Scanning on VirusTotal… (check ${tries + 1} of 3, about 20 seconds apart)`;
        setTimeout(() => {
            chrome.runtime.sendMessage({ action: 'virusTotal', mode: 'analysis', id, url: r.unwrappedUrl }, (res) => {
                if (res && !res.error && res.status === 'completed') { out.textContent = ''; showVt(res, out, r); return; }
                if (tries < 2 && !(res && res.error)) { pollVt(id, out, r, tries + 1); return; }
                out.textContent = (res && res.error) || 'The scan is still running. Click "Look up on VirusTotal" again in a minute.';
            });
        }, 20000);
    }

    function showVt(v, out, r) {
        const s = v.stats || {};
        const total = (s.malicious || 0) + (s.suspicious || 0) + (s.harmless || 0) + (s.undetected || 0);
        const bad = (s.malicious || 0) + (s.suspicious || 0);
        const level = s.malicious >= 3 ? 'danger' : bad ? 'caution' : 'safe';
        const st = LEVEL_STYLE[level];
        const what = v.kind === 'domain' ? `the site ${v.target}` : 'this exact link';
        if (v.urlNotFound) out.appendChild(node('p', { style: 'margin: 0 0 6px 0; color: var(--text-muted);' }, 'VirusTotal has never scanned this exact link, so its report for the whole site is shown.'));
        if (v.note) out.appendChild(node('p', { style: 'margin: 0 0 6px 0; color: var(--text-muted);' }, v.note));
        out.appendChild(node('div', { style: `font-weight: bold; color: ${st.color};` },
            `${st.icon} VirusTotal: ${s.malicious || 0} malicious, ${s.suspicious || 0} suspicious, out of ${total} vendors, for ${what}` + (v.analyzed ? ` (scanned ${new Date(v.analyzed).toLocaleDateString()})` : '') + '.'));
        const explain = level === 'danger' ? 'Several security vendors agree this is dangerous.'
            : bad === 1 ? 'Only one vendor flags it. A single detection among dozens is often a false positive, but check the red flags above.'
            : bad ? 'A few vendors have doubts. Treat it with care.'
            : 'No vendor flags it. That means no one has reported it yet, not that it is safe.';
        out.appendChild(node('p', { style: 'margin: 4px 0;' }, explain));
        if (v.engines && v.engines.length) {
            const ul = node('ul', { className: 'simple-list', style: 'margin: 4px 0; font-size: 12px;' });
            v.engines.forEach(e => ul.appendChild(node('li', null, node('strong', null, e.engine), `: ${e.result} (${e.category})`)));
            out.append(node('div', { style: 'font-weight: 600; margin-top: 6px;' }, 'Vendors that flag it, and what they call it:'), ul);
        }
        const extra = [];
        if (v.categories && v.categories.length) extra.push(`Categories: ${v.categories.join(', ')}`);
        if (typeof v.reputation === 'number') extra.push(`Community reputation: ${v.reputation}`);
        if (v.created) extra.push(`Domain registered: ${new Date(v.created * 1000).toLocaleDateString()}`);
        if (v.finalUrl && v.finalUrl !== r.unwrappedUrl) extra.push(`VirusTotal followed it to: ${v.finalUrl}`);
        if (v.title) extra.push(`Page title: ${v.title}`);
        extra.forEach(t => out.appendChild(node('div', { style: 'color: var(--text-muted);' }, t)));
        if (v.urlNotFound && !r.oneTime) {
            const sub = node('button', { className: 'btn-action', style: 'margin-top: 8px;' }, 'Scan this link on VirusTotal');
            sub.addEventListener('click', () => {
                if (!confirm('VirusTotal will visit the link and share it with its community and security partners. Don\'t submit links that contain personal information. Continue?')) return;
                runVt({ mode: 'submit', url: r.unwrappedUrl }, out, r);
            });
            out.appendChild(sub);
        }
    }

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


// ---------------------------------------------------------------------------
// OTHER EXTENSIONS THAT DO THE SAME JOB (Settings → Other extensions). Lists the ones found in the
// webmail page (content.js) and, once the user allows it (the browser asks: optional "management"
// permission), the installed ones from OVERLAPPING_EXTENSIONS. Each can be turned off with one click
// (Chrome; Firefox lets only the user turn other add-ons off, so it gets the steps), or our own
// matching feature can be turned off instead, or the warning ignored.
// ---------------------------------------------------------------------------
(() => {
    const listEl = document.getElementById('conflictList');
    if (!listEl) return;
    const isFirefox = BROWSER === 'firefox';
    const hasManagement = () => new Promise(r => { try { chrome.permissions.contains({ permissions: ['management'] }, r); } catch (e) { r(false); } });

    async function installedConflicts() {
        if (!(await hasManagement()) || !chrome.management) return [];
        const all = await new Promise(r => chrome.management.getAll(r));
        return all.filter(x => x.enabled && x.id !== chrome.runtime.id).map(x => {
            const known = OVERLAPPING_EXTENSIONS.find(k => k.ids.includes(x.id) || (k.geckoIds || []).includes(x.id));
            return known ? { key: x.id, name: x.name || known.name, does: known.does, features: known.features, via: 'installed', ts: Date.now() } : null;
        }).filter(Boolean);
    }

    // Several redraws can be under way at once (a button's own redraw and the storage change it
    // causes): each builds its list apart, and only the latest one is put on the page.
    let renderSeq = 0;
    async function render() {
        const seq = ++renderSeq;
        const cfg = await loadEffectiveSettings();
        const st = await new Promise(r => chrome.storage.local.get({ detectedConflicts: {}, ignoredConflicts: [], keptConflictFeatures: {} }, r));
        const map = Object.assign({}, st.detectedConflicts || {});
        for (const c of await installedConflicts()) map[c.key] = Object.assign({}, map[c.key] || {}, c);
        const ignored = new Set(st.ignoredConflicts || []);
        const keptOn = st.keptConflictFeatures || {};
        const items = Object.values(map).sort((a, b) => (b.ts || 0) - (a.ts || 0));
        const management = await hasManagement();
        // Firefox lets an add-on turn others off only when it was itself installed by the organization's
        // policy (management.setEnabled); otherwise the user turns them off in about:addons.
        const policyInstalled = isFirefox && management && chrome.management && chrome.management.getSelf
            ? await new Promise(r => { try { chrome.management.getSelf(s => { void chrome.runtime.lastError; r(!!s && s.installType === 'admin'); }); } catch (e) { r(false); } })
            : false;
        if (seq !== renderSeq) return;
        const out = document.createDocumentFragment();
        if (!items.length) {
            const p = document.createElement('p'); p.className = 'setting-desc'; p.textContent = 'No other extension doing the same job has been found.'; out.appendChild(p);
        }
        for (const c of items) {
            const box = document.createElement('div'); box.className = 'conflict-item';
            const title = document.createElement('div');
            const b = document.createElement('b'); b.textContent = c.name;
            title.append(b, ` also does ${c.does}`, c.site ? ` (seen in ${c.site})` : '', c.via === 'installed' ? ' (installed)' : '', ignored.has(c.key) ? ' · ignored' : '');
            const ours = (c.features || []).filter(k => SETTING_BY_KEY[k]);
            const oursOn = ours.filter(k => cfg.values[k]);
            const settled = oursOn.length && conflictSettled(oursOn, keptOn[c.key]);
            const note = document.createElement('div'); note.className = 'setting-desc';
            note.textContent = !oursOn.length ? 'Our matching settings are off, so there is no conflict.'
                : settled ? `You turned off the rest and kept ours on: ${oursOn.map(k => FEATURE_NAMES[k] || k).join(', ')}. You won't be warned again unless one you turned off is turned back on.`
                : `Ours does the same with: ${oursOn.map(k => FEATURE_NAMES[k] || k).join(', ')}. We recommend keeping ours on and turning ${c.name === 'Another extension' ? 'the other one' : c.name} off, or turn off just the settings of ours that overlap.`;
            const actions = document.createElement('div'); actions.className = 'actions';
            const btn = (label, cls, fn) => { const x = document.createElement('button'); x.type = 'button'; x.className = cls; x.textContent = label; x.addEventListener('click', fn); actions.appendChild(x); return x; };
            const canTurnOff = isFirefox ? c.via === 'installed' && policyInstalled : /^[a-p]{32}$/.test(c.key);
            const extensionsPage = isFirefox ? 'about:addons' : 'chrome://extensions';
            if (canTurnOff) {
                btn(`Turn off ${c.name}`, 'btn-primary', async () => {
                    const granted = management || await new Promise(r => chrome.permissions.request({ permissions: ['management'] }, r));
                    if (!granted) { note.textContent = `Not allowed: your browser didn't give permission. You can turn it off yourself in ${extensionsPage}.`; return; }
                    chrome.management.setEnabled(c.key, false, () => {
                        if (chrome.runtime.lastError) { note.textContent = `${c.name} couldn't be turned off (${chrome.runtime.lastError.message}). Turn it off in ${extensionsPage}.`; return; }
                        reportToLog('info', 'Options page', `${c.name} turned off by the user (it did the same job as this extension).`);
                        chrome.storage.local.get({ detectedConflicts: {} }, r => { const m = r.detectedConflicts || {}; delete m[c.key]; chrome.storage.local.set({ detectedConflicts: m }, render); });
                    });
                });
            } else {
                const how = document.createElement('div'); how.className = 'setting-desc';
                const other = c.name === 'Another extension' ? 'the other one' : c.name;
                how.textContent = BROWSER === 'safari' ? `Safari lets only you turn other extensions off: open Safari → Settings → Extensions and uncheck ${other} (on iPhone or iPad: the Settings app → Apps → Safari → Extensions).`
                    : isFirefox ? `Firefox lets only you turn other add-ons off: open the menu ☰ → Add-ons and themes → Extensions, and turn ${other} off.`
                    : `To turn ${c.name === 'Another extension' ? 'it' : c.name} off: open chrome://extensions and switch it off there.`;
                box.appendChild(how);
            }
            // Only the overlapping settings of ours: one at a time, or all of them.
            const offButton = (keys, label) => {
                const x = btn(label, 'btn-action', () => turnOffForConflict(c.key, oursOn, keys, cfg.locked, (done) => {
                    if (done.length) reportToLog('info', 'Options page', `Turned off our ${done.map(k => FEATURE_NAMES[k] || k).join(' and ')} because ${c.name} does the same job.`);
                    render();
                }));
                if (keys.every(k => cfg.locked[k])) { x.disabled = true; x.title = 'Set by your organization'; }
            };
            if (oursOn.length > 1) oursOn.forEach(k => offButton([k], `Turn off only our ${FEATURE_NAMES[k] || k}`));
            if (oursOn.length) offButton(oursOn, oursOn.length > 1 ? 'Turn off all of ours' : `Turn off our ${FEATURE_NAMES[oursOn[0]] || oursOn[0]}`);
            btn(ignored.has(c.key) || settled ? 'Warn me again' : 'Ignore', 'btn-action', () => {
                chrome.storage.local.get({ ignoredConflicts: [], keptConflictFeatures: {} }, r => {
                    const set = new Set(r.ignoredConflicts || []);
                    const keptMap = r.keptConflictFeatures || {};
                    if (set.has(c.key) || settled) { set.delete(c.key); delete keptMap[c.key]; } else set.add(c.key);
                    chrome.storage.local.set({ ignoredConflicts: [...set], keptConflictFeatures: keptMap }, render);
                });
            });
            box.prepend(title, note);
            box.appendChild(actions);
            out.appendChild(box);
        }
        listEl.replaceChildren(out);
    }

    onClick('checkExtensionsBtn', async () => {
        // Asked at once, inside the click: Firefox refuses a permission request made after anything
        // else was awaited. A permission already given is answered "yes" without asking again.
        const granted = await new Promise(r => {
            try { chrome.permissions.request({ permissions: ['management'] }, (g) => { void chrome.runtime.lastError; r(!!g); }); } catch (e) { r(false); }
        });
        document.getElementById('checkExtensionsNote').textContent = granted ? 'Checked just now.' : 'Not checked: your browser didn\'t give permission. Extensions found in the webmail page are still listed.';
        render();
    });
    chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.detectedConflicts || ch.ignoredConflicts || ch.keptConflictFeatures || ch.enableSenderIdentity || ch.enableSenderAvatars || ch.enableRowHighlighter || ch.enableTrackingPixelBlocking)) render(); });
    render();

    // Row highlighter preview: the chosen color as a sample row.
    async function preview() {
        const cfg = await loadEffectiveSettings();
        const el = document.getElementById('rowHlPreview');
        if (!el) return;
        const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
        const style = cfg.values.rowHighlightStyle;
        const paint = (box, color, on) => {
            if (!box) return;
            const c = ROW_HIGHLIGHT_COLORS[color] || ROW_HIGHLIGHT_COLORS.yellow;
            box.style.background = style === 'outline' ? 'transparent' : (dark ? c.dark : c.light);
            box.style.outline = style === 'fill' ? 'none' : `2px solid ${dark ? c.accentDark : c.accent}`;
            box.style.opacity = on ? '1' : '0.4';
        };
        paint(el, cfg.values.rowHighlightColor, cfg.values.enableRowHighlighter);
        paint(document.getElementById('rowHlSelPreview'), cfg.values.rowHighlightSelectedColor, cfg.values.enableRowHighlighter && cfg.values.rowHighlightSelected);
        // The same color for both is allowed, with a warning that the two can be confused.
        const same = document.getElementById('rowHlSameWarning');
        if (same) same.hidden = !(cfg.values.enableRowHighlighter && cfg.values.rowHighlightSelected && cfg.values.rowHighlightColor === cfg.values.rowHighlightSelectedColor);
    }
    chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.rowHighlightColor || ch.rowHighlightSelectedColor || ch.rowHighlightSelected || ch.rowHighlightStyle || ch.enableRowHighlighter)) preview(); });
    preview();

    // Opened from the webmail's notice (options.html#conflicts): this card.
    if (location.hash === '#conflicts') {
        const t = document.querySelector('.tab-btn[data-tab="settings"]'); if (t) t.click();
        setTimeout(() => document.getElementById('conflicts').scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    }
})();
