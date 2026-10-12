import { expect, it } from 'vitest';
import { blocks } from './plaintext';

it('reads headings, bullets and bold, and keeps markup as text', () => {
  const b = blocks('## Risks\n- **No backup** on Core DB\n- <script>x</script>\n\nPlain line\nnext line');
  expect(b.map((x) => x.kind)).toEqual(['h', 'li', 'li', 'p']);
  expect(b[1].runs).toEqual([{ text: 'No backup', bold: true }, { text: ' on Core DB', bold: false }]);
  expect(b[2].runs[0].text).toBe('<script>x</script>');
  expect(b[3].runs[0].text).toBe('Plain line next line');
});

it('drops single-asterisk and code marks', () => {
  expect(blocks('- *AWS*: switch `m5.xlarge` to Savings Plans')[0].runs[0].text).toBe('AWS: switch m5.xlarge to Savings Plans');
});
