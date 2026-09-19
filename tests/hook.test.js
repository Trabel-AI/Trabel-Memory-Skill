'use strict';

// The git hook, the linker and the installer. Every commit here goes through
// the real sh hook that the installer writes.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeRepo, repoWithMemory, cleanup, copyPlugin, tempDir, run, PLUGIN } = require('./helpers');
const { install, findDataDir, BLOCKED: HOOK_BLOCKED, SAVED } = require('../scripts/lib/hook');
const { BLOCKED } = require('../scripts/gate');

test.after(cleanup);

const blocked = (r, text) => {
  assert.strictEqual(r.ok, false, 'expected the commit to be blocked:\n' + r.output);
  if (text) assert.ok(r.output.includes(text), `expected "${text}" in:\n${r.output}`);
};
const passed = (r) => assert.strictEqual(r.ok, true, 'expected the commit to pass:\n' + r.output);
const outputLines = (r) => r.output.split(/\r?\n/).filter((l) => l.trim());
const hookFile = (repo) => path.join(repo.dir, '.git', 'hooks', 'commit-msg');

// Only the blocked code blocks

test('the gate and the hook agree on the blocked code, and it is not 1', () => {
  assert.strictEqual(BLOCKED, HOOK_BLOCKED);
  assert.notStrictEqual(BLOCKED, 1);
});

test('a block goes through the hook: the commit is refused with the gate message', () => {
  const repo = repoWithMemory();
  repo.write('src/customers/list.js', 'module.exports = [1];\n');
  blocked(repo.commit('change'), 'Code without docs: src/customers/list.js');
});

test('a broken helper file lets the commit through with one warning line', () => {
  const plugin = copyPlugin();
  const repo = repoWithMemory({ pluginRoot: plugin });
  fs.writeFileSync(path.join(plugin, 'scripts', 'lib', 'glob.js'), 'module.exports = {{{ broken\n');
  repo.write('src/customers/list.js', 'module.exports = [1];\n'); // would be blocked
  const r = repo.commit('change');
  passed(r);
  assert.strictEqual(outputLines(r).length, 1, r.output);
  assert.ok(r.output.includes('trabel-memory'), r.output);
});

test('a missing helper file lets the commit through with one warning line', () => {
  const plugin = copyPlugin();
  const repo = repoWithMemory({ pluginRoot: plugin });
  fs.rmSync(path.join(plugin, 'scripts', 'lib', 'owners.js'));
  repo.write('src/customers/list.js', 'module.exports = [1];\n');
  const r = repo.commit('change');
  passed(r);
  assert.strictEqual(outputLines(r).length, 1, r.output);
});

test('a broken gate script (exit code 1 from Node) lets the commit through with one warning line', () => {
  const plugin = copyPlugin();
  const repo = repoWithMemory({ pluginRoot: plugin });
  fs.writeFileSync(path.join(plugin, 'scripts', 'gate.js'), 'this is not javascript (\n');
  repo.write('src/customers/list.js', 'module.exports = [1];\n');
  const r = repo.commit('change');
  passed(r);
  assert.deepStrictEqual(outputLines(r), ['trabel-memory: the gate failed (exit code 1), so the commit goes through.']);
});

test('a plugin folder that is gone (an old version deleted) lets the commit through with one warning line', () => {
  const plugin = copyPlugin();
  const repo = repoWithMemory({ pluginRoot: plugin });
  fs.rmSync(path.join(plugin, 'scripts'), { recursive: true, force: true });
  repo.write('src/customers/list.js', 'module.exports = [1];\n');
  const r = repo.commit('change');
  passed(r);
  assert.strictEqual(outputLines(r).length, 1, r.output);
  assert.ok(r.output.includes('the plugin was not found'), r.output);
});

test('a missing linker lets the commit through with one warning line', () => {
  const repo = repoWithMemory();
  fs.rmSync(path.join(repo.dataDir, 'gate-link.js'));
  repo.write('src/customers/list.js', 'module.exports = [1];\n');
  const r = repo.commit('change');
  passed(r);
  assert.strictEqual(outputLines(r).length, 1, r.output);
  assert.ok(r.output.includes("the gate's link file is missing"), r.output);
});

const which = (cmd) =>
  run(process.cwd(), process.platform === 'win32' ? 'where' : 'which', [cmd]).stdout.split(/\r?\n/)[0].trim();

