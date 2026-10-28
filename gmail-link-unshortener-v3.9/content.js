console.log("[Content] Gmail Link Unshortener & Tracker Blocker loaded.");

let linkCount = 0;
let pixelCount = 0;
let visualOverridesActive = true;
const processedLinksMap = new Map();

function applyLinkStyles(link, linkData) {
    let icon = (link.nextElementSibling && link.nextElementSibling.classList.contains('unshortener-icon'))
        ? link.nextElementSibling
        : link.querySelector('.unshortener-icon');

    if (!visualOverridesActive) {
        link.textContent = linkData.originalText;
        link.href = linkData.originalUrl;
        link.style.backgroundColor = '';
        link.style.color = '';
        link.style.padding = '';
        link.style.borderRadius = '';
        link.style.fontWeight = '';
        link.style.textDecoration = '';
        link.style.display = '';
        
        if (icon) icon.style.display = 'none';
        return;
    }

    link.href = linkData.finalUrl;
    
    if (!icon) {
        icon = document.createElement('span');
        icon.className = 'unshortener-icon';
    }
    
    // Ensure icon is placed immediately after the link in the DOM
    if (link.parentNode && link.nextSibling !== icon) {
        link.after(icon);
    }
    
    icon.style.display = 'inline-block';
    icon.style.backgroundColor = 'transparent';
    icon.style.border = 'none';
    icon.style.padding = '0';
    icon.style.lineHeight = '1';
    icon.style.verticalAlign = 'middle';

    const hasImage = !!link.querySelector('img');

    if (linkData.isAllowlisted) {
        link.title = `Allowlisted URL: ${linkData.originalUrl}`;
        icon.innerHTML = ' 🛡️'; 
        icon.title = "Domain is allowlisted by user or enterprise policy";
        icon.style.fontSize = '1.0em';
        icon.style.marginLeft = '4px';
        return;
    }

    if (linkData.isSafe) {
        if (linkData.isNakedUrl && !hasImage) {
            link.textContent = linkData.finalUrl;
        }

        link.title = `Clean destination: ${linkData.finalUrl}\n(Original shortlink: ${linkData.originalUrl})`;
        
        if (!hasImage) {
            link.style.transition = 'background-color 0.8s ease-in-out, color 0.8s ease-in-out';
            link.style.backgroundColor = '#e8f8f5'; 
            link.style.color = '#004d00'; 
            link.style.padding = '2px 4px';
            link.style.borderRadius = '3px';
            link.style.fontWeight = 'normal';
            link.style.textDecoration = '';
            link.style.display = 'inline-block';
        } else {
            link.style.outline = '3px solid #34a853';
            link.style.outlineOffset = '2px';
            link.style.borderRadius = '4px';
            link.style.display = 'inline-block';
        }

        icon.innerHTML = ' ✅'; 
        icon.title = "URL unshortened by extension (Safe)";
        icon.style.fontSize = '1.2em';
        icon.style.marginLeft = '4px';
    } else {
        const blockReason = linkData.reason || "Unsafe content";

        if (!hasImage) {
            link.textContent = `DO NOT CLICK : Warning ${blockReason.toLowerCase()} detected`;
        }

        link.title = `⚠️ WARNING: ${blockReason} detected. Destination: ${linkData.finalUrl}`;
        link.style.backgroundColor = '#d93025'; 
        link.style.color = '#ffffff'; 
        link.style.padding = '3px 6px';
        link.style.borderRadius = '4px';
        link.style.fontWeight = 'bold';
        link.style.textDecoration = 'none';
        link.style.display = 'inline-block';
        
        if (hasImage) {
            link.style.outline = '4px solid #d93025';
            link.style.outlineOffset = '2px';
        }

        // Render SVG Octagonal Red Stop Sign with yellow exclamation mark; transparent background
        icon.innerHTML = `
            <svg width="22" height="22" viewBox="0 0 24 24" style="vertical-align: middle; display: inline-block;">
                <polygon points="7,2 17,2 22,7 22,17 17,22 7,22 2,17 2,7" fill="#d93025" stroke="#ffffff" stroke-width="1.5"/>
                <path d="M12,6.5 L12,12.5" stroke="#ffd700" stroke-width="2.5" stroke-linecap="round"/>
                <circle cx="12" cy="16.5" r="1.5" fill="#ffd700"/>
            </svg>
        `.trim();
        icon.title = `WARNING: ${blockReason}`;
        icon.style.marginLeft = '6px';
        icon.style.cursor = 'pointer';

        if (!icon.dataset.hasClickListener) {
            icon.dataset.hasClickListener = 'true';
            icon.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                link.click();
            });
        }
    }
}

