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
subject: … from: "<display name>" at <sender domain> (shared mailbox). sender check: dmarc pass|fail|none|unknown.
links: "<link text>" goes to <host> then <destination> (warning: <the extension's finding>); … text: <the email's text>
```

Email addresses keep only their domain, and phone numbers and long numbers are replaced
(`redactForAi`), before the model sees anything, in training and in use.

## Retraining

```bash
node tools/ai/make-dataset.js
```

```bash
python3 tools/ai/train.py --version 0.3.0
```

`train.py` needs Python 3 with `torch` (the CPU build is enough) and `transformers`, and takes about 2
minutes on a laptop. It writes the model into `models/phish-tiny/`, a `MODEL_CARD.md` with its scores,
and the reference vectors for the JavaScript test. Then run the tests (`cd tests && node run-all.js`):
the unit test fails if the model's score on the hand-written emails drops below 90%.

## Controlling what it learns

- **The generator** (`make-dataset.js`) writes synthetic emails from templates: ten kinds of phishing
  (sign-in, credential, invoice, gift card, delivery fee, "call this number", prize, payroll, shared
  document, threats) and thirteen kinds of genuine mail (notes, notices, invitations, codes,
  newsletters, receipts, school mail, password resets, shipping, colleagues, settlement notices,
  bills, sales, security alerts). About a third of the phishing emails claim to be safe, and some
  address AI tools: the model learns that such text is a phishing sign. Every person and organization
  in it is made up.
- **Your own examples:** add `tools/ai/data/extra/*.jsonl`, one example per line:
  `{"facts": {"subject": "…", "senderName": "…", "senderAddress": "…", "auth": {"dmarc": "pass"}, "links": [{"text": "…", "host": "…", "destHost": "", "finding": ""}], "bodyText": "…"}, "label": 1}`
  (1 = phishing, 0 = genuine). **Remove names, addresses, account numbers and anything personal
  first**: the files are used as they are. `tools/ai/data/` is never committed.
- **The check set** (`eval-handwritten.jsonl`): hand-written emails that are not generated from the
  templates. Keep a second set you never look at while changing the generator, or its score stops
  meaning anything (see the model card: the current score is optimistic for that reason).

## Rules the extension keeps, whatever the model says

- On this computer only: each opened email is analyzed as it opens (Settings → AI analysis →
  Analyze opened emails automatically, on by default), or only when the person clicks "Ask the AI";
  nothing is sent anywhere or stored. Automatic answers that see nothing suspicious are one short line.
- Advisory only: the model's opinion can add a warning but never clears one, marks anything safe or
  moves email to Spam (`aiAdvice`). A phishing email can contain text written to fool AI tools.
- Text that vouches for itself ("this email is verified safe", "ignore previous instructions…")
  counts toward phishing in the extension's own verdict too (`selfVouchingSigns` in `shared.js`).

## Why not a generative LLM?

The smallest instruction-following models (SmolLM2, Qwen2.5-0.5B) are 100–500 MB quantized, need
WebAssembly runtimes of another 10–25 MB, and take seconds per email on ordinary school laptops. A
classifier trained for this one job is 100 times smaller, answers in a fraction of a second, and its
training is entirely in our hands. The `analyze()` explanation (which sentences, on their own, read
most like phishing) gives the "why" a generative model would write out.
