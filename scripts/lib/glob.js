'use strict';

// Path patterns. Always matched against the full path from the repo root.
//   *   any characters inside one folder level
//   **  any number of folder levels, including none (as a whole segment)
//   ?   one character inside one folder level

function cleanPattern(pattern) {
  return String(pattern).trim().replace(/^\.\//, '').replace(/^\/+/, '');
}

function toRegExp(pattern, flags = '') {
  const p = cleanPattern(pattern);
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      let j = i;
      while (p[j] === '*') j++;
      const wholeSegment = j - i > 1 && (i === 0 || p[i - 1] === '/');
      if (wholeSegment && p[j] === '/') {
        re += '(?:.*/)?';
        i = j; // the loop step skips the slash
      } else if (wholeSegment && j === p.length) {
        re += '.*';
        i = j - 1;
      } else {
        re += '[^/]*';
        i = j - 1;
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + re + '$', flags);
}

// How exact a pattern is: the number of fixed characters (everything but '*').
function specificity(pattern) {
  return cleanPattern(pattern).replace(/\*/g, '').length;
}

// A pattern made only of stars and slashes matches everything: '**', '*', '**/*'.
function isAllStars(pattern) {
  return /^[*/]+$/.test(cleanPattern(pattern));
}

function hasStar(pattern) {
  return cleanPattern(pattern).includes('*');
}

module.exports = { cleanPattern, toRegExp, specificity, isAllStars, hasStar };
