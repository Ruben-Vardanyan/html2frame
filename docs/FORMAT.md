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
			"variant": "English",
			"url": "/index.html",
			"width": 390,
			"height": 2950,
			"root": { "t": "f", "...": "..." }
		}
	]
}
```

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
| `ch` | children (frames, text, svg, img), in paint order |

### `t: "t"`: text

| Field | Meaning |
|---|---|
| `s` | characters (whitespace collapsed; `replaceText` applied) |
| `x, y, w, h` | `y` is already corrected for line height |
| `ff, fw, fs, it` | font family (first in the stack), weight, size, italic |
| `lh` | line height in px, or `null` = auto |
| `ls` | letter spacing in px |
| `c` | colour |
| `tc` | `none` \| `upper` \| `lower` \| `title` |
| `td` | `none` \| `underline` \| `strike` |
| `al` | `left` \| `center` \| `right` |
| `multi` | more than one line → fixed width, auto height |
| `fixed` | form-control text → fixed width box |

### `t: "svg"`: vector

`{n, x, y, w, h, svg}`. `svg` is self-contained markup with `width`/`height` set to the box, colours
resolved (no `currentColor`, no classes).

### `t: "img"`: raster or SVG image

| Field | Meaning |
|---|---|
| prototype | `{n, x, y, w, h, data (base64), fit}` |
| v1 capture output | `{n, x, y, w, h, src, fit, r?}`. Capture resolves `src` into either `data` (raster, base64), or a `t:"svg"` node when the file is SVG. |
| `fit` | CSS `object-fit`: `contain` → Figma `FIT`, otherwise `FILL` |

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
