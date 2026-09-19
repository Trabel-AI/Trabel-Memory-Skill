#!/usr/bin/env node
'use strict';

// Checks the whole project, not only what a commit touches. Setup and save run
// it before committing, because the gate sees only the files in the commit:
// code that was already there without an owner never reaches it.
//
//   node check.js [--json]
//
// It reports:
// - unowned: code files, committed or not, that no state file owns.
// - over:    state files, the queue and the rules in the CLAUDE.md block that
//            are over their ceiling.
// - broad:   a single pattern in a domain file that holds more than 40% of the
//            code files (from 20 code files). The gate blocks it only in the
//            commit that changes the pattern; here it is a sign to split.

const fs = require('fs');
const path = require('path');
const { git, repoRoot } = require('./lib/git');
const S = require('./lib/settings');
const { loadFromDisk, readIfExists } = require('./lib/project');
const { buildOwnership } = require('./lib/owners');
const { toRegExp } = require('./lib/glob');
const { extractBlock } = require('./lib/indexTable');
const { countLines } = require('./lib/text');

// Code files in the working folder: tracked and untracked, deleted ones left out.
function workingCodeFiles(root, isCode) {
  const out = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).toString('utf8');
  return [...new Set(out.split('\0').filter(Boolean))]
    .filter((f) => isCode(f) && fs.existsSync(path.join(root, f)))
    .sort();
}

function checkProject(root) {
  const project = loadFromDisk(root);
  if (!project) return null;
  const isCode = S.makeIsCode(project.settings);
  const code = workingCodeFiles(root, isCode);
  const { ownersOf } = buildOwnership(project.stateFiles);

  const unowned = code.filter((f) => !ownersOf(f).length);

  const over = [];
  for (const f of project.stateFiles) {
    const n = countLines(f.text);
    if (n > f.budget) over.push({ file: f.path, lines: n, budget: f.budget });
  }
  const queue = readIfExists(path.join(root, S.NEXT_PATH));
  if (queue != null && countLines(queue) > S.NEXT_BUDGET) over.push({ file: S.NEXT_PATH, lines: countLines(queue), budget: S.NEXT_BUDGET });
  const claude = readIfExists(path.join(root, S.CLAUDE_PATH));
  const block = claude != null ? extractBlock(claude) : null;
  if (block && block.rulesLines > S.RULES_BUDGET) over.push({ file: `${S.CLAUDE_PATH} (the rules in the block)`, lines: block.rulesLines, budget: S.RULES_BUDGET });

  const broad = [];
  if (code.length >= S.BROAD_MIN_FILES) {
    for (const f of project.stateFiles) {
      if (f.general) continue;
      for (const p of f.owns) {
        const re = toRegExp(p);
        const n = code.filter((file) => re.test(file)).length;
        if (n / code.length > S.BROAD_SHARE) broad.push({ file: f.path, pattern: p, files: n, of: code.length, percent: Math.round((100 * n) / code.length) });
      }
    }
  }
  return { unowned, over, broad };
}

function render(r) {
  const out = [];
  if (r.unowned.length) {
    out.push(`Code with no owner (${r.unowned.length}). Give each an owner: an existing domain, or a new domain file.`);
    for (const f of r.unowned) out.push(`- ${f}`);
  }
  if (r.over.length) {
    if (out.length) out.push('');
    out.push('Over the ceiling. Shorten first; split only if that is not enough.');
    for (const o of r.over) out.push(`- ${o.file}: ${o.lines} lines, ceiling ${o.budget}`);
  }
  if (r.broad.length) {
    if (out.length) out.push('');
    out.push('Broad domains, a sign to split (the gate blocks such a pattern in a commit that changes it):');
    for (const b of r.broad) out.push(`- ${b.file}: "${b.pattern}" holds ${b.files} of ${b.of} code files (${b.percent}%)`);
  }
  return out.length ? out.join('\n') : 'All code has an owner, nothing is over its ceiling, and no domain is too broad.';
}

if (require.main === module) {
  let output;
  let code = 0;
  try {
    const r = checkProject(repoRoot(process.cwd()));
    if (!r) {
      output = `No memory in this project: ${S.SETTINGS_PATH} does not exist.`;
      code = 1;
    } else {
      output = process.argv.includes('--json') ? JSON.stringify(r, null, 2) : render(r);
    }
  } catch (err) {
    output = 'The check could not run: ' + String((err && err.message) || err).split(/\r?\n/)[0];
    code = 1;
  }
  process.stdout.write(output + '\n');
  process.exitCode = code;
}

module.exports = { checkProject, render };
