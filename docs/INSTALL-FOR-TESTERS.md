# Installing the test version (Firefox)

These steps load an unsigned test version, which Firefox removes when it restarts. To install
the add-on for good, use addons.mozilla.org or the signed `.xpi` from the
[releases page](https://github.com/thecodewarrior2/SPRUCE-Browser-Extension/releases). A test version is loaded from this folder. It takes about a minute
and needs **Firefox 140 or later**.

## Install

1. **Unzip** the download somewhere you can find it.
2. Open **about:debugging#/runtime/this-firefox** (type it in the address bar).
3. Click **Load Temporary Add-on…** and choose the `manifest.json` file in the unzipped folder.
4. Optional: click the puzzle-piece icon in the toolbar and **pin** the add-on.
5. **Reload your webmail tab.** Open any email; the toolbar icon lights up while the email is being checked.

It works in Gmail, and (experimental) in Outlook on the web, Proton Mail, Yahoo Mail, AOL Mail,
Zoho Mail, iCloud Mail, Fastmail and GMX.

## Good to know

- A **temporary add-on is removed when Firefox closes**; load it again the same way after a restart.
  Your settings are kept, because the add-on ID stays the same.
- **Updating to a new test version:** replace the files in the same folder, then click **Reload** on
  the add-on's entry in about:debugging and reload your webmail.
- **Removing it:** click **Remove** on the add-on's entry in about:debugging.

## Reporting a problem

Open the add-on's **Settings → Logging → Application log**, click **Export**, and send
the file with a short description of what happened (and which webmail you use). The log
contains site names and times, never the content of your emails.
