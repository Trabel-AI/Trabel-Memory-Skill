#!/usr/bin/env node
'use strict';

// Installs or repairs the documentation gate (the git commit-msg hook) in the
// repository that holds the current folder.
//
//   node install.js [--data <folder>] [--add-to-tool]
//
// --data         the plugin's data folder. Without it: CLAUDE_PLUGIN_DATA, and
//                without that, the one trabel-memory* folder under
//                ~/.claude/plugins/data.
// --add-to-tool  when another tool manages the hooks, add the gate's one line
//                to that tool's hook file. Without it the line is only shown.
//
// Exit codes: 0 installed, 2 waiting for approval to add the line to another
// tool, 1 not installed (the message says why).

const path = require('path');
const { repoRoot } = require('./lib/git');
const { findDataDir, install } = require('./lib/hook');

function parseArgs(argv) {
  const args = { data: null, addToTool: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--data') args.data = argv[++i];
    else if (argv[i] === '--add-to-tool') args.addToTool = true;
  }
  return args;
}

function main(argv, cwd = process.cwd(), env = process.env) {
  const args = parseArgs(argv);
  let root;
  try {
    root = repoRoot(cwd);
  } catch (e) {
    return { code: 1, message: 'The gate is not installed: this folder is not inside a git repository.' };
  }
  const data = findDataDir({ given: args.data, env });
  if (data.error) return { code: 1, message: 'The gate is not installed. ' + data.error };
  const result = install({ root, pluginRoot: path.resolve(__dirname, '..'), dataDir: data.dir, addToTool: args.addToTool });
  const code = result.status === 'tool-needs-approval' ? 2 : result.status === 'conflict' ? 1 : 0;
  return { code, message: result.message };
}

if (require.main === module) {
  let result;
  try {
    result = main(process.argv);
  } catch (err) {
    result = { code: 1, message: 'The gate is not installed: ' + String((err && err.message) || err).split(/\r?\n/)[0] };
  }
  process.stdout.write(result.message + '\n');
  process.exitCode = result.code;
}

module.exports = { main };
