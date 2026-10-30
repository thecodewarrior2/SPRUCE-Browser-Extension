# Tests

Unit tests (Node) and end-to-end tests (Playwright with Chromium, on simulated webmail pages). They
are not part of the extension package (`.gitattributes` leaves this folder out of the zips).

```bash
cd tests && npm install
```

```bash
node run-all.js
```

The runner runs every suite in parallel, as many at a time as the computer has CPUs, and prints one
line per suite with its checks and time, then a summary. A full run takes about 2 minutes on 4 CPUs.

| Command | What it does |
| --- | --- |
| `node run-all.js avatars stuck` | Only the suites whose name contains one of the words |
| `EXT=/path/to/build node run-all.js` | Tests another build of the extension (default: this repository) |
| `JOBS=2 node run-all.js` | At most 2 suites at a time |
| `SUITE_TIMEOUT=300 node run-all.js` | Time limit per suite in seconds (default 240) |
| `node --test unit/unit.test.js` | Only the unit tests |
| `PART=flaky node e2e/test-stuck.js` | One part of a suite on its own |

Each suite's full output is in `logs/<suite>.log`. The runner remembers how long each suite took
(`.timings.json`) and starts the slowest first next time.

## Layout

- `run-all.js`: the parallel runner.
- `e2e/harness.js`: starts Chromium with the extension, serves the simulated pages, and has the
  helpers below.
- `e2e/test-*.js`: the suites. `e2e/fake-*.html`: simulated Gmail (list and opened email),
  Outlook and Yahoo pages.
- `unit/unit.test.js`: unit tests (`node:test`, `fake-indexeddb` for the icon store).
- `fixtures/*.eml`: raw emails for the header checks. They come from real phishing samples, with
  every real domain and address replaced by a placeholder (`*.example`, `example.org`).

## Writing tests

- **No fixed pauses for things that will happen.** Use `waitFor(fn)` (polls until `fn` returns
  something truthy) or `until(read, cond)` (reads until the condition holds, returns what it
  read), so a passing check finishes as soon as the page gets there and a failing one reports
  what it last saw. `listSettled(page, sw, moves)` waits for a simulated inbox to finish: until
  `moves` emails were moved and recorded, or, when none should move, until the badges are drawn and
  long enough for a move to have happened.
- **A fixed pause is right only for "nothing happens"** checks (nothing moved, no click): wait for
  the page to be ready first, then about 2–3 seconds (moves come about 2 seconds after loading).
- **Long suites are split into parts** with `part(name, fn)` and `runParts()`. Each part starts its
  own browser, and the runner runs the parts in parallel like separate suites.
- **Nothing can hang:** each suite ends itself after `SUITE_TIMEOUT` seconds, and the runner kills
  it and its browser. A missing element fails within 10 seconds (`STEP_TIMEOUT`).
- **Use placeholder data only:** `example.com/.org/.net`, `*.example`, `*.test`. Never a real
  person's address.
- The extension's id is read from the browser (`new URL(sw.url()).host`), never written into a test.
