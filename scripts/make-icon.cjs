// Draws the app icon (1024×1024 PNG, transparent corners) to build/icon.png.
// Usage: npx electron scripts/make-icon.cjs
// electron-builder turns build/icon.png into the macOS .icns automatically.

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

// Runs inside the page; returns a PNG data URL.
const DRAW = `(() => {
  const S = 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');

  // macOS icon grid: an 824px rounded square centred on the canvas.
  const x = 100, y = 100, w = 824, r = 186;
  const shape = () => { g.beginPath(); g.roundRect(x, y, w, w, r); };

  g.save();
  g.shadowColor = 'rgba(0,0,0,0.28)';
  g.shadowBlur = 36;
  g.shadowOffsetY = 14;
  shape();
  const paper = g.createLinearGradient(0, y, 0, y + w);
  paper.addColorStop(0, '#fdfcf9');
  paper.addColorStop(1, '#ece8df');
  g.fillStyle = paper;
  g.fill();
  g.restore();

  // Faint ruled lines, like a sheet of paper.
  g.save();
  shape();
  g.clip();
  g.strokeStyle = 'rgba(60,70,90,0.07)';
  g.lineWidth = 4;
  for (let ly = y + 150; ly < y + w; ly += 92) {
    g.beginPath(); g.moveTo(x, ly); g.lineTo(x + w, ly); g.stroke();
  }
  g.restore();

  // A bold serif "T" followed by a caret: writing, in progress.
  g.fillStyle = '#23252b';
  g.font = '700 600px "Iowan Old Style", Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillText('T', 470, 735);
  g.fillStyle = '#2f6fde';
  g.beginPath();
  g.roundRect(700, 300, 34, 440, 17);
  g.fill();

  return c.toDataURL('image/png');
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const dataUrl = await win.webContents.executeJavaScript(DRAW);
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote', path.relative(process.cwd(), out));
  app.exit(0);
});
