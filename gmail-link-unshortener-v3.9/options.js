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
        a.style.backgroundColor = '#f1f3f4';
        a.style.color = '#1a73e8';
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
        loadPixelSettings();
    }

    function loadPixelSettings() {
        chrome.storage.local.get({ removeTrackingPixels: false }, (localRes) => {
            if (chrome.storage.managed) {
                chrome.storage.managed.get(['managedRemoveTrackingPixels'], (managedRes) => {
                    if (chrome.runtime.lastError) managedRes = {};
                    if (typeof managedRes.managedRemoveTrackingPixels === 'boolean') {
                        document.getElementById('managedPixelNotice').style.display = 'block';
                        const toggle = document.getElementById('removePixelsToggle');
                        toggle.checked = managedRes.managedRemoveTrackingPixels;
                        toggle.disabled = true;
                    } else {
                        document.getElementById('removePixelsToggle').checked = !!localRes.removeTrackingPixels;
                    }
                });
            } else {
                document.getElementById('removePixelsToggle').checked = !!localRes.removeTrackingPixels;
            }
        });
    }

    document.getElementById('removePixelsToggle').addEventListener('change', (e) => {
        chrome.storage.local.set({ removeTrackingPixels: e.target.checked });
    });

    function loadDohSettings() {
        chrome.storage.local.get(['customDohEndpoint'], (local) => {
            if (chrome.storage.managed) {
                chrome.storage.managed.get(['managedDohEndpoint'], (managed) => {
                    if (chrome.runtime.lastError) managed = {};
                    
                    if (managed.managedDohEndpoint) {
                        document.getElementById('managedDohNotice').style.display = 'block';
                        document.getElementById('customDohInput').value = managed.managedDohEndpoint;
                        document.getElementById('customDohInput').disabled = true;
                        document.getElementById('saveDohBtn').disabled = true;
                    } else {
                        document.getElementById('customDohInput').value = local.customDohEndpoint || '';
                    }
                });
            } else {
                document.getElementById('customDohInput').value = local.customDohEndpoint || '';
            }
        });
    }

    document.getElementById('saveDohBtn').addEventListener('click', () => {
        const val = document.getElementById('customDohInput').value.trim();
        chrome.storage.local.set({ customDohEndpoint: val }, () => {
            alert('Custom DoH Endpoint Saved!');
        });
    });

    async function executeResolverTest(url, resultSpan) {
        resultSpan.style.display = 'inline-block';
        resultSpan.className = 'test-result';
        resultSpan.style.color = '#5f6368';
        resultSpan.style.backgroundColor = '#e8eaed';
        resultSpan.textContent = 'Testing...';

        chrome.runtime.sendMessage({ action: 'testResolver', url: url }, (response) => {
            if (response && response.success) {
                resultSpan.textContent = response.message;
                resultSpan.className = 'test-result result-pass';
            } else {
                resultSpan.textContent = response ? response.message : 'Unknown Error';
                resultSpan.className = 'test-result result-fail';
            }
        });
    }

    document.getElementById('testCustomDohBtn').addEventListener('click', () => {
        const url = document.getElementById('customDohInput').value.trim();
        const resSpan = document.getElementById('customDohResult');
        if (!url) {
            resSpan.style.display = 'inline-block';
            resSpan.textContent = 'Please enter a URL first.';
            resSpan.className = 'test-result result-fail';
            return;
        }
        executeResolverTest(url, resSpan);
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

    function renderCache() {
        chrome.storage.local.get(null, (items) => {
            const tbody = document.querySelector('#cacheTable tbody');
            tbody.innerHTML = '';

            const reservedKeys = ['customBlocklist', 'customAllowlist', 'customDohEndpoint', 'removeTrackingPixels', 'errorLogs', 'lastSyncTime', 'remoteShorteners', 'resolutionHistory', 'recentActivity'];
            const filterText = document.getElementById('cacheSearch').value.toLowerCase();

            Object.keys(items).forEach(key => {
                if (!reservedKeys.includes(key) && key.startsWith('http')) {
                    const shortUrl = key;
                    const cacheData = items[key];
                    const finalUrl = typeof cacheData === 'object' ? cacheData.finalUrl : cacheData;
                    const resolver = typeof cacheData === 'object' && cacheData.resolver ? cacheData.resolver : 'unshorten.me / Local';
                    const isSafe = typeof cacheData === 'object' ? cacheData.isSafe : true;
                    const reason = typeof cacheData === 'object' ? cacheData.reason : 'Clean';
                    const cachedDate = typeof cacheData === 'object' ? cacheData.cachedDate : 'N/A';

                    if (shortUrl.toLowerCase().includes(filterText) || finalUrl.toLowerCase().includes(filterText) || resolver.toLowerCase().includes(filterText)) {
                        const tr = document.createElement('tr');
                        
                        const tdShort = document.createElement('td');
                        const codeShort = document.createElement('code');
                        codeShort.textContent = shortUrl;
                        tdShort.appendChild(codeShort);

                        const tdFinal = document.createElement('td');
                        const codeFinal = document.createElement('code');
                        codeFinal.textContent = finalUrl;
                        tdFinal.appendChild(codeFinal);

                        const tdResolver = document.createElement('td');
                        const badgeResolver = document.createElement('span');
                        badgeResolver.style.fontSize = '11px';
                        badgeResolver.style.fontWeight = 'bold';
                        badgeResolver.style.color = '#1a73e8';
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
                tbody.innerHTML = '<tr><td colspan="5" style="color:#5f6368;">No cached URLs found.</td></tr>';
            }
        });
    }

    function renderHistory() {
        chrome.storage.local.get({ resolutionHistory: [] }, (result) => {
            const tbody = document.querySelector('#historyTable tbody');
            tbody.innerHTML = '';

            const filterText = document.getElementById('historySearch').value.toLowerCase();

            result.resolutionHistory.forEach(item => {
                const shortMatch = item.shortUrl.toLowerCase().includes(filterText);
                const finalMatch = item.finalUrl.toLowerCase().includes(filterText);
                const ipMatch = (item.resolvedIp || '').toLowerCase().includes(filterText);
                const timeMatch = item.timestamp.toLowerCase().includes(filterText);

                if (shortMatch || finalMatch || ipMatch || timeMatch) {
                    const tr = document.createElement('tr');
                    const badgeClass = item.isSafe ? 'badge-safe' : 'badge-unsafe';
                    const badgeText = item.isSafe ? 'Safe' : `Unsafe: ${item.reason}`;

                    const tdTime = document.createElement('td');
                    tdTime.textContent = item.timestamp;

                    const tdShort = document.createElement('td');
                    const codeShort = document.createElement('code');
                    codeShort.textContent = item.shortUrl;
                    tdShort.appendChild(codeShort);
                    tdShort.appendChild(createCopyBtn(item.shortUrl));

                    const tdFinal = document.createElement('td');
                    const codeFinal = document.createElement('code');
                    codeFinal.textContent = item.finalUrl;
                    tdFinal.appendChild(codeFinal);
                    tdFinal.appendChild(createCopyBtn(item.finalUrl));

                    const tdIp = document.createElement('td');
                    const codeIp = document.createElement('code');
                    codeIp.textContent = item.resolvedIp || 'N/A';
                    tdIp.appendChild(codeIp);
                    if (item.resolvedIp && item.resolvedIp !== 'N/A') {
                        tdIp.appendChild(createCopyBtn(item.resolvedIp));
                        tdIp.appendChild(createWhoisBtn(item.resolvedIp));
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
                tbody.innerHTML = '<tr><td colspan="5" style="color:#5f6368;">No resolution history found.</td></tr>';
            }
        });
    }

    function renderPolicies() {
        chrome.storage.local.get({ customBlocklist: [], customAllowlist: [] }, (localResult) => {
            if (chrome.storage.managed) {
                chrome.storage.managed.get(['managedAllowlist', 'managedBlocklist'], (managedResult) => {
                    if (chrome.runtime.lastError) managedResult = {};
                    
                    if (managedResult.managedAllowlist || managedResult.managedBlocklist) {
                        document.getElementById('managedPolicyNotice').style.display = 'block';
                    }
                    
                    const combinedAllow = [...new Set([...(localResult.customAllowlist || []), ...(managedResult.managedAllowlist || [])])];
                    const combinedBlock = [...new Set([...(localResult.customBlocklist || []), ...(managedResult.managedBlocklist || [])])];
                    
                    renderPolicyTable('allowTable', combinedAllow, managedResult.managedAllowlist || [], 'customAllowlist');
                    renderPolicyTable('blockTable', combinedBlock, managedResult.managedBlocklist || [], 'customBlocklist');
                });
            } else {
                renderPolicyTable('allowTable', localResult.customAllowlist || [], [], 'customAllowlist');
                renderPolicyTable('blockTable', localResult.customBlocklist || [], [], 'customBlocklist');
            }
        });
    }

    function renderPolicyTable(tableId, allDomains, managedDomains, storageKey) {
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
            tbody.innerHTML = '<tr><td colspan="2" style="color:#5f6368;">No domains in this list.</td></tr>';
        }
    }

    document.getElementById('addAllowBtn').addEventListener('click', () => {
        addDomainToPolicy('domainAllowInput', 'customAllowlist');
    });

    document.getElementById('addBlockBtn').addEventListener('click', () => {
        addDomainToPolicy('domainBlockInput', 'customBlocklist');
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

    function renderErrors() {
        chrome.storage.local.get({ errorLogs: [] }, (result) => {
            const tbody = document.querySelector('#errorsTable tbody');
            tbody.innerHTML = '';
            const filterText = document.getElementById('errorsSearch').value.toLowerCase();

            result.errorLogs.forEach(log => {
                if (log.time.toLowerCase().includes(filterText) || log.message.toLowerCase().includes(filterText)) {
                    const tr = document.createElement('tr');
                    const tdTime = document.createElement('td');
                    tdTime.textContent = log.time;
                    const tdMsg = document.createElement('td');
                    tdMsg.style.color = '#c5221f';
                    tdMsg.textContent = log.message;
                    tr.appendChild(tdTime);
                    tr.appendChild(tdMsg);
                    tbody.appendChild(tr);
                }
            });

            if (tbody.children.length === 0) {
                tbody.innerHTML = '<tr><td colspan="2" style="color:#5f6368;">No diagnostic errors found.</td></tr>';
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
                tbody.innerHTML = '<tr><td style="color:#5f6368;">No synced domains match your filter.</td></tr>';
            }
        });
    }

    const trackersModal = document.getElementById('trackersModal');
    document.getElementById('showRemoteTrackersBtn').addEventListener('click', () => {
        renderRemoteTrackers();
        trackersModal.classList.add('active');
    });

    document.getElementById('closeTrackersModalBtn').addEventListener('click', () => {
        trackersModal.classList.remove('active');
    });

    document.getElementById('trackersSearch').addEventListener('input', renderRemoteTrackers);

    document.getElementById('clearCacheBtn').addEventListener('click', () => {
        chrome.storage.local.get(null, (items) => {
            const reservedKeys = ['customBlocklist', 'customAllowlist', 'customDohEndpoint', 'removeTrackingPixels', 'errorLogs', 'lastSyncTime', 'remoteShorteners', 'resolutionHistory', 'recentActivity'];
            const keysToRemove = Object.keys(items).filter(k => !reservedKeys.includes(k) && k.startsWith('http'));
            chrome.storage.local.remove(keysToRemove, () => renderCache());
        });
    });

    document.getElementById('clearHistoryBtn').addEventListener('click', () => {
        chrome.storage.local.set({ resolutionHistory: [] }, () => renderHistory());
    });

    document.getElementById('clearErrorsBtn').addEventListener('click', () => {
        chrome.storage.local.set({ errorLogs: [] }, () => renderErrors());
    });

    document.getElementById('exportHistoryCsvBtn').addEventListener('click', () => {
        chrome.storage.local.get({ resolutionHistory: [] }, (result) => {
            const history = result.resolutionHistory;
            if (history.length === 0) { alert("No history to export."); return; }

            const headers = ["Timestamp", "Original URL", "Resolved Destination", "Resolved IP", "Is Safe", "Reason"];
            const csvRows = history.map(item => {
                return [
                    `"${item.timestamp.replace(/"/g, '""')}"`,
                    `"${item.shortUrl.replace(/"/g, '""')}"`,
                    `"${item.finalUrl.replace(/"/g, '""')}"`,
                    `"${(item.resolvedIp || 'N/A').replace(/"/g, '""')}"`,
                    `"${item.isSafe ? 'Safe' : 'Unsafe'}"`,
                    `"${(item.reason || 'Clean').replace(/"/g, '""')}"`
                ].join(',');
            });

            const blob = new Blob([[headers.join(','), ...csvRows].join('\n')], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `gmail_unshortener_history_${new Date().toISOString().slice(0,10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    });

    document.getElementById('downloadSettingsBtn').addEventListener('click', () => {
        chrome.storage.local.get(null, (allItems) => {
            const settingsData = {
                exportDate: new Date().toLocaleString(),
                customAllowlist: allItems.customAllowlist || [],
                customBlocklist: allItems.customBlocklist || [],
                customDohEndpoint: allItems.customDohEndpoint || "",
                removeTrackingPixels: !!allItems.removeTrackingPixels,
                urlCache: {}
            };

            const reservedKeys = ['customBlocklist', 'customAllowlist', 'customDohEndpoint', 'removeTrackingPixels', 'errorLogs', 'lastSyncTime', 'remoteShorteners', 'resolutionHistory', 'recentActivity'];
            Object.keys(allItems).forEach(key => {
                if (!reservedKeys.includes(key) && key.startsWith('http')) {
                    settingsData.urlCache[key] = allItems[key];
                }
            });

            const blob = new Blob([JSON.stringify(settingsData, null, 2)], { type: 'application/json;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `gmail_unshortener_policies_${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    });

    const importBtn = document.getElementById('importSettingsBtn');
    const importInput = document.getElementById('importFileInput');
    const importModal = document.getElementById('importModal');
    let pendingImportData = null;

    importBtn.addEventListener('click', () => importInput.click());

    importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                pendingImportData = JSON.parse(event.target.result);
                document.getElementById('modalAllowCount').textContent = Array.isArray(pendingImportData.customAllowlist) ? pendingImportData.customAllowlist.length : 0;
                document.getElementById('modalBlockCount').textContent = Array.isArray(pendingImportData.customBlocklist) ? pendingImportData.customBlocklist.length : 0;
                document.getElementById('modalDohEndpoint').textContent = pendingImportData.customDohEndpoint ? pendingImportData.customDohEndpoint : 'None';
                document.getElementById('modalPixelAction').textContent = pendingImportData.removeTrackingPixels ? 'Completely Delete (DOM Remove)' : 'Replace with Badge (Keep)';
                
                const cacheCount = pendingImportData.urlCache ? Object.keys(pendingImportData.urlCache).length : 0;
                document.getElementById('modalOtherCount').textContent = cacheCount;
                
                importModal.classList.add('active');
            } catch (err) {
                alert(`Invalid JSON format: ${err.message}`);
                importInput.value = '';
            }
        };
        reader.readAsText(file);
    });

    document.getElementById('modalCancelBtn').addEventListener('click', () => {
        importModal.classList.remove('active');
        pendingImportData = null;
        importInput.value = '';
    });

    document.getElementById('modalConfirmBtn').addEventListener('click', () => {
        if (!pendingImportData) return;
        const mode = document.querySelector('input[name="importMode"]:checked').value;
        const data = pendingImportData;

        chrome.storage.local.get(['customAllowlist', 'customBlocklist', 'customDohEndpoint', 'removeTrackingPixels'], (current) => {
            const updates = {};
            if (mode === 'overwrite') {
                updates.customAllowlist = data.customAllowlist || [];
                updates.customBlocklist = data.customBlocklist || [];
                updates.customDohEndpoint = data.customDohEndpoint || "";
                updates.removeTrackingPixels = !!data.removeTrackingPixels;
            } else {
                updates.customAllowlist = [...new Set([...(current.customAllowlist||[]), ...(data.customAllowlist||[])])];
                updates.customBlocklist = [...new Set([...(current.customBlocklist||[]), ...(data.customBlocklist||[])])];
                if (data.customDohEndpoint) updates.customDohEndpoint = data.customDohEndpoint;
                if (typeof data.removeTrackingPixels === 'boolean') {
                    updates.removeTrackingPixels = data.removeTrackingPixels;
                }
            }

            if (data.urlCache && typeof data.urlCache === 'object') {
                Object.keys(data.urlCache).forEach(k => { if (k.startsWith('http')) updates[k] = data.urlCache[k]; });
            }

            chrome.storage.local.set(updates, () => {
                importModal.classList.remove('active');
                importInput.value = '';
                pendingImportData = null;
                refreshAllViews();
                alert('Policies and settings updated successfully!');
            });
        });
    });

    document.getElementById('cacheSearch').addEventListener('input', renderCache);
    document.getElementById('historySearch').addEventListener('input', renderHistory);
    document.getElementById('errorsSearch').addEventListener('input', renderErrors);

    
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
        stepsContainer.innerHTML = '<div style="color: #5f6368; padding: 10px;">Deconstructing layers and performing passive threat inspection...</div>';
        finalContainer.innerHTML = '';

        chrome.runtime.sendMessage({ action: 'testUnwrap', url: urlToInspect }, (response) => {
            inspectBtn.disabled = false;
            inspectBtn.textContent = "Inspect & Decode";

            if (!response) {
                stepsContainer.innerHTML = '<div style="color: #c5221f;">Failed to analyze link.</div>';
                return;
            }

            stepsContainer.innerHTML = '';
            const steps = response.steps || [];
            layersBadge.textContent = `${steps.length} Layer(s) Unwrapped`;

            if (steps.length === 0) {
                const directCard = document.createElement('div');
                directCard.className = 'step-card';
                directCard.style.borderLeftColor = '#34a853';
                directCard.innerHTML = `
                    <div class="step-header" style="color: #34a853;">
                        <span>✓ Direct / Unwrapped URL</span>
                        <span class="step-label" style="background: #e8f8f5; color: #004d00;">No Intermediate Wrappers</span>
                    </div>
                    <div class="url-box">${escapeHtml(urlToInspect)}</div>
                `;
                stepsContainer.appendChild(directCard);
            } else {
                steps.forEach((step, idx) => {
                    const stepCard = document.createElement('div');
                    stepCard.className = 'step-card';
                    stepCard.innerHTML = `
                        <div class="step-header">
                            <span>Layer ${step.layer}: ${escapeHtml(step.decoder)}</span>
                            <span class="step-label">Pass ${idx + 1} of ${steps.length}</span>
                        </div>
                        <div style="font-size: 11px; color: #5f6368; margin-bottom: 4px;"><strong>Input (Wrapped):</strong></div>
                        <div class="url-box" style="margin-bottom: 8px;">${escapeHtml(step.inputUrl)}</div>
                        <div class="step-arrow">⬇ Extracted Destination Payload ⬇</div>
                        <div style="font-size: 11px; color: #004d00; margin-bottom: 4px;"><strong>Output (Decoded):</strong></div>
                        <div class="url-box" style="background: #f1f8e9; border-color: #c8e6c9;">${escapeHtml(step.outputUrl)}</div>
                    `;
                    stepsContainer.appendChild(stepCard);
                });
            }

            // Render Final Destination & Threat Intelligence Card
            const isSafe = response.isSafe;
            const destCard = document.createElement('div');
            destCard.className = `final-dest-card ${isSafe ? '' : 'unsafe'}`;
            
            const badgeClass = isSafe ? 'badge-safe' : 'badge-unsafe';
            const statusLabel = isSafe ? 'Clean & Safe' : `Threat Detected: ${response.reason || 'Flagged'}`;

            destCard.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <strong style="font-size: 15px; color: ${isSafe ? '#004d00' : '#c5221f'};">🎯 Final Destination URL</strong>
                    <span class="badge ${badgeClass}">${statusLabel}</span>
                </div>
                <div class="url-box" style="background: #ffffff; margin-bottom: 10px;">${escapeHtml(response.unwrappedUrl)}</div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #5f6368;">
                    <div>
                        <strong>Resolved Destination IP:</strong> <code>${response.resolvedIp || 'N/A'}</code>
                        <span style="margin-left: 12px;"><strong>Scanner:</strong> ${response.scanner || 'Local Fast-Path'}</span>
                    </div>
                </div>
            `;
            
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

    function escapeHtml(string) {
        if (!string) return '';
        return String(string)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    refreshAllViews();
});
