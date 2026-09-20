'use strict';

// Working from a plan: reading the queue's plan reference without knowing the
// language, comparing two queues, and the plan.js script.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeRepo, repoWithMemory, cleanup, run, PLUGIN } = require('./helpers');
const { parseQueue, checkPlan, advanceQueue, finishQueue } = require('../scripts/lib/plan');

test.after(cleanup);

const SCRIPT = path.join(PLUGIN, 'scripts', 'plan.js');
const plan = (repo, args = []) => run(repo.dir, process.execPath, [SCRIPT, ...args]);

const HE = [
  '# התור',
  '',
  'התוכנית: docs/plan.md',
  'סשן 2 מתוך 5: מסך הלקוחות',
  '',
  '- [x] טבלת הלקוחות',
  '- [ ] טופס לקוח חדש',
  '',
  'הסשנים הבאים:',
  '3. הצעות מחיר (בתוכנית: פרק 4)',
  '4. דוחות (בתוכנית: פרק 5)',
  '5. שימוש במוצר מבחוץ, כמו משתמש חדש (בתוכנית: פרק 6)',
  '',
].join('\n');

const EN = [
  '# Next',
  '',
  'Plan: docs/plan.md',
  'Session 2 of 5: The customers screen',
  '',
  '- [x] The customers table',
  '- [x] The new customer form',
  '',
  'Sessions left:',
  '3. Quotes (in the plan: chapter 4)',
  '4. Reports (in the plan: chapter 5)',
  '5. Using the product from the outside (in the plan: chapter 6)',
  '',
].join('\n');

const queue = (n, m, { tasks = ['- [ ] a task'], left, planPath = 'docs/plan.md', after = [] } = {}) => {
  const list = left || Array.from({ length: m - n }, (_, i) => `${n + 1 + i}. Session ${n + 1 + i}`);
  return ['# Next', '', `Plan: ${planPath}`, `Session ${n} of ${m}: Session ${n}`, '', ...tasks, '', ...(list.length ? ['Sessions left:', ...list] : []), ...after, ''].join('\n');
};

// Reading the queue

test('parse: a Hebrew queue gives the plan, N, M, the tasks and the sessions left', () => {
  const q = parseQueue(HE);
  assert.strictEqual(q.plan, 'docs/plan.md');
  assert.strictEqual(q.n, 2);
  assert.strictEqual(q.m, 5);
  assert.strictEqual(q.title, 'מסך הלקוחות');
  assert.deepStrictEqual(q.tasks.map((t) => [t.done, t.text]), [[true, 'טבלת הלקוחות'], [false, 'טופס לקוח חדש']]);
  assert.deepStrictEqual(q.left.map((s) => s.number), [3, 4, 5]);
  assert.strictEqual(q.left[0].text, 'הצעות מחיר (בתוכנית: פרק 4)');
  assert.deepStrictEqual(q.problems, []);
});

test('parse: an English queue, and the same queue with CRLF and a BOM', () => {
  for (const text of [EN, String.fromCharCode(0xfeff) + EN.replace(/\n/g, '\r\n')]) {
    const q = parseQueue(text);
    assert.strictEqual(q.plan, 'docs/plan.md');
    assert.strictEqual(q.n, 2);
    assert.strictEqual(q.m, 5);
    assert.strictEqual(q.title, 'The customers screen');
    assert.strictEqual(q.tasks.length, 2);
    assert.strictEqual(q.left.length, 3);
    assert.strictEqual(q.left[2].text, 'Using the product from the outside (in the plan: chapter 6)');
  }
});

test('parse: a plain queue has no plan reference', () => {
  assert.strictEqual(parseQueue('# Next\n\n- [ ] nothing\n'), null);
  assert.strictEqual(parseQueue('# התור\n\nהתור ריק.\n'), null);
  assert.strictEqual(parseQueue(''), null);
  // A label line alone, or a step line alone, is not a plan reference.
  assert.strictEqual(parseQueue('# Next\n\nNote: see docs/notes.md\n\n- [ ] step\n'), null);
  assert.strictEqual(parseQueue('# Next\n\n- [ ] Step 2 of 5: the form\n'), null);
  // The two lines must follow each other.
  assert.strictEqual(parseQueue('Plan: docs/plan.md\n\n- [ ] x\n\nSession 1 of 3: a\n'), null);
});

