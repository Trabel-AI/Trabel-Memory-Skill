'use strict';

// scripts/reader.js: the input of the new-reader test.

const test = require('node:test');
const assert = require('node:assert');
const { repoWithMemory, card, cleanup } = require('./helpers');
const { collectChanged, render } = require('../scripts/reader');

test.after(cleanup);

const judged = (files) => files.flatMap((f) => f.sections.flatMap((s) => s.lines.filter((l) => l.judged).map((l) => l.text)));

test('reader: nothing changed, nothing to judge', () => {
  const repo = repoWithMemory();
  assert.deepStrictEqual(collectChanged(repo.dir), []);
  assert.strictEqual(render([]), 'No state lines changed.');
});

test('reader: a changed line comes with its file, summary and headings, and headings are not judged', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/customers.md', card({ name: 'Customers', summary: 'The customer list and customer card', owns: ['src/customers/**'] }) +
    '# Customers\n\n## What the user sees\n\n### The list\n\nThe list shows active customers only.\n');
  const files = collectChanged(repo.dir);
  assert.strictEqual(files.length, 1);
  assert.deepStrictEqual(judged(files), ['The list shows active customers only.']);
  const s = files[0].sections.find((x) => x.lines.some((l) => l.judged));
  assert.deepStrictEqual(s.headings, ['# Customers', '## What the user sees', '### The list']);
  const text = render(files);
  assert.ok(text.includes('=== File: docs/state/customers.md'), text);
  assert.ok(text.includes('About this file: The customer list and customer card'), text);
  assert.ok(text.includes('--- Under: # Customers > ## What the user sees > ### The list'), text);
  assert.ok(/\[L\d+\] The list shows active customers only\./.test(text), text);
});

test('reader: a changed list item comes with the rest of the list as context', () => {
  const repo = repoWithMemory();
  const head = card({ name: 'Customers', summary: 'The customer list and customer card', owns: ['src/customers/**'] }) + '# Customers\n\n## Roles\n\n';
  repo.write('docs/state/customers.md', head + '- Admin: everything\n- Viewer: read only\n- Agent: own customers\n');
  repo.commit('roles');
  repo.write('docs/state/customers.md', head + '- Admin: everything\n- Viewer: read only, no export\n- Agent: own customers\n');
  const files = collectChanged(repo.dir);
  assert.deepStrictEqual(judged(files), ['- Viewer: read only, no export']);
  const lines = files[0].sections[0].lines;
  assert.deepStrictEqual(lines.map((l) => [l.text, l.judged]), [
    ['- Admin: everything', false],
    ['- Viewer: read only, no export', true],
    ['- Agent: own customers', false],
  ]);
});

test('reader: a new state file is sent whole, without its card', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/orders.md', card({ name: 'Orders', summary: 'Orders and their statuses', owns: ['src/orders/**'] }) +
    '# Orders\n\nAn order is open until it is paid.\n\n## Traps\n\n- Refunds are manual.\n');
  const files = collectChanged(repo.dir);
  const orders = files.find((f) => f.path === 'docs/state/orders.md');
  assert.strictEqual(orders.whole, true);
  assert.deepStrictEqual(judged([orders]), ['An order is open until it is paid.', '- Refunds are manual.']);
  assert.ok(render(files).includes('(the whole file is new)'));
});

test('reader: CRLF files and deleted lines', () => {
  const repo = repoWithMemory();
  const head = card({ name: 'Customers', summary: 'The customer list and customer card', owns: ['src/customers/**'] }) + '# Customers\n\n';
  repo.write('docs/state/customers.md', (head + 'Line one.\n\nLine two.\n').replace(/\n/g, '\r\n'));
  repo.commit('crlf');
  repo.write('docs/state/customers.md', (head + 'Line two, changed.\n').replace(/\n/g, '\r\n'));
  assert.deepStrictEqual(judged(collectChanged(repo.dir)), ['Line two, changed.']);
});

test('reader: a project without memory', () => {
  const { makeRepo } = require('./helpers');
  assert.strictEqual(collectChanged(makeRepo().dir), null);
});
