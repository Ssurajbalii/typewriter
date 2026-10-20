# Welcome to Typewriter

Typewriter is a **seamless** Markdown editor. There is no split preview: what you type renders *in place*, and the Markdown syntax shows up only where your caret is. Click into this **bold text** to see its `**` markers.

## Try it

- [x] Write Markdown as usual
- [ ] Click a checkbox to toggle it
- [ ] Press **⌘/** to switch to source mode

> Quotes, `inline code`, ~~strikethrough~~, ==highlights== and [links](https://example.com) all render while you type. ⌘-click a link to open it.

### Math

Inline math like $e^{i\pi} + 1 = 0$ and display math:

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

### Code

```js
function greet(name) {
  return `Hello, ${name}!`;
}
```

### Tables

| Shortcut | Action |
| --- | --- |
| ⌘1 – ⌘6 | Headings |
| ⌘B / ⌘I | Bold / Italic |
| ⌥⌘T | Insert table |
| F8 / F9 | Focus / Typewriter mode |

### Diagrams

```mermaid
graph LR
  Write --> Render --> Export
```

---

Open the sidebar with **⇧⌘L** to see the outline, or open a folder to browse your notes. Export to HTML or PDF from **File → Export**.
