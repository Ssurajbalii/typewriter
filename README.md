# Typewriter

A seamless live-preview Markdown editor for macOS, inspired by Typora. There is no split preview: Markdown renders in place, and its syntax appears only where the caret is.

![Typewriter](screenshots/pitch/01-paper.png)

| | |
| --- | --- |
| ![Night theme with tasks, tables and code](screenshots/pitch/03-night.png) | ![Math and diagrams](screenshots/pitch/04-newsprint.png) |
| ![Focus mode](screenshots/pitch/05-sepia-focus.png) | ![Source mode](screenshots/pitch/07-source.png) |

## Run

Requires macOS and [Node.js](https://nodejs.org) 22 or newer.

```bash
git clone <this repo> && cd Typewriter
npm install
npm start        # build the renderer and launch the app
npm run dev      # Vite dev server + Electron, with hot reload for the renderer
npm run dist     # package a macOS .app/.dmg into release/
```

Open a file directly with `npm start -- path/to/file.md`.

## Features

- **Live preview**: headings, emphasis, strikethrough, `==highlight==`, inline code, links, images, blockquotes, lists and task lists (with clickable checkboxes), horizontal rules
- **Rich blocks**: KaTeX math (`$…$`, `$$…$$`), Mermaid diagrams, GFM tables and syntax-highlighted code fences. Click any of them to edit its source.
- **Modes**: source code mode (⌘/), focus mode (F8), typewriter mode (F9)
- **Sidebar**: live outline and a folder file tree (⇧⌘L)
- **Themes**: Paper, Night, Newsprint, Sepia. Follows the system appearance until you pick one.
- **Export**: standalone HTML and PDF. Math is exported as MathML and diagrams as inline SVG.
- Word/character count and reading time, find & replace, drag-and-drop files and images, recent documents, unsaved-changes prompts

## Architecture

| Layer | Files |
| --- | --- |
| Main process: windows, menus, file I/O, `twfile://` image protocol, PDF export | `electron/main.cjs` |
| Sandboxed bridge exposed to the renderer as `window.typewriter` | `electron/preload.cjs` |
| Markdown grammar (GFM + math + highlight) and highlight style | `src/editor/syntax.js` |
| Live preview decorations, focus and typewriter modes | `src/editor/livePreview.js` |
| Rendered widgets (math, tables, images, diagrams, checkboxes) | `src/editor/widgets.js` |
| Formatting commands | `src/editor/commands.js` |
| App controller, sidebar, export | `src/main.js`, `src/ui/sidebar.js`, `src/export.js` |

The Markdown text is the single source of truth. Live preview is a CodeMirror 6 decoration layer over it, so undo/redo, source mode and saved files always agree. See `docs/typora-notes.md` for what we learned from studying Typora.

### Adding a theme

Add a `[data-theme="name"]` block of CSS variables to `src/styles/themes.css`, and add the name to the Themes menu in `electron/main.cjs` and the theme list in `src/main.js`.

### Dev screenshots

`TW_CAPTURE=out.png npx electron . file.md` captures the window after load and quits. `TW_CAPTURE_CLICK="x,y"` and `TW_CAPTURE_TYPE="text"` simulate input first.
