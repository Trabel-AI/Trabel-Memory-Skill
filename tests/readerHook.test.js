'use strict';

// The reader's answer reaches the record only through the SubagentStop hook,
// run the way Claude Code runs it: JSON on stdin, the data folder from --data.
// reader.js --missing and --report read nothing else.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeRepo, repoWithMemory, card, cleanup, run, PLUGIN } = require('./helpers');

test.after(cleanup);

const HOOK = path.join(PLUGIN, 'scripts', 'reader-hook.js');
const READER = path.join(PLUGIN, 'scripts', 'reader.js');
const AGENT = 'trabel-memory:reader';

function hook(repo, event, { cwd = repo.dir, data = repo.dataDir, input } = {}) {
  const r = run(cwd, process.execPath, [HOOK, '--data', data], { input: input != null ? input : JSON.stringify({ hook_event_name: 'SubagentStop', cwd, ...event }) });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(r.stderr, '');
}

function reader(repo, args = [], input = '') {
  return run(repo.dir, process.execPath, [READER, ...args, '--data', repo.dataDir], { input }).stdout.trim();
}

// Every file under a folder, with its content.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

const ids = (text) => [...text.matchAll(/^\[(F\d+\.L\d+)\] (.*)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
const answer = (verdicts) => JSON.stringify({ results: verdicts.map(([id, pass]) => (pass ? { id, past: '', pass } : { id, past: 'no longer', pass, reason: 'diff', missing: 'x' })) });

function customers(lines) {
  return card({ name: 'Customers', summary: 'The customer list', owns: ['src/customers/**'] }) + `# Customers\n\n${lines.join('\n\n')}\n`;
}

test('reader hook: another subagent - exits at once, writes and prints nothing', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/customers.md', customers(['The list shows active customers.']));
  const before = snapshot(repo.dataDir);
  hook(repo, { agent_type: 'Explore', last_assistant_message: answer([['F1.L9', true]]) });
  assert.deepStrictEqual(snapshot(repo.dataDir), before);

  const input = reader(repo);
  const opened = snapshot(repo.dataDir);
  hook(repo, { agent_type: 'general-purpose', last_assistant_message: answer(ids(input).map((l) => [l.id, true])) });
  assert.deepStrictEqual(snapshot(repo.dataDir), opened);
  assert.strictEqual(reader(repo, ['--report']), 'New-reader test: the test did not run.');
});

test('reader hook: a project without memory - writes and prints nothing', () => {
  const repo = makeRepo();
  const data = path.join(path.dirname(repo.dir), 'plugin data');
  const before = snapshot(data);
  hook(repo, { agent_type: AGENT, last_assistant_message: answer([['F1.L9', true]]) }, { data });
  assert.deepStrictEqual(snapshot(data), before);
  assert.strictEqual(run(repo.dir, 'git', ['status', '--porcelain']).stdout, '');
});

test('reader hook: the real case - the answer is kept in the data folder, never in the project', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/customers.md', customers(['The list shows active customers.', 'Emails are stored lower-case.']));
  const status = run(repo.dir, 'git', ['status', '--porcelain']).stdout;
  const input = reader(repo);
  const lines = ids(input);
  assert.strictEqual(lines.length, 2, input);

  // The reader skipped the second line: --missing sends it again, from the captured answer.
  hook(repo, { agent_type: AGENT, last_assistant_message: '```json\n' + answer([[lines[0].id, true]]) + '\n```' }, { cwd: path.join(repo.dir, 'src') });
  assert.deepStrictEqual(ids(reader(repo, ['--missing'])).map((l) => l.id), [lines[1].id]);
  hook(repo, { agent_type: AGENT, last_assistant_message: answer([[lines[1].id, true]]) });
  assert.strictEqual(reader(repo, ['--missing']), 'Every line has an answer.');
  assert.strictEqual(reader(repo, ['--report']), 'New-reader test: 2 lines, 2 passed.');

  assert.strictEqual(run(repo.dir, 'git', ['status', '--porcelain']).stdout, status);
  assert.ok(Object.keys(snapshot(repo.dataDir)).some((f) => f.startsWith('reader')), 'kept under the data folder');
});

