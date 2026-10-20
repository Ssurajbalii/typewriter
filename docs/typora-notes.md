# Notes from studying Typora 1.14.10 (macOS)

Static inspection of the shipped app with REA, done so Typewriter could be designed. No Typora code, styles or assets are used in Typewriter.

- **Shell**: a native Cocoa app (universal Mach-O, Sparkle updater) hosting a WebKit view. It is not Electron.
- **Bridge**: JS calls native code through a WebViewJavascriptBridge with namespaced handlers, e.g. `document.updateChangeCount`, `library.newFile`, `word.updateWordCount`, `window.zoomIn`, `touchBar.*`.
- **Editor model**: one `contenteditable` document of block nodes tagged `mdtype` (paragraph, heading, fences, math_block, table/table_row/table_cell, list_item, hr, html_block, meta_block, toc).
- **Seamless preview**: inline syntax lives in `md-meta` spans that are hidden until the caret enters the element (`md-expand`). `md-focus` marks the active block for focus mode.
- **Libraries**: a marked-derived parser, CodeMirror for code fences and source mode, MathJax for math, Mermaid/flowchart.js/sequence diagrams, and plain CSS themes.

Typewriter keeps the same user-facing model (reveal syntax at the caret) but builds it on CodeMirror 6 decorations over plain Markdown text. Typora instead keeps a DOM model and serializes it back to Markdown.
