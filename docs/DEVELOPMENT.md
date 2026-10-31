# Building, testing and publishing S.P.R.U.C.E+

For people working on the extension itself: the Firefox build (branch `firefox`). Everyone else needs only the
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

Requires **Firefox 140 or later** (desktop). Until it's on addons.mozilla.org, it's loaded from this
folder. See [docs/INSTALL-FOR-TESTERS.md](INSTALL-FOR-TESTERS.md) for the full walkthrough:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `manifest.json` in this folder.
3. Reload your webmail tab.

A temporary add-on stays loaded until Firefox restarts. To check the build, run `npx web-ext lint`;
to package it for addons.mozilla.org, run `npx web-ext build`. The add-on ID
(`spruce@spruce-browser-extension`, in `manifest.json`) keeps settings and managed policies
attached to the same add-on on every computer.

## Publishing a release

Upload the add-on to addons.mozilla.org (desktop only). Release Firefox only installs add-ons signed by
Mozilla, so the [releases page](https://github.com/thecodewarrior2/SPRUCE-Browser-Extension/releases) gets the **signed** `.xpi` from the developer hub once the
version is approved (or, without a public listing, from an "On your own" submission), named
`spruce-<version>-firefox.xpi`. Never attach an unsigned zip. The release notes drafts are in
`docs/releases/` on `main`.

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
| `icons/` | Toolbar and store icons |
| `tools/` | Maintenance scripts: `refresh-snapshot.js` (the bundled shortener list) |
| `docs/` | Architecture guide, admin guide, tester instructions, policy example |
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
- **Managed settings win:** policy values (Firefox enterprise policy) can't be changed or
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

The tests never pause for a fixed time: they wait for what they check, or for the page to report that
the extension is done (`<html data-unshortener-busy="0">`). How to write them is in
[`tests/README.md`](../tests/README.md).
