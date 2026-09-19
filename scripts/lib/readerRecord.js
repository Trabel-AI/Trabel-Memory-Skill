'use strict';

// The record of the new-reader test in one project. Each time reader.js
// renders the input, a round starts. Each answer the reader gives is added to
// the last round by the SubagentStop hook (scripts/reader-hook.js), which gets
// it from Claude Code itself: no answer passes through Claude's hands, because
// when it did, Claude sometimes made one up. The record lives in the plugin's
// data folder, one file per project, never inside the project.
//
// A record belongs to one HEAD: a commit starts a new one. A record whose
// last round is older than STALE_MS is also dropped, so a save that was left
// halfway does not count in the next one.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AGENT = 'trabel-memory:reader';
const STALE_MS = 3 * 60 * 60 * 1000;

// The same folder written two ways (C:/x from git, C:\X from a hook) is one key.
function projectKey(root) {
  const p = path.resolve(root);
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

function recordFile(dataDir, root) {
  const hash = crypto.createHash('sha1').update(projectKey(root)).digest('hex').slice(0, 16);
  return path.join(dataDir, 'reader', `${hash}.json`);
}

function load(dataDir, root) {
  try {
    const r = JSON.parse(fs.readFileSync(recordFile(dataDir, root), 'utf8'));
    return r && Array.isArray(r.rounds) ? r : null;
  } catch (e) {
    return null;
  }
}

function store(dataDir, root, record) {
  const file = recordFile(dataDir, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record));
}

// The record for this HEAD, or null when there is none or it went stale.
function current(dataDir, root, head, now = Date.now()) {
  const r = load(dataDir, root);
  if (!r || r.head !== head || !r.rounds.length) return null;
  if (now - (r.rounds[r.rounds.length - 1].at || 0) > STALE_MS) return null;
  return r;
}

function startRound(dataDir, root, head, files, now = Date.now()) {
  const r = current(dataDir, root, head, now) || { project: projectKey(root), head, rounds: [] };
  r.rounds.push({ at: now, files, answers: [] });
  store(dataDir, root, r);
}

// Adds an answer to the last round. Without a round there is nothing it
// could answer, and it is dropped.
function addAnswer(dataDir, root, text, now = Date.now()) {
  const r = load(dataDir, root);
  if (!r || !r.rounds.length) return false;
  const last = r.rounds[r.rounds.length - 1];
  last.answers.push(String(text));
  last.at = now;
  store(dataDir, root, r);
  return true;
}

// Every {"id", "pass", ...} object in the answers, even when the JSON around
// it is broken. A later answer for the same id wins.
function verdicts(answers) {
  const out = new Map();
  for (const m of answers.join('\n').matchAll(/\{[^{}]*\}/g)) {
    const id = m[0].match(/"id"\s*:\s*"([^"]+)"/);
    const pass = m[0].match(/"pass"\s*:\s*(true|false)/);
    if (id && pass) out.set(id[1], pass[1] === 'true');
  }
  return out;
}

module.exports = { AGENT, STALE_MS, projectKey, recordFile, load, current, startRound, addAnswer, verdicts };
