'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { makeRepo, repoWithMemory, card, cleanup } = require('./helpers');

test.after(cleanup);

const blocked = (r, text) => {
  assert.strictEqual(r.ok, false, 'expected the commit to be blocked:\n' + r.output);
  if (text) assert.ok(r.output.includes(text), `expected "${text}" in:\n${r.output}`);
};
const passed = (r) => assert.strictEqual(r.ok, true, 'expected the commit to pass:\n' + r.output);
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
// The card plus filler lines, `total` lines in all.
const fill = (head, total) => head + lines(total - head.trimEnd().split('\n').length);

// A project without memory

test('project without memory: the gate is silent', () => {
  const repo = makeRepo();
  repo.write('src/app.js', 'x\n');
  const r = repo.commit('code');
  passed(r);
  assert.strictEqual(r.output.trim(), '');
});

// First commit

test('first commit in an empty repo: code with docs passes', () => {
  repoWithMemory(); // the helper's first commit must pass
});

test('first commit in an empty repo: code without an owner is blocked', () => {
  const repo = makeRepo();
  repo.write('docs/state/settings.json', '{"gate":"block","language":"en"}\n');
  repo.write('src/app.js', 'x\n');
  blocked(repo.commit('first'), 'Code without an owner: src/app.js');
});

// The five checks

test('check 1: code without an owner is blocked', () => {
  const repo = repoWithMemory();
  repo.write('src/orders/new.js', 'x\n');
  blocked(repo.commit('orders'), 'Code without an owner: src/orders/new.js');
});

test('check 2: code without docs is blocked', () => {
  const repo = repoWithMemory();
  repo.write('src/customers/list.js', 'module.exports = [1];\n');
  const r = repo.commit('change list');
  blocked(r, 'Code without docs: src/customers/list.js changed, and docs/state/customers.md did not.');
  assert.ok(r.output.includes('Commit blocked (trabel-memory).'));
  assert.ok(r.output.includes('Docs-Unchanged:'));
});

test('check 2: code with its docs passes', () => {
  const repo = repoWithMemory();
  repo.write('src/customers/list.js', 'module.exports = [1];\n');
  repo.write('docs/state/customers.md', repo.read('docs/state/customers.md') + 'The list has one customer.\n');
  passed(repo.commit('change list'));
});

test('check 2: a deleted code file needs its docs', () => {
  const repo = repoWithMemory();
  repo.remove('src/customers/list.js');
  blocked(repo.commit('delete list'), 'Code without docs: src/customers/list.js');
});

test('check 3: a state file over its limit is blocked, a raised budget passes', () => {
  const repo = repoWithMemory();
  const head = card({ name: 'Customers', summary: 'The customer list and customer card', owns: ['src/customers/**'] });
  repo.write('docs/state/customers.md', fill(head, 300));
  passed(repo.commit('exactly 300'));
  repo.write('docs/state/customers.md', fill(head, 301));
  blocked(repo.commit('301'), 'Over the limit: docs/state/customers.md has 301 lines, and the limit is 300.');
  const raised = card({ name: 'Customers', summary: 'The customer list and customer card', owns: ['src/customers/**'], budget: 400 });
  repo.write('docs/state/customers.md', fill(raised, 301));
  passed(repo.commit('raised budget'));
});

test('check 3: the queue over 100 lines is blocked', () => {
  const repo = repoWithMemory();
  repo.write('docs/NEXT.md', lines(101));
  blocked(repo.commit('long queue'), 'Over the limit: docs/NEXT.md has 101 lines, and the limit is 100.');
});

test('check 3: the rules in the CLAUDE.md block over 60 lines are blocked', () => {
  const repo = repoWithMemory();
  const text = repo.read('CLAUDE.md').replace('Read only what the task needs.\n', lines(60));
  repo.write('CLAUDE.md', text);
  blocked(repo.commit('long rules'), 'the rules in the CLAUDE.md block have 63 lines');
});

test('check 3: a file over its limit does not block commits that do not touch it', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/conventions.md', card({ name: 'Conventions', summary: 'Shared rules and traps', owns: ['src/lib/util.js'] }) + lines(400));
  repo.commit('too long', ['--no-verify']);
  repo.write('src/customers/list.js', 'module.exports = [2];\n');
  repo.write('docs/state/customers.md', repo.read('docs/state/customers.md') + 'Two customers.\n');
  passed(repo.commit('unrelated'));
});

test('check 4: an index that does not match the cards is blocked', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/customers.md', repo.read('docs/state/customers.md').replace('The customer list and customer card', 'Customers and their cards'));
  const r = repo.commit('new summary');
  blocked(r, 'Index out of date');
  assert.ok(r.output.includes('| docs/state/customers.md | Customers and their cards |'));
  repo.syncIndex();
  passed(repo.commit('new summary, index rebuilt'));
});

