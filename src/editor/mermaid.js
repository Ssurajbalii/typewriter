// Lazily loaded Mermaid renderer shared by the editor and export.

let mermaidPromise = null;
let mermaidSeq = 0;
const mermaidCache = new Map();

export function loadMermaid() {
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => mermaid);
  return mermaidPromise;
}

export async function renderMermaid(source, theme) {
  const key = theme + '\0' + source;
  if (mermaidCache.has(key)) return mermaidCache.get(key);
  const mermaid = await loadMermaid();
  // SVG text labels (not HTML foreignObject) survive sanitizing and export.
  mermaid.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'strict',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  });
  const { svg } = await mermaid.render(`tw-mermaid-${++mermaidSeq}`, source);
  mermaidCache.set(key, svg);
  return svg;
}
