#!/usr/bin/env node
'use strict';

// Prepares the input of the new-reader test: the lines that changed in the
// state files since the last commit, each with its address and nothing more.
// The address is what a real reader knows on reaching the line: the file, the
// summary from its card, and the headings above it. Headings are not judged:
// they are the address of the lines under them. A line in a list or a
// table comes with the rest of that list or table, as context that is not
// judged. A new state file is sent whole.
//
//   node reader.js [--json]
//   node reader.js --missing < answers
//
// The save hands this output, as it is, to the reader agent (agents/reader.md).
// tests/reader renders its fixed cases with the same render function.
//
// --missing reads the reader's answers on stdin (one or more, one after the
// other) and prints the input again with only the lines no answer covers, so
// they are sent again. A line is covered by an object in the answers with its
// id and a "pass" of true or false; broken JSON around it does not matter.

const { git, gitText, repoRoot, hasHead } = require('./lib/git');
const S = require('./lib/settings');
const { loadFromDisk } = require('./lib/project');
const { splitLines } = require('./lib/text');

// Line numbers (1-based) of the lines added or changed since HEAD.
function changedLineNumbers(root, file) {
  const diff = gitText(root, ['diff', '--no-color', '--no-ext-diff', '-U0', 'HEAD', '--', file]);
  const numbers = new Set();
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i++) numbers.add(start + i);
  }
  return numbers;
}

function inHead(root, file) {
  try {
    git(root, ['cat-file', '-e', `HEAD:${file}`]);
    return true;
  } catch (e) {
    return false;
  }
}

// Index of the first line after the card, or 0 without a card.
function bodyStart(lines) {
  if (!lines.length || lines[0].trim() !== '---') return 0;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  return end < 0 ? 0 : end + 1;
}

