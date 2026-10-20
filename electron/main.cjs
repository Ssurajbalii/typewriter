// Typewriter main process: windows, native menus, and file I/O.
// The renderer never touches the filesystem directly; every disk operation
// goes through the IPC handlers below (exposed via preload.cjs).

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme, protocol, net } = require('electron');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const isMac = process.platform === 'darwin';
const MD_FILE = /\.(md|markdown|mdown|txt)$/i;
// Screenshot runs get a throwaway profile so they never touch the user's settings.
if (process.env.TW_CAPTURE) app.setPath('userData', path.join(os.tmpdir(), `typewriter-capture-${process.pid}`));
const MD_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] },
  { name: 'All Files', extensions: ['*'] },
];

// twfile://local/<absolute path> serves local images referenced by documents.
// Only image types are served, so a document can't read arbitrary files.
protocol.registerSchemesAsPrivileged([
  { scheme: 'twfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)$/i;

/** @type {Map<number, { filePath: string | null, dirty: boolean }>} */
const windowState = new Map();
let pendingOpenPath = null;

function overlayColors(dark) {
  return dark
    ? { color: '#1e1f22', symbolColor: '#d7d7d4', height: 38 }
    : { color: '#ffffff', symbolColor: '#2b2b2b', height: 38 };
}

/** Path shown by macOS in the title bar's proxy icon; no-op elsewhere. */
function setDocumentPath(win, filePath) {
  if (isMac) win.setRepresentedFilename(filePath);
}

function setEdited(win, edited) {
  if (isMac) win.setDocumentEdited(edited);
}

function createWindow(filePath = null) {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 480,
    minHeight: 320,
    // Frameless look on both platforms: macOS keeps its traffic lights inset;
    // Windows gets native min/max/close drawn over the page (titleBarOverlay).
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } }
      : { titleBarStyle: 'hidden', titleBarOverlay: overlayColors(nativeTheme.shouldUseDarkColors), autoHideMenuBar: true }),
    icon: isMac ? undefined : path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  windowState.set(win.id, { filePath: null, dirty: false });

  if (isDev) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.once('ready-to-show', () => win.show());

  // Dev aid: TW_CAPTURE=out.png saves a screenshot after load, then quits.
  if (process.env.TW_CAPTURE) {
    win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`));
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      // TW_CAPTURE_SIZE="w,h" resizes; TW_CAPTURE_ACTIONS="theme-night,toggle-focus" runs menu actions.
      if (process.env.TW_CAPTURE_SIZE) win.setContentSize(...process.env.TW_CAPTURE_SIZE.split(',').map(Number));
      for (const action of (process.env.TW_CAPTURE_ACTIONS ?? '').split(',').filter(Boolean)) {
        win.webContents.send('menu', action);
      }
      await new Promise((r) => setTimeout(r, 500));
      if (process.env.TW_CAPTURE_JS) await win.webContents.executeJavaScript(process.env.TW_CAPTURE_JS);
      // TW_CAPTURE_CLICK="x,y" clicks there; TW_CAPTURE_TYPE types text afterwards.
      if (process.env.TW_CAPTURE_CLICK) {
        const [x, y] = process.env.TW_CAPTURE_CLICK.split(',').map(Number);
        for (const type of ['mouseDown', 'mouseUp']) {
          win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      for (const ch of process.env.TW_CAPTURE_TYPE ?? '') {
        win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
      }
      // TW_CAPTURE_KEYS="meta+Down,Up" presses keys (modifiers joined with +).
      for (const combo of (process.env.TW_CAPTURE_KEYS ?? '').split(',').filter(Boolean)) {
        const parts = combo.split('+');
        const keyCode = parts.pop();
        for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode, modifiers: parts });
      }
      await new Promise((r) => setTimeout(r, 800));
      const image = await win.webContents.capturePage();
      await fs.writeFile(process.env.TW_CAPTURE, image.toPNG());
      // TW_CAPTURE_HOLD_MS keeps the window open afterwards, e.g. for an OS-level screenshot.
      await new Promise((r) => setTimeout(r, Number(process.env.TW_CAPTURE_HOLD_MS) || 0));
      app.exit(0);
    }, 2500));
  }
  win.webContents.once('did-finish-load', () => {
    if (filePath) openFileInWindow(win, filePath);
  });

  // Links in the document open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('close', (e) => {
    const state = windowState.get(win.id);
    if (!state?.dirty) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: `Do you want to save the changes to ${state.filePath ? path.basename(state.filePath) : 'Untitled'}?`,
      detail: "Your changes will be lost if you don't save them.",
    });
    if (choice === 2) e.preventDefault();
    else if (choice === 0) {
      e.preventDefault();
      win.webContents.send('menu', 'save-then-close');
    }
  });
  win.on('closed', () => windowState.delete(win.id));
  return win;
}

async function openFileInWindow(win, filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    windowState.set(win.id, { filePath, dirty: false });
    setDocumentPath(win, filePath);
    app.addRecentDocument(filePath);
    win.webContents.send('file-opened', { filePath, content });
  } catch (err) {
    dialog.showErrorBox('Could not open file', `${filePath}\n\n${err.message}`);
  }
}

/** Reuse the focused window if it is an empty, unmodified document. */
function targetWindowFor() {
  const win = BrowserWindow.getFocusedWindow();
  const state = win && windowState.get(win.id);
  if (win && state && !state.filePath && !state.dirty) return win;
  return null;
}

async function openWithDialog() {
  const parent = BrowserWindow.getFocusedWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
    properties: ['openFile', 'multiSelections'],
    filters: MD_FILTERS,
  });
  if (canceled) return;
  for (const p of filePaths) openPath(p);
}

function openPath(filePath) {
  const existing = [...windowState.entries()].find(([, s]) => s.filePath === filePath);
  if (existing) return BrowserWindow.fromId(existing[0])?.focus();
  const win = targetWindowFor();
  if (win) openFileInWindow(win, filePath);
  else createWindow(filePath);
}

// ---- IPC ----------------------------------------------------------------

ipcMain.handle('file:save', async (e, { content, saveAs }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const state = windowState.get(win.id);
  let filePath = state.filePath;
  if (!filePath || saveAs) {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: filePath ?? 'Untitled.md',
      filters: MD_FILTERS,
    });
    if (result.canceled) return null;
    filePath = result.filePath;
  }
  await fs.writeFile(filePath, content, 'utf8');
  windowState.set(win.id, { filePath, dirty: false });
  setDocumentPath(win, filePath);
  setEdited(win, false);
  app.addRecentDocument(filePath);
  return filePath;
});

ipcMain.on('file:dirty', (e, dirty) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const state = windowState.get(win.id);
  if (state) state.dirty = dirty;
  setEdited(win, dirty);
});

ipcMain.on('window:close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const state = windowState.get(win.id);
  if (state) state.dirty = false;
  win.close();
});

// Sidebar file tree: replace the current document unless it has unsaved changes.
ipcMain.handle('file:open-here', (e, p) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const existing = [...windowState.entries()].find(([, s]) => s.filePath === p);
  if (existing) return BrowserWindow.fromId(existing[0])?.focus();
  if (windowState.get(win.id)?.dirty) createWindow(p);
  else openFileInWindow(win, p);
});

ipcMain.handle('file:open-dialog', () => openWithDialog());
ipcMain.handle('file:open-path', (_e, p) => openPath(p));

ipcMain.handle('folder:open-dialog', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return canceled ? null : filePaths[0];
});

const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn']);
ipcMain.handle('folder:list', async (_e, dir) => {
  async function walk(d, depth) {
    const entries = await fs.readdir(d, { withFileTypes: true }).catch(() => []);
    const out = [];
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name) || depth > 6) continue;
        const children = await walk(full, depth + 1);
        if (children.length) out.push({ name: ent.name, path: full, children });
      } else if (/\.(md|markdown|mdown)$/i.test(ent.name)) {
        out.push({ name: ent.name, path: full });
      }
    }
    return out.sort((a, b) => (!!b.children - !!a.children) || a.name.localeCompare(b.name));
  }
  return walk(dir, 0);
});

ipcMain.handle('export:html', async (e, { html, suggestedName }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName.replace(/\.\w+$/, '') + '.html',
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (canceled) return null;
  await fs.writeFile(filePath, html, 'utf8');
  return filePath;
});

ipcMain.handle('export:pdf', async (e, { html, suggestedName }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName.replace(/\.\w+$/, '') + '.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled) return null;
  // Render the exported HTML in a hidden window so PDF output matches HTML export.
  // A temp file (not a data: URL) lets file:// images load.
  const tmp = path.join(os.tmpdir(), `typewriter-export-${process.pid}-${Date.now()}.html`);
  await fs.writeFile(tmp, html, 'utf8');
  const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await printer.loadFile(tmp);
    const pdf = await printer.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    await fs.writeFile(filePath, pdf);
  } finally {
    printer.destroy();
    fs.unlink(tmp).catch(() => {});
  }
  return filePath;
});

// Windows: recolour the caption buttons to match the current theme.
ipcMain.on('theme:changed', (e, { bg, fg }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!isMac && win) win.setTitleBarOverlay({ color: bg, symbolColor: fg, height: 38 });
});

ipcMain.handle('theme:native', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'));

// ---- Menu ---------------------------------------------------------------

function send(action) {
  return () => BrowserWindow.getFocusedWindow()?.webContents.send('menu', action);
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: openWithDialog },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: send('open-folder') },
        ...(isMac ? [{ role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] }] : []),
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-as') },
        { type: 'separator' },
        {
          label: 'Export',
          submenu: [
            { label: 'HTML…', click: send('export-html') },
            { label: 'PDF…', click: send('export-pdf') },
          ],
        },
        { type: 'separator' },
        { role: 'close' },
        ...(isMac ? [] : [{ role: 'quit', label: 'Exit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { label: 'Paste as Plain Text', accelerator: 'CmdOrCtrl+Shift+V', role: 'pasteAndMatchStyle' },
        { role: 'selectAll' }, { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: send('find') },
        { label: 'Find and Replace…', accelerator: 'CmdOrCtrl+Alt+F', click: send('replace') },
      ],
    },
    {
      label: 'Paragraph',
      submenu: [
        ...[1, 2, 3, 4, 5, 6].map((n) => ({
          label: `Heading ${n}`, accelerator: `CmdOrCtrl+${n}`, click: send(`heading-${n}`),
        })),
        { label: 'Paragraph', accelerator: 'CmdOrCtrl+0', click: send('heading-0') },
        { type: 'separator' },
        { label: 'Code Block', accelerator: 'CmdOrCtrl+Alt+C', click: send('code-block') },
        { label: 'Math Block', accelerator: 'CmdOrCtrl+Alt+B', click: send('math-block') },
        { label: 'Quote', accelerator: 'CmdOrCtrl+Alt+Q', click: send('quote') },
        { label: 'Table', accelerator: 'CmdOrCtrl+Alt+T', click: send('table') },
        { type: 'separator' },
        { label: 'Ordered List', accelerator: 'CmdOrCtrl+Alt+O', click: send('ordered-list') },
        { label: 'Bullet List', accelerator: 'CmdOrCtrl+Alt+U', click: send('bullet-list') },
        { label: 'Task List', accelerator: 'CmdOrCtrl+Alt+X', click: send('task-list') },
        { type: 'separator' },
        { label: 'Horizontal Rule', click: send('hr') },
      ],
    },
    {
      label: 'Format',
      submenu: [
        { label: 'Strong', accelerator: 'CmdOrCtrl+B', click: send('bold') },
        { label: 'Emphasis', accelerator: 'CmdOrCtrl+I', click: send('italic') },
        { label: 'Code', accelerator: 'CmdOrCtrl+Shift+`', click: send('inline-code') },
        { label: 'Strikethrough', accelerator: 'CmdOrCtrl+Shift+X', click: send('strike') },
        { label: 'Highlight', accelerator: 'CmdOrCtrl+Shift+H', click: send('highlight') },
        { label: 'Hyperlink', accelerator: 'CmdOrCtrl+K', click: send('link') },
        { label: 'Image', accelerator: 'CmdOrCtrl+Shift+I', click: send('image') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+Shift+L', click: send('toggle-sidebar') },
        { label: 'Outline', accelerator: 'CmdOrCtrl+Shift+1', click: send('show-outline') },
        { label: 'Files', accelerator: 'CmdOrCtrl+Shift+2', click: send('show-files') },
        { type: 'separator' },
        { label: 'Source Code Mode', accelerator: 'CmdOrCtrl+/', click: send('toggle-source') },
        { label: 'Focus Mode', accelerator: 'F8', click: send('toggle-focus') },
        { label: 'Typewriter Mode', accelerator: 'F9', click: send('toggle-typewriter') },
        { type: 'separator' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev || !app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: 'Themes',
      submenu: ['Paper', 'Night', 'Newsprint', 'Sepia'].map((t) => ({
        label: t, click: send(`theme-${t.toLowerCase()}`),
      })),
    },
    { role: 'windowMenu' },
    ...(isMac ? [] : [{ role: 'help', submenu: [{ role: 'about' }] }]),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- App lifecycle ------------------------------------------------------

app.on('open-file', (e, filePath) => {
  e.preventDefault();
  if (app.isReady()) openPath(filePath);
  else pendingOpenPath = filePath;
});

const fileFromArgv = (argv) => {
  const f = argv.slice(1).find((a) => MD_FILE.test(a) && !a.startsWith('-'));
  return f ? path.resolve(f) : null;
};

// One process for all windows: double-clicking another .md file on Windows
// starts a second instance, which hands its file to us and exits.
if (!isMac && !process.env.TW_CAPTURE && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  const file = fileFromArgv(argv);
  if (file) openPath(file);
  else BrowserWindow.getAllWindows()[0]?.focus();
});

app.whenReady().then(() => {
  protocol.handle('twfile', (req) => {
    let filePath = decodeURIComponent(new URL(req.url).pathname);
    if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1); // Windows drive letter
    if (!IMAGE_EXT.test(filePath)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
  buildMenu();
  createWindow(pendingOpenPath ?? fileFromArgv(process.argv));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
