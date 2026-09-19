#!/usr/bin/env node
'use strict';

// The gate. Runs from the git commit-msg hook: node gate.js <message file>.
// Blocks a commit whose code changed while its docs did not.
// It fails open: if anything goes wrong inside, the commit goes through.

const fs = require('fs');
const path = require('path');
const G = require('./lib/git');
const S = require('./lib/settings');
const { parseCard } = require('./lib/card');
const { hasStar, isAllStars, toRegExp } = require('./lib/glob');
const { buildOwnership } = require('./lib/owners');
const { findOpenItems, withoutOpenItems } = require('./lib/openItems');
const { renderTable, extractBlock, tablesMatch } = require('./lib/indexTable');
const { countLines, splitLines } = require('./lib/text');
const { messagesFor } = require('./lib/messages');

const BROAD_SHARE = 0.4;
const BROAD_MIN_FILES = 20;
const MAX_LISTED = 20;

// Message lines, without git's comment lines and without the diff that
// `git commit -v` adds below the scissors line.
function messageLines(text) {
  const lines = [];
  for (const line of splitLines(text)) {
    if (/^# -+ >8 -+$/.test(line)) break;
    if (line.startsWith('#')) continue;
    lines.push(line);
  }
  return lines;
}

function hasTrailer(lines, key) {
  const re = new RegExp('^' + key + ':\\s*\\S', 'i');
  return lines.some((l) => re.test(l.trim()));
}

function sameList(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// Everything the gate knows about the state files, as the commit will leave them.
function loadStateFiles(root, settings) {
  const mdPaths = G.indexFiles(root, S.STATE_DIR)
    .filter((p) => p.startsWith(S.STATE_DIR) && p.toLowerCase().endsWith('.md'));
  const adoptedPaths = settings.adopted.map((a) => a.path);
  const blobs = G.readBlobs(root, [...mdPaths, ...adoptedPaths].map((p) => ':' + p));

  const files = [];
  for (const p of mdPaths) {
    const text = blobs.get(':' + p);
    if (text == null) continue;
    const card = parseCard(text) || { name: '', summary: '', owns: [], budget: null };
    const general = p === S.STATE_DIR + 'architecture.md' || p === S.STATE_DIR + 'conventions.md';
    files.push({ path: p, text, summary: card.summary, owns: card.owns, budget: card.budget || S.DEFAULT_BUDGET, general, adopted: false });
  }
  for (const a of settings.adopted) {
    const text = blobs.get(':' + a.path);
    if (text == null) continue;
    files.push({ path: a.path, text, summary: a.summary, owns: a.owns, budget: a.budget || S.DEFAULT_BUDGET, general: false, adopted: true });
  }
  return files;
}

function runGate({ msgFile, cwd, state }) {
  const root = G.repoRoot(cwd);
  const settingsFile = path.join(root, S.SETTINGS_PATH);
  if (!fs.existsSync(settingsFile)) return { exitCode: 0 };

  const staged = G.readBlobs(root, [':' + S.SETTINGS_PATH]).get(':' + S.SETTINGS_PATH);
  const settings = S.parseSettings(staged != null ? staged : fs.readFileSync(settingsFile, 'utf8'));
  state.language = settings.language;
  const t = messagesFor(settings.language);
  if (settings.gate === 'off') return { exitCode: 0 };

  const message = messageLines(msgFile ? fs.readFileSync(msgFile, 'utf8') : '');
  if (hasTrailer(message, 'Memory-Skip')) return { exitCode: 0 };
  const docsUnchanged = hasTrailer(message, 'Docs-Unchanged');

  if (G.isMerging(root)) return { exitCode: 0 };
  const withHead = G.hasHead(root);
  const changes = G.stagedChanges(root, withHead);
  if (!changes.length) return { exitCode: 0 };

  const changed = new Set();
  for (const c of changes) {
    changed.add(c.path);
    if (c.oldPath) changed.add(c.oldPath);
  }

  const isCode = S.makeIsCode(settings);
  const stateFiles = loadStateFiles(root, settings);
  const { ownersOf } = buildOwnership(stateFiles);
  const isStatePath = (p) => stateFiles.some((f) => f.path === p) || (p.startsWith(S.STATE_DIR) && p.endsWith('.md'));

  // The HEAD version of every state file in this commit, for checks 1 and 5.
  const headSpec = (c) => 'HEAD:' + (c.oldPath || c.path);
  const stateChanges = changes.filter((c) => c.status !== 'D' && stateFiles.some((f) => f.path === c.path));
  const headBlobs = withHead ? G.readBlobs(root, stateChanges.map(headSpec)) : new Map();
  const headSettings = withHead && changed.has(S.SETTINGS_PATH)
    ? G.readBlobs(root, ['HEAD:' + S.SETTINGS_PATH]).get('HEAD:' + S.SETTINGS_PATH)
    : null;

  const failures = []; // { kind, line, extra? }
  const fail = (kind, line, extra) => failures.push({ kind, line, extra });

  // 1. Code without an owner.
  // 2. Code without docs. A renamed or deleted file is owned by its old path.
  for (const c of changes) {
    if (c.status !== 'D' && isCode(c.path) && ownersOf(c.path).length === 0) {
      fail('unowned', t.unowned(c.path));
    }
    if (docsUnchanged) continue;
    const oldPath = c.status === 'R' ? c.oldPath : null;
    const oldOwners = oldPath && isCode(oldPath) ? ownersOf(oldPath) : [];
    const owners = oldOwners.length ? oldOwners : isCode(c.path) ? ownersOf(c.path) : [];
    if (owners.length && !owners.some((o) => changed.has(o))) {
      fail('undocumented', t.undocumented(oldOwners.length ? oldPath : c.path, owners.join(t.or)));
    }
  }

  // 1, continued. Ownership patterns that swallow new code. Checked only for
  // cards whose owns changed in this commit.
  let codeFiles = null;
  for (const f of stateFiles) {
    let ownsChanged;
    if (f.adopted) {
      if (!changed.has(S.SETTINGS_PATH) && !changed.has(f.path)) continue;
      let before = null;
      try {
        before = headSettings ? S.parseSettings(headSettings).adopted.find((a) => a.path === f.path) : null;
      } catch (e) {
        before = null;
      }
      ownsChanged = !before || !sameList(before.owns, f.owns);
    } else {
      const c = stateChanges.find((x) => x.path === f.path);
      if (!c) continue;
      const beforeText = headBlobs.get(headSpec(c));
      const before = beforeText != null ? parseCard(beforeText) : null;
      ownsChanged = !before || !sameList(before.owns, f.owns);
    }
    if (!ownsChanged) continue;

    for (const p of f.owns) {
      if (f.general) {
        if (hasStar(p)) fail('starInGeneral', t.starInGeneral(f.path, p));
        continue;
      }
      if (isAllStars(p)) {
        fail('pattern', t.swallowAll(f.path, p));
        continue;
      }
      if (!codeFiles) codeFiles = G.indexFiles(root).filter(isCode);
      if (codeFiles.length < BROAD_MIN_FILES) continue;
      const re = toRegExp(p);
      const n = codeFiles.filter((file) => re.test(file)).length;
      if (n / codeFiles.length > BROAD_SHARE) {
        fail('pattern', t.broad(f.path, p, n, codeFiles.length, Math.round((100 * n) / codeFiles.length)));
      }
    }
  }

  // 3. Over the limit. Only files in this commit.
  for (const f of stateFiles) {
    if (!changed.has(f.path)) continue;
    const n = countLines(f.text);
    if (n > f.budget) fail('budget', t.overBudget(f.path, n, f.budget));
  }
  const special = G.readBlobs(root, [':' + S.NEXT_PATH, ':' + S.CLAUDE_PATH]);
  const nextText = special.get(':' + S.NEXT_PATH);
  const claudeText = special.get(':' + S.CLAUDE_PATH);
  if (changed.has(S.NEXT_PATH) && nextText != null) {
    const n = countLines(nextText);
    if (n > S.NEXT_BUDGET) fail('budget', t.overBudget(S.NEXT_PATH, n, S.NEXT_BUDGET));
  }
  const block = claudeText != null ? extractBlock(claudeText) : null;
  if (changed.has(S.CLAUDE_PATH) && block && block.rulesLines > S.RULES_BUDGET) {
    fail('budget', t.rulesOverBudget(block.rulesLines, S.RULES_BUDGET));
  }

  // 4. Index out of date. Checked when the commit touches the index or its sources.
  const touchesIndex = [...changed].some(
    (p) => p === S.CLAUDE_PATH || p === S.SETTINGS_PATH || p === S.NEXT_PATH || isStatePath(p),
  );
  if (touchesIndex) {
    const expected = renderTable({ language: settings.language, hasNext: nextText != null, stateFiles });
    if (!block || !block.table.length) {
      fail('index', t.indexMissing, expected);
    } else if (!tablesMatch(block.table, expected)) {
      fail('index', t.indexMismatch, expected);
    }
  }

  // 5. An open item vanished and the rest of the file did not change.
  // An item that moved to another state file did not vanish.
  const allTitles = new Set();
  for (const f of stateFiles) for (const item of findOpenItems(f.text)) allTitles.add(item.title);
  for (const c of stateChanges) {
    const before = headBlobs.get(headSpec(c));
    if (before == null) continue;
    const after = stateFiles.find((f) => f.path === c.path).text;
    const gone = findOpenItems(before).filter((item) => !allTitles.has(item.title));
    if (gone.length && withoutOpenItems(before) === withoutOpenItems(after)) {
      for (const item of gone) fail('vanished', t.vanished(item.title, c.path));
    }
  }

  if (!failures.length) return { exitCode: 0 };
  return {
    exitCode: settings.gate === 'warn' ? 0 : 1,
    output: report(t, settings.gate === 'warn' ? t.warned : t.blocked, failures),
  };
}

const FIXES = {
  unowned: 'unownedFix',
  starInGeneral: 'starInGeneralFix',
  pattern: 'patternFix',
  undocumented: 'undocumentedFix',
  budget: 'overBudgetFix',
  index: 'indexFix',
  vanished: 'vanishedFix',
};

function report(t, header, failures) {
  const out = [header];
  for (const kind of Object.keys(FIXES)) {
    const group = failures.filter((f) => f.kind === kind);
    if (!group.length) continue;
    out.push('');
    for (const f of group.slice(0, MAX_LISTED)) out.push(f.line);
    if (group.length > MAX_LISTED) out.push(t.more(group.length - MAX_LISTED));
    out.push(t[FIXES[kind]]);
    if (group[0].extra) out.push(...group[0].extra);
  }
  return out.join('\n') + '\n';
}

function main(argv) {
  const state = { language: 'en' };
  try {
    const result = runGate({ msgFile: argv[2], cwd: process.cwd(), state });
    if (result.output) process.stderr.write(result.output);
    return result.exitCode;
  } catch (err) {
    try {
      const reason = String((err && err.message) || err).split(/\r?\n/)[0];
      process.stderr.write(messagesFor(state.language).crashed(reason) + '\n');
    } catch (e) {
      // Nothing more to do. The commit goes through.
    }
    return 0;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = { runGate, main };
