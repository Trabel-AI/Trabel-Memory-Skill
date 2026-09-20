'use strict';

// The gate's sixth check: working from a plan. Every path, through a real
// commit with the real hook.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { repoWithMemory, cleanup, run, PLUGIN } = require('./helpers');

test.after(cleanup);

const blocked = (r, text) => {
  assert.strictEqual(r.ok, false, 'expected the commit to be blocked:\n' + r.output);
  if (text) assert.ok(r.output.includes(text), `expected "${text}" in:\n${r.output}`);
};
const passed = (r) => assert.strictEqual(r.ok, true, 'expected the commit to pass:\n' + r.output);

const queue = (n, m, { tasks = ['- [ ] a task'], left, planPath = 'docs/plan.md' } = {}) => {
  const list = left || Array.from({ length: m - n }, (_, i) => `${n + 1 + i}. Session ${n + 1 + i}`);
  return ['# Next', '', `Plan: ${planPath}`, `Session ${n} of ${m}: Session ${n}`, '', ...tasks, '', ...(list.length ? ['Sessions left:', ...list] : []), ''].join('\n');
};
const heQueue = (n, m) => {
  const list = Array.from({ length: m - n }, (_, i) => `${n + 1 + i}. סשן מספר ${n + 1 + i} (בתוכנית: פרק ${n + 1 + i})`);
  return ['# התור', '', 'התוכנית: docs/plan.md', `סשן ${n} מתוך ${m}: סשן מספר ${n}`, '', '- [ ] משימה', '', ...(list.length ? ['הסשנים הבאים:', ...list] : []), ''].join('\n');
};

// A project that works from a plan, standing on session n of m.
function repoWithPlan(n = 2, m = 5, options = {}) {
  const repo = repoWithMemory(options);
  repo.write('docs/plan.md', '# The plan\n\nFive sessions.\n');
  repo.write('docs/NEXT.md', options.language === 'he' ? heQueue(n, m) : queue(n, m));
  passed(repo.commit('start from the plan'));
  return repo;
}

test('a project with a plain queue works as before', () => {
  const repo = repoWithMemory();
  repo.write('docs/NEXT.md', '# Next\n\n- [x] nothing\n- [ ] Step 2 of 5: something\n');
  passed(repo.commit('a plain queue'));
  repo.write('docs/NEXT.md', '# Next\n\nThe queue is empty.\n');
  passed(repo.commit('emptied'));
});

test('a first plan passes, with the plan file in the same commit or in an earlier one', () => {
  repoWithPlan(1, 3);
  const repo = repoWithMemory();
  repo.write('docs/plan.md', '# The plan\n');
  passed(repo.commit('the plan alone'));
  repo.write('docs/NEXT.md', queue(1, 3));
  passed(repo.commit('start from the plan'));
});

test('the queue points at a plan that is not in the commit: blocked, Decision does not help', () => {
  const repo = repoWithMemory();
  repo.write('docs/NEXT.md', queue(1, 3));
  blocked(repo.commit('no plan file'), 'The queue points at a plan that does not exist: docs/plan.md.');
  blocked(repo.commit('no plan file\n\nDecision: on purpose\n'), 'does not exist');
  repo.write('docs/plan.md', '# The plan\n');
  passed(repo.commit('with the plan'));
});

test('a commit that touches neither the queue nor the plan passes; with a missing plan it is blocked', () => {
  const repo = repoWithPlan();
  repo.write('docs/state/customers.md', repo.read('docs/state/customers.md') + 'One more line.\n');
  passed(repo.commit('docs only'));
  repo.remove('docs/plan.md');
  repo.commit('the plan is gone\n\nMemory-Skip: the person asked\n');
  repo.write('docs/state/customers.md', repo.read('docs/state/customers.md') + 'Another line.\n');
  blocked(repo.commit('docs only'), 'does not exist');
});

test('ticking tasks and finishing a session pass: N up by one, the top line dropped', () => {
  const repo = repoWithPlan(2, 5);
  repo.write('docs/NEXT.md', queue(2, 5, { tasks: ['- [x] a task'] }));
  passed(repo.commit('ticked'));
  repo.write('docs/NEXT.md', queue(3, 5));
  passed(repo.commit('session 3'));
});

test('N jumps or goes down: blocked, with or without Decision', () => {
  const repo = repoWithPlan(2, 5);
  repo.write('docs/NEXT.md', queue(4, 5));
  blocked(repo.commit('jump'), 'Session skipped: the queue went from session 2 to session 4.');
  blocked(repo.commit('jump\n\nDecision: skip session 3\n'), 'Session skipped');
  repo.write('docs/NEXT.md', queue(1, 5));
  blocked(repo.commit('back'), 'The queue went backwards: from session 2 to session 1.');
  blocked(repo.commit('back\n\nDecision: again\n'), 'went backwards');
});

