'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { toRegExp, specificity, isAllStars } = require('../scripts/lib/glob');
const { parseCard } = require('../scripts/lib/card');
const { buildOwnership } = require('../scripts/lib/owners');
const { findOpenItems, withoutOpenItems } = require('../scripts/lib/openItems');
const { countLines } = require('../scripts/lib/text');
const { parseSettings, makeIsCode } = require('../scripts/lib/settings');
const { renderTable, extractBlock, tablesMatch } = require('../scripts/lib/indexTable');

test('patterns', () => {
  const m = (p, f) => toRegExp(p).test(f);
  assert.ok(m('src/**', 'src/a/b.ts'));
  assert.ok(!m('src/**', 'srcx/a.ts'));
  assert.ok(m('src/**/x.ts', 'src/x.ts'));
  assert.ok(m('src/**/x.ts', 'src/a/b/x.ts'));
  assert.ok(m('src/lib/commissions*.ts', 'src/lib/commissions-report.ts'));
  assert.ok(!m('src/lib/commissions*.ts', 'src/lib/sub/commissions.ts'));
  assert.ok(m('src/app/**/commissions/**', 'src/app/(admin)/commissions/page.tsx'));
  assert.ok(m('package.json', 'package.json'));
  assert.ok(!m('package.json', 'apps/web/package.json'));
  assert.ok(m('**/*.png', 'logo.png'));
  assert.ok(m('src/a?.js', 'src/ab.js'));
  assert.ok(m('src/[x].js', 'src/[x].js'));
  assert.ok(m('./src/**', 'src/a.js'));
});

test('pattern exactness and all-star patterns', () => {
  assert.strictEqual(specificity('src/**'), 4);
  assert.ok(specificity('src/lib/x*.ts') > specificity('src/**'));
  for (const p of ['**', '*', '**/*', '/**/']) assert.ok(isAllStars(p), p);
  assert.ok(!isAllStars('src/**'));
});

test('card: plain, CRLF, quoted, inline list, missing', () => {
  const text = '---\nname: עמלות\nsummary: "מנוע העמלות: הכל"\nowns:\n  - src/app/**/commissions/**\n  - src/lib/commissions*.ts\nbudget: 350\n---\n# body\n';
  const c = parseCard(text);
  assert.deepStrictEqual(c, {
    name: 'עמלות',
    summary: 'מנוע העמלות: הכל',
    owns: ['src/app/**/commissions/**', 'src/lib/commissions*.ts'],
    budget: 350,
  });
  assert.deepStrictEqual(parseCard(text.replace(/\n/g, '\r\n')), c);
  assert.deepStrictEqual(parseCard('﻿' + text), c);
  assert.deepStrictEqual(parseCard('---\nname: x\nowns: [a.js, "b.js"]\n---\n').owns, ['a.js', 'b.js']);
  assert.strictEqual(parseCard('# no card\n'), null);
  assert.strictEqual(parseCard('---\nname: x\n'), null);
});

test('owners: the most exact wins, ties share', () => {
  const { ownersOf } = buildOwnership([
    { path: 'a.md', owns: ['src/**'] },
    { path: 'b.md', owns: ['src/pay/**'] },
    { path: 'c.md', owns: ['src/pay/**'] },
    { path: 'd.md', owns: ['src/pay/refund.ts'] },
  ]);
  assert.deepStrictEqual(ownersOf('src/x.ts'), ['a.md']);
  assert.deepStrictEqual(ownersOf('src/pay/x.ts'), ['b.md', 'c.md']);
  assert.deepStrictEqual(ownersOf('src/pay/refund.ts'), ['d.md']);
  assert.deepStrictEqual(ownersOf('lib/x.ts'), []);
});

test('open items are found by shape, in any language', () => {
  const text = [
    '# עמלות',
    '## פתוח',
    '### עמלה על עסקה שבוטלה',
    'נפתח: 2026-09-08',
    'הסיכון: עמלה שגויה.',
    '',
    '### Not an item',
    'Just text.',
    '## מה התחום עושה',
    'מחשב עמלות.',
  ].join('\r\n');
  const items = findOpenItems(text);
  assert.deepStrictEqual(items.map((i) => i.title), ['עמלה על עסקה שבוטלה']);
  assert.strictEqual(withoutOpenItems(text), '# עמלות\n## פתוח\n### Not an item\nJust text.\n## מה התחום עושה\nמחשב עמלות.');
});

test('line counting is the same for CRLF and LF', () => {
  assert.strictEqual(countLines('a\nb\n'), 2);
  assert.strictEqual(countLines('a\r\nb\r\n'), 2);
  assert.strictEqual(countLines('a\r\nb'), 2);
  assert.strictEqual(countLines(''), 0);
});

test('settings: defaults and what counts as code', () => {
  const s = parseSettings('{}');
  assert.deepStrictEqual(s, { gate: 'block', language: 'en', ignore: [], adopted: [] });
  assert.strictEqual(parseSettings('{"gate":"nonsense"}').gate, 'block');
  assert.throws(() => parseSettings('[]'));
  const isCode = makeIsCode(parseSettings('{"ignore":["vendor/**"],"adopted":[{"path":"design.md","owns":[]}]}'));
  assert.ok(isCode('src/a.ts'));
  assert.ok(isCode('.gitignore'));
  for (const f of ['docs/x.md', 'CLAUDE.md', 'a/CLAUDE.md', 'design.md', 'vendor/x.js', 'yarn.lock', 'img/A.PNG', 'src/a.test.ts', 'tests/x.js']) {
    assert.ok(!isCode(f), f);
  }
});

test('index table: render, find in the block, compare loosely', () => {
  const table = renderTable({
    language: 'he',
    hasNext: true,
    stateFiles: [
      { path: 'docs/state/zeta.md', summary: 'ז' },
      { path: 'design.md', summary: 'עיצוב', adopted: true },
      { path: 'docs/state/conventions.md', summary: 'מוסכמות' },
      { path: 'docs/state/architecture.md', summary: 'מבנה | הרצה' },
    ],
  });
  assert.deepStrictEqual(table, [
    '| קובץ | מה בו |',
    '|---|---|',
    '| docs/NEXT.md | מה עושים עכשיו |',
    '| docs/state/architecture.md | מבנה \\| הרצה |',
    '| docs/state/conventions.md | מוסכמות |',
    '| docs/state/zeta.md | ז |',
    '| design.md | עיצוב |',
  ]);
  const claude = ['# P', '<!-- trabel-memory:start -->', '## זיכרון', 'כלל', '', ...table.map((l) => l.replace(/ \| /g, '|')), '<!-- trabel-memory:end -->', 'after'].join('\n');
  const block = extractBlock(claude);
  assert.strictEqual(block.rulesLines, 4);
  assert.ok(tablesMatch(block.table, table));
  assert.ok(!tablesMatch(block.table.slice(0, -1), table));
  assert.strictEqual(extractBlock('# no block'), null);
});
