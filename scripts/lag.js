#!/usr/bin/env node
'use strict';

// The lag check. Finds code that changed in a commit after the last update of
// the state file responsible for it, in a commit without a Docs-Unchanged:
// line. That is code whose docs fell behind: the gate did not run, was
// bypassed, or failed open. The save completes those docs now.
//
//   node lag.js [--json]
//
// Ownership is read from the working folder, so an owns line added moments
// ago already counts. Merge commits are skipped: the commits they merged are
// checked on their own. Files that no longer exist are not listed.

const { git, repoRoot, hasHead, indexFiles } = require('./lib/git');
const S = require('./lib/settings');
const { splitLines, hasTrailer } = require('./lib/text');
const { loadFromDisk } = require('./lib/project');
const { buildOwnership } = require('./lib/owners');

// Newest first: [{ hash, subject, exempt, files }]
function history(root) {
  if (!hasHead(root)) return [];
  const out = git(root, ['log', '--no-merges', '--no-renames', '-z', '--name-only', '--format=%x01%H%x02%B%x03']).toString('utf8');
  const commits = [];
  for (const record of out.split('\x01').slice(1)) {
    const hash = record.slice(0, record.indexOf('\x02'));
    const body = record.slice(record.indexOf('\x02') + 1, record.indexOf('\x03'));
    const files = record.slice(record.indexOf('\x03') + 1).split('\0').map((f, i) => (i <= 1 ? f.replace(/^\n/, '') : f)).filter(Boolean);
    const lines = splitLines(body);
    commits.push({ hash, subject: (lines[0] || '').trim(), exempt: hasTrailer(lines, 'Docs-Unchanged'), files });
  }
  return commits;
}

// { stateFile: [{ file, commits: [{ hash, subject }] }] }, or null without memory.
function findLag(root) {
  const project = loadFromDisk(root);
  if (!project) return null;
  const isCode = S.makeIsCode(project.settings);
  const { ownersOf } = buildOwnership(project.stateFiles);
  const tracked = new Set(indexFiles(root));
  const documented = new Set(); // owners updated in a newer commit
  const lag = new Map(); // owner -> Map(file -> commits)

  for (const c of history(root)) {
    const touched = new Set(c.files);
    if (!c.exempt) {
      for (const file of c.files) {
        if (!tracked.has(file) || !isCode(file)) continue;
        const owners = ownersOf(file);
        if (!owners.length || owners.some((o) => documented.has(o) || touched.has(o))) continue;
        for (const o of owners) {
          if (!lag.has(o)) lag.set(o, new Map());
          const files = lag.get(o);
          if (!files.has(file)) files.set(file, []);
          files.get(file).push({ hash: c.hash, subject: c.subject });
        }
      }
    }
    for (const f of project.stateFiles) if (touched.has(f.path)) documented.add(f.path);
    if (documented.size === project.stateFiles.length) break;
  }

  const result = {};
  for (const o of [...lag.keys()].sort()) {
    result[o] = [...lag.get(o).entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([file, commits]) => ({ file, commits }));
  }
  return result;
}

function render(result) {
  const owners = Object.keys(result);
  if (!owners.length) return 'No lag: every code change since the last update of its state file is documented.';
  const out = [];
  for (const o of owners) {
    out.push(`${o} is behind:`);
    for (const { file, commits } of result[o]) {
      out.push(`  ${file}: ${commits.map((c) => `${c.hash.slice(0, 7)} "${c.subject}"`).join(', ')}`);
    }
  }
  return out.join('\n');
}

if (require.main === module) {
  let output;
  let code = 0;
  try {
    const result = findLag(repoRoot(process.cwd()));
    if (!result) {
      output = `No memory in this project: ${S.SETTINGS_PATH} does not exist.`;
      code = 1;
    } else {
      output = process.argv.includes('--json') ? JSON.stringify(result, null, 2) : render(result);
    }
  } catch (err) {
    output = 'The lag check could not run: ' + String((err && err.message) || err).split(/\r?\n/)[0];
    code = 1;
  }
  process.stdout.write(output + '\n');
  process.exitCode = code;
}

module.exports = { findLag, render };
