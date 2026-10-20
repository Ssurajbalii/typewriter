// Frames raw screenshots in a macOS-style window with a headline, for decks.
// Usage: npx electron scripts/frame-screenshots.cjs
// Reads screenshots/raw/*.png, writes screenshots/pitch/*.png.

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'screenshots');

const SLIDES = [
  { file: '1-paper.png', title: 'Just you and your words.', sub: 'Markdown renders the moment you type. No preview pane, no toolbar.', bg: ['#eef1f6', '#dfe6f1'], dark: false },
  { file: '6-reveal.png', title: 'Syntax appears only where you need it.', sub: 'Click into any formatting to edit its Markdown. Move on, and it disappears.', bg: ['#f3efe9', '#e7dfd3'], dark: false },
  { file: '2-night.png', title: 'Tasks, tables and code, live.', sub: 'GitHub-flavored Markdown, beautifully rendered in place.', bg: ['#2a2d3a', '#14151b'], dark: true },
  { file: '3-newsprint.png', title: 'Math and diagrams, built in.', sub: 'LaTeX equations and Mermaid diagrams render as you write.', bg: ['#efe7d8', '#ddd0b8'], dark: false },
  { file: '4-sepia-focus.png', title: 'Focus on one paragraph at a time.', sub: 'Focus mode quiets everything except the thought you’re finishing.', bg: ['#f1e6cf', '#e0cfa9'], dark: false },
  { file: '5-outline.png', title: 'Navigate long documents instantly.', sub: 'A live outline and file browser, hidden until you want them.', bg: ['#e9eef0', '#d5dee2'], dark: false },
  { file: '7-source.png', title: 'Always plain Markdown underneath.', sub: 'Switch to source with ⌘/. Your files open anywhere, forever.', bg: ['#262833', '#111217'], dark: true },
];

function page(slide, dataUrl) {
  const ink = slide.dark ? '#f2f2f5' : '#1b1c20';
  const sub = slide.dark ? 'rgba(242,242,245,.62)' : 'rgba(27,28,32,.58)';
  const chrome = slide.dark ? '#2b2c30' : '#ececec';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:1600px;height:1000px;overflow:hidden}
    body{background:linear-gradient(160deg,${slide.bg[0]},${slide.bg[1]});
      font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;display:flex;flex-direction:column;align-items:center}
    h1{margin:72px 0 0;font-size:52px;letter-spacing:-.02em;color:${ink};font-weight:700}
    p{margin:14px 0 0;font-size:22px;color:${sub}}
    .win{margin-top:52px;width:1200px;border-radius:14px;overflow:hidden;
      box-shadow:0 40px 90px rgba(0,0,0,${slide.dark ? '.55' : '.22'}),0 0 0 1px rgba(0,0,0,${slide.dark ? '.5' : '.08'})}
    .bar{position:relative;height:0;background:${chrome}}
    .lights{position:absolute;top:13px;left:16px;display:flex;gap:9px;z-index:2}
    .lights i{width:13px;height:13px;border-radius:50%;display:block}
    img{display:block;width:1200px}
  </style></head><body>
    <h1>${slide.title}</h1><p>${slide.sub}</p>
    <div class="win"><div class="bar"><div class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div></div>
    <img src="${dataUrl}"></div>
  </body></html>`;
}

app.whenReady().then(async () => {
  await fs.mkdir(path.join(ROOT, 'pitch'), { recursive: true });
  const win = new BrowserWindow({ show: false, width: 1600, height: 1000, useContentSize: true, webPreferences: { offscreen: false } });
  for (const [i, slide] of SLIDES.entries()) {
    const raw = await fs.readFile(path.join(ROOT, 'raw', slide.file)).catch(() => null);
    if (!raw) { console.log(`skip ${slide.file} (missing)`); continue; }
    const html = page(slide, `data:image/png;base64,${raw.toString('base64')}`);
    const tmp = path.join(app.getPath('temp'), `tw-frame-${process.pid}.html`);
    await fs.writeFile(tmp, html);
    await win.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 300));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1600, height: 1000 });
    const out = path.join(ROOT, 'pitch', `${String(i + 1).padStart(2, '0')}-${slide.file.replace(/^\d-/, '')}`);
    await fs.writeFile(out, image.toPNG());
    console.log('wrote', path.relative(process.cwd(), out));
  }
  app.exit(0);
});
