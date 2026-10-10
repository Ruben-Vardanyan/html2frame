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
  extract.js                   DRAFT DONE: in-page extractor (window.__html2frame.extract(opts))
  screens.js                   DRAFT DONE: presets + resolveScreens(screens, orientation)
  static-server.js             serves a project folder as-is (no clean URLs), random free port
  capture.js                   Playwright runner (also a CLI: node src/capture.js projects/x.json)
  crawl.js                     same-origin link crawler (per account)
  steps.js                     runs step lists (goto, click, fill, …) on a Playwright page
panel/                         index.html, panel.js, panel.css (vanilla); help.html, help.js (adding the plugin to Figma); theme.js (System / Light / Dark)
figma-plugin/                  manifest.json, code.js, ui.html (v1, generic)
projects/                      <name>.json settings (git-ignored except examples)
captures/                      <project>-<timestamp>.json (git-ignored)
examples/                      fixture.settings.json (settings for the test site)
test/mock-figma.js             runs figma-plugin/code.js against a fake Figma API
test/compare-capture.js        compares page sizes of two capture files (exact)
test/prototype-sample.json     3 pages in the prototype format (plugin regression)
test/site/                     "Fixture" test site (examples/fixture.settings.json): every feature + known limits
```

## Settings file (`projects/<name>.json`)

See `examples/fixture.settings.json` for a full example (dimensions, an account, page states). Real
test-account passwords go only in `projects/<name>.json`, which is git-ignored.

| Key | Meaning |
|---|---|
| `name` | project name |
| `source` | `{"folder": "C:/path/to/site"}` (served by `static-server.js`) **or** `{"url": "http://localhost:3000"}` |
| `start` | crawl start path, e.g. `/index.html` |
| `screens` | e.g. `["desktop", "phone", {"name": "Kiosk", "width": 1080, "height": 1920}]`; `"phone:landscape"` forces one orientation |
| `orientation` | `portrait` \| `landscape` \| `both` (phones and tablets only) |
| `variants` | `[{"name": "English", "localStorage": {"k": "v"}, "cookies": [{"name", "value"}], "query": {"lang": "en"}}]` |
| `dimensions` | Instead of `variants` (D15): `[{"name": "Language", "options": [variant…]}, {"name": "Theme", "options": [variant…]}]`. Every combination is captured, named "English · Dark", with the options' localStorage, cookies and query merged. |
| `readyWhen` | JS expression polled until truthy (optional) |
| `settleMs` | extra wait after ready (default 300) |
| `replaceText` | `{"֏": "AMD"}` |
| `localStorage` | `{"k": "v"}`: set before every page in every variant and account (a variant's own value for the same key wins). |
| `accounts` | `[{"name": "Customer", "login": [steps…]}]` |
| `pages` | `[{"name", "path", "group", "account?", "steps?", "fresh?", "skip?", "screens?", "variants?"}]`. `screens` limits a page to some sizes: a preset (`"phone"` = both orientations) or a screen id (`"tablet-portrait"`), e.g. a "menu open" state that only exists where there is a burger. `variants` does the same for variants: a variant name (`"English · Light"`) or a dimension option (`"Light"`), e.g. a state that clicks the theme button only makes sense from Light. |

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
page its own new browser context (its account logs in again there), so its side effects (localStorage,
purchases) don't leak into other pages. End every login with a check that it worked (`waitForUrl`), not a
plain `wait`: otherwise a failed login silently captures the login page. Capture also warns when a page
without steps lands on a different path than it asked for.

## Capture engine (`src/capture.js`)

1. `resolveScreens()` → list of screens. Combine with variants and accounts.
2. One browser context per (screen × variant × account), created lazily:
   - `viewport`; `isMobile` / `hasTouch` for phones and tablets; `deviceScaleFactor: 1`;
   - variant `localStorage` through `addInitScript` (set if missing), cookies via `addCookies`, query merged
     into every `goto`;
   - account `login` steps run once in a throw-away page of that context.
3. For each page (in order) in its context:
   - goto, then steps;
   - wait for `load`, then `networkidle` (timeout-tolerant, 5 s), then `readyWhen` (polled every 100 ms,
     never with rAF; if it is not true within 15 s the page is captured anyway with a warning, and after two
     misses in a row the run stops waiting for it, e.g. a `readyWhen` copied from another project), then
     `document.fonts.ready`, then `settleMs`;
   - scroll to the bottom in viewport steps (lazy images), then back to the top;
   - inject `src/extract.js` with `page.evaluate(source)` (a page CSP cannot block it, unlike `addScriptTag`),
     then `page.evaluate(o => window.__html2frame.extract(o), {replaceText})`.
4. Image pass in Node: for every `img` node and every image layer, fetch `src` with `context.request`
   (data: URLs are decoded locally):
   - SVG → `t:"svg"` node with root width/height set to the box (normalised in the page with `DOMParser`);
   - PNG/JPEG/GIF → `data` (base64); other formats (webp, avif; SVG used as a background fill) are
     converted to PNG with a canvas, because Figma's `createImage` only takes PNG, JPEG and GIF;
   - an image that cannot be loaded is dropped with a warning.
   Cache by URL.
5. Emit progress events `{done, total, page, screen, variant}`. Write
   `captures/<project>-<yyyymmdd-hhmm>.json` in FORMAT v1 (compact JSON: it is generated data).
6. Errors on one page are logged and skipped; the run continues, and the summary lists failures.
   Warnings (page still captured): an image that can't be loaded, a redirect to another path, and horizontal
   overflow (`innerWidth` ≠ screen width: a phone browser zooms out; the frame keeps the screen width).

**Folder shortcut** (added before step 3): `node src/capture.js <site folder> [--screens …] [--save projects/x.json]
[--ready "js"]` makes the settings itself. Every `.html` file becomes a page (subfolders up to 5 levels, at most
200; `node_modules` and hidden folders skipped), `index.html` first, grouped by subfolder ("Pages" at the top).
A page is named from its `<title>` without the site suffix; titles shared by several pages (often just the site
name) fall back to the file name. `--save` writes the generated settings to edit later (logins, variants, steps).
The crawler (step 4) and the panel (step 5) replace this for everyday use.

## Crawler (`src/crawl.js`)

`node src/crawl.js <settings.json | site folder> [--depth 3] [--max 200] [--save projects/x.json] [--unlinked]`;
also `crawl(settings, opts)` for the panel.

- BFS from `start` (plus where each login lands), same origin only, at the first screen and first variant.
  Follow `a[href]` / `area[href]`; skip `mailto:`, `tel:`, `javascript:`, `#…`, `download`, external links,
  non-page files (pdf, images, css…), and **log-out links** (by text or address), so an account crawl does not
  end its own session. Addresses are normalised: no hash, sorted query, no tracking keys (`utm_*`, `fbclid`…),
  no variant query keys (e.g. `lang`). Limits: depth 3, 200 opened addresses per run.
