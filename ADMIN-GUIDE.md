# Managing Gmail Link Unshortener with Google Workspace

Every setting, plus the allowlist, blocklist and custom resolver, can be set and locked by policy.
Locked settings show 🔒 in the Options page and the toolbar popup and cannot be changed by users.
Anything you do **not** set stays under the user's control (all features are on by default).

## Set the policy
1. Google Admin console → **Devices → Chrome → Apps & extensions → Users & browsers**.
2. Choose the organizational unit, then add or select this extension.
3. Open **Policy for extensions** and paste JSON in the form below. Delete every line you do not want to lock.

```json
{
  "managedEnableThirdPartyResolution": { "Value": false },
  "managedEnableRemoteListSync":       { "Value": false },
  "managedRetentionDays":              { "Value": 14 },
  "managedAllowlist":                  { "Value": ["internal.example.com"] }
}
```

`policy-example.json` lists every key with its default value. Users can also generate a starting point from
**Options → Settings → Backup & Google Workspace → "Copy as policy JSON"**.

## Keys
| Key | Type | Default | Purpose |
|---|---|---|---|
| managedEnableLinkUnmasking | boolean | true | Scan and unmask links |
| managedEnablePhishingFeeds | boolean | true | Download the OpenPhish community feed and Phishing Army (CC BY-NC 4.0) lists (at most once a day) and match links on the device |
| managedDnsControlD / managedDnsDns4eu | boolean | true / false | Additional free security resolvers (Control D malware; DNS4EU Protective, EU) |
| managedEnableSenderChecks | boolean | true | Gmail: read Gmail's sender verification when needed; trust company-only links (c.gle…) only in mail verified as from that company directly to the user; warn about brand impersonation |
| managedEnableSendCheck | boolean | true | Gmail: check the links in an email when Send is pressed, and list problems (typos, unreachable or non-existent sites, look-alike, phishing and malware sites) before it goes |
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
| managedAllowlist / managedBlocklist | string array | empty | Merged with the user's own lists. Blocklisted links are flagged with their destination hidden; users can reveal it with the 🔍 icon (sends the link to unshorten.me only if third-party resolution is on). The blocklist wins over the allowlist |

## Notes
- **Privacy-strict baseline:** set `managedEnableThirdPartyResolution`, `managedEnableDnsThreatCheck` and
  `managedEnableRemoteListSync` to `false` for a deployment that makes no third-party requests at all (links are still unwrapped offline).
- **Custom endpoints and API keys:** headers set by policy (for example an API key) are masked in the Options page and never included in user backups. Examples for URLhaus, Google Safe Browsing and Bitly are in Settings → Your own services; check each service's terms of use.
- **Custom endpoints and host access:** Chrome cannot grant new host access by policy. Either make sure the endpoint sends CORS headers,
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

## Deploying

The extension's **Help → Deploying in organizations** section has step-by-step instructions for:

- **Google Workspace (Chrome / ChromeOS):** Admin console → Devices → Chrome → Apps & extensions → Users & browsers. Add the extension by Chrome Web Store ID, set it to **Force install**, and paste the JSON from **Settings → Backup & Google Workspace → Copy as policy JSON** into **Policy for extensions**.
- **Microsoft Edge with Intune:**
  - **Install:** Settings catalog → Microsoft Edge → Extensions → **Control which extensions are installed silently**, with an entry of the form `ID;https://edge.microsoft.com/extensionwebstorebase/v1/crx` (Edge Add-ons) or `ID;https://clients2.google.com/service/update2/crx` (Chrome Web Store).
  - **Settings:** **Copy registry script** generates a PowerShell script that writes `HKLM\SOFTWARE\Policies\Microsoft\Edge\3rdparty\extensions\<ID>\policy` and the Chrome equivalent. Deploy it as an Intune platform script, running as system in 64-bit PowerShell.
- **Chrome on Windows with Intune:** Settings catalog → Google Chrome → Extensions → force-install list (import Google's ADMX templates if needed). The same registry script covers its settings.

Verify at `chrome://policy` / `edge://policy`. Menu names in admin consoles change over time, so expect small wording differences.

## Resetting settings

**Reset my settings to defaults** (Settings → Data on this device) resets only the user's own choices. It never changes a setting your organization manages, including the user's stored value underneath it. So nothing changes for the user if a policy is later removed.

## Google Web Risk for threat checks

Google Workspace organizations can use Google's Web Risk API as the custom threat resolver. The steps and the policy JSON are in the extension's Help → Deploying in organizations → "Threat checks with Google Web Risk". Note that Web Risk receives full links, whereas the built-in checks send only site names. Google has no API to expand short links; use your own lookup service for that (Help → Limitations).
