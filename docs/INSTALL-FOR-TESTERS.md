# Installing it yourself

Most people should install S.P.R.U.C.E+ from their browser's store, where it updates itself. These
steps are for a test version or a download from the
[releases page](https://github.com/thecodewarrior2/SPRUCE-Browser-Extension/releases):
[Chrome or Edge](#chrome-or-edge) · [Firefox](#firefox) · [Safari](#safari).

## Chrome or Edge

Most people should install S.P.R.U.C.E+ from the Chrome Web Store (Edge: Edge Add-ons): it updates
itself. To install it yourself instead (a test version, or a download from the
[releases page](https://github.com/thecodewarrior2/SPRUCE-Browser-Extension/releases), the file
named `spruce-<version>-chrome-manual-install.zip`), follow these steps. It takes about a minute.
A manual install doesn't update itself: check the releases page for new versions.

### Install

1. **Unzip** the download and move the unzipped folder (`S.P.R.U.C.E+-<version>`) somewhere permanent
   (for example your Documents folder). Chrome loads it from there, so don't delete it later.
2. Open **chrome://extensions** (Edge: **edge://extensions**).
3. Turn on **Developer mode** (top-right in Chrome; left side in Edge).
4. Click **Load unpacked** and choose that folder
   (the one that contains `manifest.json`).
5. Optional: click the puzzle-piece icon in the toolbar and **pin** the extension.
6. **Reload your webmail tab.** Open any email; the toolbar icon lights up while the email is being checked.

It works in Gmail, and (experimental) in Outlook on the web, Proton Mail, Yahoo Mail, AOL Mail,
Zoho Mail, iCloud Mail, Fastmail and GMX. The extension ID shown on its card should be
**nnbeoijlicodfplamcelmdlkjggddfla**.

### Good to know

- Chrome on Windows may show **"Disable developer mode extensions"** when it starts.
  Just close that message; the extension keeps working.
- **Updating to a new version:** replace the files in the same folder, then click the
  ↻ (reload) button on the extension's card and reload your webmail. Your settings are kept.
- **Removing it:** click **Remove** on the extension's card.

## Firefox

These steps load an unsigned test version, which Firefox removes when it restarts. To install
the add-on for good, use addons.mozilla.org or the signed `.xpi` from the
[releases page](https://github.com/thecodewarrior2/SPRUCE-Browser-Extension/releases). A test version is
`spruce-<version>-firefox.zip` (or the `build/firefox` folder that `node tools/build.js firefox` makes). It takes about a minute
and needs **Firefox 140 or later**.

### Install

1. **Unzip** the download somewhere you can find it.
2. Open **about:debugging#/runtime/this-firefox** (type it in the address bar).
3. Click **Load Temporary Add-on…** and choose the `manifest.json` file in the unzipped folder.
4. Optional: click the puzzle-piece icon in the toolbar and **pin** the add-on.
5. **Reload your webmail tab.** Open any email; the toolbar icon lights up while the email is being checked.

It works in Gmail, and (experimental) in Outlook on the web, Proton Mail, Yahoo Mail, AOL Mail,
Zoho Mail, iCloud Mail, Fastmail and GMX.

### Good to know

- A **temporary add-on is removed when Firefox closes**; load it again the same way after a restart.
  Your settings are kept, because the add-on ID stays the same.
- **Updating to a new test version:** replace the files in the same folder, then click **Reload** on
  the add-on's entry in about:debugging and reload your webmail.
- **Removing it:** click **Remove** on the add-on's entry in about:debugging.

## Safari

The Safari extension comes inside a small Mac app. For testing, the app is signed only "to run
locally", so Safari has to be told to allow unsigned extensions. It takes a few minutes and needs
**Safari 18.2 or later** on a Mac.

### Get the app

- **From GitHub:** open the latest run of the **Safari build** workflow and download
  `safari-mac-app` under Artifacts; unzip it (twice: GitHub zips the zip) to get **SPRUCE.app**.
- **Or build it yourself** on a Mac with Xcode: run `tools/build-safari.sh` in this folder; the app is in
  `build/safari/SPRUCE-<version>-macos.zip`.

### Install

1. Move **SPRUCE.app** to your Applications folder.
2. The first time, **right-click the app → Open** and confirm (macOS warns about apps from outside the
   App Store). If it still refuses, run `xattr -dr com.apple.quarantine "/Applications/SPRUCE.app"`
   in Terminal, then open it again.
3. In Safari: **Settings → Advanced → Show features for web developers**, then in the menu bar
   **Develop → Allow Unsigned Extensions** (enter your password).
4. **Safari → Settings → Extensions:** tick **S.P.R.U.C.E+**.
5. Open your webmail, click the extension's toolbar icon (or the **Aa**/puzzle icon) and choose
   **Always Allow on This Website**. Reload the page.

It works in Gmail, and (experimental) in Outlook on the web, Proton Mail, Yahoo Mail, AOL Mail,
Zoho Mail, iCloud Mail, Fastmail and GMX.

### Good to know

- **Allow Unsigned Extensions is switched off each time Safari quits**, which also turns the extension
  off; switch it on again (step 3). A signed build from your organization doesn't need this.
- **Updating to a new test version:** quit Safari, replace the app in Applications, open it once, then
  start Safari. Your settings are kept.
- **Removing it:** untick it in Safari → Settings → Extensions, then move the app to the Trash.
- **iPhone and iPad:** the extension needs a build signed by your organization (TestFlight or the App
  Store); turn it on in the Settings app → Apps → Safari → Extensions.

## Reporting a problem

Open the extension's **Settings → Logging → Application log**, click **Export**, and send
the file with a short description of what happened (and which webmail you use). The log
contains site names and times, never the content of your emails.
