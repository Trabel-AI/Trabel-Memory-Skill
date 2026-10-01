#!/usr/bin/env node
'use strict';

// Runs when a Claude Code session opens (the plugin's SessionStart hook).
// Claude Code passes a JSON object on stdin with the session's folder (cwd)
// and how it opened (source: startup, resume, clear, compact or fork).
// Whatever this prints goes into the session's context for Claude.
//
//   node session-start.js [--data <plugin data folder>]
//
// In a project with memory (it has settings.json):
// - On every opening it makes sure the git hook is installed and rewrites the
//   linker with the plugin's current folder.
// - On every opening except compact (the same session going on), it reports
//   work that was not committed, with the queue, so Claude opens with a report.
// - On a new session (startup, clear) it adds one line: a request to go on
//   from the plan or the queue runs the continue skill, a bare "continue"
//   does not.
// In any folder, once per machine, on a new session: turns automatic updates
// on for the plugin's marketplace in the user's Claude Code settings, and says
// so; when it cannot, says how to turn them on by hand.
// In a project without memory it prints nothing else.
// It never fails the session: an error becomes one line of context.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { git, repoRoot } = require('./lib/git');
const S = require('./lib/settings');
const { loadFromDisk, readIfExists } = require('./lib/project');
const { buildOwnership } = require('./lib/owners');
const { findDataDir, install } = require('./lib/hook');
const { planPathsOf, parseQueue } = require('./lib/plan');

const MAX_FILES = 50;
const MAX_QUEUE_LINES = 100;
const UPDATE_NOTE_FILE = 'auto-update-set';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    return '';
  }
}

function parseInput(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    return {};
  }
}

// [{ path, oldPath?, change }] from git status, untracked files included.
function uncommitted(root) {
  const parts = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).toString('utf8').split('\0');
  const changes = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const item = { path: entry.slice(3) };
    if (xy.includes('R') || xy.includes('C')) item.oldPath = parts[++i];
    item.change = xy === '??' ? 'new' : xy.includes('D') ? 'deleted' : xy.includes('R') ? 'renamed' : xy.includes('A') ? 'new' : 'modified';
    changes.push(item);
  }
  return changes;
}

function unsavedReport(root, project) {
  const changes = uncommitted(root);
  if (!changes.length) return null;
  const isCode = S.makeIsCode(project.settings, planPathsOf(readIfExists(path.join(root, S.NEXT_PATH))));
  const { ownersOf } = buildOwnership(project.stateFiles);
  const out = ['trabel-memory: the previous session stopped before saving. These files have changes that are not committed:'];
  for (const c of changes.slice(0, MAX_FILES)) {
    const from = c.oldPath ? ` from ${c.oldPath}` : '';
    const owners = isCode(c.path) ? ownersOf(c.path) : [];
    const docs = isCode(c.path) ? `; docs: ${owners.length ? owners.join(', ') : 'no owner yet'}` : '';
    out.push(`- ${c.path} (${c.change}${from}${docs})`);
  }
  if (changes.length > MAX_FILES) out.push(`- and ${changes.length - MAX_FILES} more`);

  const queue = readIfExists(path.join(root, S.NEXT_PATH));
  if (queue != null) {
    const lines = queue.replace(/\r\n/g, '\n').trimEnd().split('\n');
    out.push('', `The queue, ${S.NEXT_PATH}:`, '~~~', ...lines.slice(0, MAX_QUEUE_LINES), '~~~');
  } else {
    out.push('', `There is no queue (${S.NEXT_PATH}), so the intent of the work is not written anywhere.`);
  }
  out.push(
    '',
    "Open your first reply with a short report to the user, in the user's language: which files changed and in which domains, " +
      'what they do now (read git status and git diff, not only this list), where the queue says the work stood, ' +
      'and whether the docs were already updated. Then continue or save as the user decides.',
  );
  return out.join('\n');
}

