# Gmail Link Unshortener & Tracker Blocker

A Firefox (Manifest V3) add-on that shows where the links in your email **really** go before you
click them, flags phishing and look-alike sites, and blocks email tracking pixels. Everything
sensitive happens on your device: QR codes, attachments and the phishing lists are read locally,
and nothing about you is sent anywhere unless you choose a lookup service that needs the link.

**Supported webmail:** Gmail (full support), plus experimental support for Outlook on the web,
Proton Mail, Yahoo Mail, AOL Mail, Zoho Mail, iCloud Mail, Fastmail and GMX.

## What it does

- **Unshortens links.** Short links (bit.ly, t.co, …) and security-gateway links (Proofpoint,
  SafeLinks, Barracuda, Trend Micro, …) are expanded so a hover card shows the real destination,
  with a **Copy address** button. More than 50 redirect formats are decoded offline.
- **Two warning levels.** *Caution* (amber) for misleading links such as text that shows a
  different site than the link goes to; *Danger* (red) for look-alike brand domains, phishing
  lists, and dangerous schemes (`javascript:`, `data:`, …). Red links ask before opening.
- **One calm banner per email.** Findings about the email as a whole are summarized at the top,
  with **Show details** and **What should I do?**; an email with many unusual links gets one
  sentence instead of a marking on every link. It follows Gmail's light or dark theme.
- **Sender checks (Gmail).** The sender's verification (DMARC/DKIM/SPF via Gmail's "Show
  original") is read to judge company short links (c.gle, aka.ms, …) and brand-claiming sender
  names.
