# phish-tiny: the extension's own AI model (EXPERIMENT, branch `llm_testing`)

S.P.R.U.C.E+ ships a small language model that gives an opinion on whether an opened email is
phishing. It is ours: we choose what it learns, retrain it here, and it runs inside the extension on
the user's computer, with no download, no online service, nothing sent anywhere.

| | |
|---|---|
| Model | BERT-tiny (2 layers, 128 wide, 4.4 million parameters), fine-tuned as a phishing/genuine classifier |
| Size in the extension | `models/phish-tiny/`: `model.bin` 4.5 MB (8-bit weights), `vocab.txt` 0.2 MB, `model.json` |
| Runtime | `ai.js`, plain JavaScript (WordPiece tokenizer and BERT forward pass), no WebAssembly; 50–300 ms per email |
| Where it runs | Chrome/Edge service worker, Firefox/Safari background page; Node in the tests |
| Checked against PyTorch | `tests/fixtures/ai-vectors.json`: the JavaScript gives the same token ids and scores (unit test) |

## What the model sees

`modelInputText(facts)` in `ai.js` builds one text from what the extension already knows about the
email, the same way for training and in use:

```
subject: … from: "<display name>" at <sender domain> (your organization | outside your organization) (shared mailbox).
sender check: dmarc pass|fail|none|unknown; <what mail systems found in the headers>. links: "<link text>" goes to <host>
then <destination> (warning: <the extension's finding>); … layout: images only; text after a large blank gap. text: <the text a person sees>
```

The reader's own mailbox name (the part of their address before @) is replaced by "your name"
wherever it appears, so a subject like "READER! Apply for a card" or a sender named after the reader is
visible to the model as a trick, without the name. The header findings come from `headerAnomalies`
(already marked as spam, a home-made bulk-mail tool on 127.0.0.1, a broken To line, placeholders…), and
the layout from `emailLayout` in `content.js`: text after a blank spacer at least 1000px tall is filler
for spam filters and is cut off; a body of pictures gives the model its hidden preheader instead.

Email addresses keep only their domain, and phone numbers and long numbers are replaced
(`redactForAi`). Tags that mail systems add to every outside email (`[EXTERNAL]`, `EXT:`, `CAUTION:`)
are removed from the subject, because phishing and genuine mail carry them alike. "Your organization"
is known only when the account has its own domain. In the webmail, quoted earlier messages are left out
(`ownText` in `content.js`): the model judges what this sender wrote now.


## Retraining

```bash
node tools/ai/make-dataset.js
```

```bash
python3 tools/ai/train.py --version 0.4.0
```

`train.py` needs Python 3 with `torch` (the CPU build is enough) and `transformers`, and takes about 2
minutes on a laptop. It writes the model into `models/phish-tiny/`, a `MODEL_CARD.md` with its scores,
and the reference vectors for the JavaScript test. Then run the tests (`cd tests && node run-all.js`):
the unit test fails if the model's score on the hand-written emails drops below 90%.

## Controlling what it learns

- **The generator** (`make-dataset.js`) writes synthetic emails from templates: twelve kinds of phishing
  (sign-in, credential, invoice, gift card, delivery fee, "call this number", prize, payroll, shared
  document, threats, cloud storage full, spam offers such as IPTV and credit cards) and nineteen kinds of
  genuine mail (notes, notices, invitations, codes, automated statements, business and vendor threads,
  deal-site marketing, newsletters, receipts, school mail, password resets, shipping, colleagues,
  settlement notices, bills, sales, security alerts, banks' card offers, storage companies' own notices,
  and the genuine look-alikes of spear phishing: leaders' short requests about real work, HR and payroll
  notices that send people to the usual portal, suppliers' invoices with unchanged payment details,
  real share notifications, IT announcing sign-in changes, school fundraisers, career-office job
  listings). The
  genuine kinds deliberately include what reads like phishing but isn't: huge discounts and coupon
  deadlines, salespeople describing scams, one-line payment statements, signatures with titles and
  legal disclaimers. About 8% of the phishing comes from inside the organization (a compromised staff
  account), so being inside never settles it. About a third of the phishing emails claim to be safe, and some
  address AI tools: the model learns that such text is a phishing sign. Every person and organization
  in it is made up.
