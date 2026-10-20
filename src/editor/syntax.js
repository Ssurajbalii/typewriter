// Markdown grammar extensions on top of GFM: $inline math$, $$block math$$
// and ==highlight==, plus the highlight style shared by both editor modes.

import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Tag, tags as t } from '@lezer/highlight';

const DOLLAR = 36, BACKSLASH = 92, SPACE = 32, EQUALS = 61;

export const mathTag = Tag.define();
export const markTag = Tag.define();

const InlineMath = {
  defineNodes: [
    { name: 'InlineMath', style: mathTag },
    { name: 'InlineMathMark', style: t.processingInstruction },
  ],
  parseInline: [{
    name: 'InlineMath',
    before: 'Escape',
    parse(cx, next, pos) {
      if (next !== DOLLAR || cx.char(pos + 1) === DOLLAR) return -1;
      // Pandoc rules: no space just inside the delimiters, no digit right after the closer.
      if (cx.char(pos + 1) === SPACE || pos + 1 >= cx.end) return -1;
      let end = pos + 1;
      for (; end < cx.end; end++) {
        const c = cx.char(end);
        if (c === BACKSLASH) { end++; continue; }
        if (c === DOLLAR) break;
      }
      if (end >= cx.end || end === pos + 1 || cx.char(end - 1) === SPACE) return -1;
      const after = cx.char(end + 1);
      if (after >= 48 && after <= 57) return -1;
      return cx.addElement(cx.elt('InlineMath', pos, end + 1, [
        cx.elt('InlineMathMark', pos, pos + 1),
        cx.elt('InlineMathMark', end, end + 1),
      ]));
    },
  }],
};

const BlockMath = {
  defineNodes: [
    { name: 'BlockMath', block: true, style: mathTag },
    { name: 'BlockMathMark', style: t.processingInstruction },
  ],
  parseBlock: [{
    name: 'BlockMath',
    before: 'FencedCode',
    parse(cx, line) {
      const text = line.text.slice(line.pos);
      if (!text.startsWith('$$')) return false;
      const start = cx.lineStart + line.pos;

      // Single line: $$ x^2 $$
      const single = /^\$\$(.+)\$\$\s*$/.exec(text);
      if (single) {
        const closeAt = start + text.lastIndexOf('$$');
        cx.addElement(cx.elt('BlockMath', start, cx.lineStart + line.text.length, [
          cx.elt('BlockMathMark', start, start + 2),
          cx.elt('BlockMathMark', closeAt, closeAt + 2),
        ]));
        cx.nextLine();
        return true;
      }
      if (text.slice(2).trim() !== '') return false;

      const marks = [cx.elt('BlockMathMark', start, start + 2)];
      let end = cx.lineStart + line.text.length;
      let closed = false;
      while (cx.nextLine()) {
        end = cx.lineStart + line.text.length;
        if (/^\s*\$\$\s*$/.test(line.text)) {
          const markAt = cx.lineStart + line.text.indexOf('$$');
          marks.push(cx.elt('BlockMathMark', markAt, markAt + 2));
          closed = true;
          cx.nextLine();
          break;
        }
      }
      if (!closed) end = Math.min(end, cx.lineStart);
      cx.addElement(cx.elt('BlockMath', start, end, marks));
      return true;
    },
  }],
};

const Highlight = {
  defineNodes: [
    { name: 'Highlight', style: markTag },
    { name: 'HighlightMark', style: t.processingInstruction },
  ],
  parseInline: [{
    name: 'Highlight',
    parse(cx, next, pos) {
      if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === SPACE) return -1;
      for (let end = pos + 2; end < cx.end - 1; end++) {
        if (cx.char(end) === EQUALS && cx.char(end + 1) === EQUALS) {
          if (end === pos + 2 || cx.char(end - 1) === SPACE) return -1;
          return cx.addElement(cx.elt('Highlight', pos, end + 2, [
            cx.elt('HighlightMark', pos, pos + 2),
            cx.elt('HighlightMark', end, end + 2),
          ]));
        }
      }
      return -1;
    },
  }],
};

export function markdownSupport() {
  return markdown({
    base: markdownLanguage, // CommonMark + GFM (tables, task lists, strikethrough, autolinks)
    codeLanguages: languages,
    extensions: [InlineMath, BlockMath, Highlight],
  });
}

// Colors come from CSS variables so every theme restyles the editor for free.
const style = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700', color: 'var(--heading)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--muted)' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--muted)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
  { tag: t.quote, color: 'var(--quote)' },
  { tag: t.processingInstruction, color: 'var(--syntax-mark)' },
  { tag: t.contentSeparator, color: 'var(--syntax-mark)' },
  { tag: mathTag, color: 'var(--math)' },
  { tag: markTag, backgroundColor: 'var(--highlight)' },
  // Code inside fenced blocks
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--code-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--code-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--code-function)' },
  { tag: [t.typeName, t.className, t.tagName], color: 'var(--code-type)' },
  { tag: [t.attributeName, t.propertyName], color: 'var(--code-property)' },
]);

export const markdownHighlighting = syntaxHighlighting(style);