const isHeading = (l) => /^#{1,6}\s/.test(l);
const isListOrTable = (l) => /^\s*([-*+]|\d+[.)])\s/.test(l) || /^\s*\|/.test(l);
// Lines with nothing to judge: blank, headings (they are the address of the
// lines under them), fences, rules, table separators.
const isNoise = (l) => !l.trim() || isHeading(l) || /^\s*(```|~~~)/.test(l) || /^\s*[-*_]{3,}\s*$/.test(l) || /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l);

// The headings above line i, outermost first.
function headingsAbove(lines, i, from) {
  const chain = [];
  let level = 7;
  for (let j = i - 1; j >= from && level > 1; j--) {
    const m = lines[j].match(/^(#{1,6})\s+(.*)$/);
    if (m && m[1].length < level) {
      chain.unshift(lines[j].trim());
      level = m[1].length;
    }
  }
  return chain;
}

// The list or table around line i: [first, last] indexes, inclusive.
function blockAround(lines, i, from) {
  if (!isListOrTable(lines[i])) return [i, i];
  const inBlock = (l) => l.trim() && !isHeading(l) && (isListOrTable(l) || /^\s{2,}\S/.test(l));
  let a = i;
  let b = i;
  while (a - 1 >= from && inBlock(lines[a - 1])) a--;
  while (b + 1 < lines.length && inBlock(lines[b + 1])) b++;
  return [a, b];
}

// { path, summary, whole, sections: [{ headings, lines: [{ n, text, judged }] }] }
function describeFile(entry, text, changed) {
  const lines = splitLines(text);
  const from = bodyStart(lines);
  const judged = [];
  for (let i = from; i < lines.length; i++) {
    if ((changed === 'all' || changed.has(i + 1)) && !isNoise(lines[i])) judged.push(i);
  }
  if (!judged.length) return null;

  const segments = [];
  for (const i of judged) {
    const [a, b] = changed === 'all' ? [i, i] : blockAround(lines, i, from);
    const headings = headingsAbove(lines, a, from);
    const last = segments[segments.length - 1];
    const joins = last && last.headings.join('\n') === headings.join('\n') && lines.slice(last.b + 1, a).every(isNoise);
    if (joins) last.b = Math.max(last.b, b);
    else segments.push({ a, b, headings });
  }
  const set = new Set(judged);
  return {
    path: entry.path,
    summary: entry.summary,
    whole: changed === 'all',
    sections: segments.map((s) => ({
      headings: s.headings,
      lines: lines.slice(s.a, s.b + 1)
        .map((t, k) => ({ n: s.a + k + 1, text: t, judged: set.has(s.a + k) }))
        .filter((l) => l.judged || !isNoise(l.text)),
    })),
  };
}

function collectChanged(root) {
  const project = loadFromDisk(root);
  if (!project) return null;
  const head = hasHead(root);
  const files = [];
  for (const entry of project.stateFiles) {
    const whole = !head || !inHead(root, entry.path);
    const changed = whole ? 'all' : changedLineNumbers(root, entry.path);
    if (changed !== 'all' && !changed.size) continue;
    const d = describeFile(entry, entry.text, changed);
    if (d) files.push(d);
  }
  return files;
}

// A judged line's id: the file's place in the input and the line's number in
// that file. The line number alone is not unique when two files change.
const idOf = (fileIndex, n) => `F${fileIndex + 1}.L${n}`;

// The text the reader agent gets. Judged lines carry an id, [F<k>.L<n>];
// context lines are indented and carry none. A null in files is a file with
// nothing left to judge: it is skipped, and the files after it keep their ids.
function render(files) {
  if (!files.some(Boolean)) return 'No state lines changed.';
  const out = [];
  files.forEach((f, k) => {
    if (!f) return;
    out.push(`=== File: ${f.path}${f.whole ? ' (the whole file is new)' : ''}`);
    out.push(`About this file: ${f.summary || '(no summary)'}`);
    for (const s of f.sections) {
      out.push(`--- Under: ${s.headings.length ? s.headings.join(' > ') : '(top of the file)'}`);
      for (const l of s.lines) out.push(l.judged ? `[${idOf(k, l.n)}] ${l.text}` : `       ${l.text}`);
    }
    out.push('');
  });
  const count = files.filter(Boolean).reduce((n, f) => n + f.sections.reduce((m, s) => m + s.lines.filter((l) => l.judged).length, 0), 0);
  out.push(`${count} line${count === 1 ? '' : 's'} to judge.`);
  return out.join('\n');
}

// The ids the answers cover: each {...} with an "id" and a boolean "pass".
function answeredIds(answers) {
  const ids = new Set();
  for (const m of String(answers).matchAll(/\{[^{}]*\}/g)) {
    const id = m[0].match(/"id"\s*:\s*"([^"]+)"/);
    if (id && /"pass"\s*:\s*(true|false)/.test(m[0])) ids.add(id[1]);
  }
  return ids;
}

// The same files with only the judged lines no answer covers. Ids are kept:
// a line keeps its id when it is sent again. Returns [] when all are covered.
function missingFrom(files, answers) {
  const done = answeredIds(answers);
  const out = [];
  files.forEach((f, k) => {
    const sections = f.sections
      .map((s) => ({ ...s, lines: s.lines.map((l) => (l.judged && done.has(idOf(k, l.n)) ? { ...l, judged: false } : l)) }))
      .filter((s) => s.lines.some((l) => l.judged));
    out.push(sections.length ? { ...f, sections } : null);
  });
  return out.some(Boolean) ? out : [];
}

if (require.main === module) {
  let output;
  let code = 0;
  try {
    const files = collectChanged(repoRoot(process.cwd()));
    if (!files) {
      output = `No memory in this project: ${S.SETTINGS_PATH} does not exist.`;
      code = 1;
    } else if (process.argv.includes('--missing')) {
      const missing = missingFrom(files, require('fs').readFileSync(0, 'utf8'));
      output = missing.length ? render(missing) : 'Every line has an answer.';
    } else {
      output = process.argv.includes('--json') ? JSON.stringify(files, null, 2) : render(files);
    }
  } catch (err) {
    output = 'The changed lines could not be collected: ' + String((err && err.message) || err).split(/\r?\n/)[0];
    code = 1;
  }
  process.stdout.write(output + '\n');
  process.exitCode = code;
}

module.exports = { collectChanged, describeFile, render, idOf, missingFrom };
