// popup.js — the toolbar popup: counts for the open message, the highlights switch, recent activity
// and a link to Settings. Buttons are connected before anything loads, so they always respond.
// shared.js (loaded first) provides loadEffectiveSettings, publicShorteners, espTrackers.

installPageErrorLogging('Toolbar popup');

// Buttons are connected immediately, BEFORE anything is loaded: loading settings can take a few
// seconds in some browsers (see storageGet in shared.js), and a click during that time used to do
// nothing. Data is filled in afterwards.
function initPopup() {
    const settingsBtn = document.getElementById('openSettingsBtn');
    if (settingsBtn) {
        // The button is also a plain link to options.html, so it works even if this script fails.
        // Here it is upgraded to reuse an already-open Settings tab instead of opening a second one.
        settingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const fallback = () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html') }, () => window.close());
            try {
                chrome.runtime.openOptionsPage(() => {
                    if (chrome.runtime.lastError) {
                        reportToLog('warning', 'Toolbar popup', `Opening Settings the standard way failed (${chrome.runtime.lastError.message}); opened it in a new tab instead.`);
                        fallback();
                    } else {
                        window.close();
                    }
                });
            } catch (err) {
                reportToLog('warning', 'Toolbar popup', `Opening Settings the standard way failed (${err.message}); opened it in a new tab instead.`);
                fallback();
            }
        });
    }

    const toggle = document.getElementById('visualToggle');
    if (toggle) {
        toggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            chrome.storage.local.set({ visualOverridesActive: isEnabled });
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const activeTab = tabs[0];
                if (activeTab && activeTab.url && webmailSiteFor(activeTab.url)) {
                    chrome.tabs.sendMessage(activeTab.id, { action: "toggleVisuals", enabled: isEnabled }, () => {
                        void chrome.runtime.lastError; // tab may not have the content script yet
                    });
                }
            });
        });
    }

    const clearBtn = document.getElementById('clearActivityBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            chrome.storage.local.set({ recentActivity: [] }, () => {
                loadActivity();
            });
        });
    }

    // Then fill in data, all in parallel; nothing above waits for it.
    loadActivity();
    loadEffectiveSettings().then((cfg) => {
        // Administrator policies (no setting in the extension): hide the Settings button and/or the
        // recent activity. Settings stays reachable from about:addons.
        const pol = cfg.policy || {};
        if (pol.hideSettingsButton) { const b = document.getElementById('openSettingsBtn'); if (b) b.remove(); }
        if (pol.hideRecentActivity) { const a = document.getElementById('activitySection'); if (a) a.remove(); }
        if (toggle) {
            toggle.checked = !!cfg.values.visualOverridesActive;
            if (cfg.locked.visualOverridesActive) {
                toggle.disabled = true;
                const sub = document.getElementById('visualSublabel');
                if (sub) sub.textContent = '🔒 Set by your organization';
            }
        }
        loadListCounts(cfg);
        loadCounts();
        document.documentElement.dataset.loaded = '1';   // settings applied (the tests wait for this)
    }).catch((err) => reportToLog('error', 'Toolbar popup', `Settings could not be loaded: ${err.message || err}`));
}

// Size of the shortener list in use, and of the user's allowed + blocked sites.
function loadListCounts(cfg) {
    const syncedCount = document.getElementById('syncedCount');
    const customCount = document.getElementById('customCount');
    if (syncedCount) {
        const count = cfg.remoteShorteners.length > 0
            ? cfg.remoteShorteners.length
            : publicShorteners.length + espTrackers.length;  // built-in list size until a sync completes
        syncedCount.textContent = count.toLocaleString();
    }
    if (customCount) customCount.textContent = (cfg.allowlist.length + cfg.blocklist.length).toLocaleString();
}

