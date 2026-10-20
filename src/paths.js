// Minimal path helpers that understand both POSIX (/Users/a/b.md) and
// Windows (C:\Users\a\b.md, \\server\share\b.md) paths. The sandboxed
// renderer has no Node `path` module.

const SEP = /[/\\]/;

export function isAbsolute(p) {
  return p.startsWith('/') || /^[A-Za-z]:[/\\]/.test(p) || p.startsWith('\\\\');
}

export function basename(p) {
  return p.split(SEP).pop();
}

export function dirname(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i <= 0 ? p.slice(0, i + 1) : p.slice(0, i);
}

/** Join a directory and a relative path using the directory's own separator. */
export function join(dir, rel) {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  const cleaned = rel.replace(/^\.[/\\]/, '').split(SEP).join(sep);
  return dir.replace(/[/\\]$/, '') + sep + cleaned;
}

/** Path relative to `dir` if `p` is inside it, otherwise `p` unchanged (with / separators). */
export function relativeTo(dir, p) {
  const norm = (s) => s.replace(/\\/g, '/');
  const d = norm(dir).replace(/\/$/, '') + '/';
  const target = norm(p);
  const inside = /^[A-Za-z]:/.test(d) ? target.toLowerCase().startsWith(d.toLowerCase()) : target.startsWith(d);
  return inside ? target.slice(d.length) : p;
}

/** Absolute path to URL path segments: "C:\a b\c.png" -> "/C:/a%20b/c.png". */
export function toUrlPath(p) {
  const parts = p.replace(/\\/g, '/').split('/');
  const encoded = parts.map((seg, i) => (i <= 1 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/');
  return encoded.startsWith('/') ? encoded : '/' + encoded;
}

export function toFileUrl(p) {
  return 'file://' + toUrlPath(p);
}
