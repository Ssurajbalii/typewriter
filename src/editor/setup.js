import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, dropCursor, highlightSpecialChars } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { indentOnInput } from '@codemirror/language';
import { markdownSupport, markdownHighlighting } from './syntax.js';
import { livePreview, focusMode, typewriterMode } from './livePreview.js';

export const modes = {
  preview: new Compartment(),
  focus: new Compartment(),
  typewriter: new Compartment(),
};

let baseExtensions = [];

function makeState(doc, previous) {
  const current = (name, fallback) => (previous ? modes[name].get(previous) : fallback);
  return EditorState.create({
    doc,
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

/** Load a different file: fresh state (so undo can't cross files), same modes. */
export function replaceDocument(view, text) {
  view.setState(makeState(text, view.state));
}
