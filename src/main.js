import 'katex/dist/katex.min.css';
import './styles/themes.css';
import './styles/app.css';
import './styles/editor.css';

import { createEditor, setMode, newTabState, showTabState } from './editor/setup.js';
import { toggleInline, setHeading, toggleLinePrefix, insertBlock, insertLink, TABLE_TEMPLATE } from './editor/commands.js';
import { setDocumentPath } from './editor/assets.js';
import { Sidebar } from './ui/sidebar.js';
import { renderExportHtml } from './export.js';
import { openSearchPanel } from '@codemirror/search';
import { dirname, isAbsolute, join, relativeTo } from './paths.js';
import { Tabs, planRestore } from './tabs.js';
import welcome from './welcome.md?raw';

const api = window.typewriter;
const isMac = api.platform === 'darwin';
document.body.classList.add(`platform-${api.platform}`);

/** Mac shortcut glyphs to Windows/Linux wording: "⇧⌘L" -> "Ctrl+Shift+L". */
function localizeShortcuts(text) {
  if (isMac) return text;
  return text.replace(/⌘-click/g, 'Ctrl+click').replace(/([⌃⌥⇧⌘]+)(\S)/g, (_, mods, key) => {
    const names = { '⌃': 'Ctrl', '⌘': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift' };
    const order = ['⌃', '⌘', '⌥', '⇧'];
    const parts = [...new Set(order.filter((m) => mods.includes(m)).map((m) => names[m]))];
    return [...parts, key].join('+');
  });
}
document.querySelectorAll('[title]').forEach((el) => { el.title = localizeShortcuts(el.title); });
const $ = (sel) => document.querySelector(sel);

// ---- Editor & tabs ------------------------------------------------------

const view = createEditor($('#editor'), {
  onChange: () => {
    refreshActiveTab();
    scheduleSessionSave();
    scheduleUiUpdate();
  },
  onSelection: () => {
    scheduleSessionSave(); // cursor position is part of the session
    scheduleUiUpdate();
  },
});

const sidebar = new Sidebar($('#sidebar'), {
  getView: () => view,
  openFile: openFromTree,
  getCurrentPath: () => activePath(),
});

const tabs = new Tabs({
  view,
  makeState: (text, selection) => newTabState(view, text, selection),
  showState: (state) => {
    // The folder must be known before rendering so relative images resolve.
    setDocumentPath(tabs.active?.path ?? null);
    showTabState(view, state);
    view.dispatch({ selection: view.state.selection }); // rebuild previews for this folder
  },
  onSwitch: () => {
    lastDirty = tabs.dirty(tabs.active);
    updateTitle();
    reportActiveTab();
    sidebar.updateOutline(view.state);
    sidebar.markCurrentFile();
    updateStatus();
    view.focus();
  },
  onListChange: () => renderTabs(),
});

const activePath = () => tabs.active?.path ?? null;

let lastDirty = false;
/** Re-render the tab bar only when the active tab's unsaved state flips. */
function refreshActiveTab() {
  const dirty = tabs.dirty(tabs.active);
  if (dirty === lastDirty) return;
  lastDirty = dirty;
  renderTabs();
  updateTitle();
  reportActiveTab();
}

let uiTimer = null;
function scheduleUiUpdate() {
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    sidebar.updateOutline(view.state);
    updateStatus();
  }, 120);
}

// ---- Tab bar -----------------------------------------------------------

function renderTabs() {
  const bar = $('#tabs');
  bar.replaceChildren(...tabs.tabs.map((tab) => {
    const el = document.createElement('div');
    el.className = 'tab';
    el.classList.toggle('active', tab.id === tabs.activeId);
    el.classList.toggle('dirty', tabs.dirty(tab));
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(tab.id === tabs.activeId));
    el.title = tab.path ?? tabs.title(tab);

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tabs.title(tab);

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.setAttribute('aria-label', `Close ${tabs.title(tab)}`);
    close.innerHTML = '<span>×</span>';
    close.addEventListener('mousedown', (e) => e.stopPropagation());
    close.addEventListener('click', () => closeTab(tab.id));

    el.addEventListener('mousedown', (e) => { if (e.button === 0) tabs.activate(tab.id); });
    el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(tab.id); });
    el.append(title, close);
    return el;
  }));
  bar.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// Double-clicking empty space in the tab bar opens a new tab, as in Notepad++.
$('#tabs').addEventListener('dblclick', (e) => { if (e.target.id === 'tabs') newTab(); });
$('#new-tab').addEventListener('click', () => newTab());

function newTab() {
  tabs.add();
  scheduleSessionSave();
}

async function closeTab(id) {
  const tab = tabs.tabs.find((t) => t.id === id);
  if (!tab) return;
  if (tabs.dirty(tab)) {
    tabs.activate(id);
    const choice = await api.confirmCloseTab(tabs.title(tab));
    if (choice === 'cancel') return;
    if (choice === 'save' && !(await save(false))) return;
  }
  tabs.remove(id);
  scheduleSessionSave();
}