test('reader: an answer typed in by hand does not count, only a captured one', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/customers.md', customers(['The list shows active customers.']));
  const lines = ids(reader(repo));
  const madeUp = answer(lines.map((l) => [l.id, true]));

  // The failure seen in practice: Claude builds an all-pass answer and pipes it in.
  assert.deepStrictEqual(ids(reader(repo, ['--missing'], madeUp)).map((l) => l.id), lines.map((l) => l.id));
  assert.strictEqual(reader(repo, ['--report'], madeUp), 'New-reader test: the test did not run.');

  hook(repo, { agent_type: AGENT, last_assistant_message: madeUp });
  assert.strictEqual(reader(repo, ['--report']), 'New-reader test: 1 lines, 1 passed.');
});

test('reader --report: lines rewritten after a failure, and lines changed after the last round', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/customers.md', customers(['The list shows active customers.', 'Emails are no longer stored upper-case.']));
  let lines = ids(reader(repo));
  hook(repo, { agent_type: AGENT, last_assistant_message: answer([[lines[0].id, true], [lines[1].id, false]]) });
  assert.strictEqual(reader(repo, ['--report']),
    'New-reader test: 2 lines, 1 passed.\nDid not pass: 1.\n- docs/state/customers.md, line ' + lines[1].id.split('.L')[1] + ': Emails are no longer stored upper-case.');

  repo.write('docs/state/customers.md', customers(['The list shows active customers.', 'Emails are stored lower-case.']));
  lines = ids(reader(repo));
  hook(repo, { agent_type: AGENT, last_assistant_message: answer(lines.map((l) => [l.id, true])) });
  assert.strictEqual(reader(repo, ['--report']), 'New-reader test: 2 lines, 2 passed, 1 rewritten.');

  // Written after the last round: not checked, and said so.
  repo.write('docs/state/customers.md', customers(['The list shows active customers.', 'Emails are stored lower-case, trimmed.']));
  assert.strictEqual(reader(repo, ['--report']),
    'New-reader test: 2 lines, 1 passed, 1 rewritten.\nNot checked: 1.\n- docs/state/customers.md, line ' + lines[1].id.split('.L')[1] + ': Emails are stored lower-case, trimmed.');
});

test('reader --report: nothing changed, a commit starts a new record, and Hebrew', () => {
  const repo = repoWithMemory({ language: 'he' });
  assert.strictEqual(reader(repo, ['--report']), 'מבחן הקורא לא נדרש: לא השתנו שורות בקבצי המצב.');
  repo.write('docs/state/customers.md', customers(['הרשימה מציגה לקוחות פעילים.']));
  const lines = ids(reader(repo));
  hook(repo, { agent_type: AGENT, last_assistant_message: answer(lines.map((l) => [l.id, true])) });
  assert.strictEqual(reader(repo, ['--report']), 'מבחן הקורא: 1 שורות, עברו 1.');
  assert.ok(repo.commit('customers', ['--no-verify']).ok);
  repo.write('docs/state/customers.md', customers(['הרשימה מציגה לקוחות פעילים, לפי שם.']));
  assert.strictEqual(reader(repo, ['--report']), 'מבחן הקורא: המבחן לא רץ.');
  assert.match(reader(repo, ['--missing']), /^No round of the new-reader test is open/);
});

test('reader hook: input it cannot read - quiet, nothing kept', () => {
  const repo = repoWithMemory();
  const before = snapshot(repo.dataDir);
  hook(repo, {}, { input: 'not json' });
  hook(repo, {}, { input: JSON.stringify({ agent_type: AGENT, cwd: repo.dir }) });
  assert.deepStrictEqual(snapshot(repo.dataDir), before);
});
