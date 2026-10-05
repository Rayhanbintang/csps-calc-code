// Fails the build when the built HTML needs something the Content-Security-Policy in
// vercel.json blocks: inline scripts, inline styles, inline event handlers, or scripts
// and styles from another origin.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const problems = [];

for (const file of readdirSync(dist).filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(join(dist, file), 'utf8');
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc=/.test(m[1]) && m[2].trim()) problems.push(`${file}: inline <script>`);
    const src = /\bsrc="([^"]+)"/.exec(m[1])?.[1];
    if (src && /^(https?:)?\/\//.test(src)) problems.push(`${file}: script from another origin (${src})`);
  }
  if (/<style\b/i.test(html)) problems.push(`${file}: inline <style>`);
  if (/\son[a-z]+=/i.test(html)) problems.push(`${file}: inline event handler`);
  if (/\sstyle="/i.test(html)) problems.push(`${file}: inline style attribute`);
  for (const m of html.matchAll(/<link\b[^>]*href="((?:https?:)?\/\/[^"]+)"/gi)) problems.push(`${file}: link to another origin (${m[1]})`);
}

if (problems.length) {
  console.error('CSP check failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('CSP check passed.');
