# Managing Gmail Link Unshortener with Firefox enterprise policy

Every setting, plus the allowlist, blocklist and custom resolver, can be set and locked by policy.
Locked settings show 🔒 in the Options page and the toolbar popup and cannot be changed by users.
Anything you do **not** set stays under the user's control (all features are on by default).

## Set the policy
Firefox passes an add-on's policy from `policies` → `3rdparty` → `Extensions` → the add-on ID
(`link-unshortener@gmail-link-scanner`) to the add-on. The same `policies.json` can also install it:

1. Create `policies.json` in the form below. Delete every setting you do not want to lock.
2. Put it in a `distribution` folder in the Firefox installation folder (for example
   `C:\Program Files\Mozilla Firefox\distribution\policies.json`,
   `/Applications/Firefox.app/Contents/Resources/distribution/policies.json` or
   `/usr/lib/firefox/distribution/policies.json`; on Linux `/etc/firefox/policies/policies.json` also
   works), with any device-management tool. On Windows managed with Intune or Group Policy, use the
   registry instead (see below).
3. Restart Firefox and check `about:policies`.

```json
{
  "policies": {
    "ExtensionSettings": {
      "link-unshortener@gmail-link-scanner": {
        "installation_mode": "force_installed",
        "install_url": "https://addons.mozilla.org/firefox/downloads/latest/<slug>/latest.xpi"
      }
    },
    "3rdparty": {
      "Extensions": {
        "link-unshortener@gmail-link-scanner": {
          "managedEnableThirdPartyResolution": false,
          "managedEnableRemoteListSync": false,
          "managedRetentionDays": 14,
          "managedAllowlist": ["internal.example.com"]
        }
      }
    }
  }
}
```

`<slug>` is the last part of the add-on's addons.mozilla.org address; for a self-hosted signed `.xpi`,
use its address instead. The examples below show only the add-on's own settings object (the part under
the add-on ID). `policy-example.json` lists every key with its default value. Users can also generate a
starting point from **Options → Settings → Backup & enterprise policy → "Copy policies.json"**.

## Windows: Microsoft Intune and Group Policy

On Windows, Firefox also reads policy from the registry (`HKLM\SOFTWARE\Policies\Mozilla\Firefox`),
where Intune and Group Policy write it. When the registry and `policies.json` both set the same
top-level policy (`ExtensionSettings` or `3rdparty`), **the registry wins** and that part of
`policies.json` is ignored, so deliver this add-on's policy one way only.

1. **Options → Settings → Backup & enterprise policy → "Copy Intune script"** produces a PowerShell
   script that force-installs the add-on and writes the current settings. Replace `ADDON-SLUG` and
   delete the settings you don't want to lock from the `$Settings` line.
2. Intune admin center → **Devices → Scripts and remediations → Platform scripts → Add → Windows 10
   and later**: upload the .ps1, set *Run this script using the logged on credentials* to **No** and
   *Run script in 64 bit PowerShell host* to **Yes**, and assign it to a pilot group first.
3. Restart Firefox on a test device and check `about:policies`.

The script writes:

```
HKLM\SOFTWARE\Policies\Mozilla\Firefox\ExtensionSettings\link-unshortener@gmail-link-scanner
    installation_mode   REG_SZ   force_installed
    install_url         REG_SZ   https://addons.mozilla.org/firefox/downloads/latest/<slug>/latest.xpi
HKLM\SOFTWARE\Policies\Mozilla\Firefox\3rdparty\Extensions
    link-unshortener@gmail-link-scanner   REG_SZ   {"managedRetentionDays":14,"managedBlocklist":["internal.example.com"]}
```

Firefox parses the add-on's value as JSON, so every setting keeps its type. On domain-joined computers
the same values can be written with **Group Policy Preferences → Registry**. If you already manage
Firefox with Mozilla's ADMX templates (Intune: **Devices → Configuration → Import ADMX**), you can
install the add-on with their **Extensions → Extension Management** setting and keep only the
`3rdparty` part of the script; the templates have no setting for an add-on's own policy.

## macOS

