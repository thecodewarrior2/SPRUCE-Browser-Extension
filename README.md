# Gmail Link Unshortener & Tracker Blocker

A Chrome (Manifest V3) extension that shows where the links in your email **really** go before you
click them, flags phishing and look-alike sites, and blocks email tracking pixels. Everything
sensitive happens on your device: QR codes, attachments and the phishing lists are read locally,
and nothing about you is sent anywhere unless you choose a lookup service that needs the link.

**Supported webmail:** Gmail (full support), plus experimental support for Outlook on the web,
Proton Mail, Yahoo Mail, AOL Mail, Zoho Mail, iCloud Mail, Fastmail and GMX.

## What it does

- **Unshortens links.** Short links (bit.ly, t.co, …) and security-gateway links (Proofpoint,
  SafeLinks, Barracuda, Trend Micro, …) are expanded so the tooltip and a hover card show the
  real destination, with a **Copy address** button.
- **Two warning levels.** *Caution* (amber) for misleading links such as text that shows a
  different site than the link goes to; *Danger* (red) for look-alike brand domains, phishing
  lists, and dangerous schemes (`javascript:`, `data:`, …). Red links ask before opening.
- **Sender checks (Gmail).** The sender's verification (DMARC/DKIM/SPF via Gmail's "Show
  original") is read to judge company short links (c.gle, aka.ms, …) and brand-claiming sender
  names.
- **Threat checks.** DNS-over-HTTPS resolvers (Cloudflare, AdGuard, Quad9, Control D, …),
  community shortener lists, and local phishing lists (OpenPhish, Phishing Army).
- **QR codes** in email images and image/PDF attachments are decoded on-device and their
  destination is checked like a link; QR codes drawn with HTML tables or block characters are
  caught too.
- **Attachment checks.** SVG/HTML attachments are scanned for scripts and hidden destinations;
  encrypted archives and deceptive file names are flagged.
- **Tracking pixels** (1×1 images and known open-tracking addresses) are removed, while keeping
  the email's real images.
- **Checks before you send (Gmail).** Links you write are checked for typos, look-alikes and
  dead sites before the email goes out; a dialog lets you go back and fix them.
- **Privacy levels.** *Standard*, *Private* (no link sent to any lookup service) or *Offline
  only* (nothing leaves the browser). Every feature can be switched off individually.

## Install (load unpacked)

The extension isn't in a web store yet; it's installed from this folder. See
[INSTALL-FOR-TESTERS.md](INSTALL-FOR-TESTERS.md) for the full walkthrough:

1. Move this folder somewhere permanent (Chrome loads it from there).
2. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose this folder (the one containing `manifest.json`).
4. Reload your webmail tab.

**Updating:** replace the files in the same folder, click ↻ on the extension's card, and reload
your webmail. Settings are kept.

## For administrators

Settings can be forced with Google Workspace, Microsoft Intune or Group Policy. See
[ADMIN-GUIDE.md](ADMIN-GUIDE.md) and the schema in [`schema.json`](schema.json);
[`policy-example.json`](policy-example.json) shows a complete policy.

## Repository layout

| Path | Role |
|---|---|
| `manifest.json` | Manifest V3 declaration, permissions, supported sites |
| `background.js` | Service worker: link pipeline, threat checks, list sync, badge |
| `content.js` / `content.css` | Injected into webmail: banners, link markings, hover card |
| `shared.js` | Settings, constants and helpers shared by all contexts |
| `decoders.js` | Offline decoders for short links, gateways and trackers |
| `qr-decoder.js` | Self-contained QR decoder (no dependencies) |
| `scanner.js` / `scanner.html` | Hidden offscreen document for QR/PDF scanning |
| `options.*`, `popup.*` | Settings, logging and inspection UI; the toolbar popup |
| `lib/` | Bundled pdf.js (Apache-2.0), used only for PDF attachments |
| `tools/refresh-snapshot.js` | Refreshes the bundled shortener-domain snapshot |
| `CHANGELOG.md` | Full release history with rationale for every change |

## Documentation

- [CHANGELOG.md](CHANGELOG.md) — every version, what changed and why.
- [INSTALL-FOR-TESTERS.md](INSTALL-FOR-TESTERS.md) — install and update steps.
- [ADMIN-GUIDE.md](ADMIN-GUIDE.md) — deployment and policy keys.
- The extension's own **Help** tab explains how each warning works, the privacy details and
  troubleshooting.

## Privacy

- Link expansion, QR decoding and attachment checks run on your device wherever possible.
- The privacy level controls whether any lookup service (unshorten.me, DNS resolvers) ever
  receives a domain, and *Offline only* stops all network checks.
- Logs and history stay in local extension storage and can be cleared or auto-deleted.

## License

[Apache License 2.0](LICENSE). Bundled third-party components keep their own licenses
(`lib/PDFJS-LICENSE`, credits in the extension's Help → About).
