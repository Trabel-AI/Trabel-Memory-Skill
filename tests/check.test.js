'use strict';

// scripts/check.js: unowned code, ceilings and broad domains across the project.

const test = require('node:test');
const assert = require('node:assert');
const { makeRepo, repoWithMemory, card, cleanup } = require('./helpers');
const { checkProject, render } = require('../scripts/check');

test.after(cleanup);

test('check: a healthy project', () => {
  const repo = repoWithMemory();
  const r = checkProject(repo.dir);
  assert.deepStrictEqual(r, { unowned: [], over: [], broad: [] });
  assert.ok(render(r).startsWith('All code has an owner'));
});

test('check: code with no owner, committed and not, and ignored files are not code', () => {
  const repo = repoWithMemory();
  repo.write('src/orders/old.js', 'x\n');
  repo.commit('orders\n\nMemory-Skip: test');
  repo.write('src/orders/new.js', 'x\n');
  repo.write('src/orders/logo.png', 'x');
  repo.write('src/orders/new.test.js', 'x\n');
  const r = checkProject(repo.dir);
  assert.deepStrictEqual(r.unowned, ['src/orders/new.js', 'src/orders/old.js']);
  assert.ok(render(r).includes('- src/orders/old.js'));
});

test('check: files over their ceiling, the queue and the rules', () => {
  const repo = repoWithMemory();
  const many = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n') + '\n';
  repo.write('docs/state/customers.md', card({ name: 'Customers', summary: 'x', owns: ['src/customers/**'], budget: 20 }) + many(30));
  repo.write('docs/NEXT.md', many(120));
  repo.write('CLAUDE.md', '<!-- trabel-memory:start -->\n' + many(70) + '\n| a |\n<!-- trabel-memory:end -->\n');
  const files = checkProject(repo.dir).over.map((o) => o.file);
  assert.deepStrictEqual(files, ['docs/state/customers.md', 'docs/NEXT.md', 'CLAUDE.md (the rules in the block)']);
});

test('check: a domain pattern over 40% of 20 or more code files is a sign to split', () => {
  const repo = repoWithMemory();
  for (let i = 0; i < 12; i++) repo.write(`src/customers/c${i}.js`, 'x\n');
  for (let i = 0; i < 10; i++) repo.write(`src/lib/u${i}.js`, 'x\n');
  const r = checkProject(repo.dir);
  assert.strictEqual(r.broad.length, 1);
  assert.strictEqual(r.broad[0].file, 'docs/state/customers.md');
  assert.ok(render(r).includes('"src/customers/**" holds 13 of'), render(r));
});

test('check: a project without memory', () => {
  assert.strictEqual(checkProject(makeRepo().dir), null);
});
