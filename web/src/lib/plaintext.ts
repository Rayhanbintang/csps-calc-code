// Turns a model's answer into blocks the page renders as elements, never as HTML:
// paragraphs, headings, bullets, and **bold** runs. Anything else stays plain text.

export interface Run {
  text: string;
  bold: boolean;
}
export interface Block {
  kind: 'p' | 'h' | 'li';
  runs: Run[];
}

function runs(s: string): Run[] {
  const out: Run[] = [];
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  for (const p of parts) {
    if (!p) continue;
    const m = /^\*\*([^*]+)\*\*$/.exec(p);
    // Single-asterisk italics and `code` marks show as plain text.
    out.push(m ? { text: m[1], bold: true } : { text: p.replace(/\*([^*\s][^*]*)\*/g, '$1').replace(/`([^`]+)`/g, '$1'), bold: false });
  }
  return out;
}

export function blocks(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: 'p', runs: runs(para.join(' ')) });
    para = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    const li = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (h) { flush(); out.push({ kind: 'h', runs: runs(h[1]) }); }
    else if (li) { flush(); out.push({ kind: 'li', runs: runs(li[1]) }); }
    else para.push(line);
  }
  flush();
  return out;
}
