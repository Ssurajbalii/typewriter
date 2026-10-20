// Tabs and session persistence ("hot exit", as in Notepad++).
//
// Each tab keeps its own CodeMirror EditorState (text, undo history,
// selection). The active tab's state lives in the view; inactive ones are
// stored here. The whole session is snapshotted to disk shortly after every
// change and when the window closes, so unsaved tabs survive restarts.

import { Text } from '@codemirror/state';
import { basename } from './paths.js';

export const SESSION_VERSION = 1;

const textOf = (s) => Text.of(s.split(/\r\n?|\n/));

/** Next free "Untitled", "Untitled 2", … name. */
export function nextUntitledName(taken) {
  const used = new Set(taken);
  if (!used.has('Untitled')) return 'Untitled';
  for (let n = 2; ; n++) if (!used.has(`Untitled ${n}`)) return `Untitled ${n}`;
}

/** Files are dirty when they differ from disk; untitled tabs when they have any text. */
export function isDirty(doc, saved) {
  return saved ? !doc.eq(saved) : doc.length > 0;
}

/**
 * Serializable session. Clean file tabs store no content (they reload from
 * disk); dirty or untitled tabs store their full text.
 */
export function serializeSession(tabs, activeId) {
  return {
    version: SESSION_VERSION,
    active: activeId,
    tabs: tabs.map((t) => {
      const doc = t.state.doc;
      const sel = t.state.selection.main;
      return {
        id: t.id,
        path: t.path,
        name: t.name,
        content: t.path && !isDirty(doc, t.saved) ? null : doc.toString(),
        // Untitled tabs can have a clean baseline too (e.g. the Welcome tab).
        clean: !t.path && t.saved != null && !isDirty(doc, t.saved),
        selection: { anchor: sel.anchor, head: sel.head },
        scrollTop: Math.round(t.scrollTop || 0),
      };
    }),
  };
}

/**
 * Decide how each saved tab comes back, given each file's current disk
 * content (null if missing). Returns plain records; the caller builds states.
 */
export function planRestore(session, diskContents) {
  if (!session || session.version !== SESSION_VERSION || !Array.isArray(session.tabs)) return [];
  const out = [];
  for (const t of session.tabs) {
    const disk = t.path ? diskContents[t.path] ?? null : null;
    const content = t.content ?? disk;
    if (content == null) continue; // a clean file that no longer exists
    out.push({
      id: t.id,
      path: t.path ?? null,
      name: t.name ?? null,
      content,
      // null: untitled, or the file is gone (so the buffer is unsaved)
      saved: t.path ? disk : t.clean ? content : null,
      selection: t.selection,
      scrollTop: t.scrollTop ?? 0,
      active: t.id === session.active,
    });
  }
  return out;
}

let nextId = 1;
const newId = () => `t${Date.now().toString(36)}${(nextId++).toString(36)}`;

export class Tabs {
  /**
   * @param {object} o
   * @param {import('@codemirror/view').EditorView} o.view
   * @param {(text: string, selection?: object) => import('@codemirror/state').EditorState} o.makeState
   * @param {(state: import('@codemirror/state').EditorState) => void} o.showState
   * @param {() => void} o.onSwitch  called after the active tab changes
   * @param {() => void} o.onListChange  called when tabs are added, removed, renamed or change dirtiness
   */
  constructor({ view, makeState, showState, onSwitch, onListChange }) {
    Object.assign(this, { view, makeState, showState, onSwitch, onListChange });
    this.tabs = [];
    this.activeId = null;
  }

  get active() { return this.tabs.find((t) => t.id === this.activeId); }

  title(tab) { return tab.path ? basename(tab.path) : tab.name; }

  dirty(tab) {
    const doc = tab.id === this.activeId ? this.view.state.doc : tab.state.doc;
    return isDirty(doc, tab.saved);
  }

  findByPath(path) { return this.tabs.find((t) => t.path === path); }

  /** Capture the live view into the active tab record. */
  sync() {
    const tab = this.active;
    if (!tab) return;
    tab.state = this.view.state;
    tab.scrollTop = this.view.scrollDOM.scrollTop;
  }

  add({ path = null, name = null, content = '', saved = null, selection, scrollTop = 0, id } = {}, { activate = true } = {}) {
    const tab = {
      id: id ?? newId(),
      path,
      name: path ? null : name ?? nextUntitledName(this.tabs.filter((t) => !t.path).map((t) => t.name)),
      state: this.makeState(content, selection),
      saved: saved == null ? null : textOf(saved),
      scrollTop,
    };
    this.tabs.push(tab);
    if (activate) this.activate(tab.id);
    this.onListChange();
    return tab;
  }

  activate(id) {
    if (id === this.activeId) return;
    const target = this.tabs.find((t) => t.id === id);
    if (!target) return;
    this.sync();
    this.activeId = id;
    this.showState(target.state);
    // Restore scroll after CodeMirror has measured the new document.
    requestAnimationFrame(() => { this.view.scrollDOM.scrollTop = target.scrollTop || 0; });
    this.onSwitch();
    this.onListChange();
  }

  /** Remove a tab without asking. Keeps at least one (empty) tab open. */
  remove(id) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    const wasActive = id === this.activeId;
    this.tabs.splice(i, 1);
    if (!this.tabs.length) {
      this.activeId = null;
      this.add();
      return;
    }
    if (wasActive) {
      this.activeId = null;
      this.activate(this.tabs[Math.min(i, this.tabs.length - 1)].id);
    }
    this.onListChange();
  }

  cycle(step) {
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    const next = this.tabs[(i + step + this.tabs.length) % this.tabs.length];
    this.activate(next.id);
  }

  /** Mark the active tab saved at `path` with the given text. */
  markSaved(path, text) {
    const tab = this.active;
    tab.path = path;
    tab.name = null;
    tab.saved = text;
    this.onListChange();
  }

  snapshot() {
    this.sync();
    return serializeSession(this.tabs, this.activeId);
  }
}
