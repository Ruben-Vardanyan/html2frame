# Prototype (reference implementation)

The first version that worked end-to-end (2026-10-07): 31 pages of the InsureNow demo site, imported into
Figma (free plan) as editable layers. Keep it working: v1 must reproduce its desktop result.

## Files

| File | Role |
|---|---|
| `figma-plugin/manifest.json`, `code.js`, `ui.html` | The importer. Reads `{pages:[…]}` (see `docs/FORMAT.md`), builds one frame per page with rows per `group`, loads fonts with an Inter fallback. No network access. |
| `capture/extract.js` | In-page extractor (ES module). `extractAndSave(name, group)` walks the DOM and POSTs the page JSON to the collector. |
| `capture/collect.js` | Tiny Node server on `localhost:5502`: serves `extract.js` and saves the POSTs to `capture/out/<name>.json`. |
| `capture/mocktest.js` | Runs `figma-plugin/code.js` against a fake Figma API with `examples/insurenow.capture.json`. `node prototype/capture/mocktest.js` should print "Done: 31 page(s) imported." |
| `capture/h2d.js` | The earlier html.to.design attempt: turns a rendered page into self-contained HTML (inlined SVG logos, used CSS only). Kept for reference. |

## How it was used (manual)

1. Serve the site: `npx serve docs/frontend -l 5500`. Clean URLs drop `?query` on `*.html`, so use
   `/policy?slug=…`.
2. `node prototype/capture/collect.js`.
3. In a browser at a 1440 px viewport, for each page: open it (log in first for customer/admin pages), then
   run in the console:
   ```js
   const m = await import(URL.createObjectURL(new Blob([await (await fetch('http://localhost:5502/extract.js')).text()], {type: 'text/javascript'})));
   await m.extractAndSave('Home', 'Public');
   ```
4. Combine `capture/out/*.json` into `{pages: [...]}` in the wanted order, then import it with the plugin.

v1 automates steps 1–4 (see `docs/PLAN.md`).

## Known limits

- Absolute positions, no Auto Layout.
- No gradients or background images. Exception: a `select` chevron is special-cased.
- No canvas, video or iframes.
- One screen size per run.
