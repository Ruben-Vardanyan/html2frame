# html-to-figma-design

Captures web pages in a real browser and rebuilds them in Figma as editable frames, text and vectors, at
chosen screen sizes. Status: the prototype works (`prototype/`); **v1 is being built** following
`docs/PLAN.md`.

## Read first

1. `docs/PLAN.md`: what to build, in what order, and how to check each step.
2. `docs/DECISIONS.md`: product decisions D1–D11. Don't re-open them; build to them.
3. `docs/FORMAT.md`: the JSON contract between capture and plugin.
4. `docs/RESEARCH.md`: gotchas already paid for (clean URLs, rAF in hidden tabs, i18n readiness, fonts…).

## Where things are

| Path | What |
|---|---|
| `prototype/` | Working reference: Figma plugin + manual capture scripts. Keep it working. |
| `examples/insurenow.capture.json` | Prototype output, 31 pages, 1.2 MB. Regression sample for the plugin. |
| `examples/insurenow.settings.json` | v1 settings for the same site (31 pages, 2 accounts, steps). Its `source.folder` is a path on the author's PC. |
| `src/extract.js` | **Draft, done.** In-page extractor for v1 (`window.__htmlToFigma.extract(opts)`). |
| `src/screens.js` | **Draft, done.** Screen presets + `resolveScreens(screens, orientation)`. |

## Next step

Build step 1 in `docs/PLAN.md`: `package.json` (dependency `playwright-core` only), `src/static-server.js`,
`src/steps.js`, `src/capture.js` with a CLI. Check it against `examples/insurenow.settings.json` at the
desktop screen: 31 captures, same page sizes as the prototype sample.

## Rules

- **Plain JavaScript, no build step, no TypeScript, no frameworks.** Node 18+. CommonJS in Node files;
  `src/extract.js` is a browser IIFE.
- **Indent with TABs** in all code and JSON.
- **One runtime dependency: `playwright-core`.** Launch the *installed* browser with `channel: 'msedge'`,
  falling back to `'chrome'`. Don't download browsers.
- **The Figma plugin must stay a local development plugin** (free plan, desktop app). Keep
  `networkAccess.allowedDomains: ["none"]`; only `devAllowedDomains: ["http://localhost:5600"]`.
- **The control panel server binds to `127.0.0.1` only.**
- **Never run `git commit` or push.** The owner commits and publishes. Leave changes uncommitted.
- Test-account passwords live only in `projects/*.json`, which is git-ignored. Never put real credentials in
  `examples/`.
- **Verify with real runs, not assumptions:**
  - run captures and check `innerWidth` / page sizes;
  - run `test/mock-figma.js` (and `prototype/capture/mocktest.js`) after any plugin change;
  - final visual checks happen in Figma by the owner.
- **Keep docs in sync.** If behaviour or the JSON format changes, update `docs/FORMAT.md` / `docs/PLAN.md` in
  the same change. Record new product decisions in `docs/DECISIONS.md`.
