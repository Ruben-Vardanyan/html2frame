# v1 build plan

Goal: a reusable tool. Pick a project, screens, variants and pages in a local control panel, click
**Capture**, then load the result into Figma with the plugin. Decisions are in [DECISIONS.md](DECISIONS.md),
the data contract in [FORMAT.md](FORMAT.md), and the background in [RESEARCH.md](RESEARCH.md).

Constraints:
- Plain JavaScript, no build step, TAB indentation.
- Node 20+ (`playwright-core` 1.63 needs it; `package.json` "engines").
- **One runtime dependency: `playwright-core`.** Launch the installed browser with `channel: 'msedge'`,
  falling back to `'chrome'`; nothing else is downloaded.
- The Figma plugin stays a local development plugin (free plan).

## Layout

```
Start (Windows).bat           Windows / macOS launchers (D21): run src/start.js (check, icons, panel in the
Start (macOS).command         background); messages and a pause when something is missing
package.json                   "start": "node server.js"; dependency playwright-core
server.js                      http server on localhost:5600: panel UI, API, SSE progress; --log (output to a file)
src/
  extract.js                   DRAFT DONE: in-page extractor (window.__html2frame.extract(opts))
  screens.js                   DRAFT DONE: presets + resolveScreens(screens, orientation)
  static-server.js             serves a project folder as-is (no clean URLs), random free port
  capture.js                   Playwright runner (also a CLI: node src/capture.js projects/x.json)
  crawl.js                     same-origin link crawler (per account)
  steps.js                     runs step lists (goto, click, fill, …) on a Playwright page
  start.js, check-node.js      what the Start files and icons run; Node.js version check (old syntax on purpose)
  setup.js                     the setup check (saved in .html2frame/check.json), icon questions, starts the panel
  shortcut.js                  Desktop / Start menu shortcuts (Windows), html2frame.app + Desktop link (macOS)
  update.js                    weekly check of GitHub's latest release; one-click update (release ZIP or git tag), backup, roll back
  local.js                     paths and state of the git-ignored .html2frame/ folder
panel/                         index.html, panel.js, panel.css (vanilla); help.html, help.js (adding the plugin to Figma); settings.html, settings.js (D21); about.html, about.js (D22); common.js (API helpers, Quit, "stopped" screen, update dot; loaded first); theme.js (System / Light / Dark)
.html2frame/                   this computer's files (git-ignored): check.json, state.json, setup.log, logs/, update/, backup/, files.json
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
  Address sources have no files to read, so there is no "Not linked" for them: the panel's "include pages
  nothing links to" box is off for an address (its help says why); such pages are added with "Add a page".
- **`--save`** adds new pages (by path) to the settings file and keeps every existing entry with its edits and
  steps; the file is written as it was (relative folder kept), with TAB indentation.

## Control panel (`server.js` + `panel/`)

Start (D21): `Start (Windows).bat` or `Start (macOS).command` runs `node src/start.js`: the setup check on the
first start (or when something changed), the icon questions once, then the server in the same process and window
(`--open`); the window says it runs and how to stop it. Quit ends the process, so the window closes; closing the
window stops html2frame too. The window shows, in colour (`src/term.js`: ANSI, none for a log file or with
`NO_COLOR`), the version, the address and the keys: **Q** (or Ctrl+C) quits, asking for a second Q while a job runs;
**O** opens the panel in the browser. `npm start` runs the server without opening the browser. If the
panel is already running, it just opens it. It runs until Quit (`POST /api/quit`); there is no auto-stop.

Single page, a top bar (busy indicator while a job runs, project picker, Save, which shows the state
itself with no text beside it: quiet and disabled while everything is saved, filled in the warning colour while
something is not; saving a new project name renames its file, `POST /api/projects/:name/rename`, and an alert says
when that fails; the project picker's list has the current project first, tinted with a tick and pinned to its
top, then the others, then "+ New project", an action drawn as the list's footer and pinned to its bottom, so it
is never a button beside Save; Save is not shown while no project is open: no projects yet, or the New project
form), four numbered cards with optional sections between 2 and 3,
and a footer ("html2frame · Help · Settings · About · GPL-3.0 License · GitHub · © 2026 Ruben Vardanyan"; each page leaves out itself;
`/license` serves `LICENSE`, `/notice` serves `NOTICE`, D23). The plugin window shows the licence line "html2frame by Ruben Vardanyan · GPL-3.0 ·
GitHub" (the author credit NOTICE requires); its GitHub link
opens through `figma.openExternal`. Source files start with a one-line licence notice. The panel was redesigned
in D20 (the old six-card panel is in git history). Every choice list is drawn like the project picker
(`dropdown(select)` in `panel.js`: the `<select>` stays the source of truth). Narrow windows (checked from 320
to 1920 px): the tables (page list, at least 900 px wide; Local storage and Replace text, at least 460 px) and
the capture lists keep each cell on one line and slide sideways in their own box, never the page; a step editor
opened under a page stays in the visible part of the list. Top bar: one line, the project's actions (picker,
Save) then a thin line and the panel's own: a "☰" (burger) button whose dropdown holds Help, Settings, Report a problem, Quit and the
theme, at every width (closes on a pick, a click outside, Escape or Tab); below 900 px the subtitle goes so the line
still fits; still one line down to 481 px. At 480 px and less, two rows: logo and name with
a busy spinner and ☰, then the picker across the
width with Save; while the page scrolls the first row goes and the second stays pinned (10 px from the top), so
Save is always in view. The Help page's bar stays one line: below 481 px its way back is an arrow alone; at
760 px and less it scrolls away with the page.

Help, **Settings**, **Report a problem** (About → Report, D22) and **Quit** (D21) are in the ☰ dropdown with their icons
(question mark, cog, flag, power), above the
theme. A dot on ☰ and on Settings says an update is available. Quit
asks first (`confirm`, naming a running job and unsaved changes), then the page shows "html2frame has stopped";
the same card shows when the server does not answer when a page loads. The Settings page is built like Help
(cards, the same bar with Settings as subtitle): **Version and updates** (version, ZIP or git, status, Update now
with the job's progress and log, then it waits for a server with a new start time and reloads; a git folder that
cannot update shows why and the command), **Setup check** (the saved results, Check again), **Icons**
(checkboxes), **Appearance** (System / Light / Dark with words; the Help, Settings and About bars have no theme
switch, only the panel's ☰ menu and this), **Figma plugin** (the manifest path, as on Help), **Stop html2frame** (Quit, Show the log file).
When the server that answers is older than the page (it was started before the files changed: `/api/settings` or
`/api/quit` gives 404), the page shows "Restart html2frame" with the steps instead of failing quietly.

The **Help** page has a list of its sections ("On this page": Add the plugin to Figma with its four steps, Common
problems, Report a problem): a sidebar that stays in view on wide screens, the section being read marked in blue
(help.js, on scroll); at 760 px and less the same list above the cards, scrolling away with the page. The common problems
are an accordion: a question opens its answer with a short slide (`prefers-reduced-motion`: none) and closes the one
that was open; without the script `<details name="faq">` still keeps one open. The last one, "Something else is
wrong", leads to About. **About** (footer link on every page): what html2frame is, version (→ Settings), author,
the licence (GNU GPL v3 or later, with NOTICE's author credit, D23), the GitHub repo, and **Report a problem** (D22): "Your setup" (html2frame version and ZIP / git, the
saved setup check without the folder and port lines, the browser the panel is shown in) with Copy, "Report a
problem on GitHub" and "Suggest an idea" (GitHub issue forms, `.github/ISSUE_TEMPLATE/`, opened with "Your setup"
filled in through the address: field id `environment`) and "See reported problems".

1. **Project.** Name, Folder or Address, start page. "Browse…" asks the server for the system's folder window
   (`POST /api/pick-folder`: the Explorer-style IFileOpenDialog via PowerShell on Windows, `osascript choose
   folder` on macOS, zenity/kdialog on Linux); only if there is none, a server-side folder list (drives on
   Windows, the home folder elsewhere). Without projects: a "New project" card; a new Address project is checked
   for `http(s)` and starts at the address's own path. Delete project moves the file to `projects/deleted/`
   (git-ignored). Switching Folder ↔ Address keeps one of the two in the project: the one whose field is shown,
   with the text that field holds. Find pages and Capture do not start without a site, or with an address that
   does not start with `http://` or `https://`; the reason is shown in their status line.
