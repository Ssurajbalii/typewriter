// Enter starts a new paragraph, as in Typora.
//
// In Markdown, lines without a blank line between them belong to the same
// paragraph, and a "-" or "=" line directly under a paragraph turns it into a
// heading ("setext" heading). So a plain newline after a paragraph followed by
// "- item" briefly renders the paragraph as a heading. Inserting a blank line
// keeps each block separate. Lists, quotes, code and tables keep their own
// Enter behaviour; Shift+Enter inserts a plain line break.

import { syntaxTree } from '@codemirror/language';
import { EditorSelection } from '@codemirror/state';
import { insertNewline } from '@codemirror/commands';
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown';

const OWN_ENTER = new Set([
  'ListItem', 'Blockquote', 'FencedCode', 'CodeBlock', 'Table',
  'HTMLBlock', 'CommentBlock', 'BlockMath', 'LinkReference',
]);
const PROSE = /^(Paragraph|ATXHeading[1-6]|SetextHeading[12])$/;

/** Transaction spec for Enter in a top-level paragraph or heading, or null to fall through. */
export function newParagraphSpec(state) {
  if (state.selection.ranges.length > 1) return null;
  const { from, to } = state.selection.main;
  const line = state.doc.lineAt(from);
  if (!line.text.trim()) return null; // on a blank line a plain newline is right

  let prose = false;
  for (let n = syntaxTree(state).resolveInner(from, -1); n; n = n.parent) {
    if (OWN_ENTER.has(n.name)) return null;
    if (PROSE.test(n.name)) prose = true;
  }
  if (!prose) return null;

  // Keep the new paragraph separate from a block that directly follows.
  const atLineEnd = to === state.doc.lineAt(to).to;
  const next = atLineEnd && line.number < state.doc.lines ? state.doc.line(state.doc.lineAt(to).number + 1) : null;
  const after = next && next.text.trim() ? '\n' : '';

  return {
    changes: { from, to, insert: '\n\n' + after },
    selection: EditorSelection.cursor(from + 2),
    scrollIntoView: true,
    userEvent: 'input',
  };
}

export function enterNewParagraph(view) {
  const spec = newParagraphSpec(view.state);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
}

const EMPTY_ITEM = /^\s*([-*+]|\d+[.)])(\s+\[[ xX]\])?\s*$/;

/**
 * Enter on an empty list item ends the list immediately, as in Typora.
 * The marker is removed and a blank line separates the list from what comes
 * next, so new text isn't absorbed into the last item ("lazy continuation").
 * An empty nested item steps out one level instead (CodeMirror's behaviour).
 */
export function exitEmptyListItem({ state, dispatch }) {
  if (state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(state.selection.main.head);
  if (!EMPTY_ITEM.test(line.text)) return false;
  if (/^\s/.test(line.text)) return insertNewlineContinueMarkup({ state, dispatch });

  const prevBlank = line.number === 1 || state.doc.line(line.number - 1).text.trim() === '';
  const insert = prevBlank ? '' : '\n';
  dispatch(state.update({
    changes: { from: line.from, to: line.to, insert },
    selection: { anchor: line.from + insert.length },
    scrollIntoView: true,
    userEvent: 'input',
  }));
  return true;
}

export const enterKeymap = [
  { key: 'Enter', run: enterNewParagraph },
  { key: 'Enter', run: exitEmptyListItem },
  { key: 'Shift-Enter', run: insertNewline },
];
