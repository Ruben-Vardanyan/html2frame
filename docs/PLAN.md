# v1 build plan

Goal: a reusable tool. Pick a project, screens, variants and pages in a local control panel, click
**Capture**, then load the result into Figma with the plugin. Decisions are in [DECISIONS.md](DECISIONS.md),
the data contract in [FORMAT.md](FORMAT.md), and the background in [RESEARCH.md](RESEARCH.md).

Constraints:
- Plain JavaScript, no build step, TAB indentation.
- Node 18+.
- **One runtime dependency: `playwright-core`.** Launch the installed browser with `channel: 'msedge'`,
  falling back to `'chrome'`; nothing else is downloaded.
- The Figma plugin stays a local development plugin (free plan).

## Layout

```
start.bat / start.command      Windows / macOS: npm install on first run, start server, open browser
package.json                   "start": "node server.js"; dependency playwright-core
server.js                      http server on localhost:5600: panel UI, API, SSE progress
src/
  extract.js                   DRAFT DONE: in-page extractor (window.__htmlToFigma.extract(opts))
  screens.js                   DRAFT DONE: presets + resolveScreens(screens, orientation)
  static-server.js             serves a project folder as-is (no clean URLs), random free port
  capture.js                   Playwright runner (also a CLI: node src/capture.js projects/x.json)
  crawl.js                     same-origin link crawler (per account)
  steps.js                     runs step lists (goto, click, fill, …) on a Playwright page
panel/                         index.html, panel.js, panel.css (vanilla)
figma-plugin/                  manifest.json, code.js, ui.html (v1, generic)
projects/                      <name>.json settings (git-ignored except examples)
captures/                      <project>-<timestamp>.json (git-ignored)
examples/                      insurenow.capture.json (prototype output), insurenow.settings.json
prototype/                     reference implementation, keep working
test/mock-figma.js             runs figma-plugin/code.js against a fake Figma API
```

## Settings file (`projects/<name>.json`)

See `examples/insurenow.settings.json` for a full example.

| Key | Meaning |
|---|---|
| `name` | project name |
| `source` | `{"folder": "C:/path/to/site"}` (served by `static-server.js`) **or** `{"url": "http://localhost:3000"}` |
| `start` | crawl start path, e.g. `/index.html` |
| `screens` | e.g. `["desktop", "phone", {"name": "Kiosk", "width": 1080, "height": 1920}]`; `"phone:landscape"` forces one orientation |
| `orientation` | `portrait` \| `landscape` \| `both` (phones and tablets only) |
| `variants` | `[{"name": "English", "localStorage": {"k": "v"}, "cookies": [{"name", "value"}], "query": {"lang": "en"}}]` |
| `readyWhen` | JS expression polled until truthy (optional) |
| `settleMs` | extra wait after ready (default 300) |
| `replaceText` | `{"֏": "AMD"}` |
| `accounts` | `[{"name": "Customer", "login": [steps…]}]` |
| `pages` | `[{"name", "path", "group", "account?", "steps?", "fresh?", "skip?"}]` |

**Steps vocabulary** (`src/steps.js`):

| Step | Meaning |
|---|---|
| `{"goto": "/path"}` | open a page |
| `{"click": "sel"}` | click; then wait for `load` if it navigated |
| `{"fill": "sel", "value": "…"}` | type into a field |
| `{"select": "sel", "value": "…"}` | choose a dropdown option |
| `{"check": "sel"}` | tick a checkbox |
| `{"press": "Enter", "on": "sel?"}` | press a key |
| `{"hover": "sel"}` | hover |
| `{"wait": 500}` | wait milliseconds |
| `{"waitFor": "sel"}` | wait for an element |
| `{"waitForUrl": "substring"}` | wait for the address to change |
| `{"eval": "js"}` | run JS (indirect eval, awaited) |
| `{"reload": true}` | reload the page |

If a page's `steps` start with `goto`, the page's own `path` is not opened first. `fresh: true` gives the
page its own new browser context, so its side effects (localStorage, purchases) don't leak into other pages.

## Capture engine (`src/capture.js`)

1. `resolveScreens()` → list of screens. Combine with variants and accounts.
2. One browser context per (screen × variant × account), created lazily:
   - `viewport`; `isMobile` / `hasTouch` for phones and tablets; `deviceScaleFactor: 1`;
   - variant `localStorage` through `addInitScript` (set if missing), cookies via `addCookies`, query merged
     into every `goto`;
   - account `login` steps run once in a throw-away page of that context.
3. For each page (in order) in its context:
   - goto, then steps;
   - wait for `load`, then `networkidle` (timeout-tolerant, 5 s), then `readyWhen`, then
     `document.fonts.ready`, then `settleMs`;
   - scroll to the bottom in viewport steps (lazy images), then back to the top;
   - `page.addScriptTag({path: src/extract.js})`, then `page.evaluate(o => window.__htmlToFigma.extract(o), {replaceText})`.