2. **Screen sizes.** Preset cards with sizes, orientation for phones and tablets (portrait / landscape / both),
   custom sizes (two with one name are flagged). With no size ticked the capture uses Desktop, and says so.

**Optional sections**, closed until used, each showing in its closed row what is set:
- **Languages and themes** (`dimensions`): "the site switches it by localStorage / a cookie / the address,
  named …" and a label + value per option; the three free fields (localStorage, cookies, address parameters as
  `key=value; …`) are kept for options that set several values. Flat `variants` of older projects are shown and
  saved as one dimension "Variant". The frame estimate ignores unnamed dimensions, as the capture does.
- **Test accounts**: a Usual login / Other (steps) switch. The usual login is login page, e-mail, password
  (with Show) and Test login, which saves the project first and shows where it landed and a screenshot; only
  when the login fails with the standard field names does it look the fields up (`POST /api/detect-login`).
  "Change the login fields by hand" holds the field selectors, submit button and "address after login
  contains". Other logins are steps.
- **Local storage** (project-wide `localStorage`): Table (key, value, remove; "+ Add a value") or Bulk text (one
  `key=value` per line); values starting with `[` or `{` must be valid JSON (marked red otherwise). Quotes
  around JSON copied from code (`'[{…}]'`) are dropped, by the panel and again by the capture.