test('check 4: a new domain file without an index row is blocked', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/orders.md', card({ name: 'Orders', summary: 'Orders', owns: ['src/orders/**'] }) + '# Orders\n');
  repo.write('src/orders/new.js', 'x\n');
  blocked(repo.commit('orders'), 'Index out of date');
  repo.syncIndex();
  passed(repo.commit('orders with index'));
});

test('check 4: a missing block is blocked', () => {
  const repo = repoWithMemory();
  repo.write('CLAUDE.md', '# Project\n');
  blocked(repo.commit('lost block'), 'Index missing');
});

const withItem = (repo) => {
  const text = repo.read('docs/state/customers.md').replace(
    '# Customers\n',
    '# Customers\n\n## Open\n\n### Duplicates are not merged\nOpened: 2026-09-01\nRisk: two cards for one customer.\n\n## What it does\n',
  );
  repo.write('docs/state/customers.md', text);
  passed(repo.commit('open item'));
  return text;
};

test('check 5: an open item that vanished with nothing else changed is blocked', () => {
  const repo = repoWithMemory();
  const text = withItem(repo);
  repo.write('docs/state/customers.md', text.replace(/### Duplicates[\s\S]*?\n\n## What/, '## What'));
  blocked(repo.commit('close item'), 'Open item vanished: "Duplicates are not merged" was deleted from docs/state/customers.md');
});

test('check 5: an open item closed together with a state change passes', () => {
  const repo = repoWithMemory();
  const text = withItem(repo);
  const closed = text.replace(/### Duplicates[\s\S]*?\n\n## What/, '## What') + 'Duplicates are merged when the phone number matches.\n';
  repo.write('docs/state/customers.md', closed);
  passed(repo.commit('close item'));
});

test('check 5: an open item moved to another state file passes', () => {
  const repo = repoWithMemory();
  const text = withItem(repo);
  const item = '### Duplicates are not merged\nOpened: 2026-09-01\nRisk: two cards for one customer.\n';
  repo.write('docs/state/customers.md', text.replace(/### Duplicates[\s\S]*?\n\n## What/, '## What'));
  repo.write('docs/state/conventions.md', repo.read('docs/state/conventions.md') + '\n' + item);
  passed(repo.commit('move item'));
});

// Exemption lines

test('Docs-Unchanged exempts code without docs', () => {
  const repo = repoWithMemory();
  repo.write('src/customers/list.js', 'module.exports = [ ];\n');
  passed(repo.commit('format\n\nDocs-Unchanged: formatting only'));
});

test('Docs-Unchanged without a reason does not count', () => {
  const repo = repoWithMemory();
  repo.write('src/customers/list.js', 'module.exports = [ ];\n');
  blocked(repo.commit('format\n\nDocs-Unchanged:'), 'Code without docs');
});

test('Docs-Unchanged does not exempt code without an owner', () => {
  const repo = repoWithMemory();
  repo.write('src/orders/new.js', 'x\n');
  blocked(repo.commit('orders\n\nDocs-Unchanged: nothing'), 'Code without an owner');
});

test('Memory-Skip skips the whole gate', () => {
  const repo = repoWithMemory();
  repo.write('src/orders/new.js', 'x\n');
  repo.write('src/customers/list.js', 'module.exports = [3];\n');
  passed(repo.commit('rush\n\nMemory-Skip: the owner asked to save without checks'));
});

test('--no-verify bypasses the gate', () => {
  const repo = repoWithMemory();
  repo.write('src/orders/new.js', 'x\n');
  passed(repo.commit('bypass', ['--no-verify']));
});

test('a git comment line with Memory-Skip does not count', () => {
  const repo = repoWithMemory();
  repo.write('src/orders/new.js', 'x\n');
  blocked(repo.commit('orders\n# Memory-Skip: this is a comment\n'), 'Code without an owner');
});

// Gate modes and failing open

test('warn mode: the commit passes with a warning', () => {
  const repo = repoWithMemory({ gate: 'warn' });
  repo.write('src/orders/new.js', 'x\n');
  const r = repo.commit('orders');
  passed(r);
  assert.ok(r.output.includes('Warning (trabel-memory)'));
  assert.ok(r.output.includes('Code without an owner: src/orders/new.js'));
});

test('off mode: the commit passes silently', () => {
  const repo = repoWithMemory({ gate: 'off' });
  repo.write('src/orders/new.js', 'x\n');
  const r = repo.commit('orders');
  passed(r);
  assert.strictEqual(r.output.trim(), '');
});

test('the gate crashing lets the commit through with one warning line', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/settings.json', '{ not json');
  repo.write('src/orders/new.js', 'x\n');
  const r = repo.commit('broken settings');
  passed(r);
  assert.ok(r.output.includes('the gate could not run, so the commit goes through'));
});

// Language, spaces, Hebrew names, line endings

test('Hebrew project: Hebrew message passes with a Hebrew reason, and blocks in Hebrew', () => {
  const repo = repoWithMemory({ language: 'he' });
  repo.write('src/customers/list.js', 'module.exports = [ ];\n');
  passed(repo.commit('סידור קוד\n\nDocs-Unchanged: רווחים בלבד, בלי שינוי התנהגות'));
  repo.write('src/customers/list.js', 'module.exports = [4];\n');
  const r = repo.commit('שינוי ברשימה');
  blocked(r, 'הקומיט נחסם (trabel-memory).');
  assert.ok(r.output.includes('קוד בלי תיעוד: src/customers/list.js השתנה, ו-docs/state/customers.md לא.'));
});

test('a project in another language gets English messages', () => {
  const repo = repoWithMemory({ language: 'fr' });
  repo.write('src/orders/new.js', 'x\n');
  blocked(repo.commit('orders'), 'Code without an owner');
});

test('paths with spaces', () => {
  const repo = repoWithMemory({ spaces: true });
  repo.write('src/customers/my file.js', 'x\n');
  blocked(repo.commit('spaces'), 'Code without docs: src/customers/my file.js');
  repo.write('docs/state/customers.md', repo.read('docs/state/customers.md') + 'My file.\n');
  passed(repo.commit('spaces with docs'));
});

test('code files with Hebrew names', () => {
  const repo = repoWithMemory();
  repo.write('src/customers/לקוח.js', 'x\n');
  blocked(repo.commit('hebrew name'), 'Code without docs: src/customers/לקוח.js');
  repo.write('src/הזמנות/חדש.js', 'x\n');
  blocked(repo.commit('hebrew name'), 'Code without an owner: src/הזמנות/חדש.js');
});

test('a state file with CRLF line endings is read and counted like LF', () => {
  const repo = repoWithMemory();
  const head = card({ name: 'Customers', summary: 'The customer list and customer card', owns: ['src/customers/**'] });
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  repo.write('docs/state/customers.md', crlf(fill(head, 300)));
  passed(repo.commit('crlf 300'));
  repo.write('src/customers/list.js', 'module.exports = [5];\n');
  blocked(repo.commit('owns read from a CRLF card'), 'Code without docs: src/customers/list.js');
  repo.write('docs/state/customers.md', crlf(fill(head, 301)));
  blocked(repo.commit('crlf 301'), 'has 301 lines');
});

// Renames, amend, merge

test('a renamed code file needs the docs of its old path', () => {
  const repo = repoWithMemory();
  repo.git('mv', 'src/customers/list.js', 'src/customers/all.js');
  blocked(repo.commit('rename'), 'Code without docs: src/customers/list.js');
  repo.write('docs/state/customers.md', repo.read('docs/state/customers.md') + 'The list lives in all.js.\n');
  passed(repo.commit('rename with docs'));
});

test('a code file renamed to a path nobody owns is blocked', () => {
  const repo = repoWithMemory();
  repo.write('src/orders/.keep', ''); // git mv does not create folders
  repo.git('mv', 'src/customers/list.js', 'src/orders/list.js');
  const r = repo.commit('move');
  blocked(r, 'Code without an owner: src/orders/list.js');
  assert.ok(r.output.includes('Code without docs: src/customers/list.js'));
});

test('amend: a message-only amend passes, new code without docs is blocked', () => {
  const repo = repoWithMemory();
  repo.write('src/customers/list.js', 'module.exports = [6];\n');
  repo.write('docs/state/customers.md', repo.read('docs/state/customers.md') + 'Six.\n');
  passed(repo.commit('six'));
  passed(repo.commit('six, better message', ['--amend']));
  repo.write('src/customers/extra.js', 'x\n');
  blocked(repo.commit('six and extra', ['--amend']), 'Code without docs: src/customers/extra.js');
});

test('a merge commit is not checked', () => {
  const repo = repoWithMemory();
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write('src/customers/list.js', 'module.exports = [7];\n');
  repo.commit('feature\n\nMemory-Skip: test setup');
  repo.git('checkout', '-q', 'main');
  repo.write('src/lib/util.js', 'module.exports = { a: 1 };\n');
  repo.commit('main\n\nMemory-Skip: test setup');
  repo.git('merge', '-q', '--no-ff', '-m', 'merge feature', 'feature');
  assert.strictEqual(repo.git('log', '-1', '--format=%s').trim(), 'merge feature');
});

// Ownership rules

test('the most exact pattern wins', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/vip.md', card({ name: 'VIP', summary: 'VIP customers', owns: ['src/customers/vip*.js'] }) + '# VIP\n');
  repo.write('src/customers/vip-list.js', 'x\n');
  repo.syncIndex();
  passed(repo.commit('vip'));
  repo.write('src/customers/vip-list.js', 'y\n');
  repo.write('docs/state/customers.md', repo.read('docs/state/customers.md') + 'More.\n');
  blocked(repo.commit('wrong owner updated'), 'Code without docs: src/customers/vip-list.js changed, and docs/state/vip.md did not.');
});

test('on a tie, updating any one owner is enough', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/billing.md', card({ name: 'Billing', summary: 'Billing', owns: ['src/customers/**'] }) + '# Billing\n');
  repo.syncIndex();
  passed(repo.commit('billing'));
  repo.write('src/customers/list.js', 'module.exports = [8];\n');
  const r = repo.commit('tie');
  blocked(r, 'Code without docs: src/customers/list.js changed');
  assert.ok(r.output.includes('docs/state/customers.md') && r.output.includes('docs/state/billing.md'));
  repo.write('docs/state/billing.md', repo.read('docs/state/billing.md') + 'Eight.\n');
  passed(repo.commit('tie with one owner updated'));
});

test('a star in a general file is blocked', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/architecture.md', card({ name: 'Architecture', summary: 'Structure, running, deploy', owns: ['package.json', 'config/*.js'] }) + '# Architecture\n');
  blocked(repo.commit('star'), 'Star in a general file: docs/state/architecture.md holds the pattern config/*.js.');
});

test('a domain pattern made only of stars is blocked', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/customers.md', card({ name: 'Customers', summary: 'The customer list and customer card', owns: ['**/*'] }) + '# Customers\n');
  blocked(repo.commit('swallow'), 'Pattern that swallows everything: docs/state/customers.md holds the pattern **/*.');
});

