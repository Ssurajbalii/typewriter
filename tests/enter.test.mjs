import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { newParagraphSpec, exitEmptyListItem } from '../src/editor/enter.js';

/** Press Enter at "|" in `doc`; returns the new text with "|" at the caret, or null if Enter falls through. */
function enter(docWithCaret) {
  const pos = docWithCaret.indexOf('|');
  const doc = docWithCaret.replace('|', '');
  const state = EditorState.create({ doc, selection: { anchor: pos }, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(state, doc.length, 5000);
  const spec = newParagraphSpec(state);
  if (!spec) return null;
  const next = state.update(spec).state;
  const text = next.doc.toString();
  const caret = next.selection.main.head;
  return text.slice(0, caret) + '|' + text.slice(caret);
}

test('Enter after a paragraph starts a new paragraph (so "-" makes a list, not a heading)', () => {
  assert.equal(enter('First paragraph.|'), 'First paragraph.\n\n|');
});

test('Enter after a heading starts a paragraph', () => {
  assert.equal(enter('# Title|'), '# Title\n\n|');
});

test('Enter in the middle of a paragraph splits it into two', () => {
  assert.equal(enter('Hello |world'), 'Hello \n\n|world');
});

test('a following block stays separate from the new paragraph', () => {
  assert.equal(enter('Line one|\nLine two'), 'Line one\n\n|\n\nLine two');
});

test('lists, quotes, code blocks and blank lines keep their own Enter', () => {
  assert.equal(enter('- item|'), null);
  assert.equal(enter('> quote|'), null);
  assert.equal(enter('```\ncode|\n```'), null);
  assert.equal(enter('Para\n|'), null);
});

/** Run exitEmptyListItem at "|"; returns text with caret, or null if it falls through. */
function exitList(docWithCaret) {
  const pos = docWithCaret.indexOf('|');
  const doc = docWithCaret.replace('|', '');
  let state = EditorState.create({ doc, selection: { anchor: pos }, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(state, doc.length, 5000);
  const ok = exitEmptyListItem({ state, dispatch: (tr) => { state = tr.state; ensureSyntaxTree(state, state.doc.length, 5000); } });
  if (!ok) return null;
  const text = state.doc.toString();
  const caret = state.selection.main.head;
  return text.slice(0, caret) + '|' + text.slice(caret);
}

test('Enter on an empty last item ends the list with a blank line after it', () => {
  assert.equal(exitList('- a\n- b\n- |'), '- a\n- b\n\n|');
  assert.equal(exitList('1. a\n2. |'), '1. a\n\n|');
  assert.equal(exitList('- [ ] task\n- [ ] |'), '- [ ] task\n\n|');
});

test('an empty nested item steps out one level instead', () => {
  const out = exitList('- a\n  - b\n  - |');
  assert.ok(out && !out.endsWith('\n\n|'), out);
});

test('Enter on a non-empty item is left to the list keymap', () => {
  assert.equal(exitList('- a|'), null);
});
