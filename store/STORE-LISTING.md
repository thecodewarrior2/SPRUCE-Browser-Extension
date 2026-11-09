# Chrome Web Store listing: S.P.R.U.C.E+

Text for each field of the Chrome Web Store developer dashboard, ready to copy. The same answers work
for Microsoft Edge Add-ons. Upload `build/spruce-<version>-webstore.zip`, made by `node tools/build.js chrome`
(from the top folder).

**Published listings:** [Chrome Web Store](https://chromewebstore.google.com/detail/spruce+/ennpekfncgndmiffefhbkpdnjnnnhcpc) (ID `ennpekfncgndmiffefhbkpdnjnnnhcpc`) ·
[Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/spruce/ailfmflfcombomabeallgefjkkejjijh) (ID `ailfmflfcombomabeallgefjkkejjijh`) · [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/s-p-r-u-c-e/) (ID
`spruce@spruce-browser-extension`).

## Store listing tab

**Name** (from the package): `S.P.R.U.C.E+`

**Summary** (from the package, 103 characters):

```
Helps you spot phishing and scams in Gmail and other webmail: links, senders, QR codes and attachments.
```

**Description:**

```
S.P.R.U.C.E+ (Spam & Phishing Risk URL Checker Extension+) helps you spot phishing in your email before you click.

IN YOUR INBOX, BEFORE YOU OPEN ANYTHING
• Red labels on dangerous senders: fake brand names ("PayPal Service" from an address that isn't PayPal's), look-alike addresses (a letter swapped, or your school's name plus "support"), known scam senders, and senders using your own name.
• "Call this number" scams are flagged even when the email really comes from a company's system.
• Flagged emails can be moved to Spam for you, with your webmail's own Report spam. Take one back out and it stays out.

IN AN OPENED EMAIL
• Shows where every link really goes, including short links and tracking redirects.
• Marks dangerous links in red: phishing sites, pages hosted in public cloud storage, look-alike domains, and links whose text says one site but go to another.
• Checks QR codes in images and attachments, and attachments for hidden scripts and fake sign-in pages.
• Blocks tracking pixels that tell senders when you opened an email.
• Spots forged emails: failed sender verification, fake delivery records, and other signs genuine mail never has.

PRIVATE BY DESIGN
• No account, no ads, no analytics, no server of its own. Your email never leaves your device.
• Threat checks send only a website's name (for example example.com) to public security services. Choose Private or Offline only to send less, or nothing.

FOR SCHOOLS AND BUSINESSES
• Every check has its own switch, and administrators can set or lock any of them by policy (Google Workspace, Microsoft Intune, Group Policy).
• Phishing-training emails from your provider can be left alone.

Works fully in Gmail. Other popular webmail services are supported in a basic, read-only way.

A HELPER, NOT A GUARANTEE
S.P.R.U.C.E+ makes a best effort to point out warning signs, but it can miss dangerous emails and can flag genuine ones. It is one small layer of protection: keep your webmail's spam filtering, your organization's email security and your own judgment.

What's new in each version: https://github.com/thecodewarrior2/SPRUCE-Browser-Extension/blob/main/store/WHATS-NEW.md
Privacy policy: https://github.com/thecodewarrior2/SPRUCE-Browser-Extension/blob/main/PRIVACY.md
```

**What's new, at each update:** the plain-language notes are in [`WHATS-NEW.md`](WHATS-NEW.md), one entry
per store release (everything since the previous store version). The Chrome Web Store and Edge Add-ons
have no field for them, so the description above links to that page; addons.mozilla.org (the version's
**Release notes**) and Apple's App Store (**What's New in This Version**, at most 4,000 characters)
take the entry itself. `CHANGELOG.md` is the technical history; don't link it from the stores.

> **Review note (first submission):** the Chrome Web Store rejected the first submission for
> keyword spam because the description listed every supported webmail service by name ("Supported
> webmail: Gmail (full support), plus experimental support for Outlook on the web, Proton Mail, Yahoo
> Mail, AOL Mail…"). Keep the public description free of such lists: name Gmail, and say "other
> popular webmail services". The full list belongs only in the permission reasons below, which
> reviewers read but the public doesn't see.

**Category:** the store's privacy and security category (or Productivity if that isn't offered).

**Language:** English.

**Images** (in the [`store`](.) folder):

