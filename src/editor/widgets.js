// Rendered stand-ins for Markdown source: shown while the caret is elsewhere,
// swapped back to editable source as soon as the caret enters the element.

import { WidgetType } from '@codemirror/view';
import katex from 'katex';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { resolveAssetUrl } from './assets.js';
import { renderMermaid } from './mermaid.js';

/** Move the caret into the source a widget stands for, revealing it. */
function revealOnMouseDown(dom, view, pos) {
  dom.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    view.dispatch({ selection: { anchor: typeof pos === 'function' ? pos() : pos } });
    view.focus();
  });
}

export class BulletWidget extends WidgetType {
  constructor(depth) { super(); this.depth = depth; }
  eq(other) { return other.depth === this.depth; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-bullet';
    span.textContent = ['•', '◦', '▪'][this.depth % 3];
    return span;
  }
}

export class CheckboxWidget extends WidgetType {
  constructor(checked, pos) { super(); this.checked = checked; this.pos = pos; }
  eq(other) { return other.checked === this.checked && other.pos === this.pos; }
  toDOM(view) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-task-checkbox';
    box.checked = this.checked;
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      e.preventDefault();
      // The marker is "[ ]" or "[x]"; the state character sits at pos + 1.
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? ' ' : 'x' } });
    });
    return box;
  }
  ignoreEvent() { return true; }
}

export class HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const hr = document.createElement('span');
    hr.className = 'cm-hr';
    return hr;
  }
}

export class ImageWidget extends WidgetType {
  constructor(src, alt, pos) { super(); this.src = src; this.alt = alt; this.pos = pos; }
  eq(other) { return other.src === this.src && other.alt === this.alt && other.pos === this.pos; }
  toDOM(view) {
    const wrap = document.createElement('span');
    wrap.className = 'cm-image';
    const img = document.createElement('img');
    img.src = resolveAssetUrl(this.src);
    img.alt = this.alt;
    img.title = this.src;
    img.addEventListener('load', () => view.requestMeasure());
    img.addEventListener('error', () => {
      wrap.classList.add('cm-image-error');
      wrap.textContent = `⚠ Image not found: ${this.src}`;
    });
    wrap.appendChild(img);
    revealOnMouseDown(wrap, view, this.pos);
    return wrap;
  }
  ignoreEvent() { return false; }
}

export class MathWidget extends WidgetType {
  constructor(tex, display, pos) { super(); this.tex = tex; this.display = display; this.pos = pos; }
  eq(other) { return other.tex === this.tex && other.display === this.display && other.pos === this.pos; }
  toDOM(view) {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = this.display ? 'cm-math-block' : 'cm-math-inline';
    if (!this.tex.trim()) {
      el.classList.add('cm-placeholder');
      el.textContent = this.display ? 'Empty math block' : '';
    } else {
      try {
        katex.render(this.tex, el, { displayMode: this.display, throwOnError: true, output: 'html' });
      } catch (err) {
        el.classList.add('cm-render-error');
        el.textContent = err.message.replace(/^KaTeX parse error: /, '');
      }
    }
    revealOnMouseDown(el, view, this.pos);
    return el;
  }
  ignoreEvent() { return false; }
}

export class MermaidWidget extends WidgetType {
  constructor(source, pos) {
    super();
    this.source = source;
    this.pos = pos;
    // Part of identity so a theme switch re-renders with the matching palette.
    this.theme = document.documentElement.dataset.scheme === 'dark' ? 'dark' : 'default';
  }
  eq(other) { return other.source === this.source && other.pos === this.pos && other.theme === this.theme; }
  toDOM(view) {
    const el = document.createElement('div');
    el.className = 'cm-diagram';
    el.textContent = 'Rendering diagram…';
    renderMermaid(this.source, this.theme)
      .then((svg) => {
        el.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true, html: true } });
        view.requestMeasure();
      })
      .catch((err) => {
        el.classList.add('cm-render-error');
        el.textContent = `Diagram error: ${String(err.message || err).split('\n')[0]}`;
      });
    revealOnMouseDown(el, view, this.pos);
    return el;
  }
  ignoreEvent() { return false; }
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim());
}

export class TableWidget extends WidgetType {
  constructor(source, pos) { super(); this.source = source; this.pos = pos; }
  eq(other) { return other.source === this.source && other.pos === this.pos; }
  toDOM(view) {
    const lines = this.source.split('\n').filter((l) => l.trim());
    const header = splitRow(lines[0] ?? '');
    const align = splitRow(lines[1] ?? '').map((c) =>
      c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '');
    const rows = lines.slice(2).map(splitRow);

    const table = document.createElement('table');
    table.className = 'cm-table';
    const cell = (tag, text, i) => {
      const el = document.createElement(tag);
      el.innerHTML = DOMPurify.sanitize(marked.parseInline(text));
      if (align[i]) el.style.textAlign = align[i];
      return el;
    };
    const thead = table.createTHead().insertRow();
    header.forEach((h, i) => thead.appendChild(cell('th', h, i)));
    const tbody = table.createTBody();
    for (const row of rows) {
      const tr = tbody.insertRow();
      header.forEach((_, i) => tr.appendChild(cell('td', row[i] ?? '', i)));
    }

    const wrap = document.createElement('div');
    wrap.className = 'cm-table-wrap';
    wrap.appendChild(table);
    // Clicking a cell puts the caret in that cell's source.
    wrap.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const td = e.target.closest('td, th');
      let anchor = this.pos;
      if (td) {
        const rowIndex = td.parentElement.rowIndex; // 0 = header
        const colIndex = td.cellIndex;
        const srcLines = this.source.split('\n');
        const lineIndex = rowIndex === 0 ? 0 : rowIndex + 1;
        let offset = 0;
        for (let i = 0; i < lineIndex && i < srcLines.length; i++) offset += srcLines[i].length + 1;
        const line = srcLines[lineIndex] ?? '';
        const pipes = [...line.matchAll(/(?<!\\)\|/g)].map((m) => m.index);
        const leading = line.trimStart().startsWith('|') ? 1 : 0;
        const pipeBefore = pipes[colIndex + leading - 1];
        const cellStart = pipeBefore === undefined ? 0 : pipeBefore + 1;
        const firstChar = line.slice(cellStart).search(/\S/);
        anchor = this.pos + offset + cellStart + Math.max(0, firstChar);
      }
      view.dispatch({ selection: { anchor } });
      view.focus();
    });
    return wrap;
  }
  ignoreEvent() { return false; }
}

export class CodeLangWidget extends WidgetType {
  constructor(lang) { super(); this.lang = lang; }
  eq(other) { return other.lang === this.lang; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-code-lang';
    span.textContent = this.lang;
    return span;
  }
}
