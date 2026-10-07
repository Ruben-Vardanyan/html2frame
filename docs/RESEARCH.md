# Research and lessons learned

How we got from "I want my site in Figma" to a working prototype (2026-10-07). The test site was InsureNow,
a static multilingual insurance demo with 31 pages: plain HTML/CSS/JS, logins kept in `localStorage`, and
pages drawn by JavaScript.

## 1. Why Figma needs a plugin

- Figma cannot open HTML. Its own `.fig` format is closed. You can import images (PNG/JPG), SVG and other
  `.fig` files, but nothing that holds a web layout.
- So the only route to **editable** layers is a plugin that creates nodes through the Plugin API
  (`createFrame`, `createText`, `createNodeFromSvg`, `createImage`…), fed with data measured from a real
  browser.

## 2. Options tried or considered

| Option | Result |
|---|---|
| Upload raw `.html` files to an importer | ❌ The site draws its header, footer, translated text and cards with JavaScript, so a raw file gives near-empty frames. |
| **html.to.design** plugin + Chrome extension | Works, but the free tier allows only a few imports. |
| **html.to.design MCP** (`import-url`, `import-html`) | `import-url` runs on their servers and can't reach `localhost` (**"API Error 422 Bad url"**). `import-html` works if you send the fully rendered, self-contained HTML. The free quota ran out after about 4 imports (*"You are out of imports"*). Replacing an existing node (`intoNodeId`) reports the id of the last-imported node, not the replaced one. |
| Figma's official MCP server ("code to canvas") | Needs a paid seat with Dev Mode/MCP access; the user has the free plan. |
| Builder.io "HTML to Figma", Codia "HTML to Design" | Same model as html.to.design: credits and limits. |
| Full-page screenshots | No limits, but flat images with no editable layers. |
| **Our own local plugin + browser capture** | ✅ No limits, free plan, editable layers. This became the prototype. |

## 3. What the capture must do

- **Render in a real browser.** JavaScript adds the layout parts and translations, and login state lives in
  `localStorage`. Capture only after the page has finished rendering.
- **Wait for readiness.** The test site hides `<body>` while `html.i18n-pending` is set (translations
  loading). Capturing too early produced an empty page (272 bytes). v1 has a per-project `readyWhen` JS
  expression, plus network-idle and `document.fonts.ready`.
- **Hide the scrollbar.** Otherwise it takes about 15 px, and a "1440" layout is really 1425 px wide.
- **Materialise `::before` / `::after`.** They can't be measured directly, so copy their computed style into
  real `<span>`s and switch off the pseudo-elements with a class.
- **Resolve `currentColor`** and per-element computed `fill` / `stroke` inside inline SVGs before
  serialising them.
- **Draw form controls yourself.** Inputs, selects and textareas have no text nodes: draw the value or
  placeholder (with its `::placeholder` colour) and native checkboxes/radios. Skip range inputs; their styled
  track divs remain.
- **Text runs.** Use `Range.getClientRects()` per text node. The rect height is the font's content area, not
  the line height, so Figma `y = top − (lineHeight − contentHeight) / 2`. Several distinct line tops mean
  multi-line text (fixed width, auto height). Single lines use auto width, placed by `text-align`.
- **Glyphs missing from a font.** DM Sans has no Armenian dram sign "֏", so Figma showed a gap; Noto Sans
  Armenian in the HTML import was not picked up. The fix the user chose is per-project text replacement,
  `֏ → "AMD"`.
- **Images.** Fetch them from Node (Playwright `context.request`) rather than in the page, to avoid CORS.
  SVG becomes vector nodes; raster becomes `IMAGE` fills.

## 4. Environment gotchas (cost real time)

- **`npx serve` clean URLs drop the query.** `page.html?slug=x` redirects to `/page`, losing `?slug=x`, so
  detail pages fell back to their list page. v1 serves static folders with its own server: no rewrites.