test('parse: the path may be in backticks or a link, with spaces, a backslash or ./', () => {
  assert.strictEqual(parseQueue('Plan: `docs/plan.md`\nSession 1 of 2\n').plan, 'docs/plan.md');
  assert.strictEqual(parseQueue('Plan: [the plan](docs/build%20plan.md)\nSession 1 of 2\n').plan, 'docs/build plan.md');
  assert.strictEqual(parseQueue('Plan: docs/my plan.md\nSession 1 of 2\n').plan, 'docs/my plan.md');
  assert.strictEqual(parseQueue('Plan: .\\docs\\plan.md\nSession 1 of 2\n').plan, 'docs/plan.md');
  assert.strictEqual(parseQueue('התוכנית: תוכנית בנייה.md\nסשן 1 מתוך 2\n').plan, 'תוכנית בנייה.md');
});

test('parse: a session line without a name; the last session has no list', () => {
  const q = parseQueue('Plan: plan.md\nSession 3 of 3\n\n- [ ] use it as a new user\n');
  assert.strictEqual(q.n, 3);
  assert.strictEqual(q.m, 3);
  assert.strictEqual(q.title, '');
  assert.deepStrictEqual(q.left, []);
  assert.deepStrictEqual(q.problems, []);
});

test('parse: the plan section ends at the next heading; tasks after it are not session tasks', () => {
  const q = parseQueue(queue(1, 2, { tasks: ['- [x] one'], after: ['', '## Later', '', '- [ ] not from the plan', '9. not a session'] }));
  assert.strictEqual(q.tasks.length, 1);
  assert.deepStrictEqual(q.left.map((s) => s.number), [2]);
});

test('parse: numbered steps under a task, and numbered checkboxes, are not sessions', () => {
  const q = parseQueue(queue(1, 3, { tasks: ['- [ ] one', '  1. a sub step', '1. [ ] a numbered task'] }));
  assert.deepStrictEqual(q.left.map((s) => s.number), [2, 3]);
  assert.strictEqual(q.tasks.length, 2);
});

test('parse: problems - a list that is not N+1..M, no tasks, N above M', () => {
  assert.ok(parseQueue(queue(2, 5, { left: ['3. a', '5. c'] })).problems.some((p) => p.includes('3, 4, 5')));
  assert.ok(parseQueue(queue(2, 5, { tasks: [] })).problems.some((p) => p.includes('no tasks')));
  assert.strictEqual(parseQueue('Plan: p.md\nSession 4 of 3\n'), null);
  assert.strictEqual(parseQueue('Plan: p.md\nSession 0 of 3\n'), null);
});

// Comparing two queues

const check = (before, after, { missing = [], change = {}, decision = false } = {}) =>
  checkPlan({
    before: before && parseQueue(before),
    after: after && parseQueue(after),
    exists: (p) => !missing.includes(p),
    changeOf: (p) => change[p] || null,
    decision,
  }).map((f) => f.kind);

test('check: no plan on either side, a first plan, and an unchanged queue pass', () => {
  assert.deepStrictEqual(check('# Next\n', '# Next\n- [ ] x\n'), []);
  assert.deepStrictEqual(check(null, queue(1, 3), { change: { 'docs/plan.md': 'A' } }), []);
  assert.deepStrictEqual(check(queue(2, 5), queue(2, 5)), []);
  assert.deepStrictEqual(check(queue(2, 5), queue(2, 5, { tasks: ['- [x] a task', '- [ ] one more'] })), []);
});

test('check: the queue points at a plan that does not exist, with or without Decision', () => {
  assert.deepStrictEqual(check(null, queue(1, 3), { missing: ['docs/plan.md'] }), ['planMissing']);
  assert.deepStrictEqual(check(queue(1, 3), queue(1, 3), { missing: ['docs/plan.md'], decision: true }), ['planMissing']);
});

test('check: N goes up by one and the top line drops - passes', () => {
  assert.deepStrictEqual(check(queue(2, 5), queue(3, 5)), []);
  assert.deepStrictEqual(check(queue(4, 5), queue(5, 5)), []);
});