function processTrackingPixels(allTargetDomains, allowlist, shouldRemovePixels) {
    const images = document.querySelectorAll('.ii.gt img');
    
    images.forEach(img => {
        if (img.dataset.unshortened) return;
        
        let originalUrl = img.src;
        if (!originalUrl || originalUrl.startsWith('data:')) return;

        if (originalUrl.includes('googleusercontent.com/proxy') && originalUrl.includes('#')) {
            originalUrl = originalUrl.split('#')[1];
        }

        let isTracker = false;
        let hostname = '';
        
        try {
            const urlObj = new URL(originalUrl);
            hostname = urlObj.hostname.toLowerCase();

            if (allowlist.some(domain => hostname === domain || hostname.endsWith('.' + domain))) {
                return;
            }

            isTracker = allTargetDomains.some(domain => 
                hostname === domain || hostname.endsWith('.' + domain)
            );

            if (!isTracker) {
                isTracker = /^(click[0-9]*|trk[0-9]*|ctrk[0-9]*|track[0-9]*|tracking|open|read|receipt|redirect|redir|go|link[0-9]*|links|url|mkt|email|mail|ct|cl|c|em|e|r|l|t)\./i.test(hostname) || /^\/(l|r|c|cl|track|click|clicks|redirect|redir|wf\/click|ls\/click)\//i.test(new URL(originalUrl).pathname);
            }
        } catch (e) {}

        if (!isTracker) {
            const w = img.getAttribute('width');
            const h = img.getAttribute('height');
            if (w === '1' || h === '1' || img.style.width === '1px' || img.style.height === '1px') {
                isTracker = true;
            } else if (img.naturalWidth === 1 && img.naturalHeight === 1) {
                isTracker = true;
            }
        }

        if (isTracker) {
            img.dataset.unshortened = 'true';
            pixelCount++;

            if (shouldRemovePixels) {
                img.remove();
            } else {
                img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%231a73e8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
                img.style.width = '16px';
                img.style.height = '16px';
                img.style.display = 'inline-block';
                img.style.border = '1px solid #1a73e8';
                img.style.backgroundColor = '#e8f0fe';
                img.style.padding = '2px';
                img.style.opacity = '1';
                img.title = `Blocked Email Open Tracker (Pixel): ${originalUrl}`;
            }
            
            chrome.runtime.sendMessage({ action: 'logPixel', url: originalUrl, removed: shouldRemovePixels });
            chrome.runtime.sendMessage({ action: 'updateBadge', linkCount: linkCount, pixelCount: pixelCount });
        }
    });
}

