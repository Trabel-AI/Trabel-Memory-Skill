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

// A new session (startup, clear) always gets the one line about continuing
// from the plan.
const NEW_SESSION = ['startup', 'clear'];
const CONTINUE_LINE = 'trabel-memory: If the user asks to go on from the plan or the queue ("continue from the plan", "המשך על פי תוכנית", or the like), run the skill trabel-memory:continue before anything else. A bare "continue" or "המשך" does not run it: it means go on with the work that was interrupted.\n';
const quiet = (source) => (NEW_SESSION.includes(source) ? CONTINUE_LINE : '');

// The tests never read the Claude Code folder of the machine they run on: a
// test that does not bring its own gets an empty one.
const NO_CONFIG = tempDir('trabel-no-config-');

function sessionStart(repo, source, { data = repo.dataDir, env = process.env, stdin, config } = {}) {
  const input = stdin != null ? stdin : JSON.stringify({ session_id: 'abc', hook_event_name: 'SessionStart', cwd: repo.dir, source });
  const args = data ? [SCRIPT, '--data', data] : [SCRIPT];
  const full = { ...env };
  if (config || full.CLAUDE_CONFIG_DIR === process.env.CLAUDE_CONFIG_DIR) full.CLAUDE_CONFIG_DIR = config || NO_CONFIG;
  const r = run(repo.dir, process.execPath, args, { input, env: full });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout;
}

