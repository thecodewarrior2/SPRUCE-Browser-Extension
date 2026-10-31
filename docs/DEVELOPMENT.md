# Building, testing and publishing S.P.R.U.C.E+

For people working on the extension itself: the Safari build (branch `safari`). Everyone else needs only the
[README](../README.md); administrators, the [admin guide](ADMIN-GUIDE.md).

## Branches and workflow

| Branch | What it holds |
|---|---|
| `testing` | **Where all work happens first.** Every change is made, tested and committed there. |
| `main` | The Chrome and Edge build. |
| `firefox` | The Firefox (desktop) build. |
| `safari` | The Safari build. |

A change is made and tested on `testing`, brought into `main`, and then ported to this branch (its
files differ in places: the background page, policies, browser APIs) and tested here before it is
pushed. Nothing goes to `main`, `firefox` or `safari` that hasn't been on `testing` first.

The branch rules on GitHub (no deleting, no force pushes, linear history on `main`, `firefox` and
`safari`; a passing test run before a commit reaches `main`) are kept in `.github/rulesets/` on
`main`; its
[development guide](https://github.com/thecodewarrior2/SPRUCE-Browser-Extension/blob/main/docs/DEVELOPMENT.md#checks-and-branch-rules-on-github)
explains how to import them.

## Run it from source

Requires **Safari 18.2 or later** (macOS; iOS and iPadOS with a build signed by your organization). In
Safari an extension comes inside a small app, built from this folder with Apple's converter. See
[docs/INSTALL-FOR-TESTERS.md](INSTALL-FOR-TESTERS.md) for the full walkthrough:

1. On a Mac with Xcode, run `tools/build-safari.sh` (or download the app from the **Safari build**
   GitHub workflow, `.github/workflows/safari.yml`).
2. In Safari, turn on **Settings → Advanced → Show features for web developers**, then
   **Develop → Allow Unsigned Extensions**.
3. Open the app once, tick the extension in **Safari → Settings → Extensions**, and choose
   **Always Allow on This Website** on your webmail.

The script leaves an Xcode project in `build/safari/` to sign with your team and archive for the App
Store, TestFlight or Developer ID distribution.

## Publishing a release

Nothing is attached to the [releases page](https://github.com/thecodewarrior2/SPRUCE-Browser-Extension/releases) for Safari until there is a signed and notarized app
(it needs an Apple Developer account). An unsigned build only runs with Safari's "Allow unsigned
extensions", which resets every time Safari restarts, so it is for testing only.

## Repository layout

| Path | Role |
|---|---|
| `manifest.json` | Manifest V3 declaration, permissions, supported sites (minimum Safari version) |
| `background.html` | Non-persistent background page: loads the background scripts and the scanner |
| `background.js` | Link pipeline, threat checks, list sync, badge |
| `content.js` / `content.css` | Injected into webmail: banners, link markings, hover card, sender checks, sender icons and moving phishing to Spam, the Send check. One mail engine for every site, driven by the site's entry in `WEBMAIL_SITES` (`shared.js`); today only Gmail's entry describes its inbox list, toolbar and compose window |
| `shared.js` | Settings, constants and helpers shared by all contexts |
| `decoders.js` | Offline decoders for short links, gateways and trackers |
| `custom-endpoints.js` | Requests and replies for your own lookup service or threat resolver |
| `qr-decoder.js` | Self-contained QR decoder (no dependencies) |
| `scanner.js` / `compat.js` | QR/PDF scanning in the background page; shims pdf.js needs in Safari |
| `options.*`, `help.js`, `popup.*` | Settings, logging, Link Inspector and Help; the toolbar popup |
| `theme.css` / `theme.js` | Design tokens and light/dark appearance (WCAG 2.1 AA) |
| `lib/` | Bundled pdf.js (Apache-2.0), used only for PDF attachments |
| `tools/refresh-snapshot.js` | Refreshes the bundled shortener-domain snapshot |
| `tools/build-safari.sh` | Wraps the extension in a Mac/iPhone/iPad app with Apple's converter and builds it (macOS, Xcode) |
| `.github/workflows/safari.yml` | Builds the app on a GitHub Mac and offers it for download |
| `icons/` | Toolbar and store icons |
| `docs/` | Architecture guide, admin guide, tester instructions |
| `branding/` | Logos, icons and the donation QR code (PNG and SVG) |
| `tests/` | Unit and end-to-end tests, with sanitized sample emails |
| `CHANGELOG.md` · `PRIVACY.md` · `LICENSE` | Release history · privacy policy · Apache 2.0 license |

Everything at the top level besides those three files and the README is part of the extension; `docs/`, `branding/`, `tests/`, `tools/` and `.github/` never go into the app.

## Design rules

- **Never contact a link's destination on your behalf** when reading mail; only lookup services
  you can switch off are used. The one exception is the Send check, which makes one request to each
  website you link to, as your reader would by clicking it, and never for one-time links.
- **Never change an email being written,** only emails being read.
- **Only flagged senders are moved to Spam,** only once, and only with Gmail's own Report spam; what the
  user takes back out of Spam stays out.
- **Never trap an email:** if the Send check can't finish, the email is sent.
- **Managed settings win** in the Chrome and Firefox builds (Safari has no extension policies).

## Testing

Unit tests (Node) cover the link pipeline, decoders and shared logic; browser tests (Playwright)
run the extension on simulated webmail pages; accessibility audits check contrast in light and dark
mode and names and roles. Webmail page structure is mapped from public information and simulated
pages, so changes to a webmail's layout need checking on the live site. The tests are in `tests/`
(see `tests/README.md`; not part of the extension package):

```bash
cd tests && npm install && node run-all.js
```

The browser tests drive Chromium, which can't load a Safari build; on this branch they check the
shared code, and the unit tests run against it directly (`EXT=. node --test tests/unit/unit.test.js`).
Try each change in Safari itself before release.