const addFiles = (repo, folder, n) => {
  for (let i = 0; i < n; i++) repo.write(`${folder}/f${i}.js`, 'x\n');
};

test('broad pattern: above the limit is blocked', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/orders.md', card({ name: 'Orders', summary: 'Orders', owns: ['src/orders/**'] }) + '# Orders\n');
  addFiles(repo, 'src/orders', 20); // 20 of 23 code files
  repo.syncIndex();
  blocked(repo.commit('orders'), 'Pattern too broad: src/orders/** in docs/state/orders.md matches 20 of 23 code files (87%).');
});

test('broad pattern: below the limit passes, and later growth does not block', () => {
  const repo = repoWithMemory();
  for (const d of ['orders', 'billing', 'shipping']) {
    repo.write(`docs/state/${d}.md`, card({ name: d, summary: d, owns: [`src/${d}/**`] }) + `# ${d}\n`);
    addFiles(repo, `src/${d}`, 8); // 8 of 27 each
  }
  repo.syncIndex();
  passed(repo.commit('three domains'));
  addFiles(repo, 'src/orders/more', 30);
  repo.write('docs/state/orders.md', repo.read('docs/state/orders.md') + 'Many orders.\n');
  passed(repo.commit('orders grew'));
});

test('broad pattern: a small project is not checked', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/orders.md', card({ name: 'Orders', summary: 'Orders', owns: ['src/orders/**'] }) + '# Orders\n');
  addFiles(repo, 'src/orders', 5); // 5 of 8 code files
  repo.syncIndex();
  passed(repo.commit('orders'));
});

// What counts as code

test('ignored files are not code', () => {
  const repo = repoWithMemory({ ignore: ['scripts/**'] });
  repo.write('src/customers/list.test.js', 'x\n');
  repo.write('logo.PNG', 'x\n');
  repo.write('package-lock.json', '{}\n');
  repo.write('scripts/build.sh', 'x\n');
  repo.write('docs/notes.md', 'x\n');
  repo.write('src/CLAUDE.md', 'x\n');
  passed(repo.commit('not code'));
});

test('an adopted design file owns its code and appears in the index', () => {
  const adopted = [{ path: 'design.md', name: 'Design', summary: 'Colors, fonts, shared components', owns: ['src/ui/**'] }];
  const repo = repoWithMemory({ adopted });
  repo.write('design.md', '# Design\n\nBlue buttons.\n');
  repo.write('src/ui/button.js', 'x\n');
  blocked(repo.commit('design without index row'), '| design.md | Colors, fonts, shared components |');
  repo.syncIndex();
  passed(repo.commit('design'));
  repo.write('src/ui/button.js', 'y\n');
  blocked(repo.commit('button'), 'Code without docs: src/ui/button.js changed, and design.md did not.');
  repo.write('design.md', '# Design\n\nGreen buttons.\n');
  passed(repo.commit('button with design'));
});
