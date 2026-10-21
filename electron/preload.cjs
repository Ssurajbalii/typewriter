// The only bridge between the sandboxed renderer and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('typewriter', {
  platform: process.platform,
  save: (content, { path, suggestedName, saveAs = false } = {}) =>
    ipcRenderer.invoke('file:save', { content, path, suggestedName, saveAs }),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  setActiveTab: (info) => ipcRenderer.send('tab:active', info),
  confirmCloseTab: (name) => ipcRenderer.invoke('tab:confirm-close', name),
  tabMenu: (info) => ipcRenderer.invoke('tab:menu', info),
  loadSession: () => ipcRenderer.invoke('session:load'),
  saveSession: (session) => ipcRenderer.invoke('session:save', session),
  saveSessionSync: (session) => ipcRenderer.sendSync('session:save-sync', session),
  openDialog: () => ipcRenderer.invoke('file:open-dialog'),
  openPath: (p) => ipcRenderer.invoke('file:open-path', p),
  pathForFile: (file) => webUtils.getPathForFile(file),
  openFolderDialog: () => ipcRenderer.invoke('folder:open-dialog'),
  listFolder: (dir) => ipcRenderer.invoke('folder:list', dir),
  exportHtml: (html, suggestedName) => ipcRenderer.invoke('export:html', { html, suggestedName }),
  exportPdf: (html, suggestedName) => ipcRenderer.invoke('export:pdf', { html, suggestedName }),
  nativeTheme: () => ipcRenderer.invoke('theme:native'),
  themeChanged: (colors) => ipcRenderer.send('theme:changed', colors),
  onFileOpened: (cb) => ipcRenderer.on('file-opened', (_e, payload) => cb(payload)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
});