test('check: N jumps by more than one, or goes down - blocked even with Decision', () => {
  assert.deepStrictEqual(check(queue(2, 5), queue(4, 5)), ['planJump']);
  assert.deepStrictEqual(check(queue(2, 5), queue(4, 5), { decision: true }), ['planJump']);
  assert.deepStrictEqual(check(queue(3, 5), queue(2, 5)), ['planBack']);
  assert.deepStrictEqual(check(queue(3, 5), queue(2, 5), { decision: true }), ['planBack']);
});

test('check: the list of sessions left changed another way - blocked without Decision', () => {
  const dropped = queue(2, 5, { left: ['3. Session 3', '5. Session 5'] });
  const renamed = queue(2, 5, { left: ['3. Session 3', '4. Something else', '5. Session 5'] });
  const keptTop = ['# Next', '', 'Plan: docs/plan.md', 'Session 3 of 5: Session 3', '', '- [ ] t', '', 'Sessions left:', '3. Session 3', '4. Session 4', '5. Session 5', ''].join('\n');
  const added = queue(2, 6, { left: ['3. Session 3', '4. Session 4', '5. Session 5', '6. One more'] });
  for (const after of [dropped, renamed, keptTop, added]) {
    assert.deepStrictEqual(check(queue(2, 5), after), ['planList']);
    assert.deepStrictEqual(check(queue(2, 5), after, { decision: true }), []);
  }
  // Spaces do not count.
  assert.deepStrictEqual(check(queue(2, 5), queue(2, 5, { left: ['3.  Session 3 ', '4. Session 4', '5. Session 5'] })), []);
});

test('check: the plan file changed - blocked without Decision', () => {
  assert.deepStrictEqual(check(queue(2, 5), queue(2, 5), { change: { 'docs/plan.md': 'M' } }), ['planEdited']);
  assert.deepStrictEqual(check(queue(2, 5), queue(2, 5), { change: { 'docs/plan.md': 'M' }, decision: true }), []);
});

test('check: the plan deleted or the reference removed before the last session ended', () => {
  const plain = '# Next\n\nThe queue is empty.\n';
  assert.deepStrictEqual(check(queue(2, 5), plain), ['planDropped']);
  assert.deepStrictEqual(check(queue(2, 5), plain, { decision: true }), []);
  assert.deepStrictEqual(check(queue(2, 5), null, { change: { 'docs/plan.md': 'D' } }), ['planDropped']);
  // Deleted while the queue still points at it: missing, whatever else is said.
  assert.deepStrictEqual(check(queue(2, 5), queue(2, 5), { missing: ['docs/plan.md'], change: { 'docs/plan.md': 'D' }, decision: true }), ['planMissing']);
  // Another plan takes its place.
  assert.deepStrictEqual(check(queue(2, 5), queue(1, 3, { planPath: 'docs/other.md' })), ['planDropped']);
  assert.deepStrictEqual(check(queue(2, 5), queue(1, 3, { planPath: 'docs/other.md' }), { decision: true }), []);
});

test('check: after the last session the plan is deleted and the queue emptied - passes', () => {
  const plain = '# Next\n\nThe queue is empty.\n';
  assert.deepStrictEqual(check(queue(5, 5), plain, { missing: ['docs/plan.md'], change: { 'docs/plan.md': 'D' } }), []);
  assert.deepStrictEqual(check(queue(5, 5), null, { change: { 'docs/plan.md': 'D' } }), []);
});

// Advancing and finishing

test('advance: the next session moves to the top, the list loses its top line, the rest stays', () => {
  const r = advanceQueue(EN);
  assert.strictEqual(r.ok, true);
  const q = parseQueue(r.text);
  assert.strictEqual(q.n, 3);
  assert.strictEqual(q.m, 5);
  assert.strictEqual(q.title, 'Quotes (in the plan: chapter 4)');
  assert.deepStrictEqual(q.tasks, []);
  assert.deepStrictEqual(q.left.map((s) => s.text), ['Reports (in the plan: chapter 5)', 'Using the product from the outside (in the plan: chapter 6)']);
  assert.ok(r.text.startsWith('# Next\n\nPlan: docs/plan.md\nSession 3 of 5: Quotes (in the plan: chapter 4)\n'), r.text);
  assert.ok(r.text.includes('Sessions left:\n4. Reports'), r.text);
  assert.deepStrictEqual(checkPlan({ before: parseQueue(EN), after: q, exists: () => true, changeOf: () => null, decision: false }), []);
});

