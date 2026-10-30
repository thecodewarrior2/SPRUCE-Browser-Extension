# Building, testing and publishing S.P.R.U.C.E+

For people working on the extension itself: the Chrome and Edge build (branch `main`). Everyone else needs only the
[README](../README.md); administrators, the [admin guide](ADMIN-GUIDE.md).

## Run it from source (load unpacked)

The repository's top folder is the extension. See
[docs/INSTALL-FOR-TESTERS.md](INSTALL-FOR-TESTERS.md) for the full walkthrough:

1. Put the repository folder somewhere permanent (Chrome loads it from there).
2. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the repository folder (the one containing `manifest.json`).
4. Reload your webmail tab.

**Updating:** replace the files in the same folder, click ↻ on the extension's card, and reload
your webmail. Settings are kept.

The `key` in `manifest.json` is the extension's **public** key: it keeps the extension ID the same
on every computer, so settings and managed policies apply. It's safe to publish. The matching
private key (`.pem`) signs releases and must never be committed (`.gitignore` leaves out `*.pem`).

## Publishing to the Chrome Web Store (or Edge Add-ons)

The listing text, a reason for each permission and the data-usage answers are in
[store/STORE-LISTING.md](../store/STORE-LISTING.md); the screenshots and promo image are in [`store`](../store); the
privacy policy is [PRIVACY.md](../PRIVACY.md).

Run `tools/build-webstore.sh` and upload `build/spruce-<version>-webstore.zip`. It is the last commit
without the `key` field, which the stores refuse on a new item's first upload. The store gives the
extension its own ID, so administrators use that ID in policies (the policy names don't change). In
the developer dashboard, the store also asks for a privacy policy link, a reason for each permission,
the data the extension handles (website content and email, read on the device), screenshots and a
promotional image.

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
| `icons/` | Toolbar and store icons |
| `tools/` | Maintenance scripts: `build-webstore.sh` (the store zip), `refresh-snapshot.js` (the bundled shortener list) |
| `docs/` | Architecture guide, admin guide, tester instructions, policy example |
| `store/` | Chrome Web Store listing text and images, and the script that makes the images |
| `branding/` | Logos, icons and the donation QR code (PNG and SVG) |
| `tests/` | Unit and end-to-end tests, with sanitized sample emails |
| `CHANGELOG.md` · `PRIVACY.md` · `LICENSE` | Release history · privacy policy · Apache 2.0 license |

Everything at the top level besides those three files and the README is part of the extension (the folder a browser loads); `docs/`, `store/`, `branding/`, `tests/` and `tools/` never go into a package.

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
