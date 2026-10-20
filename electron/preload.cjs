// The only bridge between the sandboxed renderer and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('typewriter', {
  save: (content, saveAs = false) => ipcRenderer.invoke('file:save', { content, saveAs }),
  setDirty: (dirty) => ipcRenderer.send('file:dirty', dirty),
  closeWindow: () => ipcRenderer.send('window:close'),
  openDialog: () => ipcRenderer.invoke('file:open-dialog'),
  openPath: (p) => ipcRenderer.invoke('file:open-path', p),
  openHere: (p) => ipcRenderer.invoke('file:open-here', p),
  pathForFile: (file) => webUtils.getPathForFile(file),
  openFolderDialog: () => ipcRenderer.invoke('folder:open-dialog'),
  listFolder: (dir) => ipcRenderer.invoke('folder:list', dir),
  exportHtml: (html, suggestedName) => ipcRenderer.invoke('export:html', { html, suggestedName }),
  exportPdf: (html, suggestedName) => ipcRenderer.invoke('export:pdf', { html, suggestedName }),
  nativeTheme: () => ipcRenderer.invoke('theme:native'),
  onFileOpened: (cb) => ipcRenderer.on('file-opened', (_e, payload) => cb(payload)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
});
