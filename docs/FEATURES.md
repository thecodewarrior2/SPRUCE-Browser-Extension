# What S.P.R.U.C.E+ does

Every feature, in detail, for the Safari build. S.P.R.U.C.E+ is a helper, not a guarantee: it makes a best effort to point out warning signs, but it can
miss dangerous emails and links, and it can flag genuine ones. Keep your webmail's own spam filtering,
your organization's email security and your own judgment.

Each feature has its own switch in Settings. Safari has no extension policies, so organizations can't
lock settings; see the [deployment guide](ADMIN-GUIDE.md) for rolling it out. What leaves your device, and to whom, is in the [privacy policy](../PRIVACY.md).

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
  different site than the link goes to; *Danger* (red) for look-alike brand domains, phishing
  lists, and dangerous schemes (`javascript:`, `data:`, …). Red links ask before opening.
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
- **Phishing senders go to Spam (Gmail).** Sender addresses are compared with a community scam-sender
  list (there is no block list to maintain; Gmail's own Report spam covers anything missed); sender domains with the phishing lists and the DNS threat filters
  (a domain that doesn't exist is flagged too, unless it's a subdomain of a company domain that does). Each email is also checked for signs of forgery: malformed
  addresses, forged delivery headers, padded names and subjects, unnamed or dangerous attachments, and
  links flagged as dangerous, so an email full of red links never shows a green sender. Trusted senders
  (yours and your organization's) are never flagged. Emails from a **flagged** sender (never unverified, unknown or clean ones) are moved
  to Spam with Gmail's own Report spam, from the inbox and from search results (never a search in Spam, Trash or Sent), never while you're typing or have emails
  selected, and never your organization's phishing-training emails. One you take back out of Spam
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
  be switched off individually (Safari has no extension policies, so settings can't be locked centrally).

## The toolbar button

Clicking the S.P.R.U.C.E+ button in the browser toolbar shows:

- **Show results on links**: one switch for the link markings (red warnings and real destinations).
- **Current email**: how many links in the open email were scanned, and how many were safe by the
  checks, caution, unsafe, not verified or not scanned.
- Counters: links cleaned, tracking pixels blocked, shortener sites known, and allowed or blocked sites.
- **Recent activity**: the latest things the extension did (links flagged, emails moved to Spam, errors),
  with **Clear activity**.
- **Open Settings**, and a light, dark or system appearance switch.

## Settings

Everything works out of the box; nothing needs changing.

- **Privacy level**: *Standard*, *Private* or *Offline only* (above), with a table of what each one sends.
- **Links**, **Senders (Gmail)**, **Tracking pixels**, **QR codes & attachments**: a switch for each check.
- **Row highlighter**: the inbox row under your mouse gets a soft color and outline (yellow, blue,
  green, pink, purple or gray; color, outline or both), so a click opens the email you meant; ticked
  emails can keep their own color.
- **Other extensions**: when another extension does the same job in your webmail (both drawing sender
  icons, both highlighting rows), you're warned and can turn the other one off, or turn off only the
  overlapping settings here.
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
  included); **Restore…** shows exactly what will change before anything does. Safari has no extension policies; see the [deployment guide](ADMIN-GUIDE.md) for rolling it out.

## Link Inspector

Paste any link, however many times it was wrapped, shortened or rewritten by a security gateway, and
watch each step: every layer unwrapped, where it really goes, and what the threat checks found.

## Logging

- **Application log**: errors, warnings and routine events, searchable, exportable and clearable.
  Only a link's site (never its full address) is written there.
- **History**: links that were checked, unmasked or flagged (if *Keep history* is on).
- **URL cache**: remembered link results, with where each one goes and what found it.
- **Senders: icons & flags**: the remembered sender icons, countries and verdicts.
- **Moved to Spam**: emails the extension moved to Spam, moves that didn't work, and conversations you
  took out of Spam (never moved again).

## Help

Settings → **Help** explains, in the words you see on screen: how it works, what each warning means,
sender icons and Spam, signs of a forged email, logging, which features work where, your privacy,
troubleshooting, limitations, deploying in organizations, an architecture deep dive with a live
settings reference and the state of this installation, the permissions it asks for, and **About**
(credits, license, accessibility). About has a small **Donate** button.

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

In Safari the two phishing-simulation rows don't apply: their rules are set by policy, which Safari doesn't have.