test('the list of sessions left changed another way: blocked, and the message shows the list; Decision passes', () => {
  const repo = repoWithPlan(2, 5);
  repo.write('docs/NEXT.md', queue(3, 5, { left: ['5. Session 5'] }));
  const r = repo.commit('session 4 vanished');
  blocked(r, 'The list of sessions left changed.');
  assert.ok(r.output.includes('It should read:\n4. Session 4\n5. Session 5'), r.output);
  passed(repo.commit('session 4 dropped\n\nDecision: session 4 is not needed, the reports moved to another product\n'));
});

test('the last line of the list drops into the last session, and nothing else may be left', () => {
  const repo = repoWithPlan(4, 5);
  repo.write('docs/NEXT.md', queue(5, 5, { left: ['5. Session 5'] }));
  blocked(repo.commit('kept'), 'No sessions should be left in it.');
  repo.write('docs/NEXT.md', queue(5, 5));
  passed(repo.commit('the last session'));
});

test('the plan file changed: blocked without Decision, in any folder', () => {
  const repo = repoWithPlan(2, 5);
  repo.write('docs/plan.md', '# The plan\n\nSix sessions.\n');
  blocked(repo.commit('edit the plan'), 'The plan file changed: docs/plan.md.');
  passed(repo.commit('edit the plan\n\nDecision: the person asked to add a session about exports\n'));
});

test('the plan deleted, or its reference removed, before the last session: blocked without Decision', () => {
  const repo = repoWithPlan(2, 5);
  repo.write('docs/NEXT.md', '# Next\n\nThe queue is empty.\n');
  blocked(repo.commit('reference removed'), 'The plan left the queue before it was finished: docs/plan.md, session 2 of 5.');
  repo.remove('docs/plan.md');
  blocked(repo.commit('both removed'), 'before it was finished');
  passed(repo.commit('both removed\n\nDecision: the plan is stopped, the product is on hold\n'));
});

test('the plan deleted while the queue still points at it: blocked as missing', () => {
  const repo = repoWithPlan(2, 5);
  repo.remove('docs/plan.md');
  const r = repo.commit('deleted\n\nDecision: no reason\n');
  blocked(r, 'does not exist');
  assert.ok(!r.output.includes('before it was finished'), r.output);
});

test('a full cycle: the last session ends, the plan is deleted and the queue emptied in one commit', () => {
  const repo = repoWithPlan(1, 2);
  repo.write('docs/NEXT.md', queue(2, 2));
  passed(repo.commit('session 2'));
  const r = run(repo.dir, process.execPath, [path.join(PLUGIN, 'scripts', 'plan.js'), '--finish']);
  assert.strictEqual(r.status, 1, 'an open task');
  repo.write('docs/NEXT.md', queue(2, 2, { tasks: ['- [x] a task'] }));
  assert.strictEqual(run(repo.dir, process.execPath, [path.join(PLUGIN, 'scripts', 'plan.js'), '--finish']).status, 0);
  passed(repo.commit('the plan is finished'));
  assert.strictEqual(repo.read('docs/NEXT.md'), '# Next\n\nThe queue is empty.\n');
  repo.write('docs/state/customers.md', repo.read('docs/state/customers.md') + 'After the plan.\n');
  passed(repo.commit('work goes on with a plain queue'));
});

test('Hebrew project, CRLF queue: the messages are in Hebrew', () => {
  const repo = repoWithPlan(2, 5, { language: 'he' });
  repo.write('docs/NEXT.md', heQueue(4, 5).replace(/\n/g, '\r\n'));
  blocked(repo.commit('קפיצה'), 'סשן דולג: התור עבר מסשן 2 לסשן 4.');
  repo.write('docs/NEXT.md', heQueue(3, 5).replace(/\n/g, '\r\n'));
  passed(repo.commit('סשן 3'));
  repo.write('docs/plan.md', '# התוכנית\n\nשונתה.\n');
  blocked(repo.commit('שינוי בתוכנית'), 'קובץ התוכנית השתנה: docs/plan.md.');
  passed(repo.commit('שינוי בתוכנית\n\nDecision: האדם ביקש להוסיף סשן\n'));
  repo.write('docs/NEXT.md', '# התור\n\nהתור ריק.\n');
  blocked(repo.commit('הסרה'), 'התוכנית ירדה מהתור לפני שהסתיימה: docs/plan.md, סשן 3 מתוך 5.');
});

