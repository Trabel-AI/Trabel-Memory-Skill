#!/usr/bin/env node
'use strict';

// The SubagentStop hook. Claude Code runs it when any subagent finishes, in
// any project on the machine. It does one thing: when the subagent is the
// trabel-memory reader and the project has memory, it keeps the reader's
// answer, exactly as Claude Code hands it over, in the plugin's data folder
// (lib/readerRecord.js). In every other case it exits at once, writing and
// printing nothing. It never prints, so it never adds to the conversation.
//
//   node reader-hook.js --data <the plugin's data folder>   (JSON on stdin)

const fs = require('fs');
const path = require('path');
const { AGENT, addAnswer } = require('./lib/readerRecord');

// The folder above cwd that holds .git, or null.
function projectRoot(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function main() {
  const event = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (!event || event.agent_type !== AGENT) return;
  if (typeof event.last_assistant_message !== 'string' || typeof event.cwd !== 'string') return;
  const i = process.argv.indexOf('--data');
  const dataDir = i >= 0 ? process.argv[i + 1] : null;
  if (!dataDir) return;
  const root = projectRoot(event.cwd);
  if (!root || !fs.existsSync(path.join(root, 'docs', 'state', 'settings.json'))) return;
  addAnswer(dataDir, root, event.last_assistant_message);
}

try {
  main();
} catch (e) {
  // A hook that fails must not disturb the session: nothing is kept.
}
process.exitCode = 0;
