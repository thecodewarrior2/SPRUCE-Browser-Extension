#!/usr/bin/env python3
"""tools/ai/train.py — EXPERIMENT (llm_testing): trains the phish-tiny model and exports it for the
extension.

    node tools/ai/make-dataset.js                        # writes tools/ai/data/*.jsonl
    python3 tools/ai/train.py [--base prajjwal1/bert-tiny] [--epochs 4] [--lr 2e-4]

Needs: torch, transformers (CPU is enough: a few minutes). Writes:
    models/phish-tiny/model.bin, model.json, vocab.txt    the model the extension loads (8-bit weights)
    models/phish-tiny/MODEL_CARD.md                        what it was trained on and how well it does
    tests/fixtures/ai-vectors.json                         token ids and PyTorch's outputs for sample
                                                           texts, so the JavaScript runtime (ai.js) is
                                                           tested against PyTorch itself
The base model is BERT-tiny (Google's BERT miniatures, MIT licence as published by prajjwal1).
"""
import argparse, json, math, os, random, struct, time
from pathlib import Path

import torch
from transformers import BertTokenizer, BertForSequenceClassification

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(__file__).resolve().parent / 'data'
OUT = ROOT / 'models' / 'phish-tiny'
MAX_LEN = 256


def read(name):
    return [json.loads(l) for l in (DATA / name).read_text().splitlines() if l.strip()]


def batches(rows, tok, size, shuffle):
    rows = rows[:]
    if shuffle:
        random.shuffle(rows)
    for i in range(0, len(rows), size):
        part = rows[i:i + size]
        enc = tok([r['text'] for r in part], truncation=True, max_length=MAX_LEN, padding=True, return_tensors='pt')
        yield enc, torch.tensor([r['label'] for r in part])


@torch.no_grad()
def evaluate(model, tok, rows):
    model.eval()
    probs = []
    for enc, _ in batches(rows, tok, 64, False):
        probs += torch.softmax(model(**enc).logits, -1)[:, 1].tolist()
    tp = sum(1 for p, r in zip(probs, rows) if p >= .5 and r['label'] == 1)
    fp = sum(1 for p, r in zip(probs, rows) if p >= .5 and r['label'] == 0)
    fn = sum(1 for p, r in zip(probs, rows) if p < .5 and r['label'] == 1)
    acc = sum(1 for p, r in zip(probs, rows) if (p >= .5) == (r['label'] == 1)) / len(rows)
    return {'accuracy': round(acc, 4), 'precision': round(tp / max(1, tp + fp), 4), 'recall': round(tp / max(1, tp + fn), 4),
            'false_positives': fp, 'false_negatives': fn, 'n': len(rows)}, probs


def quantize_rows(w):
    """Symmetric 8-bit, one scale per row (output unit)."""
    scale = w.abs().amax(dim=1).clamp(min=1e-8) / 127.0
    q = torch.round(w / scale[:, None]).clamp(-127, 127).to(torch.int8)
    return q, scale.float()


def export(model, tok, args, metrics):
    OUT.mkdir(parents=True, exist_ok=True)
    sd = {k: v.detach().float().cpu() for k, v in model.state_dict().items() if 'position_ids' not in k}
    blob, tensors = bytearray(), []

    def align():
        while len(blob) % 4:
            blob.append(0)

    deq = {}
    for name, t in sd.items():
        # Large matrices (embeddings, dense layers) in 8 bits; biases, LayerNorm and the small
        # classifier in 32-bit floats.
        if t.dim() == 2 and t.numel() >= 4096:
            q, s = quantize_rows(t)
            align(); off = len(blob); blob += q.numpy().tobytes()
            align(); soff = len(blob); blob += s.numpy().astype('<f4').tobytes()
            tensors.append({'name': name, 'shape': list(t.shape), 'dtype': 'i8', 'offset': off, 'scales': soff})
            deq[name] = q.float() * s[:, None]
        else:
            align(); off = len(blob); blob += t.numpy().astype('<f4').tobytes()
            tensors.append({'name': name, 'shape': list(t.shape), 'dtype': 'f32', 'offset': off})
            deq[name] = t
    (OUT / 'model.bin').write_bytes(bytes(blob))
    c = model.config
    manifest = {'name': 'phish-tiny', 'version': args.version, 'base': args.base, 'labels': ['genuine', 'phishing'],
                'trained': time.strftime('%Y-%m-%d'), 'metrics': metrics,
                'config': {'hidden': c.hidden_size, 'heads': c.num_attention_heads, 'layers': c.num_hidden_layers,
                           'intermediate': c.intermediate_size, 'eps': c.layer_norm_eps, 'maxLen': MAX_LEN, 'vocab': c.vocab_size},
                'tensors': tensors}
    (OUT / 'model.json').write_text(json.dumps(manifest, indent=1) + '\n')
    vocab = tok.get_vocab()            # vocab.txt: one token per line, in id order (what ai.js reads)
    (OUT / 'vocab.txt').write_text('\n'.join(t for t, _ in sorted(vocab.items(), key=lambda kv: kv[1])) + '\n')
    return deq


