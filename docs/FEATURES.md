# What S.P.R.U.C.E+ does

Every feature, in detail, for Chrome and Edge, Firefox (desktop) and Safari; where a browser differs, it says so. S.P.R.U.C.E+ is a helper, not a guarantee: it makes a best effort to point out warning signs, but it can
miss dangerous emails and links, and it can flag genuine ones. Keep your webmail's own spam filtering,
your organization's email security and your own judgment.

Each feature has its own switch in Settings, and organizations can set or lock any of them in Chrome,
Edge and Firefox (see the [admin guide](ADMIN-GUIDE.md); Safari has no extension policies, so there
settings can't be locked). What leaves your device, and to whom, is in the [privacy policy](../PRIVACY.md).

## Contents

- [What it does](#what-it-does)
- [The toolbar button](#the-toolbar-button)
- [Settings](#settings)
- [Link Inspector](#link-inspector)
- [Logging](#logging)
- [Help](#help)
- [Feature compatibility](#feature-compatibility)

## What it does

- **Unshortens links.** Short links (bit.ly, t.co, …) and security-gateway links (Proofpoint,
  SafeLinks, Barracuda, Trend Micro, …) are expanded so a hover card shows the real destination,
  with a **Copy address** button. More than 50 redirect formats are decoded offline.
- **Two warning levels.** *Caution* (amber) for misleading links such as text that shows a
  different site than the link goes to; *Danger* (red) for look-alike brand domains, text showing a
  well-known brand's site while going elsewhere, phishing lists, and dangerous schemes (`javascript:`,
  `data:`, …). Red links ask before opening.
- **A company's own domains count as one.** Link text showing one of a company's sites and a link to
  another of its domains is not a warning: Bank of America's bankofamerica.com and bofa.com, DocuSign's
  docusign.com and docusign.net, and any address under an ending only that company can register
  (go.amex for American Express, blog.google for Google): ICANN's list of such "brand" endings is
  downloaded once a month, so nothing about them is written into the extension by hand. A link to such
  an ending is never red, since no one else can have an address there. In Gmail, text showing the site of the email's
  own sender, verified by Gmail's DMARC check, is amber at most, wherever the link goes: the sender chose
  its own link. A company's name under another ending (amazon.de, google.co.uk, or paypal.*anything*)
  counts as the company's only when public records show it: it is one of the most visited sites and
  enforces sender verification, or its DNS records tie it to the company (looked up at most once a month;
  at Offline only, what was looked up earlier still counts). Until then such a link, or a sender with the
  company's name at such a domain, is amber, never red or moved to Spam.
- **One calm banner per email.** Findings about the email as a whole are summarized at the top,
  with **Show details** and **What should I do?**; an email with many unusual links gets one
  sentence instead of a marking on every link. It follows Gmail's light or dark theme.
- **Sender checks (Gmail).** The sender's verification (DMARC/DKIM/SPF via Gmail's "Show
  original") is read to judge company short links (c.gle, aka.ms, …) and brand-claiming sender
  names.
- **Sender icons and identity (Gmail).** In the inbox list and in opened emails, every sender gets its
  site's icon (else its parent domain's or one from DuckDuckGo's icon service, replaced by the site's own as
  soon as it has one; a blank space when none exists; icons, verdicts and countries are remembered, so the
  inbox shows them at once), a country flag (where the server that sent it is, from Gmail's own delivery record, or the
  domain's country) and a domain label. Color only appears when it matters: ⛔ flagged (red),
  ⚠ caution (yellow), and ✓ trusted (green, for senders you or your organization chose). Every other
  label is plain, so Gmail.com-style providers don't look suspect and nothing looks safe that wasn't
  proven safe. Point at the label for the reasons and Gmail's own verification (DMARC/SPF/DKIM).
- **A brand's name on an unknown address is double-checked before it counts (Gmail).** Companies send
  from more domains than their main one (Amazon Music from amazonmusic.com, Facebook from
  facebookmail.com). When a sender's name claims a well-known brand on a domain not known as the
  brand's, public records are read once (online only) before the email is flagged: the brand's and the
  domain's DMARC records, their name servers, and the domain's registry and registrar record. Records
  only the brand could have made (its own DNS pointing at the domain, a corporate brand-protection
  registrar with a registrant naming the brand) prove the domain is the brand's, and the email isn't
  flagged; a corporate registrar plus one more link to the brand makes it amber (never moved); anything
  less is red as before. Answers are remembered 30 days per domain, and at Offline only those already
  stored still count (nothing new is looked up).
- **Phishing senders go to Spam (Gmail).** Sender addresses are compared with a community scam-sender
  list (there is no block list to maintain; Gmail's own Report spam covers anything missed); sender domains with the phishing lists and the DNS threat filters
  (a domain that doesn't exist is flagged too, unless it's a subdomain of a company domain that does). Each email is also checked for signs of forgery: malformed
  addresses, forged delivery headers, padded names and subjects, unnamed or dangerous attachments, and
  links flagged as dangerous, so an email full of red links never shows a green sender. Trusted senders
  (yours and your organization's) are never flagged. Emails from a **flagged** sender (never unverified, unknown or clean ones) are moved
  to Spam with Gmail's own Report spam, from the inbox and from search results (never a search in Spam, Trash or Sent), never while you're typing or have emails
  selected, and never your organization's phishing-training emails. Moving waits 10 seconds after
  your last click or key (so it never replaces the Undo of something you just did) and 2 seconds
  after the mouse last moved over the list; while an email waits, its row says **Moving to Spam…**,
  is struck through and can't be clicked by accident, with **Move now** (moves it immediately) and
  **Keep it** (leaves it in the inbox for good). Only clicks are guarded: Gmail's keyboard shortcuts
  can still open the email, which then keeps its red warning and is still moved. One you take back out of Spam
  stays out. A short notice says how many were moved, with a **Review** link to Spam.
- **Red flags in the Spam folder (Gmail).** In Spam, emails the same checks would move there are red,
  whether the extension moved them (the label says when and why) or Gmail did; unread ones are checked
  too. A Spam email without a red label was put there by Gmail or by you, so it may be a mistake.
- **Senders using your own name (Gmail).** An email whose sender name is your own email address, or
  your mailbox name (the part before the @, written as in your address, or in any case at Gmail and other big providers), but which comes from someone
  else's address is flagged red from the inbox list, without opening it, and moved to Spam: a common
  trick in fake "your storage is full" and "your account is blocked" emails.
- **"Call this number" scams.** A subject with a phone number to call about a purchase you didn't
  make is flagged red and moved to Spam, even when the email really comes from a company's own system
  (attackers type the text into names that Microsoft's, PayPal's or Apple's systems mail out). In an
  opened email, on every webmail, such text is a caution.
- **Threat checks.** DNS-over-HTTPS threat filters (Cloudflare Security and Family, Quad9,
  Control D; AdGuard as a backup), community shortener lists, and local phishing lists (OpenPhish,
  Phishing Army), downloaded at most once a day.
- **QR codes** in email images and image/PDF attachments are decoded on-device and their
  destination is checked like a link; QR codes drawn with HTML tables or block characters are
  caught too.
- **Attachment checks.** SVG/HTML attachments are scanned for scripts and hidden destinations;
  encrypted archives and deceptive file names are flagged.
- **Tracking pixels** (1×1 images and known open-tracking addresses) are removed, while keeping
  the email's real images.
- **Checks before you send (Gmail).** Links you write, including names typed on their own such as
  “example.com”, are checked for typos (“.con”, “http//”), look-alikes, domains that don't exist
  and sites that don't answer before the email goes out; a dialog lets you go back and fix them
  or send anyway. The quoted email you're replying to isn't checked, and an email is never held
  if the check can't finish.
- **Privacy levels.** *Standard*, *Private* (no link sent to any lookup service; site names still
  go to the DNS threat filters) or *Offline only* (nothing leaves the browser). Every feature can
  be switched off individually, and every one can be set and locked by your administrator (Chrome, Edge
  and Firefox; Safari has no extension policies).

## The toolbar button

Clicking the S.P.R.U.C.E+ button in the browser toolbar shows:

- **Show results on links**: one switch for the link markings (red warnings and real destinations).
- **Current email**: how many links in the open email were scanned, and how many were safe by the
  checks, caution, unsafe, not verified or not scanned.
- Counters: links cleaned, tracking pixels blocked, shortener sites known, and allowed or blocked sites.
- **Recent activity**: the latest things the extension did (links flagged, emails moved to Spam, errors),
  with **Clear activity**.
- **Open Settings**, and a light, dark or system appearance switch.
- **Not allowed on this site**: when your browser has the extension's access to the webmail switched
  off (in Firefox, the extensions panel's per-site switch; in Chrome, *Site access*), nothing there is
  checked and the page shows no sign of it, so the button says so, with **Allow on mail.google.com**
  (or the webmail's own address): one click asks the browser for access again and reloads the tab.

Organizations can hide **Open Settings** and **Recent activity** (see the admin guide; not in Safari).

## Settings

Everything works out of the box; nothing needs changing.
Settings your organization set by policy show a 🔒 and can't be changed; the rest stay yours.


- **Privacy level**: *Standard*, *Private* or *Offline only* (above), with a table of what each one sends.
- **Links**, **Senders (Gmail)**, **Tracking pixels**, **QR codes & attachments**: a switch for each check.
- **Row highlighter**: the inbox row under your mouse gets a soft color and outline (yellow, blue,
  green, pink, purple or gray; color, outline or both), so a click opens the email you meant; ticked
  emails can keep their own color.
- **Other extensions**: when another extension does the same job in your webmail (both drawing sender
  icons, both highlighting rows), you're warned and can turn the other one off, or turn off only the
  overlapping settings here. **Check installed extensions** also lists the installed ones (Chrome Web
  Store extensions and their Firefox counterparts).
- **Lookups & threat checks**: online short-link lookups (unshorten.me), site-name threat checks with
  DNS security filters, the daily public shortener lists, and the public phishing lists (OpenPhish
  community feed and Phishing Army), each with its own switch.
- **Custom threat resolver** and **Custom unshortener**: optional services of your own (method,
  body, headers and result field), each with a **Test** button. Saving asks the browser for
  permission to contact that one host.
- **Allowed & blocked sites**: links on allowed sites are left alone (unless they redirect somewhere
  that isn't allowed); links on blocked sites are marked "DO NOT CLICK" with their destination hidden.
  Blocking wins over allowing.
- **Other webmail**: turn the extension on or off for each supported webmail other than Gmail.
- **Data on this device**: remember results, keep history, delete automatically after a number of
  days, or **Delete everything now**. Nothing is synced or uploaded.
- **Backup**: **Back up** saves the settings you changed and your lists to a file (API keys are never
  included); **Restore…** shows exactly what will change before anything does. **Copy as policy JSON** turns your current settings into a policy for Google Workspace or Microsoft
  Intune (in Firefox: **Copy policies.json** and a script for Intune or Group Policy; see the
  [admin guide](ADMIN-GUIDE.md)). Safari has no extension policies: share a backup instead.

## Link Inspector

Paste any link, however many times it was wrapped, shortened or rewritten by a security gateway, and
watch each step: every layer unwrapped, where it really goes, and what the threat checks found. Then
it explains **why a link may be malicious**:

- **What the security services say:** how many independent services flag the site. When only one of
  several does, it says that this can be a false positive (or a very new detection) and names the
  service to report it to; a flag from the adult-content filter alone is called a content filter, not a
  security finding.
- **Who checked it:** each service's own answer (blocklist, phishing lists, Quad9, Cloudflare, Control D,
  DNS4EU, your own resolver), asked afresh, with what a flag from that service means. When the link's
  own host differs from its destination, both are listed.
- **Red flags in the link:** signs found in the address itself, on the device, each with its meaning:
  look-alike brands, a brand's name in front of someone else's domain, a hidden "user@" prefix, bare IP
  addresses, punycode, free page and form services, public cloud storage, endings often used for abuse,
  programs, archives and macro documents, sign-in or payment words, an email address carried in the link,
  bounces through a trusted site's redirect, links wrapped many times, unusual ports, plain http.
- **Get a second opinion:** VirusTotal, urlscan.io, Google Safe Browsing and Sucuri SiteCheck, opened in
  a new tab with the site name only. With your own free VirusTotal API key (Settings → Your own services)
  the **Look up on VirusTotal** button shows the vendors' counts, which vendors flag it and what they call
  it, and (for a link VirusTotal has never seen) offers a fresh scan. One-time links are never submitted:
  only their site is looked up.

Decoded without any lookup, among many others: iContact (`icptrack.com`) click tracking, and SendGrid
click tracking in its older readable format. SendGrid's current links (`upn=u001.…`) are encrypted, so
the Inspector explains that no tool can read them offline.

## Logging

- **Application log**: errors, warnings and routine events, searchable, exportable and clearable.
  Only a link's site (never its full address) is written there.
- **History**: links that were checked, unmasked or flagged (if *Keep history* is on).
- **URL cache**: remembered link results, with where each one goes and what found it.
- **Senders: icons & flags**: the remembered sender icons, countries and verdicts.
- **Moved to Spam**: emails the extension moved to Spam, moves that didn't work, and conversations you
  took out of Spam or kept in the inbox (never moved again). Taking a moved email back out of Spam
  marks its own line (*Taken out of Spam by you*, with the date and time) rather than adding one.
- **Several accounts**: every log names the account each entry happened in (the address in Gmail's
  page title; other webmail by its site name), and searching a log for an address shows only that
  account's entries. Entries from before 5.85 have none.

## Help

Settings → **Help** explains, in the words you see on screen: how it works, what each warning means,
sender icons and Spam, signs of a forged email, logging, which features work where, your privacy,
troubleshooting, limitations, deploying in organizations, an architecture deep dive with a live
settings reference and the state of this installation, the permissions it asks for, and **About**
(credits, license, accessibility). About has a small **Donate** button, which organizations can
hide by policy.

In Safari the two phishing-simulation rows don't apply: their rules are set by policy, which Safari doesn't have.

## Feature compatibility

One engine handles every supported webmail. What it can do on a site depends only on what that site's
entry in `WEBMAIL_SITES` (`shared.js`) describes; the same chart, generated from the running code, is
in Settings → Help → Which features work where. Gmail is fully supported and tested; the other sites
are experimental (layouts mapped from public information) and gain the remaining features as their
entries are filled in, with no new code. Header features need a page the webmail offers with the
email's original source; Proton Mail encrypts messages, so it can't offer one. Nothing needs an extra
sign-in, an app registration or an administrator-approved API.

| Feature | Gmail | Outlook | Proton | Yahoo | AOL | Zoho | iCloud | Fastmail | GMX |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| *Support* | Full | Experimental | Experimental | Experimental | Experimental | Experimental | Experimental | Experimental | Experimental |
| Links: hidden destinations revealed, dangerous and look-alike links marked *(every site)* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tracking pixels blocked *(every site)* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| QR codes in email images *(every site)* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| QR codes drawn without an image *(every site)* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Phishing-simulation emails recognized by their link domains *(every site)* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Attachment checks (QR codes, scripts, fake logins, encrypted archives) | ✓ | — | — | — | — | — | — | — | — |
| Sender checks in opened emails (brand names, look-alike domains, company links) | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |
| Sender icon, country flag and label in opened emails | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |
| Copy button for the sender's address | ✓ | — | — | — | — | — | — | — | — |
| Look-alike senders caught in the inbox list (nothing opened) | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |
| Senders using your own name or address as theirs, caught in the inbox list | ✓ | — | — | — | — | — | — | — | — |
| "Call this number" scams caught, even in emails genuinely sent by a company | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |
| Sender icon, country flag and label in the inbox list | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |
| Sender pictures over the checkbox: colleagues' photos, BIMI and company logos, site icons | ✓ | — | — | — | — | — | — | — | — |
| The webmail's own warnings about a sender counted in the email's verdict | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |
| Signs of forgery in the headers (DMARC, forged delivery records…) | ✓ | — | — | — | — | — | — | — | — |
| Phishing-simulation emails recognized by their headers | ✓ | — | — | — | — | — | — | — | — |
| Flagged emails moved to Spam | ✓ | — | — | — | — | — | — | — | — |
| Dangerous emails marked red in the Spam folder (moved there by the extension or not) | ✓ | — | — | — | — | — | — | — | — |
| Links checked before sending | ✓ | — | — | — | — | — | — | — | — |
| Row highlighter (the email under the mouse, and selected ones) | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |
| Warnings about other extensions that do the same job *(every site)* | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

✓ works · ◐ basic (found through the page's accessibility labels; read-only, never clicks) · — not yet