// Statistics of the active tab, combined by the background from the page and its message frames.
// The tab's address (available because the popup was opened from the toolbar) only names the site.
function loadCounts() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab) return;
        chrome.runtime.sendMessage({ action: 'getTabState', tabId: tab.id }, (state) => {
            void chrome.runtime.lastError;
            const site = tab.url ? webmailSiteFor(tab.url) : null;
            setMoveWait(state);
            if (state) {
                document.getElementById('linkCount').textContent = state.linkCount;
                document.getElementById('pixelCount').textContent = state.pixelCount;
                if (state.active) { renderLinkStats(state.links); return; }
                setStatsNote('Open an email to see its link statistics.');
                return;
            }
            setStatsNote(site ? `Reload the ${site.name} tab to start checking emails.`
                : 'Open an email in Gmail or another supported webmail to see its link statistics.');
        });
    });
}

function loadActivity() {
    const activityList = document.getElementById('activityList');
    const clearBtn = document.getElementById('clearActivityBtn');
    if (!activityList) return;

    chrome.storage.local.get({ recentActivity: [] }, (result) => {
        const activity = result.recentActivity || [];
        activityList.textContent = '';
        if (activity.length > 0) {
            if (clearBtn) clearBtn.style.display = 'block';
            activity.forEach(item => {
                // Built with textContent: log entries contain URLs taken from emails.
                const li = document.createElement('li');
                const head = document.createElement('strong');
                head.textContent = `[${item.time}] (${item.type})`;
                li.appendChild(head);
                li.appendChild(document.createElement('br'));
                li.appendChild(document.createTextNode(String(item.text)));
                activityList.appendChild(li);
            });
        } else {
            if (clearBtn) clearBtn.style.display = 'none';
            const li = document.createElement('li');
            li.style.color = 'var(--text-muted)';
            li.textContent = 'No recent activity.';
            activityList.appendChild(li);
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPopup);
} else {
    initPopup();
}

// Scanned = safe + caution + unsafe + not verified; unscanned = still being checked or couldn't be checked.
function renderLinkStats(s) {
    if (!s) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('stScanned', s.scanned); set('stSafe', s.safe); set('stCaution', s.caution || 0); set('stUnsafe', s.unsafe);
    set('stNotVerified', s.notVerified); set('stUnscanned', s.unscanned);
    setStatsNote(s.total === 0 ? 'No web links in the open email.' : (s.unscanned ? `${s.unscanned} link(s) still being checked or not checkable.` : ''));
}

function setStatsNote(text) {
    const el = document.getElementById('statsNote');
    if (el) el.textContent = text;
}

// Flagged emails queued to move to Spam in the open tab, and why they're waiting (each row also says
// so in the inbox itself). Shown only while something is queued.
const MOVE_WHY = {
    'recent activity': 'they move when you pause', 'user busy': 'they move when you pause',
    'selection': 'they move once nothing is selected', 'view': 'they move back in the inbox',
    'not shown': 'they move when the list is shown again', 'tab hidden': 'they move when the tab is shown',
    'split view': 'each is moved when opened (split view)', 'several lists': 'each is moved when opened (several inbox sections)',
    'paused': 'retrying', 'retrying': 'retrying', 'memory': 'retrying', 'settings': 'retrying'
};
function setMoveWait(state) {
    const el = document.getElementById('moveWait');
    if (!el) return;
    const mw = state && state.moveWait;
    el.style.display = mw ? '' : 'none';
    if (mw) el.textContent = `${mw.n} flagged email${mw.n === 1 ? '' : 's'} waiting to move to Spam${MOVE_WHY[mw.why] ? ` (${MOVE_WHY[mw.why]})` : ''}.`;
}

// Appearance (System / Light / Dark), shared with the Options page via theme.js.
(function initThemeSelect() {
    const sel = document.getElementById('themeSelect');
    if (!sel || !window.uiTheme) return;
    sel.value = window.uiTheme.get();
    sel.addEventListener('change', () => window.uiTheme.set(sel.value));
    document.addEventListener('themechange', (e) => { sel.value = e.detail.choice; });
})();
