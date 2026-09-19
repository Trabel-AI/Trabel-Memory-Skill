'use strict';

// Line handling that treats CRLF and LF files the same.

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function splitLines(text) {
  const lines = stripBom(text).split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function countLines(text) {
  return splitLines(text).length;
}

// A commit message line like "Docs-Unchanged: reason". A line with nothing
// after the colon does not count.
function hasTrailer(lines, key) {
  const re = new RegExp('^' + key + ':\\s*\\S', 'i');
  return lines.some((l) => re.test(l.trim()));
}

module.exports = { stripBom, splitLines, countLines, hasTrailer };
