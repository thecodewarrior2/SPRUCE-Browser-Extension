# S.P.R.U.C.E+ admin guide

Every setting, plus the allowlist, blocklist and custom resolver, can be set and locked by policy: in
**Chrome and Edge** with Google Workspace, Microsoft Intune or Group Policy, and in **Firefox** with
`policies.json`, Group Policy / Intune or a macOS profile. Locked settings show 🔒 in the Options page and
the toolbar popup and cannot be changed by users. Anything you do **not** set stays under the user's
control (all features are on by default). **Safari** has no extension policies: see [Safari](#safari) for
what device management can do there.

The same keys work in Chrome, Edge and Firefox. Chrome and Edge wrap each value, as in
`"managedRetentionDays": { "Value": 14 }`; Firefox's `policies.json` takes the value itself, as in
`"managedRetentionDays": 14`. The examples below use the Chrome form unless they say otherwise.

## Contents

- [Set the policy](#set-the-policy): [Chrome and Edge](#chrome-and-edge) · [Microsoft Edge](#microsoft-edge) · [Firefox](#firefox) · [Safari](#safari)
- [Keys](#keys)
- [Notes](#notes)
- [Feature compatibility by webmail](#feature-compatibility-by-webmail)
- [Sender icons and moving phishing to Spam (Gmail)](#sender-icons-and-moving-phishing-to-spam-gmail)
- [Deploying](#deploying)
- [Safari](#safari)
- [Organization lists](#organization-lists)
- [Administrator-only policies](#administrator-only-policies)
- [Resetting settings](#resetting-settings)
- [Google Web Risk for threat checks](#google-web-risk-for-threat-checks)

## Set the policy

### Chrome and Edge

With Google Workspace (Chrome browsers and ChromeOS); for Microsoft Edge, see [Microsoft Edge](#microsoft-edge) below.

1. Google Admin console → **Devices → Chrome → Apps & extensions → Users & browsers**.
2. Choose the organizational unit, then add this extension by its Chrome Web Store ID,
   `ennpekfncgndmiffefhbkpdnjnnnhcpc` ([its listing](https://chromewebstore.google.com/detail/spruce+/ennpekfncgndmiffefhbkpdnjnnnhcpc)), and set it to **Force install**.
3. Open **Policy for extensions** and paste JSON in the form below. Delete every line you do not want to lock.

```json
{
  "managedEnableThirdPartyResolution": { "Value": false },
  "managedEnableRemoteListSync":       { "Value": false },
  "managedRetentionDays":              { "Value": 14 },
  "managedAllowlist":                  { "Value": ["internal.example.com"] }
}
```

`docs/policy-example.json` lists every key with its default value. Users can also generate a starting point from
**Options → Settings → Backup & Google Workspace → "Copy as policy JSON"**.

### Microsoft Edge

Edge reads the same settings as Chrome: the extension's own policy (Edge calls it a *third-party*
policy), set with Microsoft Intune, Group Policy or the registry on Windows, and with a configuration
profile on macOS. There are two separate parts: **installing** the extension (Edge's own extension
policies) and **setting and locking its options** (the extension's policy).

#### Which extension ID

Every policy names the extension by its ID, and each copy has its own:

| Copy | Its ID | Update address (for installing) |
|---|---|---|
| [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/spruce/ailfmflfcombomabeallgefjkkejjijh) (recommended for Edge) | `ailfmflfcombomabeallgefjkkejjijh` | `https://edge.microsoft.com/extensionwebstorebase/v1/crx` |
| The [Chrome Web Store](https://chromewebstore.google.com/detail/spruce+/ennpekfncgndmiffefhbkpdnjnnnhcpc) version, installed in Edge | `ennpekfncgndmiffefhbkpdnjnnnhcpc` | `https://clients2.google.com/service/update2/crx` |

The examples below use the Edge Add-ons copy. To install the Chrome Web Store copy in Edge instead (Edge
allows it when it's installed by policy), use its ID and update address. Use the ID of the copy you
install, in both parts; a test version or a self-hosted copy has its own. On a computer that has it, `edge://extensions` (with
**Developer mode** on) shows the ID under the extension. The listing can be hidden from search in Edge
Add-ons; installing by policy still works.

#### 1. Install it for everyone

Use one of these for the extension, not two (**ExtensionSettings** replaces what the others set for it):

- **Intune** (Windows): **Devices → Configuration → Create → New policy**, platform **Windows 10 and
  later**, profile type **Settings catalog** → **Add settings** → **Microsoft Edge → Extensions** →
  **Control which extensions are installed silently** (`ExtensionInstallForcelist`), with this entry:

  ```
  ailfmflfcombomabeallgefjkkejjijh;https://edge.microsoft.com/extensionwebstorebase/v1/crx
  ```

- **Group Policy** (Windows): import Microsoft's Edge policy templates (ADMX, from the Microsoft Edge for
  Business download page), then **Computer Configuration → Policies → Administrative Templates →
  Microsoft Edge → Extensions → Control which extensions are installed silently**, with the same entry.

- **One JSON policy that can also pin it to the toolbar** (Intune or Group Policy: **Microsoft Edge →
  Extensions → Configure extension management settings**, `ExtensionSettings`; Group Policy takes it on
  a single line):

  ```json
  {"ailfmflfcombomabeallgefjkkejjijh": {"installation_mode": "force_installed", "update_url": "https://edge.microsoft.com/extensionwebstorebase/v1/crx", "toolbar_state": "force_shown"}}
  ```

  `force_installed`: users can't turn it off or remove it; `normal_installed`: installed for everyone,
  but users can turn it off. `toolbar_state` (Edge 103 or later): `force_shown` keeps its button on the
  toolbar for good, `default_shown` shows it there at first.

- **Microsoft Edge management service** (Microsoft 365 admin center → **Settings → Microsoft Edge →
  Configuration policies** → a policy → **Extensions → Managed extensions → Add extension**): installs it
  for users signed in to Edge with their work account. It doesn't set the extension's own options: do
  that with part 2.

- **macOS**: a configuration profile (Intune: a **Preference file** profile; Jamf and others: a custom
  profile) for the preference domain `com.microsoft.Edge`, with `ExtensionInstallForcelist` (an array
  holding the entry above) or `ExtensionSettings`.

#### 2. Set and lock its options

**Windows.** Edge reads the extension's policy from the registry:

```
HKLM\SOFTWARE\Policies\Microsoft\Edge\3rdparty\extensions\ailfmflfcombomabeallgefjkkejjijh\policy
```

Every key in [Keys](#keys) is a value there, named as in the table: on/off and numbers as `REG_DWORD`
(1 on, 0 off), text as `REG_SZ`, and a list (`managedAllowlist`, `managedBlocklist`,
`managedTrustedSenders`) as a subkey of that name whose values `1`, `2`, `3`… each hold one entry. Only
what you set is locked. For example, to turn off third-party short-link lookups, keep history 14 days
and trust one internal site:

```
Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge\3rdparty\extensions\ailfmflfcombomabeallgefjkkejjijh\policy]
"managedEnableThirdPartyResolution"=dword:00000000
"managedRetentionDays"=dword:0000000e

[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Edge\3rdparty\extensions\ailfmflfcombomabeallgefjkkejjijh\policy\managedAllowlist]
"1"="internal.example.com"
```

The easiest way to write these values is the extension itself: set it up the way you want on one
computer, then choose **Settings → Backup & Google Workspace → Copy registry script**. It gives a
PowerShell script with those settings for Edge and Chrome; replace the ID at its top with the ID you
deploy. The Intune Settings catalog has no setting for an extension's own policy, so deploy the script:

- **Intune:** **Devices → Scripts and remediations → Platform scripts → Add → Windows 10 and later**,
  with **Run this script using the logged on credentials: No** (it runs as system) and **Run script in
  64 bit PowerShell host: Yes**.
- **Group Policy:** as a computer startup script, or write the same values with **Computer
  Configuration → Preferences → Windows Settings → Registry**.

**macOS.** Microsoft doesn't document how to give an extension its own policy in Edge on macOS. Chrome
reads it from a profile for the preference domain `com.google.Chrome.extensions.<ID>`, and guides from
other vendors use `com.microsoft.Edge.extensions.ailfmflfcombomabeallgefjkkejjijh` for Edge in the same way, with the keys as plain
values (`managedRetentionDays` an integer, `managedAllowlist` an array of strings). Earlier Edge versions
were reported not to read it, so check `edge://policy` on a test Mac before you rely on it.

#### 3. Check it

- `edge://policy` → **Reload policies**: the install policy is under **Microsoft Edge policies**, and the
  extension's own section (S.P.R.U.C.E+) lists every option you set, each with the status **OK**.
- `edge://extensions`: the extension shows that your organization manages it; a force-installed one
  can't be turned off or removed.
- The extension's **Settings**: each option you set shows 🔒 and can't be changed.

Changes need no reinstall: they apply after **Reload policies** in `edge://policy`, or when Edge next
reloads its policies, and open webmail tabs use them from the next message opened. Policies from the
Edge management service apply when Edge restarts, and a policy set on the device (Intune or Group
Policy) wins over the same one from the Edge management service.

### Firefox

Firefox passes an add-on's policy from `policies` → `3rdparty` → `Extensions` → the add-on ID
(`spruce@spruce-browser-extension`) to the add-on. The same `policies.json` can also install it:

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
      "spruce@spruce-browser-extension": {
        "installation_mode": "force_installed",
        "install_url": "https://addons.mozilla.org/firefox/downloads/latest/spruce@spruce-browser-extension/latest.xpi"
      }
    },
    "3rdparty": {
      "Extensions": {
        "spruce@spruce-browser-extension": {
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

addons.mozilla.org finds the add-on by its ID (`spruce@spruce-browser-extension`), so the address works
as written; for a self-hosted signed `.xpi`, use its address instead. The examples below show only the add-on's own settings object (the part under
the add-on ID). `docs/policy-example-firefox.json` lists every key with its default value. Users can also generate a
starting point from **Options → Settings → Backup & enterprise policy → "Copy policies.json"**.

#### Windows: Microsoft Intune and Group Policy

On Windows, Firefox also reads policy from the registry (`HKLM\SOFTWARE\Policies\Mozilla\Firefox`),
where Intune and Group Policy write it. When the registry and `policies.json` both set the same
top-level policy (`ExtensionSettings` or `3rdparty`), **the registry wins** and that part of
`policies.json` is ignored, so deliver this add-on's policy one way only.

1. **Options → Settings → Backup & enterprise policy → "Copy Intune script"** produces a PowerShell
   script that force-installs the add-on and writes the current settings. Delete the settings you don't
   want to lock from the `$Settings` line (and set `$InstallUrl` only for a self-hosted `.xpi`).
2. Intune admin center → **Devices → Scripts and remediations → Platform scripts → Add → Windows 10
   and later**: upload the .ps1, set *Run this script using the logged on credentials* to **No** and
   *Run script in 64 bit PowerShell host* to **Yes**, and assign it to a pilot group first.
3. Restart Firefox on a test device and check `about:policies`.

The script writes:

```
HKLM\SOFTWARE\Policies\Mozilla\Firefox\ExtensionSettings\spruce@spruce-browser-extension
    installation_mode   REG_SZ   force_installed
    install_url         REG_SZ   https://addons.mozilla.org/firefox/downloads/latest/spruce@spruce-browser-extension/latest.xpi
HKLM\SOFTWARE\Policies\Mozilla\Firefox\3rdparty\Extensions
    spruce@spruce-browser-extension   REG_SZ   {"managedRetentionDays":14,"managedBlocklist":["internal.example.com"]}
```

Firefox parses the add-on's value as JSON, so every setting keeps its type. On domain-joined computers
the same values can be written with **Group Policy Preferences → Registry**. If you already manage
Firefox with Mozilla's ADMX templates (Intune: **Devices → Configuration → Import ADMX**), you can
install the add-on with their **Extensions → Extension Management** setting and keep only the
`3rdparty` part of the script; the templates have no setting for an add-on's own policy.

#### macOS

Deliver the same policy as a configuration profile for the `org.mozilla.firefox` domain (Intune, Jamf
or similar) with `EnterprisePoliciesEnabled` set to true and the `ExtensionSettings` and `3rdparty`
dictionaries from `policies.json`. A `policies.json` inside the app bundle works too, but an app
update can replace it. See <https://mozilla.github.io/policy-templates/>.

### Safari

Safari has no extension policies; see [Safari](#safari) below.

## Keys
| Key | Type | Default | Purpose |
|---|---|---|---|
| managedEnableLinkUnmasking | boolean | true | Scan and unmask links |
| managedEnablePhishingFeeds | boolean | true | Download the OpenPhish community feed and Phishing Army (CC BY-NC 4.0) lists (at most once a day) and match links on the device |
| managedDnsControlD / managedDnsDns4eu | boolean | true / false | Additional free security resolvers (Control D malware; DNS4EU Protective, EU) |
| managedEnableSenderChecks | boolean | true | Gmail: read Gmail's sender verification when needed; trust company-only links (c.gle…) only in mail verified as from that company directly to the user; warn about brand impersonation |
| managedHidePopupSettingsButton | boolean | false | Administrator only (no setting in the extension): remove "Open Settings" from the toolbar popup; Settings stays reachable at chrome-extension://<ID>/options.html (Firefox: about:addons → the add-on → Options) |
| managedHideRecentActivity | boolean | false | Administrator only: remove "Recent activity" from the toolbar popup |
| managedHideDonateButton | boolean | false | Administrator only: remove the Donate button from Settings → Help → About |
| managedPhishSimulationDomains | array of strings | [] | Administrator only, every webmail: training-vendor link domains; an email whose links ALL go there is left unchecked |
| managedPhishSimulationRules | array of objects | [] | Administrator only, Gmail: phishing-simulation emails to leave unchecked (see "Administrator-only policies") |
| managedEnableSendCheck | boolean | true | Gmail: check the links in an email when Send is pressed, and list problems (typos, unreachable or non-existent sites, look-alike, phishing and malware sites) before it goes |
| managedEnableSenderIdentity | boolean | true | Gmail: each sender's site icon and a domain label colored by the sender checks, in the inbox list and opened emails (icons fetched once from Google's icon service and remembered 30 days, as raw images in the extension's own IndexedDB database, at most 1,500 sites; a blank space for sites without an icon, and when `managedEnableDnsThreatCheck` is false) |
| managedEnableSenderIconFallback | boolean | true | Gmail: a stand-in icon for a sender site without its own: its parent domain's (alerts.brand.com → brand.com, through Google's icon service), else DuckDuckGo's icon service (`icons.duckduckgo.com`; only the site name, only for such sites). Stand-ins are re-checked weekly and replaced by the site's own icon once it has one; where each icon came from is shown in Logging → Senders. False: a blank space |
| managedEnableSenderAvatars | boolean | true | Gmail: as a circle over each inbox row's checkbox (as Gmail and Simplify Gmail draw avatars; the checkbox comes back on hover and when ticked), the picture Gmail itself shows beside a sender in an opened email, remembered so the inbox list shows it too. The user's own organization domain: each colleague's own photo, per address (never the organization's logo). Another company: one logo per company (registrable domain), shown for every address there, learned only from an email that passed Gmail's sender verification (DMARC pass) and came from a shared mailbox (contact@, info@, support@, news@, no-reply@…, whose picture the company chose) or carried a BIMI logo Gmail embedded in the page (kept as is, nothing downloaded). A person's own photo at another company is never used; the company's logo is shown for them. Personal email services (gmail.com, outlook.com…) keep the site icon. Pictures from Gmail's photo host are fetched from Gmail's own image host (`*.googleusercontent.com`) by the extension's background part and checked again weekly; a changed photo or logo (new address, or a logo whose fingerprint changed) replaces the old one. The application log says why one wasn't used |
| managedEnableSenderBimi | boolean | true | Gmail: the logo a company publishes in DNS for its email (BIMI) over the checkbox of each inbox row from it, without opening any email. Only organization domains (never subdomains, so a sender can't build a per-recipient "read receipt" from throwaway subdomains) that enforce DMARC (`p=quarantine` or `p=reject`). Lookups go to Cloudflare (1.1.1.1, or its security resolver when the address 1.1.1.1 is blocked). The extension never downloads the SVG itself (most logo servers don't allow it); the inbox page shows it from its address as a picture (which can't run scripts), with no referrer, so the company's logo server sees the user's IP address. Rechecked weekly |
| managedSenderPictureSize | string | auto | Gmail: `auto` follows Gmail's display density (Default: 36 px circles over each inbox row's checkbox; Comfortable: 32 px circles; Compact: small icons beside the country flag, no circles). `large`, `medium` or `inline` set one size. Senders with no photo, logo or site icon get a colored circle with their initial (not inline) |
| managedEnableCopyAddress | boolean | true | Gmail: a button after the sender's address in opened emails that copies the address (keyboard accessible; a brief "Copied" confirmation, announced to screen readers). Works whatever the sender checks are set to. Another extension doing the same (Copy Button for Gmail) is recognized by the conflict warnings |
| managedEnableLookalikeCheck | boolean | true | Inbox list, nothing opened: senders whose domain imitates a protected domain. Protected: the top 10,000 of two public popular-site lists (Chrome UX Report via a research copy on GitHub, CC BY 4.0; Tranco from tranco-list.eu), downloaded monthly and counted only when the domain enforces DMARC; the built-in brands; your organization; domains whose mail passed DMARC in the mailbox. Look-alike characters, a built-in brand plus a scare word, a brand domain as a prefix, imitations of your organization: red, moved to Spam. One letter off, or a popular or learned name plus a scare word: red only if the sender's domain was registered under 90 days ago (public RDAP record via IANA; only the domain is sent); amber for the built-in brands otherwise; nothing for other old domains. Also a brand's name on a non-brand address (red; first, online, the domain's public DNS and registry/registrar records are read once: a domain proven the brand's isn't flagged, one that looks like it is amber) and a colleague's name on an outside address (amber; colleague names kept only as one-way hashes). Needs the new host permission `tranco-list.eu` (granted silently to policy installs) Also (5.94.16, 5.96 on testing): a colleague's name on an outside reply address (amber), or copied in at an outside address (weak) or at one imitating your organization's (amber). |
| managedEnableOwnNameCheck | boolean | true | Gmail, inbox list, nothing opened: an email whose sender name is the user's own email address, or mailbox name (the part before the @, written as in the address; in any case for addresses at Gmail, Outlook.com and other big providers), but which comes from someone else's address is flagged red and moved to Spam. Shared mailbox names (info, office, support…), the organization's own senders and addresses that contain the user's mailbox name (likely their other account) are left alone. Trusted senders are never judged |
| managedEnableCallbackScamCheck | boolean | true | "Call this number" scams: a subject with a phone number to call about a purchase or charge the user didn't make is flagged red (inbox list, nothing opened) and moved to Spam, whoever sent it, since attackers type such text into names that companies' own systems mail out (a real Microsoft or PayPal address); a number with only call/support wording is a caution. Opened emails: "call if you didn't make this purchase" and look-alike mathematical letters are cautions, on every webmail |
| managedEnableRowHighlighter | boolean | true | Highlight the inbox row under the mouse (and selected rows), so users see exactly which email a click opens; a see-through color and/or outline readable in light and dark themes. Every webmail whose inbox list the extension finds |
| managedRowHighlightColor | string | yellow | Highlight color for the row under the mouse: `yellow`, `blue`, `green`, `pink`, `purple` or `gray` |
| managedRowHighlightStyle | string | both | `both` (color and outline), `fill` (color only) or `outline` (outline only) |
| managedRowHighlightSelected | boolean | true | Also highlight emails the user has ticked |
| managedRowHighlightSelectedColor | string | blue | Highlight color for ticked emails (same values as `managedRowHighlightColor`). Different from the mouse color by default so the two aren't confused; the row under the mouse wins when it is ticked too. If both are set to the same color, Settings shows a warning but allows it |
| managedEnableConflictWarnings | boolean | true | Warn when another extension does the same job in the webmail (Gmail Sender Icons, Simplify Gmail, Contact Avatars for Gmail, Row Highlighter for Gmail, Copy Button for Gmail, or any extension drawing sender icons or photos), with one-click fixes: turn the other one off (Chrome, after the user grants the optional `management` permission; Firefox only lets users do it themselves, so they get the steps) or turn off only this extension's overlapping settings, one at a time or all (settings locked by policy stay as set). Once the user has turned off the overlapping settings they want off, that conflict isn't warned about again unless one of them is turned back on. `false` suppresses the warnings completely: nothing is shown, logged or listed |
| managedEnableSenderCountry | boolean | true | Gmail: country flag of the server that delivered the email (Gmail's Received header, read emails only; IP looked up at api.country.is, at most monthly per address), else the domain ending's country, else where the sender's website is hosted |
| managedEnableSenderDomainCheck | boolean | true | Gmail: check sender domains with the DNS threat services (domain name only) and the phishing lists. Personal-mail providers, major companies' domains and the user's own organization domain are never judged as a whole |
| managedEnableSenderAddressCheck | boolean | true | Gmail: compare sender addresses with the community scam-sender list (sefinek/Blacklisted-Emails, MIT; downloaded with the phishing lists); malformed addresses are flagged too |
| managedEnableAutoSpam | boolean | true | Gmail: move emails from **flagged** senders to Spam with Gmail's own Report spam (never unverified, unknown, caution or clean ones). Inbox only (and search results, below); never while the user types or has emails selected; never training emails, nor mail from the user's own organization domain never trusted senders; at most once per conversation (one taken back out of Spam stays) |
| managedEnableAutoSpamInSearch | boolean | true | Gmail: with `managedEnableAutoSpam`, also move flagged emails shown in search results (archived or labeled mail too). Never from a search in Spam, Trash, Sent, Drafts, chats or everywhere (`in:spam`, `in:trash`, `in:sent`, `in:anywhere`…), never conversations the user wrote in. `false`: inbox only |
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
| managedVirusTotalApiKey | string | empty | Optional VirusTotal API key for the Link Inspector's "Look up on VirusTotal" button (used only when a person clicks it). The free key allows 4 lookups a minute and 500 a day, shared by everyone, and is for non-commercial use. Hidden from users, never in backups |
| managedUnshortenerEndpoint | string (https) | empty | Custom unshortener, tried before unshorten.me; may contain `{url}`, `{url_noscheme}`, `{hostname}` |
| managedUnshortenerMethod / managedUnshortenerBody / managedUnshortenerHeaders / managedUnshortenerField | string | GET / empty | Request method, body template, headers and optional destination field for the custom unshortener |
| managedUseUnshortenMeFallback | boolean | true | Try unshorten.me when the custom unshortener gives no answer |
| managedAllowlist / managedBlocklist | string array | empty | Merged with the user's own lists. Blocklisted links are flagged with their destination hidden; users can reveal it with the 🔍 icon (sends the link to unshorten.me only if third-party resolution is on). The blocklist wins over the allowlist. A sender whose domain is on the allowlist is shown as trusted and never moved to Spam |
| managedTrustedSenders | string array | empty | Gmail: the allow list of senders never flagged or moved to Spam (addresses or whole domains), for example your phishing-training provider or false positives. There is no sender block list (`managedPhishingSenders` from 5.40–5.42 is ignored). Merged with each user's own trusted senders (Settings → Senders → Trusted senders); users can't remove these entries |

## Notes
- **Privacy-strict baseline:** set `managedEnableThirdPartyResolution`, `managedEnableDnsThreatCheck`,
  `managedEnableRemoteListSync` and `managedEnablePhishingFeeds` to `false` for a deployment that makes no third-party requests at all (links are still unwrapped offline; sender icons are left blank, and senders are checked only for malformed addresses and signs of forgery in the email).
- **Custom endpoints and API keys:** headers set by policy (for example an API key) are masked in the Options page and never included in user backups. Examples for URLhaus, Google Safe Browsing and Bitly are in Settings → Your own services; check each service's terms of use.
- **Custom endpoints and host access:** neither Chrome nor Firefox can grant new host access by policy. Either make sure the endpoint sends CORS headers,
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
  label: neither a warning (most mail comes from providers like Gmail) nor a promise of safety. Also flagged: a sender domain that doesn't exist (a subdomain with no DNS records of its own counts only when its organization's domain doesn't exist either; otherwise that domain is checked);
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

```json
{
  "managedEnableAutoSpam":   { "Value": true },
  "managedTrustedSenders":   { "Value": ["office@partner.example", "partner.example"] }
}
```

## Deploying

The extension's **Help → Deploying in organizations** section has step-by-step instructions for:

- **Google Workspace (Chrome / ChromeOS):** Admin console → Devices → Chrome → Apps & extensions → Users & browsers. Add the extension by its Chrome Web Store ID (`ennpekfncgndmiffefhbkpdnjnnnhcpc`), set it to **Force install**, and paste the JSON from **Settings → Backup & Google Workspace → Copy as policy JSON** into **Policy for extensions**.
- **Microsoft Edge with Intune:**
  - **Install:** Settings catalog → Microsoft Edge → Extensions → **Control which extensions are installed silently**, with the entry `ailfmflfcombomabeallgefjkkejjijh;https://edge.microsoft.com/extensionwebstorebase/v1/crx` (Edge Add-ons) or `ennpekfncgndmiffefhbkpdnjnnnhcpc;https://clients2.google.com/service/update2/crx` (the Chrome Web Store copy).
  - **Settings:** **Copy registry script** generates a PowerShell script that writes `HKLM\SOFTWARE\Policies\Microsoft\Edge\3rdparty\extensions\<ID>\policy` and the Chrome equivalent. Deploy it as an Intune platform script, running as system in 64-bit PowerShell.
  - Group Policy, the single JSON policy (`ExtensionSettings`, which can also pin it to the toolbar), the Edge management service and macOS: see [Microsoft Edge](#microsoft-edge).
- **Chrome on Windows with Intune:** Settings catalog → Google Chrome → Extensions → force-install list (import Google's ADMX templates if needed). The same registry script covers its settings.

Verify at `chrome://policy` / `edge://policy`. Menu names in admin consoles change over time, so expect small wording differences.

**Firefox:** the add-on is on [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/s-p-r-u-c-e/) (Firefox installs only signed add-ons); its ID is
`spruce@spruce-browser-extension`. Deploy `policies.json` as above with `installation_mode` set to `force_installed` (users can't
remove it) or `normal_installed`. Verify at `about:policies` and `about:addons`.

**Safari:** see [Safari](#safari).

## Safari

Safari has **no extension policies**: unlike Chrome and Firefox, an administrator can't set or lock an
extension's settings. What device management can do in Safari is install the app that carries the
extension, keep the extension turned on, and allow it on your webmail sites. Everything inside the
extension (all features are on by default) is up to each person, or comes from a backup file you share.

### 1. Build the app

A Safari extension comes inside a small app (Mac, and iPhone/iPad). Build it once from this folder:

- **On a Mac with Xcode:** run `tools/build-safari.sh`. It uses Apple's converter
  (`xcrun safari-web-extension-converter`) to make an Xcode project in `build/safari/`, with the
  extension copied inside, and builds the Mac app (signed "to run locally"). Set `BUNDLE_ID` to an
  identifier under your own domain (for example `org.yourdistrict.SPRUCE`), and `TEAM_ID` to
  your Apple Developer team to sign with it.
- **On GitHub:** the **Safari build** workflow (`.github/workflows/safari.yml`) runs the same script on a
  GitHub Mac for every push to `main`, or when started by hand, and offers the app and the
  Xcode project under the run's Artifacts. Mac runners count ten times against a private repository's
  Actions minutes.
- **To try it on one Mac without signing:** Safari → Settings → Advanced → **Show features for web
  developers**, then Develop → **Allow Unsigned Extensions** (asked again after each Safari restart). Open
  the app once, then turn the extension on in Safari → Settings → Extensions.

Requires Safari 18.2 or later (macOS, iOS and iPadOS).

### 2. Sign and distribute it

Open the generated Xcode project, choose your team under **Signing & Capabilities** for both the app and
the extension, then:

- **App Store or TestFlight:** Product → Archive, then upload. Store apps can be assigned to devices with
  Apple School Manager or Apple Business Manager and installed by your device-management tool. For iPhone
  and iPad this is the only way.
- **Mac, directly (Developer ID):** archive, export with Developer ID signing, have Apple notarize it, and
  deploy the app with your device-management tool (Jamf, Intune, Mosyle…).

### 3. Keep it on and allowed on your webmail

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

### 4. The same settings for everyone

Set the extension up once the way you want it, use Settings → **Back up**, and have each person
**Restore** the file (or include it in your onboarding). Backups hold the settings you changed and the
Allowlist, Blocklist and Trusted senders; API keys are never included. People can change their settings afterwards.

- **No third-party requests at all:** choose the privacy level **Offline only** before making the backup.
  Links are still unwrapped offline; sender icons are left blank, and senders are checked only for
  malformed addresses and signs of forgery in the email.
- **Your own lookup or threat-check service:** each person enters it, and its key, once.

### What can't be managed in Safari

- Locked settings (🔒), and resetting that leaves locked settings alone: nothing is locked in Safari.
- The administrator-only options of the Chrome and Firefox builds: a simpler toolbar popup (no Settings
  button or recent activity) and the rules that recognize phishing-simulation (training) emails; see below.
- Your organization's lists of allowed and blocked sites and trusted senders, kept apart from each
  person's own: in Safari they're only the lists in the backup you share.
- A threat-check service whose API key is hidden from people.
- **Phishing training:** the rules that recognize training emails (KnowBe4, Wizer…) are set by policy in the
  Chrome and Firefox builds, so Safari doesn't have them. Add the training vendor's sending domains to Trusted
  senders and its link domains to the Allowlist in the backup you share, or training emails may be flagged and
  moved like real phishing.

## Organization lists

Added to each user's own lists (users can add to them, not remove from them):

- `managedTrustedSenders`: senders never flagged or moved to Spam (addresses or whole domains), for
  example your phishing-training provider or a false positive.
- `managedAllowlist`: sites whose links are never checked or changed.
- `managedBlocklist`: sites whose links are always flagged, their destination hidden.

## Administrator-only policies

These keys exist only in the policy. The extension has no setting for them, users can't see or change
them, and they're not included in backups. **Copy as policy JSON** (Firefox: **Copy policies.json**) doesn't produce them either, so add
them by hand.

### Hide the Settings button, recent activity and the Donate button

```json
{
  "managedHidePopupSettingsButton": { "Value": true },
  "managedHideRecentActivity":      { "Value": true },
  "managedHideDonateButton":        { "Value": true }
}
```

- `managedHidePopupSettingsButton` removes **Open Settings** from the toolbar popup.
- `managedHideDonateButton` removes the **Donate** button from Settings → Help → About.
- `managedHideRecentActivity` removes the **Recent activity** list and its **Clear activity** button from
  the popup. Activity is still recorded and visible in Settings → Logging.
- **Settings stay reachable** for IT staff and anyone who knows the address: type
  `chrome-extension://<extension ID>/options.html` in the address bar. The ID is shown on
  `chrome://extensions` (Edge: `edge://extensions`) and in the store page's address; the store gives the
  published extension its own ID (Chrome Web Store: `ennpekfncgndmiffefhbkpdnjnnnhcpc`), different from the test version's. In Firefox: `about:addons` → the
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
  "managedPhishSimulationDomains": { "Value": ["<root domain 1>", "<root domain 2>", "<…all from Phishing → Domains>"] },
  "managedPhishSimulationRules":   { "Value": [
    { "name": "KnowBe4", "header": "X-KB4TOKEN", "value": "<your KSAT token>" }
  ] }
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
  "managedPhishSimulationDomains": { "Value": ["ssuport.com", "the-verification.com", "account-protector.com", "<…the rest of Wizer's list>"] },
  "managedPhishSimulationRules":   { "Value": [
    { "name": "Wizer", "header": "X-TestPhish", "ips": ["<Wizer sending addresses>"] }
  ] }
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

1. Confirm the policy arrived: `chrome://policy` (Edge: `edge://policy`) → this extension; in Firefox,
   `about:policies` lists `3rdparty` with this add-on's ID and no errors.
2. Send a test campaign to yourself (or a pilot group) and open it in each webmail you use.
3. In Settings → Logging, look for *"Phishing simulation email (…): left unchecked"*. The text in
   brackets shows what matched: the rule's name, or *links to <domain>*.

| Symptom | Likely cause |
|---|---|
| The training email still shows warnings | One of its links isn't on the domain list (a new vendor domain, or a link to a real site), or the header rule's value or addresses don't match. Open the link's hover card to see its real domain. |
| Warning *"Phishing simulation domains ignored: …"* | A listed domain is a shared platform. Remove it; list only vendor-owned domains. |
| Warning *"… match a public header name only"* | Add a secret `value` or the vendor's `ips` to that rule. |
| Works in Gmail but not Outlook | Header rules are Gmail-only; add the vendor's link domains. |

**Intune / registry:** both values are lists. In the registry, write each as a JSON string (REG_SZ),
for example `["ssuport.com","the-verification.com"]` or
`[{"name":"KnowBe4","header":"X-KB4TOKEN","value":"…"}]`, and confirm at `chrome://policy` that they
were read as lists.

## Resetting settings

**Reset my settings to defaults** (Settings → Data on this device) resets only the user's own choices. It never changes a setting your organization manages, including the user's stored value underneath it. So nothing changes for the user if a policy is later removed.

## Google Web Risk for threat checks

Organizations (with Google Workspace or any Google Cloud project) can use Google's Web Risk API as the custom threat resolver. The steps and the policy JSON are in the extension's Help → Deploying in organizations → "Threat checks with Google Web Risk". Note that Web Risk receives full links, whereas the built-in checks send only site names. Google has no API to expand short links; use your own lookup service for that (Help → Limitations).
