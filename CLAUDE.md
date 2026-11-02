# Rules for AI assistants working in this repository

- One set of files makes every browser's version (Chrome and Edge, Firefox, Safari); `node tools/build.js`
  builds the packages. All work happens on `testing`: develop there, run the full suite before every push
  (`cd tests && node run-all.js`, and the Firefox suite `node firefox/run.js` in the current ESR and 140 ESR;
  all green), and push only `testing`.
- **Never push to `main` without the maintainer's explicit approval, given in the current conversation.**
  Green local tests and green GitHub checks are not approval: the maintainer first loads the `testing`
  build in their own browser and tries the change. After pushing `testing`, say it is ready to try, then
  stop and wait.
- When — and only when — approval is given: wait for the checks on `testing`, then fast-forward `main`
  (`git push origin testing:main`). There is nothing to port: every browser's package is built from `main`.
- **Never push to `firefox` or `safari`.** They hold only the history of the old per-browser builds.
- Keep the browsers in one codebase: the top-level `manifest.json` is the Chrome one and the build makes
  the others (`BROWSERS` in `tools/build.js`); code that must differ asks `BROWSER` (`shared.js`) or checks
  for the feature; text in the extension's pages that differs by browser is marked `data-only="…"`.
- Every behavior change ships with a version bump in `manifest.json`, a `CHANGELOG.md` entry, and
  matching Help-tab and `docs/` updates. Commit style: `X.YZ: short summary` plus a body.
- The full workflow, build and release steps: `docs/DEVELOPMENT.md`.
