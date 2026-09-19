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

module.exports = { stripBom, splitLines, countLines };