4. Image pass in Node: for every `img` node and every image layer, fetch `src` with `context.request`
   (data: URLs are decoded locally):
   - SVG → `t:"svg"` node with root width/height set to the box;
   - raster → `data` (base64).
   Cache by URL.
5. Emit progress events `{done, total, page, screen, variant}`. Write
   `captures/<project>-<yyyymmdd-hhmm>.json` in FORMAT v1.
6. Errors on one page are logged and skipped; the run continues, and the summary lists failures.

## Crawler (`src/crawl.js`)

- BFS from `start`, same origin only. Follow `a[href]` (skip `mailto:`, `tel:`, `#`, downloads, external
  links); normalise by path + significant query. Limits: depth 3, 200 pages.
- Collect from the **rendered** DOM (JS-generated links count).
- Run once as a guest, then once per account after login. Pages first seen while logged in get
  `group: account.name`, `account: account.name`.
- Name pages from `<title>` (strip the site suffix after " — " or " | ") or the `h1`.
- Group detail pages by path pattern (`/policy.html?slug=*`): keep the first one, list the rest as
  "N similar" (the user wants one example per template).

## Control panel (`server.js` + `panel/`)

Single page, five sections:
1. **Project.** Choose or create a project: name, folder path (text field with a "Browse…" helper listing
   folders server-side) or URL.
2. **Screens.** Preset checkboxes with sizes, an "add custom" row, and an orientation radio
   (portrait / landscape / both).
3. **Variants and accounts.** Small editable lists. Accounts have a "Test login" button that shows the
   result URL and a screenshot thumbnail.
4. **Pages.** "Find pages" (crawl) fills a table: tick, name, path, group, account, steps (JSON editor
   with a step picker), "add state" (duplicates the row with steps). It also offers "Add page" manually.
5. **Capture.** Button, live log (SSE), summary, "Download JSON", and the note "In Figma: Plugins →
   Development → html-to-figma-design → Load latest from panel".

API:

| Endpoint | Purpose |
|---|---|
| `GET /api/projects` | list projects |
| `GET /api/projects/:name` | read a project |
| `PUT /api/projects/:name` | save a project |
| `POST /api/crawl` | find pages |
| `POST /api/test-login` | try an account's login |
| `POST /api/capture` | start a capture; returns a job id |
| `GET /api/capture/:id/events` | SSE progress |
| `GET /api/captures` | list captures |
| `GET /api/captures/latest` | newest capture; CORS `*` for the plugin |

The server binds to `127.0.0.1` only.

## Figma plugin v1 (`figma-plugin/`)

Start from `prototype/figma-plugin/code.js`, which is proven: font resolution, frame, text, svg and image
building.

- **Input.** "Load latest from panel" (fetch `http://localhost:5600/api/captures/latest`) or a file picker.
  Accept FORMAT v1 and prototype files.
- **Selection.** Checklist of screens × variants × groups; "Import".
- **Layout (D4).** One Figma page per screen (plus variant, if there are several):
  - create it with `figma.createPage()` if missing and switch with `await figma.setCurrentPageAsync()`;
  - rows per group, with a 64 px label above each; 200 px gap between frames, 400 px between rows;
  - when the page already has content, start below the existing nodes.
- **New fills.** Linear gradients (transform in FORMAT.md) and image layers on frames; image corner radius.
- **Report.** Number of frames per screen, and missing fonts with what replaced them.
- **Manifest.** Name "html-to-figma-design"; `documentAccess: dynamic-page`;
  `networkAccess: {allowedDomains: ["none"], devAllowedDomains: ["http://localhost:5600"]}`.

## Build order (each step ends with its check)

1. `package.json`, `src/static-server.js`, `src/steps.js`, `src/capture.js` (CLI).
   Check: `node src/capture.js examples/insurenow.settings.json --screens desktop` gives 31 captures with
   the same page sizes as `examples/insurenow.capture.json`.
2. `test/mock-figma.js` plus plugin v1. Check: the mock imports v1 and prototype files with no errors, and
   creates the right Figma pages.
3. Screens. Check: `--screens phone,tablet --orientation both` gives widths 390/844/768/1024, and the
   phone pages show the mobile nav (burger).
4. `src/crawl.js`. Check: crawling the InsureNow folder finds the public pages; after the Customer and
   Admin logins it finds their pages.
5. `server.js` + panel. Check: start.bat → create a project for some static folder → find pages → capture →
   plugin "Load latest from panel".
6. README: user guide with screenshots; `start.command` for macOS.

## Verification (end-to-end)

- InsureNow desktop through v1 matches the prototype import in Figma (the user checks visually).
- Phone portrait and landscape pages look like the site on a phone.
- A second static project (for example the InsureNow `docs/wireframes` folder, which has no logins) works
  end-to-end from the panel without editing JSON by hand.