Deliver the same policy as a configuration profile for the `org.mozilla.firefox` domain (Intune, Jamf
or similar) with `EnterprisePoliciesEnabled` set to true and the `ExtensionSettings` and `3rdparty`
dictionaries from `policies.json`. A `policies.json` inside the app bundle works too, but an app
update can replace it. See <https://mozilla.github.io/policy-templates/>.

## Keys
| Key | Type | Default | Purpose |
|---|---|---|---|
| managedEnableLinkUnmasking | boolean | true | Scan and unmask links |
| managedEnablePhishingFeeds | boolean | true | Download the OpenPhish community feed and Phishing Army (CC BY-NC 4.0) lists (at most once a day) and match links on the device |
| managedDnsControlD / managedDnsDns4eu | boolean | true / false | Additional free security resolvers (Control D malware; DNS4EU Protective, EU) |
| managedEnableSenderChecks | boolean | true | Gmail: read Gmail's sender verification when needed; trust company-only links (c.gle…) only in mail verified as from that company directly to the user; warn about brand impersonation |
| managedHidePopupSettingsButton | boolean | false | Administrator only (no setting in the extension): remove "Open Settings" from the toolbar popup; Settings stays reachable from about:addons → the add-on → Options |
| managedHideRecentActivity | boolean | false | Administrator only: remove "Recent activity" from the toolbar popup |
| managedPhishSimulationDomains | array of strings | [] | Administrator only, every webmail: training-vendor link domains; an email whose links ALL go there is left unchecked |
| managedPhishSimulationRules | array of objects | [] | Administrator only, Gmail: phishing-simulation emails to leave unchecked (see "Administrator-only policies") |
| managedEnableSendCheck | boolean | true | Gmail: check the links in an email when Send is pressed, and list problems (typos, unreachable or non-existent sites, look-alike, phishing and malware sites) before it goes |
| managedEnableSenderIdentity | boolean | true | Gmail: each sender's site icon and a domain label colored by the sender checks, in the inbox list and opened emails (icons fetched once from Google's icon service and remembered 30 days, as raw images in the extension's own IndexedDB database, at most 1,500 sites; a blank space for sites without an icon, and when `managedEnableDnsThreatCheck` is false) |
| managedEnableSenderIconFallback | boolean | true | Gmail: a stand-in icon for a sender site without its own: its parent domain's (alerts.brand.com → brand.com, through Google's icon service), else DuckDuckGo's icon service (`icons.duckduckgo.com`; only the site name, only for such sites). Stand-ins are re-checked weekly and replaced by the site's own icon once it has one; where each icon came from is shown in Logging → Senders. False: a blank space |
| managedEnableSenderAvatars | boolean | true | Gmail: as a circle over each inbox row's checkbox (as Gmail and Simplify Gmail draw avatars; the checkbox comes back on hover and when ticked), the picture Gmail itself shows beside a sender in an opened email, remembered so the inbox list shows it too. The user's own organization domain: each colleague's own photo, per address (never the organization's logo). Another company: one logo per company (registrable domain), shown for every address there, learned only from an email that passed Gmail's sender verification (DMARC pass) and came from a shared mailbox (contact@, info@, support@, news@, no-reply@…, whose picture the company chose) or carried a BIMI logo Gmail embedded in the page (kept as is, nothing downloaded). A person's own photo at another company is never used; the company's logo is shown for them. Personal email services (gmail.com, outlook.com…) keep the site icon. Pictures from Gmail's photo host are fetched from Gmail's own image host (`*.googleusercontent.com`) by the extension's background part and checked again weekly; a changed photo or logo (new address, or a logo whose fingerprint changed) replaces the old one. The application log says why one wasn't used |
| managedEnableSenderBimi | boolean | true | Gmail: the logo a company publishes in DNS for its email (BIMI) over the checkbox of each inbox row from it, without opening any email. Only organization domains (never subdomains, so a sender can't build a per-recipient "read receipt" from throwaway subdomains) that enforce DMARC (`p=quarantine` or `p=reject`). Lookups go to Cloudflare (1.1.1.1, or its security resolver when the address 1.1.1.1 is blocked). The SVG is downloaded and checked (at most 32 KB, no scripts) where the logo's server allows it; otherwise the inbox page loads it from its address with no referrer, so the company's logo server sees the user's IP address. Rechecked weekly |
| managedSenderPictureSize | string | auto | Gmail: `auto` follows Gmail's display density (Default: 36 px circles over each inbox row's checkbox; Comfortable: 32 px circles; Compact: small icons beside the country flag, no circles). `large`, `medium` or `inline` set one size. Senders with no photo, logo or site icon get a colored circle with their initial (not inline) |
| managedEnableCopyAddress | boolean | true | Gmail: a button after the sender's address in opened emails that copies the address (keyboard accessible; a brief "Copied" confirmation, announced to screen readers). Works whatever the sender checks are set to. Another extension doing the same (Copy Button for Gmail) is recognized by the conflict warnings |
| managedEnableLookalikeCheck | boolean | true | Inbox list, nothing opened: senders whose domain imitates a protected domain. Protected: the top 10,000 of two public popular-site lists (Chrome UX Report via a research copy on GitHub, CC BY 4.0; Tranco from tranco-list.eu), downloaded monthly and counted only when the domain enforces DMARC; the built-in brands; your organization; domains whose mail passed DMARC in the mailbox. Look-alike characters, a built-in brand plus a scare word, a brand domain as a prefix, imitations of your organization: red, moved to Spam. One letter off, or a popular or learned name plus a scare word: red only if the sender's domain was registered under 90 days ago (public RDAP record via IANA; only the domain is sent); amber for the built-in brands otherwise; nothing for other old domains. Also a brand's name on a non-brand address (red) and a colleague's name on an outside address (amber; colleague names kept only as one-way hashes). Needs the new host permission `tranco-list.eu` (granted silently to policy installs) |
| managedEnableRowHighlighter | boolean | true | Highlight the inbox row under the mouse (and selected rows), so users see exactly which email a click opens; a see-through color and/or outline readable in light and dark themes. Every webmail whose inbox list the extension finds |
| managedRowHighlightColor | string | yellow | Highlight color for the row under the mouse: `yellow`, `blue`, `green`, `pink`, `purple` or `gray` |
| managedRowHighlightStyle | string | both | `both` (color and outline), `fill` (color only) or `outline` (outline only) |
| managedRowHighlightSelected | boolean | true | Also highlight emails the user has ticked |
| managedRowHighlightSelectedColor | string | blue | Highlight color for ticked emails (same values as `managedRowHighlightColor`). Different from the mouse color by default so the two aren't confused; the row under the mouse wins when it is ticked too. If both are set to the same color, Settings shows a warning but allows it |
| managedEnableConflictWarnings | boolean | true | Warn when another extension does the same job in the webmail (Gmail Sender Icons, Simplify Gmail, Contact Avatars for Gmail, Row Highlighter for Gmail, Copy Button for Gmail, or any extension drawing sender icons or photos), with one-click fixes: turn the other one off (Chrome, after the user grants the optional `management` permission; Firefox only lets users do it themselves, so they get the steps) or turn off only this extension's overlapping settings, one at a time or all (settings locked by policy stay as set). Once the user has turned off the overlapping settings they want off, that conflict isn't warned about again unless one of them is turned back on. `false` suppresses the warnings completely: nothing is shown, logged or listed |
| managedEnableSenderCountry | boolean | true | Gmail: country flag of the server that delivered the email (Gmail's Received header, read emails only; IP looked up at api.country.is, at most monthly per address), else the domain ending's country, else where the sender's website is hosted |
| managedEnableSenderDomainCheck | boolean | true | Gmail: check sender domains with the DNS threat services (domain name only) and the phishing lists. Personal-mail providers, major companies' domains and the user's own organization domain are never judged as a whole |
| managedEnableSenderAddressCheck | boolean | true | Gmail: compare sender addresses with the community scam-sender list (sefinek/Blacklisted-Emails, MIT; downloaded with the phishing lists); malformed addresses are flagged too |
| managedEnableAutoSpam | boolean | true | Gmail: move emails from **flagged** senders to Spam with Gmail's own Report spam (never unverified, unknown, caution or clean ones). Inbox only; never while the user types or has emails selected; never training emails, nor mail from the user's own organization domain never trusted senders; at most once per conversation (one taken back out of Spam stays) |
| managedEnableSpamNotice | boolean | true | Gmail: a 15-second notice at the top of Gmail with the number moved and a **Review** link to Spam |
| managedEnableSpamFolderFlags | boolean | true | Gmail: in the Spam folder, emails the same checks would move there are red, whether the extension moved them or not (with why); unread ones' headers are read there too (stops by itself, with a log line, if that ever marks an email read). Spam without a red label was put there by Gmail or the user |
| managedEnableQrScanning | boolean | true | Decode QR codes in email images on the device and check their destinations |
| managedEnableAttachmentScanning | boolean | true | Check attachments on the device (≤ 10 MB): QR codes in images/PDFs, scripts in SVG/HTML, links in calendar invites, encrypted archives, disguised file names |
| managedEnableOutlookSupport, managedEnableProtonSupport, managedEnableYahooSupport, managedEnableAolSupport, managedEnableZohoSupport, managedEnableIcloudSupport, managedEnableFastmailSupport, managedEnableGmxSupport | boolean | true | Experimental support for each webmail app (Outlook on the web, Proton, Yahoo, AOL, Zoho, iCloud, Fastmail, GMX) |
| managedEnableTrackerReveal | boolean | true | 🔍 on email tracking links and cloud-storage pages; on request sends the link to the lookup service (the sender sees a click). `false` = tracking links are never sent anywhere |
| managedEnableOneTimeLinkProtection | boolean | true | Never request/cache/log reset, verification, login, unsubscribe links |
| managedEnableMismatchWarnings | boolean | true | Link text vs destination, raw IP, punycode, user:pass@ |
| managedEnableHiddenLinkProtection | boolean | true | Disable zero-size / transparent links |
| managedEnableClickConfirmation | boolean | true | Confirm before opening flagged links |
| managedVisualOverrides | boolean | true | Show highlights and warnings on links |
| managedEnableTrackingPixelBlocking | boolean | true | Detect tracking pixels |
| managedRemoveTrackingPixels | boolean | true | Remove pixels (true) or replace with invisible image (false) |
| managedEnableThirdPartyResolution | boolean | true | Send public-shortener URLs to unshorten.me |
| managedEnableDnsThreatCheck | boolean | true | Hostname lookups against filtering DNS resolvers |
| managedDnsQuad9 / managedDnsCloudflareSecurity | boolean | true | Security resolvers: a match flags the link |
| managedDnsCloudflareFamily | boolean | true | Adult-content filter: a match flags the link |
| managedDnsAdGuard | boolean | true | Backup resolver: only queried when no security resolver can be reached |
| managedEnableRemoteListSync | boolean | true | Daily download of shortener lists from GitHub |
| managedEnableResultCache | boolean | true | Cache results locally |
| managedEnableHistoryLog | boolean | true | Keep local history and activity |
| managedRetentionDays | integer 1–365 | 30 | Automatic deletion age |
| managedDohEndpoint | string (https) | empty | Custom threat resolver; may contain `{hostname}` or `{url}` |
| managedDohMethod / managedDohBody / managedDohHeaders / managedDohFlagField | string | GET / empty | Request method, body template, headers (e.g. API key) and optional threat field for the custom threat resolver |
| managedUnshortenerEndpoint | string (https) | empty | Custom unshortener, tried before unshorten.me; may contain `{url}`, `{url_noscheme}`, `{hostname}` |
| managedUnshortenerMethod / managedUnshortenerBody / managedUnshortenerHeaders / managedUnshortenerField | string | GET / empty | Request method, body template, headers and optional destination field for the custom unshortener |
| managedUseUnshortenMeFallback | boolean | true | Try unshorten.me when the custom unshortener gives no answer |
| managedAllowlist / managedBlocklist | string array | empty | Merged with the user's own lists. Blocklisted links are flagged with their destination hidden; users can reveal it with the 🔍 icon (sends the link to unshorten.me only if third-party resolution is on). The blocklist wins over the allowlist. A sender whose domain is on the allowlist is shown as trusted and never moved to Spam |
| managedTrustedSenders | string array | empty | Gmail: the allow list of senders never flagged or moved to Spam (addresses or whole domains), for example your phishing-training provider or false positives. There is no sender block list (`managedPhishingSenders` from 5.40–5.42 is ignored). Merged with each user's own trusted senders (Settings → Senders → Trusted senders); users can't remove these entries |

## Notes
- **Privacy-strict baseline:** set `managedEnableThirdPartyResolution`, `managedEnableDnsThreatCheck`,
  `managedEnableRemoteListSync` and `managedEnablePhishingFeeds` to `false` for a deployment that makes no third-party requests at all (links are still unwrapped offline; sender icons are left blank, and senders are checked only for malformed addresses and signs of forgery in the email).
- **Custom endpoints and API keys:** headers set by policy (for example an API key) are masked in the Options page and never included in user backups. Examples for URLhaus, Google Safe Browsing and Bitly are in Settings → Your own services; check each service's terms of use.
- **Custom endpoints and host access:** Firefox cannot grant new host access by policy. Either make sure the endpoint sends CORS headers,
  or allow users to approve the one-time host prompt when saving it.
- **Remote shortener lists** update automatically every day and are treated as untrusted:
  - Entries for major sites are ignored, and list-only domains are sent to unshorten.me only for URLs shaped like short links.
  - A newly listed domain is used only after it has appeared on three separate days. Removals apply immediately.
  - A download that changes more than a quarter of a list at once is held back. If the change is genuine, it is accepted automatically after 7 days.
  - The first download (and the first after sync was off or failing for over a week) is used immediately as the new starting point.
- **Bundled snapshot:** `shortener-snapshot.txt` gives a fresh install shortener coverage before its first download, for example when the network is down at install. It ships with a starter set of well-known shorteners. To bundle the full community lists, run `node tools/refresh-snapshot.js` (Node 18+, internet access) before packaging a release. This is optional; the daily sync keeps installed copies current either way.
- **Backups and restore:** backups contain only settings the user changed, so restoring an old backup never undoes a newer default. Cached link results are never restored. Policy-locked settings always win over a restored backup.
- **Troubleshooting:** every failure is recorded in **Options → Logging → Application log** with a level (Error, Warning, Info) and its source: DNS checks, list sync, custom resolvers, Gmail, restore and so on. Error messages contain only a link's site, never its full address. Errors also appear in the toolbar popup.
- Policy changes apply without reinstalling; open Gmail tabs pick them up on the next message opened.

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

## Sender icons and moving phishing to Spam (Gmail)

All of this is on by default and every part has its own key above. In short:

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
- **Trusted senders (the allow list):** users add their own in Settings → Senders → Trusted senders;
  `managedTrustedSenders` adds yours. They are never flagged or moved. Use it for your phishing-training
  provider (alongside `managedPhishSimulationDomains` / `managedPhishSimulationRules`) and for false positives.
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
  moves the conversation again. Add the sender to `managedTrustedSenders` so it's never flagged. Gmail has no
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
- **Phishing training:** an email whose sender's domain is in `managedPhishSimulationDomains`, or that matches
  `managedPhishSimulationRules`, is never moved. With simulation link domains set, emails are moved only once
  opened (their links decide), never from the list. With header rules, an unread email in the inbox list is
  left alone, because its headers aren't read until it's opened. To be safe, also list the training vendor's
  sending domains in `managedAllowlist`.
- **Network:** sender domains go to the same DNS threat services as links' site names; site names to Google's
  icon service (`www.google.com/s2/favicons`), and for a site with no icon of its own (nor its parent domain) to
  DuckDuckGo's (`icons.duckduckgo.com`, off with `managedEnableSenderIconFallback`); a delivering server's IP
  address to `api.country.is`. With
  `managedEnableDnsThreatCheck` false, none of these requests are made.
- **Recommended rollout:** start a pilot with `managedEnableAutoSpam` set to `false` (flags only), review what
  is flagged, add any false positives to `managedTrustedSenders`, then enable moving.

In `policies.json`, under `3rdparty` → `Extensions` → `link-unshortener@gmail-link-scanner`:

```json
{
  "managedEnableAutoSpam": true,
  "managedTrustedSenders": ["office@partner.example", "partner.example"]
}
```

## Deploying

The extension's **Help → Deploying in organizations** section has step-by-step instructions. In short:
publish the add-on on addons.mozilla.org (listed or unlisted; Firefox installs only signed add-ons),
then deploy `policies.json` as above with `installation_mode` set to `force_installed` (users can't
remove it) or `normal_installed`. Verify at `about:policies` and `about:addons`.

## Administrator-only policies

These keys exist only in the policy. The extension has no setting for them, users can't see or change
them, and they're not included in backups. **Copy policies.json** doesn't produce them either, so add
them by hand.

### Hide the Settings button and recent activity

```json
{
  "managedHidePopupSettingsButton": true,
  "managedHideRecentActivity":      true
}
```

- `managedHidePopupSettingsButton` removes **Open Settings** from the toolbar popup.
- `managedHideRecentActivity` removes the **Recent activity** list and its **Clear activity** button from
  the popup. Activity is still recorded and visible in Settings → Logging.
- **Settings stay reachable** for IT staff and anyone who knows where to look: `about:addons` → the
  add-on → **Options**. Hiding the button is a convenience, not a lock: to stop users
  changing a setting, set that setting by policy.

### Phishing simulation (training) emails

**Why this matters.** Security-awareness services (KnowBe4, Wizer and others) send simulated phishing
emails and record who opens them, clicks their links or reports them. To this extension they look like
real phishing, so without configuration it would:

- **warn users,** which spoils the test;
- **block the vendor's open-tracking pixel,** so "opened" isn't recorded;
- **possibly cause a false "click":** reading mail never visits a link's destination, but a short link
  can be looked up through a lookup service, and a user can click the 🔍 reveal.

Emails you identify as training are **left completely untouched**: no link is looked up or marked, no
pixel is blocked, no QR code, attachment or sender check runs, and no banner is shown. Each one is noted
in Settings → Logging (*"Phishing simulation email (KnowBe4): left unchecked, as set by your
administrator"*).

Two policies identify training emails. Use one or both; an email matching **either** is left unchecked.

| Policy | Identifies training emails by | Works in | Spoofable? |
|---|---|---|---|
| `managedPhishSimulationDomains` | **all** of the email's links going to the vendor's own domains | every supported webmail | No: a phisher can't host pages on the vendor's domains |
| `managedPhishSimulationRules` | a header the vendor adds, plus a **secret value** in it and/or the vendor's **sending addresses** | Gmail | Only if you rely on a public header name alone |

#### Best practices

1. **Use both identifiers.** Allow the vendor's **link domains** (every webmail) *and* add a **header
   rule** (Gmail). Domains cover Outlook, Proton and the rest; the header rule covers training emails
   without links (attachment tests) and keeps working when the vendor rotates domains.
2. **Make header rules unforgeable.** Use the vendor's **secret token** or a **custom header and value
   only you know** (KnowBe4 supports both). If the vendor's header is fixed and public (Wizer's
   `X-TestPhish`), add its **sending addresses**, unless it delivers by direct injection; then rely on
   the domains.
3. **List only domains the vendor owns.** Never list shared platforms: `docs.google.com`,
   `sharepoint.com`, `bit.ly`, cloud hosting (`*.amazonaws.com`, `*.github.io`, `*.web.app`), personal
   email domains. Real phishing is hosted there; an email linking only there would go unchecked. The
   extension refuses such entries and logs a warning, but don't rely on that.
4. **Use root domains** (`phish.example`, not `www.phish.example`): subdomains are included
   automatically.
5. **Keep the lists current.** Vendors add domains. Review the list before each new campaign or
   template, and when the vendor announces new domains. Until a new domain is listed, its emails are
   simply checked as usual (the safe outcome).
6. **Mirror your mail-filter allow-listing.** The values you put in Google Workspace's content
   compliance rule, inbound gateway or Microsoft 365 Advanced Delivery policy (header, addresses,
   simulation URLs) are the same ones this extension needs.
7. **Roll out in stages.** Apply the policy to a pilot organizational unit, send a test campaign to it,
   check the log, then widen.
8. **Treat the configuration as sensitive.** Secret header values are visible in the policy to
   administrators; don't publish them, and regenerate the token in the vendor console if it leaks.
9. **Tell your users** that training emails won't show the extension's warnings. That's intended:
   the test measures whether people spot phishing without help.

#### KnowBe4

| You need | Where to find it in KnowBe4 | KnowBe4 documentation |
|---|---|---|
| Phish link domains | KSAT console → **Phishing → Domains**, *Root Domain* column (or **Download CSV**) | [Manage Phish Link Domains](https://support.knowbe4.com/hc/en-us/articles/360061705153-Manage-Phish-Link-Domains) |
| A secret header | KSAT → **Account Settings → Phishing**: *Enable PST Header Token* (adds `X-KB4TOKEN`) or *Add Custom Header* (your own name and value) | [Console Account Settings: Phishing](https://support.knowbe4.com/hc/en-us/articles/12732930359699-KnowBe4-Console-Account-Settings-Phishing) |
| Default header and sending addresses | *KnowBe4's IP Addresses, Hostnames, and Headers* section | [Whitelisting Guide](https://support.knowbe4.com/hc/en-us/articles/203645138-Whitelisting-Guide) |
| Domain changes over time | Phish domain and landing domain change notes | [Phish Domain and Landing Domain Release Notes](https://support.knowbe4.com/hc/en-us/articles/115007240248-Phish-Domain-and-Landing-Domain-Release-Notes) |

Related KnowBe4 articles for your mail system:
[Whitelist by Email Header in Google Workspace](https://support.knowbe4.com/hc/en-us/articles/115004295208-Whitelist-by-Email-Header-in-Google-Workspace),
[Whitelist by IP Address in Google Workspace](https://support.knowbe4.com/hc/en-us/articles/115002797527-Whitelist-by-IP-Address-in-Google-Workspace),
[Advanced Delivery Policies in Microsoft Defender](https://support.knowbe4.com/hc/en-us/articles/4404511190803-Advanced-Delivery-Policies-in-Microsoft-Defender).

Steps:

1. In KSAT, turn on **Enable PST Header Token** (or **Add Custom Header**) and copy the token or value.
2. Copy your **root phish link domains** from **Phishing → Domains**.
3. Add both to the policy:

```json
{
  "managedPhishSimulationDomains": ["<root domain 1>", "<root domain 2>", "<…all from Phishing → Domains>"],
  "managedPhishSimulationRules":   [
    { "name": "KnowBe4", "header": "X-KB4TOKEN", "value": "<your KSAT token>" }
  ]
}
```

- **KnowBe4 adds new system phish link domains hidden.** Before you show (un-hide) a new domain in
  **Phishing → Domains**, add it to `managedPhishSimulationDomains`.
- **Default header without a token:** `X-PHISHTEST` is public. If you can't use a token, require
  KnowBe4's sending addresses instead (published in the Whitelisting Guide; in October 2026 the US
  addresses were `23.21.109.197`, `23.21.109.212` and `147.160.167.0/26`):
  `{ "name": "KnowBe4", "header": "X-PHISHTEST", "ips": ["23.21.109.197", "23.21.109.212", "147.160.167.0/26"] }`.
- **Direct Message Injection (DMI)**, which KnowBe4 recommends for Google Workspace, places emails in
  mailboxes without passing through KnowBe4's mail servers, so `ips` can't match. Use the token header.

#### Wizer

| You need | Wizer documentation |
|---|---|
| Phishing (landing page) domains and sending addresses | [Wizer IPs and domains](https://learn.wizer-training.com/knowledge/wizer-ips-and-domains) |
| The header (`X-TestPhish`) and Google Workspace allow-listing | [Whitelisting for Google Workspace](https://learn.wizer-training.com/knowledge/how-to-whitelist-by-ip-address-in-gsuite) |
| Direct Email Delivery (DED) for Google Workspace | [How To Set Up DED for Google Workspace](https://learn.wizer-training.com/knowledge/how-to-set-up-ded-for-google-workspace) |
| The full setup checklist | [Wizer Phishing Simulation Checklist](https://learn.wizer-training.com/knowledge/phishing-simulation-checklist) |

Steps:

1. Copy **all** phishing domains from *Wizer IPs and domains* (they look like ordinary support or
   login sites, such as `ssuport.com`, `the-verification.com` or `account-protector.com`).
2. Copy Wizer's sending addresses from the same page, unless you use DED.
3. Add them to the policy:

```json
{
  "managedPhishSimulationDomains": ["ssuport.com", "the-verification.com", "account-protector.com", "<…the rest of Wizer's list>"],
  "managedPhishSimulationRules":   [
    { "name": "Wizer", "header": "X-TestPhish", "ips": ["<Wizer sending addresses>"] }
  ]
}
```

- **Wizer's header is fixed and public**, so never use it without `ips`. With **DED**, leave the header
  rule out and rely on the domains.

#### Other vendors

Look for the vendor's **Google Workspace or Microsoft 365 allow-listing guide**. It names:

- the **header** to allow in a content-compliance rule (use it in `managedPhishSimulationRules`,
  ideally with a secret value if the vendor offers one);
- the **sending addresses** for the inbound gateway or email allowlist (`ips`);
- the **phishing or landing domains** for web filters, or the *simulation URLs* for Microsoft 365
  Advanced Delivery (`managedPhishSimulationDomains`).

#### Reference: `managedPhishSimulationDomains` (every webmail)

- **The rule:** an email is a training email only if it has links and **every** link goes to one of
  these domains or their subdomains. Links rewritten by a security gateway (Microsoft SafeLinks,
  Proofpoint URL Defense, Mimecast, Barracuda…) are unwrapped first, offline, so the real destination
  counts.
- **One link anywhere else** and the email is checked as usual, so a phishing email can't hide
  behind a single training link; its other links are still checked and marked. Look-alikes such as
  `ssuport.com.evil.example` don't match.
- **Refused entries:** well-known companies' domains, public link shorteners, personal email
  providers, and shared hosting or sending platforms are ignored, with a warning in the log.
- **Not recognized:** emails with no links (attachment tests; use a header rule in Gmail), and
  simulations that also link to a real site, such as a genuine logo link. Both are checked as usual.
- Up to 500 domains.

#### Reference: `managedPhishSimulationRules` (Gmail)

| Field | Meaning |
|---|---|
| `name` | A label for the log, e.g. `"KnowBe4"`. |
| `header` | The header the vendor adds (name only, any case). |
| `value` | Optional: the header's value must contain this text (any case). Use a **secret token**. |
| `ips` | Optional: Gmail must have received the email from one of these addresses or ranges (IPv4/IPv6, CIDR). Only the hop written by Gmail's own server counts; lower `Received` lines can be forged by a sender. |

All the fields you set must match; up to 20 rules. A rule with a public header name and neither `value`
nor `ips` is still honored, but logged as a warning, because a real phishing email could copy the header.

**Limits:** Gmail only, because the extension reads the headers from Gmail's *Show original*. While
header rules are set, each email in Gmail is checked a fraction of a second later than usual, once its
headers are read. If they can't be read, the email is checked normally: the extension errs toward
protection.

#### Verify and troubleshoot

1. Confirm the policy arrived: `about:policies` lists `3rdparty` with this add-on's ID and no errors.
2. Send a test campaign to yourself (or a pilot group) and open it in each webmail you use.
3. In Settings → Logging, look for *"Phishing simulation email (…): left unchecked"*. The text in
   brackets shows what matched: the rule's name, or *links to <domain>*.

| Symptom | Likely cause |
|---|---|
| The training email still shows warnings | One of its links isn't on the domain list (a new vendor domain, or a link to a real site), or the header rule's value or addresses don't match. Open the link's hover card to see its real domain. |
| Warning *"Phishing simulation domains ignored: …"* | A listed domain is a shared platform. Remove it; list only vendor-owned domains. |
| Warning *"… match a public header name only"* | Add a secret `value` or the vendor's `ips` to that rule. |
| Works in Gmail but not Outlook | Header rules are Gmail-only; add the vendor's link domains. |

## Resetting settings

**Reset my settings to defaults** (Settings → Data on this device) resets only the user's own choices. It never changes a setting your organization manages, including the user's stored value underneath it. So nothing changes for the user if a policy is later removed.

## Google Web Risk for threat checks

Organizations can use Google's Web Risk API as the custom threat resolver. The steps and the policy JSON are in the extension's Help → Deploying in organizations → "Threat checks with Google Web Risk". Note that Web Risk receives full links, whereas the built-in checks send only site names. Google has no API to expand short links; use your own lookup service for that (Help → Limitations).
