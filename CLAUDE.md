# html2frame

Captures web pages in a real browser and rebuilds them in Figma as editable frames, text and vectors, at
chosen screen sizes. Status: **v1 is built** (steps 1–6 of
`docs/PLAN.md`); the earlier prototype is only in git history.

## Read first

1. `docs/PLAN.md`: what to build, in what order, and how to check each step.
2. `docs/DECISIONS.md`: product decisions D1–D13. Don't re-open them; build to them.
3. `docs/FORMAT.md`: the JSON contract between capture and plugin.
4. `docs/RESEARCH.md`: gotchas already paid for (clean URLs, rAF in hidden tabs, i18n readiness, fonts…).

## Where things are

| Path | What |
|---|---|
| `src/extract.js` | **Draft, done.** In-page extractor for v1 (`window.__html2frame.extract(opts)`). |
| `src/screens.js` | **Draft, done.** Screen presets + `resolveScreens(screens, orientation)`. |
| `src/static-server.js`, `src/steps.js` | **Done.** Folder server (127.0.0.1, random port, no clean URLs); step runner. |
| `src/capture.js` | **Done.** Capture engine + CLI: `node src/capture.js examples/fixture.settings.json --screens desktop`, or a folder: `node src/capture.js C:/site --save projects/site.json`. |
| `src/crawl.js` | **Done.** Crawler + CLI: `node src/crawl.js projects/x.json --save projects/x.json` (guest + each account; templates folded into "similar"). |
| `server.js`, `panel/`, `start.bat`, `start.command` | **Done.** Control panel on http://localhost:5600 (API in `docs/PLAN.md`); launchers for Windows and macOS. |
| `src/trash.js` | Moves files to the Recycle Bin / Trash (Windows, macOS with a `~/.Trash` fallback, Linux); used by the panel's "Recent captures" remove buttons. |
| `assets/` | The owner's logo: `logo.png` (original, 828×828, transparent) and trimmed squares `logo-256/128/64.png` (panel header and favicon, README, plugin header embedded as base64, Figma Community icon). |
| `test/compare-capture.js` | Compares page sizes of two capture files (exact). |
| `test/prototype-sample.json` | 3 pages in the old prototype format; the plugin must keep importing it. |
| `figma-plugin/` | **Done (v1).** Generic importer: v1 + prototype files, panel or file; layout "one page" with a Section per screen (default) or "page per screen" (D14). |
| `test/trash.js` | Checks `src/trash.js` on this computer (run it on Windows and macOS). |
| `test/mock-figma.js` | Runs `figma-plugin/code.js` against a fake Figma API (18 tests). |
| `test/site/` + `examples/fixture.settings.json` | **Fixture**: responsive test site covering every capture/plugin feature, plus known limits (`test/site/README.md`). Use it to check changes. |

## Next step

Steps 1–6 are done (results in `docs/PLAN.md`). Next: step 7, the Figma Community release (D18). Keep the README
and its screenshots (`docs/images/`) in sync with the panel and plugin. Everything must keep working on macOS too: no
Windows-only paths or commands without a macOS branch.

## Rules

- **Plain JavaScript, no build step, no TypeScript, no frameworks.** Node 18+. CommonJS in Node files;
  `src/extract.js` is a browser IIFE.
- **Indent with TABs** in all code and JSON.
- **One runtime dependency: `playwright-core`.** Launch the *installed* browser with `channel: 'msedge'`,
  falling back to `'chrome'`. Don't download browsers.
- **The Figma plugin stays a local development plugin** (free plan, desktop app) until step 7, the Figma
  Community release (D18). Until then keep `networkAccess.allowedDomains: ["none"]`; only
  `devAllowedDomains: ["http://localhost:5600"]`. Publishing is done by the owner, never by Claude.
- **The control panel server binds to `127.0.0.1` only.**
- **Never run `git commit` or push.** The owner commits and publishes. Leave changes uncommitted.
- Test-account passwords live only in `projects/*.json`, which is git-ignored. Never put real credentials in
  `examples/` (use `CHANGE_ME` placeholders there).
- **Verify with real runs, not assumptions:**
  - run captures and check `innerWidth` / page sizes;
  - run `test/mock-figma.js` after any plugin change;
  - final visual checks happen in Figma by the owner.
- **Keep docs in sync.** If behaviour or the JSON format changes, update `docs/FORMAT.md` / `docs/PLAN.md` in
  the same change. Record new product decisions in `docs/DECISIONS.md`.
