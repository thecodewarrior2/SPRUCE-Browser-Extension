# Deploying Gmail Link Unshortener in Safari

Safari has **no extension policies**: unlike Chrome and Firefox, an administrator can't set or lock an
extension's settings. What device management can do in Safari is install the app that carries the
extension, keep the extension turned on, and allow it on your webmail sites. Everything inside the
extension (all features are on by default) is up to each person, or comes from a backup file you share.

## 1. Build the app

A Safari extension comes inside a small app (Mac, and iPhone/iPad). Build it once from this folder:

- **On a Mac with Xcode:** run `tools/build-safari.sh`. It uses Apple's converter
  (`xcrun safari-web-extension-converter`) to make an Xcode project in `build/safari/`, with the
  extension copied inside, and builds the Mac app (signed "to run locally"). Set `BUNDLE_ID` to an
  identifier under your own domain (for example `org.yourdistrict.LinkUnshortener`), and `TEAM_ID` to
  your Apple Developer team to sign with it.
- **On GitHub:** the **Safari build** workflow (`.github/workflows/safari.yml`) runs the same script on a
  GitHub Mac for every push to the `safari` branch, or when started by hand, and offers the app and the
  Xcode project under the run's Artifacts. Mac runners count ten times against a private repository's
  Actions minutes.
- **To try it on one Mac without signing:** Safari → Settings → Advanced → **Show features for web
  developers**, then Develop → **Allow Unsigned Extensions** (asked again after each Safari restart). Open
  the app once, then turn the extension on in Safari → Settings → Extensions.

Requires Safari 18.2 or later (macOS, iOS and iPadOS).

## 2. Sign and distribute it

Open the generated Xcode project, choose your team under **Signing & Capabilities** for both the app and
the extension, then:

- **App Store or TestFlight:** Product → Archive, then upload. Store apps can be assigned to devices with
  Apple School Manager or Apple Business Manager and installed by your device-management tool. For iPhone
  and iPad this is the only way.
- **Mac, directly (Developer ID):** archive, export with Developer ID signing, have Apple notarize it, and
  deploy the app with your device-management tool (Jamf, Intune, Mosyle…).

## 3. Keep it on and allowed on your webmail

Apple's **Safari extensions settings** declarative configuration (macOS 15, iOS 18 and iPadOS 18 or later,
on supervised devices) manages an installed extension by its identifier, `Identifier (TeamIdentifier)`:
read both from `codesign -dv` on the extension inside the app's `Contents/PlugIns` folder. It can:

