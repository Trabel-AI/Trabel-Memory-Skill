#!/usr/bin/env node
'use strict';

// Collects every open item in the project's state files, oldest first.
// Nothing is saved: the picture is gathered from the files on each request,
// so it cannot go stale.
//
//   node open.js [--json]

const { repoRoot } = require('./lib/git');
const S = require('./lib/settings');
const { splitLines } = require('./lib/text');
const { loadFromDisk } = require('./lib/project');
const { findOpenItems } = require('./lib/openItems');

const DAY = 24 * 60 * 60 * 1000;

// [{ file, title, opened, ageDays, text }], oldest first. An item with a date
// that is not a real date sorts last.
function collectOpen(root, today = new Date()) {
  const project = loadFromDisk(root);
  if (!project) return null;
  const items = [];
  for (const f of project.stateFiles) {
    const lines = splitLines(f.text);
    for (const item of findOpenItems(f.text)) {
      const body = lines.slice(item.start, item.end);
      while (body.length && !body[body.length - 1].trim()) body.pop();
      const opened = (body.slice(1).find((l) => l.trim()) || '').match(/\d{4}-\d{2}-\d{2}/)[0];
      const time = Date.parse(opened + 'T00:00:00Z');
      const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
      items.push({
        file: f.path,
        title: item.title,
        opened,
        ageDays: Number.isFinite(time) ? Math.round((todayUtc - time) / DAY) : null,
        text: body.join('\n'),
      });
    }
  }
  const key = (i) => (i.ageDays == null ? '9999-99-99' : i.opened);
  items.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return items;
}

function render(items) {
  if (!items.length) return 'No open items.';
  const out = [`${items.length} open item${items.length === 1 ? '' : 's'}, oldest first.`];
  for (const i of items) {
    const age = i.ageDays == null ? 'date unreadable' : `${i.ageDays} day${i.ageDays === 1 ? '' : 's'} old`;
    out.push('', `[${i.file}, ${age}]`, i.text);
  }
  return out.join('\n');
}

if (require.main === module) {
  let output;
  let code = 0;
  try {
    const items = collectOpen(repoRoot(process.cwd()));
    if (!items) {
      output = `No memory in this project: ${S.SETTINGS_PATH} does not exist.`;
      code = 1;
    } else {
      output = process.argv.includes('--json') ? JSON.stringify(items, null, 2) : render(items);
    }
  } catch (err) {
    output = 'The open items could not be collected: ' + String((err && err.message) || err).split(/\r?\n/)[0];
    code = 1;
  }
  process.stdout.write(output + '\n');
  process.exitCode = code;
}

module.exports = { collectOpen, render };
