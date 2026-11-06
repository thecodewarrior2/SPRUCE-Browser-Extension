# phish-tiny 0.6.0 (EXPERIMENT, branch llm_testing)

A BERT-tiny classifier (prajjwal1/bert-tiny, 2 layers, 4.4 million parameters) fine-tuned to tell phishing from
genuine email, from the facts the extension collects (subject, sender name and domain, DMARC result,
links and their checks) and the email's text with addresses and numbers redacted. Trained 2026-11-06
by `tools/ai/train.py` with 4 epochs at learning rate 0.0002; weights stored in 8 bits.

**Training data:** 11696 emails from `tools/ai/make-dataset.js`: synthetic ones from its templates, and variants
of two thirds of `tools/ai/real-world.jsonl` (phishing and email scams that universities, school groups,
the FTC, FBI, IRS and others published as warnings, including spear phishing and business email
compromise; paraphrased, with made-up names; no real email, personal data or bank details), plus any
examples in `tools/ai/data/extra/`.

**Scores of the exported model**

| Set | Accuracy | Precision | Recall | False alarms | Missed |
|---|---|---|---|---|---|
| Synthetic test (1500, same templates, other seed) | 0.9993 | 1.0 | 0.9987 | 0 | 1 |
| Hand-written (33, not from the templates) | 1.0 | 1.0 | 1.0 | 0 | 0 |
| Real-world, held out (231: 3 variants of each of 77 published examples never trained on; all phishing) | 0.9437 | - | 0.9437 | - | 13 |
| Genuine look-alikes (24, hand-written, never trained on; all genuine) | 0.7917 | - | - | 5 | - |
| Real-world genuine, held out (33: 3 variants of each of 11 published genuine emails never trained on) | 0.6667 | - | - | 11 | - |

Hand-written emails it got wrong: none.
Held-out real-world examples it missed (any variant): real:cybernut-student-doc-for-review, real:gmu-negative-feedback-dispute, real:ironscales-k12-adobe-phonics-share, real:rutgers-conference-purchase-report, real:spiceworks-customer-sends-share-link, real:threatdown-microsoft-unusual-signin, real:uoft-zoom-invite, real:uvic-benefits-guide-qr.
Genuine look-alikes it called phishing: look:docusign-lease (0.999), look:voicemail-phone-system (0.979), look:helpdesk-ticket (0.999), look:password-expiry-real (0.545), look:donation-receipt (0.996).
Held-out published genuine emails it called phishing (any variant): real:brown-google-password-breach-genuine, real:brown-lab-results-portal-genuine, real:docusign-envelope-security-code-genuine, real:ms-support-case-update-genuine.

**Limits:** the synthetic score mostly measures how well it learned the templates. The hand-written
score is the better check, but it is small, and it is OPTIMISTIC: while building this experiment the
generator was improved after looking at which hand-written emails the model got wrong, so those emails
have partly shaped the training.

The genuine look-alikes (`tools/ai/eval-lookalikes.jsonl`) are the false-alarm check: genuine mail that
resembles spear phishing and scams (a leader asking for a call, payroll and closing notices that mention
deposits and wires, real DocuSign, Microsoft and PayPal notices). They were written alongside the
generator's genuine look-alike kinds, by the same hand, so the score is somewhat optimistic; they are
never trained on, and the generator is not changed to fit them. Model 0.4.0 called 10 of these 24
phishing.

The real-world held-out set is the most honest number for missed phishing, with three caveats: it is all
phishing (it measures missed phishing, not false alarms); it is small (variants of 77 published examples, mostly
aimed at universities); and its variants get the same random sender, layout and wording changes as the
training data. It was never trained on, and the generator was not changed to fit it, but its score was
seen between training runs (model 0.5.0, before the forum and published genuine examples were added:
228 of 231 on this set; it judged only 6 of the 33 held-out genuine variants right).

**Regression cases** (`tests/fixtures/ai-regressions.jsonl`): emails earlier versions got wrong, reported
by the maintainer and paraphrased without personal data: genuine ones (a deal-site newsletter, a security
vendor's sales thread, an automated district reimbursement statement) and missed spam (a credit-card
offer in pictures, a fake cloud-storage notice, an IPTV offer); plus genuine look-alikes of that spam (a
store coupon in pictures, a bank's card offer, a real storage-full notice). The generator was extended
because of them, so they are a regression check, not an independent score. Real-world accuracy needs
real, labelled, de-identified examples (add them in `tools/ai/data/extra/`). English only. Advisory only
in the extension: it never clears a warning or moves email.
