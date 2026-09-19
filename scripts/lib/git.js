'use strict';

const { execFileSync, spawnSync } = require('child_process');

// Git access. File names are read in -z form, so Hebrew names and names with
// spaces arrive exactly as they are.

function git(cwd, args, input) {
  return execFileSync('git', args, {
    cwd,
    input,
    encoding: 'buffer',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function gitText(cwd, args) {
  return git(cwd, args).toString('utf8');
}

function gitSucceeds(cwd, args) {
  const r = spawnSync('git', args, { cwd, stdio: 'ignore', windowsHide: true });
  return r.status === 0;
}

function repoRoot(cwd) {
  return gitText(cwd, ['rev-parse', '--show-toplevel']).trim();
}

function hasHead(root) {
  return gitSucceeds(root, ['rev-parse', '-q', '--verify', 'HEAD^{commit}']);
}

function isMerging(root) {
  return gitSucceeds(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
}

function splitZ(buffer) {
  const parts = buffer.toString('utf8').split('\0');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

// What goes into the commit, compared with HEAD (or with nothing on a first commit).
// Returns [{ status: 'A'|'M'|'D'|'R'|'C'|'T', path, oldPath? }].
function stagedChanges(root, withHead) {
  const args = ['diff', '--cached', '--name-status', '-z', '-M', '--no-ext-diff', '--no-relative'];
  if (withHead) args.push('HEAD');
  const parts = splitZ(git(root, args));
  const changes = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i][0];
    if (status === 'R' || status === 'C') {
      changes.push({ status, oldPath: parts[i + 1], path: parts[i + 2] });
      i += 3;
    } else {
      changes.push({ status, path: parts[i + 1] });
      i += 2;
    }
  }
  return changes;
}

// Files in the index (what the commit will contain).
function indexFiles(root, pathspec) {
  const args = ['ls-files', '-z', '--cached'];
  if (pathspec) args.push('--', pathspec);
  return [...new Set(splitZ(git(root, args)))];
}

// Reads many blobs in one git call. specs are like ':path' (the index) or
// 'HEAD:path'. Returns a Map from spec to text, or null when it does not exist.
function readBlobs(root, specs) {
  const result = new Map();
  if (!specs.length) return result;
  const out = git(root, ['cat-file', '--batch'], Buffer.from(specs.join('\n') + '\n', 'utf8'));
  let pos = 0;
  for (const spec of specs) {
    const nl = out.indexOf(0x0a, pos);
    const header = out.slice(pos, nl).toString('utf8');
    pos = nl + 1;
    const m = header.match(/^[0-9a-f]+ (\w+) (\d+)$/);
    if (!m) {
      result.set(spec, null);
      continue;
    }
    const size = Number(m[2]);
    result.set(spec, m[1] === 'blob' ? out.slice(pos, pos + size).toString('utf8') : null);
    pos += size + 1;
  }
  return result;
}

module.exports = { git, gitText, repoRoot, hasHead, isMerging, stagedChanges, indexFiles, readBlobs };
