// Sidebar with two panels: a live document outline and a folder file tree.

import { syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { basename } from '../paths.js';

export function headingsOf(state) {
  const out = [];
  syntaxTree(state).iterate({
    enter(n) {
      const m = /^(?:ATX|Setext)Heading([1-6])$/.exec(n.name);
      if (!m) return;
      const raw = state.doc.sliceString(n.from, n.to).split('\n')[0];
      const text = raw.replace(/^#{1,6}\s*/, '').replace(/\s+#+\s*$/, '')
        .replace(/[*_`~=]|\$|!?\[([^\]]*)\]\([^)]*\)/g, (s, label) => label ?? '').trim();
      out.push({ level: +m[1], text: text || '(empty heading)', from: n.from });
      return false;
    },
  });
  return out;
}

export class Sidebar {
  constructor(root, { getView, openFile, getCurrentPath }) {
    this.root = root;
    this.getView = getView;
    this.openFile = openFile;
    this.getCurrentPath = getCurrentPath;
    this.outlineEl = root.querySelector('#outline');
    this.filesEl = root.querySelector('#files');
    this.folder = localStorage.getItem('tw.folder');
    this.lastOutlineKey = '';

    root.querySelectorAll('[data-panel]').forEach((tab) =>
      tab.addEventListener('click', () => this.show(tab.dataset.panel)));
    root.querySelector('#open-folder').addEventListener('click', () => this.chooseFolder());
    this.show(localStorage.getItem('tw.panel') || 'outline', { reveal: false });
    if (this.folder) this.loadFolder(this.folder);
  }

  get visible() { return !document.body.classList.contains('sidebar-hidden'); }

  toggle(force) {
    const show = force ?? !this.visible;
    document.body.classList.toggle('sidebar-hidden', !show);
    localStorage.setItem('tw.sidebar.v2', show ? '1' : '0');
  }

  show(panel, { reveal = true } = {}) {
    if (reveal) this.toggle(true);
    localStorage.setItem('tw.panel', panel);
    this.root.querySelectorAll('[data-panel]').forEach((t) => t.classList.toggle('active', t.dataset.panel === panel));
    this.root.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === panel));
  }

  // ---- Outline ----------------------------------------------------------

  updateOutline(state) {
    const headings = headingsOf(state);
    const head = state.selection.main.head;
    let current = -1;
    headings.forEach((h, i) => { if (h.from <= head) current = i; });

    const key = JSON.stringify(headings.map((h) => [h.level, h.text])) + current;
    if (key === this.lastOutlineKey) {
      // Same structure: positions may have moved, refresh targets only.
      this.outlineEl.querySelectorAll('[data-from]').forEach((el, i) => { el.dataset.from = headings[i].from; });
      return;
    }
    this.lastOutlineKey = key;
    this.outlineEl.replaceChildren();
    if (!headings.length) {
      this.outlineEl.innerHTML = '<p class="empty">Headings will appear here.</p>';
      return;
    }
    const minLevel = Math.min(...headings.map((h) => h.level));
    headings.forEach((h, i) => {
      const item = document.createElement('a');
      item.className = 'outline-item' + (i === current ? ' current' : '');
      item.style.paddingLeft = `${12 + (h.level - minLevel) * 14}px`;
      item.textContent = h.text;
      item.dataset.from = h.from;
      item.addEventListener('click', () => {
        const view = this.getView();
        const from = +item.dataset.from;
        view.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: 'start', yMargin: 40 }) });
        view.focus();
      });
      this.outlineEl.appendChild(item);
    });
  }

  // ---- Files ------------------------------------------------------------

  async chooseFolder() {
    const dir = await window.typewriter.openFolderDialog();
    if (!dir) return;
    localStorage.setItem('tw.folder', dir);
    this.folder = dir;
    await this.loadFolder(dir);
    this.show('files');
  }

  async loadFolder(dir) {
    const tree = await window.typewriter.listFolder(dir);
    const header = document.createElement('div');
    header.className = 'folder-name';
    header.textContent = basename(dir);
    header.title = dir;
    const list = document.createElement('div');
    list.className = 'tree';
    this.renderTree(tree, list, 0);
    this.filesEl.replaceChildren(header, list);
    if (!tree.length) list.innerHTML = '<p class="empty">No Markdown files in this folder.</p>';
    this.markCurrentFile();
  }

  renderTree(nodes, container, depth) {
    for (const node of nodes) {
      const row = document.createElement('a');
      row.className = node.children ? 'tree-dir' : 'tree-file';
      row.style.paddingLeft = `${10 + depth * 14}px`;
      row.textContent = node.children ? node.name : node.name.replace(/\.(md|markdown|mdown)$/i, '');
      row.title = node.path;
      container.appendChild(row);
      if (node.children) {
        const sub = document.createElement('div');
        sub.className = 'tree-children';
        this.renderTree(node.children, sub, depth + 1);
        container.appendChild(sub);
        row.addEventListener('click', () => row.classList.toggle('collapsed'));
      } else {
        row.dataset.path = node.path;
        row.addEventListener('click', () => this.openFile(node.path));
      }
    }
  }

  markCurrentFile() {
    const current = this.getCurrentPath();
    this.filesEl.querySelectorAll('.tree-file').forEach((el) =>
      el.classList.toggle('current', el.dataset.path === current));
  }
}
