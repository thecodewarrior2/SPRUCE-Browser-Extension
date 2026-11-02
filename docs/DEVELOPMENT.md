# Building, testing and publishing S.P.R.U.C.E+

For people working on the extension itself. One set of files makes every browser's version: Chrome and
Edge, Firefox and Safari. Everyone else needs only the [README](../README.md); administrators, the
[admin guide](ADMIN-GUIDE.md).

## Branches and workflow

| Branch | What it holds |
|---|---|
| `testing` | **Where all work happens first.** Every change is made, tested and committed here. |
| `main` | What is released. Every browser's package is built from it (`node tools/build.js`). |
| `firefox`, `safari` | Kept for their history only: until 5.88 each browser had its own branch, maintained by hand. Nothing is added to them any more. |

1. Work on `testing` (start from the latest `main`: `git checkout testing && git merge main`).
2. Run the tests (below) and try the change in the browser. Commit and push `testing`.
3. **Stop here.** The change stays on `testing` — however green the tests and the GitHub check are —
   until the maintainer has loaded the `testing` build in their own browser, tried the change, and
   **explicitly approved releasing it**. Green tests are not approval. Further work keeps landing on
   `testing` in the meantime.
4. Only with that approval: bring `testing` into `main` (`git checkout main && git merge --ff-only testing`)
   and push. Every browser's package is then built from `main` (below); there is nothing to port.

Nothing goes to `main` that hasn't been on `testing` first — and nothing leaves `testing` without the
maintainer's explicit approval after testing the build locally.

### Checks and branch rules on GitHub

The **Tests** workflow (`.github/workflows/tests.yml`) runs on every push to `testing` and `main` and on
pull requests into `main`: the unit and browser tests in Chromium (the check named **Unit and browser
tests**), and the Firefox suite in the current Firefox ESR and in 140 ESR (**Firefox (esr)**,
**Firefox (140)**). The **Safari build** workflow (`.github/workflows/safari.yml`) builds the Safari app
on a GitHub Mac for every push to `main`, or when started by hand.

The repository's rulesets are kept in [`.github/rulesets/`](../.github/rulesets). To set them up (or
after changing one), on GitHub open **Settings → Rules → Rulesets → New ruleset → Import a ruleset**
and import each file:

| File | Applies to | Rules |
|---|---|---|
| `release-branches.json` | `main`, `firefox`, `safari` | No deleting, no force pushes, linear history (fast-forward merges) |
| `main.json` | `main` | The **Unit and browser tests** check must have passed on the commit, so a commit can only reach `main` after it passed on `testing` |
| `testing.json` | `testing` | No deleting |
| `release-tags.json` | Tags `v*` | Release tags can't be deleted or moved |

No one is on the bypass lists, so the rules apply to everyone, administrators included. If the
check fails on `testing`, fix it there and push again; `main` accepts the commit once its check is
green.

## One set of files, three browsers

The browsers need slightly different packages, and `tools/build.js` makes them all from the same files:

```bash
node tools/build.js
```

It builds from the last commit (add `--working-tree` to include uncommitted changes, for testing) and
writes `build/chrome/`, `build/firefox/`, `build/safari/extension/` and the zips listed below. What
differs between the browsers is decided in three places only:

- **The manifest.** The top-level `manifest.json` is the Chrome one; the build makes the Firefox and
  Safari manifests from it (`BROWSERS` in `tools/build.js`: no `key`, a background page instead of the
  service worker, no offscreen permission or policy schema, Firefox's add-on ID, Safari's minimum version),
  so a permission or site added for one browser is added for all.
- **The code**, where a browser lacks something: `BROWSER` in `shared.js` (`chrome`, `firefox` or `safari`,
  from the extension's own address) and simple feature checks. `background.js` loads the shared files
  itself only as Chrome's service worker; the QR scanner is Chrome's offscreen document or, in Firefox and
  Safari, runs in the background page (`background.html`).
- **The extension's pages:** a passage written for one browser is marked `data-only="firefox"` (or
  `chrome`, `safari`, or several); `shared.js` removes the other browsers' versions when the page opens.

A unit test checks the generated manifests, and the Firefox suite tests the generated Firefox build.

## Run it from source

**Chrome and Edge:** the repository's top folder is the extension. See
[docs/INSTALL-FOR-TESTERS.md](INSTALL-FOR-TESTERS.md) for the full walkthrough:

1. Put the repository folder somewhere permanent (Chrome loads it from there).
2. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the repository folder (the one containing `manifest.json`).
4. Reload your webmail tab.

**Updating:** replace the files in the same folder, click ↻ on the extension's card, and reload
your webmail. Settings are kept.

**Firefox:** run `node tools/build.js firefox --working-tree`, then in `about:debugging` →
**This Firefox** → **Load Temporary Add-on…** choose `build/firefox/manifest.json` (Firefox 140 or later;
it stays until Firefox restarts). **Safari:** run `tools/build-safari.sh` on a Mac with Xcode (see the
install guide).

The `key` in `manifest.json` is the extension's **public** key: it keeps the extension ID the same
on every computer, so settings and managed policies apply. It's safe to publish. The matching
private key (`.pem`) signs releases and must never be committed (`.gitignore` leaves out `*.pem`).

## Publishing to the Chrome Web Store (or Edge Add-ons)

The listing text, a reason for each permission and the data-usage answers are in
[store/STORE-LISTING.md](../store/STORE-LISTING.md); the screenshots and promo image are in [`store`](../store); the
privacy policy is [PRIVACY.md](../PRIVACY.md).

