document.getElementById('visualToggle').addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (activeTab && activeTab.url.includes("mail.google.com")) {
            chrome.tabs.sendMessage(activeTab.id, { action: "toggleVisuals", enabled: isEnabled });
        }
    });
});

document.getElementById('openSettingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
});

document.getElementById('syncStatus').addEventListener('click', () => {
    const syncText = document.getElementById('syncStatus');
    syncText.textContent = "Syncing lists...";
    chrome.runtime.sendMessage({ action: "forceSync" }, () => {
        loadCounts();
    });
});

function loadCounts() {
    chrome.storage.local.get(['lastSyncTime', 'remoteShorteners', 'customBlocklist', 'customAllowlist'], (result) => {
        const syncText = document.getElementById('syncStatus');
        const syncedCount = document.getElementById('syncedCount');
        const customCount = document.getElementById('customCount');

        syncedCount.textContent = (result.remoteShorteners?.length || 0).toLocaleString();
        
        const blocks = result.customBlocklist?.length || 0;
        const allows = result.customAllowlist?.length || 0;
        customCount.textContent = (blocks + allows).toLocaleString();

        if (result.lastSyncTime) {
            syncText.textContent = `Updated: ${result.lastSyncTime}`;
        }
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (activeTab && activeTab.url.includes("mail.google.com")) {
            chrome.tabs.sendMessage(activeTab.id, { action: "getCounts" }, (res) => {
                if (res) {
                    document.getElementById('linkCount').textContent = res.linkCount;
                    document.getElementById('pixelCount').textContent = res.pixelCount;
                }
            });
        }
    });
}

function loadActivity() {
    const activityList = document.getElementById('activityList');
    const clearBtn = document.getElementById('clearActivityBtn');

    chrome.storage.local.get({ recentActivity: [] }, (result) => {
        const activity = result.recentActivity;
        activityList.innerHTML = '';

        if (activity.length > 0) {
            clearBtn.style.display = 'block';
            activity.forEach(item => {
                const li = document.createElement('li');
                li.innerHTML = `<strong>[${item.time}] (${item.type})</strong><br/>${item.text}`;
                activityList.appendChild(li);
            });
        } else {
            clearBtn.style.display = 'none';
            activityList.innerHTML = '<li style="color:#555;">No recent activity.</li>';
        }
    });
}

document.getElementById('clearActivityBtn').addEventListener('click', () => {
    chrome.storage.local.set({ recentActivity: [] }, () => {
        loadActivity();
    });
});

document.addEventListener('DOMContentLoaded', () => {
    loadCounts();
    loadActivity();
});
