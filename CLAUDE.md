# html2frame

Captures web pages in a real browser and rebuilds them in Figma as editable frames, text and vectors, at
chosen screen sizes. Status: **v1 is built** (steps 1–6 of
`docs/PLAN.md`); the earlier prototype is only in git history.

## Read first

1. `docs/PLAN.md`: what to build, in what order, and how to check each step.
2. `docs/DECISIONS.md`: product decisions D1–D23. Don't re-open them; build to them.
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
| `server.js`, `panel/` | **Done.** Control panel on http://localhost:5600 (API in `docs/PLAN.md`). `panel/common.js` is shared by index, help and settings (API helpers, Quit, "stopped" screen, update dot). |
| `Start (Windows).bat`, `Start (macOS).command`, `src/start.js`, `src/check-node.js`, `src/setup.js`, `src/term.js`, `src/shortcut.js`, `src/update.js`, `src/local.js`, `panel/settings.*` | **Done (D21).** Launchers → setup check saved in `.html2frame/check.json` (git-ignored), icon questions, then the panel runs in the Start file's window (closing it, or Quit, stops it); Settings page; Quit; weekly check of GitHub's latest **release** and one-click update (the release ZIP, or a safe fast-forward to its tag); version 0.2.0, Semantic Versioning, releasing steps in the README. Test switches: `HTML2FRAME_FAKE_NODE`, `_FAKE_OS`, `_FAKE_NO_BROWSER`, `HTML2FRAME_PORT`, `HTML2FRAME_FAKE_UPDATE_FAIL`, `HTML2FRAME_RELEASE_API`. |
| `src/trash.js` | Moves files to the Recycle Bin / Trash (Windows, macOS with a `~/.Trash` fallback, Linux); used by the panel's "Recent captures" remove buttons. |
| `assets/` | App icon, `</>` in a Figma selection box, in two forms. `icon.svg`: on a dark tile, rendered to `icon-256/128/64.png` (Figma Community icon, README, PNG favicon fallback); re-render the PNGs, `icon.ico` (Windows shortcuts) and `icon.icns` (macOS app, the tile inset to 824/1024) whenever the SVG changes. `icon-adaptive.svg`: transparent, dark `</>` on light screens and white on dark (panel SVG favicon); the same shapes are inlined in the panel headers (`panel/index.html`, `help.html`, `settings.html`, `about.html`) and the plugin header (`figma-plugin/ui.html`), coloured from the page's theme variables, so keep all three in step with it. `social-preview.png` (1280×640): GitHub's link preview (uploaded by the owner in the repo's Settings), drawn from the icon, the tagline and `docs/images/plugin-dark.png`. |
| `panel/about.*`, `.github/ISSUE_TEMPLATE/` | About page with "Report a problem on GitHub" (D22): GitHub issue forms (`bug_report.yml`, `idea.yml`) opened with "Your setup" filled in (field id `environment`); no paths or project data in it. YAML is indented with spaces (YAML does not allow tabs). |
| `test/compare-capture.js` | Compares page sizes of two capture files (exact). |
| `test/prototype-sample.json` | 3 pages in the old prototype format; the plugin must keep importing it. |
| `figma-plugin/` | **Done (v1).** Generic importer: v1 + prototype files, panel or file; layout "one page" with a Section per screen (default) or "page per screen" (D14); Sections by screen, group or group + screen (D19). |
| `test/trash.js` | Checks `src/trash.js` on this computer (run it on Windows and macOS). |
| `test/mock-figma.js` | Runs `figma-plugin/code.js` against a fake Figma API (33 tests). |
| `test/site/` + `examples/fixture.settings.json` | **Fixture**: responsive test site covering every capture/plugin feature, plus known limits (`test/site/README.md`). Use it to check changes. |

## Next step

Steps 1–6 and 8 (D21: Start files, setup check, Settings, updates; not yet run on a Mac) are done (results in
`docs/PLAN.md`). Next: step 7, the Figma Community release (D18). Keep the README
and its screenshots (`docs/images/`) in sync with the panel and plugin. They were retaken on 2026-11-12, in dark mode at 2x:
`panel-*.png` from an isolated copy with the demo project "Shop example" (the test site; folder and plugin paths shown
as C:/Users/you/…), `plugin.png` / `plugin-dark.png` rendered from `figma-plugin/ui.html` with a sample capture. Everything must keep working on macOS too: no
Windows-only paths or commands without a macOS branch.

## Rules

- **License: GNU GPL v3 or later with an author credit (D23).** `LICENSE` is the GPL text, unchanged; `NOTICE` has the
  credit term. New source files start with `// html2frame — © 2026 Ruben Vardanyan, GNU GPL v3 or later (see LICENSE and NOTICE)`.
  Keep "html2frame by Ruben Vardanyan" in the About page and the plugin footer.
- **Plain JavaScript, no build step, no TypeScript, no frameworks.** Node 20+ (`playwright-core`'s minimum; `package.json` "engines"). CommonJS in Node files;
  `src/extract.js` is a browser IIFE.
- **Indent with TABs** in all code and JSON (YAML, which forbids tabs, is the only exception).
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
