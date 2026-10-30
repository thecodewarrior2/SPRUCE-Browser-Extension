# Installing the test version (Safari)

The Safari extension comes inside a small Mac app. For testing, the app is signed only "to run
locally", so Safari has to be told to allow unsigned extensions. It takes a few minutes and needs
**Safari 18.2 or later** on a Mac.

## Get the app

- **From GitHub:** open the latest run of the **Safari build** workflow and download
  `safari-mac-app` under Artifacts; unzip it (twice: GitHub zips the zip) to get **Link Unshortener.app**.
- **Or build it yourself** on a Mac with Xcode: run `tools/build-safari.sh` in this folder; the app is in
  `build/safari/LinkUnshortener-<version>-macos.zip`.

## Install

1. Move **Link Unshortener.app** to your Applications folder.
2. The first time, **right-click the app → Open** and confirm (macOS warns about apps from outside the
   App Store). If it still refuses, run `xattr -dr com.apple.quarantine "/Applications/Link Unshortener.app"`
   in Terminal, then open it again.
3. In Safari: **Settings → Advanced → Show features for web developers**, then in the menu bar
   **Develop → Allow Unsigned Extensions** (enter your password).
4. **Safari → Settings → Extensions:** tick **Gmail Link Unshortener & Tracker Blocker**.
5. Open your webmail, click the extension's toolbar icon (or the **Aa**/puzzle icon) and choose
   **Always Allow on This Website**. Reload the page.

It works in Gmail, and (experimental) in Outlook on the web, Proton Mail, Yahoo Mail, AOL Mail,
Zoho Mail, iCloud Mail, Fastmail and GMX.

## Good to know

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
