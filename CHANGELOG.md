# Changelog

## 5.94.24 — EXPERIMENT (branch `llm_testing`): phish-tiny 0.16.0, which reads what the sender checks found

Not for release. The AI model is now **phish-tiny 0.16.0** (TinyPhishLLM `78706ea`, `models/phish-tiny/SOURCE.json`;
was 0.13.0), the first that reads **input format 2**: besides the email, the facts 5.94.23 started giving it
(who the sender's name claims to be and whether the domain is theirs, other Reply-To domains, the attached
files' kinds, failing SPF/DKIM) and a subject or text in capitals.

- **`ai.js`**: the input section is TinyPhishLLM's `tools/model-input.js` at that commit (format 2: `identityLine`,
  `replyToLine`, `attachmentsLine`, `capitalsLayout`; `modelInputParts(facts, format)`), and `analyze` builds the
  format the loaded model names (`model.json` `inputFormat`; 1 for one that names none).
- **What changes for the reader:** against 0.14.0 on the training repository's held-out published emails, 0.16.0
  misses fewer phishing emails (13 instead of 19 of 681 variants at 50%; 24 instead of 25 at 95%) and calls far
  fewer genuine ones phishing (20 instead of 33 of 705 at 50%; 10 instead of 16 at 95%); genuine look-alikes
  (a DocuSign envelope, a phone system's voicemail) are now right. It still trusts routine sign-in wording from
  a calm impostor more than it should; the extension's own sender warnings flag those senders whatever it says.
  Its full scores: TinyPhishLLM's `CHANGELOG.md`.
- Tests: the unit tests check the JavaScript runtime against 0.16.0's own numbers (`tests/fixtures/ai-vectors.json`)
  and the input format on its 94 made-up cases (`ai-input-format.jsonl`, 12 new for format 2).
  `test-domsink.js` runs with automatic moving off: its flagged email was sometimes moved to Spam (which clears the
  page) while the AI was still reading it, a race the suite's load decided; the test checks what the extension
  and the AI write into the page.
- Docs: `docs/FEATURES.md` (what the AI sees), `PRIVACY.md`.

## 5.94.23 — EXPERIMENT (branch `llm_testing`): the AI model's facts carry what the sender checks found

Not for release. Nothing the model reads changes yet: phish-tiny 0.13.0 reads input format 1, which leaves
these facts out. They are for input format 2 (phish-tiny 0.16.0, trained in TinyPhishLLM_Private_Training),
which tells the model what the extension's own checks found, so it judges an email's words in context
instead of on its own: a calm "PayPal" notice from a domain that isn't PayPal's read as genuine to 0.13.0.
When that model is synced (`tools/sync-model.js`), `modelInputParts` in `ai.js` takes format 2's lines.

- **`aiFactsFor`** (`content.js`) now gives, besides what it gave:
  - `identity`: **`aiSenderIdentity`** (`shared.js`): the brand the sender's name claims (`displayNameBrand`)
    and whether the domain is that brand's (`senderDomainOwnedBy`, with the same ownership lookup as the
    sender check, `brandOwnershipFor`): yes, no, not known to be, or a personal mailbox; whether the domain
    imitates a well-known brand (`lookalikeOf`); whether the name is a colleague's on an outside address
    (`colleagueNameHash`). Mail from the organization's own domains gets none.
  - `replyTo`: **`aiReplyToDomains`**: the Reply-To domains that aren't the sender's (`replyToDomains`, from
    the headers the header checks already read).
  - `attachments` (was always empty): the opened message's own attachment cards (`messageAttachments`),
    through **`aiAttachmentFacts`**: only each file name's last endings and the MIME type, never the name.
  - `auth` already carried SPF and DKIM; format 2 says them when they fail.
- The Settings page's **Try the AI** reads a pasted Reply-To line and gives the same identity.
- Tests: `unit.test.js` (the identity for a brand's own domain, another domain, a personal mailbox, the
  organization's own staff, proven and likely ownership, a look-alike; attachments keep no names; Reply-To
  only other domains). Made-up senders.

## 5.94.22 — EXPERIMENT (branch `llm_testing`): an opened email from a company shows the picture its inbox row shows, not Gmail's letter circle

Not for release. The same change as 5.101 on `testing`, with the same switch (`CHANGES_5_101` in `shared.js`:
set it to `false` and rebuild, and opened emails show Gmail's own picture only, as in 5.94.21) and tag:

- **[5.101-1] `openedAvatars`.** The inbox list showed a company sender's logo (or its site's icon) in a
  circle over the checkbox, but the opened email still showed Gmail's own picture beside the sender, often
  a plain letter circle. Now, in an opened email from a company (not the user's own organization, not a
  personal email service such as Gmail or Outlook.com), the inbox row's picture (`senderPicture`: the
  company's logo when its domain enforces DMARC, else its site's icon) is drawn over Gmail's
  (`placeMessageAvatar`), at its size and place, in the box Gmail draws it in (`MAIL.message.avatar.slot`,
  `.aCi`, or the parent of the image Gmail marks with the sender's address). It takes no clicks, so Gmail's
  hover card still opens; a flagged or cautioned email shows none of ours (`content.css`), so a forged
  email can't borrow a company's logo; colleagues and personal accounts keep Gmail's own picture (their
  photo). Looked for again after 0.5, 1.5 and 3 s (Gmail fills its picture in late), drawn again when
  Gmail redraws its own or a logo is learned (`refreshMessageAvatars`). Setting **Sender photos and company
  logos**.
- The conversation's **collapsed** messages get the same (`scanThreadAvatars`, on each scan and every 3
  seconds): Gmail marks the picture beside each with the sender's address. Their own email isn't read
  until it's opened, so, as in the inbox list, the sender's own verdict decides: flagged or caution, none
  of ours.
