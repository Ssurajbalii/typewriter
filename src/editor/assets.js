import { dirname, isAbsolute, join, toUrlPath } from '../paths.js';

// Resolves image paths in a document to URLs the renderer can load.
// Local files are served by the main process through the twfile:// protocol,
// relative to the directory of the open document.

let docDir = null;

export function setDocumentPath(filePath) {
  docDir = filePath ? dirname(filePath) : null;
}

export function getDocumentDir() {
  return docDir;
}

export function resolveAssetUrl(src) {
  if (/^(https?|data|blob):/i.test(src)) return src;
  let p = src.replace(/^file:\/\//i, '');
  try { p = decodeURI(p); } catch { /* keep as written */ }
  if (!isAbsolute(p)) {
    if (!docDir) return src;
    p = join(docDir, p);
  }
  return 'twfile://local' + toUrlPath(p);
}
