#!/usr/bin/env node
'use strict';

// Builds the index table in the CLAUDE.md block from the cards and from the
// adopted files in settings.json. It uses the same code the gate checks the
// table with (lib/indexTable.js), so a table it writes always passes.
//
//   node index.js        (from anywhere inside the repository)
//
// Only the table changes. The rest of CLAUDE.md, inside the block and out of
// it, stays as it is. Without CLAUDE.md or without a block, one is added.

const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./lib/git');
const S = require('./lib/settings');
const { loadFromDisk, readIfExists } = require('./lib/project');
const { renderTable, withTable } = require('./lib/indexTable');

function buildIndex(cwd) {
  const root = repoRoot(cwd);
  const project = loadFromDisk(root);
  if (!project) return { code: 1, message: `No memory in this project: ${S.SETTINGS_PATH} does not exist.` };
  const table = renderTable({
    language: project.settings.language,
    hasNext: fs.existsSync(path.join(root, S.NEXT_PATH)),
    stateFiles: project.stateFiles,
  });
  const file = path.join(root, S.CLAUDE_PATH);
  const before = readIfExists(file);
  const after = withTable(before, table);
  if (after === before) return { code: 0, message: 'The index is up to date.' };
  fs.writeFileSync(file, after);
  return { code: 0, message: `The index in ${S.CLAUDE_PATH} was rebuilt (${table.length - 2} rows).` };
}

if (require.main === module) {
  let result;
  try {
    result = buildIndex(process.cwd());
  } catch (err) {
    result = { code: 1, message: 'The index was not built: ' + String((err && err.message) || err).split(/\r?\n/)[0] };
  }
  process.stdout.write(result.message + '\n');
  process.exitCode = result.code;
}

module.exports = { buildIndex };