// ---- Title & status bar -------------------------------------------------

function fileName() {
  return tabs.active ? tabs.title(tabs.active) : 'Untitled';
}

function updateTitle() {
  document.title = `${fileName()}${lastDirty ? ' — Edited' : ''}`;
}

/** macOS shows the active file's proxy icon and the unsaved dot in the close button. */
function reportActiveTab() {
  api.setActiveTab({ path: activePath(), dirty: lastDirty });
}

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g;
function countWords(text) {
  const cjk = (text.match(CJK) || []).length;
  const latin = (text.replace(CJK, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  return cjk + latin;
}

function updateStatus() {
  const { state } = view;
  const sel = state.selection.main;
  const text = sel.empty ? state.doc.toString() : state.sliceDoc(sel.from, sel.to);
  const words = countWords(text);
  const minutes = Math.max(1, Math.round(words / 230));
  $('#word-count').textContent =
    `${sel.empty ? '' : 'Selection: '}${words.toLocaleString()} words · ${text.length.toLocaleString()} chars` +
    (sel.empty ? ` · ${minutes} min read` : '');
}

// ---- Files --------------------------------------------------------------

async function save(saveAs = false) {
  const tab = tabs.active;
  const text = view.state.doc;
  const savedPath = await api.save(text.toString(), { path: tab.path, suggestedName: tab.name, saveAs });
  if (!savedPath) return false;
  tabs.markSaved(savedPath, text);
  setDocumentPath(savedPath);
  view.dispatch({ selection: view.state.selection }); // re-resolve relative images
  lastDirty = tabs.dirty(tab);
  renderTabs();
  updateTitle();
  reportActiveTab();
  sidebar.markCurrentFile();
  scheduleSessionSave();
  return true;
}

/** Open a file as a tab; reuse its tab if open, and replace a blank starting tab. */
function openFileTab({ filePath, content }) {
  const existing = tabs.findByPath(filePath);
  if (existing) return tabs.activate(existing.id);
  const current = tabs.active;
  const blank = current && !current.path && view.state.doc.length === 0 && tabs.tabs.length === 1;
  tabs.add({ path: filePath, content, saved: content });
  if (blank) tabs.remove(current.id);
  scheduleSessionSave();
}

// Files opened before the session is restored wait their turn.
let restored = false;
const pendingFiles = [];
api.onFileOpened((payload) => (restored ? openFileTab(payload) : pendingFiles.push(payload)));

async function openFromTree(path) {
  const existing = tabs.findByPath(path);
  if (existing) tabs.activate(existing.id);
  else await api.openPath(path);
}

// ---- Session (hot exit) --------------------------------------------------

let sessionTimer = null;
function scheduleSessionSave() {
  if (!restored) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => api.saveSession(tabs.snapshot()), 800);
}

// Closing the window or quitting never asks: every tab is written out first.
window.addEventListener('beforeunload', () => {
  if (restored) api.saveSessionSync(tabs.snapshot());
});

async function restoreSession() {
  const session = await api.loadSession();
  const paths = [...new Set((session?.tabs ?? []).map((t) => t.path).filter(Boolean))];
  const disk = Object.fromEntries(await Promise.all(paths.map(async (p) => [p, await api.readFile(p)])));
  const plan = planRestore(session, disk);
  for (const t of plan) tabs.add(t, { activate: false });

  if (!tabs.tabs.length) {
    const firstRun = !localStorage.getItem('tw.seenWelcome');
    const text = firstRun ? localizeShortcuts(welcome) : '';
    tabs.add(firstRun ? { name: 'Welcome', content: text, saved: text } : {}, { activate: false });
    localStorage.setItem('tw.seenWelcome', '1');
  }
  tabs.activate((plan.find((t) => t.active) ?? tabs.tabs[0]).id);

  restored = true;
  for (const f of pendingFiles.splice(0)) openFileTab(f);
  scheduleSessionSave();
}

// ---- Modes & themes -----------------------------------------------------

const modeState = {
  source: false,
  focus: localStorage.getItem('tw.focus') === '1',
  typewriter: localStorage.getItem('tw.typewriter') === '1',
};

function applyModes() {
  setMode(view, 'preview', !modeState.source);
  setMode(view, 'focus', modeState.focus);
  setMode(view, 'typewriter', modeState.typewriter);
  document.body.classList.toggle('source-mode', modeState.source);
  document.body.classList.toggle('typewriter-mode', modeState.typewriter);
  localStorage.setItem('tw.focus', modeState.focus ? '1' : '0');
  localStorage.setItem('tw.typewriter', modeState.typewriter ? '1' : '0');
}

function toggleMode(key) {
  modeState[key] = !modeState[key];
  applyModes();
  view.focus();
}

const DARK_THEMES = new Set(['night']);
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(theme = localStorage.getItem('tw.theme')) {
  const effective = theme || (systemDark.matches ? 'night' : 'paper');
  document.documentElement.dataset.theme = effective;
  document.documentElement.dataset.scheme = DARK_THEMES.has(effective) ? 'dark' : 'light';
  // Re-render diagrams with the matching palette.
  view.dispatch({ selection: view.state.selection });
  // Windows draws its caption buttons natively; keep them on the theme's colours.
  const cs = getComputedStyle(document.documentElement);
  api.themeChanged({ bg: cs.getPropertyValue('--bg').trim(), fg: cs.getPropertyValue('--text').trim() });
}

systemDark.addEventListener('change', () => applyTheme());

// ---- Menu actions -------------------------------------------------------

async function exportAs(kind) {
  const title = fileName().replace(/\.\w+$/, '');
  const html = await renderExportHtml(view.state.doc.toString(), title, { forPdf: kind === 'pdf' });
  if (kind === 'pdf') await api.exportPdf(html, fileName());
  else await api.exportHtml(html, fileName());
}

const actions = {
  save: () => save(false),
  'save-as': () => save(true),
  'new-tab': () => newTab(),
  'close-tab': () => closeTab(tabs.activeId),
  'next-tab': () => tabs.cycle(1),
  'prev-tab': () => tabs.cycle(-1),
  'open-folder': () => sidebar.chooseFolder(),
  'export-html': () => exportAs('html'),
  'export-pdf': () => exportAs('pdf'),
  find: () => openSearchPanel(view),
  replace: () => openSearchPanel(view),

  bold: () => toggleInline(view, '**', 'strong text'),
  italic: () => toggleInline(view, '*', 'emphasized text'),
  'inline-code': () => toggleInline(view, '`', 'code'),
  strike: () => toggleInline(view, '~~', 'text'),
  highlight: () => toggleInline(view, '==', 'text'),
  link: () => insertLink(view, false),
  image: () => insertLink(view, true),

  'code-block': () => insertBlock(view, '```\n\u0000\n```', 3),
  'math-block': () => insertBlock(view, '$$\n\u0000\n$$', 3),
  table: () => insertBlock(view, TABLE_TEMPLATE, 2),
  hr: () => insertBlock(view, '---'),
  quote: () => toggleLinePrefix(view, /^\s*>/, () => '> '),
  'bullet-list': () => toggleLinePrefix(view, /^\s*[-*+]\s+(?!\[[ xX]\])/, () => '- '),
  'ordered-list': () => toggleLinePrefix(view, /^\s*\d+[.)]\s+/, (i) => `${i + 1}. `),
  'task-list': () => toggleLinePrefix(view, /^\s*[-*+]\s+\[[ xX]\]/, () => '- [ ] '),

  'toggle-sidebar': () => sidebar.toggle(),
  'show-outline': () => sidebar.show('outline'),
  'show-files': () => sidebar.show('files'),
  'toggle-source': () => toggleMode('source'),
  'toggle-focus': () => toggleMode('focus'),
  'toggle-typewriter': () => toggleMode('typewriter'),
};
for (let n = 0; n <= 6; n++) actions[`heading-${n}`] = () => setHeading(view, n);
for (const t of ['paper', 'night', 'newsprint', 'sepia']) {
  actions[`theme-${t}`] = () => { localStorage.setItem('tw.theme', t); applyTheme(t); };
}

