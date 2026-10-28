// theme.js — light/dark appearance for the popup and Options page. Loaded first in <head> so the page
// never flashes the wrong theme. The choice ('system' | 'light' | 'dark', default 'system') is kept in
// chrome.storage.local (the source of truth, shared by all extension pages) and mirrored in
// localStorage so it can be applied before the page is drawn.
(() => {
    'use strict';
    const KEY = 'uiTheme';
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    let choice = 'system';
    try { choice = localStorage.getItem(KEY) || 'system'; } catch (e) { /* storage blocked */ }

    function apply() {
        const dark = choice === 'dark' || (choice === 'system' && media.matches);
        const root = document.documentElement;
        root.dataset.theme = choice;                    // what the user picked
        root.dataset.resolved = dark ? 'dark' : 'light'; // what is shown (CSS keys off this)
        root.style.colorScheme = dark ? 'dark' : 'light';
        document.dispatchEvent(new CustomEvent('themechange', { detail: { choice, dark } }));
    }
    function remember(c) {
        choice = ['light', 'dark'].includes(c) ? c : 'system';
        try { localStorage.setItem(KEY, choice); } catch (e) { /* ignore */ }
    }

    apply();
    media.addEventListener('change', () => { if (choice === 'system') apply(); });
    chrome.storage.local.get({ uiTheme: null }, (r) => {
        if (r && r.uiTheme && r.uiTheme !== choice) { remember(r.uiTheme); apply(); }
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.uiTheme) { remember(changes.uiTheme.newValue); apply(); }
    });

    // Allow switch animations only after the page has settled (see theme.css).
    window.addEventListener('load', () => setTimeout(() => document.documentElement.classList.add('ui-ready'), 600));

    window.uiTheme = {
        get: () => choice,
        set: (c) => { remember(c); chrome.storage.local.set({ uiTheme: choice }); apply(); }
    };
})();
