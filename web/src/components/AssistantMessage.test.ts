// The assistant's reply formatter, on whole answers and on every partial
// answer as it streams in (it must never stall on half-written Markdown).
//   node --import tsx --test web/src/components/AssistantMessage.test.ts   (from the repository root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks } from './AssistantMessage';

const ANSWERS = [
  `**Xaaladda Deynaha**

| Nooca Deynaha | Xaaladda |
| :--- | :--- |
| Macaamiisha | $0.00 |
| Alaab-keenayaasha | $0.00 |

- Ma jirto deyn macaamiishu nagu leeyihiin.`,
  `### Faa'iidada bishan
| Qayb | Lacag |
|---|---|
| Dakhli | $600.00 |
1. Iibku wuu kordhay.
2. Kharashku waa yar yahay.
* **Ergonomic Mesh Chair**: 4 xabbo
  * sub item
| a stray | row |
| another | row |
**bold line**:
plain text`,
  '| only | a | header |',
  '|',
  '| one cell',
  '**',
  '#',
  '- ',
  '1. ',
];

test('every partial answer (as it streams) is parsed, quickly, without stalling', () => {
  for (const answer of ANSWERS) {
    for (let n = 0; n <= answer.length; n++) {
      const started = Date.now();
      const blocks = parseBlocks(answer.slice(0, n));
      assert.ok(Date.now() - started < 50, `slow on a prefix of ${n} characters`);
      assert.ok(Array.isArray(blocks));
    }
  }
});

test('a table row without its separator yet is shown as text; once the separator arrives it is a table', () => {
  assert.deepEqual(parseBlocks('| Nooca Deynaha | Xaaladda |').map((b) => b.kind), ['paragraph']);
  const full = parseBlocks('| Nooca Deynaha | Xaaladda |\n| :--- | :--- |\n| Macaamiisha | $0.00 |');
  assert.equal(full[0].kind, 'table');
  assert.deepEqual((full[0] as any).rows, [['Macaamiisha', '$0.00']]);
});

test('whole answers keep their structure', () => {
  assert.deepEqual(parseBlocks(ANSWERS[0]).map((b) => b.kind), ['heading', 'table', 'list']);
});
