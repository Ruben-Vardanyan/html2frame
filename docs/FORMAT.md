# Capture format

The JSON contract between the **capture** (browser side) and the **Figma plugin**. All coordinates are
**absolute page CSS pixels** (top-left of the page is 0,0); the plugin converts them to parent-relative.
Colours are `[r, g, b, a]` with every channel 0–1.

## File

### v1

```json
{
	"version": 1,
	"project": "InsureNow",
	"capturedAt": "2026-10-07T18:00:00Z",
	"captures": [
		{
			"name": "Home",
			"group": "Public",
			"screen": {"id": "phone-portrait", "label": "Phone portrait", "width": 390, "height": 844, "orientation": "portrait"},
			"variant": "English · Dark",
			"variantParts": {"Language": "English", "Theme": "Dark"},
			"url": "/index.html",
			"width": 390,
			"height": 2950,
			"root": { "t": "f", "...": "..." }
		}
	]
}
```

`variant` is the variant name, or `null` when the project has none. `variantParts` is present only when the
variants come from `dimensions` (D15): one option per dimension; the plugin then offers one list per dimension.

### Prototype

`{"pages": [{name, group, url, width, height, root}]}`, with no `screen` or `variant`. The v1 plugin must
accept both formats; a prototype file is treated as a single "Desktop" screen.

## Nodes

### `t: "f"`: frame (a box)

