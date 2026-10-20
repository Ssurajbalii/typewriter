import 'katex/dist/katex.min.css';
import './styles/themes.css';
import './styles/app.css';
import './styles/editor.css';

import { createEditor, setMode, replaceDocument } from './editor/setup.js';
import { toggleInline, setHeading, toggleLinePrefix, insertBlock, insertLink, TABLE_TEMPLATE } from './editor/commands.js';
import { setDocumentPath } from './editor/assets.js';
import { Sidebar } from './ui/sidebar.js';
import { renderExportHtml } from './export.js';
import { openSearchPanel } from '@codemirror/search';
import welcome from './welcome.md?raw';

const api = window.typewriter;
const $ = (sel) => document.querySelector(sel);

const doc = {
  path: null,
  saved: null, // Text snapshot at last save/open; dirty = doc differs from it
  dirty: false,
};

// ---- Editor -------------------------------------------------------------

const firstRun = !localStorage.getItem('tw.seenWelcome');
const view = createEditor($('#editor'), {
  doc: firstRun ? welcome : '',
  onChange: () => {
    const dirty = !view.state.doc.eq(doc.saved);
    if (dirty !== doc.dirty) {
      doc.dirty = dirty;
      api.setDirty(dirty);
      updateTitle();
    }
    scheduleUiUpdate();
  },
  onSelection: () => scheduleUiUpdate(),
});
doc.saved = view.state.doc;
if (firstRun) localStorage.setItem('tw.seenWelcome', '1');

let uiTimer = null;
function scheduleUiUpdate() {
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    sidebar.updateOutline(view.state);
    updateStatus();
  }, 120);
}

// ---- Title & status bar -------------------------------------------------

function fileName() {
  return doc.path ? doc.path.split('/').pop() : 'Untitled';
}

function updateTitle() {
  // Unsaved state shows natively as the dot in the window's close button.
  $('#title').textContent = fileName();
  document.title = `${fileName()}${doc.dirty ? ' — Edited' : ''}`;
}

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;
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

function loadFile(filePath, content) {
  replaceDocument(view, content);
  doc.path = filePath;
  doc.saved = view.state.doc;
  doc.dirty = false;
  setDocumentPath(filePath);
  updateTitle();
  sidebar.updateOutline(view.state);
  sidebar.markCurrentFile();
  updateStatus();
  view.focus();
}

async function save(saveAs = false) {
  const text = view.state.doc;
  const savedPath = await api.save(text.toString(), saveAs);
  if (!savedPath) return false;
  doc.path = savedPath;
  doc.saved = text;
  doc.dirty = !view.state.doc.eq(text);
  setDocumentPath(savedPath);
  updateTitle();
  sidebar.markCurrentFile();
  return true;
}

api.onFileOpened(({ filePath, content }) => loadFile(filePath, content));

async function openFromTree(path) {
  if (path === doc.path) return;
  await api.openHere(path);
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
  'save-then-close': async () => { if (await save(false)) api.closeWindow(); },
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
  else if (/\.(md|markdown)$/i.test(url) && doc.path) {
    const dir = doc.path.replace(/\/[^/]*$/, '');
    api.openPath(url.startsWith('/') ? url : `${dir}/${url}`);
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
      const dir = doc.path?.replace(/\/[^/]*$/, '');
      const rel = dir && p.startsWith(dir + '/') ? p.slice(dir.length + 1) : p;
      inserts.push(`![${file.name.replace(/\.\w+$/, '')}](${rel.includes(' ') ? `<${rel}>` : rel})`);
    }
  }
  if (inserts.length) view.dispatch({ changes: { from: pos, insert: inserts.join('\n') } });
}, true);

// ---- Boot ---------------------------------------------------------------

const sidebar = new Sidebar($('#sidebar'), {
  getView: () => view,
  openFile: openFromTree,
  getCurrentPath: () => doc.path,
});
sidebar.toggle(localStorage.getItem('tw.sidebar.v2') === '1'); // hidden unless the user opened it

$('#toggle-sidebar').addEventListener('click', () => sidebar.toggle());

applyTheme();
applyModes();
updateTitle();
updateStatus();
sidebar.updateOutline(view.state);
view.focus();
