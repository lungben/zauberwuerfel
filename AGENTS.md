# AGENTS.md

3×3 Rubik's cube in the browser: plain HTML + ES5-style vanilla JS. No package
manager, no build step, no bundler, no CI. Everything must run from `file://`
by double-clicking `index.html` — tested in Chrome and Firefox.

## Hard constraints (break the app if violated)

- **No ES modules, no Web Workers, no remote resources.** JS files are plain
  `<script src>` tags in `index.html`, loaded in dependency order
  (three → cube-state → color-scheme → scramble → solver-* → cube3d → ui → main).
- Each `js/*.js` is an IIFE attaching to the shared `window.ZW` namespace
  (`ZW.Cube`, `ZW.Cube3D`, `ZW.App`, …). Keep `var`-style ES5 syntax.
- `vendor/three.min.js` (Three.js r158, UMD) is committed — never add a CDN link.
  `tools/bauen.py` hard-fails on any `http(s)://` script/stylesheet source.
- **Code, comments, UI text and test labels are in German.** Keep it that way.

## Commands

- Bundle for distribution: `./tools/bauen.py` → `dist/zauberwuerfel.html`
  (single file, `dist/` is gitignored). `./tools/bauen.py -s tests/app.html`
  bundles any test page the same way — used to prove bundling is behavior-neutral.
- Tests are HTML pages in `tests/`, opened in a browser. Headless terminal check:
  `./tests/run.sh tests/selftest.html "" 900` — args: page, URL hash, window
  height; writes a PNG under `$TMPDIR` (default `/tmp/opencode/`).
- Full machine-readable run (exit 0/1): `python3 tests/ci.py [seite …]` — drives
  headless Firefox through geckodriver (starts one if none listens on :4444) and
  reads all result lines via `T.lines`. CI runs it on every push via
  `.github/workflows/tests.yml`.
- Syntax/runtime errors with line numbers: `python3 tests/debugjs.py js/cube-state.js …`
  (builds an inline debug page + screenshot in `/tmp/opencode/`).
- There is no lint/typecheck/node-test command; verification = the test pages.

## Testing quirks

- Tests report plain-text `OK`/`FAIL` lines into `#out` via `tests/harness.js`
  (`T.log(label, ok)`, finish with `T.done()`). No test framework.
- The harness paginates 40 lines per page via URL hash (`run.sh … "#40"`);
  a screenshot shows only the visible window — raise the height arg or page through.
- **Test bodies must stay synchronous** (plain blocking `<script>`): run.sh's
  screenshot fires at page load, before any async work would finish.
- Headless Firefox screenshots don't capture WebGL. `tests/app.html` reads pixels
  from the GL buffer directly — assert via the page text, not via the screenshot image.
- `tests/ui.html` duplicates every element ID from `index.html` and `tests/app.html`
  duplicates its stage markup/size. Change IDs or stage layout in `index.html` →
  update those test pages too.

## Architecture

- `js/cube-state.js` is the single source of truth: all 24 cube rotations are
  geometric; moves, facelet/cubie permutations and orientations are derived, so
  view, scramble and both solvers are consistent by construction.
  Face indices: 0=U 1=R 2=F 3=D 4=L 5=B (colors are display-only, logic never
  uses colors; face order is a standard scheme rotated 180° so white cross is down).
- Two solvers, shared playback: `js/solver-lbl.js` (beginner method, German
  explanations) and `js/solver-twophase.js` (Kociemba; builds ~4 MB `Uint8Array`
  tables at startup — slow first solve, fast after). `js/ui.js` owns state,
  counters and step playback.
- Model and view are deliberately kept in sync: user mouse turns invalidate a
  running solution; playback pauses while a mouse turn animates. Preserve this.
