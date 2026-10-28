# Installing the test version (Chrome or Edge)

The extension isn't in a web store yet, so it's installed from this folder. It takes about a minute.

## Install

1. **Unzip** the download and move the `gmail-link-unshortener` folder somewhere permanent
   (for example your Documents folder). Chrome loads it from there, so don't delete it later.
2. Open **chrome://extensions** (Edge: **edge://extensions**).
3. Turn on **Developer mode** (top-right in Chrome; left side in Edge).
4. Click **Load unpacked** and choose the `gmail-link-unshortener` folder
   (the one that contains `manifest.json`).
5. Optional: click the puzzle-piece icon in the toolbar and **pin** the extension.
6. **Reload your webmail tab.** Open any email; the toolbar icon lights up while the email is being checked.

It works in Gmail, and (experimental) in Outlook on the web, Proton Mail, Yahoo Mail, AOL Mail,
Zoho Mail, iCloud Mail, Fastmail and GMX. The extension ID shown on its card should be
**nnbeoijlicodfplamcelmdlkjggddfla**.

## Good to know

- Chrome on Windows may show **"Disable developer mode extensions"** when it starts.
  Just close that message; the extension keeps working.
- **Updating to a new test version:** replace the files in the same folder, then click the
  ↻ (reload) button on the extension's card and reload your webmail. Your settings are kept.
- **Removing it:** click **Remove** on the extension's card.

## Reporting a problem

Open the extension's **Settings → Logging → Application log**, click **Export**, and send
the file with a short description of what happened (and which webmail you use). The log
contains site names and times, never the content of your emails.
