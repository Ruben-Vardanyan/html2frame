# Decisions

The product owner made these choices on 2026-10-07, after the prototype worked. Each one has an ID so code
comments and commits can refer to it.

| ID | Decision | Why |
|---|---|---|
| **D1** | **Local control panel.** Double-click `start.bat` (or `npm start`) and a page opens on `http://localhost:5600`. There you pick the project, screens, variants and pages, and click Capture. | Easiest for everyday use; no commands to remember. A CLI entry (`node src/capture.js <settings.json>`) stays available for automation. |
| **D2** | **Pages are auto-found, then edited.** The tool crawls same-origin links from the start page (and again after each test-account login). The user unticks, renames, groups or adds pages, and the list is saved in the project's settings file. | No typing every path, but the list stays under the user's control. |
| **D3** | **Main target: static HTML folders** (plain HTML/CSS/JS, like the prototype's site). The tool serves the folder itself. A URL source (`http://localhost:3000`) is also supported for sites that need their own server. | Matches the user's projects. Serving the folder ourselves avoids clean-URL rewrites that drop `?query` (see RESEARCH). |
| **D4** | **One Figma page per screen size** (for example "Desktop", "Phone portrait"; the variant name is appended when there are several). Each page has one row per group (Public / Customer / Admin…), with a label above each row. | Keeps each screen size readable; rows match how the prototype was reviewed. |
| **D5** | **Test accounts per project.** Each account has a name and login steps (login page, fields, submit). The tool logs in once per account per browser context and also crawls that account's pages. | Many pages exist only after login (dashboard, admin). |
| **D6** | **Variants.** Named sets of `localStorage` / cookie / URL-parameter values, for example language = en, or theme = dark. Every page is captured once per variant, and the name is added to the frame, e.g. "Home — English". | Multilingual and themed sites without editing code. |
| **D7** | **Plugin hand-off: from the panel or from a file.** "Load latest from panel" fetches `http://localhost:5600/api/captures/latest` (allowed via `devAllowedDomains`). You can also pick a saved `.json` file. | One click when the panel runs; still works offline and for shared files. |
| **D8** | **Optional steps per page** (click, type, select, wait, run JS) to capture extra states, e.g. "Payment — errors" or "Menu open". | Interactive states are part of a design. |
| **D9** | **Screens:** desktop-hd 1920×1080, desktop 1440×900, laptop 1280×800, laptop-sm 1366×768, tablet-lg 1024×1366, tablet 768×1024, phone 390×844, phone-sm 360×780, plus custom `{name, width, height}`. Orientation is **portrait / landscape / both**; desktops and laptops are landscape only. Phones and tablets are emulated as touch devices (`isMobile`, `hasTouch`). | Requested by the user; matches common device classes. |
| **D10** | **The Figma plugin stays a local development plugin** (desktop app, "Import plugin from manifest"). | Works on the free plan; nothing to publish or review. |
| **D11** | **Separate GitHub repo**, published by the user. Claude never runs `git commit`. | The user owns history and publishing. |
| **D12** | **Name: `html2frame`** (repo `Ruben-Vardanyan/html2frame`; Figma plugin name "html2frame"). | Short and neutral. It avoids "Figma" in the product name (brand guidelines) and is distinct from html.to.design. |
| **D13** | **MIT License** (`LICENSE`, © 2026 Ruben Vardanyan). It was added locally, not on GitHub, so the first push has no unrelated-history conflict. | Permissive and common for small tools. |