api.onMenu((action) => actions[action]?.());

window.addEventListener('typewriter:open-link', ({ detail: url }) => {
  if (/^(https?:|mailto:)/i.test(url)) window.open(url);
  else if (/\.(md|markdown)$/i.test(url) && activePath()) {
    api.openPath(isAbsolute(url) ? url : join(dirname(activePath()), decodeURI(url)));
  }
});

// Dropping Markdown files opens them; dropping images inserts a link.
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  const files = [...(e.dataTransfer?.files ?? [])];
  if (!files.length) return;
  e.preventDefault();
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
  const inserts = [];
  for (const file of files) {
    const p = api.pathForFile(file);
    if (!p) continue;
    if (/\.(md|markdown|mdown|txt)$/i.test(p)) api.openPath(p);
    else if (/\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i.test(p)) {
      const rel = activePath() ? relativeTo(dirname(activePath()), p) : p;
      inserts.push(`![${file.name.replace(/\.\w+$/, '')}](${rel.includes(' ') ? `<${rel}>` : rel})`);
    }
  }
  if (inserts.length) view.dispatch({ changes: { from: pos, insert: inserts.join('\n') } });
}, true);

// ---- Boot ---------------------------------------------------------------

sidebar.toggle(localStorage.getItem('tw.sidebar.v2') === '1'); // hidden unless the user opened it

$('#toggle-sidebar').addEventListener('click', () => sidebar.toggle());

applyTheme();
applyModes();
restoreSession();