- **Sender icons and identity (Gmail).** In the inbox list and in opened emails, every sender gets its
  site's icon (else its parent domain's or one from DuckDuckGo's icon service, replaced by the site's own as
  soon as it has one; a blank space when none exists; icons, verdicts and countries are remembered, so the
  inbox shows them at once), a country flag (where the server that sent it is, from Gmail's own delivery record, or the
  domain's country) and a domain label. Color only appears when it matters: ⛔ flagged (red),
  ⚠ caution (yellow), and ✓ trusted (green, for senders you or your organization chose). Every other
  label is plain, so Gmail.com-style providers don't look suspect and nothing looks safe that wasn't
  proven safe. Point at the label for the reasons and Gmail's own verification (DMARC/SPF/DKIM).
- **Phishing senders go to Spam (Gmail).** Sender addresses are compared with a community scam-sender
  list (there is no block list to maintain; Gmail's own Report spam covers anything missed); sender domains with the phishing lists and the DNS threat filters
  (a domain that doesn't exist is flagged too). Each email is also checked for signs of forgery: malformed
  addresses, forged delivery headers, padded names and subjects, unnamed or dangerous attachments, and
  links flagged as dangerous, so an email full of red links never shows a green sender. Trusted senders
  (yours and your organization's) are never flagged. Emails from a **flagged** sender (never unverified, unknown or clean ones) are moved
  to Spam with Gmail's own Report spam, from the inbox only, never while you're typing or have emails
  selected, and never your organization's phishing-training emails. One you take back out of Spam
  stays out. A short notice says how many were moved, with a **Review** link to Spam.
- **Threat checks.** DNS-over-HTTPS threat filters (Cloudflare Security and Family, Quad9,
  Control D; AdGuard as a backup), community shortener lists, and local phishing lists (OpenPhish,
  Phishing Army), downloaded at most once a day.
- **QR codes** in email images and image/PDF attachments are decoded on-device and their
  destination is checked like a link; QR codes drawn with HTML tables or block characters are
  caught too.
- **Attachment checks.** SVG/HTML attachments are scanned for scripts and hidden destinations;
  encrypted archives and deceptive file names are flagged.
- **Tracking pixels** (1×1 images and known open-tracking addresses) are removed, while keeping
  the email's real images.
- **Checks before you send (Gmail).** Links you write, including names typed on their own such as
  “example.com”, are checked for typos (“.con”, “http//”), look-alikes, domains that don't exist
  and sites that don't answer before the email goes out; a dialog lets you go back and fix them
  or send anyway. The quoted email you're replying to isn't checked, and an email is never held
  if the check can't finish.
- **Privacy levels.** *Standard*, *Private* (no link sent to any lookup service; site names still
  go to the DNS threat filters) or *Offline only* (nothing leaves the browser). Every feature can
  be switched off individually, and every one can be set and locked by your administrator.

## Feature compatibility

One engine handles every supported webmail. What it can do on a site depends only on what that site's
entry in `WEBMAIL_SITES` (`shared.js`) describes; the same chart, generated from the running code, is
in Settings → Help → Which features work where. Gmail is fully supported and tested; the other sites
are experimental (layouts mapped from public information) and gain the remaining features as their
entries are filled in, with no new code. Header features need a page the webmail offers with the
email's original source; Proton Mail encrypts messages, so it can't offer one. Nothing needs an extra
sign-in, an app registration or an administrator-approved API.

| Feature | Gmail | Outlook | Proton | Yahoo | AOL | Zoho | iCloud | Fastmail | GMX |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| *Support* | Full | Experimental | Experimental | Experimental | Experimental | Experimental | Experimental | Experimental | Experimental |
| Links: hidden destinations revealed, dangerous and look-alike links marked *(every site)* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tracking pixels blocked *(every site)* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| QR codes in email images *(every site)* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| QR codes drawn without an image *(every site)* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Phishing-simulation emails recognized by their link domains *(every site)* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Attachment checks (QR codes, scripts, fake logins, encrypted archives) | ✓ | — | — | — | — | — | — | — | — |
| Sender checks in opened emails (brand names, look-alike domains, company links) | ✓ | — | — | — | — | — | — | — | — |
| Sender icon, country flag and label in opened emails | ✓ | — | — | — | — | — | — | — | — |
| Sender icon, country flag and label in the inbox list | ✓ | — | — | — | — | — | — | — | — |
| Signs of forgery in the headers (DMARC, forged delivery records…) | ✓ | — | — | — | — | — | — | — | — |
| Phishing-simulation emails recognized by their headers | ✓ | — | — | — | — | — | — | — | — |
| Flagged emails moved to Spam | ✓ | — | — | — | — | — | — | — | — |
| Links checked before sending | ✓ | — | — | — | — | — | — | — | — |

## Install

Requires **Firefox 140 or later** (desktop). Until it's on addons.mozilla.org, it's loaded from this
folder. See [INSTALL-FOR-TESTERS.md](INSTALL-FOR-TESTERS.md) for the full walkthrough:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `manifest.json` in this folder.
3. Reload your webmail tab.

A temporary add-on stays loaded until Firefox restarts. To check the build, run `npx web-ext lint`;
to package it for addons.mozilla.org, run `npx web-ext build`. The add-on ID
(`link-unshortener@gmail-link-scanner`, in `manifest.json`) keeps settings and managed policies
attached to the same add-on on every computer.

## For administrators

Settings can be forced with Firefox enterprise policy: `policies.json` on any platform, the Windows
registry with Microsoft Intune or Group Policy (Settings → **Copy Intune script** generates the
PowerShell), or a macOS configuration profile. See [ADMIN-GUIDE.md](ADMIN-GUIDE.md); [`policy-example.json`](policy-example.json) is a
complete `policies.json` with every key.

The sender features (Gmail) each have their own key (`managedEnableSenderIdentity`,
`managedEnableSenderIconFallback`, `managedEnableSenderCountry`, `managedEnableSenderDomainCheck`, `managedEnableSenderAddressCheck`,
`managedEnableAutoSpam`, `managedEnableSpamNotice`); `managedTrustedSenders` is the allow list of senders never to flag or move
(addresses or whole domains), for example your phishing-training provider or a false positive. There is
no sender block list: users report anything missed with Gmail's own Report spam.

Some policies exist for administrators only, with no setting in the extension:

- **Phishing simulations:** training emails from KnowBe4, Wizer and others are left completely
  unchecked, so the extension never records a false click or hides an open. They're recognized by their
  link domains in every webmail (`managedPhishSimulationDomains`: all links must go to the vendor's
  domains) or by header in Gmail (`managedPhishSimulationRules`, ideally with a secret value).
- **A simpler popup** (`managedHidePopupSettingsButton`, `managedHideRecentActivity`): hides the
  Settings button and recent activity; Settings stays reachable from `about:addons`.

## Repository layout

| Path | Role |
|---|---|
| `manifest.json` | Manifest V3 declaration, add-on ID, permissions, supported sites |
| `background.html` | Background event page: loads the background scripts and the scanner |
| `background.js` | Link pipeline, threat checks, list sync, badge |
| `content.js` / `content.css` | Injected into webmail: banners, link markings, hover card, sender checks, sender icons and moving phishing to Spam, the Send check. One mail engine for every site, driven by the site's entry in `WEBMAIL_SITES` (`shared.js`); today only Gmail's entry describes its inbox list, toolbar and compose window |
| `shared.js` | Settings, constants and helpers shared by all contexts |
| `decoders.js` | Offline decoders for short links, gateways and trackers |
| `custom-endpoints.js` | Requests and replies for your own lookup service or threat resolver |
| `qr-decoder.js` | Self-contained QR decoder (no dependencies) |
| `scanner.js` / `compat.js` | QR/PDF scanning in the background page; shims pdf.js needs on older Firefox |
| `options.*`, `help.js`, `popup.*` | Settings, logging, Link Inspector and Help; the toolbar popup |
| `theme.css` / `theme.js` | Design tokens and light/dark appearance (WCAG 2.1 AA) |
| `lib/` | Bundled pdf.js (Apache-2.0), used only for PDF attachments |
| `tools/refresh-snapshot.js` | Refreshes the bundled shortener-domain snapshot |
| `CHANGELOG.md` | Full release history with rationale for every change |

## Documentation

- [CHANGELOG.md](CHANGELOG.md) — every version, what changed and why.
- [INSTALL-FOR-TESTERS.md](INSTALL-FOR-TESTERS.md) — install and update steps.
- [ADMIN-GUIDE.md](ADMIN-GUIDE.md) — deployment and policy keys.
- The extension's own **Help** tab explains how each warning works, the privacy details and
  troubleshooting.

## Design rules

- **Never contact a link's destination on your behalf** when reading mail; only lookup services
  you can switch off are used. The one exception is the Send check, which makes one request to each
  website you link to, as your reader would by clicking it, and never for one-time links.
- **Never change an email being written,** only emails being read.
- **Only flagged senders are moved to Spam,** only once, and only with Gmail's own Report spam; what the
  user takes back out of Spam stays out.
- **Never trap an email:** if the Send check can't finish, the email is sent.
- **Managed settings win:** policy values (Firefox enterprise policy) can't be changed or
  reset by the user.

## Testing

Unit tests (Node) cover the link pipeline, decoders and shared logic; browser tests (Playwright)
run the extension on simulated webmail pages; accessibility audits check contrast in light and dark
mode and names and roles. Webmail page structure is mapped from public information and simulated
pages, so changes to a webmail's layout need checking on the live site.

## Privacy

- Link expansion, QR decoding and attachment checks run on your device wherever possible.
- The privacy level controls whether any lookup service (unshorten.me, DNS resolvers) ever
  receives a domain, and *Offline only* stops all network checks.
- Logs and history stay in local extension storage and can be cleared or auto-deleted.

## License

[Apache License 2.0](LICENSE). Bundled third-party components keep their own licenses
(`lib/PDFJS-LICENSE`, credits in the extension's Help → About).
