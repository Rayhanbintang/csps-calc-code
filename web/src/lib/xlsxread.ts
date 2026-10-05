// Reads the cell values of one sheet of an .xlsx file in the browser. An .xlsx file is a
// zip of XML files; the browser's DecompressionStream unpacks it, so no library is needed
// and the file never leaves the visitor's machine.

interface Entry {
  name: string;
  method: number;
  size: number;
  offset: number;
}

function entries(buf: Uint8Array): Entry[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // The end-of-central-directory record sits in the last 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('This file is not an Excel workbook (.xlsx).');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: Entry[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    out.push({ name: dec.decode(buf.subarray(p + 46, p + 46 + nameLen)), method, size, offset });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

async function unzip(buf: Uint8Array, e: Entry): Promise<string> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  const raw = buf.slice(start, start + e.size);
  if (e.method === 0) return new TextDecoder().decode(raw);
  if (e.method !== 8) throw new Error('This workbook uses a compression the page cannot read.');
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(stream).text();
}

function unescape(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** Text of every <t> inside a string item, joined (rich text splits one string into runs). */
function textOf(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1])).join('');
}

function colIndex(ref: string): number {
  let n = 0;
  for (const c of ref.replace(/\d+$/, '')) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** The rows of the named sheet as text, indexed by column (A = 0). Empty cells are ''. */
export async function readSheet(data: ArrayBuffer | Uint8Array, sheetName: string): Promise<string[][]> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const list = entries(buf);
  const get = async (name: string) => {
    const e = list.find((x) => x.name === name);
    return e ? unzip(buf, e) : '';
  };
  const workbook = await get('xl/workbook.xml');
  const sheet = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((t) => unescape(/name="([^"]*)"/.exec(t)?.[1] ?? '') === sheetName);
  if (!sheet) throw new Error(`The workbook has no "${sheetName}" sheet.`);
  const rid = /r:id="([^"]*)"/.exec(sheet)?.[1];
  const rels = await get('xl/_rels/workbook.xml.rels');
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`Id="${rid}"`));
  const target = /Target="([^"]*)"/.exec(rel ?? '')?.[1] ?? '';
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;

  const sst = await get('xl/sharedStrings.xml');
  const strings = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  const xml = await get(path);
  const rows: string[][] = [];
  for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const at = Number(/\br="(\d+)"/.exec(r[1])?.[1] ?? rows.length + 1) - 1;
    const row: string[] = [];
    for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="([^"]*)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val = '';
      if (type === 's') val = strings[Number(v)] ?? '';
      else if (type === 'inlineStr') val = textOf(body);
      else if (v !== undefined) val = unescape(v);
      if (ref) row[colIndex(ref)] = val;
    }
    rows[at] = Array.from(row, (x) => x ?? '');
  }
  return Array.from(rows, (x) => x ?? []);
}