- **Loading**: Wait until edits `readyWhen` as rows, "This is on the page / is gone from the page" (a selector),
  "The page has / no longer has this class" (a class of `<html>`) or "Custom (JavaScript)", joined by All of
  these (`&&`) or Any of these (`||`); it still saves one line of JavaScript, and a line the rows cannot read is
  one Custom row, unchanged. Extra wait after ready = `settleMs`.
- **Replace text**: `replaceText` as rows of Find / Replace with, or Bulk text with one `from=to` per line.

3. **Pages.** "Find pages" (crawl, live log, Cancel; adds new pages and keeps edited ones; option to include
   pages nothing links to). The list is drawn in groups like a task list: a drag handle, a tick for the whole
   group, a fold arrow, the group's name as a coloured label as wide as its text, which renames it, and its count.
   Under it the pages: drag handle, include, name, address with an open icon (↗, the page in the user's browser,
   as a visitor: an address site directly, a folder through `GET /api/open`), account, tags (similar, steps, some
   screens/variants), "⋯" for the page's steps and the screens it is captured on (none = all; the frame estimate
   counts them), "⧉" a state of this page (a short form with steps), remove. Steps are edited as rows (Click,
   Type into, Wait until visible, …) with "Edit as JSON" as a fallback; broken steps JSON blocks Save instead of
   being dropped. "+ Add a page" is each group's last row: it becomes a row to fill in right there, name and
   address in the list's own columns, and Enter adds it at the end of that group and keeps the row open for the
   next. "+ New group" at the end of the list adds an empty group there, kept in the panel until a page is in it,
   since the settings file knows groups only through pages. Drag a page by its handle onto a page to put it
   before or after it, or onto a group's header to put it at the end of that group; drag a group by its handle to
   reorder the groups. A search box filters the rows by name, address, group, account or a "similar" address
   (shown under the address when that is what matched), "N of M shown"; the header box then ticks the shown
   pages (D19).
4. **Capture.** Frame estimate (pages × screens × variants), Capture (saves first), progress bar, Cancel and log
   (SSE), result with failures and "Download JSON", the Figma hint, the 8 most recent captures (remove one, or all,
   to the recycle bin / Trash) and "View all (N)": a dialog with every capture, a search (file or project), project
   and date filters, Download and remove per file, and "Remove shown".

**Capture order:** pages are captured group by group: the groups in the order they first appear in `pages`, and
inside a group in list order (`src/capture.js`; a list that keeps each group together is captured as written). The
panel shows the list that way, lets a group be dragged to another place among the groups, and writes `pages`
in the shown order after every change made there.

While Find pages or Capture runs, the project cannot change: cards 1–2, the optional sections, the page list, its
buttons and Capture are `inert` (dimmed); the page search, the logs, Cancel, downloads, Help and the theme stay
usable. A panel opened while a job runs (a reload or a second tab) follows it, with Cancel. Cancel stops the job as
soon as its browser closes and saves nothing: no capture file, no pages added.

API (JSON):