| Field | Meaning |
|---|---|
| `n` | name (`tag.firstClass`) |
| `x, y, w, h` | border box |
| `bg` | background colour or `null` |
| `layers` | *(v1)* extra fills, Figma order (last = top): `{type:"gradient", angle, stops:[{c, p}]}` or `{type:"image", src or data, fit:"cover"\|"contain"}` |
| `br` | corner radii `{tl, tr, br, bl}` |
| `bd` | border `{w:[top, right, bottom, left], c, dash}` or `null` (one colour; per-side weights) |
| `sh` | drop shadows `[{x, y, blur, spread, c}]` |
| `op` | opacity 0–1 |
| `clip` | clip children (CSS overflow ≠ visible) |
| `ch` | children (frames, text, svg, img), in paint order (last = top). DOM order, except that a child is moved above the siblings it overlaps when CSS paints it later (stacking layers: negative `z-index`, normal flow, positioned with `z-index` auto/0, positive `z-index`). Overlap counts what a child paints outside its own box; a child without a stacking context of its own (e.g. a plain wrapper) ranks as its highest positioned descendant, such as a fixed drawer inside a static header. An element that makes no node of its own (e.g. a fixed menu wrapper with height 0 and `z-index: 6`) passes its layer to the nodes it painted. |
| `tf` | *(optional)* CSS transform `{a, b, c, d, e, f, ox, oy}`: `matrix(a, b, c, d, e, f)` around the origin `ox, oy` (px from the node's top-left). The node's box and its children are measured **untransformed**; the plugin applies rotation, scale, mirroring (`scaleX(-1)`) and translate (skew dropped). Also on `svg` and `img`. |
| `blur` | *(optional)* `filter: blur()` in px (Figma layer blur ≈ 2×). Also on `svg` and `img`. |
| `bblur` | *(optional)* `backdrop-filter: blur()` in px (Figma background blur ≈ 2×) |
| `blend` | *(optional)* CSS `mix-blend-mode` (`multiply`, `screen`, …). Also on `svg` and `img`. |

| `cp` | *(optional)* CSS `clip-path` as an SVG path in the node's own pixels (from `polygon()`, `inset()`, `circle()`, `ellipse()`, `path()`). The plugin makes it a mask inside the frame and moves the frame's fill and border under it. |

| `lay` | *(optional)* Figma Auto Layout for a flex container, recorded only when it reproduces the measured positions: `{d: "H"\|"V", gap, p: [top, right, bottom, left], main: "MIN"\|"CENTER"\|"MAX"\|"SPACE_BETWEEN", cross: "MIN"\|"CENTER"\|"MAX"}`. Padding includes the border. Used when the plugin's "Use Auto Layout" is on. Left out when paint order had to move one of its in-flow children (Figma lays them out in list order). |
| `abs` | *(optional, any node)* out of the flow (CSS `position: absolute/fixed`, background icons): absolute inside an Auto Layout parent |

`filter: drop-shadow()` is added to `sh` (spread 0).

The extractor also turns list markers (`::marker`: bullets, numbers, the ▼/▶ of `<summary>`) into ordinary text
nodes, skips content the browser does not render (a closed `<details>`, `content-visibility: hidden`), and
splits text that flows over CSS columns into one text node per column.

### `t: "t"`: text

| Field | Meaning |
|---|---|
| `s` | characters (whitespace collapsed; `replaceText` applied). Words and the plain inline elements among them (`<a>`, `<b>`, `<em>`, `<span>`… without a box of their own) are **one** text layer; `<br>` is `
`. |
| `x, y, w, h` | `y` is already corrected for line height |
| `ff, fw, fs, it` | font family (first in the stack), weight, size, italic |
| `ffs` | *(v1)* the whole CSS font stack, e.g. `["Noto Sans Armenian", "Inter", "sans-serif"]`. The plugin picks a font per script inside the layer (Armenian, Georgian letters get a font made for them; other letters the first ordinary font), from the fonts installed in Figma. Without it, `[ff]`. A generic family is preceded by the installed font the browser drew it with (`["Arial", "sans-serif"]` on Windows), so Figma gets the same letter widths. |
| `runs` | *(optional)* ranges styled unlike the layer (a link, bold words): `[{s, e, ff, ffs, fw, it, fs, c, td, tc, ls}]`, `s`–`e` in UTF-16 positions of the text, each with its full style. |
| `ind` | *(optional)* the text starts mid-line (after a link, an icon or a badge) and wraps: `x` is the left edge of the later lines, and the first line starts `ind` px further right (Figma paragraph indent). |
| `ts` | *(optional)* `text-shadow`: `[{x, y, blur, c}]` (Figma drop shadows on the text layer) |
| `vt` | *(optional)* vertical writing (`writing-mode: vertical-*`): one line; `x, y, w, h` is the vertical box and the plugin turns the line 90° clockwise into it |
| `lh` | line height in px, or `null` = auto |
| `ls` | letter spacing in px |
| `c` | colour |
| `tc` | `none` \| `upper` \| `lower` \| `title` |
| `td` | `none` \| `underline` \| `strike` |
| `al` | `left` \| `center` \| `right` |
| `multi` | more than one line → fixed width, auto height |
| `fixed` | form-control text → fixed width box (starts after the field's padding and `text-indent`, e.g. room for a search icon) |

### `t: "svg"`: vector

`{n, x, y, w, h, svg}`. `svg` is self-contained markup with `width`/`height` set to the box, colours
resolved (no `currentColor`, no classes).

### `t: "img"`: raster or SVG image

| Field | Meaning |
|---|---|
| prototype | `{n, x, y, w, h, data (base64), fit}` |
| v1 capture output | `{n, x, y, w, h, src, fit, r?, tf?, blur?, blend?}`. `canvas`, `video`, `iframe`, `object` and `embed` also become `img` nodes: the extractor marks them (`shot`) and capture fills `data` with a picture of the element (fixed and sticky elements hidden meanwhile). Capture resolves `src` into either `data` (raster, base64), or a `t:"svg"` node when the file is SVG. |
| `fit` | CSS `object-fit`: `contain` → Figma `FIT`, otherwise `FILL` |
| icons | Icon-font glyphs (all Private Use Area characters, or a font named like an icon font: Font Awesome, Material Icons…) are drawn by the extractor at 4× in their colour: `{n: "icon fa-palette", x, y, w, h, data, fit}`. Figma rarely has these fonts. |

Capture keeps every field of an `img` node when it resolves `src` (`tf`, `abs`, `blur`, `blend`…). Image types come from the file's bytes, not its name or `Content-Type` (a WebP named `.png` is converted to PNG).

## Gradient transform (plugin)

For a CSS angle θ (0° = to top, 90° = to right), work in unit-square node space:

```
d = (sin θ, −cos θ)
p0 = (0.5, 0.5) − d/2
p1 = (0.5, 0.5) + d/2
v = p1 − p0
```

Figma `gradientTransform` `[[a, b, c], [d, e, f]]` maps node space to gradient space, with p0 → (0, 0.5)
and p1 → (1, 0.5):

```
a = v.x/|v|²   b = v.y/|v|²   c = −(a·p0.x + b·p0.y)
d = −v.y/|v|²  e = v.x/|v|²   f = 0.5 − (d·p0.x + e·p0.y)
```

The stops map directly (`position` = `p`, `color` = `c`).