// One line for a new session. Only a request that names the plan or the
// queue runs the continue skill: a bare "continue" is what a person writes
// after a session was cut off, and must not start the queue over the work
// that was interrupted. The continue skill runs no commands, so where the
// plan stands, and what is wrong with the queue's shape, is said here.
function continueNote(root) {
  const q = parseQueue(readIfExists(path.join(root, S.NEXT_PATH)));
  const where = q ? `This project works from a build plan: ${q.plan}, session ${q.n} of ${q.m}. ` : '';
  const out = [`trabel-memory: ${where}If the user asks to go on from the plan or the queue ("continue from the plan", "המשך על פי תוכנית", or the like), run the skill trabel-memory:continue before anything else. A bare "continue" or "המשך" does not run it: it means go on with the work that was interrupted.`];
  if (q && !fs.existsSync(path.join(root, q.plan))) out.push(`The plan file ${q.plan} does not exist.`);
  if (q && q.problems.length) out.push('Problems in the queue:', ...q.problems.map((p) => `- ${p}`));
  return out.join('\n');
}

function readJson(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    return {};
  }
}

// Once per machine, on a new session in any folder: Claude Code keeps
// automatic updates off for a marketplace that is not Anthropic's, so a person
// who installed the plugin would stay on the installed version without
// knowing. The hook turns them on itself: it writes "autoUpdate": true into
// the marketplace's entry under extraKnownMarketplaces in the user's
// settings.json (the documented switch), after copying the file into the data
// folder, and tells the user once, with the way to turn it off. When the
// settings file cannot be read as JSON, or the marketplace's source is known
// nowhere, nothing is written and the user is told how to turn it on by hand.
// Only a copy that Claude Code lists as installed acts (a copy loaded with
// --plugin-dir has no marketplace). It acts once per machine: a file in the
// data folder remembers that the switch was looked at, so a person who turns
// updates off afterwards stays off. Any failure here is silent.
function updateNote({ input, dataArg, env }) {
  try {
    if (input.source !== 'startup' && input.source !== 'clear') return null;
    const data = findDataDir({ given: dataArg, env });
    if (data.error) return null; // nowhere to remember that it was done
    const marker = path.join(data.dir, UPDATE_NOTE_FILE);
    if (fs.existsSync(marker)) return null;

    const config = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const pluginRoot = path.resolve(__dirname, '..');
    const plugins = readJson(path.join(config, 'plugins', 'installed_plugins.json')).plugins || {};
    const id = Object.keys(plugins).find((key) =>
      Array.isArray(plugins[key]) && plugins[key].some((p) => p && typeof p.installPath === 'string' && path.relative(p.installPath, pluginRoot) === ''));
    if (!id || !id.includes('@')) return null;
    const marketplace = id.slice(id.lastIndexOf('@') + 1);

    const settingsFile = path.join(config, 'settings.json');
    const known = readJson(path.join(config, 'plugins', 'known_marketplaces.json'));
    const isOn = (entries) => Boolean(entries && entries[marketplace] && entries[marketplace].autoUpdate === true);
    fs.mkdirSync(data.dir, { recursive: true });
    if (isOn(readJson(settingsFile).extraKnownMarketplaces) || isOn(known)) {
      fs.writeFileSync(marker, 'Automatic updates were already on.\n');
      return null;
    }

    const shown = settingsFile.replace(/\\/g, '/');
    const byHand = [
      `- Update by hand, from a terminal: claude plugin marketplace update ${marketplace}, and then: claude plugin update ${id}. The new version loads in the next session.`,
      `- Turn automatic updates on, once: in Claude Code in a terminal, /plugin, Marketplaces, "${marketplace}", Enable auto-update. Anywhere else, including the VS Code extension: add "autoUpdate": true to the "${marketplace}" entry under extraKnownMarketplaces in ${shown}. You can offer to add that line for the user.`,
      'This note is given once and does not come back.',
    ];
    const written = turnAutoUpdateOn({ settingsFile, marketplace, known, backupDir: data.dir });
    if (written) {
      fs.writeFileSync(marker, 'Automatic updates were turned on in the settings file.\n');
      return [
        `trabel-memory: this plugin turned automatic updates on for its marketplace "${marketplace}" on this machine, in ${shown} (the "autoUpdate": true line under extraKnownMarketplaces; a copy of the file as it was is in ${path.join(data.dir, SETTINGS_BACKUP).replace(/\\/g, '/')}). Claude Code keeps automatic updates off for a marketplace that is not Anthropic's unless they are turned on, and without them the plugin would stay on the installed version.`,
        "Tell the user now, once, in one or two plain sentences in the user's language: that it is on, that a new version loads in the session after the one in which Claude Code finds it, and how to turn it off (remove that line, or in Claude Code in a terminal: /plugin, Marketplaces, the marketplace, Disable auto-update).",
        'This note is given once and does not come back.',
      ].join('\n');
    }
    fs.writeFileSync(marker, 'The note about automatic updates was given.\n');
    return [
      `trabel-memory: this plugin does not update by itself on this machine. Claude Code keeps automatic updates off for a marketplace that is not Anthropic's, they are not turned on for the marketplace "${marketplace}", and the plugin could not turn them on in ${shown}.`,
      "Tell the user now, once, in two or three plain sentences in the user's language, and give the two ways:",
      ...byHand,
    ].join('\n');
  } catch (e) {
    return null;
  }
}

