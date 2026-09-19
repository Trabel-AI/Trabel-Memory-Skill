#!/usr/bin/env node
'use strict';

// Builds the index table in the CLAUDE.md block from the cards and from the
// adopted files in settings.json. It uses the same code the gate checks the
// table with (lib/indexTable.js), so a table it writes always passes.
//
//   node index.js [--with-rules]     (from anywhere inside the repository)
//
// Only the table changes. The rest of CLAUDE.md, inside the block and out of
// it, stays as it is. Without CLAUDE.md or without a block, one is added.
// --with-rules also writes the rules part of the block (everything above the
// table) from templates/block.<language>.md: Hebrew for "he", English for any
// other language. Setup and save use it, so the rules follow the plugin.

const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./lib/git');
const S = require('./lib/settings');
const { loadFromDisk, readIfExists } = require('./lib/project');
const { renderTable, withTable, withRules } = require('./lib/indexTable');
const { splitLines } = require('./lib/text');

const TEMPLATES = path.join(__dirname, '..', 'templates');

function rulesFor(language) {
  const name = language === 'he' ? 'block.he.md' : 'block.en.md';
  return splitLines(fs.readFileSync(path.join(TEMPLATES, name), 'utf8'));
}

function buildIndex(cwd, { rules = false } = {}) {
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
  const withNewRules = rules ? withRules(before, rulesFor(project.settings.language)) : before;
  const after = withTable(withNewRules, table);
  if (after === before) return { code: 0, message: rules ? 'The block is up to date.' : 'The index is up to date.' };
  fs.writeFileSync(file, after);
  const what = rules ? 'The block' : 'The index';
  return { code: 0, message: `${what} in ${S.CLAUDE_PATH} was rebuilt (${table.length - 2} rows in the index).` };
}

if (require.main === module) {
  let result;
  try {
    result = buildIndex(process.cwd(), { rules: process.argv.includes('--with-rules') });
  } catch (err) {
    result = { code: 1, message: 'The index was not built: ' + String((err && err.message) || err).split(/\r?\n/)[0] };
  }
  process.stdout.write(result.message + '\n');
  process.exitCode = result.code;
}

module.exports = { buildIndex };
