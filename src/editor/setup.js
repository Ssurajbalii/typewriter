import { EditorState, Compartment, Prec } from '@codemirror/state';
import { EditorView, keymap, dropCursor, highlightSpecialChars } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { indentOnInput } from '@codemirror/language';
import { markdownSupport, markdownHighlighting } from './syntax.js';
import { livePreview, focusMode, typewriterMode } from './livePreview.js';
import { enterKeymap } from './enter.js';

export const modes = {
  preview: new Compartment(),
  focus: new Compartment(),
  typewriter: new Compartment(),
};

let baseExtensions = [];

function makeState(doc, previous, selection) {
  const current = (name, fallback) => (previous ? modes[name].get(previous) : fallback);
  return EditorState.create({
    doc,
    selection,
    extensions: [
      ...baseExtensions,
      modes.preview.of(current('preview', livePreview)),
      modes.focus.of(current('focus', [])),
      modes.typewriter.of(current('typewriter', [])),
    ],
  });
}

export function createEditor(parent, { doc = '', onChange, onSelection }) {
  const listeners = EditorView.updateListener.of((u) => {
    if (u.docChanged) onChange?.(u);
    if (u.docChanged || u.selectionSet) onSelection?.(u);
  });

  baseExtensions = [
    // Native caret and selection (no drawSelection): smoother and feels like a Mac text view.
    history(),
    dropCursor(),
    highlightSpecialChars(),
    indentOnInput(),
    closeBrackets(),
    search({ top: true }),
    EditorView.lineWrapping,
    markdownSupport(),
    // Above the Markdown keymap (Prec.high), which still handles Enter in lists and quotes.
    Prec.highest(keymap.of(enterKeymap)),
    markdownHighlighting,
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'on' }),
    listeners,
  ];

  return new EditorView({ state: makeState(doc), parent });
}

export function setMode(view, name, on) {
  const ext = { preview: livePreview, focus: focusMode, typewriter: typewriterMode }[name];
  view.dispatch({ effects: modes[name].reconfigure(on ? ext : []) });
}

/** A new editor state for another tab: own text, undo history and selection, current modes. */
export function newTabState(view, text, selection) {
  const len = text.length;
  const clamp = (n) => Math.max(0, Math.min(len, n ?? 0));
  const sel = selection ? { anchor: clamp(selection.anchor), head: clamp(selection.head) } : undefined;
  return makeState(text, view.state, sel);
}

/** Switch the view to a stored tab state, applying the current modes to it. */
export function showTabState(view, state) {
  const effects = Object.entries(modes).map(([name, c]) => c.reconfigure(c.get(view.state)));
  view.setState(state);
  view.dispatch({ effects });
}
