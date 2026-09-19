'use strict';

const fs = require('fs');
const path = require('path');
const S = require('./settings');
const { parseCard } = require('./card');

// The state files of a project, read either from git (the gate) or from the
// working folder (the index builder, lag, open items, session start).

function stateEntry(p, text) {
  const card = parseCard(text) || { name: '', summary: '', owns: [], budget: null };
  const general = p === S.STATE_DIR + 'architecture.md' || p === S.STATE_DIR + 'conventions.md';
  return { path: p, text, name: card.name, summary: card.summary, owns: card.owns, budget: card.budget || S.DEFAULT_BUDGET, general, adopted: false };
}

function adoptedEntry(a, text) {
  return { path: a.path, text, name: a.name, summary: a.summary, owns: a.owns, budget: a.budget || S.DEFAULT_BUDGET, general: false, adopted: true };
}

// Every .md file under docs/state, as repo-relative paths with forward slashes.
function stateMdOnDisk(root) {
  const found = [];
  const walk = (dir, rel) => {
    let names;
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const d of names) {
      if (d.isDirectory()) walk(path.join(dir, d.name), rel + d.name + '/');
      else if (d.name.toLowerCase().endsWith('.md')) found.push(rel + d.name);
    }
  };
  walk(path.join(root, S.STATE_DIR), S.STATE_DIR);
  return found.sort();
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    return null;
  }
}

// null when the project has no memory (no settings.json).
function loadFromDisk(root) {
  const settingsText = readIfExists(path.join(root, S.SETTINGS_PATH));
  if (settingsText == null) return null;
  const settings = S.parseSettings(settingsText);
  const stateFiles = [];
  for (const p of stateMdOnDisk(root)) {
    const text = readIfExists(path.join(root, p));
    if (text != null) stateFiles.push(stateEntry(p, text));
  }
  for (const a of settings.adopted) {
    const text = readIfExists(path.join(root, a.path));
    if (text != null) stateFiles.push(adoptedEntry(a, text));
  }
  return { root, settings, stateFiles };
}

module.exports = { stateEntry, adoptedEntry, loadFromDisk, readIfExists };
