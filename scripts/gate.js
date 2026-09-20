#!/usr/bin/env node
'use strict';

// The gate. Runs from the git commit-msg hook: node gate.js <message file>.
// Blocks a commit whose code changed while its docs did not.
// It fails open: if anything goes wrong inside, the commit goes through.

const fs = require('fs');
const path = require('path');

// The exit code for "blocked". The git hook blocks only on this code and lets
// the commit through on any other, so a broken plugin (a missing or damaged
// file, Node failing to start) never locks anyone out. Node itself never
// exits with 20.
const BLOCKED = 20;

// The helpers load inside main's try, so a broken helper file fails open
// with the usual warning.
let L = null;
function libs() {
  if (!L) {
    L = {
      G: require('./lib/git'),
      S: require('./lib/settings'),
      ...require('./lib/card'),
      ...require('./lib/glob'),
      ...require('./lib/owners'),
      ...require('./lib/openItems'),
      ...require('./lib/indexTable'),
      ...require('./lib/text'),
      ...require('./lib/project'),
      ...require('./lib/messages'),
      ...require('./lib/plan'),
    };
  }
  return L;
}

// The command that rebuilds the index, named in the index message.
const INDEX_COMMAND = `node "${path.join(__dirname, 'index.js').replace(/\\/g, '/')}"`;

const MAX_LISTED = 20;

// Message lines, without git's comment lines and without the diff that
// `git commit -v` adds below the scissors line.
function messageLines(text) {
  const { splitLines } = libs();
  const lines = [];
  for (const line of splitLines(text)) {
    if (/^# -+ >8 -+$/.test(line)) break;
    if (line.startsWith('#')) continue;
    lines.push(line);
  }
  return lines;
}

function sameList(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// Everything the gate knows about the state files, as the commit will leave them.
function loadStateFiles(root, settings) {
  const { G, S, stateEntry, adoptedEntry } = libs();
  const mdPaths = G.indexFiles(root, S.STATE_DIR)
    .filter((p) => p.startsWith(S.STATE_DIR) && p.toLowerCase().endsWith('.md'));
  const adoptedPaths = settings.adopted.map((a) => a.path);
  const blobs = G.readBlobs(root, [...mdPaths, ...adoptedPaths].map((p) => ':' + p));

  const files = [];
  for (const p of mdPaths) {
    const text = blobs.get(':' + p);
    if (text != null) files.push(stateEntry(p, text));
  }
  for (const a of settings.adopted) {
    const text = blobs.get(':' + a.path);
    if (text != null) files.push(adoptedEntry(a, text));
  }
  return files;
}

function runGate({ msgFile, cwd, state }) {
  const {
    G, S, parseCard, hasStar, isAllStars, toRegExp, buildOwnership, findOpenItems, withoutOpenItems,
    renderTable, extractBlock, tablesMatch, countLines, hasTrailer, messagesFor, parseQueue, checkPlan, planPathsOf,
  } = libs();
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

  // The queue, as the commit will leave it and as the last commit left it.
  // The plan file it points at is not code, wherever it is.
  const special = G.readBlobs(root, [':' + S.NEXT_PATH, ':' + S.CLAUDE_PATH, ...(withHead ? ['HEAD:' + S.NEXT_PATH] : [])]);
  const nextText = special.get(':' + S.NEXT_PATH);
  const claudeText = special.get(':' + S.CLAUDE_PATH);
  const headNextText = withHead ? special.get('HEAD:' + S.NEXT_PATH) : null;

  const isCode = S.makeIsCode(settings, planPathsOf(nextText, headNextText));
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
      if (codeFiles.length < S.BROAD_MIN_FILES) continue;
      const re = toRegExp(p);
      const n = codeFiles.filter((file) => re.test(file)).length;
      if (n / codeFiles.length > S.BROAD_SHARE) {
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

  // 6. Working from a plan. Runs when the queue, in this commit or in the last
  // one, points at a plan file.
  const queueBefore = parseQueue(headNextText);
  const queueAfter = parseQueue(nextText);
  if (queueBefore || queueAfter) {
    const planChange = new Map();
    for (const c of changes) {
      planChange.set(c.path, c.status);
      if (c.oldPath && c.status === 'R') planChange.set(c.oldPath, 'D');
    }
    const found = checkPlan({
      before: queueBefore,
      after: queueAfter,
      exists: (p) => G.readBlobs(root, [':' + p]).get(':' + p) != null,
      changeOf: (p) => planChange.get(p) || null,
      decision: hasTrailer(message, 'Decision'),
    });
    for (const f of found) {
      if (f.kind === 'planMissing') fail(f.kind, t.planMissing(f.plan));
      else if (f.kind === 'planJump') fail(f.kind, t.planJump(f.from, f.to));
      else if (f.kind === 'planBack') fail(f.kind, t.planBack(f.from, f.to));
      else if (f.kind === 'planList') fail(f.kind, t.planList, f.expected.length ? [t.planListExpected, ...f.expected] : [t.planListNone]);
      else if (f.kind === 'planEdited') fail(f.kind, t.planEdited(f.plan));
      else fail('planDropped', t.planDropped(f.plan, f.n, f.m));
    }
  }

  if (!failures.length) return { exitCode: 0 };
  return {
    exitCode: settings.gate === 'warn' ? 0 : BLOCKED,
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
  planMissing: 'planMissingFix',
  planJump: 'planJumpFix',
  planBack: 'planBackFix',
  planList: 'planListFix',
  planEdited: 'planEditedFix',
  planDropped: 'planDroppedFix',
};

function report(t, header, failures) {
  const out = [header];
  for (const kind of Object.keys(FIXES)) {
    const group = failures.filter((f) => f.kind === kind);
    if (!group.length) continue;
    out.push('');
    for (const f of group.slice(0, MAX_LISTED)) out.push(f.line);
    if (group.length > MAX_LISTED) out.push(t.more(group.length - MAX_LISTED));
    const fix = t[FIXES[kind]];
    out.push(typeof fix === 'function' ? fix(INDEX_COMMAND) : fix);
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
      process.stderr.write(require('./lib/messages').messagesFor(state.language).crashed(reason) + '\n');
    } catch (e) {
      // Nothing more to do. The commit goes through.
    }
    return 0;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = { runGate, main, BLOCKED };