// A PATH with only the folder that holds sh, which git needs to run the hook.
// On Windows that is Git's own usr/bin. Null when node sits in that folder.
function pathWithoutNode() {
  let shDir = null;
  if (process.platform === 'win32') {
    for (let dir = path.dirname(which('git')); dir !== path.dirname(dir); dir = path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, 'usr', 'bin', 'sh.exe'))) {
        shDir = path.join(dir, 'usr', 'bin');
        break;
      }
    }
  } else {
    shDir = path.dirname(which('sh'));
  }
  const hasNode = !shDir || ['node', 'node.exe'].some((n) => fs.existsSync(path.join(shDir, n)));
  return hasNode ? null : shDir;
}

test('Node missing: the commit goes through with one warning line', (t) => {
  const shDir = pathWithoutNode();
  if (!shDir) return t.skip('node is in the same folder as sh on this machine');
  const repo = repoWithMemory();
  repo.write('src/customers/list.js', 'module.exports = [1];\n');
  repo.git('add', '-A');
  const env = { ...process.env, PATH: shDir };
  delete env.Path; // Windows keeps PATH under this name too
  const gitBinary = () => which('git');
  const r = run(repo.dir, gitBinary(), ['commit', '-q', '-m', 'change'], { env });
  const output = (r.stdout || '') + (r.stderr || '');
  assert.strictEqual(r.status, 0, output);
  assert.deepStrictEqual(output.split(/\r?\n/).filter((l) => l.trim()), [
    'trabel-memory: Node was not found, so the docs gate did not run. The commit goes through.',
  ]);
});

test('warn mode prints the report and the commit goes through', () => {
  const repo = repoWithMemory({ gate: 'warn' });
  repo.write('src/customers/list.js', 'module.exports = [1];\n');
  const r = repo.commit('change');
  passed(r);
  assert.ok(r.output.includes('Warning (trabel-memory)'), r.output);
});

// The installer

test('installing twice changes nothing the second time', () => {
  const repo = repoWithMemory();
  const before = fs.readFileSync(hookFile(repo), 'utf8');
  const r = install({ root: repo.dir, pluginRoot: PLUGIN, dataDir: repo.dataDir });
  assert.strictEqual(r.status, 'unchanged');
  assert.strictEqual(fs.readFileSync(hookFile(repo), 'utf8'), before);
});

test('an existing commit-msg hook is kept and runs first', () => {
  const repo = makeRepo({ installHook: false });
  const hooks = path.join(repo.dir, '.git', 'hooks');
  fs.writeFileSync(path.join(hooks, 'commit-msg'), '#!/bin/sh\nif grep -q WIP "$1"; then echo "no WIP commits" >&2; exit 1; fi\n');
  fs.chmodSync(path.join(hooks, 'commit-msg'), 0o755);
  const r = install({ root: repo.dir, pluginRoot: PLUGIN, dataDir: repo.dataDir });
  assert.strictEqual(r.status, 'installed');
  assert.ok(r.message.includes(SAVED), r.message);
  assert.ok(fs.readFileSync(path.join(hooks, SAVED), 'utf8').includes('no WIP commits'));

  repo.write('docs/state/settings.json', '{"gate":"block"}\n');
  repo.write('src/app.js', 'x\n');
  blocked(repo.commit('WIP'), 'no WIP commits'); // the old hook still works
  blocked(repo.commit('app'), 'Code without an owner: src/app.js'); // and then the gate
});

test('a hook folder managed by another tool: the line is shown, and added only with approval', () => {
  const repo = makeRepo({ installHook: false });
  const toolHooks = path.join(repo.dir, 'githooks');
  fs.mkdirSync(toolHooks);
  repo.git('config', 'core.hooksPath', 'githooks');

  const asked = install({ root: repo.dir, pluginRoot: PLUGIN, dataDir: repo.dataDir });
  assert.strictEqual(asked.status, 'tool-needs-approval');
  assert.ok(asked.message.includes(asked.line));
  assert.ok(!fs.existsSync(path.join(toolHooks, 'commit-msg')));
  assert.ok(!fs.existsSync(hookFile(repo)));

  const added = install({ root: repo.dir, pluginRoot: PLUGIN, dataDir: repo.dataDir, addToTool: true });
  assert.strictEqual(added.status, 'tool-installed');
  const again = install({ root: repo.dir, pluginRoot: PLUGIN, dataDir: repo.dataDir, addToTool: true });
  assert.strictEqual(again.status, 'unchanged');
  const text = fs.readFileSync(path.join(toolHooks, 'commit-msg'), 'utf8');
  assert.strictEqual(text.split('\n').filter((l) => l.includes('trabel-memory')).length, 1);

  repo.write('docs/state/settings.json', '{"gate":"block"}\n');
  repo.write('src/app.js', 'x\n');
  blocked(repo.commit('app'), 'Code without an owner: src/app.js');
});