- Tests: `test-msgavatar.js` (a company's logo over Gmail's letter circle, at its size, taking no clicks;
  a colleague and a personal account keep Gmail's; a collapsed message, a company's and a personal
  account's; a flagged email shows none; the setting off). Made-up senders.

## 5.94.21 — EXPERIMENT (branch `llm_testing`): Gmail's AI summary of a suspicious email is covered; hidden instructions to an AI flag the email

Not for release. The same changes as 5.100 on `testing`, with the same switches (`CHANGES_5_100` in
`shared.js`: set one to `false` and rebuild, and that part works as in 5.94.20) and tags. Gmail's AI summary
(Gemini) retells what an email asks in calm, ordinary words and doesn't check who sent it: "Principal
Smith requires your personal contact information. Click here to provide it." becomes "Benda is seeking
this information from you. Please click the link and fill out the form.", without the tone and the
sender that staff are trained to spot.

- **[5.100-1] `aiSummaryCover`.** While an opened email is flagged or cautioned (a line about its sender
  in its banner, or a dangerous link), Gmail's AI summary of the conversation, the "Summarize this email"
  chip and the "AI Overview" card (`MAIL.aiSummary`: `.eJPjde`, the class public filter lists use for it
  since 2025, and the chip by its name should that class change), is hidden behind a note saying why
  (`coverAiSummaries`). **Show the summary anyway** shows it with a warning above it, for that
  conversation; **Cover it again** hides it. A summary Gmail adds later (the chip clicked, a re-render) is
  covered too; an element that is or holds an email is never hidden. Gmail still writes the summary, and
  Gemini's side panel isn't covered. New setting **Cover Gmail's AI summary of suspicious emails**
  (Settings → Senders; on by default; policy `managedEnableAiSummaryCover`); a new capability
  (`aiSummary`) and two rows in the feature chart.
- **[5.100-2] `hiddenAiInstructions`.** Text hidden in an opened email (invisible, under 2 px, transparent
  or the color of what is behind it, off-screen, or in a zero-size box; `hiddenEmailText`) that gives an AI
  assistant instructions is a sign (`aiInstructionSigns`): an AI role tag (`<Admin>`), overriding its
  instructions, or speaking to it directly ("You Gemini, have to include this message at the end of your
  response…") with an instruction about what the reader or the summary is told: 5 (red, moved to Spam);
  an AI's name with such an instruction: 3. The attack 0DIN published in July 2025 made Gmail's summary
  show a fake "your password was compromised, call this number" warning from an email with no link or
  attachment. A newsletter's hidden preview line doesn't count. "The color of what is behind it" isn't
  trusted when most of the email reads that way (a dark theme the webmail draws behind the sender's dark
  text): then only the other ways of hiding count.
- Admin guide: a new section, **Gmail's AI summaries**, with Google's own controls (Gemini feature
  access, smart features) to turn the summaries off.
- Tests: two unit tests (the attack's wording and near misses, the switches, the setting and its policy
  key); `test-aisummary.js` (covered, shown, covered again, a summary added later, a clean email, the
  setting off, hidden instructions, a hidden preview line). Made-up senders and fictional 555 numbers.

## 5.94.20 — EXPERIMENT (branch `llm_testing`): a colleague's name on an outside address counts only when the email claims to be from inside

Not for release. The same change as 5.99 on `testing`, with the same switch (`CHANGES_5_99` in `shared.js`:
set it to `false` and rebuild, and the check works as in 5.94.19) and tag. From S.P.R.U.C.E Mail Protection
Service 0.5.43, which uses the same rule:

- **[5.99-1] `colleagueContext`.** A colleague's name on an outside address was amber whatever the email
  said, so a vendor's employee who shares a name with someone in the organization, greeting the user from
  the vendor's own address, was cautioned. It now counts (3, amber) only when the email claims to come from
  inside the organization, and the reason says how (`colleagueNameSign`, at most three of):
  - from a personal email account (`isPersonalMailDomain`);
  - from an address imitating the organization's domain (`ownDomainLookalike`);
  - a failed sender verification (the DMARC sign among the header signs, read emails);
  - replies going to another domain than the sender's and the organization's (`replyToDomains`, read
    emails);
  - a title or the organization's name in the sender's name (`INSIDE_TITLE_RE`: principal,
    superintendent, director, payroll, HR…; the words of the organization's domain);
  - what impersonators ask, in the subject or, in an opened email, the text (`IMPERSONATOR_ASK_RE`: "are
    you available?", a quick favor, "I'm in a meeting", a cell number, gift cards, direct deposit,
    payroll, bank details, a wire transfer, W-2s, "keep this confidential"; `IMPERSONATOR_CODE_RE`: send
    a password or a code). The text is read only when the name is a colleague's.

  Otherwise it is a note (0) shown with the verdict: "The sender has the same name as someone in your
  organization, writing from <domain>'s own address. Nothing in the email claims to be from inside your
  organization, so it doesn't count (people share names)." A colleague's name with a title after it
  ("Name, Principal", "Name - Maple Schools", "Name | Finance") is now recognized too
  (`colleagueNameMatches`). `addressLinePeople` keeps a Reply-To address without a name as its domain
  only, so `HEADER_SIGNS_VERSION` is 8 (read emails' header signs are worked out again). Personal accounts
  are unaffected: colleagues' names are only learned from senders at the user's own organization.
- Tests: a unit test (the vendor's greeting, each claim, the switch off); `test-lookalike.js` (the vendor's
  greeting isn't amber; a titled name from outside is). Made-up people and addresses.

## 5.94.19 — EXPERIMENT (branch `llm_testing`): two more phishing lists, HaGeZi and TweetFeed's researchers' reports (a caution)

Not for release. The same change as 5.98 on `testing`, with the same switch (`CHANGES_5_98` in `shared.js`:
set it to `false` and rebuild, and the lists are 5.94.18's) and tag. From S.P.R.U.C.E Mail Protection
Service 0.5.21, which downloads the same lists:

- **[5.98-1] `moreLists`.** `PHISH_FEEDS` gains **HaGeZi Threat Intelligence Feeds** (medium; GPL-3.0;
  `*.domain` lines; a list like OpenPhish and Phishing Army: red link, flagged sender domain) and
  **TweetFeed** (CC0; the last month of researchers' reports, its GitHub `month.csv`, only the domain rows:
  `feedLines` in `background.js`). TweetFeed is a **report** (`confidence: 'report'`, `feedConfidence`):
  a link on it stays "safe" with `reported` (amber in the email, "Reported" in the Link Inspector), and a
  sender's domain on it is a caution that never moves the email.
- **OpenPhish** comes from its GitHub copy (`openphish.com/feed.txt` redirects there); `openphish.com`
  left `host_permissions`. Not on the switch.
- **Not added: URLhaus (abuse.ch)**: its downloads need a personal abuse.ch key since October 2026.

## 5.94.18 — EXPERIMENT (branch `llm_testing`): a newsletter's link through the mail service that sent it is amber, not red

Not for release. The same change as 5.97 on `testing`, with the same switch (`CHANGES_5_97` in `shared.js`:
set it to `false` and rebuild, and links work as before) and tag; its background message is in the message
tables (`MESSAGE_RULES`, `MESSAGE_HANDLERS`). From S.P.R.U.C.E Mail Protection Service
0.5.18–0.5.19, which uses the same rule:

- **[5.97-1] `sendingServiceLinks`.** A newsletter's "Listen on open.spotify.com" link that goes through
  the click tracker of the service that sent it (link.mail.beehiiv.com/v2/c/…) was red: "text shows a
  well-known brand, link goes elsewhere", and with it the email could be moved to Spam. Now, in an opened
  email (Gmail), such a red link is looked at again once the headers are read (`reviewLinkProblem`, as for
  [5.90-3]): when the link's domain is one whose DKIM signature Gmail's own receiving server verified on
  this email, and isn't the sender's own domain (`sendingServiceLinkProblem`: the mail service that sent
  it; no list of services), and the online checks found the link clean (`verdict` "safe", not "unknown"),
  and its registry date isn't recent (`domainAgeDays` in the background, a new message answered only
  online; 180 days, `MAIL_SERVICE_MIN_AGE_DAYS`; unknown is allowed), it becomes amber, saying which
  service and that where it leads isn't known until it's clicked. Not checked (Offline only, a lookup that
  didn't answer), recent, a link to a service that didn't sign this email, a scammer's domain signing its
  own mail, or a quoted part: red, as before.
- Tests: two unit tests; `test-companies.js` (with the lookups off, the link stays red). Made-up senders.

## 5.94.17 — EXPERIMENT (branch `llm_testing`): the AI says when it can't read an email (English only)

Not for release. The model, phish-tiny, was trained on English only (its card says so), so on an email in
another language its percentage meant little. Now it isn't run on one, and the person is told why:

- **`detectLanguage`** (`ai.js`): offline, no library. The letters' writing system first (most letters
  outside the Latin alphabet name the language: Cyrillic, Greek, Arabic, Hebrew, Korean, Japanese, Chinese,
  Thai, Devanagari…); for the Latin alphabet, the share of each language's commonest short words
  (Spanish, Portuguese, French, German, Italian, Dutch, Vietnamese, Polish, Turkish, Indonesian/Malay,
  Tagalog, Haitian Creole, Somali), counting only words that aren't common in English too. "Not English"
  only when that is clear: a bilingual email with a real English part is read, and a short one too. It is
  S.P.R.U.C.E Mail Protection Service's detection (its 0.5.10 `src/engine/language.js`), copied into
  `ai.js` with its names prefixed; the service keeps its own copy, unchanged.
- **`aiAnalyzeEmail`** (`background.js`) checks the subject and text first: another language → no model
  run, `skipped: 'language'`, and the advice (`aiNotEnglishAdvice`): "The model can't read this email: it
  reads English only", which language it looks like, and that the extension's own checks don't depend on
  the language and ran as usual (and, when they warn, to trust them). Text addressed to AI tools is still
  a danger sign, whatever the language. Logged only when asked for (not on the automatic run).
- **What the person sees:** in the opened email, the short automatic line "🤖 S.P.R.U.C.E+'s AI can't read
  this email: it reads English only." with **Why?**, which names the language and says the model wasn't
  run (no percentage, no "Ask again"); the Settings card's **Try it** says the same.
- Tests: two unit tests (made-up texts in eight languages, English, bilingual and short ones; the message
  answer) and one browser test (a made-up Spanish email in the fake Gmail thread).

## 5.94.16 — EXPERIMENT (branch `llm_testing`): the "To" line person by person; colleagues' names in Reply-To, Cc and To

Not for release. The same two changes as 5.96 on `testing`, with the same switches (`CHANGES_5_96` in
`shared.js`: set one to `false` and rebuild, and that part works as before) and tags. Both came from
S.P.R.U.C.E Mail Protection Service (0.5.12 to 0.5.14), which uses the same checks:

- **[5.96-1] `toLineByPerson`: the "To" line is read person by person.** (A broken address there still tells the AI model "broken to address", as before.) The check for a disguised "To"
  line (a display name showing an address other than the real one) read the whole line as one person, so
  a Google Calendar invitation, whose "To" line lists the guest bare and then the organizer with a name
  (`guest@district.org, Organizer Name <organizer@vendor.example>`), was taken for a name ("guest@…,
  Organizer Name") showing another address: 2 points, and with a new outside sender, a caution. The line
  is now split into its people (`addressList`: at the commas outside quotes and `<…>`) and each is judged
  alone. The address a name shows is read as mail programs write it: Outlook's `'ann@x.org' <ann@x.org>`,
  a name with the address in it ("Ann (ann@x.org)"), "mailto:", a +tag, encoded words. Another address of
  the same domain, or the same name in another domain (an alias, a group, a domain change), is a weak sign
  (1); another address in another domain is still a sign (2), and now names both domains. Off: the whole
  line as one, as before.
- **[5.96-2] `colleagueLines`: colleagues' names in Reply-To, Cc and To.** The colleague-name check
  (names learned from your organization's senders, kept as one-way hashes) looked only at the sender's
  name. It now looks at the other address lines too (opened emails, and read emails in the list, setting
  **Catch look-alike senders**): **Reply-To** under a colleague's name going to an outside address, so
  replies go to someone else (3, amber; the sign says when the domain imitates yours); a colleague
  **copied in** (Cc or To) at an outside address (1: staff are sometimes copied at a personal address) or
  at an address that imitates your organization's domain (3: the "I've copied our superintendent"
  trick; `ownDomainLookalike`: its name under another ending, a hyphen more or less, one letter away,
  look-alike characters, or something added). Never for your own domain's addresses, nor the sender's own
  address. Only the fingerprint of each name and its domain are kept with the email's header signs
  (`addressLinePeople`; never a name or an address), and they are judged against the colleagues' names
  whenever the email is shown (`colleagueLineSigns`). `HEADER_SIGNS_VERSION` is 7, so results saved by
  5.94.15 are worked out again. Off: those lines aren't looked at, as before.
- Tests: two unit tests (`tests/unit/unit.test.js`, made-up addresses only).

## 5.94.15 — EXPERIMENT (branch `llm_testing`): the build takes the AI model from TinyPhishLLM

Not for release. Nothing in how emails are judged changes: the model is still phish-tiny 0.13.0, byte for
byte. TinyPhishLLM is now the model's public home and holds only the model; its training (scripts,
published examples, check sets) moved to a private repository, TinyPhishLLM_Private_Training.

- **The model's files are no longer in this repository.** `models/phish-tiny/SOURCE.json` pins one
  TinyPhishLLM commit (`68f8dd6`) and each file's SHA-256; **`tools/build.js` adds the model to every
  package** from there (**`tools/fetch-model.js`**: this checkout's copy when it is the pinned one,
  otherwise downloaded) and stops if a file is missing or different. The tests run it first
  (`tests/run-all.js`, `tests/unit/unit.test.js`; the Firefox suite builds with `tools/build.js`);
  `--from <TinyPhishLLM folder>` works offline. Nothing is downloaded by the extension itself.
- **`tools/sync-model.js`** pins a model after TinyPhishLLM's `tools/check.js`, a check that the commit is on
  TinyPhishLLM's main branch, and the input-format check; it copies only the two references the tests use
  (`tests/fixtures/ai-vectors.json`, `ai-input-format.jsonl`), both made of made-up emails now.
- **Tests:** the pin; the files match it; only `SOURCE.json` is committed; a package gets the model
  (`addModel`); `fetch-model.js` downloads, checks and never keeps a different file. The hand-written and
  regression checks moved to the private training repository (`training/check-model.py`) with their
  emails; here, four made-up emails (two scams over 90%, two genuine under 10%) and the explanation of the
  CEO wire request.
- **The history of this branch was rewritten** (2026-11-12, as the maintainer asked): the published
  examples and check sets (`tools/ai/real-world.jsonl`, `eval-*.jsonl`, `tests/fixtures/ai-regressions.jsonl`,
  `ai-handwritten.jsonl`, `ai-input-format.jsonl`) are gone from every commit, a statement code kept from
  a real email is replaced, and made-up addresses at real domains became `madeup.…`. The three commits that
  only added examples are gone; the older commits' AI tests no longer run.
- `CLAUDE.md`: never commit the model's files or any training example.


## 5.94.14 — EXPERIMENT (branch `llm_testing`): the AI model comes from TinyPhishLLM; phish-tiny 0.13.0

Not for release. The model moves to its own repository, TinyPhishLLM, which S.P.R.U.C.E+ Mail Protection
uses too: one model, trained in one place.

- **The model is now phish-tiny 0.13.0**, the one S.P.R.U.C.E+ Mail Protection 0.5.7 runs (trained with
  this branch's training tools at `9292388` plus 96 de-identified examples from one district's own mail,
  which are in no repository). It replaces 0.11.0. From its card (held-out sets, at the service's 90%
  line): published phishing missed 20 → 11 of 603, published genuine called phishing 17 → 13 of 624, the
  district's genuine mail called phishing 15 → 7 of 23, look-alikes 3 → 3, hand-written 33 of 33.
- **`tools/sync-model.js <TinyPhishLLM folder>`** copies the model (`models/phish-tiny/`) and its
  references from a clean TinyPhishLLM checkout, after TinyPhishLLM's own check and a check that
  `ai.js` builds the model's input exactly as it was trained; it records the commit and each file's
  SHA-256 in `models/phish-tiny/SOURCE.json`.
- **Unit tests:** the model's files must match `SOURCE.json`; `modelInputText` must build exactly the
  82 texts of TinyPhishLLM's input-format reference (`tests/fixtures/ai-input-format.jsonl`). The
  hand-written check set now comes with the model (`tests/fixtures/ai-handwritten.jsonl`), as do
  `ai-vectors.json` (for 0.13.0) and `ai-regressions.jsonl`.
- **`tools/ai/` is gone:** the training (`make-dataset.js`, `train.py`, the published examples, the
  check sets) is in TinyPhishLLM's `training/`, unchanged except for its paths. `CLAUDE.md` says not to
  train or edit the model here.


## 5.94.13 — EXPERIMENT (branch `llm_testing`): model 0.11.0, round 7 of published examples

Not for release. Trained on 1092 published examples (564 phishing, 528 genuine; round 7 added two
commits earlier), averaged over three runs.

- **Round 7** (details in its commit): phishing from professional associations and regulators (state
  bars, a federal court, ALTA and Realtor associations, health and accountancy boards, CPA societies,
  school retirement systems, churches and dioceses, planners and municipal groups) and from
  email-security companies not used before (real services carrying scams, device-code and QR lures,
  HTML/SVG attachments, ClickFix, wire changes); 97 genuine emails from open-source templates of IT,
  identity and help-desk software (Keycloak, GitLab, WordPress, Nextcloud, Zammad, osTicket…) and of
  e-signature, invoicing, store, scheduling and school software (Documenso, DocuSeal, OpenSign,
  Invoice Ninja, Odoo, WooCommerce, Cal.com, Moodle, Open edX…). 0.10.0 called about a third of those
  genuine templates' variants phishing.

| Held-out set | 0.10.0 | 0.11.0 |
|---|---|---|
| Published phishing caught (564 variants of 188 examples) | 549 | 550 |
| Published genuine judged right (528 variants of 176 emails) | 484 | 508 |
| Earlier sources only (both trained on them): phishing (477) / genuine (429) | 464 / 412 | 466 / 413 |
| New sources only: phishing (87) / genuine (99) | 85 / 72 | 84 / 95 |
| Genuine look-alikes called phishing (24) | 6 | 4 |
| Hand-written check set (33) | 33 | 33 |
| Regression cases (15) | 15 | 15 |
| Total mistakes (held-out and look-alikes) | 65 | 38 |

Level with 0.10.0 on the emails both trained on the same sources for; much better on genuine
notification emails like the open-source templates (partly because it trained on two thirds of those
sources); the hand-written look-alikes it flags are back down from 6 to 4 (each of its runs flagged 3
or 4). Still missed or flagged: QR-code Duo/MFA lures, SNAP and scholarship offers, a fake Microsoft
sign-in alert, a deepfake investment invite; a real DocuSign envelope, a Teams voicemail, a Microsoft
support case, a lab-results portal registration.


## 5.94.12 — EXPERIMENT (branch `llm_testing`): model 0.10.0, round 6 of published examples

Not for release. Trained on 909 published examples (478 phishing, 431 genuine; the 175 of round 6
added two commits earlier), averaged over three runs (`--seeds 7,8,9`, kept in `--runs-dir` so a
restart of the build machine doesn't lose finished runs).

- **Round 6** (details in its commit): phishing from US campuses not used before (Minnesota,
  Binghamton, Montclair State, UC Irvine, Utah State, Towson, Seton Hall) and state offices, and from
  outside the US (Irish Revenue, NZ Inland Revenue, HMRC, HMCTS, CRA, Australia Post, ASIC, NZ Police,
  NHS, universities in Ireland, Canada, Australia, NZ and the UK); genuine emails from the senders' own
  open-source templates (Login.gov, Bitwarden, Mozilla, Wikipedia, Canvas, Code.org, the .gov
  registrar, Mastodon, PyPI, Open Collective) and from education services (College Board, Parchment,
  Turnitin, Cengage, Kelly Education, Swing Education) and universities abroad.

| Held-out set | 0.9.0 | 0.10.0 |
|---|---|---|
| Published phishing caught (477 variants of 159 examples) | 451 | 464 |
| Published genuine judged right (429 variants of 143 emails) | 403 | 412 |
| Earlier sources only (both trained on them): phishing (393) / genuine (339) | 374 / 325 | 383 / 324 |
| New sources only: phishing (84) / genuine (90) | 77 / 78 | 81 / 88 |
| Genuine look-alikes called phishing (24) | 4 | 6 |
| Hand-written check set (33) | 33 | 33 |
| Regression cases (15) | 15 | 15 |
| Total mistakes (held-out and look-alikes) | 56 | 36 |

On the emails both models trained on the same sources for, 0.10.0 catches more phishing (383 vs 374)
and is level on genuine mail. The hand-written look-alikes it calls phishing rose from 4 to 6 (its
three runs flagged 5, 6 and 4; 0.8.0 flagged 2): short, plain internal notices (a phone-system
voicemail, a help-desk ticket update, an HR meeting request, a PTA QR RSVP, a donation receipt, a
DocuSign lease). That is worth watching: much of the newer phishing is short and internal-looking.
Still missed: QR-code MFA and Duo lures, a calendar invite with a hidden link, SNAP and "sponsored
scholarship" offers, a pay-dates notice.


## 5.94.11 — EXPERIMENT (branch `llm_testing`): model 0.9.0, averaged over three training runs

Not for release. Trained on the 174 examples added in the previous commit (734 in all: 393 phishing,
341 genuine), and for the first time as the average of three training runs (`train.py --seeds 7,8,9`).

- **Why averaging:** training the same data with different random seeds moved the held-out genuine
  score by up to 24 of 243 variants and the phishing score by up to 9 of 315. Differences that small
  between model versions were partly luck. On 0.8.0's data the average of three runs scored as well as
  the best of the three without picking it. The averaged model is one model: same size and speed.
- **The new examples** (details in the previous commit): phishing from Cisco Talos, Netcraft,
  Barracuda, Unit 42, Darktrace, Snopes, PolitiFact, the BBB and local news (churches, a township,
  school districts), and from state, county, licensing-board, hospital and university security pages;
  real emails from goodemailcopy.com, Really Good Emails, Snopes-confirmed emails, Postmark, GovDelivery
  bulletins of 25 more agencies, and K-12 Smore and ParentSquare posts.

| Held-out set | 0.8.0 | 0.9.0 |
|---|---|---|
| Published phishing caught (393 variants of 131 examples) | 376 | 374 |
| Published genuine judged right (339 variants of 113 emails) | 314 | 325 |
| Earlier sources only (both trained on them): phishing (315) / genuine (243) | 304 / 227 | 303 / 229 |
| New sources only: phishing (78) / genuine (96) | 72 / 87 | 71 / 96 |
| Genuine look-alikes called phishing (24) | 2 | 4 |
| Hand-written check set (33) | 33 | 33 |
| Regression cases (15) | 15 | 15 |
| Total mistakes (held-out and look-alikes) | 44 | 37 |

On the emails both models trained on the same sources for, 0.9.0 and 0.8.0 are level (the differences
are within the seed noise). 0.9.0 judges the new kinds of real email better, partly because it trained
on two thirds of those sources. Its two extra look-alike false alarms (a help-desk ticket update, an HR
meeting request) are within the noise too: each of its three runs flagged 4; 0.8.0's single run was a
lucky one with 2. Still missed or flagged: QR-code lures, a closing-wire change, a compromised
partner's file share, a tariff-dividend scam; a DocuSign envelope, a LastPass activation, a Raptor
volunteer approval, a charity appeal.


## 5.94.10 — EXPERIMENT (branch `llm_testing`): model 0.8.0, 170 more examples from new sources

Not for release. 170 more published examples, all from sites not used before (560 in all: 317 phishing,
243 genuine), paraphrased with placeholders and no personal, account or bank details.

- **Phishing from security companies and agencies** (42): INKY, Kaspersky Securelist, Check Point,
  Trustwave, Sophos, Mimecast, Trend Micro, Bitdefender, Cloudflare, Arctic Wolf, Forcepoint, FINRA,
  the Secret Service, the Pennsylvania attorney general, Canada's Get Cyber Safe, and a newspaper's
  reconstruction of the emails in a school district's construction-payment fraud. They cover vendor
  ACH and wire changes, "fiscal year" bank updates, scams sent through real services (Adobe, Yousign,
  Zoom Docs, SharePoint one-time codes, Google Docs comments, Microsoft 365 purchase confirmations,
  PayPal invoices), SVG and HTML attachments, device-code sign-ins, fake CAPTCHA "ClickFix" commands,
  calendar-invite links, copyright and legal threats.
- **Phishing from school galleries** (44): Stanford, Broward College, Syracuse, Northeastern, Iowa,
  Wisconsin, Florida State, San Diego State, Rice, Columbia, Purdue, UC Riverside, the Wisconsin
  education department and three K-12 districts. They cover financial-aid refunds, scholarships, FAFSA
  and SNAP scams, grant-award fees, "you are failing this class", fake professors and job scams, an IEP
  document sent to parents from a hacked staff account, a 403(b) audit, voicemail and Zoom transcripts.
- **Real emails from K-12 vendors** (43): Gaggle, GoGuardian Beacon and Bark student-safety alerts,
  Google Classroom and Schoology summaries, Raptor volunteer approvals, Skyward, Aeries and Infinite
  Campus portal emails, DonorsChoose, Scholastic Book Clubs, Lifetouch, Jostens, MemberHub and
  99Pledges, Prodigy, Lexia, Newsela, and teacher-certificate renewals (Texas, California) and a
  teachers' retirement system.
- **Real emails from new verified sources** (41): GovDelivery bulletins from ten new agencies (a jury
  questionnaire, a state pension office, Texas DMV identity checks, a comptroller's 1099-G, Medicare's
  MFA change, an educator-certificate renewal, transit and court notices), university IT and HR
  announcements (Wisconsin–Madison, UNC Greensboro, Clemson, Howard, USC, Rochester), goodemailcopy.com
  (Slack, HipChat, Figma, Squarespace, Dropbox, GitHub, Headspace) and new Really Good Emails.
- Some sites refuse automated reading (justice.gov, fbi.gov, emaillove.com, several help centers), and
  ohioauditor.gov isn't reachable from the build environment, so they aren't covered.

| Held-out set | 0.7.0 | 0.8.0 |
|---|---|---|
| Published phishing caught (315 variants of 105 examples) | 301 | 304 |
| Published genuine judged right (243 variants of 81 emails) | 213 | 227 |
| Same, earlier sources only: phishing (231) / genuine (159) | 222 / 143 | 225 / 149 |
| Genuine look-alikes called phishing (24) | 3 | 2 |
| Hand-written check set (33) | 33 | 33 |
| Regression cases (15) | 15 | 15 |

The "earlier sources only" row is the fairer comparison: 0.7.0 and 0.8.0 trained on the same sources
for those emails. The synthetic test drops from 1500/1500 to 1497/1500 (templates only).

Still wrong:
- **Missed phishing (8 examples):** a closing-wire change, a compromised partner's worksheet share, a
  401(k) QR PDF, a calendar invite with a hidden link, a SNAP-benefits offer, a "sponsored scholarship
  scheme", a Zoom invite and a Duo registration QR code.
- **Called phishing (7 genuine emails):** a lab-results portal registration, a LastPass activation,
  DonorsChoose "fully funded", a Microsoft support case, a Raptor volunteer approval, a charity appeal
  and LinkedIn Learning access. Plus two hand-written look-alikes: a DocuSign lease and a phone-system
  voicemail.


## 5.94.9 — EXPERIMENT (branch `llm_testing`): model 0.7.0, 125 more real, legitimate emails

Not for release. The maintainer can't share their own district's mail yet, so the model learned from
real, legitimate emails that their senders published online. It now judges real notices far better
and catches more phishing than 0.6.0.

- **125 published genuine emails** (159 in `tools/ai/real-world.jsonl`, 390 rows in all). Each is
  paraphrased with placeholders for every person, school and company, with no personal, account or
  bank details:
  - **Schools and universities** (40): Brown's "legitimate email" posts; university payroll offices'
    W-2, direct-deposit-alert and one-time-passcode emails; Arizona's mass-email archive; Fairfax County
    Public Schools' staff bulletins; Washington's school-employee benefits emails; district
    ParentSquare and Smore posts (enrollment deadlines, data confirmation, fundraisers, picture day).
  - **Vendors' own notification emails** (40): Microsoft Entra, Defender and Teams voicemail; Google
    Workspace and Drive; Zoom, Dropbox, Slack, Box, Okta and 1Password; Stripe, Square, PayPal, Amazon
    Business, ADP and Paychex; MySchoolBucks, ParentSquare, Remind, PowerSchool, Frontline, SafeSchools
    and Securly.
  - **Public archives of real sent emails** (45): GovDelivery bulletins (VA, IRS, SSA, state tax and
    unemployment agencies, toll agencies, property-tax and utility notices, a school district) and
    real brand emails from Really Good Emails (sign-in alerts, codes, receipts, gift cards, surveys with
    prizes, trial endings, donation receipts and appeals).
- Some vendor and archive pages refuse automated reading (Milled, KnowBe4, Gusto, Docusign, Clever,
  Adobe Sign, Seesaw), so those aren't covered.

| Held-out set | 0.4.0 | 0.5.0 | 0.6.0 | 0.7.0 |
|---|---|---|---|---|
| Published phishing caught (231 variants of 77 examples) | 217 | 228 | 218 | 222 |
| Published genuine judged right (159 variants of 53 emails) | 84 | 58 | 113 | 143 |
| Genuine look-alikes called phishing (24) | 10 | 4 | 5 | 3 |
| Hand-written check set (33) | 33 | 32 | 33 | 33 |
| Regression cases (15) | 15 | 15 | 15 | 15 |
| Total mistakes | 99 | 109 | 64 | 28 |

Still wrong:
- **Missed phishing (6 examples):** a closing-wire change, a compromised partner's phonics-worksheet
  share, a fake Microsoft unusual-sign-in alert, a Zoom invite, and two QR-code lures (Duo
  registration, a benefits guide).
- **Called phishing (9 genuine emails):** a DocuSign envelope, a Microsoft "users at risk" alert, a
  Microsoft support case, a LastPass activation, a lab-results portal registration, LinkedIn Learning
  access, a payroll text-confirmation notice, a "use your vacation hours" notice, and a charity appeal.
  Plus three of the hand-written look-alikes: a DocuSign lease, a phone-system voicemail, a PTA QR RSVP.

The held-out genuine emails come from the same sources as trained ones (several from one payroll
office, one archive), so that score is somewhat optimistic.


## 5.94.8 — EXPERIMENT (branch `llm_testing`): model 0.6.0, forum examples and published genuine emails

Not for release. 111 more published examples. For the first time they include real emails that look
like scams, and these showed that 0.5.0 raised many false alarms on real security alerts and notices.

- **77 more phishing examples** (231 in `tools/ai/real-world.jsonl`):
  - **IT-admin communities and write-ups** (38): Spiceworks threads, Microsoft Q&A, MailGuard, KnowBe4,
    IRONSCALES and CyberNut (K-12 cases), Cofense, Hoxhunt, Malwarebytes. They cover mailbox and
    quarantine notices, "keep your same password", fax and voicemail lures, payroll and HR QR codes,
    thread hijacking and ACH changes, "are you free?" errands, bid invitations and RFQs, parent and
    student lures, fake purchase orders.
  - **Consumer scams from the UK, Ireland, Canada and Australia** (39): Which?, Malwarebytes Labs,
    Scamwatch, the Garda, the Canadian Anti-Fraud Centre, the RCMP, ESET, the CFTC. They cover
    government rebates and fines, licence and vehicle-tax notices, utility credits, subscription and
    storage scams, callback receipts, tax-agency mail, fake transfers, fake investigators, money-mule
    and cheque jobs, sextortion and crypto lures.
  - Reddit refuses automated reading, so nothing comes from it.
- **34 published genuine emails** (`"label": 0`): Brown University's "legitimate email" posts, other
  schools' IT pages, and the companies' own descriptions of their real emails. They include Microsoft
  and Google security alerts, Apple sign-in notices, DocuSign, PayPal, Venmo, Duo, Okta and Login.gov
  notices, Teams and phone voicemail, a Microsoft 365 quarantine report, a PowerSchool breach notice,
  donation receipts, QuickBooks invoices, Handshake, HealthStream and Workday emails. Paraphrased, with
  placeholders for every person and school.
- **Generator:** genuine rows use the brand's real sending domain and link host (`senderDomain`,
  `host`), or the organization's own or a supplier's, always passing the sender check. They are split
  and held out on their own, and the model card scores them as false alarms. The class balance counts
  them.

| Held-out set | 0.4.0 | 0.5.0 | 0.6.0 |
|---|---|---|---|
| Published phishing caught (231 variants of 77 examples) | 217 | 228 | 218 |
| Published genuine judged right (33 variants of 11 emails) | 17 | 6 | 22 |
| Genuine look-alikes called phishing (24) | 10 | 4 | 5 |
| Hand-written check set (33) | 33 | 32 | 33 |
| Regression cases (15) | 15 | 15 | 15 |
| Total mistakes | 40 | 35 | 29 |

0.6.0 makes the fewest mistakes and flags far fewer real notices, but misses more published phishing
than 0.5.0: 13 variants of 8 examples, mostly short file-share messages from compromised partners and
students (a phonics worksheet, an essay to review, a customer's documents), a QR benefits guide, a
dispute notice, a fake Microsoft unusual-sign-in alert, a conference purchase report and a Zoom invite. Still called phishing: real DocuSign envelopes, a Google
password-breach alert, a lab-results portal registration, a Microsoft support case, a phone-system
voicemail, a help-desk ticket update and a donation receipt. The held-out genuine set is small (11
emails), so its score moves a lot with each email.


## 5.94.7 — EXPERIMENT (branch `llm_testing`): model 0.5.0, trained on published spear phishing and email scams

Not for release. The AI model learned from 114 more published examples, and from genuine emails that
look like them, so it catches more targeted phishing and raises fewer false alarms on ordinary school
mail.

- **114 new real-world examples** in `tools/ai/real-world.jsonl` (154 in all), each paraphrased with
  placeholders and its source:
  - **spear phishing and business email compromise** (35): leader gift-card requests and "are you
    available?" openers, payroll diversion, W-2 requests, supplier "new bank details" and thread
    hijacking, CEO and attorney wires, closing-wire changes, payroll-pirate and QR-code lures, Teams
    voicemail, fake purchase orders. Sources: FBI IC3, IRS, the US Department of Education, FTC,
    Microsoft, Abnormal, Proofpoint, universities, a Texas school risk fund.
  - **consumer scams** (40): callback renewals (Geek Squad, PayPal, Venmo), payment-app tricks, customs
    and parcel fees, account-suspended notices, SSA, IRS and Medicare scams, crypto recovery,
    sextortion, prizes, inheritance, charity, job and check scams, domain, SEO and DMCA invoices,
    tolls. Sources: FTC, FBI IC3, SSA OIG, IRS, AARP, state attorneys general and security write-ups.
  - **school phishing galleries** (39): fourteen universities and two K-12 districts (benefits and Duo
    QR codes, work-study and research-assistant jobs, stipends, fake grants, transcripts, peer-review
    invitations, voicemail, dropped classes, a principal's hacked account).

  No real person, address, phone number, account number or bank detail is kept: payment changes are
  described in words only. Many sources show the email only as a picture or describe it; those rows
  are rebuilt from the description. Every third example is held out and only scored.
- **Genuine look-alikes in the generator** (`make-dataset.js`): leaders' short requests about real
  work, HR and payroll notices that send people to the usual portal, suppliers' invoices with unchanged
  payment details, real share notifications, IT announcing sign-in changes, school fundraisers and
  career-office listings. Since the real-world examples are all phishing, as many extra genuine emails
  are generated to keep the classes even.
- **Generator:** real-world rows can use `{title}`, `{vendor}` and `{amount}`, a `vendor` sender (a
  compromised supplier: outside, passes checks) and `qr` links (only the text asking to scan reaches the
  model).
- **A false-alarm check** (`tools/ai/eval-lookalikes.jsonl`): 24 hand-written genuine emails that
  resemble scams, never trained on. `train.py` reports them in the model card.

| Set | 0.4.0 | 0.5.0 |
|---|---|---|
| Published examples, held out (153 variants of 51 examples never trained on) | 144 caught | 152 caught |
| Genuine look-alikes called phishing (24) | 10 | 4 |
| Hand-written check set (33) | 33 right | 32 right |
| Regression cases (15) | 15 right | 15 right |

Still wrong:
- **Missed:** one variant of a fake "conference purchase report" attachment.
- **Missed, newly:** a one-line "your email will be deactivated tonight, log in now" from a look-alike
  domain (hand-written set). The extension's own checks judge its domain and link separately.
- **False alarms:** four genuine look-alikes: a payroll cut-off reminder, a DocuSign lease, a phone-system
  voicemail notice, a donation receipt.

The look-alike set was written alongside the generator's genuine kinds, by the same hand, so its score
is somewhat optimistic.

- **Unit test:** the CEO-wire email's explanation must include the wire request among its reasons, no
  longer as the very first one. In 0.5.0, "I'll send the details once you confirm" (7.06) edges out the
  wire sentence (7.04); both are business-email-compromise signs.


## 5.94.6 — EXPERIMENT (branch `llm_testing`): hardening (messages, caches, network, scanner), new weights, fuzz tests

Not for release. From a review of suggested hardening, the changes judged worth making.

- **Messages** (`background.js`): the 35-action `if` chain is now `MESSAGE_HANDLERS` (the same handler
  bodies) behind `MESSAGE_RULES`, which says for each action who may send it and caps its fields' types
  and sizes (`messageRefusal`). `from: 'page'`: the extension's own pages only (Settings, Inspector,
  popup): `aiStatus`, `followLink`, `virusTotal`, `testUnwrap`, `forceSync`, `syncPhishFeeds`,
  `testCustomThreat`, `testCustomUnshortener`, `testResolver`, `getTabState`. Before, six of them
  answered a webmail tab's content script too. `from: 'any'`: everything the webmail page uses. A refusal
  gets the action's own answer (`refuse`) and is logged once; actions not listed are left to other
  listeners (the scanner's offscreen page). The per-handler `sender.id` checks are gone (the listener
  checks it once). The review's claim that `testResolver` answered twice was wrong: it returns first.
- **Link Inspector "Follow it"** never contacts a private network (`internalHost`,
  `internalDestination`): private, loopback and link-local addresses, one-word names, internal endings
  (`.local`, `.internal`, `.lan`, `.corp`, `.home.arpa`…), and, with network checks on, names that public
  DNS doesn't know (split-horizon intranet names) or that point at private addresses. A chain that ends
  inside a private network is reported as dangerous; steps in between can't be seen before they happen
  (browsers hide redirects from extensions).
- **Saved link results** carry a fingerprint of the settings they were worked out under
  (`LINK_VERDICT_SETTINGS`, `verdictFingerprint`: resolvers, custom services, phishing lists, unshortener,
  one-time and mismatch protection) and count only under the same settings; older entries (no
  fingerprint) are checked again once. On every use the phishing lists are checked again, as the
  blocklist already was.
- **Outside services** (`fetchWithTimeout`, through which every request goes): per service (host) at most
  6 requests at once (unshorten.me 2, registries 2, country.is 2, VirusTotal 1), the others waiting within
  their own time limit. After a 429, or three 5xx in a row, the service is left alone: its Retry-After
  (at most 15 minutes) or 2 s doubling to 5 minutes, with jitter; meanwhile requests to it fail at once
  (`ServiceBusyError`). A short link waiting for unshorten.me's back-off is tried again when it ends, and
  not logged per link.
- **QR/PDF scanner**: 20 s per scan in the scanner (`SCAN_TIME_LIMIT_MS`: the drawing is cancelled, the
  document closed, the pages done so far returned with `timedOut`), and 30 s in the background
  (`SCAN_JOB_LIMIT_MS`), after which Chrome's offscreen page is closed. The scanner also checks the size
  of bytes it is handed. `tools/build.js` refuses to build unless `lib/pdf.min.mjs` and
  `lib/pdf.worker.min.mjs` match the pinned SHA-256 of pdfjs-dist 5.6.205 (`PINNED_FILES`; the bundled
  files were checked against the npm package).
- **New weights** in an opened email's verdict:
  - **High-risk requests** (`highRiskRequestSigns`, weight 1): a password, a code, approving a sign-in
    prompt, new bank or direct-deposit details, gift cards, a wire transfer, remote-access tools. Denials
    ("never share this code") don't count. Never amber on its own or with a first-time sender.
  - **Links to brand-new sites** (`linkAgeSigns`, `linkDomainAges`): the registry date (RDAP) of at most
    3 unfamiliar link domains per email (never popular, built-in or DMARC-verified ones, nor personal mail
    services; network checks on), asked after the verdict is drawn and at most 4 s per domain, then the
    verdict updates. Under 30 days with sign-in or payment wording (link or email): 3; under 30 days from
    a new sender or one without DMARC pass: 2; under 90 days with both: 2. Measured from the test machine,
    registries answered in 0.1 to 0.4 s; answers are kept 30 days.
  - **Mixed alphabets in a sender's name** (`displayNameAnomalies`, weight 2): a word mixing Latin with
    Cyrillic or Greek letters.
- **Look-alikes**: a hyphenated domain whose brand part uses look-alike letters ("pаypal-secure.net") is
  named as imitating the brand (it was only "punycode domain"); a sender name with a capital I, "1" or "|"
  for "l" ("PayPaI", "ΑppІe") is recognized as the brand.
- **Tests**: unit tests for each of the above; seeded fuzz tests (`FUZZ_SEED`, `FUZZ_ROUNDS` to vary them
  locally) for the link decoders (never throw, only http(s) or nothing, under 250 ms, at most 6 layers)
  and for messages (random, wrong-typed and oversized fields, unknown actions, other senders: refused
  with the action's own answer or handled, never a crash); e2e `test-domsink.js`: markup in sender names,
  subjects, link texts and addresses stays text, nothing runs, no handler attributes appear.

## 5.94.5 — EXPERIMENT (branch `llm_testing`): model 0.4.0, real-world phishing, hidden filler; safety claims are only a small weight

Not for release. Three spam/phishing emails the AI missed (model 0.3.0: a credit-card offer made of
pictures, 0.1%; a fake cloud-storage notice whose sender name was the reader's own mailbox name, 8%; an
IPTV offer already marked as spam by its own provider, 0.1%), and a genuine retailer survey marked amber
because its footer explains how to "confirm that this email is not a scam".

- **Safety claims are one small weight** (`selfVouchingSigns`, `shared.js`): 1 (was 3), an antivirus
  footer 0.5 (was 2). Alone, or with a first-time sender (1 + 1.5), they stay below caution (3); they add
  up only with other signs. Text that tells the reader how to check ("confirm that…", "to see if…",
  "unlike scam emails…", `VOUCH_CHECKING_RE`) isn't counted. In the AI's answer (`aiAdvice`, `ai.js`) a
  claim no longer makes a warning of its own: it is named only when the model warns. Text addressed to
  AI tools or filters is unchanged (5, red).
- **Hidden filler** (`emailLayout`, `content.js`): an empty spacer at least 1000px tall by its own inline
  size (`AI_GAP_PX`), followed by at least 200 characters of text, is filler for spam filters. It is a
  weight of 3 in the email's verdict (`layoutSigns`, `shared.js`), and the AI reads only the visible text
  before it. A body of pictures with almost no text ("images only") gives the AI its hidden preheader.
- **AI input** (`modelInputParts`, `ai.js`; old facts give exactly the old input): the reader's own
  mailbox name becomes "your name" wherever it appears (`recipient`, `maskRecipient`), so the model sees
  "your name!Apply…" or a sender named after the reader without ever seeing the name; `layout:` (images
  only, text after a large blank gap); and the header findings' kinds after the DMARC result
  (`mailChecks`, `AI_MAIL_CHECKS`: already marked as spam, home-made bulk-mail tool, broken To,
  placeholders…). `headerAnomalies` findings carry a `kind`; `HEADER_SIGNS_VERSION` 6.
- **Real-world phishing** (`tools/ai/real-world.jsonl`): 40 phishing emails that universities (Cornell,
  Toronto, Tulane, Georgetown) and the FTC published as warnings, paraphrased with placeholders for
  names, each with its source. Two thirds are trained on (12 variants each); every third one is HELD OUT
  (3 variants each) and only scored (`realworld-heldout.jsonl`, `real_world_heldout` in the metrics).
  Model 0.3.0 caught 34 of 39 held-out variants; 0.4.0 catches 39.
- Training data (`make-dataset.js`): new phishing kinds `storage` (storage full, photos deleted, payment
  failed; throwaway domains, links on cloud-storage pages) and `spamoffer` (IPTV, credit cards, loans,
  crypto, pills; free-mail senders, WhatsApp and Telegram contacts, long emoji lists, unsubscribe on
  127.0.0.1); their genuine versions `offer` (banks' card offers) and `storagenotice` (the storage
  companies' own notices); the reader's name in subjects, greetings and sender names; image-only and
  filler layouts; header findings; genuine companies' "how to check it's us" notes.
- Model 0.4.0: synthetic test 1500/1500, hand-written 33/33, real-world held out 39/39. Regression
  cases (`ai-regressions.jsonl`, 15): the three missed emails (now 99.8–99.9%), the retailer survey and
  six genuine look-alikes written for this check (a store coupon in pictures, a bank's card offer, a real
  storage-full notice, an emoji newsletter, a friend on free mail, a colleague greeting the reader by
  name; an early 0.4.0 build called three of them phishing), all genuine at 0.1–1.4%. The one-line
  "sign in today" test email, a known miss of 0.3.0 (13%), is now 99%.
- Tests: unit (claim weights and the "how to check" wording, the new AI input, `layoutSigns`, header
  finding kinds, regression cases both ways), e2e `test-ai.js` (hidden filler in the verdict; a claim is
  named only when the model warns; waits for a settled verdict before comparing).

## 5.94.4 — EXPERIMENT (branch `llm_testing`): model 0.3.0, after three false alarms

Not for release. Three genuine emails reported as flagged by the AI (model 0.2.0): a deal-site
newsletter (90%), a security vendor's sales thread (97% on its quoted part), and an automated district
reimbursement statement with a PDF (over 99%; the PDF itself was clean: no links, scripts or forms, and
the extension's attachment check didn't flag it). The model had never seen genuine mail like them.

- Training data (`tools/ai/make-dataset.js`): new genuine kinds `deals` (big brands as products, huge
  discounts, coupon fine print, click-tracking links), `thread` (vendors and colleagues scheduling, with
  signatures, titles, disclaimers, public-records notes and quoted messages, including salespeople and IT
  staff describing scams), `statement` (automated one-line statements and notices through internal
  groups or agencies); broader `receipt` and `shipping` wording; a third of the sign-in phishing on
  ordinary-looking domains.
- Model input (`ai.js`): the sender's place, "(your organization)" or "(outside your organization)", when
  the account has its own domain (8% of the training phishing comes from inside, as from a compromised
  account); `[EXTERNAL]`-style tags removed from the subject (`stripExternalTag`). In the webmail, the
  quoted earlier messages are left out of the text (`ownText`).
- Model 0.3.0: 1,500/1,500 synthetic, 33/33 hand-written (optimistic, see the model card), the five
  regression cases at 0.1%. Known miss: a one-line "sign in at … today" email at about 13%.
- `tests/fixtures/ai-regressions.jsonl`: the reported emails, paraphrased without personal data; a unit
  test keeps them genuine.

## 5.94.3 — EXPERIMENT (branch `llm_testing`): AI analysis on by default, automatic on opened emails

Not for release.

- `enableAiAnalysis` is now on by default, and new `aiAutoAnalyze` (policy `managedAiAutoAnalyze`), also
  on by default, analyzes each opened email as it opens, with no click. Off: the **Ask the AI** button as
  before. Both in Settings → AI analysis.
- The automatic run waits for the email's own verdict (`whenVerdictReady`, at most 3 s), so the model is
  given it. A result with nothing suspicious is one short line ("S.P.R.U.C.E+'s AI found no strong signs
  of phishing (3%). Why?"), so emails aren't crowded; **Why?** opens the full answer. Caution and danger
  show the full box. Automatic runs are logged only when they warn.
- Unchanged: advisory only (never clears a warning, marks anything safe or moves email), on this computer
  only, addresses and numbers redacted.
- Tests: `test-ai.js` covers automatic (default), click-only and off.

## 5.94.2 — EXPERIMENT (branch `llm_testing`): weights for outside and first-time senders

Not for release.

- Two small weights in each email's verdict (inbox rows and opened emails), defined together in
  `SENDER_CONTEXT_WEIGHTS` (`shared.js`), so they are easy to tune: **outside the organization** (1),
  when the account has its own domain (not gmail.com and the like) and the sender's domain isn't it or a
  subdomain; **first email from the address** (1.5), not for senders in the own organization. Together
  2.5, below caution (3): they never make an email amber on their own, but tip other signs over (a
  safety claim, 3, from a new outside sender is flagged; an antivirus footer, 2, becomes caution). Their
  texts appear in the sender's label. Trusted senders get neither.
- First-time: the background remembers when each sender address was first seen, as a 64-bit hash
  (`senderHistoryKey`; `seenSenders`, at most 20,000, a year each), asked through the `senderHistory`
  message with hashes only. An address is first-time for `FIRST_SEEN_WINDOW_MS` (a day) after it is
  first seen, and nobody is first-time during the first 14 days (`SENDER_HISTORY_LEARNING_MS`, from
  `seenSendersSince`), when every sender would look new. Clear sender data forgets the history and
  starts learning again.
- Setting `weighSenderHistory` (policy `managedWeighSenderHistory`), on by default, in Settings →
  Senders. Not given to the AI model yet (its input would change, so it would need retraining with
  invented rates for how often phishing comes from new senders).
- The history's storage keys are data, not settings (`NON_CONFIG_KEYS`): otherwise each write would
  count as a settings change and clear the remembered sender checks.
- Tests: `tests/e2e/test-newsenders.js` and unit tests.

## 5.94.1 — EXPERIMENT (branch `llm_testing`): the extension's own AI model; self-vouching text counts toward phishing

Not for release: an experiment on its own branch.

- **Our own model, inside the extension** (`ai.js`, `models/phish-tiny/`): a BERT-tiny classifier
  (4.4 million parameters, 4.5 MB with 8-bit weights) fine-tuned by `tools/ai/train.py` on emails from
  `tools/ai/make-dataset.js` (synthetic, made-up people and organizations; your own de-identified
  examples can be added in `tools/ai/data/extra/`). It runs in plain JavaScript (WordPiece tokenizer and
  BERT forward pass, no WebAssembly) in the service worker or background page, 50–300 ms per email; a
  unit test checks it gives PyTorch's own token ids and scores (`tests/fixtures/ai-vectors.json`), and
  that it stays at 90% or better on the hand-written emails (`tools/ai/eval-handwritten.jsonl`).
- **Ask the AI** (setting `enableAiAnalysis`, policy `managedEnableAiAnalysis`, off by default): a
  button in opened emails. Only on click, the facts the extension already has (subject, sender name and
  domain, DMARC result, links with their findings) and the text, with addresses reduced to their domain
  and numbers hidden (`redactForAi`), go to the model (`aiAnalyze` message). It shows how likely the
  email is phishing and which sentences, on their own, read most like phishing (`analyze`). Advisory
  only (`aiAdvice`): never "safe", never clears a warning or moves email; if the extension's own checks
  warn, it says to trust them. Settings → AI analysis: on/off, model status and scores, and **Try it**
  for a pasted email.
- **Text that vouches for itself** (`selfVouchingSigns`, `shared.js`), in every opened email's own
  verdict: text addressed to AI tools or filters, weight 5 (flagged); a safety claim to the reader
  ("verified safe by Microsoft", "this is not a scam", "safe to click"), weight 3 (caution; flagged with
  any other sign); antivirus or gateway footers ("Virus-free", "scanned by …"), weight 2. Read from the
  message's `textContent`, so hidden text counts. "Add us to your safe senders list" and the like don't.
- Model scores (`models/phish-tiny/MODEL_CARD.md`): 100% on 1,500 synthetic test emails and 33/33 on the
  hand-written ones, the latter optimistic because the generator was improved after looking at that
  set's mistakes. Known miss: a one-line "sign in at … today" email scores about 32%.
- Tests: `tests/e2e/test-ai.js` (the real model in Chromium; button off by default, answers only on
  click, never changes the verdict; Try it; safety claims and AI-directed text) and unit tests.

## 5.94 — Link Inspector: follow a SendGrid link to reveal it; open pixels explained

SendGrid's current click links can't be decoded (two samples checked: the `upn` value, with or without
the `u001.` label, is encrypted, random bytes and no address). unshorten.me refuses them too, because they
are longer than its 100-character limit.

- **Follow it to reveal the destination** (Link Inspector, message `followLink`, accepted only from the
  extension's pages): for a tracking or short link whose destination is still unknown (`revealable`),
  one request that follows the redirects like a click: `HEAD`, `credentials: 'omit'`, no referrer, no
  cache, 10 s. It reports `res.url` and offers to inspect it. A server that refuses `HEAD` (405/501)
  without redirecting gets one `GET`, whose body is cancelled. The click asks for the optional access to
  websites (`https://*/*`, already declared optional, so no new warning on update) inside the click
  itself, as Firefox requires. The panel says it counts as a click with the sender's tracker and warns
  against following unsubscribe, sign-in or confirmation links. Only https links; never pixels. Only the
  sites are logged.
- **Open-tracking pixels** (`openPixelRule`: SendGrid `/wf/open` and the others) are explained by
  `describeOpaqueLink` as invisible images that report an open and lead nowhere, and no Follow button is
  offered.
- A SendGrid click link that doesn't decode is described as encrypted whether or not its `upn` carries
  the `u001.` label.

## 5.93 — A settlement administrator naming a brand is amber, not red

A genuine class-action notice ("Amazon Return Policy Litigation Settlement Administrator"
<donotreply@returnsettlement.com>, DMARC pass, sent through Amazon SES) was red and could be moved to
Spam: the sender's name contains "Amazon", and returnsettlement.com isn't Amazon's. The name check
(`nameAddressSigns`, weight 5, and `evaluateSender`, danger) couldn't tell a company impersonated from a
company *written about*.

- New `nameSpeaksAboutBrand` (`shared.js`): a name with legal-proceeding words (settlement, litigation,
  class action, lawsuit, legal notice, claims administrator, court-appointed, "in re", "v."/"vs.") is a
  third party writing about the brand. It gets caution (weight 3 / severity caution, never moved to
  Spam) with its own explanation, which also warns that fake settlement notices exist. Every other
  brand-name check is unchanged: "Amazon Support", "Microsoft Administrator" or "Amazon.com" on another
  domain stay red.
- Test fixture `tests/fixtures/settlement.eml`, modelled on the reported email with the recipient,
  names, notice and confirmation codes replaced by test values. The whole email (name, headers, subject,
  body) scores below the flag level.

## 5.92 — Link Inspector: why a link may be malicious; iContact and SendGrid decoders

The Link Inspector used to stop at "Flagged: Malware or Phishing (…)", naming only the first service
that flagged the site. That left people unable to judge a false positive, such as a long-established
site flagged by one service while every other service found nothing. It now explains the verdict:

- **What the security services say** (`threatConsensus`, `shared.js`): how many independent services
  flag the site. Two or more flags mean danger. A single flag among several clean answers is described as a
  possible false positive or very new detection, naming the service to report it to. A flag from
  Cloudflare Family alone is a content filter, not a security finding. The blocklist decides on its own
  and is not counted as a service. Each service is counted once (worst answer) when both the link's own
  host and the destination were checked.
- **Who checked it:** `runDomainSafety` now records every service's own answer (`services`: flagged,
  clean or no answer) next to the verdict it already returned. The verdict itself is unchanged. The
  Inspector asks afresh (`opts.fresh` skips the 6-hour cache) and lists the blocklist, each phishing list
  and each DNS service for the destination and, when different, the link's own host, with what a flag from
  that service means (`THREAT_SERVICE_INFO`). A blocklisted host is not sent to the DNS services, as in
  Gmail.
- **Red flags in the link** (`linkRedFlags`, `shared.js`, offline and pure): danger, caution or info,
  each with a plain explanation. Danger: hidden "user@" prefix, bare IP address, look-alike brand,
  a brand's name in front of another domain (paypal.com.example.test), code-running schemes, programs
  and scripts, real sign-in pages used as springboards, pre-targeted cloud-storage pages. Caution:
  punycode, free page/form/tunnel services, public cloud storage, a domain ending mid-address, very long
  names, typo endings, unusual ports, archives, macro documents, sign-in/verify/billing words off a known
  brand's domain, an email address (plain or base64) in the link, bounces through a trusted site's
  redirect, three or more wrapping layers. Info: endings often used for abuse, plain http. They reuse the
  existing `lookalikeOf`, `signInRedirectProblem`, `cloudStoragePage` and `riskyScheme`.
- **Get a second opinion:** links to VirusTotal, urlscan.io, Google Safe Browsing and Sucuri SiteCheck
  with the site name only (never the full link, which may carry personal tokens). They open only when
  clicked.
- **VirusTotal (optional):** new setting `virusTotalApiKey` (secret, never in backups; policy
  `managedVirusTotalApiKey`), in Settings → Your own services. Saving it asks the browser for access to
  www.virustotal.com only (optional host permission, so no new permission warning on update). The
  **Look up on VirusTotal** button (message `virusTotal`, accepted only from the extension's own pages so
  a webmail page can't spend the key) shows the existing report for the link: vendor counts, the vendors
  that flag it with their verdicts, categories, reputation and the address VirusTotal followed it to. If
  VirusTotal has never seen the link, it shows the site's report and offers **Scan this link** (after a
  confirmation that the link is shared with VirusTotal's community). It then polls 3 times, 20 s apart,
  within the free key's 4 requests a minute. A one-time link is never sent: only its site is looked up.
- **Decoders** (`decoders.js`): iContact click tracking (`click-<account>.icptrack.com/icp/relay.php`,
  its `destination` parameter). SendGrid click tracking (`/ls/click` and `/wf/click?upn=` on
  `sendgrid.net` or a SendGrid-branded domain): the older format, base64 in SendGrid's own `-2F`/`-3D`
  escaping, is decoded when it yields one clean web address. The current `u001.` format is encrypted
  and is never guessed at; `describeOpaqueLink` explains this and points to VirusTotal. Redirector-shaped
  hosts now also match with a hyphenated number (`click-175967.`).
- **Fixes:** a flagged destination's badge read "Not verified: inconclusive" instead of "Flagged: …".
  The button read "Inspect & Decode" after the first run instead of "Inspect link".
- Tests: `tests/e2e/test-inspector.js` (stubbed services: one service flags, the rest clean; red flags;
  second-opinion links carry the site only; VirusTotal only on click, key sent only to VirusTotal) and unit
  tests for the decoders, red flags, consensus and the VirusTotal message rules.

## 5.91 — Help for organizations: deploying the published extension

S.P.R.U.C.E+ is now in the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons, and Settings →
Help → **Deploying in organizations** explains how to deploy that published extension, instead of how
to publish or host a copy of your own:

- **Chrome and Edge:** step 1 is a table of the two stores, with each listing, its extension ID
  (`ennpekfncgndmiffefhbkpdnjnnnhcpc` in the Chrome Web Store, `ailfmflfcombomabeallgefjkkejjijh` in
  Microsoft Edge Add-ons) and the update address for install policies. The Google Workspace and Intune
  steps use those IDs, and say which ID the registry script must carry for Edge and for Chrome. The
  self-hosting option is gone.
- **Firefox:** step 1 links the Firefox Add-ons listing, with the add-on's ID and the address of its
  latest version, instead of publishing it on addons.mozilla.org or hosting a signed `.xpi`.
- **Safari:** it isn't in Apple's App Store yet, and the section says so before explaining how to
  build it yourself.

## 5.90 — A company's own links are no longer called dangerous

A genuine American Express email was marked dangerous: its link text showed americanexpress.com, and the
link went to go.amex. `.amex` is American Express's own ending, which nobody else can register, and Gmail
had verified that the email came from American Express. The same kind of mistake hit other companies'
second domains, and in the other direction any domain with PayPal's, Google's or Amazon's name was trusted
by its name alone. Five changes, each on its own switch (`COMPANY_MATCHING` in `shared.js`, see below):

- **[5.90-1] One table of company domains for links and senders.** The link check now knows every domain
  the sender check lists for a company: text bankofamerica.com with a link to bofa.com, docusign.com to
  docusign.net, ups.com to upsemail.com or intuit.com to quickbooks.com is no longer marked (54 such pairs
  were, 26 of them red). No domains were added.
- **[5.90-2] A company's own ending.** Some internet endings may be used by one company only (ICANN's
  "brand" endings, 366 of them: `.amex`, `.google`, `.chase`…). Which they are comes from ICANN's own list
  of endings, downloaded once a month with the other lists (Update lists on); until the first download,
  the copy bundled with the extension (`company-endings.json`, made from the same list by
  `tools/refresh-snapshot.js`). Nothing about them is written by hand, and endings a company runs for the
  public (Google's `.app`, `.dev` or `.gle`) aren't on it. An address under such an ending counts as the
  company's when the other side is a domain known to be a company's whose name is one of that company's
  endings: americanexpress.com and go.amex (`.amex` and `.americanexpress` have the same registry),
  google.com and blog.google, bofa.com and any `.bofa` address. A domain that merely carries the name
  (chase.*anything*) doesn't count. A link to such an ending that can't be tied to the text's company is
  amber at most, never red: no one else can have an address there.
- **[5.90-3] The verified sender's own links (Gmail).** Link text showing a well-known brand's site while
  going elsewhere is red. When Gmail's DMARC check passed for that same company, and the link isn't in a
  quoted or forwarded part, it becomes amber: the sender chose where its own link goes. Without the
  verification it stays red. An opened email whose verdict no longer moves it (a red link turned amber)
  is no longer moved to Spam by a move queued a moment earlier.
- **[5.90-4] A company's name under another ending needs evidence.** Until now amazon.*anything*,
  google.*anything* and paypal.*anything* counted as the company's: text paypal.com with a link to a
  domain someone registered as paypal.*something* wasn't marked, and a sender named "PayPal" there even
  got "Sender passed PayPal's sender authentication". Now such a domain is the company's only when
  public records show it: it is on both popular-site lists the look-alike check already downloads and
  enforces sender verification (every Amazon store, Google's country sites), or the brand-ownership
  check proves it (PayPal's country sites, by their name servers). Until then the link, or a sender
  named for the company at that domain, is amber, never red and never moved to Spam; a domain like that
  failing its sender verification is still red. Lookups: the domain's DMARC record and, when needed,
  the brand-ownership records, at most once a month per domain (see the privacy policy).
- **[5.90-5] Offline only uses what is already stored.** Every lookup is remembered (who owns a domain:
  30 days, an unknown answer 1 day; a domain's DMARC policy: 7 days; the popular-site lists: until the
  next monthly download). Until now Offline only ignored those answers; now it uses them and asks
  nothing new, so a domain shown to be a company's before switching to Offline only stays so (a link to
  amazon.de, a sender's brand name on its second domain), instead of turning amber or red.

**Also fixed:** while an opened email had no warning about its sender, its banner was redrawn every
150 ms for as long as the email stayed open (nothing visible changed; it only cost processor time). It
is now redrawn only when something changes; a banner still to be drawn counts as work in progress, so a
test of any opened email would catch such a loop.

**Rolling one back:** in `shared.js`, set its switch in `COMPANY_MATCHING` to `false` (`oneTable`,
`ownEndings`, `verifiedSender`, `nameNeedsProof`, `storedOffline`) and rebuild; that change then works as
in 5.89 and the others keep working. Every line a change touches carries its tag (`[5.90-1]` …
`[5.90-5]`), and a test checks that with all of them switched off every answer is 5.89's. Details: `docs/ARCHITECTURE.md`,
"Text and destination of the same company".

## 5.89 — One set of files for every browser

**No change in what the extension does** in Chrome, Edge or Firefox: this version changes how every
browser's version is made. Until now Chrome and Edge, Firefox and Safari each had a branch of their own,
changed by hand after every release; the copies drifted apart, and a fix could reach one browser weeks
after another. Now the same files make all three:

- **`node tools/build.js` builds every browser's package** — the Chrome and Edge zips, the Firefox zip
  for addons.mozilla.org and the Safari package for Apple's converter (`tools/build-safari.sh` on a Mac).
  The Firefox and Safari manifests are made from the Chrome one, so a permission or webmail site added
  for one browser is added for all; a test checks every generated manifest.
- **The code tells the browsers apart where it must:** Chrome's background is a service worker and its
  QR scanner an offscreen document; in Firefox and Safari both run in a background page. Settings → Help
  shows each browser its own deployment steps (Google Workspace and Intune for Chrome and Edge;
  `policies.json`, Group Policy and macOS profiles for Firefox; app deployment for Safari).
- **One set of documents:** the admin guide, install guide and feature list cover every browser, with
  Firefox's policy example in `docs/policy-example-firefox.json`.
- **Small improvements reach every browser,** from whichever branch had them: link markers and the Link
  Inspector are built without any HTML parsing (as addons.mozilla.org requires), conflict detection
  recognizes Safari's extension addresses, and pdf.js gets the stream shim Safari needed. Safari gets
  all of 5.88's fixes.
- **Tests:** GitHub runs the Firefox suite on every push, in the current ESR and 140 ESR, on the Firefox
  package the build makes; the Safari app is built on a GitHub Mac for every release.
- The `firefox` and `safari` branches keep their history; nothing new goes to them.

## 5.88 — Firefox: every feature checked in Firefox itself, and four fixed

A review of the Firefox build in real Firefox (the current ESR and 140 ESR, the oldest version it
supports). Nearly everything already worked there — the spam mover, sender labels, opened-email checks,
QR codes in images and PDFs, enterprise policy — and these changes fix what didn't. In Chrome nothing
behaves differently, except the new notice in the toolbar button when site access is switched off.

- **Messages shown in frames are checked in Firefox before version 148.** Proton Mail, iCloud, Zoho and
  GMX show each message in a frame. To know which webmail a frame belongs to, the extension asked the
  browser for the page that made it (`location.ancestorOrigins`), which Firefox only has from version 148;
  before that, the extension's script in the frame marked the frame as its own and then did nothing,
  so the page skipped it too and the message wasn't checked at all. The frame now also learns its webmail
  from its own origin, its parent's address or (for a sandboxed frame) its base address, and marks itself
  only once it knows; a frame that can't tell is read by the page instead.
- **"Check installed extensions" works in Firefox.** Firefox accepts a permission request only directly
  inside the click, and the button checked something else first, so Firefox refused without showing the
  question and the button said your browser didn't give permission. It now asks at once. It also finds
  the Firefox versions of the extensions that do the same job (Simplify Gmail, Sender Icons for Gmail,
  Row Highlighter), and when the add-on was installed by your organization's policy — the only case
  Firefox allows it — it can turn them off with one click.
- **Site access switched off is noticed.** Browsers let you switch an extension's access to a site off
  (Firefox's extensions panel, Chrome's *Site access*); the extension then did nothing in that webmail
  with no sign why. The toolbar button now says the extension isn't allowed there, with a button that
  allows it again and reloads the tab.
- **No more errors in the webmail's console in Firefox.** Reading an email's headers when Gmail answered
  with an error was handled, but Firefox still reported it as an uncaught error in Gmail's console.
- **Tests:** a Firefox suite (`tests/firefox/`) runs the Firefox build in real Firefox on the simulated
  webmail pages, and a new browser suite checks every kind of message frame in Chrome.

## 5.87 — A line-by-line review: twelve fixes, and faster where it counts

- **Phishing-simulation rules with sending addresses now work.** A rule with `ips` (managedPhishSimulationRules) never matched, because the check never learned which server delivered the email — so a training email covered by such a rule was checked, flagged and even moved like any other mail, and looking up its links could register a "click" with the vendor. The delivering server is now read from the webmail's own Received header, as the admin guide always described.
- **The once-a-day list download works again.** The time of the last download was stored as words, so the daily limit never applied and every update request downloaded the lists anew. Downloads now happen at most once a day whoever asks — Settings → **Update now** inside that day answers "already up to date" with when the next download is due (its purpose is recovering from a missed daily update, not re-downloading fresh lists).
- **A link's path can no longer vouch for its destination (Amazon SES).** The SES fast-path decoder believed the destination written in the `/L0/…` path on **any** host, so a crafted link on an attacker's own domain could be shown — and judged — as going to a trustworthy site. The path is now believed only on Amazon's own awstrack.me for one-time links, and otherwise only on hosts shaped like or listed as redirectors, like every other generic decoder; the link's own host is still checked alongside the destination, as before.
- **Shared name-server pools no longer prove a domain is a brand's.** DNS providers such as Cloudflare and NS1 assign their name-server names from a small pool shared by unrelated customers, so an imitator can end up with the same ones as the brand. Matching them now only counts as a hint (amber at most, with a corporate registrar), never as proof. Name servers under the brand's own domain, or an identical set of the brand's own servers, still prove it.
- **Trusted senders are never shown as flagged.** Strong forgery signs in one email could paint a trusted sender red (it was never moved, but the promise is "never flagged"). Trusted stays trusted; what was found still appears in the sender's explanation.
- **A move from an open conversation is confirmed by the inbox, not by leaving the page.** Going back to the inbox during the confirmation window used to count as "moved" even when Gmail had ignored the Report-spam click — the email was logged as moved, stayed in the inbox, and was never tried again. Now the conversation's row must be gone from the list as well; otherwise the move is logged as **failed**, saying the row was still there.
- **Hardening,** from the same review: one malformed cache entry can no longer blank the Logging → URL cache table; a race that could fail one QR scan when the scanner was closing is gone; the webmail's own tooltip and accessibility attributes on a sender's address are put back when the extension's marks come off; an image sized in percent ("width: 1%") is no longer mistaken for a 1-pixel tracker; the allow/block lists store exactly the domain the checks compare — a pasted address becomes its domain, junk is refused with a message, and an old junk entry is marked **not a domain — no effect**; the Help architecture's messages table matches the code again.
- **Faster where it counts:** typing in a Logging search box now redraws the table once when you pause, instead of on every keystroke (the URL-cache view used to re-read all stored data per keystroke); each sender check runs its threat lookup and look-alike check side by side instead of one after the other; the tracking-pixel lists are built once instead of on every page scan; and settings load both storage areas at once on every service-worker start.

## 5.86 — A brand's name on an unknown address is double-checked before it counts

- **Fixed a false positive: genuine mail from a brand's second domain was moved to Spam.** "Amazon Music" <no-reply@amazonmusic.com> was flagged (and moved) because amazonmusic.com isn't amazon.com, although it is Amazon's. Companies send from more domains than their main one, so a brand's name on a domain not known as the brand's is now checked once more before it counts, from public records only: the brand's and the domain's DMARC records, their name servers, and the domain's registry and registrar record (who registered it, through whom, when). Records only the brand could have made prove the domain is the brand's: the brand's own DNS sending its DMARC reports to the domain (facebook.com → facebookmail.com) or publishing the authorization for the domain's reports, name servers under the brand's domain or shared with it where that means one customer, or a corporate brand-protection registrar (MarkMonitor, CSC…) together with a registrant naming the brand ("Amazon Technologies, Inc."). Such a domain isn't flagged, and the reason says why. A corporate registrar plus one more link to the brand (reports sent to it, a registrant naming it, or a year of age) makes the email **amber, never moved**. Anything less, or Offline only, is red as before: a forger's domain gains nothing, because the proofs need the brand's DNS or a registrar it can't use.
- **The same proof clears look-alike patterns** (a brand's name plus a word like "billing" in a domain) when the domain is shown to be the brand's own.
- **Known second domains added**, for Offline only too: amazonmusic.com (Amazon), spotifymail.com (Spotify), att-mail.com (AT&T), upsemail.com (UPS), each checked against its public registrant record.
- **What leaves the device:** only the domain name, to the DNS resolvers already used for the threat checks and to the domain's registry and registrar (public RDAP records), once a month per domain, and only after a possible imitation was found. Help → Privacy, PRIVACY.md and the admin guide say so.

## 5.85 — Every log says which account; a rescue updates its own line

- **Several accounts signed in? Every log now says which one.** Each entry records the account it happened in: a new **Account** column in Logging → Moved to Spam, a line under the time in History and under the source in the application log, **Seen in** on Logging → Senders, and the address after the time in the toolbar popup's recent activity. Searching any log for an address shows only that account's entries, and the CSV exports gain an Account column. The account is the address Gmail shows in its page title (other webmail is named by its site). It stays in this browser with the logs and is never sent anywhere. Entries from earlier versions have no account.
- **Taking an email back out of Spam no longer adds a second line.** The email's own "Moved to Spam" line in Logging → Moved to Spam is marked **Taken out of Spam by you**, with the date and time, so each email keeps one line with its whole story. Only an email with no move on record (Gmail or you put it in Spam, or the list was cleared) gets a line of its own. A **Keep it** on a row about to move is now listed as **Kept in the inbox by you**.

## 5.84 — Flagged emails leave the inbox sooner, say so while they wait, and can't be clicked

- **Moving to Spam no longer waits out every mouse movement.** Moving used to wait until 10 seconds after *any* activity — including the mouse merely moving over the list — so reading your inbox with the mouse resting on it could hold flagged emails back indefinitely. The 10-second wait now applies only to a click or a key (so a move never replaces the Undo of something you just did); after the mouse last moved or the list scrolled, moving waits just 2 seconds, so flagged emails leave about 2 seconds after your pointer rests.
- **A move held up by the page no longer waits up to 30 seconds to try again.** Waiting on something the user changes (another view, an open conversation, a selection, a hidden tab) used to retry on a delay that doubled up to 30 seconds and only reset after a successful move — returning to the inbox could leave flagged emails sitting for half a minute plus the quiet period, which looked like the extension had stopped until the page was reloaded. Parked moves now take a cheap look every 3 seconds, and the moment the view or tab changes back. The backing off (and the 15-second-to-10-minute pause) now applies only to its real case: Gmail ignoring the Report spam click.
- **An email waiting to move says so, and can't be clicked by accident.** Its row is struck through, tinted, and carries a banner: *Moving to Spam…*, with why it's waiting when it is (for example until a pause in your activity). Real clicks anywhere on the row are ignored — the banner flashes instead — so the email can't be opened, and a row about to disappear can't take a click meant for it. The extension's own clicks (ticking the box, Report spam) still work, and a row Gmail redraws for another conversation is freed at once, checked against the live queue on every click and every pass. Only clicks are guarded: Gmail's keyboard shortcuts (j/k, Enter) can still open the email — opened, it keeps its red warning banner, and it is still moved.
- **Move now and Keep it.** The banner's **Move now** moves that email immediately — the click is your own request, so no quiet period applies to it (everything else still waits its turn). **Keep it** leaves the email in the inbox for good, remembered exactly like one you took out of Spam, and logged as a rescue.
- **The toolbar popup counts the emails waiting to move** and says why (moving when you pause, waiting for your selection, retrying…), so a queued move is never a mystery.

## 5.83 — One place for the downloaded lists, and their safeguards side by side

- **No more repeated list information in the Architecture deep dive.** "Downloaded lists" is now the one table of lists: for each, what it's used for, how often it's downloaded, its license or terms, the entries in use, the new entries on hold and the last update. "This installation right now" no longer repeats some of the lists in a second table.
- **Safeguards for every list, side by side**, instead of the short-link lists' rules alone: what a wrong entry could do, size limits, entry format, what's never accepted, what happens to a broken download, holding new entries back, the mass-change guard, removals. Only the short-link lists hold new entries back and guard against mass changes, since a wrong entry there would send links to a lookup service; the table says why the phishing lists (they change almost completely every day, and phishing sites are often gone within hours) and the popular-site lists (downloaded monthly) don't. The architecture guide has the same table.

## 5.82 — Every downloaded list shown and credited

- **The Architecture deep dive lists all seven downloaded lists**, not only the two short-link lists: the two short-link lists, the OpenPhish and Phishing Army phishing lists, the Sefinek scam-sender list, and the Chrome UX Report and Tranco popular-site lists used by the look-alike check. For each: what it's used for, how often it's downloaded, its license or terms, and its state on this computer. The section is now called "Downloaded lists"; the short-link update rules follow it. The architecture guide (`docs/ARCHITECTURE.md`) has the same table.
- **About & credits now credits every list and online service**: added the Sefinek scam-sender list (MIT), the Chrome UX Report top sites (data by Google, CC BY 4.0, from Zakir Durumeric's copy) and Tranco (KU Leuven and others), and the services used for sender details (Google's and DuckDuckGo's icon services, country.is, IANA's registry directory). A test checks that each is named.

## 5.81 — Readable drop-down menus in the dark appearance

- **Fixed: the appearance menu (System / Light / Dark) in the toolbar popup was unreadable in the dark appearance**, as were the other drop-down menus in Settings: the menus were see-through, and Firefox draws the open list from the menu's own colors, so the options showed light grey on white. Every drop-down menu now uses the appearance's own background and text (light text on the dark surface, 11.9:1 contrast), and a test checks it.

## 5.80 — Tests that wait for "done" instead of guessing

- **The page now says when the extension is done.** The inbox page carries `data-unshortener-busy` (how many checks are still running: answers awaited from the background, emails' source or attachments being read, a scan waiting, moves queued or running; 0 when everything on screen is checked and decided) and `data-unshortener-spam-wait` (why queued moves to Spam are waiting: a selection, recent activity, the view…). The toolbar popup marks `data-loaded` once its settings are applied. Nothing changes in what the extension does; they're there for the tests and for troubleshooting a move that seems stuck.
- **The browser tests no longer guess how long anything takes.** Every fixed pause is gone: a test waits for what it checks, or, to check that something did *not* happen (nothing moved, no warning), for the page to report it's done. A page that never finishes fails the test with what was still pending, and the test runner refuses a new fixed pause. The tests pass the same on a slow computer as on a fast one (three full runs on an overloaded computer, all passing), which is what made GitHub's checks fail now and then.

## 5.79 — Icons that fill their circles; company logos not lost to a slow DNS answer

- **Site icons fill their circles.** Many sites' icons carry their own empty margins (Google's "G", Firefox's logo), so they looked small next to company logos. Each icon is now measured and drawn as large as fits: a round logo fills the circle, a square one the largest square that fits, and a solid square icon fills it edge to edge, like a logo.
- **Fixed: a company logo could go missing for a week.** When a DNS service couldn't get an answer in time it still replies, with an error status and no records; the extension read that as "this company has no logo" (or "no DMARC policy", which hides logos too) and remembered it for a week. Only a definite answer counts now; a failed one is tried with the second DNS service, then asked again next time. A definite "no logo" is now remembered for a day instead of a week.
- Settings → Logging → Senders shows each sender's company logo (BIMI) when there is one, and when it was last found to have none.

## 5.78 — Administrator documentation

- **Every administrator-only policy has its own clear entry** in the README and Help: hiding the popup's Settings button (`managedHidePopupSettingsButton`, a convenience, not a lock: Settings stay reachable by address, and locked settings can't be changed there), hiding recent activity (`managedHideRecentActivity`), hiding the Donate button in Help → About (`managedHideDonateButton`), and the phishing-simulation rules. The organization lists (`managedTrustedSenders`, `managedAllowlist`, `managedBlocklist`) are described too, and the README now points to the admin guide for the full list of keys instead of listing some of them.
- **Fixed: Help showed the test version's extension ID** in the Settings address; it now shows this installation's own ID (a store install has a different one). The admin guide explains where to find it.
- The policy example now lists every key, including the request body, headers and reply field of your own threat-check and short-link services.
- **A short README; the full documentation is in `docs/`.** The README now says what the extension is, in a few lines, and links the documents: `docs/FEATURES.md` (every feature, the toolbar button, Settings, Link Inspector, Logging, Help, and which webmail supports what), the admin guide (now with a contents list and its own section for the organization lists), the privacy policy, the architecture and development guides, and `docs/README.md`, an index of the folder.

## 5.77 — A helper, not a guarantee

- **Wording that promises nothing.** S.P.R.U.C.E+ is a best-effort helper and one small layer of protection, and the text now says so: Help (How it works, About), the README, the privacy policy, the store listing and images and the architecture guide carry a short note that it can miss dangerous emails and flag genuine ones, and doesn't replace the webmail's and the organization's own email security or the reader's judgment.
- Phrases that sounded like a promise are gone: the description is now "Helps you spot phishing and scams…", the Settings status reads "Checks are on" (not "Protection is on"), the Standard privacy level offers "the most checks" (not "full protection"), and Help no longer calls links that pass the checks "safe".

## 5.76 — Donate button

- **A small Donate button** in Settings → Help → About, opening the project's PayPal donation page. Organizations can hide it with the administrator-only policy `managedHideDonateButton`.
- The README has a Donate badge and the donation QR code.

## 5.75 — First public release

- **First public release** of S.P.R.U.C.E+, and its first publication in the Chrome Web Store.
- The logo (`branding/logo.png`, `logo.svg`) has a transparent background, with a light-lettered version for dark backgrounds (`logo-dark-background`); the README shows the one that suits the reader's theme.

## 5.74 — Store listing material; two fixes found while making it

- **Fixed: an opened email was amber where the inbox showed it red.** A sender using a brand's name on another address ("PayPal Service" from an address that isn't PayPal's) was red in the inbox list but only "be careful" once opened, because the opened email's verdict didn't count the name. It now counts the same signs as the list (a brand's name, or a colleague's, on another address), and the warning appears once, in the verdict.
- **New: your organization's name plus a word like "support"** on a domain that isn't yours (lincolnschools-support.org, for lincolnschools.org) is flagged red as a look-alike, as a well-known brand's name with such a word already was: the classic "IT Help Desk: your password expires" phish. Your organization's name with an ordinary word (a foundation's domain) isn't.
- **Privacy policy** ([PRIVACY.md](PRIVACY.md)), **store listing text** with a reason for each permission ([store/STORE-LISTING.md](store/STORE-LISTING.md)), and **store images** (four 1280×800 screenshots and a 440×280 promo tile, in `store`), made from the real extension on a made-up inbox.

## 5.73 — New home: SPRUCE-Browser-Extension

- The project moved to its own repository, [github.com/thecodewarrior2/SPRUCE-Browser-Extension](https://github.com/thecodewarrior2/SPRUCE-Browser-Extension), with the Chrome build on `main` and the Firefox and Safari builds on the `firefox` and `safari` branches. Settings → About links there. Nothing else changes.

## 5.72 — Ready for the Chrome Web Store

- **Shorter description** (111 characters): the Chrome Web Store refuses one over 132, and Safari shows at most 112.
- **New: `tools/build-webstore.sh`** builds the zip to upload to the Chrome Web Store or Edge Add-ons: the release files without the manifest's `key`, which the stores refuse on a new item's first upload. The key stays in the project, so the test version keeps its ID.
- The private signing key (`*.pem`) and built packages are now left out of the project by `.gitignore`.

## 5.71 — Name and icon: S.P.R.U.C.E+

- **Name: S.P.R.U.C.E+** (Spam & Phishing Risk URL Checker Extension+), with its icon: a shield with a magnifying glass. The toolbar icon, the Settings page, the popup and the extension's notices use them; while the extension isn't checking an email, the toolbar shows the same icon in gray.
- Logos and icons for documents and announcements (PNG and SVG, for light and dark backgrounds) are in the `branding` folder of the project.

## 5.70 — "Call this number" scams caught; OneDrive no longer flagged

- **New: Catch "call this number" scams** (on by default; policy `managedEnableCallbackScamCheck`). A fake receipt ("Your order of Windows Defender for (555.68 USD) was successfully purchased. If this purchase was not made by you, please contact Microsoft Customer Support Immediately at…") wasn't flagged in Outlook, because Microsoft's own system really sent it: attackers had typed the text into a name that Microsoft's verification email repeats, so it passed every sender check. Now a subject with a phone number to call about a purchase or charge you didn't make is flagged red from the inbox list (Gmail) and moved to Spam, whoever sent it. A number with only "call" or "support" (a shop's "call to pick it up") is a caution. In an opened email, on Gmail, Outlook and the other webmail sites, "call this number if you didn't make this purchase" is a caution, and so are look-alike "mathematical" letters such as 𝐔𝐒𝐃, used to slip past filters; together they flag it. Phone numbers written "1(555)010-0188", with nothing after the brackets, are now recognized too.
- **Fixed: genuine OneDrive emails flagged red.** "OneDrive" <photos@onedrive.com> ("Your memories from this day") was flagged as a brand's name on an address that isn't the brand's: onedrive.com wasn't known as Microsoft's. It is now, with Microsoft's other mail and content domains (1drv.ms, sharepointonline.com, microsoftpersonalcontent.com, svc.ms, msn.com and others). Senders flagged before are checked again.

## 5.69 — Flagged emails in search results are moved; four more kinds of scam caught

- **New: Also move flagged emails found by a search** (on by default; policy `managedEnableAutoSpamInSearch`). Flagged emails were moved to Spam only from the inbox, so a malicious email found by a search stayed where it was, even with its red label. Search results now count like the inbox, whether the email is in the inbox, archived or under a label, as a list or opened. Never a search in Spam, Trash, Sent, Drafts, chats or everywhere (`in:spam`, `in:trash`, `in:sent`, `in:anywhere`…), never a conversation you wrote in, and one you took back out of Spam stays out. Search results that Gmail splits into sections are moved too. Unread emails in search results are still checked from their sender only (their headers are read only in Spam), as in the inbox.
- **Stronger: your own name as the sender's name, in any case.** A fake Norton bill ("Your Order Acknowledgement… Bill") came from a stranger's Gmail address under the recipient's own mailbox name, with a capital first letter. At Gmail, Outlook.com and other big providers a mailbox name is nobody's real name, so it now counts in any case (red, without opening). At an organization's own domain, where a mailbox can be a plain first name, it still counts only written exactly as in the address.
- **New signs of forgery in the headers** (read emails, and unread ones in Spam), each found in a scam that wasn't red:
  - the sender's name padded with invisible characters (Hangul or braille "fillers", zero-width spaces), as in a "FidelityLife" offer;
  - web-page code (`<strong>`, `<br/>`) in the To, Cc or Bcc lines, which no mail program writes there;
  - an "In-Reply-To" line holding an address instead of a message ID (a made-up reply);
  - a cPanel marker, counted with the other unrelated sending services the headers claim at once;
  - a fake Gmail (or other big provider's) signature, with a key the provider doesn't have, as in a casino ad that also failed DMARC;
  - a subject ending in filler and random letters ("…FOR YOU!_______kvksrphdly");
  - an "X-Spam-Flag: YES" mark: a mail system it passed through (here the sender's own provider) had already found it was spam;
  - an unsubscribe link or tracking image on the sender's own computer (127.0.0.1, localhost), as in an IPTV ad. Other links to localhost, normal in developers' mail, don't count.
- Emails checked before are checked again.

## 5.68 — Senders using your own name are flagged

- **New: Catch senders using your own name** (on by default; policy `managedEnableOwnNameCheck`). A fake cloud-storage email ("We've blocked your account! Your photos and videos will be deleted…") sat in Spam without a red label: its sender's name was the recipient's own mailbox name (the part of their address before the @), sent from a stranger's address, so it looked like a notice about their own account. An email whose sender name is your own email address, or your mailbox name written exactly as in your address, but which comes from someone else's address is now flagged red from the inbox list, without opening it, and moved to Spam (in the Spam folder it is marked red). Left alone: shared mailbox names (info, office, support…), senders from your own organization, an address that contains your mailbox name (likely your other account), a name written with capitals, as people write names ("Patdoe" for patdoe@…), and trusted senders.
- **Headers:** two different Content-Length sizes in one email (a filter-dodging trick in the same email) now count as a sign of forgery, like repeated From or Subject lines. Emails checked before are checked again.
- **Clearer Spam folder labels:** an email in Spam without a red label now says it was checked and that no check flags it, which doesn't prove it's safe.

## 5.67 — No more CORS errors from company logos

- **Fixed: "blocked by CORS policy" errors in the browser's extension log** (chrome://extensions → Errors), one for each company logo (BIMI) from a server such as vmc.digicert.com, Valimail or CloudFront. The extension tried to download each logo to check and keep it, but almost no logo server allows that kind of download, and each refusal was an error. Logos were already shown from their address by the inbox page whenever that happened; now that is the only way, and nothing is downloaded. A logo shown as a picture can't run scripts, so the old check of the file isn't needed.

## 5.66 — No more "domain doesn't exist" for company subdomains

- **Fixed: real company mail flagged as forged.** An email from Blink (Amazon), sent from `hello.blink.com`, was flagged red and moved to Spam as "The sender's domain doesn't exist". Blink's DNS answers "no such domain" for `hello.blink.com` itself, because only names below it exist (its bounce address `e.hello.blink.com` and its DKIM key), and the email passed Gmail's sender verification (DMARC) for blink.com. A subdomain with no DNS records of its own now counts as missing only when its organization's own domain is missing too; otherwise the organization's domain is checked for threats instead, and the log says so.
- Senders flagged by the previous version are checked again after the update. To bring that email back, open Spam and click **Not spam**.

## 5.65 — Red flags in the Spam folder; forged delivery records weigh more

- **New: Flag dangerous emails in the Spam folder** (on by default; policy `managedEnableSpamFolderFlags`). In Spam, every email the same checks would move there is marked red, whether this extension moved it or Gmail (or you) did. An email the extension moved keeps its red label there, with when and why, even when the reason was something only seen once it was opened (its links or attachments). Unread emails in Spam are checked too: their headers are read there, which isn't done in the inbox. Nothing is flagged just for being in Spam: an email without a red label there isn't flagged by any check, so Gmail put it in Spam, or you did, and it may be a mistake.
- **Unread emails stay unread:** Gmail doesn't document whether reading an email's original source marks it read, so the extension watches. If an email in Spam whose headers it read turns read without being opened, it stops reading unread emails' headers for good, says so in the application log, and checks them from their sender only, as in the inbox. Turning the setting off and on tries again.
- **Stronger: delivery records copied from other people's emails.** Forged delivery records ("Received" lines dated long before the email arrived) counted as a caution (amber) only, because one old record can be genuine (mail imported from an old mailbox). Records addressed to two or more other people, written more than 12 hours apart, were copied from different emails, which no genuine email has: that is now enough on its own to flag the email (red) and move it to Spam. A phishing email ("Login Verification", from a "Benefits Card" sender) carrying two such records from 2023 and 2024 was only amber before. Emails checked before are checked again.

## 5.64 — Fewer false look-alike warnings

- **Fixed: real companies flagged as look-alikes.** A sender such as `simple-help.com` was flagged red (and its email moved to Spam) because "simple" is the name of a popular site (simple.life) and "help" is one of the words phishing domains add (billing, login, support…). Many popular sites' names are ordinary words, so for them this rule now works like "one letter off": red only when the sender's domain was registered less than 90 days ago, which is when phishing domains are used; nothing for an older domain. A built-in brand plus such a word (paypal-billing.com) is still red at any age.
- **Fixed: an update now re-checks senders.** Sender verdicts are kept for a few hours; they were kept across an update too, so a sender wrongly flagged by the previous version stayed flagged until they expired. Updating now clears them.
- If an email was moved to Spam by this mistake: open Spam and click **Not spam**. That puts it back, tells Gmail it isn't spam, and the extension never moves that conversation again.

## 5.63 — Sender icons readable in the dark and light themes

- **Fixed: dark icons vanished in Gmail's dark theme.** A site icon drawn in black with a see-through background (a logo with nothing behind it) was put on a dark tint of its own color, so it nearly disappeared (1.2:1). Each icon is now measured before its circle is chosen: its outline (what touches the circle) and its inside. If neither stands out from the theme's tint, the circle takes the other one (light in the dark theme, dark in the light theme) or a mid grey, whichever gives the icon's outline the most 3:1 contrast (WCAG 2.1 non-text contrast). White and pale-yellow icons in the light theme get a dark circle the same way.
- Icons that already show keep their look: a colored logo, or one on its own white or black backdrop (Google's G, Apple, Threads), keeps the theme's tint. Of 35 real site icons with see-through parts that were checked, only the four that were hard to see change (two black logos in the dark theme; Spotify's green and Walmart's yellow in the light theme). Icons with a solid square background are never changed.
- **Compact density and opened emails:** an icon beside the flag that wouldn't show on the row gets a small plate of a contrasting color.
- Company logos with see-through parts that are white themselves get a dark circle instead of the white one.
- Only pictures the extension already holds are measured, in the page; nothing is downloaded again for this.

## 5.62 — Look-alike senders caught in the inbox list, without opening anything

- **New: Catch look-alike senders** (on by default; policy `managedEnableLookalikeCheck`). Every inbox row's sender domain is compared with about 14,000 protected domains: the top 10,000 of two public popular-site lists (the Chrome UX Report top list, via a research copy on GitHub by Zakir Durumeric, data CC BY 4.0; and Tranco, tranco-list.eu, which adds the services that send a lot of email but are rarely visited, such as sendgrid.net and docusign.net), refreshed monthly; the built-in brands; your own organization; and domains whose mail passed DMARC in your mailbox.
  - **Red, moved to Spam:** look-alike characters (a Cyrillic "а" in pаypal), a brand domain worn at the start of another (paypal.com.verify-acct.net), a brand plus a scare word (paypal-billing.com, sendgrid-billing.net), an imitation of your own organization (your-district-k12.org), and one letter off a protected domain **registered less than 90 days ago** (its public registration date, RDAP, looked up only for such near matches).
  - **Amber:** one letter off a well-known built-in brand when the domain is older. Older near matches of other domains aren't flagged: real companies with similar names exist (Channel 4 / Channel 5).
  - A popular domain is protected only if it enforces DMARC itself, as email-sending brands do, which keeps piracy mirrors and similar sites out. In a test on 66,690 real sites, this and the age rule removed the false matches a plain "one letter off" rule would have made (1.7%).
  - **Names:** a well-known brand's name on an address that isn't the brand's is red; a colleague's name on an outside address is amber (colleagues sometimes write from home). Colleague names are learned from your organization's senders and kept only as one-way hashes, never as names.
  - These checks come on top of the security DNS services and phishing lists, which already catch look-alikes once they're reported; these catch the new ones nobody has reported yet. Trusted senders are never judged.
- **Fixed: US school and local-government domains** such as `yourdistrict.k12.fl.us` were treated as part of `fl.us`: the district's own BIMI logo wasn't found, its DMARC policy was looked up in the wrong place (so colleagues' photos were refused), and learned logos were shared across all such domains. UK school domains (`sch.uk`) and other two-level endings are fixed too.
- **Lists stored compressed and without duplicates:** the downloaded phishing lists and the popular-sites lists are kept compressed, each entry once: Phishing Army's 150,000 domains take about 1.4 MB instead of 3.2 MB, the popular sites about 100 KB. Domains your mail verified aren't stored again when already protected.
- New host permission `tranco-list.eu` (for the Tranco list). Installs managed by policy get it automatically; others are asked once on update.

## 5.62 — First Safari build (same features as Chrome 5.62)

- **Safari 18.2 or later** on macOS (and iOS/iPadOS with a build signed by your organization). The extension is the Firefox build's code with a non-persistent background page, wrapped in a small app by Apple's converter: `tools/build-safari.sh` builds it on a Mac with Xcode, and the **Safari build** GitHub workflow builds it on a GitHub Mac and offers it for download.
- **No extension policies in Safari:** nothing can be set or locked by an administrator, so the policy buttons (Copy policies.json, Intune script) and `policy-example.json` are gone. Help → Deploying in organizations and ADMIN-GUIDE.md now describe building, signing, distributing (App Store, TestFlight or Developer ID), Apple's Safari extensions management (always on, allowed on your webmail; macOS 15, iOS 18, iPadOS 18) and sharing settings with a backup file. The policy-only options (a simpler popup, phishing-simulation rules) aren't available.
- **Other extensions:** Safari doesn't let an extension see or turn off other extensions, so only the ones found in the webmail page are listed, with the steps to turn them off in Safari's settings.
- **PDF scanning:** two small shims (`Map.getOrInsert`, reading a stream with `for await`) for features pdf.js uses that Safari lacks.

## 5.61 — Safer pictures, colleague photos without opening emails, address labels, and a copy button

- **Colleagues' photos without opening their emails:** a colleague's photo is now learned from anywhere Gmail shows it (hover cards, the chat panel, recipient chips, opened emails), so the inbox fills with your organization's photos much sooner. Never from a picture inside an email, never an outsider's, and only from Google's profile-photo servers (not its image proxy, which pictures inside emails use).
- **Fixed: the circle disappeared after coming back from an email** (Back) until you clicked another one. Gmail focuses the row you came back from, and the circle stepped aside for any focus in the row; it now steps aside only when the checkbox itself has keyboard focus. Lost circles are also put back on the 3-second check.
- **Calmer circles:** a site's icon now sits on a soft tint of its own color (light or dark to suit the theme) instead of a white disc with a grey ring, and is larger (24 px in a 36 px circle, 22 px in 32), so the circles look alike and fill out.
- **Safety:** a flagged or caution email (a failed sender verification included) shows **no circle at all**, not even an icon or initial, so its plain checkbox and red or amber label stand out; in Compact its inline icon is hidden too. A sender-verification (DMARC) failure is now always at least **amber**, even where the domain only monitors (p=none), except for genuine mailing lists and trusted forwarders, which often break it. Photos, BIMI logos and learned company logos are shown only for domains that **enforce** DMARC (reject or quarantine for all their mail; a subdomain needs its subdomain policy enforced too), so a forger can't borrow a colleague's photo or a company's logo.
- **Opened emails: the sender's address is the label.** The separate domain label after the sender is gone; Gmail's own "<address>" carries it: unchanged for neutral senders (point at it for the explanation), in red, amber or green with its mark for flagged, caution and trusted ones. Other webmail keeps the label.
- **New: copy button for the sender's address** after the address in opened emails: copies it with one click (or Enter), confirms "Copied" (also for screen readers), and works whatever the sender checks are set to. Inspired by Copy Button for Gmail, which the conflict warnings now recognize. Setting **Copy button for the sender's address** (on by default), policy `managedEnableCopyAddress`.

## 5.60 — Picture sizes that follow Gmail's density, and colored initials

- **Bigger circles, sized by Gmail's display density** (Settings → Density): **Default** gets 36-pixel circles over each email's checkbox, **Comfortable** 32-pixel ones. **Compact** has no circles: the site's icon is back beside the country flag, at the flag's size (15 px). The density is told from Gmail's page (the left menu's item height, attachment chips or a paperclip) and followed when you change it.
- **Colored initials:** a sender with no photo, logo or site icon gets a circle with the first letter of their name on a color of their own (always the same for the same sender), so every row looks alike. Not in Compact. The colors leave out red, yellow and green, which mean flagged, caution and trusted.
- New setting **Size of sender pictures**: Automatic (Gmail's density, the default), Large circles (36 px), Medium circles (32 px) or Small, beside the flag. Policy `managedSenderPictureSize`.

## 5.59 — Pictures for every sender without opening emails, and BIMI logos

- **Every inbox row now shows a circle over its checkbox**, with no email opened first. In order: a colleague's own photo (your organization; learned from emails you've opened, since Gmail offers no other way without signing in to Google's API); the company's **BIMI logo** (published in DNS, looked up when the row appears); a company logo learned from an opened email; otherwise the **site's own icon**, its parent domain's, or DuckDuckGo's stand-in. Your own organization gets the same order after colleagues' photos: its logo, else its icon.
- **The icon next to the sender's country flag is gone** from inbox rows; the circle replaces it. Opened emails keep the small icon beside the sender (Gmail shows its own picture there).
- **BIMI safety:** a logo is used only when the company's domain enforces DMARC (quarantine or reject), as BIMI requires, and only the company's main domain is looked up, never a subdomain, so a sender can't turn throwaway subdomains into a per-recipient "read receipt". The logo is downloaded and checked (SVG, at most 32 KB, no scripts) where its server allows; otherwise the inbox page loads it by its address with no referrer, which lets the company's logo server see your IP address. If it doesn't load, the site icon is shown. New setting **Company logos from BIMI** (on by default), policy `managedEnableSenderBimi`.
- **A flagged or caution email never shows a company logo or photo** (its checkbox shows instead): before an email is opened its sender isn't verified, so a forged "paypal.com" email must not get PayPal's logo.
- BIMI and DMARC lookups fall back to Cloudflare's security resolver when the address 1.1.1.1 is blocked (some school and company networks do), and remember which one answered.

## 5.58 — Sender pictures over the checkbox, a Spam-moving fix, and faster tests

- **Sender photos and company logos now sit over the inbox row's checkbox**, as a circle (the way Gmail and Simplify Gmail draw avatars), instead of next to the site icon and flag. Point at the row, or tick it, and the checkbox is back and works as usual; the picture never takes a click. The icon next to the sender is always the site's own icon again.
- **Fixed:** if the inbox list was hidden at the moment the extension first looked at it (for example while an email was open) and Gmail showed it again without changing it, those emails were never checked, so flagged ones were never moved to Spam until something else changed the list. The 5-second check now spots rows that are shown but were never checked.
- **Tests are now kept with the code** (`tests/`, left out of the extension package) and run in parallel: the full run takes about 2 minutes instead of 15. Slow suites are split into parts, fixed pauses were replaced by waiting for what's expected, each suite has a time limit so nothing can hang, and the phishing samples use placeholder domains.

## 5.57 — Company logos in the inbox list, the photo-finding fix, and finer conflict choices

- **Fixed: photos and logos were never found in real Gmail.** Gmail puts the sender's picture in its own column beside the message body, and the extension only looked inside the body's box, so every opened email logged "Gmail showed no photo or logo beside the sender". It now looks in the whole message.
- **One logo per company, shown for everyone there.** A company's logo is learned from one opened email that passed Gmail's sender verification (DMARC) and came from one of its shared mailboxes (contact@, info@, support@, news@, no-reply@…, whose picture the company itself chose) or carried a verified BIMI logo. From then on every address at that company shows it in the inbox list, with no need to open each sender's email first.
- **People at other companies show their company's logo**, never their own photo (bob@company shows company's logo).
- **Your own organization shows each colleague's own photo**, never your organization's logo.
- **Personal email services** (Gmail, Outlook.com, Yahoo…) keep the site icon.
- **Other extensions: turn off only the settings that overlap.** When another extension overlaps with several of ours (Simplify Gmail: sender photos and tracking-pixel blocking), the warning and Settings → Other extensions offer one button per overlapping setting of ours, plus "all of ours", besides turning the other extension off. Once you've turned off the ones you want off, that extension isn't warned about again, unless a setting you turned off is turned back on while it's still there.
- **Row highlighter: ticked emails get their own color** (blue by default; the row under the mouse stays yellow), so a ticked email and the one your mouse is over are never confused. Same six colors to choose from; if you pick the same color for both, Settings warns that it may be confusing but lets you. Policy `managedRowHighlightSelectedColor`.
- **Fixed:** in Settings → Other extensions, pressing Ignore (or Warn me again) could list the same extension twice: two redraws of the list ran at once and both added their entries.
- Settings → Logging → Senders counts colleagues' photos and company logos separately.

## 5.56 — Row highlighter, and warnings about extensions that do the same job

- **New: row highlighter.** The inbox row under the mouse gets a soft see-through color and an outline, so it's clear which email a click opens; emails you've ticked keep the highlight. Six colors (yellow, blue, green, pink, purple, gray) and three styles (color and outline, color only, outline only), each with a light- and dark-theme variant so text keeps its contrast. Works on every webmail whose inbox list the extension finds. Inspired by Row Highlighter for Gmail. Settings → Row highlighter; policies `managedEnableRowHighlighter`, `managedRowHighlightColor`, `managedRowHighlightStyle`, `managedRowHighlightSelected`.
- **New: warnings about other extensions that do the same job.** Two extensions changing the same part of the webmail (both drawing sender icons, both highlighting rows) can conflict. Known ones (Gmail Sender Icons, Simplify Gmail, Contact Avatars for Gmail, Row Highlighter for Gmail) are recognized from what they add to the page, and any extension drawing sender icons or photos is noticed by its effect. A notice recommends keeping this extension on (it also checks senders for phishing) and offers: turn the other one off (opens Settings → Other extensions, where one click does it in Chrome after the browser asks for permission; Firefox gets the steps), turn our matching feature off, or ignore. **Check installed extensions** lists installed ones too. Nothing about other extensions is sent anywhere. Administrators can suppress the warnings completely with `managedEnableConflictWarnings: false`.
- New optional permission "manage your extensions": never asked at install, only when you press one of those buttons.
- **Fixed:** choice settings (such as a custom service's GET/POST method) set by policy or the user in different upper/lower case were ignored; any spelling is now accepted.

## 5.55 — Sender photos and logos as Gmail's real page shows them

- **Verified brand logos now work:** Gmail embeds a verified BIMI logo in the page itself (a `data:` image) rather than loading it from an address. Such a logo is kept as it is, with nothing downloaded, and only when Gmail's own sender verification passed for that email (DMARC). SVG logos are kept as SVG (at most 32 KB) and shown only as an image.
- **People's photos in any address format:** any photo Gmail loads from `googleusercontent.com`, including the older `/-xxxx/AAAAAAAAAAI/…/photo.jpg` format, counts as a person's photo, used only for people in your own organization. Outside senders' photos are never used, whatever their format.
- **Changes are picked up:** a logo is compared by a short fingerprint of the image and replaced when it changes; a photo by its address, plus the weekly check. Colleagues' photos are downloaded by the extension's background part, so they still work when Gmail's page itself is blocked from showing them; if Gmail never puts a photo's address in the page, the site icon is shown.

## 5.54 — Fix: sender icons and labels disappearing from some inbox rows

- **Fixed:** when Gmail refreshed the inbox list in place (for example on coming back to the tab), it rewrote the top rows' contents and their sender icons, flags and labels disappeared until the page was reloaded. The extension only noticed new rows, not rows whose contents were replaced. Now a row that lost them gets them back right away, and the list is checked again whenever the tab is shown.

## 5.53 — Why a sender photo or logo wasn't used

- The application log (Settings → Logging) now says, once per sender, why a photo or logo wasn't used: none shown beside the sender, only the generic placeholder, an image from an unexpected host (named, never the full address), an outside sender's personal photo, or a logo for an email that didn't pass DMARC (with the result). Photos and logos are learned when an email is opened; the inbox list shows them from then on.

## 5.52 — Sender photos and verified logos

- **Sender photos and verified brand logos in the inbox and in opened emails** (Gmail), in place of the site icon, round like Gmail's own. When you open an email, the photo or logo Gmail shows beside its sender is remembered for that address, so the inbox list shows it from then on. Inspired by Simplify Gmail's sender avatars.
- **Your own organization's people come first:** profile photos are used only for senders on your own organization's domain (its directory). For outside senders only a brand logo Gmail displayed for an email that passed Gmail's sender verification (DMARC) is used: Gmail shows a brand's BIMI logo only after checking it. Personal photos of outside senders are never used, since anyone can make their profile photo look like a bank's logo.
- **Cached and kept current:** each photo is fetched once from Gmail's own image host and kept in the icon store (raw image, per address). When Gmail shows a different photo for the same sender (a changed photo), the new one replaces it at once and every icon of that sender on the page is redrawn; the same photo is checked again weekly. Delete now and Logging → Senders → Clear remove them.
- New setting **Sender photos and verified logos** (on by default; policy `managedEnableSenderAvatars`). The compatibility chart has a new row for it.

## 5.51 — Sender features on every webmail (basic), and the webmail's own warnings

- **Sender labels and checks now reach every supported webmail.** On a site without an entry of its own (Outlook, Proton, Yahoo, AOL, Zoho, iCloud, Fastmail, GMX), a generic profile finds inbox rows and senders through the page's accessibility labels, the markup screen readers use: rows by their roles, the sender's address in a tooltip, a mail link or a data attribute, the sender of an opened email as the address shown just above its body, and unread state from the row's label. Those sites get the sender icon, country flag, label and checks in the inbox list and in opened emails, marked **Basic** in the compatibility chart (◐ in the README). A row that doesn't show the sender's address gets no label.
- **Read-only on those sites:** the generic profile never clicks anything, so moving to Spam and the Send check stay on sites with their own entry (Gmail), tested on a real account. A flagged email on another site is marked, explained in its banner and logged, but not moved.
- **The webmail's own warnings about a sender now count** in an opened email's verdict, on every site: Outlook's "This sender failed our fraud detection checks" (flags the email) and "… may not have been sent by …" / "unverified sender", and Gmail's "This message might be dangerous" (flags) and "Be careful with this message". The warning is quoted in the label's tooltip and the email's banner. Only text the webmail shows around the email counts, never the email's own body.
- Turning a webmail's support off in Settings now also stops the sender features there, immediately.

## 5.50 — One mail engine for every webmail (no visible change)

- **Internal rework, no change in behavior on Gmail.** Everything that read Gmail's page (the inbox list, opened emails, the toolbar, Report spam, the compose window, attachment cards, "Show original") is now one shared mail engine. Everything that differs between webmail sites is data in that site's entry of the `WEBMAIL_SITES` table (`shared.js`): selectors, how conversation and message ids are written, which views are the inbox, the original-source address, the receiving mail system whose header lines can be trusted, and so on. Gmail is now one entry of that table like Outlook, Yahoo and the others. Its entry is still the only one that describes an inbox list and toolbar, so sender icons, moving to Spam and the Send check still run on Gmail only; other sites get them as their entries are filled in.
- Header checks now trust header lines only from the receiving mail system named in the site's entry (for Gmail, `mx.google.com`), never from a fixed name in the code; with no such entry, no header line is trusted.
- Links to another webmail inside an email (for example a `mail.google.com` link in an Outlook email) are now checked like any other link; only links to the webmail being used are skipped.
- Messages in the log and on screen name the webmail being used instead of always saying "Gmail".
- **New: a feature compatibility chart** (Settings → Help → Which features work where, and in the README and admin guide), generated from the same table and function the engine uses, so it always matches the running version. Help's architecture page has a new live section on the mail engine and each site's entry.

## 5.49 — More signs of forged email in the headers

From a phishing sample that wasn't caught (a fake "AHS Warranty" email): it now scores 13 (5 flags an email).

- **Failed sender verification (DMARC) against the sender's own policy:** when Gmail records that an email failed DMARC and the domain in its From line publishes "quarantine" or "reject", the domain's owner is saying the email isn't theirs. That alone flags the email (5). Only Gmail's own result on arrival counts, never one the sender wrote lower in the headers. Genuine mailing lists (a well-formed List-ID) and trusted forwarders (ARC) can break DMARC, so for them it's a strong sign (3) that flags only together with others. A failure under a "none" policy is a medium sign (2).
- **Forged delivery records from any server:** a "Received" line dated more than a week before the email arrived (longer than any mail server keeps retrying) was copied from older emails (3). Previously only fake Gmail records were caught.
- **Format markers that only exist in one form:** MIME-Version other than 1.0 (2), a transfer encoding that doesn't exist such as "Hexa" (2), a made-up mailing-list ID such as `<.7289367.xt.local>` (1). Apple Mail's `MIME-Version: 1.0 (Mac OS X Mail …)` is recognized as normal.
- Header results saved by earlier versions are worked out again, so emails already in the inbox get the new checks.

## 5.48 — Stand-in icons for sites without their own

- **A sender site without its own icon gets a stand-in:** its parent domain's icon (for `alerts.brand.com`, `brand.com`'s, through Google's icon service as before), else one from DuckDuckGo's icon service (`icons.duckduckgo.com`; only the site name is sent, and only for such sites). New setting **Stand-in icon for sites without their own** (on by default; policy `managedEnableSenderIconFallback`). Off: a blank space, as before.
- **Where each icon came from is recorded** (the site's own, the parent domain's, DuckDuckGo's, or none) and shown in Logging → Senders, with counts.
- **Stand-ins are temporary:** sites without their own icon are asked about again every week, and the site's own icon replaces the stand-in as soon as it has one. A recheck never replaces an icon with a worse one, and a DuckDuckGo icon stops being shown once the setting is off.
- DuckDuckGo often sends Windows .ico files holding several sizes (up to 32 KB); those are redrawn once as one 32-pixel PNG (about 1.5 KB). Google's icons are still kept exactly as sent.
- If DuckDuckGo can't be reached (an outage, or a web filter that blocks it), the result is still remembered and asked about again in a week, so it isn't requested on every page.
- Gmail's own sender avatars (including verified BIMI logos) are never changed: the extension's icon only sits beside the sender's name. Using BIMI logos directly is not included: anyone can publish one for their own domain (including a look-alike of a real brand), and showing them safely needs the same certificate checks Gmail does.

## 5.47 — Sender icons in their own database

- **Sender icons are stored as raw images in the extension's own database (IndexedDB)** instead of as text in the settings storage: about a quarter smaller (no base64), and saving a new icon is one small write instead of rewriting every remembered icon. A full set of 1,500 icons is about 1.1 MB instead of 1.5 MB.
- Icons are kept exactly as Google sends them. Tests on 40 common sender sites showed they are already well compressed: re-encoding (PNG, WebP), shrinking to 16 pixels, or tracing to SVG and optimizing with SVGO all made them larger, blurrier or less accurate.
- Icons saved by earlier versions are moved over automatically the first time an icon is needed, then the old copy is removed.
- Each site is remembered for 30 days, at most 1,500 sites (oldest removed first). Delete now and Logging → Senders → Clear empty it. Logging → Senders shows how much space the icons use.
- If the database can't be opened, icons still show; they are just fetched again when needed.

## 5.46 — Lighter on memory, battery and the user's own actions

- **Large lists use about a third of the memory.** The downloaded phishing lists, the scam-sender list, the shortener lists and the remembered Spam moves are kept as one sorted block of text with a small index and searched by halving, instead of a table with an entry per item: for Phishing Army (about 153,000 domains), 4.9 MB instead of 15.7 MB, built in about 36 ms instead of 95 ms each time the background starts (measured). Each lookup still takes about a microsecond. Lists are now stored sorted. Results are unchanged.
- **Moving to Spam waits until you've been idle in Gmail for 10 seconds** (no click, key, scrolling or mouse movement over the list), so rows never disappear under the pointer and Gmail's Undo for your own action isn't replaced by one for the move.
- **The monitor runs only while the Gmail tab is shown**; it stops completely while the tab is in the background.
- **Waiting moves no longer re-read the whole move memory**: the checks that can't change (an email open, Multiple Inboxes, split view) come first, and the memory is kept in the page and read again only when it changes.
- **Sender icons:** a site is remembered as having no icon only when Google says so (HTTP 404). A server error, a web filter's block page or anything that isn't an image is no longer saved for 30 days; the icon is asked for again later. Icons larger than 8 KB (normally 1–3 KB) are left blank instead of stored.
- The list of emails already logged on a page is capped at 2,000.
- Admin guide: what Report spam teaches Gmail, and how Not spam undoes it.

## 5.45 — Moving to Spam no longer gets stuck

- **Fixed: moving emails to Spam could stop until Gmail was reloaded**, especially with several moves one after another. Causes found and fixed:
  - emails that had to wait (an email was open, or Gmail briefly hid the list) were dropped from the queue and never picked up again;
  - after three moves Gmail didn't confirm, moving switched itself off for the rest of the visit;
  - conversations whose Report spam click Gmail ignored were remembered as moved, so they were never tried again, even after a reload;
  - a reply the background service never sent could leave moving "busy" forever;
  - a selection left in a list Gmail had hidden counted as "you have emails selected".
- **A monitor now keeps moving alive.** It runs in the Gmail page itself (the only place Gmail's buttons can be clicked) and checks every 5 seconds: flagged emails still in the inbox are queued again, a move that stalled is restarted, and waiting moves are retried. After three passes in which Gmail moved nothing, moving pauses (15 seconds, doubling up to 10 minutes) and tries again by itself, never stopping. Every message to the background service has a time limit.
- A click Gmail ignored is forgotten and tried again; a conversation Gmail skipped while moving others is given up after 3 tries and logged in Logging → Moved to Spam. Nothing is ever left selected.
- What is moved, and every safety check before a move, is unchanged.

## 5.44 — Color only where it matters

- **Sender labels are colored only when they need attention:** ⛔ red for flagged, ⚠ yellow for caution, and ✓ green only for trusted senders (your list, your organization's, or an allowlisted domain), the one case a person chose. Every other label (checked, nothing found; not verified) is plain, the same neutral grey as Gmail's own labels.
- **Opened emails no longer say "· Not verified" or "· Checked"** after the sender's domain; the words appear only for Flagged, Caution and Trusted. Pointing at the label still shows every check and reason.
- Why: a "Not verified" on every Gmail, Yahoo and Outlook sender read as a warning, while a green "Checked" (the security services don't know the domain) gave a false sense of safety, since new phishing domains are often not listed yet. Checks, flagging and moving to Spam are unchanged.

## 5.43 — No sender block list; rescues kept apart

- **Removed the organization's phishing-sender block list (`managedPhishingSenders`).** Only allow lists remain: Trusted senders (yours and `managedTrustedSenders`) and the allowlist, for phishing-training providers and false positives. Anything the checks miss is reported with Gmail's own Report spam. An existing `managedPhishingSenders` policy is ignored. Senders are still flagged by the community scam-sender list, the phishing lists, the DNS security services, nonexistent domains, malformed addresses and signs of forgery in the email.
- **Trusted senders and allowlisted domains always win**: nothing can flag or move them any more.
- **Mail from your own organization's domain is never moved to Spam** (previously it could be, when your organization listed that exact address). It is still flagged and explained when something is wrong.
- **Conversations you take out of Spam are remembered in their own list** (`spamRescuedThreads`), so emails moved later can never push them out. Each list keeps its newest 50,000 (was 20,000 shared). When the moved list is full, its oldest entries are forgotten first, and the log says so once.

## 5.42 — Nothing is shown as safe unless it was checked

- **Senders:** mail from Gmail.com, Outlook.com and other big providers, from major companies' domains and from your own organization's domain is now **Not verified** (grey) instead of ✓ Checked (green). Their domains are never judged as a whole (anyone can sign up at gmail.com, and an own-domain From line can be forged), so not being on a phishing list proves nothing. Green now requires a completed threat check that cleared the sender's domain; trusted senders and allowlisted domains show as Trusted. Flagging and moving to Spam are unchanged.
- **Links:** a link counts as checked only when every host the click can reach was checked. Previously, if the destination checked out but the link's own host couldn't be checked, the link showed ✓ Checked; it is now Not verified, with the reason.
- **Any answer that isn't a definite "safe"** (a missing or unexpected verdict) is now shown as Not verified everywhere: link tooltips and hover cards, QR code bars, the popup counts and the Settings link checker.
- **Link tooltips** say "Not verified" for unverified links instead of "Clean destination".
- **Logs:** history entries from versions before 5.14, and cache entries without a recorded result, show as Not verified instead of Safe.

## 5.41 — Sender verdicts agree with the email; trusted senders; sender logging; cached icons

- **An email's verdict now includes what's in the email.** Previously a sender could show ✓ Checked while every link in the email was red. The sender label, the email banner and moving to Spam now use one verdict built from the sender's checks plus signs found in the email itself. Each sign has a weight: strong signs flag the email on their own; weaker ones add up (enough of them flag it, fewer make it Caution):
  - **links:** all of them, or two or more, flagged as dangerous (for example phishing pages in cloud storage) flag the email; one dangerous link among several makes it Caution;
  - **attachments:** one flagged as dangerous flags the email; an attachment without a name ("noname") counts;
  - **headers** (opened emails, and read emails in the list; never unread ones):
    - fake Gmail delivery records copied from older emails;
    - a misspelled "Recived" line;
    - headers claiming several unrelated sending services at once;
    - unfilled bulk-mail placeholders;
    - repeated From/Subject/Date/Message-ID/MIME-Version lines;
    - a "To" line that shows one address but is addressed to another;
    - a subject padded with blank space or random capitals;
  - **the sender's name:** padded with symbols, rows of quotes or blank space.
  The label's tooltip and the banner list every sign found.
- **Malformed sender addresses are flagged and always get a badge.** Previously an address Gmail showed but the extension couldn't parse got no badge at all. Now each of these flags the email on its own:
  - a disguised encoded part (`name@=?UTF-8?B?…?=`; the decoded domain is shown and checked);
  - more than 64 characters before the @;
  - two @;
  - an invalid domain.
- **A sender domain that doesn't exist is now flagged (red)**, no longer "unknown": genuine mail can't come from it.
- **Trusted senders replace the user's phishing-sender list.** Settings → Senders → **Trusted senders** lists addresses or whole domains that are never flagged or moved to Spam (their links are still checked). Administrators can add `managedTrustedSenders`. The phishing-sender list is now set by the organization only (`managedPhishingSenders`), and it wins over trusted senders. Entries in the earlier user phishing-sender list (5.40) are no longer used.
- **Sender icons:** fetched once per site by the extension and remembered for 30 days. A site without an icon (Google's service answers 404 with a generic globe) gets a blank space. *Offline only* still requests nothing. New host permissions: `www.google.com/s2/*`, `*.gstatic.com/*`.
- **Faster inbox, fewer lookups:** sender verdicts are remembered across visits (6 hours), as are domain verdicts (6 hours), countries (30 days) and icons (30 days). Header readings are remembered per email.
- **Logging:**
  - **Logging → Senders: icons & flags** lists every sender checked recently, with:
    - its icon and country;
    - its verdict and every reason;
    - what was checked (lists, threat services, malformed address).
  - **Logging → Moved to Spam** lists each move, each move that didn't work and why, and each conversation taken out of Spam.
  - The application log has a readable line for each:
    - sender check (with what was checked);
    - email whose own content changed the verdict;
    - country and icon lookup;
    - move, failed move and rescue.
  - *Delete now* also clears the sender caches.
- **Tests:** unit tests for the new rules and two real-world scam samples, whose headers score 10 and 21 against a threshold of 5, while a normal newsletter scores 0. Browser tests reproduce both samples on simulated Gmail pages:
  - the opened scam whose links point to cloud storage;
  - the unread row with a 95-character address;
  - a read row with forged headers.

  They also cover trusted senders, the two new Logging sections, and icons (one found; a missing one left blank).

## 5.40 — Sender icons, country flags and phishing senders moved to Spam (Gmail)

- **Sender identity in the inbox and in opened emails.** Every sender gets:
  - its site's icon (from Google's icon service, only the site name is sent; a letter at *Offline only*);
  - a country flag: where the server that delivered the email is (from Gmail's own `Received` header, read and opened emails only; the IP address is looked up at `api.country.is`, at most once a month per address), else the country of the domain ending (.de, .uk; generic endings such as .io give none), else where the sender's website is hosted;
  - a domain label colored by the sender check: ✓ green *Checked* or *Trusted*, grey *Not verified* / *Unknown*, ⚠ amber *Caution*, ⛔ red *Flagged sender*. Pointing at it shows the reasons and, for an opened email, Gmail's DMARC/SPF/DKIM verdict. Mail-system prefixes are dropped from the label (`email.notifications.paypal.com` → `paypal.com`), never anything else.
- **Sender checks.**
  - **Addresses** are compared on the device with the organization's list (new policy `managedPhishingSenders`), the user's own list (Settings → Senders → Phishing senders) and the community scam-sender list [sefinek/Blacklisted-Emails](https://github.com/sefinek/Blacklisted-Emails) (MIT), downloaded with the phishing lists at most once a day. From the community list only exact addresses count, never at big companies' own domains.
  - **Domains** are checked with the same DNS threat services as links (domain name only) and against the phishing lists. The DNS services are asked only when their answer can still change the verdict, and verdicts are kept 6 hours, also across restarts of the background.
  - Gmail, Outlook.com and other personal-mail providers, big companies' domains and the user's own organization domain are never judged as a whole, only by exact listed addresses.
- **Emails from flagged senders are moved to Spam**, with Gmail's own Report spam:
  - only **flagged** senders (on a phishing-sender list, domain on a phishing list, or domain blocked by a *security* service). Unverified, unknown, clean and *caution* senders (blocked only by the Cloudflare Family content filter or the AdGuard backup) are never moved;
  - only from the inbox and its category tabs (list or opened), never from Spam, Trash, Sent, labels, searches or All mail, and not in split view;
  - never while the user is typing, has a menu or dialog open, or has selected emails (they would be reported too); it waits and tries again. Its own selection is verified before clicking and undone if anything doesn't match;
  - "Report spam and unsubscribe?" is answered with plain Report spam (unsubscribing confirms an address to a phisher); any other dialog is cancelled;
  - the button is found by its label (English and several other languages), or by Gmail's action number only when its label still says "spam". After three failures, moving stops for the visit and the log says why;
  - **taken back out of Spam stays out:** every conversation is remembered just before it's moved, and so is every one the user takes out of Spam (Not spam, Move to Inbox), whether the extension or Gmail put it there (the newest 20,000, no time limit); none is ever moved (again);
  - only when every other sender in the conversation is flagged (Report spam acts on whole conversations);
  - nothing is moved from the list with Multiple Inboxes or Priority Inbox sections (some sections aren't the inbox) or with a selection in a collapsed section; such emails are moved when opened;
  - the settings, the view, the open conversation and each row's conversation are checked again right before every click;
  - never the organization's phishing-training emails (sender domain in `managedPhishSimulationDomains`; with simulation link domains set, emails are moved only once opened; with `managedPhishSimulationRules`, the headers are checked, and an unread email, whose headers aren't read, is left alone), and never mail from the user's own organization domain unless that exact address is listed (a compromised account).
- **Notice:** "🛡️ 2 emails from flagged senders were moved to Spam. Review ×" at the top of Gmail for 15 seconds (paused while pointed at or focused). **Review** opens Spam. Moves are also in the popup's recent activity and the application log.
- **Every part can be switched off** (all on by default) in the new Settings card **✉️ Senders (Gmail)**, and set and locked by policy: `managedEnableSenderIdentity`, `managedEnableSenderCountry`, `managedEnableSenderDomainCheck`, `managedEnableSenderAddressCheck`, `managedEnableAutoSpam`, `managedEnableSpamNotice`, plus the list `managedPhishingSenders`. They're in `schema.json`, `policy-example.json`, *Copy as policy JSON* and *Copy registry script*. The user's list is included in backups.
- **Privacy:** at most two email headers are read at a time; only a fingerprint of the From address is kept (never the address), deleted after the auto-delete period and by *Delete now*. The country is looked up only while sender icons are shown. Nothing about an email is sent. Only sender domains (to the threat services), site names (to Google's icon service) and delivering servers' IP addresses (to country.is) leave the browser, and none of them at *Offline only*. Headers are read from Gmail itself, and never for unread emails in the list, so checking can't change what Gmail shows as unread.
- **Threat checks:** when the 1.1.1.1 reference lookup can't be made, an NXDOMAIN answer from Cloudflare's filtering resolvers (which block with 0.0.0.0) now counts as "the domain doesn't exist" instead of "checked".
- **New permission:** `https://api.country.is/*` (sender country). Documented in Help → Permissions.
- **Help:** new topic *Sender icons & Spam*; updates to How it works, Your privacy (what is sent), Troubleshooting, Limitations, Deploying, Permissions and the architecture reference (messages, storage keys, network requests). README.md and ADMIN-GUIDE.md (new section *Sender icons and moving phishing to Spam*) updated.
- **Tested** with unit tests (verdict rules, list parsing, country and view rules, background checks, backup) and browser tests of the extension on simulated Gmail inbox and conversation pages: moves only flagged emails, never twice; dialogs; the user's own selection, typing and split view; every view; each switch on and off live; trusted domains; policy-locked switches and lists; phishing-training rules; non-English labels; an address in a subject line; real DNS answers (security block moved, adult filter caution, non-existent domain unknown); real country lookups. Gmail's page structure was simulated from public information, so moving to Spam should be checked on the live site after a Gmail layout change.

## 5.39 — Firefox build (branch `firefox`, based on 5.38)

- **The add-on now targets Firefox 140 or later only.** The entries below describe the Chrome versions this build comes from.
- **Background:** a background event page (`background.html`) replaces the Chrome service worker. The QR/PDF scanner (`scanner.js`) runs in that page, which already has a DOM, so the Chrome offscreen document (`scanner.html`, the `offscreen` permission) is gone. Chrome's built-in `BarcodeDetector` path is removed; the bundled QR decoder reads every code.
- **Manifest:** a Gecko add-on ID and a data-collection declaration replace the Chrome `key`; `managed_schema` and `match_origin_as_fallback` are removed.
- **Enterprise policy:** settings are locked with Firefox enterprise policy (`policies` → `3rdparty` → `Extensions` → add-on ID). Settings → **Copy policies.json** replaces *Copy as policy JSON* (Google Workspace) and *Copy registry script* (Edge/Chrome). `schema.json` is removed; `policy-example.json`, ADMIN-GUIDE.md and Help → Deploying in organizations describe Firefox deployment.
- **Microsoft Intune / Group Policy:** Settings → **Copy Intune script** generates PowerShell that writes the policy to `HKLM\SOFTWARE\Policies\Mozilla\Firefox` (install via `ExtensionSettings`, the add-on's settings as one JSON value under `3rdparty\Extensions`). On/off settings also accept registry DWORD 1/0. Help and ADMIN-GUIDE.md cover Intune, Group Policy and macOS profiles.
- **addons.mozilla.org validation:** no more `innerHTML` with dynamic values: the Link Inspector, the empty cache table and the link marker icons are built with DOM calls (link text can never be parsed as markup). Firefox for Android minimum set to 142, the first version that understands the data-collection declaration.
- **Clean-up:** removed shims for JavaScript features Firefox 140 already has, the retry for a Chromium storage bug, and a Chromium-only style workaround.

## 5.38 — Best practices for phishing training; shared platforms refused as training domains

- **ADMIN-GUIDE.md: the phishing-training section is rewritten around best practice.**
  - **Why** training emails need special handling, and a table comparing the two methods (link domains in every webmail vs. header rules in Gmail), including which can be spoofed.
  - **A best-practice checklist:**
    - use both identifiers;
    - make header rules unforgeable with a secret value or sending addresses;
    - list only vendor-owned root domains;
    - keep the lists current;
    - mirror your mail-filter allow-listing;
    - roll out to a pilot group first;
    - treat tokens as secrets;
    - tell users training emails won't show warnings.
  - **KnowBe4, step by step:**
    - where to find the phish link domains (Phishing → Domains) and the secret header (PST Header Token `X-KB4TOKEN`, or a custom header);
    - ready-to-paste policy;
    - adding hidden new domains to the policy before showing them;
    - the published US sending addresses for setups without a token;
    - Direct Message Injection;
    - links to KnowBe4's documentation.
  - **Wizer, step by step:**
    - its landing domains and sending addresses;
    - its fixed public header `X-TestPhish`, which is why it must be combined with addresses, or left out with Direct Email Delivery (DED);
    - links to Wizer's documentation.
  - **Other vendors:** what to take from their allow-listing guides.
  - **Reference sections** for each policy.
  - **Verifying and troubleshooting,** with a symptom table, and Intune notes.
- **Shared platforms are refused as training domains.** Real phishing is hosted on them, so an email linking only there must never go unchecked. Refused entries are ignored, with a warning in the log naming each one and why:
  - well-known companies' domains (`docs.google.com`, `sharepoint.com`…);
  - public link shorteners (`bit.ly`…);
  - personal email providers;
  - shared hosting or sending platforms (`*.amazonaws.com`, `*.github.io`, `*.web.app`, Mailchimp, SendGrid…).
- Help → Deploying in organizations summarizes the best practice and the refusal.

## 5.37 — Training emails recognized in every webmail, by link domains

- **New administrator policy `managedPhishSimulationDomains`** (schema only; no setting in the extension). It lists the link domains your phishing-simulation vendor uses, which the vendors publish for allow-listing.
  - An email whose links all go to those domains, or their subdomains, is left completely unchecked: no lookups, no pixel blocking, no checks, no banner. It's logged as “Phishing simulation email (links to ssuport.com): left unchecked…”.
  - It works in Gmail, Outlook on the web and every other supported webmail; the header rules from 5.36 need Gmail.
  - **Safety:** one link anywhere else and the email is checked as usual, so a phishing email can't hide behind a training link. A phisher also can't host pages on the vendor's domains, which makes this safer than a public header name.
  - Links rewritten by security gateways (SafeLinks, Proofpoint, Mimecast…) are unwrapped offline first, and look-alike or suffix tricks (“ssuport.com.evil.example”) don't match.
- **Combined with the header rules:** an email matching either policy is left unchecked. With domain rules alone, no message headers are read.
- **Tested with a simulated training campaign** in Gmail and Outlook:
  - two training emails (SafeLinks- and Proofpoint-wrapped, with an open-tracking pixel) were left byte-for-byte untouched;
  - a copycat phishing email containing one training link was checked, and its fake “paypal.com” link marked red;
  - an ordinary email was checked as usual.
- **Documented** in ADMIN-GUIDE.md (new comparison table and section), schema.json, policy-example.json, the README, and Help → Deploying in organizations and Limitations.

## 5.36 — Administrator policies: phishing simulations, a simpler popup

Both features exist only in the policy (schema), with no setting in the extension, as requested. They're documented in ADMIN-GUIDE.md (new section “Administrator-only policies”), schema.json, policy-example.json, the README, and Help → Deploying in organizations and Limitations.

- **Phishing simulation emails are left unchecked (Gmail),** with policy `managedPhishSimulationRules`.
  - Training emails from KnowBe4, Wizer and similar services are recognized by the header the vendor adds (KnowBe4 `X-PHISHTEST` or a token in `X-KB4TOKEN`, Wizer `X-TestPhish`). A rule can also require a secret text in that header, and/or delivery by Gmail from the vendor's sending addresses (IPv4/IPv6 ranges).
  - A matching email is left completely untouched: no link is looked up (the vendor could record a lookup as a click), no tracking pixel is blocked (its open tracking keeps working), and no QR code, attachment or sender check runs. No warning is shown. Each one is logged.
  - **Security:** default headers are public, so real phishing could copy them. A rule with neither a secret value nor addresses is still honored, but logged as a warning. Only the delivery hop written by Gmail's own server counts as the sending address; forged lower lines are ignored.
  - **Direct injection** (KnowBe4 DMI, Wizer DED) has no sending server, so the guide recommends a secret header value for it.
  - While rules are set, an email is checked once its headers are read. If they can't be read, it's checked as usual. The headers are read once per email, shared with the sender checks.
- **A simpler popup.**
  - `managedHidePopupSettingsButton` removes “Open Settings” from the toolbar popup.
  - `managedHideRecentActivity` removes the Recent activity list. Activity is still recorded in Settings → Logging.
  - Settings stays reachable at `chrome-extension://<ID>/options.html`.
- These policies aren't part of user backups, and **Copy as policy JSON** doesn't produce them.

## 5.35 — Merged the repository's offline changes

The GitHub repository (based on 5.32) had documentation and packaging changes; the code there was unchanged from 5.32, so all 5.33 and 5.34 fixes are kept.
- **License:** the project is licensed under the Apache License 2.0 (`LICENSE`), shown in Help → About with a link to the source code.
- **Stable extension ID from source:** `manifest.json` keeps the public `key`, so loading the repository folder gives the same extension ID everywhere. The Chrome Web Store package has it removed, because the store doesn't accept that field.
- **README:** the repository's README, merged with the 5.34 additions:
  - the email banner, the Send check details (names typed alone, quoted text, never holding an email), design rules and testing;
  - three corrections: destinations show in the hover card (not the tooltip), AdGuard is a backup threat filter, and the Private level still sends site names to the DNS threat filters;
  - an explanation of the public `key`.
- **`INSTALL-FOR-TESTERS.md`** is now part of the project.
- **New `.gitignore`** keeps the private signing key (`*.pem`) and build files out of the repository.

## 5.34 — Code review: a draft-safety fix, lighter on resources, more decoders

**Fixes**
- **An email being written is never changed.** In Outlook on the web, the compose editor carries the same “Message body” label as a message being read. The extension could therefore mark links, insert icons and block images inside a draft, and those changes would have been sent to the recipients. Anything editable is now always left alone, in every webmail. A browser test confirms that a draft stays byte-for-byte as typed, and fails without the fix.
- **No false “couldn't be reached” for HTTPS-only sites.** A name typed alone, such as “example.dev”, is checked as http://; many sites only answer over HTTPS, as browsers try first. An http:// address now counts as working if either form answers.
- **Links you send are no longer recorded in History.** History is for links you received.
- **The Send check works in any Gmail language.** It also recognizes Gmail's Send button by its long-stable class, not only by the English label.

**Resources**
- **Sender checks read only the message headers.** Gmail's “Show original” contains the whole message, attachments included (possibly megabytes). Reading now stops when the headers end (at most 512 KB).
- **Repeated links are answered from memory.** A bounded memory of recent results sits in front of the stored cache: in the benchmark, reopening an email with 100 links needs 1 storage read instead of 100.
- **Send-check results are remembered for 10 minutes,** so signature links aren't re-checked, and their websites re-contacted, on every email.

**Decoders and lists**
- New offline decoders: YouTube attribution links (a full outside address in them is refused), Pinterest outbound links, Telegram Instant View.
- Google's share links (share.google, search.app) are recognized as short links.
- Microsoft's link redirector go.microsoft.com (fwlink) is treated as a Microsoft-only link, like aka.ms.

**Documentation**
- New README.md: what the extension does, where each kind of documentation is, the file map, design rules, and how it's tested.

## 5.33 — Fix: domain names typed without http:// are checked before sending

- **Reported:** “test.com” in an email wasn't flagged before sending, although it can't be reached. The check worked only for addresses typed with “http://”, “https://” or “www.”. A name typed on its own, like “test.com”, is plain text while you write (Gmail turns it into a link only when the email is sent), so it was never checked.
  - Names typed on their own are now recognized as Gmail does, including typo endings (“example.con”).
  - To avoid false alarms, only known endings count, and email addresses, file names (“report.zip”, “setup.py”) and words like “Node.js” or “e.g.” are left out.
- **test.com, the DNS case:** the domain is registered but has no address at all (DNS answers “no data”, not “no such domain”). The pre-send check already reports this as “exists but has no website address”; it now gets the chance to.
- **Links that can't work are no longer shown as “Safe”.** An incoming link whose domain doesn't exist, or exists without any IPv4 or IPv6 address, is shown as not verified with the note “can't work”, in the email and in History. IPv6-only sites are not mislabeled.
- **Every pre-send check is logged** (Settings → Logging), listing each link and its result, not just problems. It's now easy to see exactly what was checked.
- Help → Troubleshooting explains “can't work”.

## 5.32 — Check links before sending; Help reorganized

- **Checking links before sending (Gmail).** When you press Send, or Ctrl/⌘+Enter, the links you wrote are checked before the email goes. The quoted original you're replying to is not checked. The checks:
  - Typos: endings such as “.con”, “.cmo”, “.ocm”, “.comm”, “.nte”, “.ogr”; beginnings such as “http//”, “htp://”, “hhtps://”, “http:/”; addresses with no ending; two dots in a row.
  - Look-alike domains of well-known brands, and link text that shows a different website than the link goes to.
  - Whether the domain exists and has a website address (Cloudflare 1.1.1.1, site name only).
  - Whether the site is dangerous, using the full link pipeline: blocklist, phishing lists, DNS threat filters, short links.
  - Whether the website answers. This is one request from your browser, as when your reader clicks; no page is read. Sites that don't answer, or have an invalid security certificate, are reported. It is never done for one-time links.

  If anything's wrong, a dialog lists the links and why, with **Go back and fix** (focused) or **Send anyway**. Emails without links send at once.
- **It never blocks sending on its own failures.** Checks that can't finish (network down, more than 20 seconds) don't hold up the email. If the check itself fails, the email is sent as normal and the failure is logged.
- **It follows the privacy levels.** At Offline only, just typos and look-alikes are checked, with no network request.
- **Setting:** “Check links before sending (Gmail)” is on by default, with policy key `managedEnableSendCheck`.
- **Help reorganized:**
  - “What the warnings mean”, “Your privacy”, “Limitations”, “Permissions” and “Architecture deep dive” are now sub-topics under “How it works”.
  - The new feature is described in How it works, Features, What the warnings mean, Your privacy (with network details), Limitations and Troubleshooting.

## 5.31 — Calmer, clearer in-email display

- **Fewer markings in busy emails.** When an email has five or more Caution (amber) links, they're no longer marked one by one; the banner says it once per kind, for example "6 links in this email show one website but go to another". With fewer, they're marked as before. Dangerous (red) links always keep their red marking and icon, and are also listed in the banner.
- **Banner: "Show details" and "What should I do?"**
  - Both stay closed until clicked, so the banner stays one or two lines.
  - Details lists the links in the email's order (text → real destination, with the reason for dangerous ones). Pointing at an entry highlights the link in the email, and clicking scrolls to it. It also works with the keyboard.
  - "What should I do?" shows short advice that fits the findings.
- **Hover card instead of the browser's slow plain tooltip.** Pointing at (or tabbing to) a checked link shows a small card: the verdict, the real destination, notes, and a **Copy address** button. It's lightweight: one element per page, created on first use, driven by one page-wide listener, with nothing running per link. Escape or moving away closes it. The sender's own link titles are kept exactly as written.
- **QR results:**
  - A web address is now a clickable link (opens in a new tab), unless it's flagged as dangerous.
  - Anything else, such as a one-time code, stays plain text.
  - Every result has a **Copy** button.
  - There's no banner for QR codes alone.
- **Light and dark themes.** Banners, QR and attachment notices, and the hover card follow Gmail's light or dark theme, using soft colors that keep strong contrast. Attachment notices use the same calmer style as the banner.
- Amber links described in the banner open normally; red links still ask before opening.
- Help → What the warnings mean describes the hover card, the banner buttons, many-links summaries and QR results.

## 5.30 — One calm banner per email instead of marking every company link

- **Company links (Google's c.gle, g.co, goo.gle; Microsoft's aka.ms) are no longer highlighted or given an icon,** however many an email contains, so forwarded emails full of them stay readable. Their tooltip keeps only the facts ("Google short link (c.gle). Where it leads couldn't be looked up. Address: …"), with no caution text.
- **One banner at the top of each email,** full width, collecting every finding about the email as a whole.
  - Identical findings are grouped and counted: a forwarded email with 12 company links gets one sentence ("12 Google links (c.gle) in a forwarded part of this email can't be checked…").
  - Sender warnings moved into the same banner, so an email has at most one notice area.
  - The style is calmer: a light background with an amber or red left edge, instead of solid red blocks.
  - Wording adapts to the count ("A Google link … where it leads" / "12 Google links … where they lead").
- **Red cases** (a Google-only link from an unrelated sender, or failed company verification) are still red in the banner, and those links still ask before opening. Amber cases don't.
- **Outside Gmail,** company links are also described in the banner instead of being marked one by one; there the sender can't be verified.
- Help → What the warnings mean and Troubleshooting describe the banner.

## 5.29 — Trust but verify: sender checks (Gmail), limitations documented

- **Company links checked against the sender (Gmail).** A company-only short link (Google's c.gle, g.co, goo.gle; Microsoft's aka.ms) whose destination can't be looked up is now judged by who sent the email:
  - **Unmarked** (only logged as "Verified company link") when Gmail verified the email as sent by that company directly to you. "Directly" means DMARC pass for the company's domain, your address in To/Cc, and not a mailing-list copy. For Google, Microsoft, Apple, Amazon and PayPal, the sending server must also belong to the company, the tell of the 2025 Google DKIM-replay attack.
  - **Amber** in a forwarded or quoted part, in a re-sent or mailing-list copy, or when the email's verification couldn't be read.
  - **Red** for Google-only links (amber for aka.ms, which is copied widely) in mail from anyone else, or when the email claims to be from the company but failed its verification.
- **Sender warnings (Gmail),** shown above the email:
  - red when the sender's name claims a well-known brand (about 35 brands; look-alike letters folded) but the address isn't the brand's
  - red when a brand domain fails its sender verification
  - red when the sender's domain imitates a brand
  - amber when a genuine company notification contains a phone number and payment wording, which attackers abuse (Apple, Microsoft and PayPal cases in 2025–2026)

  People whose names contain brand words ("Chase Miller") and brands' real alternate sending domains (facebookmail.com, microsoftonline.com, youtube.com…) are not flagged.
- **How it reads the verdict:**
  - Gmail's "Show original" for that email, fetched from Gmail itself with your session, only when the email contains a company-only link or a sender name claiming a brand. It is cached per email and nothing is sent elsewhere.
  - Only the topmost Authentication-Results stamped by `mx.google.com` counts (RFC 8601), so forged "pass" headers inside a message are ignored.
  - If the read fails, the sender is treated as not checked (logged once).
  - The new setting "Check who sent the email (Gmail)" is on by default, with policy key `managedEnableSenderChecks`.
- **Sign-in links that redirect elsewhere** (real Microsoft or Google sign-in pages with a `redirect_uri` to another site) are marked Caution.
- **Documentation (planned "Phase 0"):**
  - New Help → **Limitations** section: the lookup-service limits, company links, what site-name threat checks can't judge, opaque gateways, sender checks, the daily lists, QR codes and attachments, other webmail, pixels, and the privacy levels.
  - A recommendation to use your own lookup service, in Help, in Settings → Your own services, and in the log message when a lookup fails.
  - New **Google Web Risk guide** for Google Workspace (Help → Deploying in organizations), with policy JSON. Web Risk and Safe Browsing replies are now recognized, with reasons such as "Phishing (Google Web Risk)".
- The self-hosted lookup service prototype was removed from the extension and handed off as a separate project.

## 5.28 — Unresolved short links shown as Caution

- **A short link whose destination couldn't be looked up is now amber ("Caution")**, with the reason in its tooltip. Previously it only got a note, and a company's own short link (such as Google's c.gle labelled "admin.google.com") showed no warning at all, although its destination was unknown. Example tooltip: "Caution: Google short link (c.gle): its destination couldn't be looked up (too long for unshorten.me, which accepts up to 100 characters)". At the Private and Offline levels, where short links aren't looked up, nothing changes.
- **Reported: c.gle links weren't decoded.** unshorten.me stores addresses in a 100-character field and rejects longer ones ("value too long for type character varying(100)"), and Google's c.gle links are about 130 characters. Such links are no longer sent to unshorten.me at all; your organization's own lookup service is still tried.
- **Failed lookups are remembered.** The same link is no longer looked up, and logged, every time an email is re-scanned (the reported "×24"). It's retried after 30 minutes after temporary problems (network, rate limit), or after a day after permanent ones. This is kept in memory only and limited to 500 links.
- The Link Inspector shows why a lookup failed, and Help → Troubleshooting explains amber short links.

## 5.27 — Two warning levels, company domains, file names

- **Two warning levels for misleading links.**
  - **Caution (new, amber, ⚠ triangle):** link text that shows a different site, raw IP addresses and international characters. Common in legitimate mail, so the text is kept and clicking asks "Caution: … Open it anyway?".
  - **Danger (red, 🛑):** look-alike brand domains, link text showing a well-known brand's address while going elsewhere, and hidden user names. Threats found by security services and phishing lists stay red too.
  - QR-code and attachment link bars use the same two levels. The popup shows a separate **Caution** count, in a 3×2 grid with Not verified in blue so the two can't be confused.
- **Companies' own domains count as one** (Google with Gmail, YouTube and c.gle; Microsoft with aka.ms and Outlook; Amazon, Meta, Apple, LinkedIn, X). Link text and destination within one company no longer cause a warning.
- **Big brands' short-link domains are now looked up** like any shortener: c.gle, g.co, goo.gle, youtu.be, aka.ms, msft.it, amzn.to, amzn.eu, a.co, fb.me, apple.co, spoti.fi, adobe.ly, ebay.to. Reported example: a Google Admin email's `admin.google.com` → `c.gle/…` link was wrongly flagged red and not decoded.
- **File names in link text are recognized as files, not websites.**
  - Covers many more endings that are also real internet domains (.build, .md, .py, .sh, .rs, .app, .zip…).
  - Link text shown as code (`<code>`, `<pre>`…) is never treated as a website claim.
  - Reported example: GitHub's "In meson.build" link was flagged.
- **Help → What the warnings mean** explains both levels and the company short links. The features list is updated.

## 5.26 — Accessible, consistent design (WCAG 2.1 AA) in light and dark

- **One color palette.**
  - Every color in the Options page and the popup now comes from about 30 named design tokens in the new shared `theme.css` (text, muted text, surfaces, borders, accent, success, danger, warning, neutral and switch colors). Dark mode only redefines the tokens.
  - About 55 hard-coded colors and the old piece-by-piece dark-mode overrides (about 60 rules) are gone, including colors set from code, which the old overrides could not reach.
  - Text tokens meet 4.5:1 on every surface they are used on; controls meet 3:1.
- **Fixed in dark mode (reported):**
  - the white WHOIS buttons
  - unreadable "How this link was handled:" in the Link Inspector
  - invisible expand arrows on folded sections
  - unreadable gray and yellow buttons ("Test", "Clear log", "Copy…", "Export log"); text on yellow is now always dark
  - an "on" switch with too little contrast
- **Contrast audit.** A new automated check measures the WCAG contrast of every visible piece of text against its real background, and of the switches. It covers both themes, every tab, every Help topic, every Logging view, the Link Inspector's results, the dialogs and the popup. Result: 0 failures in light and dark mode.
- **Accessibility (WCAG 2.1 AA):**
  - **Names for screen readers:** every switch (31) and the retention-days field are named after their setting; the 10 text fields have labels instead of placeholder-only hints; the ✕ button is named.
  - **Tabs:** proper tab roles, the selected state, and arrow-key / Home / End navigation. The Help and Logging menus announce the current section.
  - **Dialogs:** announced as dialogs with their title, and close with Escape.
  - **Keyboard focus:** an outline is always visible, including on switches.
  - **Structure:** both pages declare their language, and the heading outline no longer skips a level.
  - **Motion:** the system's "reduce motion" setting is respected.
- **Design fixes:**
  - Switches no longer slide from off to on every time a page opens; they appear in their real state and animate only when you click them. Knobs are white in both themes.
  - The Link Inspector tab has an icon like the other tabs (🔍).
  - "Inspect & Decode" → "Inspect link". "Export Logs" → "Export log". The dialog titles are "Restore settings" and "Synced shortener list". "Checked by: Multi-DoH" → "several security services". The popup header uses the product name.
- **Help:** an Accessibility section in About & credits, and an Accessibility group in the features list.

## 5.25 — More webmail, full review, documentation

- **New webmail support (experimental):** Yahoo Mail, AOL Mail, Zoho Mail (all regional sites), iCloud Mail, Fastmail and GMX (gmx.com, .net, .de, .at, .ch, .co.uk, .fr, .es). Each can be switched on or off in Settings → Other webmail and by policy.
  - All supported webmail is described in one table (`WEBMAIL_SITES` in shared.js), shared by the content script and the popup, so a change in a site's layout needs a one-line fix.
  - Messages shown in frames are read from the page when the frame allows it. The extension also runs inside each site's own message frames.
  - iCloud is only active on its Mail pages.
- **Toolbar icon and popup with frames.** Each part of a page (the page and any message frames) now reports its own state, and the background combines them per tab: active if any part shows a message, with counts and statistics added up. The popup asks the background for this combined state instead of messaging the page. After a service-worker restart, the background asks the page again.
- **Reset respects managed settings.** "Reset my settings to defaults" (renamed from "Reset all settings to defaults") now skips every setting managed by Google Workspace, Intune or Group Policy, including the user's stored value underneath it. The confirmation says how many settings were left unchanged.
- **Third-party lists at most once a day.** This applies to all four lists (two shortener lists, OpenPhish, Phishing Army), whatever asks for the update: the daily alarm, installation, re-enabling sync, or "Update now", which now explains when the next update can happen. The phishing lists were previously checked every 6 and 12 hours.
- **Naming and wording:**
  - "Error log entries" → "Application log entries", with the remaining "error log" wording in comments updated.
  - Buttons and headings use sentence case throughout ("Clear log", "Save service", "Test resolver", "Custom threat resolver"…).
  - The popup's "Synced Trackers" is now "Synced shortener domains", and "Show Visual Highlights" is now "Show results on links", matching Settings.
  - The Link Inspector uses plain language ("Where the link goes", "Checked: nothing found", "Flagged: …") and its colors work in dark mode.
  - Tooltips use the full product name.
  - The manifest description is updated.
- **Fixed:** the Link Inspector's progress message showed "goesspection" (a fragment of the previous wording).
- **Help, reorganized and brought up to date:**
  - "For administrators" is merged into "Deploying in organizations" (new section "What can be managed").
  - **Architecture deep dive → Features:** a complete features list by area.
  - **Permissions:** rewritten to cover every permission.
  - **Troubleshooting:** new entries for the grey icon, the once-a-day limit, the other webmail apps and the reset behavior.
  - **How it works:** names all supported webmail.
- **Credits:**
  - License notes for each third-party source.
  - The bundled shortener snapshot is credited to its source lists.
  - Trocker (Apache-2.0), ZXing, pdf.js license file, and the security researchers whose public reports informed the detections.
  - A trademark notice.
- **Code review:**
  - Automated checks for unused functions (256 examined), unused CSS classes (133), missing element IDs, unmatched messages, unused settings and constants, and leftover debugging code. No dead code was found apart from the popup's old count request, which was removed.
  - All HTML built from data is escaped.
  - Every user-facing word was reviewed for spelling.

## 5.24 — Quiet PDF scanning

- **Fixed:** Chrome's Errors page (chrome://extensions → Errors) listed two pdf.js warnings from `scanner.html` after a PDF attachment was scanned. Both were routine notices, not failures:
  - **"Setting up fake worker":** pdf.js runs inside the hidden scanner page by design, because workers don't start reliably in offscreen documents.
  - **"Indexing all PDF objects":** the PDF had a damaged internal index, which pdf.js rebuilds automatically.

  pdf.js now reports errors only, so real problems still appear.
- **Verified:** a normal PDF and a deliberately damaged one are both still fully read (QR code and link found) with no warnings. The same test reproduces the warnings with the previous version.

## 5.23 — Toolbar icon shows when the extension is working

- **Fixed: the badge count stayed after leaving an email.** Gmail keeps opened messages in the page, hidden, when you go back to the inbox or switch labels, and counts only dropped when a message was removed. The badge was also only updated when an email opened.
  - Counts now include only messages that are actually on screen.
  - The state is re-checked on any page change (at most 4 times a second, and only reported when it changes), on Gmail's in-page navigation, when returning to the tab, and when protection is switched on or off.
  - The popup statistics also count only on-screen messages.
- **Active vs. idle icon.**
  - **Active:** the toolbar icon is in full color with the count while an email is open and being checked. Its tooltip says what was done, e.g. "checking this email (2 links fixed or flagged, 1 tracking pixel blocked)".
  - **Idle:** otherwise the icon is greyed out with no count, and its tooltip says it's not active.
  - Grey is the default on every tab and website, and a tab that loads a new page starts out grey.
  - A global "ERR" warning still shows on every tab until it's resolved.
- **Help → What the warnings mean** explains the three icon states.

## 5.22 — Popup statistics, dark mode, deployment guide

- **Popup statistics for the open email.**
  - It shows **Scanned**, **Safe**, **Unsafe**, **Not verified** and **Unscanned** links. Scanned = safe + unsafe + not verified.
  - "Not verified" means checked but not confirmed safe, for example an email tracking link or unreachable security services. "Unscanned" means still being checked or not checkable.
  - Only web links count (not `mailto:` or in-page anchors). Disabled `javascript:`/`data:` links count as unsafe.
  - "Links cleaned" and "Tracking pixels blocked" stay on a single line.
- **Dark mode** for the popup and the Options page, with an **Appearance** selector (Follow system (default) / Light / Dark) in both. The choice is remembered and shared by both pages, and applied before the page draws, so there's no flash. Everything has dark styles, including the architecture diagram, badges and status cards. The setting is a personal preference, so it isn't part of backups or policies.
- **Help → Deploying in organizations.** Step-by-step instructions for:
  - choosing a distribution route (Chrome Web Store, Edge Add-ons, the Chrome Web Store version in Edge, self-hosting)
  - Google Workspace: force install and Policy for extensions JSON
  - Microsoft Edge with Intune: Settings catalog force install or ExtensionSettings, plus extension settings via the registry and a platform script
  - Chrome on Windows with Intune
  - verification and tips

  The admin guide summarizes them.
- **New: "Copy registry script"** (Settings → Backup & Google Workspace). It generates a PowerShell script that writes your current settings as extension policy for both Edge and Chrome:
  - on/off settings and numbers as REG_DWORD
  - text as REG_SZ
  - the allowed and blocked site lists as numbered values in a subkey

## 5.21 — Research follow-up: new resolvers, phishing lists, attachment and QR detections

- **New free security resolver: Control D (malware), on by default.** Free, no account, blocklists rebuilt every 30 minutes.
  - **DNS4EU Protective** is available as an option (off by default; intended for individuals).
  - Both use RFC 8484 and are read with one generic DNS answer reader. A sinkhole address, or "does not exist" for a name that really exists, counts as a block.
  - Mullvad DNS (shutting down 2026-11-02) and dns0.eu (discontinued) were deliberately not added.
- **Local phishing lists, on by default.**
  - The OpenPhish community feed (exact phishing URLs, every 12 hours) and Phishing Army (phishing hostnames, every 6 hours, CC BY-NC 4.0) are downloaded and matched on the device. Nothing about you is sent.
  - Same safeguards as the shortener lists: size limits, a minimum size, and the previous copy is kept when a download fails or looks broken.
  - Major sites are never blocked by these lists, and shared hosting is never blocked from a single URL entry.
  - List verdicts are never cached, so delisted sites recover immediately.
  - "Offline only" turns the lists off. URLhaus and ThreatFox were excluded: they now require an account key.
- **Look-alike domains.** Links are flagged when their site name imitates a well-known brand:
  - look-alike characters, including Cyrillic or Greek letters in punycode domains, decoded locally
  - a one-letter typo (amazom.com)
  - "paypal.com.something.xyz"
  - the brand name plus words like "login" or "secure"

  Real brand domains, their subdomains and regional versions (paypal.co.uk) are never flagged.
- **Attachments (checked on the device):**
  - **SVG and HTML files:** scripts, auto-redirects, code obfuscation (atob/eval), forms posting elsewhere, password fields and pre-filled victim addresses are flagged "⛔ DO NOT OPEN". Hidden destinations, including base64-encoded ones, are extracted and checked.
  - **Calendar invites (.ics):** links in the invite are checked.
  - **Encrypted ZIP/RAR archives:** a warning, since mail filters can't scan inside them.
  - **File names:** names with hidden text-direction characters (e.g. "invoice‮fdp.exe") are flagged.
  - **Finding attachments:** download links are used as a fallback when Gmail's attachment attribute is missing.
- **QR codes drawn without an image.** Phishing campaigns draw QR codes with HTML tables or block characters (█▀▄) to dodge image scanners. These are now found, turned back into a QR grid and decoded, including light-on-dark drawings.
- **Risky links.** `javascript:`, `data:`, `vbscript:`, `blob:` and `file:` links in emails are disabled and marked.
- **Gateways:**
  - New decoders: **Libraesva UrlSand** (`urlsand.esvalabs.com/?u=`) and **Forcepoint Remote Browser Isolation** (`rbi.forcepoint.net/loader?url=`).
  - Named as protected (destination stored by the service): Hornetsecurity, SpamTitan LinkLock, Vade, Intermedia LinkSafe / Proofpoint Essentials, Zix/AppRiver; INKY shows its destination domain.
  - ShareASale links without a scheme are handled.
- **Proton Mail.** Messages are now read from the parent page, because Proton's sandboxed message frames don't allow extension scripts to run inside them.
- **Efficiency.** The phishing lists are loaded once and shared by all links of an email (100 links: 103 storage reads, 2 writes). The new checks run only when relevant content is present: tables of at least 21×21 cells, block characters, or attachments.
- **Settings and help:**
  - New settings with Workspace policy keys: "Check links against phishing lists" (with "Update now" and entry counts), Control D, DNS4EU. The attachment and QR descriptions are updated.
  - Help: new "What the warnings mean" entries, updated privacy and network tables, list status under "This installation right now", and new credits (Control D, DNS4EU, OpenPhish, Phishing Army CC BY-NC 4.0, pdf.js, tracker-list projects, ZXing techniques).
- **New permissions:** `unlimitedStorage` (the phishing lists can be several MB), plus access to freedns.controld.com, protective.joindns4.eu, openphish.com and phishing.army.

## 5.20 — QR codes, attachments, cloud-storage phishing, pixel fixes, more webmail

- **QR codes in emails (your issue #3).** QR codes in email images are now read on the device and their destination is checked like a link.
  - A bar under the image shows where the code leads: grey for "not verified", green for "checked, nothing found", red "⛔ DO NOT SCAN" when the destination is flagged (the image also gets a red outline).
  - Images are read from Google's image proxy, never from the sender's server.
  - QR images are no longer mistaken for tracking pixels.
  - Only QR-shaped images (8 per message) and large posters (3 per message) are scanned, so ordinary banners cost nothing.
- **Attachments (your issue #1).** Image and PDF attachments (up to 10 MB, first 10 pages) are opened on the device, using your own Gmail session, to find QR codes. Links inside PDFs are listed and checked too. Nothing is uploaded.
- **How QR reading works:**
  - The QR decoder is new, self-contained and has no dependencies. Chrome's built-in detector is used where it exists (macOS, ChromeOS).
  - PDFs are rendered with pdf.js (Mozilla, Apache-2.0), bundled in `lib/`. Small shims in `compat.js` cover recent JavaScript features pdf.js uses that some Chrome versions lack.
  - All of this runs in a hidden scanner document that is created on demand, runs at most 2 scans at a time, and closes after 1 minute idle.
  - Tested against all 40 QR versions × 4 error-correction levels (158/158), 244/244 realistic images (posters, banners, rotation, perspective, blur, JPEG, colored, inverted, logos) with no false readings, and full Reed-Solomon correction.
- **Cloud-storage phishing pages (your issue #2).**
  - Links to web pages in public buckets (Google Cloud Storage, Firebase Storage, S3, Azure Blob, R2, IPFS) are flagged "DO NOT CLICK". DNS filters never block these domains, so they used to show as safe.
  - Hidden data after "#" (base64 tracking IDs or a recipient's address, as in the documented 2026 spam kit) is decoded and shown, and the link is marked "pre-targeted".
  - Firebase Hosting, Cloudflare Pages and Azure Static Websites are flagged only when they carry such hidden data.
  - A 🔍 on Google Cloud Storage and Firebase Storage links reads the page's code on request, without running it and without sending the "#" data, to find where it redirects. For the kit in your notes, that's a hard-coded IP address.
  - These pages are never treated as one-time links, whatever their wording.
- **Tracking pixels (your issue #5).** The Boston Scally newsletter lost 16 of its 21 real images because `cdn.klaviyomail.com` is on the tracker list and a domain match overrode the size check.
  - **Added:** open-pixel address rules that apply at any size. They cover SendGrid, Mailchimp, HubSpot, Brevo, Salesforce Marketing Cloud, Postmark, Mailgun, Marketo, ActiveCampaign, Shopify Email, Amazon SES, Klaviyo (brand-domain `/o/<id>`) and generic `trk.`/`t.` `/open` trackers.
  - **Changed:** an image larger than 20 px is never a pixel. Tracker-domain matches now only count for small or unknown-size images.
  - **Removed:** the broad host-prefix rule (`c.`, `s.`, `e.`, `click.`…) and the short-path rule (`/l`, `/r`, `/c`…), which caused false positives.
  - **Verified:** all 21 content images of that email are kept and its 1×1 tracker is still removed.
- **Outlook on the web and Proton Mail (experimental, your issue #4).** Link checking and pixel blocking also run there. QR scanning only reads images those sites host themselves. There's a switch for each, and Workspace policy keys. These sites could not be tested here, so please report what you see.
- **Decoder fixes from the research:**
  - Avanan's versioned `/v2/r0N/` links, including its "https:/" quirk.
  - Trend Micro links whose destination is unencoded, so its own "&" no longer cuts it short.
  - Barracuda's base64-encoded destinations.
  - Mimecast's newer `mimecastprotect.com` links, with the destination-domain hint.
  - New: Google Meet `linkredirect` (abused in 2026 phishing chains) and Google Ads `aclk`/`iclk`/DoubleClick `pcs/click` variants.
- **unshorten.me** stays enabled by default as before.
- **New settings:** "Check QR codes in emails" and "Check attachments", plus the Outlook and Proton switches. "Offer to reveal" now also covers cloud pages. All have policy keys.
- **New permissions (Chrome asks once):**
  - `offscreen`, for the hidden scanner document.
  - Access to `*.googleusercontent.com`, to read Gmail's proxied images for QR codes.
  - Access to `storage.googleapis.com` and `firebasestorage.googleapis.com`, for on-request page inspection.
  - The Outlook and Proton sites.

## 5.19 — Full code review: performance, correctness, cleanup

**Resource use (measured on one email with 100 links, 15 different sites and a 5,000-domain synced list):**

| | Before | After |
|---|---|---|
| DNS requests | 520 | 60 (one round per site) |
| Storage reads | 400 | 102 |
| Storage writes | 170 | 2 |
| Toolbar badge updates | one per link and pixel | one per burst |

- **Shared checks.** Links to the same site checked at the same moment now share one round of DNS requests.
- **Remembered verdicts.** Flagged verdicts are remembered as well as safe ones (never "unknown"). The memory is capped at 1,000 sites and cleared whenever settings change.
- **Settings read once.** Settings are read once and kept in memory until they change, instead of being re-read for every link. Lookup tables built from the synced list (thousands of domains) are built once per settings version, not several times per link.
- **Combined writes.** Log entries, history entries and cached results for a whole email are combined into one storage write, about half a second after the burst.
- **Smaller messages to Gmail.** Gmail no longer receives the full synced shortener list (thousands of domains) with every scan; it never used it.
- **Gmail tab:**
  - An image that finishes loading late now checks only itself. Previously every late image re-scanned every image in every open message.
  - The page observer skips nodes that can't contain a message before searching them.
  - Badge updates are coalesced.
- **Options page:**
  - The Settings tab now re-renders only when settings or lists change. New log entries refresh only the status card, and cache writes made while Gmail is in use are ignored.
  - The architecture page refreshes at most once a second while visible, and reads the bundled snapshot file once.

**Bugs fixed:**
- **Conversations.** Opening another message in a conversation wiped the earlier messages' state, so the highlights toggle no longer reached their links and the badge undercounted. State is now kept for messages still on screen and released for messages Gmail removes, and counts are computed from what's displayed.
- **Settings changes.** Switching a resolver off (for example Cloudflare Family) didn't take effect until the service worker restarted, because earlier verdicts were reused. The verdict memory is now cleared on any settings change.
- **Quad9.** Server errors (SERVFAIL, REFUSED…) were counted as a successful security check and could contribute to "safe". Only real answers count now, and other replies are logged as warnings. A hostname ending in a dot also produced a malformed Quad9 query.
- **Link Inspector.** "Not verified" results (such as email trackers) are now shown on a neutral card instead of a green one.
- **Downloads.** Two CSV exports never released their download's memory.

**Cleanup:**
- Removed the unused `scanLinks` message handler, the service worker's `activate` handler (navigation preload doesn't apply to extensions), leftover `reservedKeys` filters, the Gmail console "loaded" message, and five unused CSS rules from the old Privacy tab.
- Spelling is now consistently American (recognize, behavior, analyze). No misspellings were found.
- Added header comments describing each file's role.
- **Icons added** (16, 32, 48, 128 px), shown in the toolbar and on the extensions page. The Chrome Web Store requires them.
- Help's architecture page documents the caching and batching ("Efficient by design").

## 5.18 — Reveal email tracking links on request

- **New: 🔍 on email tracking links.** Point at a link from Brevo, SendGrid, Klaviyo, Mailchimp or similar, and a small blue 🔍 appears beside it.
  - **Stays out of the way.** The icon is hidden until the link is hovered, so newsletters with dozens of links stay uncluttered. It's also reachable with the keyboard (Tab, then Enter).
  - **Asks first.** Clicking the icon asks before doing anything. The prompt names the provider and the service the link will be sent to (unshorten.me, or your own unshortener), and says plainly that the sender will see it as a click. Cancelling sends nothing.
  - **After revealing:** the link points straight at its real destination, keeps its text, and the tooltip says where it goes. The destination is checked like any other link: it's flagged in red if dangerous or if it contradicts the link's text (for example text "paypal.com" leading elsewhere), and clicking it then asks first. Revealing never opens the link, and reveals are never cached.
  - **Never offered for unsubscribe, sign-in or other one-time links,** or when the privacy level doesn't allow online lookups (Private, Offline only).
  - **Controls:** Settings → Links → More options → "Offer to reveal email tracking links" (on by default), and the Workspace policy key `managedEnableTrackerReveal`. When it's off, tracking links are never sent anywhere.
  - Unrevealed tracking links are not counted as "cleaned" on the toolbar badge.
- The blocklist reveal and the tracker reveal now share one implementation, as does "ask before opening a flagged link".
- New file `content.css` (shows the 🔍 on hover). Help and the architecture deep dive document the reveal, including the updated lookup rules and network table.

## 5.17 — Honest tracker reporting, Logging tab, layout fixes

- **Email click trackers are recognized and reported honestly.**
  - Links from Brevo/Sendinblue (`sendibm*.com`, `sendibt*.com`), Klaviyo, and SendGrid or Mailchimp on a company's own "branded" domain (for example `ablink.r.sofi.com/ls/click?upn=…`) are now recognized by provider domain families and path signatures, not just a fixed domain list.
  - Their destination is stored by the email provider and can't be decoded; SendGrid's code was confirmed to be encrypted. Learning it would mean following the link, which registers a click as the recipient, so they are still never followed or sent anywhere.
  - Previously they were logged and cached as "Safe" by "Zero-Touch Scanner", although only the tracker's own domain had been checked. They are now "Not verified: email tracking link", with the provider named in the link tooltip, History and Link Inspector. They're still flagged if the tracker's domain itself is malicious, and are never cached.
  - Older History rows of this kind are relabeled, and cached results from earlier versions are cleared once.
  - A tracker whose text names another site (for example `wired.com`) no longer risks a false "misleading link" warning.
- **"Zero-Touch Scanner" is gone.** Results say what actually happened: "Direct link (checked only)", the decoder that unwrapped the link, "unshorten.me", or "Email tracker (provider), not followed".
- **History and URL cache:**
  - No more duplicate addresses. When a link didn't need unmasking, the destination column says "Same as original" (no second copy and no copy button), "Not revealed (email tracking link)", or "— (tracking image, not a link)" for pixels.
  - Statistics strips: History shows links checked, unmasked, flagged, not verified, email trackers, pixels blocked and entries kept. The URL cache shows cached links, decoded offline, looked up online, direct links, flagged, oldest entry and storage used. The application log shows errors, warnings and info in the last 24 hours and entries kept. Counts use the same rules as the tables, so they always agree.
  - The URL cache now updates live while the page is open (newest first). Previously new entries appeared only after typing a filter.
  - Wider Status columns.
- **Logging tab.** "Error Logs", "History" and "URL Cache" are now one Logging tab with the same side-menu layout as Help: Application log · History · URL cache. The log is titled "Application Log", since it holds warnings and routine events as well as errors. All links and messages that pointed to "Error Logs" now point to Logging → Application log.
- **Allowed & blocked sites:** proper spacing under the card heading. Both columns now share one grid, so their headings, descriptions, input boxes and "Site" table headers line up exactly whatever the text length.

## 5.16 — Popup fix

- **Fixed: "Open Settings" in the toolbar popup did nothing when clicked soon after opening the popup.** The popup connected its buttons only after loading settings. Since 5.10, that loading step can wait a few seconds in browsers that are slow to answer the first read of policy storage, and during the wait the button was dead.
  - Buttons are now connected immediately, and the counts and highlight switch fill in afterwards.
  - The button is now also a real link to the Settings page, so it works even if the popup's script fails entirely. When the script is running, it reuses an already-open Settings tab instead of opening a second one, and then closes the popup.
  - If the standard way of opening Settings fails, the popup falls back to a new tab and records a warning in Error Logs.

## 5.15 — Redesigned Options page and Help

- **Tabs:** Settings · Link Inspector · History · URL Cache · Error Logs · Help. Features, Privacy, Resolvers and Domain Policies are merged into **Settings**; Privacy and Credits are replaced by **Help**.
- **Settings** is one page in three layers:
  - **Status card.** For example: "Protection is on · Privacy level: Standard · Threat checks on · Shortener list updated 2 hours ago". It turns amber or red, with a link to Error Logs, when threat checks are unavailable or errors occurred.
  - **Privacy level.** Standard (default), Private (no link sent to any lookup service) or Offline only (nothing leaves the browser). Changing an individual switch shows "Custom", and levels blocked by policy are marked.
  - **Grouped sections.** Links, Tracking pixels, Lookups & threat checks, Allowed & blocked sites, Data on this device, and Backup & Google Workspace. Advanced options (threat-check services, your own services, backup and policy) are folded away by default.
  - **Also:** a one-time dismissible "New here?" line, "Reset all settings to defaults", lock notes that say "🔒 Set by your organization", plain-language labels, and an "Update now" link for the shortener list. Previously the list update existed in code but nothing in the interface could trigger it, and it reported success even when it failed.
  - **Removed:** the duplicate tracking-pixel switch and the header import/export buttons, which moved to Backup.
- **Help** has eight sections: How it works, What the warnings mean, Your privacy (with a live "what is sent, to whom, on or off now" table and a goal-to-setting guide), Troubleshooting, For administrators, Architecture deep dive, Permissions, and About & credits.
- **Architecture deep dive**, for researchers and technicians:
  - **Design and structure:** design principles, a component diagram, a file map, and the 13-step link pipeline with function names.
  - **Engines:** the threat-check engine and verdict rules, short-link lookup rules, misleading-link and pixel heuristics, and community-list safeguards.
  - **Interfaces:** every network request, internal messages, storage layout, the logging model, the full settings and policy reference, and platform APIs.
  - **Live state:** a snapshot of this installation.
  - **Generated from the running code:** tables marked LIVE (decoders and the redirect table, one-time regular expressions, resolvers, list safeguards, network requests, settings, logging limits, installation state) are built from the code itself, so they cannot drift from the installed version. Shared constants moved to `shared.js` to make this possible.

## 5.14 — Complete, categorized logging

- **Every failure now reaches the Error Logs tab.**
  - Previously only list-sync failures did. Everything else was silent or went only to the developer console.
  - Now recorded: unreachable DNS resolvers (each one, with the reason), use of the AdGuard backup, links shown as "not verified" and why, and unshorten.me failures (including rate limits).
  - Also: custom resolver and unshortener errors, with hints for bad API keys and missing permission; crashes while analysing a link; cache write failures (for example, full storage); and the bundled snapshot failing to load.
  - Also: install, update and scheduled-task failures, uncaught errors in the background, Options page and popup, and failures in the Gmail content script. Only this extension's own failures are captured from Gmail, never Gmail's.
  - Options page problems are recorded too: unreadable or rejected backup files, refused host permissions, failed resolver tests and clipboard failures.
- **Levels and sources.**
  - Each entry is Error (needs attention), Warning (worked around) or Info (routine: list updates, cleanup, restores, settings changes, install and update).
  - Each entry names its source, shows the full date, and can be filtered by level.
  - Repeats within 10 minutes are counted (×N) instead of flooding the log, which now keeps 200 entries instead of 20.
  - The CSV export includes level, source and count.
- **Privacy.** Error messages contain only a link's site (`https://host/…`), never its path or query.
- **Everything in its right place:**
  - The popup's activity feed now receives errors only; warnings and routine events stay in the Error tab. Routine storage cleanup was previously shown there as an "Error".
  - Resolution History no longer calls unverified links "Safe": they show "Not verified" with the reason.
  - Tracking pixels are no longer listed as "Unsafe" links; they show "Tracking pixel removed" or "neutralized".
  - Blocklisted links are now recorded (once per 10 minutes) as "Blocked", like other flagged links.
  - Entries from earlier versions are displayed correctly. The history CSV export shows the same statuses plus which service resolved each link.
- **Retention.** The error log and popup activity now follow the "Delete data automatically after" setting, like the cache and history.
- The Error Logs and Resolution History tabs update live while the Options page is open.

## 5.13 — Bring-your-own resolvers

- **New: custom unshortener** (Resolvers tab, or by policy). It's your own service for expanding short links, tried before unshorten.me.
  - It receives exactly the links unshorten.me would. One-time links, email-provider links and unrevealed blocklisted links are never sent.
  - The reply is read automatically from common fields (`resolved_url`, `long_url`, `final_url`, `destination`, `url`; also one level down) or from a plain-text reply. Optionally, name the field yourself.
  - "Fall back to unshorten.me" (on by default) can be switched off to keep short links away from unshorten.me entirely.
  - The reveal prompt for blocklisted links names the exact services the link will be sent to.
- **Custom threat resolver now works with real threat APIs.**
  - It now supports POST requests, request bodies and request headers (for API keys).
  - A `{url}` placeholder sends the full link, for URL-based APIs. One-time links still only ever send their domain.
  - Replies are understood automatically for DNS-over-HTTPS, Google Safe Browsing (`matches`, and `{}` for clean), URLhaus (`query_status`) and simple `malicious`/`blocked` APIs. An optional "Flag field" covers anything else.
  - An error reply (for example an invalid API key) now counts as "no answer". Previously, any well-formed reply counted as "clean".
  - Results from a resolver that receives full links are cached per link, not per domain.
  - The URLhaus example in the Resolvers tab previously could not work, because it needs POST. It now does, and complete example configurations are given for DNS-over-HTTPS, URLhaus, Google Safe Browsing and Bitly.
- **Both custom endpoints:**
  - Each has a Test button that tests the form as typed, before saving, and reports exactly what came back.
  - Saving asks the browser for access to that one host.
  - Every new setting has a Workspace policy key (see `schema.json` and the admin guide).
- **API keys are protected.** Request headers set by policy are masked in the Options page, and headers are never written to backups or changed by a restore.

## 5.12 — More offline decoding

All decoders now live in `decoders.js`. Each identifies its format by exact host and path, never by text elsewhere in the URL. Formats marked *[verify]* were built from published documentation and examples, not real samples; if one is wrong, the link simply isn't decoded.

- **Security gateways** (also used for one-time links, because they return the complete original URL): Barracuda Link Protection, Sophos *[verify]*, Trend Micro, Symantec/Broadcom *[verify]*, Cisco Secure Email *[verify]*, Check Point Harmony Email/Avanan *[verify]*, and Microsoft Teams SafeLinks. These are in addition to Proofpoint, Microsoft SafeLinks and Amazon SES.
- **Platform, search, advertising and affiliate redirects:**
  - Social and community sites: Facebook link warning, Messenger, Instagram, Threads, Reddit, Steam, Tumblr, VK, Medium and Disqus *[verify]*.
  - Search engines: Bing click links (widely abused in phishing), Yahoo and DuckDuckGo.
  - Google: AMP pages, and the Translate proxy (also abused in phishing).
  - Advertising: Google Ads and DoubleClick *[verify]*.
  - Shopping: Amazon email links and eBay.
  - Affiliate networks: Awin, Rakuten, CJ, Impact, Partnerize, Skimlinks and ShareASale.
- **Encoded JSON payloads** (Substack, Mandrill, Customer.io and similar trackers): decoded only when the payload contains exactly one web address, so an unsubscribe link can never be picked by mistake.
- **Destinations written into the path** of known redirect and tracking hosts.
- **Short links expanded offline**, with no lookup: youtu.be (tracking parameter removed), redd.it, dai.ly, flic.kr and instagr.am.
- **Recognized but not decodable:** Mimecast links (including the destination domain when Mimecast includes it), Fortinet links and email-provider trackers are explained in the link tooltip and the Link Inspector.
- **Fixes found while testing:**
  - The base64 decoder (from 5.8) could pull a link out of a larger encoded payload and attach fragments of that payload to it. It now refuses when the link is embedded in other data.
  - Destinations written unencoded into a URL path were percent-decoded anyway, corrupting characters such as `%20`. This affected the Amazon SES decoder since 5.8.
  - Double-encoded destinations are now handled.

## 5.11

- **Auto-update safeguards for the community shortener lists** (fully automatic, no maintenance needed):
  - Each list is tracked separately, so one list being unreachable never removes the other's domains.
  - Domains newly added to a list are held until they have appeared on three separate days. Repeated "Force Sync" clicks do not shorten this. Domains removed from a list stop being used immediately.
  - A download that changes more than 25% of a list at once (minimum allowance: 250 entries) is not applied, and the event is logged. A genuine large change is accepted automatically once 7 days pass without a successful sync.
  - The first download is used in full as the starting point. The same applies after sync has been off, or has failed, for more than 7 days, so a stale list is never compared with today's.
  - Turning sync back on (by the user, a restored backup or a policy change) syncs immediately.
  - Sync results are written to the Error Logs tab as diagnostics, not to the popup's activity feed.
- **Bundled snapshot** (`shortener-snapshot.txt`): a fresh install has shortener coverage immediately, even with no network. It is used as a fallback until each list has been downloaded once. Users upgrading from 5.10 keep their current list as the fallback instead. The snapshot currently holds a starter set of well-known shorteners; `tools/refresh-snapshot.js` replaces it with the full community lists.
- **Safer backups and restores:**
  - Backups (format 2) contain only settings the user actually changed, so defaults always come from the installed version.
  - Older backups no longer switch the Cloudflare Family filter off. They cannot show whether it was off deliberately, so it is left on and the user is told.
  - Cached link results are never restored; they are rebuilt automatically.
  - Imported domains are normalized and capped at 5,000 per list. A custom resolver that is not `https://` is rejected.
  - "Overwrite" now also returns settings missing from the backup to their defaults.
  - The restore dialog lists exactly what will be skipped and why.

## 5.10

- **Cloudflare Family is on by default again.** Adult sites are flagged as "DO NOT CLICK". Users can still turn it off unless the policy locks it.
- **AdGuard is now a backup resolver.** It is queried only when none of the security resolvers (Quad9, Cloudflare Security, custom) can be reached, so it normally sees no lookups at all. A match then flags the link, except on known email-tracker and shortener hosts, which AdGuard blocks by design. Results from the backup alone are not cached, so the primary resolvers are retried next time.
- **Blocklisted links are hidden, not resolved.**
  - A link on a blocklisted domain is flagged immediately. It is not decoded, DNS-checked or sent to unshorten.me.
  - A 🔍 icon next to the link asks whether to reveal its destination, and says whether anything will be sent to a third party.
  - Only after confirmation is the link decoded and, if it is a short link and third-party resolution is on, looked up.
  - Revealing never opens the link, and the link stays flagged. One-time-link protection still applies during a reveal, and reveals are never cached.
- The 5.9 amber "advisory" notes are removed. Every resolver now either flags a link or stays silent.
- Cached results are cleared once on upgrade, because Family verdicts changed.
- **Options page fix (pre-existing bug).** In testing, the first read of policy storage on page load never returned. The Options page then showed every switch as off, and changing a switch was not saved. Storage reads now time out and retry once; in testing the retry always got a real answer, so policy locks still apply.

## 5.9 — Security hardening

- **Scan bypass closed.** Links are skipped only when their parsed host is `mail.google.com`. Previously any link merely containing that text was never scanned.
- **Wrapper decoders match by exact host.** Proofpoint, SafeLinks, SES and the Google, Facebook, LinkedIn, Slack and YouTube shims no longer match text anywhere in the URL, so a link can no longer pose as a SafeLinks or Google redirect.
- **SafeLinks double-decoding fixed.** Destinations containing `%25` were corrupted, and a bare `%` caused decoding to fail.
- **Both hosts are checked.** The destination and the link's own host are both checked, so the verdict covers wherever the click actually goes, including when visual highlights are off.
- **Generic redirect decoding is limited to real redirect and tracking hosts.** Social share links (Facebook, LinkedIn, X, Pinterest…) are no longer rewritten to the article.
- **Sender styling is preserved.** Each link's original inline style, title and inner markup are restored exactly, so styled call-to-action buttons are no longer blanked.
- **The blocklist now blocks.** A link whose own host or destination is blocklisted is flagged with no lookup needed. The blocklist wins over the allowlist and is re-applied on cache hits. Blocklist verdicts are never cached, so removing a domain takes effect immediately.
- **Severity tiers.** (Superseded in 5.10.)
- **Synced shortener lists are treated as untrusted.**
  - Lists are capped at 2 MB and 50,000 entries.
  - Entries for major sites are ignored.
  - A domain that is only on a synced list is sent to unshorten.me only for URLs shaped like short links.
  - Synced lists no longer suppress warnings or remove images.
- **Tracking-parameter cleanup** no longer re-encodes URLs that had nothing to remove.
- **One-time migration.** Results cached by 5.8 are cleared once, because verdicts are now computed differently, and the stored synced list is re-sanitized.
