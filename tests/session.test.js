'use strict';

// The session-start check, run the way Claude Code runs it: JSON on stdin,
// the data folder from --data, and whatever it prints goes to Claude.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeRepo, repoWithMemory, cleanup, tempDir, run, PLUGIN } = require('./helpers');

test.after(cleanup);

const SOURCES = ['startup', 'resume', 'clear', 'compact', 'fork'];
const SCRIPT = path.join(PLUGIN, 'scripts', 'session-start.js');

// A new session (startup, clear) always gets the one line about "continue".
const NEW_SESSION = ['startup', 'clear'];
const CONTINUE_LINE = 'trabel-memory: If the user\'s first message only asks to go on ("continue", "המשך", or the like), run the skill trabel-memory:continue before anything else.\n';
const quiet = (source) => (NEW_SESSION.includes(source) ? CONTINUE_LINE : '');

function sessionStart(repo, source, { data = repo.dataDir, env = process.env, stdin } = {}) {
  const input = stdin != null ? stdin : JSON.stringify({ session_id: 'abc', hook_event_name: 'SessionStart', cwd: repo.dir, source });
  const args = data ? [SCRIPT, '--data', data] : [SCRIPT];
  const r = run(repo.dir, process.execPath, args, { input, env });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout;
}

test('a project without memory: silent for every source', () => {
  const repo = makeRepo({ installHook: false });
  repo.write('src/app.js', 'x\n');
  for (const source of SOURCES) assert.strictEqual(sessionStart(repo, source), '', source);
  assert.ok(!fs.existsSync(path.join(repo.dir, '.git', 'hooks', 'commit-msg')));
});

test('a folder outside git: silent', () => {
  const dir = tempDir('trabel-no-git-');
  const r = run(dir, process.execPath, [SCRIPT], {
    input: JSON.stringify({ cwd: dir, source: 'startup' }),
    env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) },
  });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

test('everything committed: only the line about "continue", and only on a new session', () => {
  const repo = repoWithMemory();
  for (const source of SOURCES) assert.strictEqual(sessionStart(repo, source), quiet(source), source);
});

test('a project that works from a plan: the line says where the work stands', () => {
  const repo = repoWithMemory({ language: 'he' });
  repo.write('docs/plan.md', '# התוכנית\n');
  repo.write('docs/NEXT.md', '# התור\r\n\r\nהתוכנית: docs/plan.md\r\nסשן 2 מתוך 5: מסך הלקוחות\r\n\r\n- [ ] טופס\r\n\r\nהסשנים הבאים:\r\n3. א\r\n4. ב\r\n5. ג\r\n');
  assert.strictEqual(repo.commit('לפי התוכנית').ok, true);
  for (const source of SOURCES) {
    const out = sessionStart(repo, source);
    if (!NEW_SESSION.includes(source)) {
      assert.strictEqual(out, '', source);
      continue;
    }
    assert.ok(out.includes('This project works from a build plan: docs/plan.md, session 2 of 5.'), out);
    assert.ok(out.includes('run the skill trabel-memory:continue'), out);
    assert.ok(!out.includes('Problems in the queue'), out);
  }
});

test('a queue whose plan section is out of shape, or whose plan file is gone: said on a new session', () => {
  const repo = repoWithMemory();
  repo.write('docs/NEXT.md', ['# Next', '', 'Plan: docs/plan.md', 'Session 2 of 5: Forms', '', 'Sessions left:', '3. a', '5. c', ''].join('\n'));
  const out = sessionStart(repo, 'startup');
  assert.ok(out.includes('The plan file docs/plan.md does not exist.'), out);
  assert.ok(out.includes('Problems in the queue:'), out);
  assert.ok(out.includes('must hold sessions 3, 4, 5') && out.includes('has no tasks'), out);
});