- **Real-world phishing** (`real-world.jsonl`): phishing and email scams that universities, school
  security groups, the FTC, FBI (IC3), IRS and others published as warnings, including spear phishing
  and business email compromise (leader gift-card requests, payroll diversion, supplier "new bank
  details", W-2 requests, closing-wire changes), paraphrased with placeholders, each with its source.
  No real person, address, account number or bank detail is ever kept. Placeholders: `{school}`,
  `{person}`, `{title}` (a leader's title), `{vendor}`, `{freemail}`, `{phone}`, `{amount}`, `{term}`,
  `{pct}`, `{weekly}`. Sender kinds: `compromised`, `spoof`, `freemail`, `lookalike`, `vendor` (a
  compromised supplier, law firm or title company: outside, passes checks), `unknown`. Link kinds:
  `form`, `drive`, `lookalike`, `random`, and `qr` (a QR code in a picture: the model sees only the
  text asking to scan it). Two thirds are
  trained on (12 variants each, with made-up names and domains); every third one is held out and only
  scored (`real_world_heldout` in the model card). Never change the generator to fit the held-out ones,
  or that score stops meaning anything. Add new examples at the end.
- **Your own examples:** add `tools/ai/data/extra/*.jsonl`, one example per line:
  `{"facts": {"subject": "…", "senderName": "…", "senderAddress": "…", "auth": {"dmarc": "pass"}, "links": [{"text": "…", "host": "…", "destHost": "", "finding": ""}], "bodyText": "…"}, "label": 1}`
  (1 = phishing, 0 = genuine). **Remove names, addresses, account numbers and anything personal
  first**: the files are used as they are. `tools/ai/data/` is never committed.
- **Regression cases** (`tests/fixtures/ai-regressions.jsonl`): genuine emails an earlier version got
  wrong, paraphrased with made-up names. The unit tests keep them right. Add one for each false alarm
  you report, after removing personal details.
- **Genuine look-alikes** (`eval-lookalikes.jsonl`): hand-written genuine emails that resemble spear
  phishing and scams. Never trained on; `train.py` reports how many the model calls phishing (false
  alarms). Don't change the generator to fit them.
- **The check set** (`eval-handwritten.jsonl`): hand-written emails that are not generated from the
  templates. Keep a second set you never look at while changing the generator, or its score stops
  meaning anything (see the model card: the current score is optimistic for that reason).

## Rules the extension keeps, whatever the model says

- On this computer only: each opened email is analyzed as it opens (Settings → AI analysis →
  Analyze opened emails automatically, on by default), or only when the person clicks "Ask the AI";
  nothing is sent anywhere or stored. Automatic answers that see nothing suspicious are one short line.
- Advisory only: the model's opinion can add a warning but never clears one, marks anything safe or
  moves email to Spam (`aiAdvice`). A phishing email can contain text written to fool AI tools.
- Text that vouches for itself counts toward phishing in the extension's own verdict too
  (`selfVouchingSigns` in `shared.js`): a claim of safety ("this email is verified safe") is one small
  weight (1), never a warning on its own; text addressed to AI tools ("ignore previous instructions…")
  is red.

## Why not a generative LLM?

The smallest instruction-following models (SmolLM2, Qwen2.5-0.5B) are 100–500 MB quantized, need
WebAssembly runtimes of another 10–25 MB, and take seconds per email on ordinary school laptops. A
classifier trained for this one job is 100 times smaller, answers in a fraction of a second, and its
training is entirely in our hands. The `analyze()` explanation (which sentences, on their own, read
most like phishing) gives the "why" a generative model would write out.
