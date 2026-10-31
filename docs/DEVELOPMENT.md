# Building, testing and publishing S.P.R.U.C.E+

For people working on the extension itself: the Chrome and Edge build (branch `main`). Everyone else needs only the
[README](../README.md); administrators, the [admin guide](ADMIN-GUIDE.md).

## Branches and workflow

| Branch | What it holds |
|---|---|
| `testing` | **Where all work happens first.** Every change is made, tested and committed here. |
| `main` | The Chrome and Edge build: what the Chrome Web Store and Edge Add-ons get. |
| `firefox` | The Firefox (desktop) build. |
| `safari` | The Safari build. |

1. Work on `testing` (start from the latest `main`: `git checkout testing && git merge main`).
2. Run the tests (below) and try the change in the browser. Commit and push `testing`.
3. When `testing` is ready, bring it into `main` (`git checkout main && git merge --ff-only testing`)
   and push.
4. Port the change to `firefox` and `safari` (their files differ in places: the background page,
   policies, browser APIs), run their tests, and push them.

Nothing goes to `main`, `firefox` or `safari` that hasn't been on `testing` first.

### Checks and branch rules on GitHub

The **Tests** workflow (`.github/workflows/tests.yml`) runs the unit and browser tests on every push
to `testing` and `main` and on pull requests into `main`. Its check is named **Unit and browser
tests**.

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

## Publishing a GitHub release

The [releases page](https://github.com/thecodewarrior2/SPRUCE-Browser-Extension/releases) is for people
who install the extension themselves. Store installs update on their own; manual installs don't.

1. On `main`, with the version in `manifest.json` and a `CHANGELOG.md` entry for it, run
   `tools/build-webstore.sh --manual`. It builds `build/spruce-<version>-chrome-manual-install.zip`:
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
| `tools/` | Maintenance scripts: `build-webstore.sh` (the store zip; `--manual` for the releases page), `refresh-snapshot.js` (the bundled shortener list) |
| `docs/` | Features, admin guide, architecture, this guide, install steps, policy example, release notes drafts (`docs/releases/`) |
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

The tests never pause for a fixed time: they wait for what they check, or for the page to report that
the extension is done (`<html data-unshortener-busy="0">`). How to write them is in
[`tests/README.md`](../tests/README.md).
