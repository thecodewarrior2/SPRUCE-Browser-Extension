# Rules for AI assistants working in this repository

- All work happens on `testing`: develop there, run the full suite (`cd tests && node run-all.js`,
  all green) before every push, and push only `testing`.
- **Never push to `main`, `firefox` or `safari` without the maintainer's explicit approval, given in
  the current conversation.** Green local tests and a green GitHub check are not approval: the
  maintainer first loads the `testing` build in their own browser and tries the change. After pushing
  `testing`, say it is ready to try, then stop and wait.
- When — and only when — approval is given: wait for the **Unit and browser tests** check on
  `testing`, fast-forward `main` (`git push origin testing:main`), then cherry-pick to `firefox` and
  `safari`, resolving their known differences (no `docs/ARCHITECTURE.md`; CHANGELOG headings suffixed
  "(Firefox/Safari build, same as Chrome X.Y)"; branch-specific `manifest.json` without the Chrome
  `key`; the local scanner block in `background.js` instead of the offscreen document), run each
  branch's tests (units on the branch; e2e with `EXT=` pointing at a Chrome-build checkout; on
  `firefox`, also the Firefox suite, `node tests/firefox/run.js`, in the current ESR and 140 ESR), and push.
- Every behavior change ships with a version bump in `manifest.json`, a `CHANGELOG.md` entry, and
  matching Help-tab and `docs/` updates. Commit style: `X.YZ: short summary` plus a body.
- The full workflow, build and release steps: `docs/DEVELOPMENT.md`.