- **`requestAnimationFrame` never fires in a hidden or background browser tab**, so a capture waiting on it
  hung (45 s timeout). Use `setTimeout`.
- **Hidden-window clicks fail** in some automation panes ("tab not ready for input"). Submitting via JS
  (`form.requestSubmit()`) or Playwright's own actions avoids it.
- **Flex rows sized to exactly 100%** (`flex-basis: calc(33.333% - 14.67px)` with gaps) wrapped to an extra
  row in html.to.design's renderer because of rounding. A 1 px slack fixed it. Our own plugin uses
  absolute positions, so it isn't affected.
- **Patching JS with Python strings:** `"\b"` in a normal Python string is a backspace (0x08), and it
  silently broke a regex. Use raw strings, or edit with a proper editor tool.
- **Display scaling changes layout by fractions of a pixel.** On a 125 % Windows display, Chromium snaps
  borders to whole device pixels, so `border: 1px` measures 0.8 CSS px, and font metrics round differently.
  The prototype sample mixes pages captured at 100 % and 125 % (3–7 px height differences on 12 pages).
  Playwright's `deviceScaleFactor` emulation does **not** reproduce this; only the Chromium flag
  `--force-device-scale-factor` does. v1 captures at scale 1, i.e. the CSS values as written.
- **Viewport emulation in automation panes** may reset between turns. Re-apply it before each capture and
  check `innerWidth`.

- **macOS launchers.** A `.command` file opens in Terminal on double-click, but only with LF line endings and
  the executable bit, which Windows cannot set on disk: commit it with `git update-index --chmod=+x`, and keep
  `.gitattributes` (`*.command eol=lf`). Finder may start it without Homebrew's PATH, so the launcher adds
  `/opt/homebrew/bin` and `/usr/local/bin`. Playwright's `channel: 'msedge'` / `'chrome'` find the installed
  apps on macOS too.

## 5. Figma plugin facts

- **The free plan runs development plugins** in the **desktop app only**: Plugins → Development → Import
  plugin from manifest.
- With `"documentAccess": "dynamic-page"`, use the async APIs (`loadFontAsync`, `setCurrentPageAsync`).
- For `localhost` network access (for D7), use `"networkAccess": {"allowedDomains": ["none"],
  "devAllowedDomains": ["http://localhost:5600"]}`.
- **Fonts.** The style is named from the weight (`Regular`, `Medium`, `SemiBold`, `Bold`…). Some families
  use spaced names (`Semi Bold`). Try both, then fall back to Inter, and **report** the fallbacks.
- `createNodeFromSvg` returns a Frame. Resize it to the measured box, clear its fills, and turn off
  clipping.
- `figma.createFrame()` clips content by default. Set `clipsContent` from CSS `overflow`.
- **Coordinates.** Capture uses absolute page coordinates; the plugin subtracts the parent's position.
- **Pages per file.** The free plan may limit how many pages a file can have (not yet checked in Figma).
  Plugin v1 reuses the empty "Page 1" of a new file, and if `createPage()` fails it puts that screen on an
  existing page under a title instead of stopping.
- **`createImage`** only accepts PNG, JPEG and GIF; capture converts other formats to PNG.

## 6. Prototype results

- 31 pages (12 public, 14 customer, 5 admin) at 1440×(900…2257), 1.2 MB JSON.
- About 3,150 frames, 1,770 text layers and 106 vector icons/logos.
- Imported into Figma (free plan, desktop app) in about a minute; the user reported it "worked perfectly".
- Limits: no Auto Layout (absolute positions); no gradients or background images (added in the v1
  extractor draft); no canvas, video or iframes.

## 7. Ideas for later

- Auto Layout inference for simple flex rows and columns.
- Turning repeated subtrees (same class and structure) into Figma Components automatically.
- Colour and text styles generated from the CSS custom properties on `:root`.
- Radial gradients, `text-shadow`, CSS transforms (rotation).