test('advance: Hebrew, CRLF and text after the plan section are kept', () => {
  const he = HE.replace('- [ ] טופס', '- [x] טופס') + '\n## אחר כך\n\n- [ ] משימה שלא מהתוכנית\n';
  const r = advanceQueue(he.replace(/\n/g, '\r\n'));
  assert.strictEqual(r.ok, true);
  assert.ok(!/[^\r]\n/.test(r.text), 'every line ending stays CRLF');
  const q = parseQueue(r.text);
  assert.strictEqual(q.n, 3);
  assert.ok(r.text.includes('סשן 3 מתוך 5: הצעות מחיר (בתוכנית: פרק 4)'), r.text);
  assert.ok(r.text.includes('## אחר כך\r\n\r\n- [ ] משימה שלא מהתוכנית'), r.text);
});

test('advance: into the last session the list and its label go away', () => {
  const r = advanceQueue(queue(2, 3, { tasks: ['- [x] done'] }));
  assert.strictEqual(r.ok, true);
  assert.ok(!r.text.includes('Sessions left'), r.text);
  const q = parseQueue(r.text);
  assert.strictEqual(q.n, 3);
  assert.deepStrictEqual(q.left, []);
});

test('advance: refused with open tasks, with no tasks, on the last session, and on a plain queue', () => {
  assert.strictEqual(advanceQueue(HE).ok, false);
  assert.ok(advanceQueue(HE).reason.includes('טופס לקוח חדש'));
  assert.strictEqual(advanceQueue(queue(2, 5, { tasks: [] })).ok, false);
  assert.strictEqual(advanceQueue(queue(3, 3, { tasks: ['- [x] t'] })).ok, false);
  assert.strictEqual(advanceQueue('# Next\n\n- [x] x\n').ok, false);
  assert.strictEqual(advanceQueue(queue(2, 5, { tasks: ['- [x] t'], left: ['4. a', '5. b'] })).ok, false);
});

test('finish: the plan section leaves the queue; what is outside it stays', () => {
  const done = queue(3, 3, { tasks: ['- [x] t'] });
  const r = finishQueue(done, 'The queue is empty.');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.text, '# Next\n\nThe queue is empty.\n');
  const withLater = finishQueue(done + '\n## Later\n\n- [ ] other\n', 'The queue is empty.');
  assert.strictEqual(withLater.text, '# Next\n\n## Later\n\n- [ ] other\n');
  assert.strictEqual(finishQueue(queue(3, 3), 'x').ok, false); // an open task
  assert.strictEqual(finishQueue(queue(2, 3, { tasks: ['- [x] t'] }), 'x').ok, false); // not the last session
});

// The script

const withPlan = (repo, text, planText = '# The plan\n\n## Session 1\n\nBuild it.\n') => {
  repo.write('docs/plan.md', planText);
  repo.write('docs/NEXT.md', text);
  return repo;
};

test('plan.js: a project without memory exits with 1', () => {
  const r = plan(makeRepo({ installHook: false }));
  assert.strictEqual(r.status, 1);
  assert.ok(r.stdout.includes('No memory in this project'), r.stdout);
});

test('plan.js: a plain queue, and files that may be a plan', () => {
  const repo = repoWithMemory();
  let r = plan(repo);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('no plan reference'), r.stdout);
  assert.ok(!r.stdout.includes('may be a build plan'), r.stdout);
  repo.write('docs/build.md', '# Build plan\n');
  repo.write('PLAN.md', '# Plan\n');
  repo.write('docs/state/extra.md', 'x\n');
  r = plan(repo);
  assert.ok(r.stdout.includes('- docs/build.md') && r.stdout.includes('- PLAN.md'), r.stdout);
  assert.ok(!r.stdout.includes('docs/state/extra.md') && !r.stdout.includes('- docs/NEXT.md'), r.stdout);
  assert.deepStrictEqual(JSON.parse(plan(repo, ['--json']).stdout).candidates.sort(), ['PLAN.md', 'docs/build.md']);
});

