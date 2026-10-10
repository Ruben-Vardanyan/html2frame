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
| `layers` | *(v1)* extra fills, Figma order (last = top): `{type:"gradient", angle, stops:[{c, p}]}` (linear), `{type:"radial", cx, cy, rx, ry, stops}` (centre and radii in px from the box's top-left corner) or `{type:"image", src or data, fit:"cover"\|"contain"}`. Stop positions `p` run 0–1 along the gradient line (linear: `\|w·sin θ\| + \|h·cos θ\|` px long, as in CSS) or along the horizontal radius. Px stops and two-position stops (`red 0 96px`) are converted, a fully transparent stop takes its neighbour's colour, stops outside 0–1 are cut. Conic and repeating gradients are not read. |
| `br` | corner radii `{tl, tr, br, bl}` |
| `bd` | border `{w:[top, right, bottom, left], c, dash}` or `null` (one colour; per-side weights) |
| `sh` | drop shadows `[{x, y, blur, spread, c}]` |
| `op` | opacity 0–1 |
| `clip` | clip children (CSS overflow ≠ visible) |
| `ch` | children (frames, text, svg, img), in paint order (last = top). DOM order, except that a child is moved above the siblings it overlaps when CSS paints it later (stacking layers: negative `z-index`, normal flow, positioned with `z-index` auto/0, positive `z-index`). Overlap counts what a child paints outside its own box; a child without a stacking context of its own (a plain wrapper, a `position: relative` cover) paints its body at its own layer and its positioned descendants at theirs. Against a sibling it ranks as the highest of those that overlap that sibling: a fixed drawer inside a static header goes over the page; a cover goes over an avatar only where its `z-index` button is. When its body must be under a sibling but such a descendant over it (overlapping by more than 3 px), the descendant moves out next to it (`abs`), inside a fill-less frame named `clip` when something on the way clipped it. An element that makes no node of its own (e.g. a fixed menu wrapper with height 0 and `z-index: 6`) passes its layer to the nodes it painted. |
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
| `nw` | *(optional)* `true`: every line ends at a `<br>` or `\n`, none wraps. The plugin gives it an auto-width box, so Figma (whose fonts can be slightly wider) cannot add a break. |
| `fill`, `fbg`, `fb` | *(optional)* gradient text (`background-clip: text`): `fill` = the element's background layers (as `layers`), `fbg` its background colour, `fb` = `{x, y, w, h}` the element's box they are laid out on. They replace `c`, which is then transparent. |
| `ts` | *(optional)* `text-shadow`: `[{x, y, blur, c}]` (Figma drop shadows on the text layer) |
| `vt` | *(optional)* vertical writing (`writing-mode: vertical-*`): one line; `x, y, w, h` is the vertical box and the plugin turns the line 90° clockwise into it |
| `lh` | line height in px, or `null` = auto |
| `ls` | letter spacing in px |
| `c` | colour (`-webkit-text-fill-color` when set, else `color`) |
| `tc` | `none` \| `upper` \| `lower` \| `title` |
| `td` | `none` \| `underline` \| `strike` |
| `al` | `left` \| `center` \| `right` |
| `multi` | more than one line → fixed width, auto height. The plugin makes the box 3% wider than measured (at least 2 px, growing away from the alignment edge). With `nw`: auto width. |
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
| 3D | A CSS 3D scene cannot be rebuilt from flat layers: a transform with perspective, `preserve-3d` with turned children, or a turned child under `perspective`. Its outermost element becomes `{n: "3d div.ring", x, y, w, h, data, fit, abs}`: a picture of only that element and its content, on a transparent background. Capture hides everything else; ancestors are drawn untransformed and opaque, since their frames carry that. Animations elsewhere are switched off, but a scene's own are paused where they are, so a spinning ring is caught mid-turn, as people see it (at its start position it can look quite different). The box covers everything inside as drawn, plus room for shadows. |
| icons | Icon-font glyphs (all Private Use Area characters, or a font named like an icon font: Font Awesome, Material Icons…) are drawn by the extractor at 4× in their colour: `{n: "icon fa-palette", x, y, w, h, data, fit}`. Figma rarely has these fonts. |

Capture keeps every field of an `img` node when it resolves `src` (`tf`, `abs`, `blur`, `blend`…). Image types come from the file's bytes, not its name or `Content-Type` (a WebP named `.png` is converted to PNG).

## Gradient transform (plugin)

Figma `gradientTransform` `[[a, b, c], [d, e, f]]` maps the node's unit square (u, v) into gradient space: a linear
gradient runs from (0, 0.5) to (1, 0.5), a radial one is centred at (0.5, 0.5) with radius 0.5. The plugin works in
px for a w×h node, with the gradient laid out on a box (bx, by, bw, bh): the node itself, or `fb` for gradient text.

Linear, CSS angle θ (0° = to top, 90° = to right): the line passes through the box centre (cx, cy) and is
L = |bw·sin θ| + |bh·cos θ| long, so "to bottom right" joins the corners of a wide box too.

```
d = (sin θ, −cos θ)
a = w·d.x/L    b = h·d.y/L    c = 0.5 − (cx·d.x + cy·d.y)/L
d' = −w·d.y/L  e = h·d.x/L    f = 0.5 − (−cx·d.y + cy·d.x)/L
```

Radial, centre (bx + cx, by + cy) and radii rx, ry in px:

```
[[w/(2·rx), 0, 0.5 − (bx + cx)/(2·rx)],
 [0, h/(2·ry), 0.5 − (by + cy)/(2·ry)]]
```

The stops map directly (`position` = `p`, `color` = `c`).
