#!/usr/bin/env node
'use strict';

// Runs when a Claude Code session opens (the plugin's SessionStart hook).
// Claude Code passes a JSON object on stdin with the session's folder (cwd)
// and how it opened (source: startup, resume, clear, compact or fork).
// Whatever this prints goes into the session's context for Claude.
//
//   node session-start.js [--data <plugin data folder>]
//
// In a project without memory (no settings.json) it prints nothing.
// Otherwise:
// - On every opening it makes sure the git hook is installed and rewrites the
//   linker with the plugin's current folder.
// - On every opening except compact (the same session going on), it reports
//   work that was not committed, with the queue, so Claude opens with a report.
// It never fails the session: an error becomes one line of context.

const fs = require('fs');
const path = require('path');
const { git, repoRoot } = require('./lib/git');
const S = require('./lib/settings');
const { loadFromDisk, readIfExists } = require('./lib/project');
const { buildOwnership } = require('./lib/owners');
const { findDataDir, install } = require('./lib/hook');

const MAX_FILES = 50;
const MAX_QUEUE_LINES = 100;

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
  const isCode = S.makeIsCode(project.settings);
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

function run({ input, dataArg, env = process.env }) {
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
