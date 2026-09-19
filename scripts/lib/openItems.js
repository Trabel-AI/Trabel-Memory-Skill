'use strict';

const { splitLines } = require('./text');

// An open item is a '###' heading whose first line below is a word, a colon
// and a date in YYYY-MM-DD format. It runs until the next heading of any level.
// This works in any language, because only the shape is checked.

const ITEM_HEADING = /^###\s+(.+?)\s*#*\s*$/;
const ANY_HEADING = /^#{1,6}\s/;
const OPENED_LINE = /^[^\s:]+:\s*\d{4}-\d{2}-\d{2}(\s|$)/;

function findOpenItems(text) {
  const lines = splitLines(text);
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(ITEM_HEADING);
    if (!heading) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j >= lines.length || !OPENED_LINE.test(lines[j].trim())) continue;
    let end = i + 1;
    while (end < lines.length && !ANY_HEADING.test(lines[end])) end++;
    items.push({ title: heading[1], start: i, end });
  }
  return items;
}

// The file with all open items removed, blank lines and trailing spaces
// ignored, so two versions can be compared for "the rest of the file".
function withoutOpenItems(text) {
  const lines = splitLines(text);
  const skip = new Set();
  for (const item of findOpenItems(text)) {
    for (let i = item.start; i < item.end; i++) skip.add(i);
  }
  return lines
    .filter((line, i) => !skip.has(i))
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line !== '')
    .join('\n');
}

module.exports = { findOpenItems, withoutOpenItems };
