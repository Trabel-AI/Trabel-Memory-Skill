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

test('everything committed: silent for every source', () => {
  const repo = repoWithMemory();
  for (const source of SOURCES) assert.strictEqual(sessionStart(repo, source), '', source);
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
  }
});

test('the hook and the linker are repaired on every opening, compact included', () => {
  const repo = repoWithMemory();
  const hook = path.join(repo.dir, '.git', 'hooks', 'commit-msg');
  const linker = path.join(repo.dataDir, 'gate-link.js');
  for (const source of SOURCES) {
    fs.rmSync(hook);
    fs.writeFileSync(linker, '// an old plugin folder\n');
    assert.strictEqual(sessionStart(repo, source), '', source);
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