function unshortenLinks() {
    const emailBodies = document.querySelectorAll('.ii.gt');
    if (emailBodies.length === 0) return;

    chrome.storage.local.get({ 
        customBlocklist: [], 
        customAllowlist: [],
        remoteShorteners: [],
        removeTrackingPixels: false
    }, (result) => {
        const checkManaged = (cb) => {
            if (chrome.storage.managed) {
                chrome.storage.managed.get(['enterpriseAllowlist', 'enterpriseBlocklist', 'enterpriseRemoveTrackingPixels'], (managed) => {
                    if (chrome.runtime.lastError || !managed) managed = {};
                    cb(managed);
                });
            } else {
                cb({});
            }
        };

        checkManaged((managed) => {
            const customTrackers = [...(result.customBlocklist || []), ...(managed.enterpriseBlocklist || [])];
            const allowlist = [...(result.customAllowlist || []), ...(managed.enterpriseAllowlist || [])];
            const dynamicShorteners = result.remoteShorteners || [];

            let shouldRemovePixels = !!result.removeTrackingPixels;
            if (typeof managed.enterpriseRemoveTrackingPixels === 'boolean') {
                shouldRemovePixels = managed.enterpriseRemoveTrackingPixels;
            }

            const defaultShorteners = [
                'bit.ly', 't.co', 'tinyurl.com', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly', 
                'rebrand.ly', 'bl.ink', 'rb.gy', 'v.gd', 'j.mp', 'lnkd.in', 'db.tt', 
                'qr.ae', 'snip.ly', 'adf.ly', 'shorte.st', 't2m.io', 'kurzelinks.de', 
                'goo.gl', 'wp.me', 'short.io', 'x.co', 'tiny.cc', 'clk.im', 'b.link'
            ];

            const trackers = [
                'rs6.net', 'mktoweb.com', 'exacttarget.com', 'acemlna.com', 'acems1.com', 
                'kit-mail3.com', 'ck.page', 'convertkit-mail.com', 'awstrack.me', 
                'list-manage.com', 'sendgrid.net', 'hubapi.com', 'omnisend.com',
                'campaign-archive.com', 'mailchi.mp', 'aweber.com', 'infusionsoft.com',
                'keap-link.com', 'sg.us-west-2.awstrack.me', 'ct.sendgrid.net',
                'sparkpost.com', 'sparkpostmail.com', 'sparkpostmail2.com', 'e.sparkpost.com', 'spmta.com',
                'click.pstmrk.it', 'mandrillapp.com', 'mailgun.net',
                'pardot.com', 'iterable.com', 'braze.com', 'sendinblue.com',
                'klclick.com', 'klclick1.com', 'klclick2.com', 'klclick3.com', 'klaviyo.com', 'klaviyomail.com'
            ];

            const allTargetDomains = [...new Set([
                ...defaultShorteners, 
                ...dynamicShorteners, 
                ...trackers, 
                ...customTrackers
            ])];

            processTrackingPixels(allTargetDomains, allowlist, shouldRemovePixels);

            const links = document.querySelectorAll('.ii.gt a');
            links.forEach(link => {
                const originalUrl = link.href;
                
                if (link.dataset.unshortened || !originalUrl.startsWith('http') || originalUrl.includes('mail.google.com')) {
                    return;
                }

                link.dataset.unshortened = 'pending';
                const originalText = link.textContent.trim();
                const hasImg = !!link.querySelector('img');
                const isNakedUrl = !hasImg && (originalText === originalUrl || originalText === originalUrl.replace(/^https?:\/\//, ''));

                chrome.runtime.sendMessage({ action: 'resolveUrl', url: originalUrl, linkText: originalText }, (response) => {
                    if (response && response.finalUrl) {
                        
                        const linkData = {
                            originalUrl: originalUrl,
                            finalUrl: response.finalUrl,
                            originalText: originalText,
                            isNakedUrl: isNakedUrl,
                            isSafe: response.isSafe,
                            reason: response.reason,
                            isAllowlisted: response.isAllowlisted
                        };

                        processedLinksMap.set(link, linkData);
                        link.dataset.unshortened = 'true';

                        if (!response.isSafe) {
                            const blockReason = response.reason || "Unsafe content";
                            link.addEventListener('click', (event) => {
                                const proceed = confirm(
                                    `⚠️ STOP: This link was flagged by your security filter.\n\n` +
                                    `Reason: ${blockReason.toUpperCase()}\n` +
                                    `Destination: ${response.finalUrl}\n\n` +
                                    `Are you absolutely sure you want to visit this site?`
                                );
                                
                                if (!proceed) {
                                    event.preventDefault();
                                }
                            });
                        }

                        if (!response.isAllowlisted && response.finalUrl !== originalUrl || !response.isSafe) {
                            applyLinkStyles(link, linkData);
                            linkCount++;
                            chrome.runtime.sendMessage({ action: 'updateBadge', linkCount: linkCount, pixelCount: pixelCount });
                        }

                    } else {
                        link.dataset.unshortened = 'failed';
                    }
                });
            });
        });
    });
}

const observer = new MutationObserver((mutations) => {
    let emailOpened = false;
    for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE && (node.classList.contains('ii') || node.querySelector('.ii.gt'))) {
                    emailOpened = true;
                    break;
                }
            }
        }
        if (emailOpened) break;
    }

    if (emailOpened) {
        linkCount = 0;
        pixelCount = 0;
        chrome.runtime.sendMessage({ action: 'updateBadge', linkCount: 0, pixelCount: 0 });
        setTimeout(unshortenLinks, 500);
    }
});

observer.observe(document.body, { childList: true, subtree: true });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scanLinks') {
        unshortenLinks();
        sendResponse({ status: "Scan complete" });
    }

    if (request.action === 'toggleVisuals') {
        visualOverridesActive = request.enabled;
        processedLinksMap.forEach((linkData, link) => {
            applyLinkStyles(link, linkData);
        });
        sendResponse({ status: "Visuals toggled", active: visualOverridesActive });
    }

    if (request.action === 'getCounts') {
        sendResponse({ linkCount, pixelCount });
    }
});