test('unsaved work: reported with owners and the queue, except on compact', () => {
  const repo = repoWithMemory();
  repo.write('src/customers/list.js', 'module.exports = [1];\n');
  repo.write('src/orders/new.js', 'x\n');
  repo.write('docs/NEXT.md', '# Next\n\n- [x] step 1\n- [ ] step 2: the print page\n');
  for (const source of SOURCES) {
    const out = sessionStart(repo, source);
    if (source === 'compact') {
      assert.strictEqual(out, '', source);
      continue;
    }
    assert.ok(out.includes('the previous session stopped before saving'), source + ':\n' + out);
    assert.ok(out.includes('- src/customers/list.js (modified; docs: docs/state/customers.md)'), out);
    assert.ok(out.includes('- src/orders/new.js (new; docs: no owner yet)'), out);
    assert.ok(out.includes('- docs/NEXT.md (modified)'), out);
    assert.ok(out.includes('- [ ] step 2: the print page'), out);
    assert.ok(out.includes('Open your first reply with a short report'), out);
    assert.strictEqual(out.includes('run the skill trabel-memory:continue'), NEW_SESSION.includes(source), source);
  }
});

test('the hook and the linker are repaired on every opening, compact included', () => {
  const repo = repoWithMemory();
  const hook = path.join(repo.dir, '.git', 'hooks', 'commit-msg');
  const linker = path.join(repo.dataDir, 'gate-link.js');
  for (const source of SOURCES) {
    fs.rmSync(hook);
    fs.writeFileSync(linker, '// an old plugin folder\n');
    assert.strictEqual(sessionStart(repo, source), quiet(source), source);
    assert.ok(fs.readFileSync(hook, 'utf8').includes('trabel-memory: the documentation gate'), source);
    assert.ok(fs.readFileSync(linker, 'utf8').includes(path.join(PLUGIN, 'scripts', 'gate.js').replace(/\\/g, '/')), source);
  }
  repo.write('src/customers/list.js', 'module.exports = [1];\n');
  assert.strictEqual(repo.commit('change').ok, false); // the gate works again
});

test('the data folder comes from CLAUDE_PLUGIN_DATA when --data is missing', () => {
  const repo = repoWithMemory();
  const other = path.join(repo.base, 'env data');
  sessionStart(repo, 'startup', { data: null, env: { ...process.env, CLAUDE_PLUGIN_DATA: other } });
  assert.ok(fs.existsSync(path.join(other, 'gate-link.js')));
});

test('a data folder that cannot be found is reported, and the rest still runs', () => {
  const repo = repoWithMemory();
  repo.write('src/customers/list.js', 'module.exports = [1];\n');
  const env = { ...process.env, CLAUDE_CONFIG_DIR: tempDir('trabel-config-') };
  delete env.CLAUDE_PLUGIN_DATA;
  const out = sessionStart(repo, 'startup', { data: null, env });
  assert.ok(out.includes('the documentation gate could not be checked'), out);
  assert.ok(out.includes('the previous session stopped before saving'), out);
});

test('a gate that is not active because another tool manages the hooks is reported', () => {
  const repo = repoWithMemory({ installHook: false });
  repo.git('config', 'core.hooksPath', 'githooks');
  for (const source of SOURCES) {
    const out = sessionStart(repo, source);
    assert.ok(out.includes('the documentation gate is NOT active'), source + ':\n' + out);
    assert.ok(out.includes('Another tool manages the git hooks'), out);
  }
});

test('a session opened in a subfolder finds the memory at the repository root', () => {
  const repo = repoWithMemory();
  repo.write('src/customers/list.js', 'module.exports = [1];\n');
  const out = sessionStart(repo, 'startup', {
    stdin: JSON.stringify({ cwd: path.join(repo.dir, 'src', 'customers'), source: 'startup' }),
  });
  assert.ok(out.includes('src/customers/list.js'), out);
});

test('broken settings.json: one line of context, and the session goes on', () => {
  const repo = repoWithMemory();
  repo.write('docs/state/settings.json', '{ not json');
  const out = sessionStart(repo, 'startup');
  assert.ok(out.includes('settings.json could not be read'), out);
});