| Endpoint | Purpose |
|---|---|
| `GET /api/info` | screen presets, examples, the running job, platform, port, the plugin's `manifest.json` path, `version`, `updateAvailable`, `started` (changes on a restart) |
| `POST /api/reveal-plugin` | shows `figma-plugin/manifest.json` in Explorer / Finder (Help page) |
| `GET /api/settings` | the Settings page: version and update state, the saved setup check, the icons, the manifest path, the running job |
| `POST /api/setup/check` | runs the setup check again (`src/setup.js`), saves it, returns the settings |
| `POST /api/icons` | `{desktop?, menu?}` → adds or removes those icons; returns the settings (`error` when one failed) |
| `POST /api/update/check` | looks for a new release now (GitHub's latest release; git installs also `git fetch --tags`) |
| `POST /api/update` | `{job}`: downloads and checks the new version (or checks the git folder); when the job is done the server starts `src/update.js` from `.html2frame/update/` and quits; update.js replaces the files and starts the panel again |
| `POST /api/reveal-logs` | shows the server log in Explorer / Finder |
| `POST /api/quit` | stops the panel; while a job runs only with `?force=1` (else 409) |
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
| `GET /api/jobs/:id/events` | SSE: `log`, `progress`, `done {result}`, `error`, `cancelled` (also `/api/capture/:id/events`) |
| `POST /api/jobs/:id/cancel` | stops the job: the browser closes, nothing is saved, the stream ends with `cancelled` |
| `GET /api/open?project=&path=` | redirects to the page: an address site directly, a folder through a static server (127.0.0.1, one per folder, kept while the panel runs) |
| `GET /api/captures` | list captures (newest first): `{file, size, modified, project, capturedAt}`, the last two read from the file's first kilobyte |
| `DELETE /api/captures/:file`, `DELETE /api/captures` | move one capture, some (`{files: [...]}`), or all of them (no body), to the recycle bin / Trash (`src/trash.js`: Windows Recycle Bin, macOS Finder with a `~/.Trash` fallback, Linux `gio trash`); panel only (the preflight allows GET alone) |
| `GET /api/captures/latest`, `/api/captures/:file` | a capture file (`?download` for a download); CORS `*` and private-network preflight for the plugin |

One browser job (crawl, capture, test login) at a time; another gets 409. `capture()` and `crawl()` take an
`AbortSignal` (`opts.signal`) for Cancel; the command line passes none. The server binds to `127.0.0.1`
only and answers only requests addressed to `localhost:5600` / `127.0.0.1:5600` (no DNS rebinding).

## Figma plugin v1 (`figma-plugin/`)

Started from the prototype plugin (in git history before v1; removed with the InsureNow sample), which was proven: font resolution, frame, text, svg and image
building.

- **Input.** "Latest from panel" (fetch `http://localhost:5600/api/captures/latest`; when nothing answers: "html2frame is not running. Start it from its icon or the Start file…") or a file picker.
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
- **Sections (D19).** A second choice, remembered too (`sections` in the import message): *Screen* (default, as
  above), *Group* (a Section per group, plus the variant when there are several, with a 64 px screen label above
  each row) or *Group + screen* (a Section per group and screen, e.g. "My pages — Desktop", one row without a
  label). With *Page per screen*, *Group* makes a Section per group on each screen's page; *Group + screen* is not
  offered there (the same thing).
- **Progress.** Figma delivers messages to the plugin window only when the plugin gives its thread back, so each
  progress message (fonts per page, then one per frame) is followed by a 16 ms pause; the bar moves frame by
  frame.
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
   errors, and creates the right Figma pages. `node test/mock-figma.js` runs 33 tests: a prototype-format
   file (`test/prototype-sample.json`, 3 pages cut from the InsureNow sample, which matched the prototype plugin's 3152 frames / 1773 texts / 106 SVGs), the newest `captures/*.json`, a
   synthetic 2 screens × 2 variants file (gradients, image fills, image radius, a rejected image, a missing
   font), the gradient transform, the page-limit fallback, a second import below existing content, and a bad
   file, plus the one-page layout with Sections (D14), its no-Sections fallback, the remembered layout choice, sections per group and per group and screen (D19, both layouts), progress messages with a pause after each, the screen/variant/group selection, dimension lists, fonts per script (Armenian letters: the page's Armenian
   font, else Calibri, else other installed Armenian fonts), CSS transforms (mirrors too), styled text ranges with a first-line indent, Auto Layout, clip-path masks with vertical
   text, gradients in px (corner angles on wide boxes, radial circles), and line breaks (auto width for <br> lines, room to spare when wrapping) with gradient text. InsureNow has no gradients or
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
   plugin "Latest from panel".
   Result (2026-10-07): an API test (21 checks: projects, examples, browse, test login, crawl and capture jobs
   over SSE, one job at a time, latest capture with CORS and private-network preflight, download, Host check,
   no files outside `panel/`) and the panel driven in Edge (open Fixture, edit screens, test login, folder
   browser, Find pages, untick pages, Capture → 4 frames, saved) all passed with no page errors. macOS:
   `start.command` (LF, adds Homebrew paths), browser opened with `open`, folder browser starts in the home
   folder; `.gitattributes` keeps LF/CRLF per launcher. Not run on a Mac yet; the macOS launcher has its
   executable bit in git (mode 100755).
6. **Done.** README: user guide with screenshots; `start.command` for macOS.
   Result (2026-10-07): README with requirements, install (Windows and macOS, Gatekeeper and `chmod`), the five
   panel cards, the Figma import (choices, layouts, Auto Layout), command line, what comes through and what does
   not, troubleshooting, and developer notes. Screenshots in `docs/images/` were taken from a temporary demo
   project built from the example (neutral folder path, no personal data); all local links checked. Not yet
   followed on a Mac.
7. Figma Community release (D18). Prepare: manifest `networkAccess: {allowedDomains: ["http://localhost:5600"],
   reasoning: "…"}` (instead of `devAllowedDomains`), a 128×128 icon (`assets/icon-128.png`, drawn from `assets/icon.svg`), a cover image, name/tagline/description
   with a link to the GitHub repo and guide, and answers for Figma's data-security form (no data leaves the
   computer; the only network access is the local panel). The owner submits it in the desktop app (Plugins →
   Manage plugins → Publish; two-factor authentication on) and puts the plugin ID Figma assigns into the
   manifest. Check: the published plugin imports a file and "Latest from panel" works.
8. **Done (Windows; macOS to check).** Easier start, Settings and updates (D21): launchers renamed, `src/start.js`,
   `setup.js`, `shortcut.js`, `update.js`, `local.js`, `check-node.js`; Settings page, Quit, update dot, "stopped"
   screen; `assets/icon.ico` / `icon.icns` rendered from `assets/icon.svg`; README rewritten for it. Check: a fresh
   copy → Start → check list, two icon questions, panel opens, the window stays with "is running", `check.json` written; second start
   quick; started from inside the ZIP → "Extract the ZIP first"; old Node / old system / no browser / port taken
   by another program → the message, nothing opens; icons add and remove from Settings and open the Start file;
   Quit frees the port, ends a running capture and its browsers, closes the window and tells the other tabs; ZIP update (lowered version) → backup, files replaced, projects kept, restart and
   reload; a forced failure puts the old version back; a git clone a few commits behind pulls, and an edited
   file or another branch blocks it with the reason.
   Result (2026-11-12, Windows 11, Node 24, Edge 157): all of the above passed. The check printed each item and
   wrote `check.json`; `HTML2FRAME_FAKE_NODE=18`, `HTML2FRAME_FAKE_OS=win32:6.1` / `darwin:11.7`,
   `HTML2FRAME_FAKE_NO_BROWSER=1` and a foreign listener on the port each gave their message (the port one names
   the program and PID). Desktop and Start-menu shortcuts were created with the icon (they open the Start file),
   and were removed. The real `Start (Windows).bat`: html2frame ran inside its cmd window; Quit ended it and the
   window closed. Quit during a capture: the capture was cancelled and saved nothing, both headless Edge processes
   ended, the port was free. Two panel tabs: Quit in one, the other showed "stopped" too and both closed. ZIP update of a 0.0.9 copy from GitHub `main` (1.3 MB): 69 files backed up, 71 copied,
   `projects/` untouched, server back and the Settings page reloaded; a second update removed a dropped file and
   kept a file of the user's; a read-only file no longer stops an update; `HTML2FRAME_FAKE_UPDATE_FAIL` put every
   file back. Git: a clone 3 commits behind fast-forwarded; a changed `README.md` and the branch "other" were
   refused with their reasons. Panel at 375 / 800 / 1200 px: one-line bar, ☰ menu with Help, Settings, Quit; no
   sideways scroll on Settings and Help. `node test/mock-figma.js` passed. Not run on a Mac yet (`ditto`,
   `html2frame.app`, closing the Terminal window).

## Verification (end-to-end)

- The Fixture test site (`node src/capture.js examples/fixture.settings.json`, 90 frames) captures with no
  failures and only its two intended warnings (a missing image, a signed-out redirect), and imports in the mock
  and in Figma. Its `edge-cases.html` lists what is not supported yet.

- Phone portrait and landscape pages look like the site on a phone.
- A second static project (for example the InsureNow `docs/wireframes` folder, which has no logins) works
  end-to-end from the panel without editing JSON by hand.
