'use strict';

// The index builder, the open items collector and the lag check.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { makeRepo, repoWithMemory, card, cleanup, run, PLUGIN } = require('./helpers');
const fs = require('fs');
const { withTable, withRules, extractBlock, BLOCK_START, BLOCK_END } = require('../scripts/lib/indexTable');
const { RULES_BUDGET } = require('../scripts/lib/settings');
const { collectOpen, render: renderOpen } = require('../scripts/open');
const { findLag, render: renderLag } = require('../scripts/lag');

test.after(cleanup);

const script = (name) => path.join(PLUGIN, 'scripts', name);
const node = (repo, name, args = []) => run(repo.dir, process.execPath, [script(name), ...args]);
const passed = (r) => assert.strictEqual(r.ok, true, 'expected the commit to pass:\n' + r.output);

// The index builder

test('index: a new domain file gets its row, and the gate accepts the result', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/orders.md', card({ name: 'Orders', summary: 'Orders and their statuses', owns: ['src/orders/**'] }) + '# Orders\n');
  repo.write('src/orders/new.js', 'x\n');
  const r = node(repo, 'index.js');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('rebuilt'), r.stdout);
  assert.ok(repo.read('CLAUDE.md').includes('| docs/state/orders.md | Orders and their statuses |'));
  passed(repo.commit('orders'));
  assert.ok(node(repo, 'index.js').stdout.includes('up to date'));
});

test('index: the gate message names the builder', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/customers.md', card({ name: 'Customers', summary: 'A new summary', owns: ['src/customers/**'] }) + '# Customers\n');
  const r = repo.commit('summary');
  assert.strictEqual(r.ok, false);
  assert.ok(r.output.includes(`node "${script('index.js').replace(/\\/g, '/')}"`), r.output);
});

test('index: only the table changes; text around it and CRLF line endings stay', () => {
  const before = ['# Title', 'intro', BLOCK_START, '## Memory', 'rule one', '', '| File | What |', '|---|---|', '| old | row |', BLOCK_END, 'after'].join('\r\n') + '\r\n';
  const after = withTable(before, ['| File | What |', '|---|---|', '| new | row |']);
  assert.strictEqual(after, before.replace('| old | row |', '| new | row |'));
});

test('index: a block without a table gets one at its end; no block gets a block', () => {
  const noTable = ['x', BLOCK_START, '## Memory', 'rule', BLOCK_END, ''].join('\n');
  assert.strictEqual(withTable(noTable, ['| a |']), ['x', BLOCK_START, '## Memory', 'rule', '', '| a |', BLOCK_END, ''].join('\n'));
  assert.strictEqual(withTable('# Project\n', ['| a |']), ['# Project', '', BLOCK_START, '| a |', BLOCK_END, ''].join('\n'));
  assert.strictEqual(withTable(null, ['| a |']), [BLOCK_START, '| a |', BLOCK_END, ''].join('\n'));
});

test('index: --with-rules writes the rules from the template in the project language, and the gate accepts it', () => {
  for (const [language, heading] of [['he', '## זיכרון הפרויקט'], ['en', '## Project memory'], ['fr', '## Project memory']]) {
    const repo = repoWithMemory({ language });
    repo.write('CLAUDE.md', '# Mine\n\nKeep this.\n');
    const r = node(repo, 'index.js', ['--with-rules']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const text = repo.read('CLAUDE.md');
    assert.ok(text.startsWith('# Mine\n\nKeep this.\n\n' + BLOCK_START + '\n' + heading + '\n'), text);
    assert.ok(text.includes('| docs/state/customers.md |'), text);
    passed(repo.commit('block'));
    assert.ok(node(repo, 'index.js', ['--with-rules']).stdout.includes('up to date'));
  }
});

test('index: --with-rules replaces old rules and keeps the table and the text outside', () => {
  const before = ['# T', BLOCK_START, '## Old', 'old rule', '', '| a |', BLOCK_END, 'after'].join('\r\n') + '\r\n';
  const after = withRules(before, ['## New', 'rule']);
  assert.strictEqual(after, ['# T', BLOCK_START, '## New', 'rule', '', '| a |', BLOCK_END, 'after'].join('\r\n') + '\r\n');
  assert.strictEqual(withRules('x\n', ['r']), ['x', '', BLOCK_START, 'r', BLOCK_END, ''].join('\n'));
  assert.strictEqual(withRules([BLOCK_START, 'old'].join('\n'), ['r']), [BLOCK_START, 'r', BLOCK_END, ''].join('\n'));
});

test('index: both templates fit the 60-line ceiling of the rules', () => {
  for (const lang of ['he', 'en']) {
    const rules = fs.readFileSync(path.join(PLUGIN, 'templates', `block.${lang}.md`), 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
    const text = withTable(withRules('', rules), ['| File | What |', '|---|---|']);
    assert.ok(extractBlock(text).rulesLines <= RULES_BUDGET, `${lang}: ${extractBlock(text).rulesLines} lines`);
  }
});

test('index: a project without memory is told so', () => {
  const repo = makeRepo();
  const r = node(repo, 'index.js');
  assert.strictEqual(r.status, 1);
  assert.ok(r.stdout.includes('No memory in this project'), r.stdout);
});

// Open items

const item = (title, date, extra = '') => `### ${title}\nOpened: ${date}\nRisk: something.\n${extra}\n`;

test('open: items from every state file, oldest first, with their age', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/customers.md', card({ name: 'Customers', summary: 's', owns: ['src/customers/**'] }) +
    '# Customers\n\n' + item('Duplicate customers', '2026-09-10') + item('Old import', '2026-08-01') + '## What it does\n\nText.\n');
  repo.write('docs/state/architecture.md', card({ name: 'Architecture', summary: 's', owns: ['package.json'] }) +
    item('Deploy not verified', '2026-09-01'));
  const items = collectOpen(repo.dir, new Date('2026-09-19T12:00:00Z'));
  assert.deepStrictEqual(items.map((i) => [i.title, i.file, i.ageDays]), [
    ['Old import', 'docs/state/customers.md', 49],
    ['Deploy not verified', 'docs/state/architecture.md', 18],
    ['Duplicate customers', 'docs/state/customers.md', 9],
  ]);
  assert.strictEqual(items[0].text, '### Old import\nOpened: 2026-08-01\nRisk: something.');
  assert.ok(renderOpen(items).startsWith('3 open items, oldest first.'));
});

test('open: none, and a project without memory', () => {
  const repo = repoWithMemory();
  assert.strictEqual(renderOpen(collectOpen(repo.dir)), 'No open items.');
  const r = node(repo, 'open.js', ['--json']);
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout), []);
  assert.strictEqual(collectOpen(makeRepo().dir), null);
});

// Lag

test('lag: nothing behind right after documented commits', () => {
  const repo = repoWithMemory();
  assert.deepStrictEqual(findLag(repo.dir), {});
  assert.ok(renderLag({}).startsWith('No lag'));
});

test('lag: a bypassed commit and a skipped commit are behind; Docs-Unchanged is not', () => {
  const repo = repoWithMemory();
  repo.write('src/customers/list.js', 'module.exports = [1];\n');
  passed(repo.commit('bypassed', ['--no-verify']));
  repo.write('src/customers/list.js', 'module.exports = [2];\n');
  passed(repo.commit('skipped\n\nMemory-Skip: urgent fix'));
  repo.write('src/lib/util.js', 'module.exports = { a: 1 };\n');
  passed(repo.commit('tidy\n\nDocs-Unchanged: formatting only'));

  const lag = findLag(repo.dir);
  assert.deepStrictEqual(Object.keys(lag), ['docs/state/customers.md']);
  assert.deepStrictEqual(lag['docs/state/customers.md'][0].commits.map((c) => c.subject), ['skipped', 'bypassed']);
  assert.ok(renderLag(lag).includes('docs/state/customers.md is behind:'));
});

test('lag: updating the state file afterwards clears it', () => {
  const repo = repoWithMemory();
  repo.write('src/customers/list.js', 'module.exports = [1];\n');
  passed(repo.commit('bypassed', ['--no-verify']));
  repo.write('docs/state/customers.md', repo.read('docs/state/customers.md') + '\nThe list starts with one customer.\n');
  passed(repo.commit('docs caught up'));
  assert.deepStrictEqual(findLag(repo.dir), {});
});

test('lag: ownership comes from the working folder, and deleted files are not listed', () => {
  const repo = repoWithMemory();
  repo.write('src/orders/new.js', 'x\n');
  repo.write('src/orders/old.js', 'y\n');
  passed(repo.commit('orders', ['--no-verify']));
  repo.remove('src/orders/old.js');
  passed(repo.commit('remove old', ['--no-verify']));
  assert.deepStrictEqual(findLag(repo.dir), {}); // no owner yet

  repo.write('docs/state/orders.md', card({ name: 'Orders', summary: 's', owns: ['src/orders/**'] }) + '# Orders\n');
  // Not committed yet: the new card counts, and its file has not been
  // updated in any commit, so the orders commit is behind it.
  const lag = findLag(repo.dir);
  assert.deepStrictEqual(lag['docs/state/orders.md'].map((f) => f.file), ['src/orders/new.js']);
});

test('lag.js --json and a project without memory', () => {
  const repo = repoWithMemory();
  const r = node(repo, 'lag.js', ['--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout), {});
  const bare = makeRepo();
  assert.strictEqual(node(bare, 'lag.js').status, 1);
});

// The plugin's own files

test('plugin files: valid JSON, one name, and two hooks that point at scripts that exist', () => {
  const read = (p) => JSON.parse(require('fs').readFileSync(path.join(PLUGIN, p), 'utf8'));
  const plugin = read('.claude-plugin/plugin.json');
  const market = read('.claude-plugin/marketplace.json');
  assert.strictEqual(plugin.name, 'trabel-memory');
  assert.strictEqual(plugin.version, undefined); // updates follow the commits
  assert.deepStrictEqual(market.plugins.map((p) => [p.name, p.source]), [['trabel-memory', './']]);
  const hooks = read('hooks/hooks.json').hooks;
  assert.deepStrictEqual(Object.keys(hooks), ['SessionStart', 'SubagentStop']);
  assert.strictEqual(hooks.SessionStart[0].matcher, undefined); // every source
  assert.ok(new RegExp(hooks.SubagentStop[0].matcher).test('trabel-memory:reader'));
  assert.ok(!new RegExp(hooks.SubagentStop[0].matcher).test('Explore'));
  for (const [event, script] of [['SessionStart', 'session-start.js'], ['SubagentStop', 'reader-hook.js']]) {
    const h = hooks[event][0].hooks[0];
    assert.strictEqual(h.command, 'node');
    assert.strictEqual(h.args[0], `${'${CLAUDE_PLUGIN_ROOT}'}/scripts/${script}`);
    assert.ok(require('fs').existsSync(path.join(PLUGIN, 'scripts', script)), script);
    assert.deepStrictEqual(h.args.slice(1), ['--data', '${CLAUDE_PLUGIN_DATA}']);
  }
});