const SETTINGS_BACKUP = 'settings.json.before-auto-update';

// Writes "autoUpdate": true for the marketplace in the user's settings.json.
// Returns true when it wrote. It refuses when the file exists and is not a
// JSON object (a broken file is never overwritten), and when the marketplace's
// entry does not exist and its source is not in known_marketplaces.json
// either (an entry without a source would be wrong). The file as it was goes
// to the backup first; an empty backup means there was no file.
function turnAutoUpdateOn({ settingsFile, marketplace, known, backupDir }) {
  let raw = null;
  if (fs.existsSync(settingsFile)) raw = fs.readFileSync(settingsFile, 'utf8');
  let settings = {};
  if (raw != null) {
    try {
      settings = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch (e) {
      return false;
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
  }
  const entries = settings.extraKnownMarketplaces && typeof settings.extraKnownMarketplaces === 'object' && !Array.isArray(settings.extraKnownMarketplaces)
    ? settings.extraKnownMarketplaces : {};
  let entry = entries[marketplace] && typeof entries[marketplace] === 'object' ? entries[marketplace] : null;
  if (!entry) {
    const source = known && known[marketplace] && known[marketplace].source;
    if (!source || typeof source !== 'object') return false;
    entry = { source };
  }
  entry.autoUpdate = true;
  entries[marketplace] = entry;
  settings.extraKnownMarketplaces = entries;
  fs.writeFileSync(path.join(backupDir, SETTINGS_BACKUP), raw == null ? '' : raw);
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  return true;
}

function run({ input, dataArg, env = process.env }) {
  return [projectNotes({ input, dataArg, env }), updateNote({ input, dataArg, env })].filter(Boolean).join('\n\n');
}

function projectNotes({ input, dataArg, env }) {
  let root;
  try {
    root = repoRoot(input.cwd || process.cwd());
  } catch (e) {
    return ''; // not a git repository
  }
  if (!fs.existsSync(path.join(root, S.SETTINGS_PATH))) return '';

  const notes = [];
  try {
    const data = findDataDir({ given: dataArg, env });
    if (data.error) {
      notes.push('trabel-memory: the documentation gate could not be checked. ' + data.error);
    } else {
      const result = install({ root, pluginRoot: path.resolve(__dirname, '..'), dataDir: data.dir });
      if (result.status === 'tool-needs-approval' || result.status === 'conflict') {
        notes.push(
          'trabel-memory: the documentation gate is NOT active in this project, so commits are not checked. ' + result.message +
            '\nTell the user in one or two plain sentences, and offer to fix it (the setup skill does this).',
        );
      }
    }
  } catch (err) {
    notes.push('trabel-memory: the documentation gate could not be checked: ' + String((err && err.message) || err).split(/\r?\n/)[0]);
  }

  if (input.source !== 'compact') {
    let project = null;
    try {
      project = loadFromDisk(root);
    } catch (err) {
      notes.push('trabel-memory: docs/state/settings.json could not be read: ' + String((err && err.message) || err).split(/\r?\n/)[0]);
    }
    if (project) {
      const report = unsavedReport(root, project);
      if (report) notes.push(report);
      if (input.source === 'startup' || input.source === 'clear') notes.push(continueNote(root));
    }
  }
  return notes.join('\n\n');
}

if (require.main === module) {
  let output;
  try {
    const i = process.argv.indexOf('--data');
    const dataArg = i > 0 ? process.argv[i + 1] : null;
    output = run({ input: parseInput(readStdin()), dataArg });
  } catch (err) {
    output = 'trabel-memory: the session-start check failed: ' + String((err && err.message) || err).split(/\r?\n/)[0];
  }
  if (output) process.stdout.write(output + '\n');
  process.exitCode = 0;
}

module.exports = { run, uncommitted };
