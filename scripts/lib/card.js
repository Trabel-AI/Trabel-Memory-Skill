'use strict';

const { splitLines } = require('./text');

// Reads the card at the top of a state file:
//   ---
//   name: ...
//   summary: ...
//   owns:
//     - src/lib/x.ts
//   budget: 300
//   ---
// Returns null when the file has no card.

function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseCard(text) {
  const lines = splitLines(text);
  if (!lines.length || lines[0].trim() !== '---') return null;
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end < 0) return null;

  const raw = {};
  let listKey = null;
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = line.match(/^\s*-\s+(.*)$/) || line.match(/^\s*-$/);
    if (item && listKey) {
      const value = unquote(item[1] || '');
      if (value) raw[listKey].push(value);
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value.trim() === '') {
      raw[key] = [];
      listKey = key;
    } else if (/^\[.*\]$/.test(value.trim())) {
      raw[key] = value.trim().slice(1, -1).split(',').map(unquote).filter(Boolean);
      listKey = null;
    } else {
      raw[key] = unquote(value);
      listKey = null;
    }
  }

  const str = (v) => (typeof v === 'string' ? v : '');
  const budget = parseInt(raw.budget, 10);
  return {
    name: str(raw.name),
    summary: str(raw.summary),
    owns: Array.isArray(raw.owns) ? raw.owns : raw.owns ? [raw.owns] : [],
    budget: Number.isFinite(budget) && budget > 0 ? budget : null,
  };
}

module.exports = { parseCard };