test('the exemptions stay: Memory-Skip, warn, off', () => {
  let repo = repoWithPlan(2, 5);
  repo.write('docs/NEXT.md', queue(4, 5));
  passed(repo.commit('jump\n\nMemory-Skip: the person asked to save without the check\n'));

  repo = repoWithPlan(2, 5, { gate: 'warn' });
  repo.write('docs/NEXT.md', queue(4, 5));
  const r = repo.commit('jump');
  passed(r);
  assert.ok(r.output.includes('Warning (trabel-memory)') && r.output.includes('Session skipped'), r.output);

  repo = repoWithPlan(2, 5, { gate: 'off' });
  repo.write('docs/NEXT.md', queue(4, 5));
  const off = repo.commit('jump');
  passed(off);
  assert.strictEqual(off.output.trim(), '');
});

test('amend: only what the amendment adds is checked', () => {
  const repo = repoWithPlan(2, 5);
  repo.write('docs/NEXT.md', queue(3, 5));
  passed(repo.commit('session 3'));
  repo.write('docs/state/customers.md', repo.read('docs/state/customers.md') + 'Forgotten line.\n');
  passed(repo.commit('session 3, amended', ['--amend']));
  repo.write('docs/NEXT.md', queue(5, 5));
  blocked(repo.commit('amended again', ['--amend']), 'from session 3 to session 5');
});

test('a merge commit is not checked', () => {
  const repo = repoWithPlan(2, 5);
  repo.git('checkout', '-q', '-b', 'side');
  repo.write('docs/plan.md', '# The plan\n\nEdited on the side branch.\n');
  passed(repo.commit('side\n\nDecision: the person asked\n'));
  repo.git('checkout', '-q', 'main');
  repo.write('docs/state/customers.md', repo.read('docs/state/customers.md') + 'Main line.\n');
  passed(repo.commit('main'));
  const r = run(repo.dir, 'git', ['merge', '--no-ff', '-q', '-m', 'merge side', 'side']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('a broken helper still fails open', () => {
  const { copyPlugin } = require('./helpers');
  const fs = require('fs');
  const pluginRoot = copyPlugin();
  const repo = repoWithPlan(2, 5, { pluginRoot });
  fs.writeFileSync(path.join(pluginRoot, 'scripts', 'lib', 'plan.js'), 'this is not javascript (');
  repo.write('docs/NEXT.md', queue(4, 5));
  const r = repo.commit('jump');
  passed(r);
  assert.ok(r.output.includes('the gate could not run'), r.output);
});

// The plan file is not code

test('a plan file outside docs/ is not code: no owner asked, by the gate, check.js, lag.js and the session start', () => {
  const repo = repoWithMemory();
  repo.write('build-plan.md', '# The plan\n');
  repo.write('docs/NEXT.md', queue(1, 3, { planPath: 'build-plan.md' }));
  const node = (script, args = [], options = {}) => run(repo.dir, process.execPath, [path.join(PLUGIN, 'scripts', script), ...args], options);

  assert.ok(node('check.js').stdout.includes('All code has an owner'), node('check.js').stdout);
  const session = node('session-start.js', ['--data', repo.dataDir], { input: JSON.stringify({ cwd: repo.dir, source: 'resume' }) }).stdout;
  assert.ok(session.includes('- build-plan.md (new)'), session);
  assert.ok(!session.includes('build-plan.md (new; docs'), session);
  passed(repo.commit('start from the plan'));

  // Changing it needs a Decision: line, never an owner or a Docs-Unchanged: line.
  repo.write('build-plan.md', '# The plan\n\nMore.\n');
  const r = repo.commit('edit');
  blocked(r, 'The plan file changed: build-plan.md.');
  assert.ok(!r.output.includes('Code without'), r.output);
  passed(repo.commit('edit\n\nDecision: the person asked\n'));
  assert.ok(node('lag.js').stdout.includes('No lag'), node('lag.js').stdout);

  // Without the reference, the same file is code again.
  const plain = repoWithMemory();
  plain.write('build-plan.md', '# The plan\n');
  blocked(plain.commit('a stray file'), 'Code without an owner: build-plan.md');
});

test('the plan deleted at the end is not code either, even when a pattern owns its folder', () => {
  const repo = repoWithMemory();
  repo.write('src/customers/plan.md', '# The plan\n');
  repo.write('docs/NEXT.md', queue(2, 2, { planPath: 'src/customers/plan.md' }));
  passed(repo.commit('start from the plan'));
  repo.write('docs/NEXT.md', queue(2, 2, { planPath: 'src/customers/plan.md', tasks: ['- [x] a task'] }));
  assert.strictEqual(run(repo.dir, process.execPath, [path.join(PLUGIN, 'scripts', 'plan.js'), '--finish']).status, 0);
  passed(repo.commit('the plan is finished'));
});
