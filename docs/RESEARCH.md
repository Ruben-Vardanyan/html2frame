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
- **Paint order is not DOM order.** Figma paints children in list order; CSS paints by stacking layers
  (`z-index`, positioned elements). A drawer (`fixed`, `z-index`) inside a sticky header that comes before the
  page content ended up under the page text. Moving every positioned layer to the end fixed that but jumbled
  Figma's layer list (the header after the footer), so a layer is only moved above the siblings it overlaps,
  counting what spills out of its box.

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
- **`scroll-behavior: smooth` survives `scrollTo(0, 0)`.** After scrolling through for lazy images, the smooth
  scroll back up was still running when the page was measured, so sticky headers landed 1–1000 px down the
  page (46 of 108 Fixture frames). Scroll with `behavior: 'instant'` and check `scrollY` is 0 before measuring.
- **Text that starts mid-line.** One text layer per DOM text node put "… and <b>bold</b> . All tools are free…" in
  three layers; the last starts after the bold words but wraps, so its box (the union of its lines) begins at the
  paragraph's left edge and Figma drew its first line over the words before it. Words and plain inline
  elements are now one layer with styled ranges; text after an icon or a badge gets a first-line indent.
- **Generic font families.** `font-family: sans-serif` is Arial in Chrome on Windows (Helvetica on macOS), but
  Figma has no generic families and the plugin used Inter, which is wider: footer links were cut off by their
  `overflow: hidden` boxes. The extractor finds the real font by comparing canvas text widths.
- **Icon fonts** (Font Awesome Solid) are rarely installed where Figma runs, and a Private Use Area glyph in
  Inter is blank. The extractor draws icon glyphs to a canvas (the page's font is loaded there) and sends a PNG.
- **Wrappers without a size.** A burger menu's `position: fixed; z-index: 6; height: 0` wrapper makes no frame,
  so its z-index was lost and the open drawer went under the page. Its layer now passes to the nodes inside.
- **Collapsed panels.** A phone filter panel closed with `max-height: 0; overflow: hidden` has no height, so it
  made no frame and its content went into the parent unclipped, on top of the results. A clipping element
  with no height (or width) now paints nothing.
- **Spaces at the ends of a text node.** `<i class="fa-…"></i> Word`: the space is dropped from the text, but
  the box was measured from it, so the word sat against the icon in Figma. Boxes are measured from the first
  to the last letter.
- **File extensions lie.** A site's `rocket.png` was a WebP; the server said `image/png`, so WebP bytes went to
  Figma, which showed a grey placeholder. Capture checks the bytes.
- **Figma's Inter is a little wider than the browser's.** Google Fonts serves Inter 4 (optical sizes: narrower at
  large sizes). A headline whose box was exactly as wide as "Your creative" wrapped in Figma ("Your / creative /
  space.") and ran into the paragraph below. Text whose lines all end at a `<br>` now has an auto-width box
  (`nw`); wrapping text gets 3% extra width.
- **CSS 3D cannot be flattened.** A spinning photo ring (`preserve-3d`, `perspective()`, `rotateY` cards) came out
  as a flat band: only the 2D part of each `matrix3d` was kept. The scene is now one picture of just that element
  on a transparent background (everything else hidden while it is taken, ancestors untransformed like the
  extractor measured them). Pseudo-elements inside are left alone, so back faces stay real. Its animations are
  paused, not switched off: stopped at 0°, the folio ring showed only dark back faces (the page also had a
  second, still copy of the cards outside the track that covered the photos exactly at 0°).
- **Lifting a whole node over-raises it.** A `position: relative` cover holding a `z-index: 2` button was ranked at
  z 2 as a whole and painted over the avatar that overlaps it. Only the parts that overlap a sibling count now; a
  part that must go over a sibling the node's body is under moves out of the node.
- **Radial gradients, px stops.** Decorative circles (`radial-gradient(circle at 12% 35%, white 0 96px, transparent
  97px)`) were dropped, and only % stops were read. Linear gradients were also mapped as if every box were
  square, which tilts a 120° gradient on a wide cover.
- **SVG dashes in Figma.** A donut chart drawn as stacked circles, each showing its slice with
  `stroke-dasharray` and `stroke-dashoffset`, came out as a ring of repeating dashes: Figma's SVG import has no
  dash offset and keeps the dash lengths unscaled on a drawing scaled ×4. Such dashes become one path each. Chrome's
  `getTotalLength()` on a `<circle>` is about 0.65% short (99.35 for 2πr = 100), while the dashes are drawn on the
  true circle, so circles and ellipses are measured exactly and written as arcs.
- **Gradient text** (`background-clip: text; color: transparent`) came out as black text on a gradient box. The
  background is now the text's fill, laid out on the element's box.
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
- **Mirrors.** `relativeTransform` takes a rotation with a flip (`[[1, 0], [0, -1]]` for `scaleY(-1)`); the
  size stays out of the matrix (`resize` / `rescale`).
- **Styled ranges** (`setRangeFontName`, `setRangeFills`, `setRangeTextDecoration`…) need every range's font
  loaded first. `paragraphIndent` indents the first line of every paragraph, so it is not used on text with
  line breaks.

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
- Conic and repeating gradients.
