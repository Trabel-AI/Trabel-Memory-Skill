'use strict';

const { toRegExp, specificity } = require('./glob');

// Which state file is responsible for a code file.
// When several patterns match, the most exact one wins (most fixed characters).
// Only a tie gives a file more than one owner.

function buildOwnership(stateFiles) {
  const compiled = stateFiles.map((f) => ({
    path: f.path,
    patterns: f.owns.map((p) => ({ re: toRegExp(p), score: specificity(p) })),
  }));

  function ownersOf(file) {
    let best = -1;
    let owners = [];
    for (const state of compiled) {
      let score = -1;
      for (const p of state.patterns) {
        if (p.score > score && p.re.test(file)) score = p.score;
      }
      if (score < 0) continue;
      if (score > best) {
        best = score;
        owners = [state.path];
      } else if (score === best) {
        owners.push(state.path);
      }
    }
    return owners;
  }

  return { ownersOf };
}

module.exports = { buildOwnership };
