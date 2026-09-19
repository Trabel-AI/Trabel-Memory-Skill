'use strict';

// Throwaway git repositories with the gate installed as the commit-msg hook,
// by the real installer: the sh hook in .git/hooks and the linker in a
// throwaway plugin data folder.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseCard } = require('../scripts/lib/card');
const { parseSettings } = require('../scripts/lib/settings');
const { renderTable, BLOCK_START, BLOCK_END } = require('../scripts/lib/indexTable');
const { install } = require('../scripts/lib/hook');

const PLUGIN = path.resolve(__dirname, '..');
const GATE = path.join(PLUGIN, 'scripts', 'gate.js').replace(/\\/g, '/');

const created = [];

function run(cwd, cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, ...options });
  if (r.error) throw r.error;
  return r;
}

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

// A copy of the plugin's scripts, for tests that break or move the plugin.
function copyPlugin() {
  const root = path.join(tempDir('trabel-plugin-'), 'plugin copy');
  fs.cpSync(path.join(PLUGIN, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  return root;
}

// installHook: false leaves the repository without the gate.
function makeRepo({ spaces = false, pluginRoot = PLUGIN, installHook = true } = {}) {
  const base = tempDir(spaces ? 'trabel gate ' : 'trabel-gate-');
  const dir = path.join(base, spaces ? 'my project' : 'repo');
  const dataDir = path.join(base, 'plugin data');
  fs.mkdirSync(dir);

  const git = (...args) => {
    const r = run(dir, 'git', args);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${r.stderr}`);
    return r.stdout;
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'core.autocrlf', 'false');
  git('config', 'core.safecrlf', 'false');
  git('config', 'commit.gpgsign', 'false');
  if (installHook) install({ root: dir, pluginRoot, dataDir });

  const repo = {
    dir,
    base,
    dataDir,
    git,
    write(file, content) {
      const full = path.join(dir, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      return repo;
    },
    read(file) {
      return fs.readFileSync(path.join(dir, file), 'utf8');
    },
    remove(file) {
      fs.rmSync(path.join(dir, file));
      return repo;
    },
    // Stages everything and commits. Returns { ok, output }.
    // env replaces the environment git runs in.
    commit(message, extra = [], env) {
      git('add', '-A');
      const msgFile = path.join(base, 'message.txt');
      fs.writeFileSync(msgFile, message);
      const r = run(dir, 'git', ['commit', '-q', '-F', msgFile, ...extra], env ? { env } : {});
      return { ok: r.status === 0, output: (r.stdout || '') + (r.stderr || '') };
    },
    // Rewrites the CLAUDE.md block so the index matches the cards on disk.
    syncIndex() {
      const settings = parseSettings(repo.read('docs/state/settings.json'));
      const stateDir = path.join(dir, 'docs', 'state');
      const stateFiles = fs.readdirSync(stateDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => {
          const card = parseCard(fs.readFileSync(path.join(stateDir, f), 'utf8')) || {};
          return { path: 'docs/state/' + f, summary: card.summary || '', adopted: false };
        });
      for (const a of settings.adopted) {
        if (fs.existsSync(path.join(dir, a.path))) stateFiles.push({ path: a.path, summary: a.summary, adopted: true });
      }
      const table = renderTable({
        language: settings.language,
        hasNext: fs.existsSync(path.join(dir, 'docs', 'NEXT.md')),
        stateFiles,
      });
      const block = [BLOCK_START, '## Project memory', 'Read only what the task needs.', '', ...table, BLOCK_END];
      repo.write('CLAUDE.md', '# Project\n\n' + block.join('\n') + '\n');
      return repo;
    },
  };
  return repo;
}

function card({ name, summary, owns = [], budget }) {
  const lines = ['---', `name: ${name}`, `summary: ${summary}`, 'owns:', ...owns.map((p) => `  - ${p}`)];
  if (budget) lines.push(`budget: ${budget}`);
  lines.push('---', '');
  return lines.join('\n');
}

// A repo with memory set up and a first commit:
//   architecture owns package.json, conventions owns src/lib/util.js,
//   customers owns src/customers/**.
function repoWithMemory({ language = 'en', gate = 'block', spaces = false, ignore, adopted, pluginRoot, installHook } = {}) {
  const repo = makeRepo({ spaces, pluginRoot, installHook });
  const settings = { gate, language };
  if (ignore) settings.ignore = ignore;
  if (adopted) settings.adopted = adopted;
  repo.write('docs/state/settings.json', JSON.stringify(settings, null, 2) + '\n');
  repo.write('docs/state/architecture.md', card({ name: 'Architecture', summary: 'Structure, running, deploy', owns: ['package.json'] }) + '# Architecture\n\nNode app.\n');
  repo.write('docs/state/conventions.md', card({ name: 'Conventions', summary: 'Shared rules and traps', owns: ['src/lib/util.js'] }) + '# Conventions\n\nPlain JS.\n');
  repo.write('docs/state/customers.md', card({ name: 'Customers', summary: 'The customer list and customer card', owns: ['src/customers/**'] }) + '# Customers\n\nThe list shows every customer.\n');
  repo.write('docs/NEXT.md', '# Next\n\n- [ ] nothing\n');
  repo.write('package.json', '{ "name": "toy" }\n');
  repo.write('src/lib/util.js', 'module.exports = {};\n');
  repo.write('src/customers/list.js', 'module.exports = [];\n');
  repo.syncIndex();
  const first = repo.commit('Initial commit');
  if (!first.ok) throw new Error('setup commit failed:\n' + first.output);
  return repo;
}

function cleanup() {
  for (const dir of created.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      // A leftover temp folder is harmless.
    }
  }
}

module.exports = { makeRepo, repoWithMemory, card, cleanup, copyPlugin, tempDir, run, PLUGIN, GATE };
