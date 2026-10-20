// Formatting commands. Every command edits the Markdown text directly, so
// undo/redo, source mode and the saved file always agree.

import { EditorSelection } from '@codemirror/state';

/** Toggle an inline marker (e.g. "**") around each selection range. */
export function toggleInline(view, marker, placeholder = '') {
  const { state } = view;
  const len = marker.length;
  view.dispatch(state.changeByRange((range) => {
    const before = state.sliceDoc(range.from - len, range.from);
    const after = state.sliceDoc(range.to, range.to + len);
    if (before === marker && after === marker) {
      return {
        changes: [{ from: range.from - len, to: range.from }, { from: range.to, to: range.to + len }],
        range: EditorSelection.range(range.from - len, range.to - len),
      };
    }
    const text = state.sliceDoc(range.from, range.to);
    if (text.length >= 2 * len && text.startsWith(marker) && text.endsWith(marker)) {
      return {
        changes: { from: range.from, to: range.to, insert: text.slice(len, -len) },
        range: EditorSelection.range(range.from, range.to - 2 * len),
      };
    }
    const inner = text || placeholder;
    return {
      changes: { from: range.from, to: range.to, insert: marker + inner + marker },
      range: EditorSelection.range(range.from + len, range.from + len + inner.length),
    };
  }));
  view.focus();
}

function selectedLines(state) {
  const lines = new Map();
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to;) {
      const line = state.doc.lineAt(pos);
      lines.set(line.number, line);
      pos = line.to + 1;
    }
  }
  return [...lines.values()];
}

const BLOCK_PREFIX = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;

/** Set heading level 1–6 on the selected lines; 0 (or the same level again) makes a paragraph. */
export function setHeading(view, level) {
  const { state } = view;
  const changes = selectedLines(state).map((line) => {
    const current = /^(#{1,6})\s+/.exec(line.text);
    const stripped = line.text.replace(BLOCK_PREFIX, '$1');
    const toggleOff = level === 0 || (current && current[1].length === level);
    const insert = toggleOff ? stripped : '#'.repeat(level) + ' ' + stripped.trimStart();
    return { from: line.from, to: line.to, insert };
  });
  view.dispatch({ changes });
  view.focus();
}

/**
 * Toggle a line prefix (quote, bullet, ordered or task list) on the selected lines.
 * prefixFor(i) returns the prefix for the i-th line.
 */
export function toggleLinePrefix(view, test, prefixFor) {
  const { state } = view;
  const lines = selectedLines(state).filter((l) => l.text.trim() || state.selection.main.empty);
  const allHave = lines.length > 0 && lines.every((l) => test.test(l.text));
  const changes = lines.map((line, i) => {
    const stripped = line.text.replace(BLOCK_PREFIX, '$1');
    const indent = /^\s*/.exec(stripped)[0];
    const insert = allHave ? stripped : indent + prefixFor(i) + stripped.slice(indent.length);
    return { from: line.from, to: line.to, insert };
  });
  view.dispatch({ changes });
  view.focus();
}

/** Insert a block on its own lines, placing the caret at `caret` within it. */
export function insertBlock(view, text, caret = text.length) {
  const { state } = view;
  const { from, to } = state.selection.main;
  const line = state.doc.lineAt(from);
  const selected = state.sliceDoc(from, to);
  const body = selected && text.includes('\u0000') ? text.replace('\u0000', selected) : text.replace('\u0000', '');
  const needsBreakBefore = line.text.trim() !== '' && from === to ? 1 : 0;
  const lead = needsBreakBefore ? '\n\n' : '';
  const insertAt = needsBreakBefore ? line.to : from;
  const insert = lead + body + '\n';
  view.dispatch({
    changes: { from: insertAt, to: needsBreakBefore ? line.to : to, insert },
    selection: { anchor: insertAt + lead.length + Math.min(caret, body.length) },
    scrollIntoView: true,
  });
  view.focus();
}

export function insertLink(view, image = false) {
  const { state } = view;
  view.dispatch(state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const isUrl = /^(https?:\/\/|mailto:)\S+$/.test(text);
    const label = isUrl ? '' : text;
    const url = isUrl ? text : image ? 'path/to/image.png' : 'https://';
    const insert = `${image ? '!' : ''}[${label}](${url})`;
    const urlStart = range.from + insert.length - 1 - url.length;
    // With a label, select the URL to type over; otherwise put the caret in the label.
    const sel = label || isUrl
      ? (isUrl ? EditorSelection.cursor(range.from + (image ? 2 : 1)) : EditorSelection.range(urlStart, urlStart + url.length))
      : EditorSelection.cursor(range.from + (image ? 2 : 1));
    return { changes: { from: range.from, to: range.to, insert }, range: sel };
  }));
  view.focus();
}

export const TABLE_TEMPLATE = '| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |';
