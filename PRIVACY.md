# Privacy policy: S.P.R.U.C.E+

**S.P.R.U.C.E+ (Spam & Phishing Risk URL Checker Extension+)** for Chrome, Edge, Firefox and Safari.
Effective October 30, 2026.

## In short

- S.P.R.U.C.E+ has **no account, no advertising, no analytics and no server of its own**. Its
  developer receives no information about you or your email.
- It checks your email **on your device**. Your email's text, subject, attachments, recipients and
  your own address are **never sent anywhere**.
- To check whether a website is dangerous, it can send **the website's name** (for example
  `example.com`) to public security services. What can be sent, and to whom, is listed below. You can
  turn every one of these off.
- Nothing is sold, shared for advertising, or used for anything except helping you spot spam and phishing.

## What the extension reads, on your device

On the webmail sites it supports (Gmail, Outlook on the web, Yahoo Mail, AOL Mail, Zoho Mail, iCloud
Mail, Fastmail, GMX and Proton Mail), S.P.R.U.C.E+ reads the page you have open:

- in an opened email: its links and link text, its images and attachments (to find QR codes and
  hidden scripts; attachments up to 10 MB), the sender's name and address, and the subject;
- in your inbox list: each email's sender name and address and its subject;
- in Gmail: an email's original source (its technical headers), read from Gmail with your own
  session, to check the sender's verification and look for forged headers;
- the address you are signed in with (from the page's title), to recognize your own organization and
  scams that use your own name.

This is examined in your browser. None of it is sent to the developer.

## What can leave your device, and to whom

Only the items below, only for the feature named, and each can be switched off in Settings. Every
service contacted sees your computer's IP address, as with any web request.

| Feature | What is sent | Who receives it |
|---|---|---|
| Threat checks of links | The website's name only (for example `example.com`) | DNS security services: Cloudflare (1.1.1.1, Security and Family), Quad9, Control D, DNS4EU if you turn it on, AdGuard only as a backup, or your organization's own service |
| Sender checks (Gmail) | The sender's domain only (for example `example.com`), never the address. Big email providers' domains and your own organization's are never sent | The same DNS security services |
| Short-link lookup | The full address of a public short link (such as bit.ly), or a link you choose to reveal with 🔍. Never one-time links (password reset, sign-in, verification, unsubscribe) and never email-tracking links automatically | unshorten.me, or your organization's own service |
| Revealing a cloud-storage page | Only when you click 🔍 on such a link: a plain download of that page | Google Cloud Storage or Firebase Storage |
| Checking links before sending (Gmail) | When you press Send: the website names of the links you wrote (to the DNS services above), and one request to each linked website to see that it answers | The DNS services; the websites you linked to |
| Sender icons (Gmail) | The sender's website name | Google's icon service; DuckDuckGo's icon service for sites without an icon of their own |
| Company logos (BIMI) | The company's main domain name, to read its published logo record | Cloudflare 1.1.1.1; the company's own logo server then sees your IP address when the picture loads |
| Sender country | The internet address of the server that delivered an email (from your webmail's own record) | country.is |
| Look-alike sender check | A sender domain that looks like a protected one: its name, to learn when it was registered | That domain's registry (public RDAP records), found through IANA's public list |
| Brand ownership check | Only when a sender's name claims a well-known brand on a domain not known as the brand's, or a link's text and destination name the same company but one of them only carries Google's, Amazon's or PayPal's name under another ending (amazon.de): that domain's name, to learn who registered it and whether its DNS records tie it to the brand | That domain's registry and (when the registry keeps no registrant) its registrar, both public RDAP records; the DNS resolvers above for its DMARC and name-server records |
| Following a link (Link Inspector) | Only when you click **Follow it to reveal the destination** on a tracking or short link whose destination is hidden: one request that follows its redirects as a click would, without your cookies and without loading the page. The sender's tracking service counts it as your click | The link's tracking service (for example SendGrid) and the sites it redirects to |
| VirusTotal lookup (Link Inspector) | Only if you add your own VirusTotal API key and click **Look up on VirusTotal**: the link you pasted (for a one-time link, only its site name). **Scan this link** also shares the link with VirusTotal's community and security partners, and is never offered for one-time links | VirusTotal (Google) |
| QR codes in email images (Gmail) | Nothing new: the image is fetched again from Gmail's own image proxy, which already showed it | Google |
| List updates | Nothing about you: plain downloads of public lists (short-link services, phishing sites, scam senders, popular sites, and ICANN's list of internet endings, for those only one company may use), at most once a day or once a month | GitHub (raw.githubusercontent.com), openphish.com, phishing.army, tranco-list.eu, www.icann.org |

**Second-opinion links (Link Inspector):** the Inspector shows links to VirusTotal, urlscan.io, Google
Safe Browsing and Sucuri SiteCheck with only the site's name filled in. Nothing is sent unless you
click one; it then opens in a new tab like any other website.

**Moving emails to Spam:** when an email is flagged, the extension can click your webmail's own
**Report spam** button for you, exactly as if you clicked it. Your webmail provider receives that
report as it would from you. This can be turned off.

**Choosing less:** Settings → Privacy level → **Private** sends no link to any third party;
**Offline only** sends nothing at all (links are still decoded and tricks still detected, but sites
aren't checked for threats).

## What is stored on your device

Kept in your browser's storage for this extension, never uploaded:

- your settings;
- recent check results, so the same link or sender isn't looked up again;
- a history of checked links and an application log (deleted automatically after 30 days by default;
  you can shorten that or turn them off). One-time links are never kept in full;
- sender icons, colleagues' photos and company logos already shown by your webmail;
- the list of emails moved to Spam, with why, so an email you take back out isn't moved again;
- the address of your own webmail account (as the page title shows it) next to log entries, so that
  with several accounts signed in you can tell which account each entry belongs to; it is deleted
  with the logs;
- names of people in your organization, only as one-way codes (hashes) that can't be read back, to
  spot outsiders using a colleague's name.

You can delete all of it in Settings (Data on this device) and in Logging. Uninstalling the extension
deletes everything.

## Schools and organizations

An administrator can set or lock the extension's settings by policy (for example through Google
Workspace or Microsoft Intune). The extension reports nothing to administrators or to anyone else.
It is suitable for students: it collects no data from anyone.

## Changes

Changes to this policy are published in this file, with a new effective date. The project's history
on GitHub shows every earlier version.

## Contact

Questions or concerns: open an issue at
[github.com/thecodewarrior2/SPRUCE-Browser-Extension/issues](https://github.com/thecodewarrior2/SPRUCE-Browser-Extension/issues).