@torch.no_grad()
def vectors(model, tok, deq, rows):
    """Reference outputs of the 8-bit model the extension loads, for the JavaScript tests."""
    model.load_state_dict({**model.state_dict(), **deq})
    model.eval()
    out = []
    samples = rows[:6] + [{'text': 'Café résumé naïve — "quoted" text, URLs like https://ex-ample.com/a?b=1 & emoji \U0001F600 and 中文!', 'label': 0}]
    for r in samples:
        ids = tok(r['text'], truncation=True, max_length=MAX_LEN)['input_ids']
        logits = model(input_ids=torch.tensor([ids])).logits[0].tolist()
        out.append({'text': r['text'], 'ids': ids, 'logits': logits})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='prajjwal1/bert-tiny')
    ap.add_argument('--epochs', type=int, default=4)
    ap.add_argument('--lr', type=float, default=2e-4)
    ap.add_argument('--batch', type=int, default=32)
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--version', default='0.1.0')
    args = ap.parse_args()
    random.seed(args.seed); torch.manual_seed(args.seed)
    torch.set_num_threads(os.cpu_count() or 4)

    train, test, hand = read('train.jsonl'), read('test.jsonl'), read('eval.jsonl')
    # BERT-tiny publishes only its uncased vocabulary, so the tokenizer is set up explicitly.
    tok = BertTokenizer.from_pretrained(args.base, do_lower_case=True, model_max_length=MAX_LEN)
    model = BertForSequenceClassification.from_pretrained(args.base, num_labels=2)   # its config names no model type
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    steps = args.epochs * math.ceil(len(train) / args.batch)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / (0.06 * steps)) * max(0.0, 1 - s / steps))
    t0 = time.time()
    for ep in range(args.epochs):
        model.train()
        total = 0.0
        for enc, labels in batches(train, tok, args.batch, True):
            loss = model(**enc, labels=labels).loss
            loss.backward(); opt.step(); sched.step(); opt.zero_grad()
            total += loss.item()
        m, _ = evaluate(model, tok, test)
        h, _ = evaluate(model, tok, hand)
        print(f'epoch {ep + 1}: loss {total:.1f}  test {m}  hand-written {h}  ({time.time() - t0:.0f}s)', flush=True)

    m_test, _ = evaluate(model, tok, test)
    deq = export(model, tok, args, {})
    vec = vectors(model, tok, deq, test)
    # Scores of the exported 8-bit model (what the extension actually runs).
    m_test, _ = evaluate(model, tok, test)
    m_hand, p_hand = evaluate(model, tok, hand)
    metrics = {'synthetic_test': m_test, 'hand_written': m_hand}
    manifest = json.loads((OUT / 'model.json').read_text()); manifest['metrics'] = metrics
    (OUT / 'model.json').write_text(json.dumps(manifest, indent=1) + '\n')
    (ROOT / 'tests' / 'fixtures' / 'ai-vectors.json').write_text(json.dumps(vec) + '\n')
    wrong = [(r['kind'], round(p, 3)) for r, p in zip(hand, p_hand) if (p >= .5) != (r['label'] == 1)]
    print('8-bit model:', json.dumps(metrics))
    print('hand-written mistakes:', wrong)
    (OUT / 'MODEL_CARD.md').write_text(f"""# phish-tiny {args.version} (EXPERIMENT, branch llm_testing)

A BERT-tiny classifier ({args.base}, 2 layers, 4.4 million parameters) fine-tuned to tell phishing from
genuine email, from the facts the extension collects (subject, sender name and domain, DMARC result,
links and their checks) and the email's text with addresses and numbers redacted. Trained {time.strftime('%Y-%m-%d')}
by `tools/ai/train.py` with {args.epochs} epochs at learning rate {args.lr}; weights stored in 8 bits.

**Training data:** {len(train)} synthetic emails from `tools/ai/make-dataset.js` (made-up people and
organizations; no real email or personal data), plus any examples in `tools/ai/data/extra/`.

**Scores of the exported model**

| Set | Accuracy | Precision | Recall | False alarms | Missed |
|---|---|---|---|---|---|
| Synthetic test ({m_test['n']}, same templates, other seed) | {m_test['accuracy']} | {m_test['precision']} | {m_test['recall']} | {m_test['false_positives']} | {m_test['false_negatives']} |
| Hand-written ({m_hand['n']}, not from the templates) | {m_hand['accuracy']} | {m_hand['precision']} | {m_hand['recall']} | {m_hand['false_positives']} | {m_hand['false_negatives']} |

Hand-written emails it got wrong: {', '.join(f'{k} ({p})' for k, p in wrong) or 'none'}.

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
""")


if __name__ == '__main__':
    main()
