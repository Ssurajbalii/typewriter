// Typewriter main process: windows, native menus, and file I/O.
// The renderer never touches the filesystem directly; every disk operation
// goes through the IPC handlers below (exposed via preload.cjs).

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme, protocol, net } = require('electron');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const isMac = process.platform === 'darwin';
const MD_FILE = /\.(md|markdown|mdown|txt)$/i;
// Screenshot runs get a throwaway profile so they never touch the user's settings.
// TW_USER_DATA pins the profile instead, to test restoring a session across runs.
if (process.env.TW_CAPTURE) {
  app.setPath('userData', process.env.TW_USER_DATA || path.join(os.tmpdir(), `typewriter-capture-${process.pid}`));
}
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

let pendingOpenPath = null;
const SESSION_FILE = () => path.join(app.getPath('userData'), 'session.json');

function overlayColors(dark) {
  return dark
    ? { color: '#1e1f22', symbolColor: '#d7d7d4', height: 38 }
    : { color: '#ffffff', symbolColor: '#2b2b2b', height: 38 };
}

/** The window that receives opened files (one window holds all tabs). */
function mainWindow() {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
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
  // The renderer queues opened files until its saved session is restored.
  win.webContents.once('did-finish-load', () => {
    if (filePath) openFileInWindow(win, filePath);
  });

  // Links in the document open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // No "save changes?" prompt: the renderer persists every tab (hot exit).
  return win;
}

async function openFileInWindow(win, filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    app.addRecentDocument(filePath);
    win.webContents.send('file-opened', { filePath, content });
    win.focus();
  } catch (err) {
    dialog.showErrorBox('Could not open file', `${filePath}\n\n${err.message}`);
  }
}

async function openWithDialog() {
  const parent = mainWindow();
  const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
    properties: ['openFile', 'multiSelections'],
    filters: MD_FILTERS,
  });
  if (canceled) return;
  for (const p of filePaths) openPath(p);
}

/** Open a file as a tab in the main window (the renderer focuses it if already open). */
function openPath(filePath) {
  const win = mainWindow();
  if (win) openFileInWindow(win, filePath);
  else createWindow(filePath);
}

// ---- IPC ----------------------------------------------------------------

ipcMain.handle('file:save', async (e, { content, path: filePath, suggestedName, saveAs }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!filePath || saveAs) {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: filePath ?? `${suggestedName || 'Untitled'}.md`,
      filters: MD_FILTERS,
    });
    if (result.canceled) return null;
    filePath = result.filePath;
  }
  await fs.writeFile(filePath, content, 'utf8');
  app.addRecentDocument(filePath);
  return filePath;
});

ipcMain.handle('file:read', async (_e, filePath) => fs.readFile(filePath, 'utf8').catch(() => null));

/** Path shown by macOS in the title bar's proxy icon for the active tab. */
ipcMain.on('tab:active', (e, { path: filePath, dirty }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!isMac || !win) return;
  win.setRepresentedFilename(filePath ?? '');
  win.setDocumentEdited(!!dirty);
});

ipcMain.handle('tab:confirm-close', (e, name) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const choice = dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: `Do you want to save the changes to ${name}?`,
    detail: "Your changes will be lost if you don't save them.",
  });
  return ['save', 'discard', 'cancel'][choice];
});

// Session ("hot exit"), modelled on Notepad++: a small session.json lists the
// tabs, and each unsaved buffer lives in its own file under backup/. Only
// buffers whose text changed since the last snapshot are rewritten.
const backupDir = () => path.join(app.getPath('userData'), 'backup');
const backupFile = (id) => path.join(backupDir(), `${id.replace(/[^\w-]/g, '')}.md`);
const lastWritten = new Map(); // tab id -> text last written to its backup

function planSessionWrite(session) {
  const writes = [];
  const keep = new Set();
  const meta = { ...session, tabs: session.tabs.map(({ content, ...t }) => {
    if (content == null) return { ...t, backup: false };
    keep.add(t.id);
    if (lastWritten.get(t.id) !== content) writes.push([t.id, content]);
    return { ...t, backup: true };
  }) };
  const stale = [...lastWritten.keys()].filter((id) => !keep.has(id));
  return { json: JSON.stringify(meta), writes, stale };
}

async function saveSession(session) {
  const { json, writes, stale } = planSessionWrite(session);
  await fs.mkdir(backupDir(), { recursive: true });
  for (const [id, content] of writes) {
    await fs.writeFile(`${backupFile(id)}.tmp`, content, 'utf8');
    await fs.rename(`${backupFile(id)}.tmp`, backupFile(id));
    lastWritten.set(id, content);
  }
  await fs.writeFile(`${SESSION_FILE()}.tmp`, json, 'utf8');
  await fs.rename(`${SESSION_FILE()}.tmp`, SESSION_FILE());
  for (const id of stale) { lastWritten.delete(id); await fs.rm(backupFile(id), { force: true }); }
}

function saveSessionSync(session) {
  const { json, writes, stale } = planSessionWrite(session);
  fsSync.mkdirSync(backupDir(), { recursive: true });
  for (const [id, content] of writes) {
    fsSync.writeFileSync(`${backupFile(id)}.tmp`, content, 'utf8');
    fsSync.renameSync(`${backupFile(id)}.tmp`, backupFile(id));
    lastWritten.set(id, content);
  }
  fsSync.writeFileSync(`${SESSION_FILE()}.tmp`, json, 'utf8');
  fsSync.renameSync(`${SESSION_FILE()}.tmp`, SESSION_FILE());
  for (const id of stale) { lastWritten.delete(id); fsSync.rmSync(backupFile(id), { force: true }); }
}

ipcMain.handle('session:load', async () => {
  let session;
  try { session = JSON.parse(await fs.readFile(SESSION_FILE(), 'utf8')); } catch { return null; }
  for (const t of session.tabs ?? []) {
    if (!t.backup) { t.content = null; continue; }
    t.content = await fs.readFile(backupFile(t.id), 'utf8').catch(() => null);
    if (t.content != null) lastWritten.set(t.id, t.content);
  }
  return session;
});
// Snapshots run when typing pauses; one write at a time, newest wins.
let saving = Promise.resolve();
ipcMain.handle('session:save', (_e, session) => (saving = saving.then(() => saveSession(session)).catch(() => {})));
// Used while the window closes, when an async reply could arrive too late.
ipcMain.on('session:save-sync', (e, session) => {
  try { saveSessionSync(session); e.returnValue = true; } catch { e.returnValue = false; }
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

/** New tab in the existing window, or a fresh window if none is open. */
function newTab() {
  const win = mainWindow();
  if (win) win.webContents.send('menu', 'new-tab');
  else createWindow();
}

function send(action) {
  return () => BrowserWindow.getFocusedWindow()?.webContents.send('menu', action);
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: newTab },
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: newTab },
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
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: send('close-tab') },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', role: 'close' },
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
    {
      role: 'windowMenu',
      submenu: [
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: send('next-tab') },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: send('prev-tab') },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : []),
      ],
    },
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
