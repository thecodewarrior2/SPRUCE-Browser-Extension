# Gmail Link Unshortener & Tracker Blocker

A Chrome (Manifest V3) extension that shows where the links in your email **really** go before you
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
  (a domain that doesn't exist is flagged too, unless it's a subdomain of a company domain that does). Each email is also checked for signs of forgery: malformed
  addresses, forged delivery headers, padded names and subjects, unnamed or dangerous attachments, and
  links flagged as dangerous, so an email full of red links never shows a green sender. Trusted senders
  (yours and your organization's) are never flagged. Emails from a **flagged** sender (never unverified, unknown or clean ones) are moved
  to Spam with Gmail's own Report spam, from the inbox only, never while you're typing or have emails
  selected, and never your organization's phishing-training emails. One you take back out of Spam
  stays out. A short notice says how many were moved, with a **Review** link to Spam.
- **Red flags in the Spam folder (Gmail).** In Spam, emails the same checks would move there are red,
  whether the extension moved them (the label says when and why) or Gmail did; unread ones are checked
  too. A Spam email without a red label was put there by Gmail or by you, so it may be a mistake.
- **Senders using your own name (Gmail).** An email whose sender name is your own email address, or
  your mailbox name (the part before the @, written as in your address), but which comes from someone
  else's address is flagged red from the inbox list, without opening it, and moved to Spam: a common
  trick in fake "your storage is full" and "your account is blocked" emails.
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
| Sender checks in opened emails (brand names, look-alike domains, company links) | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |
| Sender icon, country flag and label in opened emails | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |
| Copy button for the sender's address | ✓ | — | — | — | — | — | — | — | — |
| Look-alike senders caught in the inbox list (nothing opened) | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |
| Senders using your own name or address as theirs, caught in the inbox list | ✓ | — | — | — | — | — | — | — | — |
| Sender icon, country flag and label in the inbox list | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |
| Sender pictures over the checkbox: colleagues' photos, BIMI and company logos, site icons | ✓ | — | — | — | — | — | — | — | — |
| The webmail's own warnings about a sender counted in the email's verdict | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |
| Signs of forgery in the headers (DMARC, forged delivery records…) | ✓ | — | — | — | — | — | — | — | — |
| Phishing-simulation emails recognized by their headers | ✓ | — | — | — | — | — | — | — | — |
| Flagged emails moved to Spam | ✓ | — | — | — | — | — | — | — | — |
| Dangerous emails marked red in the Spam folder (moved there by the extension or not) | ✓ | — | — | — | — | — | — | — | — |
| Links checked before sending | ✓ | — | — | — | — | — | — | — | — |
| Row highlighter (the email under the mouse, and selected ones) | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |
| Warnings about other extensions that do the same job *(every site)* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

✓ works · ◐ basic (found through the page's accessibility labels; read-only, never clicks) · — not yet

## Install (load unpacked)

The extension isn't in a web store yet; it's installed from this folder. See
[INSTALL-FOR-TESTERS.md](INSTALL-FOR-TESTERS.md) for the full walkthrough:

1. Move this folder somewhere permanent (Chrome loads it from there).
2. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose this folder (the one containing `manifest.json`).
4. Reload your webmail tab.

**Updating:** replace the files in the same folder, click ↻ on the extension's card, and reload
your webmail. Settings are kept.

The `key` in `manifest.json` is the extension's **public** key: it keeps the extension ID the same
on every computer, so settings and managed policies apply. It's safe to publish. The matching
private key (`.pem`) signs releases and must never be committed (see `.gitignore`).

## For administrators

Settings can be forced with Google Workspace, Microsoft Intune or Group Policy. See
[ADMIN-GUIDE.md](ADMIN-GUIDE.md) and the schema in [`schema.json`](schema.json);
[`policy-example.json`](policy-example.json) shows a complete policy.

The sender features (Gmail) each have their own key (`managedEnableSenderIdentity`,
`managedEnableSenderIconFallback`, `managedEnableSenderAvatars`, `managedEnableSenderBimi`, `managedSenderPictureSize`, `managedEnableCopyAddress`, `managedEnableLookalikeCheck`, `managedEnableOwnNameCheck`, `managedEnableSenderCountry`, the row highlighter (`managedEnableRowHighlighter`, `managedRowHighlightColor`, `managedRowHighlightStyle`, `managedRowHighlightSelected`, `managedRowHighlightSelectedColor`) and warnings about overlapping extensions (`managedEnableConflictWarnings`), `managedEnableSenderDomainCheck`, `managedEnableSenderAddressCheck`,
`managedEnableAutoSpam`, `managedEnableSpamNotice`, `managedEnableSpamFolderFlags`); `managedTrustedSenders` is the allow list of senders never to flag or move
(addresses or whole domains), for example your phishing-training provider or a false positive. There is
no sender block list: users report anything missed with Gmail's own Report spam.

Some policies exist for administrators only, with no setting in the extension:

- **Phishing simulations:** training emails from KnowBe4, Wizer and others are left completely
  unchecked, so the extension never records a false click or hides an open. They're recognized by their
  link domains in every webmail (`managedPhishSimulationDomains`: all links must go to the vendor's
  domains) or by header in Gmail (`managedPhishSimulationRules`, ideally with a secret value).
- **A simpler popup** (`managedHidePopupSettingsButton`, `managedHideRecentActivity`): hides the
  Settings button and recent activity; Settings stays reachable at
  `chrome-extension://<ID>/options.html`.

## Repository layout

| Path | Role |
|---|---|
| `manifest.json` | Manifest V3 declaration, permissions, supported sites |
| `background.js` | Service worker: link pipeline, threat checks, list sync, badge |
| `content.js` / `content.css` | Injected into webmail: banners, link markings, hover card, sender checks, sender icons and moving phishing to Spam, the Send check. One mail engine for every site, driven by the site's entry in `WEBMAIL_SITES` (`shared.js`); today only Gmail's entry describes its inbox list, toolbar and compose window |
| `shared.js` | Settings, constants and helpers shared by all contexts |
| `decoders.js` | Offline decoders for short links, gateways and trackers |
| `custom-endpoints.js` | Requests and replies for your own lookup service or threat resolver |
| `qr-decoder.js` | Self-contained QR decoder (no dependencies) |
| `scanner.js` / `scanner.html` | Hidden offscreen document for QR/PDF scanning |
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
- **Managed settings win:** policy values (Workspace, Intune, Group Policy) can't be changed or
  reset by the user.

## Testing

Unit tests (Node) cover the link pipeline, decoders and shared logic; browser tests (Playwright)
run the extension on simulated webmail pages; accessibility audits check contrast in light and dark
mode and names and roles. Webmail page structure is mapped from public information and simulated
pages, so changes to a webmail's layout need checking on the live site. The tests are in `tests/`
(see `tests/README.md`; not part of the extension package):

```bash
cd tests && npm install && node run-all.js
```

## Privacy

- Link expansion, QR decoding and attachment checks run on your device wherever possible.
- The privacy level controls whether any lookup service (unshorten.me, DNS resolvers) ever
  receives a domain, and *Offline only* stops all network checks.
- Logs and history stay in local extension storage and can be cleared or auto-deleted.

## License

[Apache License 2.0](LICENSE). Bundled third-party components keep their own licenses
(`lib/PDFJS-LICENSE`, credits in the extension's Help → About).
