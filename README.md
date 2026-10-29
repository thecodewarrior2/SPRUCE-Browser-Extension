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
  be switched off individually.

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

## Repository layout

| Path | Role |
|---|---|
| `manifest.json` | Manifest V3 declaration, permissions, supported sites |
| `background.js` | Service worker: link pipeline, threat checks, list sync, badge |
| `content.js` / `content.css` | Injected into webmail: banners, link markings, hover card, sender checks, the Send check |
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
- **Never trap an email:** if the Send check can't finish, the email is sent.
- **Managed settings win:** policy values (Workspace, Intune, Group Policy) can't be changed or
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
