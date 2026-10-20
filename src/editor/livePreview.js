// Seamless live preview. Markdown stays the single source of truth; this
// extension only decorates it. Syntax markers are hidden and rich elements
// (math, images, tables, diagrams, checkboxes) are rendered wherever the
// selection is NOT. When the caret enters an element its raw source is
// revealed in place, so editing never leaves the document.

import { StateField, EditorState } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import {
  BulletWidget, CheckboxWidget, HrWidget, ImageWidget, MathWidget,
  MermaidWidget, TableWidget, CodeLangWidget,
} from './widgets.js';

const hidden = Decoration.replace({});
const lineClass = (cls) => Decoration.line({ class: cls });
const markClass = (cls) => Decoration.mark({ class: cls });

const INLINE_MARKS = {
  Emphasis: 'EmphasisMark',
  StrongEmphasis: 'EmphasisMark',
  InlineCode: 'CodeMark',
  Strikethrough: 'StrikethroughMark',
  Highlight: 'HighlightMark',
};

function touches(state, from, to) {
  for (const r of state.selection.ranges) if (r.from <= to && r.to >= from) return true;
  return false;
}

function touchesLines(state, from, to) {
  return touches(state, state.doc.lineAt(from).from, state.doc.lineAt(to).to);
}

/** Hide a marker plus one following space ("# ", "> ", "- "). */
function hideWithSpace(decos, doc, from, to) {
  if (doc.sliceString(to, to + 1) === ' ') to++;
  if (to > from) decos.push(hidden.range(from, to));
}

function eachLine(doc, from, to, fn) {
  for (let pos = from; pos <= to;) {
    const line = doc.lineAt(pos);
    fn(line);
    pos = line.to + 1;
  }
}

function listDepth(node) {
  let depth = -1;
  for (let n = node.parent; n; n = n.parent) {
    if (n.name === 'BulletList' || n.name === 'OrderedList') depth++;
  }
  return Math.max(0, depth);
}

function blockReplace(decos, doc, from, to, widget) {
  decos.push(Decoration.replace({ widget, block: true }).range(doc.lineAt(from).from, doc.lineAt(to).to));
}

