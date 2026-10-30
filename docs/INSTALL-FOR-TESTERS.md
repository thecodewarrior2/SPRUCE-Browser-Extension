# Installing it manually (Chrome or Edge)

Most people should install S.P.R.U.C.E+ from the Chrome Web Store (Edge: Edge Add-ons): it updates
itself. To install it yourself instead (a test version, or a download from the
[releases page](https://github.com/thecodewarrior2/SPRUCE-Browser-Extension/releases), the file
named `spruce-<version>-chrome-manual-install.zip`), follow these steps. It takes about a minute.
A manual install doesn't update itself: check the releases page for new versions.

## Install

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

## Good to know

- Chrome on Windows may show **"Disable developer mode extensions"** when it starts.
  Just close that message; the extension keeps working.
- **Updating to a new version:** replace the files in the same folder, then click the
  ↻ (reload) button on the extension's card and reload your webmail. Your settings are kept.
- **Removing it:** click **Remove** on the extension's card.

## Reporting a problem

Open the extension's **Settings → Logging → Application log**, click **Export**, and send
the file with a short description of what happened (and which webmail you use). The log
contains site names and times, never the content of your emails.