test('Husky: the line goes into .husky/commit-msg, after what is already there', () => {
  const repo = makeRepo({ installHook: false });
  fs.mkdirSync(path.join(repo.dir, '.husky', '_'), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, '.husky', 'commit-msg'), 'npx --no -- commitlint --edit "$1"\n');
  repo.git('config', 'core.hooksPath', '.husky/_');
  const r = install({ root: repo.dir, pluginRoot: PLUGIN, dataDir: repo.dataDir, addToTool: true });
  assert.strictEqual(r.tool, 'Husky');
  const lines = fs.readFileSync(path.join(repo.dir, '.husky', 'commit-msg'), 'utf8').trimEnd().split('\n');
  assert.deepStrictEqual(lines, ['npx --no -- commitlint --edit "$1"', r.line]);
});

// Finding the plugin's data folder

test('data folder: a given folder wins, then CLAUDE_PLUGIN_DATA', () => {
  assert.strictEqual(findDataDir({ given: 'x', env: { CLAUDE_PLUGIN_DATA: 'y' } }).dir, path.resolve('x'));
  assert.strictEqual(findDataDir({ env: { CLAUDE_PLUGIN_DATA: 'y' } }).dir, path.resolve('y'));
});

test('data folder: without either, the one trabel-memory folder under the Claude config folder', () => {
  const config = tempDir('trabel-config-');
  const data = path.join(config, 'plugins', 'data');
  fs.mkdirSync(path.join(data, 'other-plugin'), { recursive: true });
  fs.mkdirSync(path.join(data, 'trabel-memory-trabel'));
  assert.strictEqual(findDataDir({ env: { CLAUDE_CONFIG_DIR: config } }).dir, path.join(data, 'trabel-memory-trabel'));

  fs.mkdirSync(path.join(data, 'trabel-memory-local'));
  const two = findDataDir({ env: { CLAUDE_CONFIG_DIR: config } });
  assert.ok(two.error.includes('Several data folders match'), two.error);
  assert.ok(two.error.includes('--data'), two.error);
});

test('data folder: not found gives a message that says where it looked and what to do', () => {
  const home = tempDir('trabel-home-');
  const r = findDataDir({ env: {}, home });
  assert.ok(!r.dir);
  assert.ok(r.error.includes(path.join(home, '.claude', 'plugins', 'data').replace(/\\/g, '/')), r.error);
  assert.ok(r.error.includes('--data'), r.error);
});

test('install.js: exit 1 with a clear message when the data folder is not found', () => {
  const repo = makeRepo({ installHook: false });
  const env = { ...process.env, CLAUDE_CONFIG_DIR: tempDir('trabel-config-') };
  delete env.CLAUDE_PLUGIN_DATA;
  const r = run(repo.dir, process.execPath, [path.join(PLUGIN, 'scripts', 'install.js')], { env });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("The plugin's data folder was not found"), r.stdout);
  assert.ok(!fs.existsSync(hookFile(repo)));
});

test('install.js: --data installs, and exit 2 asks before touching another tool', () => {
  const repo = makeRepo({ installHook: false });
  const script = path.join(PLUGIN, 'scripts', 'install.js');
  const ok = run(repo.dir, process.execPath, [script, '--data', repo.dataDir]);
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  assert.ok(fs.existsSync(hookFile(repo)));
  assert.ok(fs.existsSync(path.join(repo.dataDir, 'gate-link.js')));

  repo.git('config', 'core.hooksPath', 'githooks');
  const ask = run(repo.dir, process.execPath, [script, '--data', repo.dataDir]);
  assert.strictEqual(ask.status, 2, ask.stdout);
  assert.ok(ask.stdout.includes('Another tool manages the git hooks'), ask.stdout);
});

test('install.js outside a git repository explains itself', () => {
  const dir = tempDir('trabel-no-git-');
  const r = run(dir, process.execPath, [path.join(PLUGIN, 'scripts', 'install.js'), '--data', path.join(dir, 'd')], {
    env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(dir) },
  });
  assert.strictEqual(r.status, 1);
  assert.ok(r.stdout.includes('not inside a git repository'), r.stdout);
});

test('a path with spaces and a Hebrew commit message go through the hook', () => {
  const repo = repoWithMemory({ spaces: true, language: 'he' });
  assert.ok(repo.dataDir.includes(' '));
  repo.write('src/customers/list.js', 'module.exports = [1];\n');
  blocked(repo.commit('שינוי'), 'הקומיט נחסם (trabel-memory).');
  passed(repo.commit('שינוי\n\nDocs-Unchanged: סידור בלבד'));
});