| Field | File |
|---|---|
| Store icon (128×128) | `../icons/icon128.png` |
| Edge Add-ons extension logo (300×300; Edge accepts 128×128 too) | `logo-300x300.png`, the extension's icon (`../branding/icon.svg`) drawn at 300×300 |
| Screenshots (1280×800) | `screenshot-1-inbox.png`, `screenshot-2-email.png`, `screenshot-3-moved.png`, `screenshot-4-settings.png` |
| Small promo tile (440×280) | `promo-440x280.png` |
| Marquee promo tile (1400×560) | `marquee-1400x560.png` |

The screenshots show the real extension at work on a made-up inbox (every name and address in them is
fictional). `source/make-images.js` makes them again after a change.

**Official URL / homepage:** `https://github.com/thecodewarrior2/SPRUCE-Browser-Extension`

**Support URL:** `https://github.com/thecodewarrior2/SPRUCE-Browser-Extension/issues`

## Privacy tab

**Single purpose:**

```
Help webmail users spot phishing and scam emails. S.P.R.U.C.E+ checks the emails a user reads in their webmail (the sender, links, QR codes and attachments), warns when an email is dangerous, and can move it to Spam. Every feature serves this one purpose: showing where links really lead, flagging fake or look-alike senders, and blocking the tracking pixels that tell scammers an address is live.
```

### Permission justifications

**activeTab**

```
When the user opens the toolbar popup, the extension reads the current tab's address to show whether it is a supported webmail page and how many links and tracking pixels it checked there.
```

**alarms**

```
Schedules the daily download of the public phishing and short-link lists and the automatic deletion of old history, so the extension doesn't need to stay running.
```

**offscreen**

```
Opens a hidden page, only while an email image or attachment is being checked, to decode QR codes and read PDF and Word attachments on the user's device. It closes itself after a minute without work.
```

**storage**

```
Keeps the user's settings, recent check results, the history of checked links (deleted automatically after 30 days by default) and the downloaded phishing lists on the device. Also reads settings an organization sets by policy (managed storage).
```

**unlimitedStorage**

```
The public phishing lists, the list of known scam senders and the cache of sender icons are larger than the default storage limit. Everything stays on the device.
```

**management** (optional, asked only when the user clicks)

```
Requested only when the user clicks "Turn it off" on a warning that another installed extension does the same job (for example two extensions both drawing sender icons in Gmail). It is used to find that extension and turn it off at the user's request; nothing else.
```

**Host permissions**

```
mail.google.com: reads an email's original source (its headers) from Gmail, with the user's own session, to check the sender's verification and find forged headers.
security.cloudflare-dns.com, family.cloudflare-dns.com, 1.1.1.1, dns.quad9.net, freedns.controld.com, protective.joindns4.eu, dns.adguard-dns.com: DNS-over-HTTPS security services that say whether a website is known to be dangerous. Only the website's name is sent. 1.1.1.1 is also used to read companies' published email-logo (BIMI) and DMARC records.
unshorten.me: expands public short links (such as bit.ly) so the user sees where they lead. Can be turned off.
raw.githubusercontent.com, openphish.com, phishing.army, tranco-list.eu: daily or monthly downloads of public lists (short-link services, phishing sites, scam senders, popular sites). Nothing about the user is sent.
*.googleusercontent.com: fetches email images through Gmail's own image proxy to decode QR codes, and the sender photos Gmail already shows.
www.google.com/s2, *.gstatic.com, icons.duckduckgo.com: sender website icons shown beside each email (only the website's name is sent).
api.country.is: the country of the server that delivered an email, shown as a flag.
storage.googleapis.com, firebasestorage.googleapis.com: only when the user clicks the reveal button on a link to a page in cloud storage, to download that page and show where it really leads.
```

**Optional host permission (https://\*/\*)**

```
Requested only when the user or their organization sets up its own threat-check or link-expanding service in Settings, and only for that service's address.
```

**Content scripts on webmail sites**

```
The extension runs on Gmail, Outlook on the web, Yahoo Mail, AOL Mail, Zoho Mail, iCloud Mail, Fastmail, GMX and Proton Mail to check the links and senders of the emails the user reads there. It runs on no other sites.
```

**Are you using remote code?** No.

```
All code is in the package. The lists it downloads (phishing sites, short-link services, scam senders, popular sites) are plain data and are never run.
```

### Data usage

Tick these, because website names from emails are sent to the security services and the extension
reads the user's emails:

- **Website content**
- **Personal communications**

Leave the others unticked (it collects no personally identifiable information, health, financial,
authentication or location data, web history or user activity).

Tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:**

```
https://github.com/thecodewarrior2/SPRUCE-Browser-Extension/blob/main/PRIVACY.md
```

## Distribution tab

**Visibility:** Public, or Unlisted to test with a few people first. Schools and businesses can also
install it for everyone from the Google Admin console once it is published.
