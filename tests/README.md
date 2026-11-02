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
| `WAIT_SCALE=3 node run-all.js` | Every wait's deadline times 3, for a slow computer (GitHub's runners) |
| `node --test unit/unit.test.js` | Only the unit tests |
| `PART=flaky node e2e/test-stuck.js` | One part of a suite on its own |

On GitHub, the **Tests** workflow (`.github/workflows/tests.yml`) runs the unit tests and every
suite on each push to `testing` and `main`; when it fails, the logs are under the run's Artifacts.

### The Firefox suite

`firefox/run.js` runs the **Firefox build** (the `firefox` branch) in real Firefox, through
puppeteer-core and WebDriver BiDi, on the same simulated pages: the background page and its QR/PDF
scanner, the spam mover's clicks into Gmail, message frames, permission requests (Firefox accepts them
only directly inside a click), site access switched off, and enterprise policy. On this branch (the
Chrome build) it only says so and stops; on the `firefox` branch GitHub runs it on every push, in the
current Firefox ESR and in 140 ESR, the oldest version the add-on supports. Locally (Linux):

```bash
firefox/get-firefox.sh
```

```bash
node firefox/run.js
```

| Command | What it does |
| --- | --- |
| `firefox/get-firefox.sh 140` | Downloads 140 ESR into `.firefox/140` (default: the current ESR, `.firefox/esr`) |
| `FXBIN=.firefox/140/firefox/firefox node firefox/run.js` | Runs in that Firefox |
| `FXEXT=/path/to/firefox-build node firefox/run.js` | Tests another checkout of the Firefox build |

Each suite's full output is in `logs/<suite>.log`. The runner remembers how long each suite took
(`.timings.json`) and starts the slowest first next time.

## Layout

- `run-all.js`: the parallel runner.
- `e2e/harness.js`: starts Chromium with the extension, serves the simulated pages, and has the
  helpers below.
- `e2e/test-*.js`: the suites. `e2e/fake-*.html`: simulated Gmail (list and opened email),
  Outlook and Yahoo pages, and a webmail that shows messages in frames (`fake-proton.html`).
- `firefox/`: the Firefox suite (`run.js`), its harness and `get-firefox.sh`.
- `unit/unit.test.js`: unit tests (`node:test`, `fake-indexeddb` for the icon store).
- `fixtures/*.eml`: raw emails for the header checks. They come from real phishing samples, with
  every real domain and address replaced by a placeholder (`*.example`, `example.org`).
  `fixtures/qr.png`, `qr.pdf`: a QR code, and a PDF with that QR code and a link, for the scanner.

## Writing tests

- **No fixed pauses, ever.** A pause is a guess at how long something takes: it passes on a fast
  computer and fails on a slow one (GitHub's runners). `run-all.js` refuses to start while a test
  contains `sleep(` or `waitForTimeout(`, unless the line says `allow-sleep` and why (only for
  pauses that are the scenario itself, such as the user clicking every 2 seconds).
- **Something will happen: wait for it.** `waitFor(fn)` polls until `fn` returns something truthy;
  `until(read, cond)` reads until the condition holds and returns what it read. A passing check
  finishes as soon as the page gets there; a failing one reports what it last saw.
- **Nothing should happen (nothing moved, no warning): wait until the extension is done.** The
  content script counts its work in progress (messages to the background waiting for an answer,
  emails' source or attachments being read, a scan waiting to run, moves queued or running) and
  shows it as `<html data-unshortener-busy="N">`; `settled(page)` waits until it reads 0 twice in a
  row, then the check can look. Moves parked until the user changes something (the view, a
  selection) don't count; why queued moves are waiting is `<html data-unshortener-spam-wait>`
  (`selection`, `recent activity`, `view`, `paused`…), which a test can wait for directly. A page that
  never settles fails the test, with what was still pending.
- **Helpers:** `ready(page)` (the extension is running on the page: start adding emails),
  `settled(page)`, `listSettled(page, sw, moves)` (a simulated inbox: `moves` emails moved and
  recorded, then settled), `optionsReady(opt)` (Settings has loaded and bound every control). The
  toolbar popup marks `<html data-loaded>` once its settings are applied.
- **Deadlines only decide when to give up.** `WAIT_SCALE` multiplies every deadline (GitHub uses 3);
  a wait that succeeds still returns at once.
- **Long suites are split into parts** with `part(name, fn)` and `runParts()`. Each part starts its
  own browser, and the runner runs the parts in parallel like separate suites.
- **Nothing can hang:** each suite ends itself after `SUITE_TIMEOUT` seconds, and the runner kills
  it and its browser. A missing element fails within 10 seconds (`STEP_TIMEOUT`).
- **Use placeholder data only:** `example.com/.org/.net`, `*.example`, `*.test`. Never a real
  person's address.
- The extension's id is read from the browser (`new URL(sw.url()).host`), never written into a test.