- keep the extension **always on** (people can't turn it off), or always off;
- allow or block it in Private Browsing;
- allow it on your webmail sites (for example `mail.google.com`) so people aren't asked, and deny it
  elsewhere.

How you add the configuration depends on your device-management tool; Apple's reference is in its
[device-management repository](https://github.com/apple/device-management) under declarative
configurations. Without it, each person turns the extension on in Safari → Settings → Extensions and
chooses **Always Allow on This Website** the first time they open their webmail. The extension's
background page also downloads its lists and runs its threat checks (the services in Settings → Help →
Permissions); if Safari asks about those sites, allow them.

## 4. The same settings for everyone

Set the extension up once the way you want it, use Settings → **Back up**, and have each person
**Restore** the file (or include it in your onboarding). Backups hold the settings you changed and the
Allowlist, Blocklist and Trusted senders; API keys are never included. People can change their settings afterwards.

- **No third-party requests at all:** choose the privacy level **Offline only** before making the backup.
  Links are still unwrapped offline; sender icons are left blank, and senders are checked only for
  malformed addresses and signs of forgery in the email.
- **Your own lookup or threat-check service:** each person enters it, and its key, once.

## What can't be managed in Safari

- Locked settings (🔒), and resetting that leaves locked settings alone: nothing is locked in Safari.
- The administrator-only options of the Chrome and Firefox builds: a simpler toolbar popup (no Settings
  button or recent activity) and the rules that recognize phishing-simulation (training) emails. See
  **Phishing training** below.
- Your organization's lists of allowed and blocked sites and trusted senders, kept apart from each
  person's own: in Safari they're only the lists in the backup you share.
- A threat-check service whose API key is hidden from people.

## Feature compatibility by webmail

Every feature, and the webmail sites it runs on in this version. One engine handles all of them; a
site gains features as its entry in `WEBMAIL_SITES` (`shared.js`) describes more of its page, with no
new code. The same chart, generated from the running code, is in Settings → Help → Which features
work where. Gmail is fully supported and tested; the others are experimental. Nothing here needs an
extra sign-in, an app registration or an administrator-approved API.

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

## Sender icons and moving phishing to Spam (Gmail)

All of this is on by default and every part has its own switch in Settings → Senders. In short:

- **What decides "flagged":** the exact address is on
  the community scam-sender list (exact addresses only, never addresses at major companies' own domains); or
  the sender's domain is on a phishing list (OpenPhish, Phishing Army) or blocked by a **security** resolver
  (Quad9, Cloudflare Security, Control D, DNS4EU, your own resolver). A block by the Cloudflare Family content
  filter or by the AdGuard backup alone only shows **caution**. Gmail.com, Outlook.com and other personal-mail
  providers, major companies' domains (`PROTECTED_DOMAINS`) and your own organization's domain are never judged
  by domain lists or DNS, only by exact addresses on the community list, so they are **not verified**. Labels
  are colored only when they need attention: ⛔ red (flagged), ⚠ yellow (caution) and ✓ green only for trusted
  senders and allowlisted domains (a person chose them). Checked and not-verified senders get a plain, neutral
  label: neither a warning (most mail comes from providers like Gmail) nor a promise of safety. Also flagged: a sender domain that doesn't exist;
  a malformed address (encoded part, more than 64 characters before the @, two @, invalid domain); and an email
  that shows enough signs of forgery itself. Signs are weighted (strong ones flag on their own, weaker ones add
  up): a failed DMARC check when the From domain's owner publishes quarantine or reject (Gmail's own result on
  arrival; only a strong sign for real mailing lists and trusted forwarders), forged delivery records copied from
  older emails (dated more than a week before arrival), MIME-Version other than 1.0, an encoding that doesn't
  exist, a malformed List-ID, headers claiming several unrelated sending services,
  bulk-mail placeholders, repeated From/Subject/Date lines, a "To" line hiding the real recipient, a padded subject
  or sender name, an unnamed ("noname") or dangerous attachment, and links flagged as dangerous (all of them, or
  two or more, flag the email; one among several only makes it Caution). Headers are read for opened emails and
  read emails in the list, and in the Spam folder for unread ones too; never for unread emails in the inbox.
- **Trusted senders (the allow list):** Settings → Senders → Trusted senders. They are never flagged or moved.
  Use it for your phishing-training provider and for false positives; to give everyone the same list, add it
  before making the backup you share (see below).
- **No block list:** there is no list of senders to flag. Anything the checks miss, users report with Gmail's
  own Report spam, which Gmail learns from.
- **Logging:** Settings → Logging → *Senders: icons & flags* lists every sender checked recently with its icon,
  country, verdict, reasons and what was checked; *Moved to Spam* lists each move, failed move and rescue. The
  application log has a readable line for each of these.
- **How emails are moved:** with Gmail's own **Report spam** button, which also reports the sender to Google, as
  if the user had clicked it. If Gmail asks "Report spam and unsubscribe?", only plain Report spam is chosen.
  Only from the inbox (and its category tabs), never while the user is typing, has a menu or dialog open, or has
  selected emails, and only after 10 seconds without any click, key press, scrolling or mouse movement over
  the list, so rows never disappear under the pointer and Gmail's **Undo** for the user's own action isn't
  replaced by one for the move. Moving never switches itself off: while the Gmail tab is shown (never while
  it's in the background), a monitor in the Gmail page re-checks every 5 seconds for flagged emails still in the inbox, restarts a move that stalled, and after three passes in
  which Gmail moved nothing it pauses (15 seconds, doubling up to 10 minutes) and tries again; the application
  log says so. A click Gmail ignored is forgotten and retried; nothing is left selected. Icons and warnings keep
  working throughout.
- **What Report spam teaches Gmail:** exactly what a user's own click does. Gmail learns to send that sender's
  future mail to the user's Spam, and Google counts the report against the sender. For a false positive, the
  user (or you) clicks **Not spam** in the Spam folder: that reverses Gmail's learning, and the extension never
  moves the conversation again. Add the sender to Trusted senders so it's never flagged. Gmail has no
  quieter way to move an email to Spam.
- **Taken back out of Spam stays out:** each conversation is remembered just before it's moved, and so is
  each one the user takes out of Spam (Not spam / Move to Inbox), whoever put it there
  (`spamMovedThreads` and `spamRescuedThreads`, two separate lists of the newest 50,000 each, no time limit).
  None is ever moved (again). Moves can never push out the user's rescues. When the moved list is full, its
  oldest entries are forgotten first (and the application log says so once); Gmail deletes Spam after 30 days,
  so those conversations no longer exist unless they were taken out of Spam. Remembering happens before
  the click: if it can't be saved, nothing is moved.
- **Whole conversations:** Report spam acts on a whole conversation, so one is moved only when every
  other sender in it is flagged.
- **Layouts:** nothing is moved from the list with Multiple Inboxes or Priority Inbox sections, or in
  split view; such emails are moved when opened in the normal view.
- **Phishing training:** the rules that recognize training emails (KnowBe4, Wizer…) are set by policy in the
  Chrome and Firefox builds, so Safari doesn't have them. Add the training vendor's sending domains to Trusted
  senders and its link domains to the Allowlist in the backup you share, or training emails may be flagged and
  moved like real phishing.
- **Network:** sender domains go to the same DNS threat services as links' site names; site names to Google's
  icon service (`www.google.com/s2/favicons`), and for a site with no icon of its own (nor its parent domain) to
  DuckDuckGo's (`icons.duckduckgo.com`, off with **Stand-in icon for sites without their own**); a delivering server's IP
  address to `api.country.is`. With
  **Check sites for threats** off, none of these requests are made.
- **Recommended rollout:** start a pilot with **Move emails from flagged senders to Spam** off (flags only),
  review what is flagged, add any false positives to Trusted senders, then turn moving on.

## Notes

- **Remote shortener lists** update automatically every day and are treated as untrusted:
  - Entries for major sites are ignored, and list-only domains are sent to unshorten.me only for URLs shaped like short links.
  - A newly listed domain is used only after it has appeared on three separate days. Removals apply immediately.
  - A download that changes more than a quarter of a list at once is held back. If the change is genuine, it is accepted automatically after 7 days.
  - The first download (and the first after sync was off or failing for over a week) is used immediately as the new starting point.
- **Bundled snapshot:** `shortener-snapshot.txt` gives a fresh install shortener coverage before its first download, for example when the network is down at install. It ships with a starter set of well-known shorteners. To bundle the full community lists, run `node tools/refresh-snapshot.js` (Node 18+, internet access) before packaging a release. This is optional; the daily sync keeps installed copies current either way.
- **Troubleshooting:** every failure is recorded in **Settings → Logging → Application log** with a level (Error, Warning, Info) and its source: DNS checks, list sync, custom resolvers, Gmail, restore and so on. Error messages contain only a link's site, never its full address. Errors also appear in the toolbar popup.

## Google Web Risk for threat checks

Organizations can use Google's Web Risk API as the custom threat resolver. The steps are in the extension's Help → Deploying in organizations → "Threat checks with Google Web Risk". Note that Web Risk receives full links, whereas the built-in checks send only site names. Google has no API to expand short links; use your own lookup service for that (Help → Limitations). In Safari each person enters the service and its key once (API keys are never included in backups).
