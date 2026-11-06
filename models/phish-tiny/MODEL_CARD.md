# phish-tiny 0.3.0 (EXPERIMENT, branch llm_testing)

A BERT-tiny classifier (prajjwal1/bert-tiny, 2 layers, 4.4 million parameters) fine-tuned to tell phishing from
genuine email, from the facts the extension collects (subject, sender name and domain, DMARC result,
links and their checks) and the email's text with addresses and numbers redacted. Trained 2026-11-06
by `tools/ai/train.py` with 4 epochs at learning rate 0.0002; weights stored in 8 bits.

**Training data:** 8000 synthetic emails from `tools/ai/make-dataset.js` (made-up people and
organizations; no real email or personal data), plus any examples in `tools/ai/data/extra/`.

**Scores of the exported model**

| Set | Accuracy | Precision | Recall | False alarms | Missed |
|---|---|---|---|---|---|
| Synthetic test (1500, same templates, other seed) | 1.0 | 1.0 | 1.0 | 0 | 0 |
| Hand-written (33, not from the templates) | 1.0 | 1.0 | 1.0 | 0 | 0 |

Hand-written emails it got wrong: none.

**Limits:** the synthetic score mostly measures how well it learned the templates. The hand-written
score is the better check, but it is small, and it is OPTIMISTIC: while building this experiment the
generator was improved after looking at which hand-written emails the model got wrong (short "sign in
today" phishing; genuine IT notices, invitations and code emails), so those emails have partly shaped
the training. A fresh set of hand-written or real (de-identified) emails, never looked at while
changing the generator, is needed for an honest score.
Known miss: a one-line "Please sign in at example.com today." from "IT Support" at an unknown domain
scores about 13% (below the 50% caution line); with an ordinary-looking domain and no link warning,
one short sentence is too little for it.

**Regression cases** (`tests/fixtures/ai-regressions.jsonl`): genuine emails earlier versions got wrong,
reported by the maintainer and paraphrased without personal data (a deal-site newsletter, a security
vendor's sales thread, an automated district reimbursement statement). The generator was extended
because of them, so they are a regression check, not an independent score. Real-world accuracy needs real, labelled,
de-identified examples (add them in `tools/ai/data/extra/`). English only. Advisory only in the
extension: it never clears a warning or moves email.