function buildDecorations(state) {
  const { doc } = state;
  const decos = [];

  syntaxTree(state).iterate({
    enter(ref) {
      const { name, from, to } = ref;
      const node = ref.node;

      if (/^ATXHeading[1-6]$/.test(name)) {
        decos.push(lineClass(`cm-heading cm-h${name.slice(-1)}`).range(doc.lineAt(from).from));
        if (!touchesLines(state, from, to)) {
          const marks = node.getChildren('HeaderMark');
          if (marks[0]) hideWithSpace(decos, doc, marks[0].from, marks[0].to);
          // Optional closing hashes: "## Title ##"
          for (const m of marks.slice(1)) {
            let start = m.from;
            while (start > from && doc.sliceString(start - 1, start) === ' ') start--;
            decos.push(hidden.range(start, m.to));
          }
        }
        return;
      }

      if (name === 'SetextHeading1' || name === 'SetextHeading2') {
        const level = name.slice(-1);
        const mark = node.getChild('HeaderMark');
        eachLine(doc, from, mark ? mark.from - 1 : to, (l) =>
          decos.push(lineClass(`cm-heading cm-h${level}`).range(l.from)));
        if (mark) {
          const markLine = doc.lineAt(mark.from);
          decos.push(lineClass('cm-setext-mark').range(markLine.from));
          if (!touchesLines(state, from, to)) decos.push(hidden.range(markLine.from, markLine.to));
        }
        return;
      }

      switch (name) {
        case 'Blockquote':
          eachLine(doc, from, to, (l) => decos.push(lineClass('cm-blockquote').range(l.from)));
          return;

        case 'QuoteMark':
          if (!touchesLines(state, from, to)) hideWithSpace(decos, doc, from, to);
          return;

        case 'ListMark': {
          const item = node.parent;
          const isTask = !!item?.getChild('Task');
          const isBullet = item?.parent?.name === 'BulletList';
          if (touchesLines(state, from, to)) return;
          if (isTask) hideWithSpace(decos, doc, from, to);
          else if (isBullet && doc.sliceString(to, to + 1) === ' ') {
            decos.push(Decoration.replace({ widget: new BulletWidget(listDepth(item)) }).range(from, to));
          }
          return;
        }

        case 'TaskMarker': {
          const checked = doc.sliceString(from + 1, from + 2).toLowerCase() === 'x';
          if (checked && node.parent) decos.push(markClass('cm-task-done').range(to, node.parent.to));
          if (!touches(state, from, to)) {
            decos.push(Decoration.replace({ widget: new CheckboxWidget(checked, from) }).range(from, to));
          }
          return;
        }

        case 'HorizontalRule':
          if (!touchesLines(state, from, to)) {
            decos.push(Decoration.replace({ widget: new HrWidget() }).range(from, to));
          }
          return;

        case 'FencedCode': {
          const first = doc.lineAt(from);
          const last = doc.lineAt(to);
          const info = node.getChild('CodeInfo');
          const lang = info ? doc.sliceString(info.from, info.to).trim() : '';
          const active = touchesLines(state, from, to);
          const text = node.getChild('CodeText');
          const source = text ? doc.sliceString(text.from, text.to) : '';

          if (!active && lang.toLowerCase() === 'mermaid') {
            blockReplace(decos, doc, from, to, new MermaidWidget(source, from));
            return false;
          }
          eachLine(doc, first.from, last.to, (l) => {
            let cls = 'cm-codeblock';
            if (l.number === first.number) cls += ' cm-codeblock-begin';
            if (l.number === last.number) cls += ' cm-codeblock-end';
            decos.push(lineClass(cls).range(l.from));
          });
          if (!active) {
            if (lang) decos.push(Decoration.replace({ widget: new CodeLangWidget(lang) }).range(first.from, first.to));
            else if (first.to > first.from) decos.push(hidden.range(first.from, first.to));
            const closing = last.number !== first.number && /^\s*(`{3,}|~{3,})\s*$/.test(last.text);
            if (closing && last.to > last.from) decos.push(hidden.range(last.from, last.to));
          }
          return false;
        }

        case 'BlockMath': {
          const marks = node.getChildren('BlockMathMark');
          const texFrom = marks[0] ? marks[0].to : from;
          const texTo = marks.length > 1 ? marks[marks.length - 1].from : to;
          if (!touchesLines(state, from, to)) {
            blockReplace(decos, doc, from, to, new MathWidget(doc.sliceString(texFrom, texTo).trim(), true, from));
          } else {
            eachLine(doc, from, to, (l) => decos.push(lineClass('cm-math-source').range(l.from)));
          }
          return false;
        }

        case 'InlineMath':
          if (!touches(state, from, to)) {
            const tex = doc.sliceString(from + 1, to - 1);
            decos.push(Decoration.replace({ widget: new MathWidget(tex, false, from) }).range(from, to));
          }
          return false;

        case 'Table':
          if (!touchesLines(state, from, to)) {
            const start = doc.lineAt(from).from;
            blockReplace(decos, doc, from, to, new TableWidget(doc.sliceString(start, doc.lineAt(to).to), start));
          } else {
            eachLine(doc, from, to, (l) => decos.push(lineClass('cm-table-source').range(l.from)));
          }
          return false;

        case 'Image': {
          if (touches(state, from, to)) return;
          const url = node.getChild('URL');
          if (!url) return;
          const marks = node.getChildren('LinkMark');
          const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : '';
          const src = doc.sliceString(url.from, url.to).replace(/^<|>$/g, '');
          decos.push(Decoration.replace({ widget: new ImageWidget(src, alt, from) }).range(from, to));
          return false;
        }

        case 'Link': {
          const marks = node.getChildren('LinkMark');
          if (marks.length < 2 || !(node.getChild('URL') || node.getChild('LinkLabel'))) return;
          decos.push(markClass('cm-link').range(marks[0].to, marks[1].from));
          if (!touches(state, from, to)) {
            decos.push(hidden.range(marks[0].from, marks[0].to));
            decos.push(hidden.range(marks[1].from, to));
          }
          return; // descend: link text may contain emphasis
        }

        case 'Escape':
          if (!touches(state, from, to)) decos.push(hidden.range(from, from + 1));
          return;

        case 'HTMLBlock':
        case 'CommentBlock':
          eachLine(doc, from, to, (l) => decos.push(lineClass('cm-html-block').range(l.from)));
          return false;
      }

      const markName = INLINE_MARKS[name];
      if (markName) {
        if (name === 'InlineCode') decos.push(markClass('cm-inline-code').range(from, to));
        if (!touches(state, from, to)) {
          for (const m of node.getChildren(markName)) decos.push(hidden.range(m.from, m.to));
        }
      }
    },
  });

  return Decoration.set(decos, true);
}

const livePreviewField = StateField.define({
  create: buildDecorations,
  update(decos, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return buildDecorations(tr.state);
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Cmd/Ctrl-click follows links (rendered links reveal their source on a plain click). */
const followLinks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    for (let n = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) {
      if (n.name === 'Link' || n.name === 'Autolink' || n.name === 'URL') {
        const urlNode = n.name === 'URL' ? n : n.getChild('URL');
        if (!urlNode) return false;
        const url = view.state.doc.sliceString(urlNode.from, urlNode.to).replace(/^<|>$/g, '');
        window.dispatchEvent(new CustomEvent('typewriter:open-link', { detail: url }));
        event.preventDefault();
        return true;
      }
    }
    return false;
  },
});

export const livePreview = [livePreviewField, followLinks, EditorView.contentAttributes.of({ class: 'cm-live' })];

// ---- Focus mode: dim everything except the block holding the caret ------

const dimmed = lineClass('cm-dimmed');

function activeBlockRange(state) {
  const head = state.selection.main.head;
  let node = syntaxTree(state).resolveInner(head, -1);
  while (node.parent && node.parent.parent) node = node.parent;
  const line = state.doc.lineAt(head);
  if (!node.parent || line.length === 0) return [line.from, line.to];
  return [state.doc.lineAt(node.from).from, state.doc.lineAt(node.to).to];
}

export const focusMode = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) {
    if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = this.build(u.view);
  }
  build(view) {
    const [a, b] = activeBlockRange(view.state);
    const decos = [];
    for (const { from, to } of view.visibleRanges) {
      eachLine(view.state.doc, from, to, (l) => {
        if (l.to < a || l.from > b) decos.push(dimmed.range(l.from));
      });
    }
    return Decoration.set(decos);
  }
}, { decorations: (v) => v.decorations });

// ---- Typewriter mode: keep the caret line vertically centred -------------

export const typewriterMode = [
  EditorState.transactionExtender.of((tr) =>
    tr.selection || tr.docChanged
      ? { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: 'center' }) }
      : null),
  EditorView.contentAttributes.of({ class: 'cm-typewriter' }),
];