- Links are read from the **rendered** DOM after the same settle as capture (`readyWhen`, fonts), so
  JS-generated links count.
- Runs once as a guest, then once per account after its login (`newContext` from capture.js). A template first
  seen while logged in gets `group` and `account` = the account's name; guest pages get group "Public" when the
  project has accounts, else "Pages". An address that redirects (e.g. a members-only page sending a guest to
  the login page) counts as its destination.
- **Templates:** all addresses with the same path (id-like path segments as `*`) are one page: filters, paging
  and detail ids (`?type=1`, `?page=2`, `?slug=…`, `/items/12`) go into its `similar` list. The plain address is
  preferred as the example. At most 3 addresses per template are opened (the rest are listed, not visited).
- **Names:** the `<title>` without the site suffix (" — ", " | ", " - ") when unique; else from the file name
  ("Home", "Profile"); the `h1` only for detail pages with a query (it names the item; elsewhere it is often a
  slogan or a person's name).
- **Folder sources:** `.html` files no link leads to are reported as "Not linked" (added with `--unlinked`).
- **`--save`** adds new pages (by path) to the settings file and keeps every existing entry with its edits and
  steps; the file is written as it was (relative folder kept), with TAB indentation.

## Control panel (`server.js` + `panel/`)

Start: `start.bat` (Windows) or `start.command` (macOS) installs `playwright-core` on first run, then runs
`node server.js --open`; `npm start` runs the server without opening the browser. If the panel is already
running, the launcher just opens it.

Single page, a top bar (busy indicator while a job runs, project picker, "+ New", Save with an "Unsaved
changes" state; saving a new project name renames its file, `POST /api/projects/:name/rename`), six cards,
and a footer with the licence ("MIT License · © 2026 Ruben Vardanyan · GitHub"; `/license` serves `LICENSE`).
The plugin window shows the same licence line; its GitHub link opens through `figma.openExternal`. Source
files start with a one-line licence notice. Cards:
1. **Project.** Name, Folder or Address, start page; Advanced: `readyWhen`, `settleMs`, `replaceText`.
   "Browse…" asks the server for the system's folder window (`POST /api/pick-folder`: the Explorer-style
   IFileOpenDialog via PowerShell on Windows, `osascript choose folder` on macOS, zenity/kdialog on Linux);
   only if there is none, a server-side folder list (drives on Windows, the home folder elsewhere). Without
   projects: a "New project" card. Delete project moves the file to `projects/deleted/` (git-ignored).
2. **Screens.** Preset cards with sizes, orientation (portrait / landscape / both), custom sizes.
3. **Languages, themes & test accounts.** Dimensions with options (localStorage, cookies, address parameters as
   `key=value; …`); flat `variants` of older projects are shown and saved as one dimension "Variant". Accounts:
   a Form / Steps (JSON) switch. The form is the usual login (login page, user field and value, password field
   and value with Show, submit button, optional "after login the address contains"); "Detect fields"
   (`POST /api/detect-login`) opens the login page and fills the three selectors. Other logins as JSON steps.
   "Test login" shows where it landed and a screenshot.
4. **Stored values.** The project-wide `localStorage` as a Table (key, value, remove; "Add a value") or Bulk
   text (one `key=value` per line); values starting with `[` or `{` must be valid JSON (marked red otherwise).
5. **Pages.** "Find pages" (crawl, live log; adds new pages and keeps edited ones; option to include pages
   nothing links to), a table: include, name, address, group, account, tags (similar, steps, some
   screens/variants), steps (JSON) and the screens the page is captured on (none = all; the frame estimate counts them), duplicate as a state, remove; "Add a page".
6. **Capture.** Frame estimate (pages × screens × variants), Capture (saves first), progress bar and log
   (SSE), result with failures and "Download JSON", the Figma hint, recent captures (remove one, or all, to the recycle bin / Trash).

API (JSON):

| Endpoint | Purpose |
|---|---|
| `GET /api/info` | screen presets, examples, the running job, platform, port, the plugin's `manifest.json` path |
| `POST /api/reveal-plugin` | shows `figma-plugin/manifest.json` in Explorer / Finder (Help page) |
| `GET /api/projects` | list projects |
| `POST /api/projects` | create `{name, source}` or copy `{example}` |
| `GET/PUT/DELETE /api/projects/:name` | read, save, delete a project |
| `POST /api/projects/:name/rename` | `{to}` → the file is renamed after the project's name |
| `POST /api/pick-folder` | `{start}` → the system's folder window → `{path}`, `{cancelled}` or `{unavailable}` |
| `GET /api/browse?path=` | folders for the fallback list |
| `POST /api/detect-login` | `{project, page}` → `{found, userField, passField, submit}` |
| `POST /api/test-login` | `{project, account}` → `{ok, landing, shot}` |
| `POST /api/crawl` | `{project, save, unlinked}` → `{job}` |
| `POST /api/capture` | `{project, screens?, pages?}` → `{job}` |
| `GET /api/jobs/:id/events` | SSE: `log`, `progress`, `done {result}`, `error` (also `/api/capture/:id/events`) |
| `GET /api/captures` | list captures (newest first) |
| `DELETE /api/captures/:file`, `DELETE /api/captures` | move one capture, or all of them, to the recycle bin / Trash (`src/trash.js`: Windows Recycle Bin, macOS Finder with a `~/.Trash` fallback, Linux `gio trash`); panel only (the preflight allows GET alone) |
| `GET /api/captures/latest`, `/api/captures/:file` | a capture file (`?download` for a download); CORS `*` and private-network preflight for the plugin |

One browser job (crawl, capture, test login) at a time; another gets 409. The server binds to `127.0.0.1`
only and answers only requests addressed to `localhost:5600` / `127.0.0.1:5600` (no DNS rebinding).

## Figma plugin v1 (`figma-plugin/`)

Started from the prototype plugin (in git history before v1; removed with the InsureNow sample), which was proven: font resolution, frame, text, svg and image
building.

- **Input.** "Load latest from panel" (fetch `http://localhost:5600/api/captures/latest`) or a file picker.
  Accept FORMAT v1 and prototype files.
- **Selection.** Checkbox lists, **all unticked at first**: screen sizes (label and size, with a note that only
  captured sizes are listed), then languages/variants (or one list per dimension, e.g. Language and Theme, D15),
  then groups; lists other than screen sizes are shown only when they have more than one option. Each shown list needs at least
  one tick; Import stays disabled until then, a hint names what is missing, and the button shows the exact frame
  count. The UI sends the parsed file to `code.js` (`{type:"load"}`), which normalises it and returns the choices
  (`{type:"loaded", screens, variants, groups, combos, dimensions}`); Import sends `{type:"import", screens, variants?,
  groups?, layout}` (left-out variants/groups = all; no screens = refused). All file handling is covered by
  `test/mock-figma.js`.
- **Layout (D14).** A choice in the UI, remembered with `figma.clientStorage`:
  - *One page* (default): everything on the current page; one Figma Section per screen (plus variant),
    named after it, stacked top to bottom (400 px apart) below any existing content, with its group rows
    inside (120 px padding). Without `figma.createSection` (older Figma), a 96 px title instead.
  - *Page per screen* (D4), described next.
- **Page per screen (D4).** One Figma page per screen (plus variant, if there are several):
  - create it with `figma.createPage()` if missing and switch with `await figma.setCurrentPageAsync()`;
  - the empty "Page 1" of a new file is renamed and reused instead of being left behind;
  - if a page cannot be created (the free plan may limit pages per file), that screen becomes a Section
    below the content of the first page used, and the report says so;
  - rows per group, with a 64 px label above each; 200 px gap between frames, 400 px between rows;
  - when the page already has content, start below the existing nodes.
- **New fills.** Linear gradients (transform in FORMAT.md) and image layers on frames; image corner radius.
- **Fonts.** Per script inside a text layer (`ffs`, the page's font stack): Armenian and Georgian letters get a
  font made for them, chosen among the fonts installed in Figma (`listAvailableFontsAsync`): the page's own,
  else **Calibri** (owner's choice), else Noto Sans Armenian, Sylfaen, Segoe UI…; other letters get the first
  ordinary font of the stack, else Inter. CSS generic names map to real fonts (`ui-monospace` → Roboto Mono…).
  The nearest installed weight is used when the exact style is missing.
- **Use Auto Layout** (checkbox, remembered; D17): flex containers with `lay` become Auto Layout frames
  (direction, padding, gap, alignment); the frame and child frames keep their measured sizes, single-line text
  hugs; `abs`, rotated and vertical children, and clip-path helpers stay absolute. Capture only records `lay`
  when a Figma-style layout of the measured child sizes lands every item within 1px (Fixture: 336 frames,
  732 items, 0 off). Not covered: block stacking, grid, wrapping, reversed order, per-item alignment.
- **After an import** the button shows "Imported ✓" and stays disabled until a checkbox, the layout or the
  file changes (no accidental duplicates; re-importing on purpose still works and goes below).
- **Report.** Number of frames per screen, and missing fonts with what replaced them. One failed page or
  image doesn't stop the import: it is listed, and an image that Figma rejects becomes a grey placeholder.
- **Manifest.** Name "html2frame"; `documentAccess: dynamic-page`;
  `networkAccess: {allowedDomains: ["none"], devAllowedDomains: ["http://localhost:5600"]}`.

## Build order (each step ends with its check)

1. **Done.** `package.json`, `src/static-server.js`, `src/steps.js`, `src/capture.js` (CLI).
   Check: `node src/capture.js projects/insurenow.json --screens desktop` gives 31 captures, then
   `node test/compare-capture.js captures/<new>.json examples/insurenow.capture.json`.
   Result (2026-10-07): 31/31 captured, 19/31 sizes identical. The other 12 (Browse Policies + 11 Customer
   pages) are 3–7 px taller because the prototype captured those pages on a 125 %-scaled display, where 1px
   borders become 0.8 px (RESEARCH §4). With `--force-device-scale-factor=1.25` exactly those 12 match and
   8 others stop matching, so every page matches the sample under one of the two scales. v1 captures at
   scale 1 (true CSS pixels). The owner accepted this result as passing step 1. (The prototype and the
   InsureNow sample were removed before publishing; they stay in git history.)
2. **Done.** `test/mock-figma.js` plus plugin v1. Check: the mock imports v1 and prototype files with no
   errors, and creates the right Figma pages. `node test/mock-figma.js` runs 19 tests: a prototype-format
   file (`test/prototype-sample.json`, 3 pages cut from the InsureNow sample, which matched the prototype plugin's 3152 frames / 1773 texts / 106 SVGs), the newest `captures/*.json`, a
   synthetic 2 screens × 2 variants file (gradients, image fills, image radius, a rejected image, a missing
   font), the gradient transform, the page-limit fallback, a second import below existing content, and a bad
   file, plus the one-page layout with Sections (D14), its no-Sections fallback, the remembered layout choice, the screen/variant/group selection, dimension lists, fonts per script (Armenian letters: the page's Armenian
   font, else Calibri, else other installed Armenian fonts), CSS transforms (mirrors too), styled text ranges with a first-line indent, Auto Layout, and clip-path masks with vertical
   text. InsureNow has no gradients or
   background images, so those are only checked synthetically.
   Still to do by the owner: import in the Figma desktop app and compare with the prototype import.
3. **Done.** Screens. Check: `--screens phone,tablet --orientation both` gives widths 390/844/768/1024, and the
   phone pages show the mobile nav (burger).
   Result (2026-10-07): widths 390/844/768/1024 on Fixture and InsureNow, no overflow warnings. InsureNow
   phones show its `button.nav-burger`; Fixture shows the burger on phones (both orientations) and tablet
   portrait, the full nav on tablet landscape, and its "menu open" state opens the menu. Added: per-page
   `screens`, and `preset` on resolved screens. Fixing Fixture showed a typical site bug: a desktop nav that
   does not fit at 769–900 px (phone landscape); the capture reports it as horizontal overflow.
4. **Done.** `src/crawl.js`. Check: crawling the InsureNow folder finds the public pages; after the Customer and
   Admin logins it finds their pages.
   Result (2026-10-07): InsureNow → 12 public, 12 Customer and 5 Admin pages (the same 31 as the hand-written
   settings, minus Payment and Confirmation, which are reached only by submitting forms and are reported as
   "Not linked"); 53 filter/paging/detail addresses folded into "similar"; 107 s. Fixture → 8 public pages
   (4 products as 1 + 3 similar) and Account for "Member". InsureNow wireframes (no logins) → 21 linked pages
   and 11 not linked. `--save` on the Fixture settings added nothing and kept all 15 pages, steps, dimensions
   and accounts.
5. **Done.** `server.js` + panel. Check: start.bat → create a project for some static folder → find pages → capture →
   plugin "Load latest from panel".
   Result (2026-10-07): an API test (21 checks: projects, examples, browse, test login, crawl and capture jobs
   over SSE, one job at a time, latest capture with CORS and private-network preflight, download, Host check,
   no files outside `panel/`) and the panel driven in Edge (open Fixture, edit screens, test login, folder
   browser, Find pages, untick pages, Capture → 4 frames, saved) all passed with no page errors. macOS:
   `start.command` (LF, adds Homebrew paths), browser opened with `open`, folder browser starts in the home
   folder; `.gitattributes` keeps LF/CRLF per launcher. Not run on a Mac yet; `start.command` needs its
   executable bit in git (`git update-index --chmod=+x start.command`).
6. **Done.** README: user guide with screenshots; `start.command` for macOS.
   Result (2026-10-07): README with requirements, install (Windows and macOS, Gatekeeper and `chmod`), the five
   panel cards, the Figma import (choices, layouts, Auto Layout), command line, what comes through and what does
   not, troubleshooting, and developer notes. Screenshots in `docs/images/` were taken from a temporary demo
   project built from the example (neutral folder path, no personal data); all local links checked. Not yet
   followed on a Mac.
7. Figma Community release (D18). Prepare: manifest `networkAccess: {allowedDomains: ["http://localhost:5600"],
   reasoning: "…"}` (instead of `devAllowedDomains`), a 128×128 icon (`assets/logo-128.png`), a cover image, name/tagline/description
   with a link to the GitHub repo and guide, and answers for Figma's data-security form (no data leaves the
   computer; the only network access is the local panel). The owner submits it in the desktop app (Plugins →
   Manage plugins → Publish; two-factor authentication on) and puts the plugin ID Figma assigns into the
   manifest. Check: the published plugin imports a file and "Latest from panel" works.

## Verification (end-to-end)

- The Fixture test site (`node src/capture.js examples/fixture.settings.json`, 90 frames) captures with no
  failures and only its two intended warnings (a missing image, a signed-out redirect), and imports in the mock
  and in Figma. Its `edge-cases.html` lists what is not supported yet.

- Phone portrait and landscape pages look like the site on a phone.
- A second static project (for example the InsureNow `docs/wireframes` folder, which has no logins) works
  end-to-end from the panel without editing JSON by hand.