test('plan.js: where the work stands, in Hebrew and with CRLF', () => {
  const repo = withPlan(repoWithMemory({ language: 'he' }), HE.replace(/\n/g, '\r\n'));
  const r = plan(repo);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('Plan: docs/plan.md'), r.stdout);
  assert.ok(r.stdout.includes('Session 2 of 5: מסך הלקוחות'), r.stdout);
  assert.ok(r.stdout.includes('1 of 2 tasks done'), r.stdout);
  assert.ok(r.stdout.includes('- [ ] טופס לקוח חדש'), r.stdout);
  assert.ok(r.stdout.includes('3. הצעות מחיר (בתוכנית: פרק 4)'), r.stdout);
  const j = JSON.parse(plan(repo, ['--json']).stdout);
  assert.strictEqual(j.n, 2);
  assert.strictEqual(j.planExists, true);
});

test('plan.js: says what the gate would block, before the commit', () => {
  const repo = withPlan(repoWithMemory(), queue(1, 3));
  assert.strictEqual(repo.commit('start from the plan').ok, true);
  assert.ok(plan(repo).stdout.includes('Nothing here would be blocked'), plan(repo).stdout);
  repo.write('docs/NEXT.md', queue(3, 3));
  assert.ok(plan(repo).stdout.includes('Session skipped'), plan(repo).stdout);
  repo.write('docs/NEXT.md', queue(1, 3));
  repo.write('docs/plan.md', '# The plan, edited\n');
  assert.ok(plan(repo).stdout.includes('The plan file changed'), plan(repo).stdout);
  repo.remove('docs/plan.md');
  assert.ok(plan(repo).stdout.includes('does not exist'), plan(repo).stdout);
});

test('plan.js --advance: rewrites the queue, and refuses while tasks are open', () => {
  const repo = withPlan(repoWithMemory(), queue(1, 3));
  let r = plan(repo, ['--advance']);
  assert.strictEqual(r.status, 1);
  assert.ok(r.stdout.includes('a task'), r.stdout);
  assert.strictEqual(parseQueue(repo.read('docs/NEXT.md')).n, 1);
  repo.write('docs/NEXT.md', queue(1, 3, { tasks: ['- [x] a task'] }));
  r = plan(repo, ['--advance']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes('Session 2 of 3'), r.stdout);
  assert.strictEqual(parseQueue(repo.read('docs/NEXT.md')).n, 2);
});

test('plan.js --finish: deletes the plan and empties the queue, in the project language', () => {
  for (const [language, empty] of [['he', 'התור ריק.'], ['en', 'The queue is empty.']]) {
    const repo = withPlan(repoWithMemory({ language }), queue(3, 3));
    assert.strictEqual(repo.commit('the last session').ok, true);
    let r = plan(repo, ['--finish']);
    assert.strictEqual(r.status, 1, 'an open task');
    assert.ok(fs.existsSync(path.join(repo.dir, 'docs', 'plan.md')));
    repo.write('docs/NEXT.md', queue(3, 3, { tasks: ['- [x] a task'] }));
    r = plan(repo, ['--finish']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(path.join(repo.dir, 'docs', 'plan.md')));
    assert.strictEqual(repo.read('docs/NEXT.md'), `# Next\n\n${empty}\n`);
  }
});

test('plan.js --finish: refuses to delete a plan that git does not remember', () => {
  const repo = withPlan(repoWithMemory(), queue(3, 3, { tasks: ['- [x] a task'] }));
  let r = plan(repo, ['--finish']); // never committed
  assert.strictEqual(r.status, 1);
  assert.ok(r.stdout.includes('not committed'), r.stdout);
  assert.ok(fs.existsSync(path.join(repo.dir, 'docs', 'plan.md')));
  assert.strictEqual(repo.commit('the plan').ok, true);
  repo.write('docs/plan.md', '# Edited and not committed\n');
  r = plan(repo, ['--finish']);
  assert.strictEqual(r.status, 1);
  assert.ok(fs.existsSync(path.join(repo.dir, 'docs', 'plan.md')));
});
