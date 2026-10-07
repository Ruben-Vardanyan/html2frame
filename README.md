# html-to-figma-design

Turn the pages of a website into **editable Figma designs**: real frames, text layers and vectors (not
screenshots), at the screen sizes you choose: desktop, laptop, tablet, phone, portrait or landscape.

It works on the **free Figma plan**: the importer is a local *development* plugin that runs in the
Figma desktop app.

## Status

| Part | State |
|---|---|
| `prototype/` | **Works.** Used to import all 31 pages of a real project (InsureNow) into Figma, perfectly. Pages were captured by hand from a browser. |
| v1 (control panel + capture engine + upgraded plugin) | **Planned.** See [`docs/PLAN.md`](docs/PLAN.md). Drafts of two modules are in `src/`. |

## How it works

```
your site ──► real browser (capture) ──► JSON (boxes, text, fonts, SVGs, images) ──► Figma plugin ──► frames
```

Figma cannot import HTML. The `.fig` format is closed, and Figma only imports images and SVG. So the page is
rendered in a real browser at the chosen screen size. Every painted element is measured (position, colours,
borders, radii, shadows, fonts, text, SVG icons, images) and saved as JSON, and a Figma plugin rebuilds it
node by node.

## Try the prototype

1. Figma **desktop app** → **Plugins → Development → Import plugin from manifest…** → `prototype/figma-plugin/manifest.json`.
2. **Plugins → Development → InsureNow HTML Import** → choose `examples/insurenow.capture.json` → **Import**.
3. You get 31 pages (Public, Customer and Admin rows) of a sample insurance site at 1440 px.

## Docs

- [`docs/PLAN.md`](docs/PLAN.md): v1 build plan
- [`docs/DECISIONS.md`](docs/DECISIONS.md): product decisions
- [`docs/RESEARCH.md`](docs/RESEARCH.md): what was tried, what failed, the gotchas found
- [`docs/FORMAT.md`](docs/FORMAT.md): the capture JSON format shared by capture and plugin
- [`prototype/README.md`](prototype/README.md): how the prototype was used

## Requirements (v1)

- Windows/macOS/Linux with **Node.js 18+**
- **Microsoft Edge or Google Chrome** installed (the capture uses it; no separate browser download)
- **Figma desktop app** (any plan, including free)

## License

TBD (MIT suggested).