// A Claude Code folder in which this copy of the plugin is the installed one,
// from the marketplace "trabel".
function configDir({ installPath = PLUGIN, settings, known, installed } = {}) {
  const dir = tempDir('trabel-config-');
  fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
  const source = { source: 'github', repo: 'someone/some-repo' };
  const write = (file, value) => fs.writeFileSync(path.join(dir, file), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  write('plugins/installed_plugins.json', installed || { version: 2, plugins: { 'trabel-memory@trabel': [{ scope: 'user', installPath, version: 'abc123' }] } });
  write('plugins/known_marketplaces.json', known || { trabel: { source, installLocation: path.join(dir, 'plugins', 'marketplaces', 'trabel') } });
  write('settings.json', settings || { extraKnownMarketplaces: { trabel: { source } } });
  return dir;
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

test('everything committed: only the line about continuing from the plan, and only on a new session', () => {
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

// --- automatic updates, turned on once per machine ---

const TURNED_ON = 'turned automatic updates on for its marketplace "trabel"';
const BY_HAND = 'this plugin does not update by itself on this machine';
const readSettings = (config) => JSON.parse(fs.readFileSync(path.join(config, 'settings.json'), 'utf8'));

test('an installed copy with automatic updates off: turned on in settings.json, said once, in any folder', () => {
  const config = configDir();
  const before = fs.readFileSync(path.join(config, 'settings.json'), 'utf8');
  const repo = makeRepo({ installHook: false }); // no memory here
  const first = sessionStart(repo, 'startup', { config });
  assert.ok(first.includes(TURNED_ON), first);
  assert.ok(first.includes(path.join(config, 'settings.json').replace(/\\/g, '/')), first);
  assert.ok(first.includes('how to turn it off'), first);
  assert.ok(!first.includes(BY_HAND), first);

  const settings = readSettings(config);
  assert.strictEqual(settings.extraKnownMarketplaces.trabel.autoUpdate, true);
  assert.deepStrictEqual(settings.extraKnownMarketplaces.trabel.source, { source: 'github', repo: 'someone/some-repo' });
  assert.strictEqual(fs.readFileSync(path.join(repo.dataDir, 'settings.json.before-auto-update'), 'utf8'), before);
  assert.ok(fs.existsSync(path.join(repo.dataDir, 'auto-update-set')));

  assert.strictEqual(sessionStart(repo, 'startup', { config }), '');

  const withMemory = repoWithMemory();
  assert.strictEqual(sessionStart(withMemory, 'startup', { config, data: repo.dataDir }), CONTINUE_LINE);
});

test('the rest of settings.json survives, and a missing entry is built from known_marketplaces.json', () => {
  const settings = { model: 'opus', permissions: { allow: ['Bash(ls)'] }, extraKnownMarketplaces: { other: { source: { source: 'github', repo: 'x/y' } } } };
  const config = configDir({ settings });
  const repo = makeRepo({ installHook: false });
  assert.ok(sessionStart(repo, 'startup', { config }).includes(TURNED_ON));
  const after = readSettings(config);
  assert.strictEqual(after.model, 'opus');
  assert.deepStrictEqual(after.permissions, { allow: ['Bash(ls)'] });
  assert.deepStrictEqual(after.extraKnownMarketplaces.other, { source: { source: 'github', repo: 'x/y' } });
  assert.deepStrictEqual(after.extraKnownMarketplaces.trabel, { source: { source: 'github', repo: 'someone/some-repo' }, autoUpdate: true });
});

test('no settings.json at all: it is created, and the backup is empty', () => {
  const config = configDir();
  fs.rmSync(path.join(config, 'settings.json'));
  const repo = makeRepo({ installHook: false });
  assert.ok(sessionStart(repo, 'startup', { config }).includes(TURNED_ON));
  assert.deepStrictEqual(readSettings(config), { extraKnownMarketplaces: { trabel: { source: { source: 'github', repo: 'someone/some-repo' }, autoUpdate: true } } });
  assert.strictEqual(fs.readFileSync(path.join(repo.dataDir, 'settings.json.before-auto-update'), 'utf8'), '');
});

test('settings.json that is not JSON, or a source known nowhere: nothing is written, the way by hand is said once', () => {
  const broken = configDir({ settings: '{ not json' });
  const repo = makeRepo({ installHook: false });
  const first = sessionStart(repo, 'startup', { config: broken });
  assert.ok(first.includes(BY_HAND), first);
  assert.ok(first.includes('claude plugin marketplace update trabel'), first);
  assert.ok(first.includes('claude plugin update trabel-memory@trabel'), first);
  assert.ok(first.includes('"autoUpdate": true'), first);
  assert.strictEqual(fs.readFileSync(path.join(broken, 'settings.json'), 'utf8'), '{ not json');
  assert.strictEqual(sessionStart(repo, 'startup', { config: broken }), '');

  const noSource = configDir({ settings: {}, known: '[]' });
  const repo2 = makeRepo({ installHook: false });
  assert.ok(sessionStart(repo2, 'startup', { config: noSource }).includes(BY_HAND));
  assert.strictEqual(fs.readFileSync(path.join(noSource, 'settings.json'), 'utf8'), '{}');
});

test('the note about updates comes after the rest, in a project with memory', () => {
  const repo = repoWithMemory();
  const out = sessionStart(repo, 'clear', { config: configDir() });
  assert.ok(out.startsWith(CONTINUE_LINE.trimEnd()), out);
  assert.ok(out.includes(TURNED_ON), out);
});

test('turning updates on waits for a new session', () => {
  const config = configDir();
  const repo = makeRepo({ installHook: false });
  for (const source of ['resume', 'compact', 'fork']) {
    assert.strictEqual(sessionStart(repo, source, { config }), '', source);
    assert.strictEqual(readSettings(config).extraKnownMarketplaces.trabel.autoUpdate, undefined, source);
  }
  assert.ok(sessionStart(repo, 'startup', { config }).includes(TURNED_ON));
});

test('automatic updates already on, in either file: nothing written, nothing said, and the machine is done', () => {
  const source = { source: 'github', repo: 'someone/some-repo' };
  const inSettings = configDir({ settings: { extraKnownMarketplaces: { trabel: { source, autoUpdate: true } } } });
  const inKnown = configDir({ known: { trabel: { source, autoUpdate: true } } });
  const knownBefore = fs.readFileSync(path.join(inKnown, 'settings.json'), 'utf8');
  const repo = makeRepo({ installHook: false });
  assert.strictEqual(sessionStart(repo, 'startup', { config: inSettings }), '');
  assert.ok(fs.existsSync(path.join(repo.dataDir, 'auto-update-set')));
  const repo2 = makeRepo({ installHook: false });
  assert.strictEqual(sessionStart(repo2, 'startup', { config: inKnown }), '');
  assert.strictEqual(fs.readFileSync(path.join(inKnown, 'settings.json'), 'utf8'), knownBefore);
});

test('a person who turns automatic updates off afterwards stays off', () => {
  const config = configDir();
  const repo = makeRepo({ installHook: false });
  assert.ok(sessionStart(repo, 'startup', { config }).includes(TURNED_ON));
  const settings = readSettings(config);
  delete settings.extraKnownMarketplaces.trabel.autoUpdate;
  fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify(settings, null, 2));
  assert.strictEqual(sessionStart(repo, 'startup', { config }), '');
  assert.strictEqual(readSettings(config).extraKnownMarketplaces.trabel.autoUpdate, undefined);
});

test('a copy that is not the installed one (--plugin-dir): nothing', () => {
  const repo = makeRepo({ installHook: false });
  const config = configDir({ installPath: path.join(tempDir('trabel-cache-'), 'trabel-memory', 'abc123') });
  assert.strictEqual(sessionStart(repo, 'startup', { config }), '');
  assert.strictEqual(readSettings(config).extraKnownMarketplaces.trabel.autoUpdate, undefined);
});

test('Claude Code files that cannot be read, or no data folder: nothing, and the session goes on', () => {
  const repo = makeRepo({ installHook: false });
  assert.strictEqual(sessionStart(repo, 'startup', { config: configDir({ installed: '{ not json' }) }), '');
  assert.strictEqual(sessionStart(repo, 'startup', { config: configDir({ installed: { version: 2 } }) }), '');

  const env = { ...process.env };
  delete env.CLAUDE_PLUGIN_DATA;
  const config = configDir();
  assert.strictEqual(sessionStart(repo, 'startup', { config, data: null, env }), '');
  assert.strictEqual(readSettings(config).extraKnownMarketplaces.trabel.autoUpdate, undefined);
});
