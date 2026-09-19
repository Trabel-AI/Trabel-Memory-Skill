'use strict';

const { splitLines } = require('./text');
const { NEXT_PATH, STATE_DIR } = require('./settings');

// The index table inside the CLAUDE.md block. It is built from the cards,
// so the gate can compare what is written with what the cards say.

const BLOCK_START = '<!-- trabel-memory:start -->';
const BLOCK_END = '<!-- trabel-memory:end -->';

const LABELS = {
  he: { file: 'קובץ', what: 'מה בו', next: 'מה עושים עכשיו' },
  en: { file: 'File', what: "What's in it", next: 'What to do now' },
};

function labelsFor(language) {
  return LABELS[language] || LABELS.en;
}

function cell(text) {
  return String(text).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

// Row order: the queue, architecture, conventions, the other state files by
// path, then adopted files in the order settings.json lists them.
// stateFiles: [{ path, summary, adopted }]
function expectedRows({ language, hasNext, stateFiles }) {
  const labels = labelsFor(language);
  const rank = (f) =>
    f.adopted ? 3 : f.path === STATE_DIR + 'architecture.md' ? 0 : f.path === STATE_DIR + 'conventions.md' ? 1 : 2;
  const regular = stateFiles.filter((f) => !f.adopted);
  const adopted = stateFiles.filter((f) => f.adopted);
  regular.sort((a, b) => rank(a) - rank(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const rows = [];
  if (hasNext) rows.push([NEXT_PATH, labels.next]);
  for (const f of [...regular, ...adopted]) rows.push([f.path, f.summary || '']);
  return rows;
}

function renderTable(options) {
  const labels = labelsFor(options.language);
  return [
    `| ${labels.file} | ${labels.what} |`,
    '|---|---|',
    ...expectedRows(options).map(([p, s]) => `| ${cell(p)} | ${cell(s)} |`.replace(/ {2}\|$/, ' |')),
  ];
}

// Finds the block and the index table in it (the last table in the block).
// rulesLines counts from the start marker up to the table, which is not counted.
function extractBlock(text) {
  const lines = splitLines(text);
  const start = lines.findIndex((l) => l.trim() === BLOCK_START);
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.trim() === BLOCK_END);
  if (end < 0) end = lines.length;

  let tableStart = -1;
  let tableEnd = -1;
  for (let i = end - 1; i > start; i--) {
    const isRow = lines[i].trim().startsWith('|');
    if (isRow && tableEnd < 0) tableEnd = i + 1;
    if (tableEnd >= 0) {
      if (isRow) tableStart = i;
      else break;
    }
  }
  const table = tableStart >= 0 ? lines.slice(tableStart, tableEnd) : [];
  const rulesLines = (tableStart >= 0 ? tableStart : end) - start;
  return { table, rulesLines };
}

// Compares rows by their cells, so spacing and the separator style do not matter.
function normalizeRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t
    .split(/(?<!\\)\|/)
    .map((c) => c.trim())
    .map((c) => (/^:?-+:?$/.test(c) ? '---' : c.replace(/\s+/g, ' ')))
    .join('|');
}

function tablesMatch(actual, expected) {
  if (actual.length !== expected.length) return false;
  return actual.every((line, i) => normalizeRow(line) === normalizeRow(expected[i]));
}

module.exports = { BLOCK_START, BLOCK_END, expectedRows, renderTable, extractBlock, tablesMatch };
