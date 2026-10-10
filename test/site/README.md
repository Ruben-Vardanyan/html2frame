# Fixture: test site for html2frame

A small static shop (plain HTML/CSS/JS, responsive) whose pages exercise what the capture and the Figma plugin
must handle. Settings: [`examples/fixture.settings.json`](../../examples/fixture.settings.json).

```
node src/capture.js examples/fixture.settings.json                     # 2 screens × 4 variants (Language × Theme) × 15 pages
node src/capture.js examples/fixture.settings.json --screens desktop --pages "Boxes,Images"
node test/mock-figma.js captures/fixture-<date>.json
```

Fonts come from Google Fonts (Inter, Playfair Display, Noto Sans Armenian), so capture needs internet; offline,
the browser falls back to system fonts and sizes change slightly.

## Pages

| Page | Tests |
|---|---|
| `index.html` | JS-rendered sticky header (logo SVG file, ::after cart badge, burger on phones), gradient over a cover image (a different image on phones), inline SVG icons (currentColor, CSS fill/stroke), product cards from data (PNG/JPEG/WebP, object-fit), ::before quote mark, gradient band with a form |
| `typography.html` | Weights 300–800, italic, sizes, transform, decoration, letter-spacing, line heights, alignment, mixed runs, `<br>`, `pre`, nowrap, ellipsis, a missing font family, Armenian/Cyrillic/Greek, the dram sign, emoji |
| `boxes.html` | Borders (per side, dashed, dotted), radii (per corner, 50 %, pill), shadows (multiple, spread, inset), opacity, clipping, gradients (angles, `to …`, turn, hard stops, transparent, two layers, radial), background images (cover, contain, stretch, WebP, positioned icons, data: SVG, pattern) |
| `images.html` | `<img>` PNG, JPEG, WebP, GIF, SVG file, data: SVG and GIF, a missing file (warning), object-fit, image radius, `<picture>` per screen, lazy images far down |
| `forms.html` | Values, placeholders (with colour), a search field with an icon in its text-indent, password dots, number, date, disabled, custom and native selects, textareas, native checkboxes/radios, toggles (appearance: none), range (skipped), buttons. States: errors after submit, a fixed modal dialog |
| `product.html?id=1…4` | A page that needs its `?query`; breadcrumbs with ::before, gallery, colour radios, custom select, table |
| `login.html` | Any e-mail and any non-empty password sign in (localStorage); nothing is checked |
| `account.html` | Needs a login (otherwise redirects to `login.html?next=…`, reported as a warning); stats, gradient progress bars, zebra table, badges |
| `edge-cases.html` | Known limits, each card saying what Figma should show today: hidden elements, counters, list markers, z-index paint order (also inside a plain wrapper, on a wrapper with no size, and in a flex row), a collapsed panel (max-height 0, overflow hidden), links and bold words inside a wrapping paragraph, generic font families, a WebP named `.png` (mirrored, upside down), transforms, text-shadow/blend/filter, clip-path, `<use>` sprites, canvas/video/iframe, columns, vertical text, animation, fixed elements, details/summary, CSS 3D (a ring and a tilted card, as pictures), gradient text and radial circles, a cover whose z-index button goes over a later box while an avatar goes over the cover, a `<br>` heading that just fits, a donut chart drawn with stroke dashes |

## Variants and states

- **Language:** localStorage `fixture.lang` (`en` / `hy`), or `?lang=hy` (the URL wins). Armenian switches
  the font to Noto Sans Armenian.
- **Theme:** cookie `theme=dark` / `light`. The sun/moon button in the header writes the same cookie.
- The settings use `dimensions` (Language × Theme), so all four combinations are captured.
- **States in the settings:** menu open (phones and tablet portrait only, via the page's `screens`), form errors, dialog open, signed-out
  account (redirect warning), signed-in pages (account "Member").

The page is hidden (`html.loading`) until `app.js` has rendered, then `<html data-ready="yes">`; the settings'
`readyWhen` waits for it. Images were drawn with a canvas for this repo (no third-party content).
