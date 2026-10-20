// Standalone HTML export (also the source for PDF export).
// Math is emitted as MathML so the file needs no fonts or scripts.

import { Marked } from 'marked';
import katex from 'katex';
import { renderMermaid } from './editor/mermaid.js';
import { getDocumentDir } from './editor/assets.js';

const katexOpts = (displayMode) => ({ displayMode, output: 'mathml', throwOnError: false });
const startAt = (i) => (i >= 0 ? i : undefined);
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function createMarked({ absoluteImages }) {
  const md = new Marked({ gfm: true, async: true });
  md.use({
    extensions: [
      {
        name: 'blockMath',
        level: 'block',
        start: (src) => startAt(src.indexOf('$$')),
        tokenizer(src) {
          const m = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src);
          if (m) return { type: 'blockMath', raw: m[0], text: m[1].trim() };
        },
        renderer: (t) => `<div class="math-block">${katex.renderToString(t.text, katexOpts(true))}</div>\n`,
      },
      {
        name: 'inlineMath',
        level: 'inline',
        start: (src) => startAt(src.indexOf('$')),
        tokenizer(src) {
          const m = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
          if (m) return { type: 'inlineMath', raw: m[0], text: m[1] };
        },
        renderer: (t) => katex.renderToString(t.text, katexOpts(false)),
      },
      {
        name: 'mark',
        level: 'inline',
        start: (src) => startAt(src.indexOf('==')),
        tokenizer(src) {
          const m = /^==(?!\s)([^=\n]+?)(?<!\s)==/.exec(src);
          if (m) return { type: 'mark', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
        },
        renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; },
      },
    ],
    async walkTokens(token) {
      if (token.type === 'code' && token.lang === 'mermaid') {
        try { token.svg = await renderMermaid(token.text, 'default'); } catch { token.svg = null; }
      }
    },
    renderer: {
      code(token) {
        if (token.svg) return `<div class="diagram">${token.svg}</div>\n`;
        const lang = (token.lang || '').split(/\s/)[0];
        return `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(token.text)}</code></pre>\n`;
      },
      image(token) {
        let src = token.href;
        const dir = getDocumentDir();
        if (absoluteImages && dir && !/^([a-z]+:|\/)/i.test(src)) src = `file://${dir}/${src.replace(/^\.\//, '')}`;
        else if (absoluteImages && src.startsWith('/')) src = `file://${src}`;
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(token.text)}"${title}>`;
      },
      checkbox({ checked }) {
        return `<input type="checkbox" disabled${checked ? ' checked' : ''}> `;
      },
    },
  });
  return md;
}

const THEME_VARS = ['--bg', '--text', '--muted', '--heading', '--accent', '--quote', '--border',
  '--code-bg', '--highlight', '--font-body', '--font-heading', '--font-mono'];

function themeCss() {
  const cs = getComputedStyle(document.documentElement);
  return `:root{${THEME_VARS.map((v) => `${v}:${cs.getPropertyValue(v).trim()};`).join('')}}`;
}

const EXPORT_CSS = `
html{background:var(--bg);color:var(--text)}
body{font-family:var(--font-body);font-size:16px;line-height:1.7;max-width:820px;margin:0 auto;padding:48px 32px}
h1,h2,h3,h4,h5,h6{font-family:var(--font-heading);color:var(--heading);line-height:1.3;margin:1.6em 0 .6em}
h1{font-size:2.1em}h2{font-size:1.6em;border-bottom:1px solid var(--border);padding-bottom:.25em}h3{font-size:1.3em}
a{color:var(--accent)}img{max-width:100%}
blockquote{margin:1em 0;padding:.2em 1em;border-left:4px solid var(--border);color:var(--quote)}
code{font-family:var(--font-mono);font-size:.88em;background:var(--code-bg);padding:.15em .35em;border-radius:4px}
pre{background:var(--code-bg);padding:14px 16px;border-radius:6px;overflow:auto}pre code{background:none;padding:0}
table{border-collapse:collapse;margin:1em 0}th,td{border:1px solid var(--border);padding:6px 12px}th{background:var(--code-bg)}
hr{border:0;border-top:1px solid var(--border);margin:2em 0}mark{background:var(--highlight);color:inherit}
li:has(> input[type=checkbox]),li:has(> p > input[type=checkbox]){list-style:none;margin-left:-1.4em}.math-block{text-align:center;margin:1em 0;overflow-x:auto}
.diagram{text-align:center;margin:1em 0}
@media print{body{padding:0;max-width:none}pre,blockquote,table,img,.diagram{break-inside:avoid}}
`;

export async function renderExportHtml(markdownText, title, { forPdf = false } = {}) {
  const body = await createMarked({ absoluteImages: forPdf }).parse(markdownText);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${themeCss()}${EXPORT_CSS}</style>
</head><body>
${body}
</body></html>`;
}
