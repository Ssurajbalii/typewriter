# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot, Gemini CLI, …) working on Typewriter, a seamless live-preview Markdown editor for macOS built with Electron and CodeMirror 6. Humans should start with `README.md`.

## Setup

Requirements: macOS, Node.js 22+ and npm. No other system dependencies.

```bash
git clone https://github.com/Ssurajbalii/typewriter.git
cd typewriter
npm install
node node_modules/electron/install.js   # pre-fetch the Electron binary (otherwise fetched on first launch)
npm run build                           # must succeed before you claim a change works
```

npm 11 may warn that some install scripts are "not yet covered by allowScripts". That is expected and harmless: Electron fetches its binary itself through the command above.

## Commands

| Command | What it does |
| --- | --- |
| `npm run build` | Vite build of the renderer into `dist/`. It is the fastest correctness check. |
| `npm start` | Build, then launch the app. Add `-- path/to/file.md` to open a file. |
| `npm run dev` | Vite dev server + Electron with renderer hot reload. |
| `npm run dist` | Package a macOS app with electron-builder (unsigned). |
| `npx electron scripts/frame-screenshots.cjs` | Rebuild the framed pitch images in `screenshots/pitch/` from `screenshots/raw/`. |

There is no test suite yet. Verify changes with a build plus a screenshot (below).

## Verifying UI changes without a human

The main process has an env-gated capture hook. It saves a PNG of the window and quits, so you can check rendering headlessly:

```bash
npm run build
TW_CAPTURE=/tmp/shot.png npx electron . path/to/doc.md
```

Optional variables, applied in this order:

| Variable | Example | Effect |
| --- | --- | --- |
| `TW_CAPTURE_SIZE` | `1280,820` | Window content size |
| `TW_CAPTURE_ACTIONS` | `theme-night,toggle-focus` | Menu actions (any key of `actions` in `src/main.js`) |
| `TW_CAPTURE_JS` | `document.querySelector('.cm-scroller').scrollTop=800` | JS run in the renderer |
| `TW_CAPTURE_CLICK` | `450,300` | Left click at CSS pixel coordinates |
| `TW_CAPTURE_TYPE` | `hello` | Types characters |
| `TW_CAPTURE_KEYS` | `meta+Up,Down` | Key presses, modifiers joined with `+` |

Capture runs use a throwaway profile in the OS temp directory, so they never change the user's settings. Renderer console output is printed as `[renderer:<level>]`. Screenshots are at 2× scale, so divide image pixels by 2 to get click coordinates.

## Architecture

The Markdown text is the single source of truth. Live preview is only a decoration layer over it, so never keep document state anywhere else.

| Area | File | Notes |
| --- | --- | --- |
| Main process | `electron/main.cjs` | Windows, native menus (they send `menu` actions to the renderer), file I/O over IPC, the `twfile://` image protocol, PDF export |
| Bridge | `electron/preload.cjs` | The only API the renderer gets, exposed as `window.typewriter` |
| Grammar | `src/editor/syntax.js` | GFM plus Lezer extensions for `$math$`, `$$math$$` and `==highlight==`; highlight style uses CSS variables |
| Live preview | `src/editor/livePreview.js` | A `StateField` that hides syntax and inserts widgets wherever the selection is *not*. Also focus and typewriter modes. |
| Widgets | `src/editor/widgets.js` | Rendered stand-ins: math, tables, images, Mermaid, checkboxes, bullets |
| Commands | `src/editor/commands.js` | Formatting commands that edit the Markdown text directly |
| Editor setup | `src/editor/setup.js` | Extensions and compartments (`preview`, `focus`, `typewriter`) |
| App controller | `src/main.js` | Wires menus, modes, themes, save/open, drag-and-drop |
| Sidebar / export | `src/ui/sidebar.js`, `src/export.js` | Outline and file tree; standalone HTML (MathML math, inline SVG diagrams) |
| Styles | `src/styles/` | `themes.css` holds variables only; `editor.css` styles the editor; `app.css` styles the chrome |

### How to add things

- **Menu command:** add a menu item in `electron/main.cjs` that calls `send('my-action')`, then handle `'my-action'` in the `actions` map in `src/main.js`.
- **Rendered element:** handle its syntax node in `buildDecorations` (`livePreview.js`). Render only when `touches(...)` / `touchesLines(...)` is false, and return `false` to skip children you replaced. Multi-line replacements must use `blockReplace` (block widgets are only legal from a `StateField`).
- **Theme:** add a `[data-theme="name"]` variable block to `themes.css`, then add it to the Themes menu (`main.cjs`) and the theme list in `src/main.js`. Add dark themes to `DARK_THEMES`.

## Rules and gotchas

- **Security model:** the renderer is sandboxed (`contextIsolation`, no Node). Give it new filesystem or OS access only through a narrow IPC handler in `main.cjs` and an entry in `preload.cjs`. `twfile://` deliberately serves image files only.
- **Native caret:** don't add `drawSelection()`. The app uses the native macOS caret and selection on purpose; the drawn cursor disappeared in this layout and felt laggy.
- **Minimal UI:** no visible toolbars or permanent status bar. The footer only appears on hover, and the sidebar is hidden by default. Put new features in menus and shortcuts.
- **CSS specificity:** CodeMirror's base theme beats plain selectors. Prefix editor rules with `.cm-editor`. Never put margins on `.cm-line`, because they break CodeMirror's height measurement; use padding.
- **Mermaid:** keep `htmlLabels: false`. HTML labels live in `foreignObject`, which DOMPurify strips.
- **Clean room:** `vendor/` (gitignored) may contain a downloaded copy of Typora used only for study. Never copy code, CSS, themes or assets from it into this repo.
- **Generated files:** don't commit `dist/`, `release/` or `node_modules/`.