Run `node tools/build.js chrome` and upload `build/spruce-<version>-webstore.zip`. It is the last commit
without the `key` field, which the stores refuse on a new item's first upload. The store gives the
extension its own ID, so administrators use that ID in policies (the policy names don't change). In
the developer dashboard, the store also asks for a privacy policy link, a reason for each permission,
the data the extension handles (website content and email, read on the device), screenshots and a
promotional image.

## Publishing to addons.mozilla.org (Firefox)

Run `node tools/build.js firefox` and upload `build/spruce-<version>-firefox.zip` in the AMO developer hub
(listed, or "On your own" for a signed `.xpi` without a public listing). Its ID is
`spruce@spruce-browser-extension` (set by the build), and it declares the data it handles
(`data_collection_permissions`: website content and personal communications, read on the device). Firefox
installs only add-ons signed by Mozilla, so never publish the zip itself.

## Publishing a GitHub release

The [releases page](https://github.com/thecodewarrior2/SPRUCE-Browser-Extension/releases) is for people
who install the extension themselves. Store installs update on their own; manual installs don't.

1. On `main`, with the version in `manifest.json` and a `CHANGELOG.md` entry for it, run
   `node tools/build.js`. Among the files it builds is `build/spruce-<version>-chrome-manual-install.zip`:
   one folder, `S.P.R.U.C.E+-<version>`, with the extension and `INSTALL.md`. Unlike the store zip it
   **keeps the `key`**, so every manual install has the same extension ID as the test version and
   managed policies reach it.
2. Firefox: release Firefox only installs add-ons signed by Mozilla, so never attach an unsigned zip.
   Once the version is approved on addons.mozilla.org, download its signed `.xpi` from the developer
   hub and name it `spruce-<version>-firefox.xpi`. (Without a public listing, submit it as
   "On your own" to get a signed `.xpi`.)
3. Safari: don't attach anything until there is a signed and notarized app (it needs an Apple
   Developer account). An unsigned build only runs with Safari's "Allow unsigned extensions",
   which resets every time Safari restarts.
4. Write the release notes from the draft in [`docs/releases/`](releases) (one file per version), fill
   in the store links and the checksums (`sha256sum` of each file), create the release with the tag
   `v<version>` on `main`, and attach the files.

## Repository layout

| Path | Role |
|---|---|
| `manifest.json` | Manifest V3 declaration, permissions, supported sites (the Chrome manifest; `tools/build.js` makes the Firefox and Safari ones from it) |
| `background.js` | The background (Chrome's service worker; Firefox's and Safari's background page): link pipeline, threat checks, list sync, badge |
| `background.html` | Firefox and Safari: the background page that loads the background scripts and the scanner |
| `content.js` / `content.css` | Injected into webmail: banners, link markings, hover card, sender checks, sender icons and moving phishing to Spam, the Send check. One mail engine for every site, driven by the site's entry in `WEBMAIL_SITES` (`shared.js`); today only Gmail's entry describes its inbox list, toolbar and compose window |
| `shared.js` | Settings, constants and helpers shared by all contexts |
| `decoders.js` | Offline decoders for short links, gateways and trackers |
| `custom-endpoints.js` | Requests and replies for your own lookup service or threat resolver |
| `qr-decoder.js` | Self-contained QR decoder (no dependencies) |
| `scanner.js` / `scanner.html` | QR/PDF scanning: Chrome's hidden offscreen document (`scanner.html`); in Firefox and Safari `scanner.js` runs in the background page |
| `compat.js` | Shims for JavaScript features pdf.js uses that older browsers lack |
| `options.*`, `help.js`, `popup.*` | Settings, logging, Link Inspector and Help; the toolbar popup |
| `theme.css` / `theme.js` | Design tokens and light/dark appearance (WCAG 2.1 AA) |
| `lib/` | Bundled pdf.js (Apache-2.0), used only for PDF attachments |
| `icons/` | Toolbar and store icons |
| `tools/` | `build.js` (every browser's package), `build-safari.sh` (the Safari app, on a Mac), `refresh-snapshot.js` (the bundled shortener list) |
| `docs/` | Features, admin guide, architecture, this guide, install steps, policy example, release notes drafts (`docs/releases/`) |
| `store/` | Chrome Web Store listing text and images, and the script that makes the images |
| `branding/` | Logos, icons and the donation QR code (PNG and SVG) |
| `tests/` | Unit and end-to-end tests (Chromium), the Firefox suite (real Firefox), sanitized sample emails |
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
- **Managed settings win:** policy values (Workspace, Intune, Group Policy; Firefox enterprise policy)
  can't be changed or reset by the user.

## Testing

Unit tests (Node) cover the link pipeline, decoders and shared logic; browser tests (Playwright)
run the extension on simulated webmail pages; accessibility audits check contrast in light and dark
mode and names and roles. Webmail page structure is mapped from public information and simulated
pages, so changes to a webmail's layout need checking on the live site. The tests are in `tests/`
(see `tests/README.md`; not part of the extension package):

```bash
cd tests && npm install && node run-all.js
```

The **Firefox suite** builds the Firefox version and runs it in real Firefox — the current ESR, and 140 ESR,
the oldest it supports — on the same simulated pages: the background page and its QR/PDF scanner, the
spam mover, message frames, permission requests (Firefox accepts them only directly inside a click), site
access switched off, and enterprise policy (Linux):

```bash
cd tests && firefox/get-firefox.sh && node firefox/run.js
```

```bash
cd tests && firefox/get-firefox.sh 140 && FXBIN=.firefox/140/firefox/firefox node firefox/run.js
```

Safari can't be tested here; the Safari build workflow checks that the app builds.

The tests never pause for a fixed time: they wait for what they check, or for the page to report that
the extension is done (`<html data-unshortener-busy="0">`). How to write them is in
[`tests/README.md`](../tests/README.md).
