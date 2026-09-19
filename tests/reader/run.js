#!/usr/bin/env node
'use strict';

// Runs the new-reader test on the fixed cases in cases.json and checks it is
// right on both sides: every "fail" case fails and every "pass" case passes.
// It calls the model, so it is not part of `node --test`.
//
//   node tests/reader/run.js [--claude <path to the claude executable>]
//
// The cases go through the same path as a real save: a Claude Code session
// with this repository loaded as a plugin for that session only
// (--plugin-dir, nothing is installed) hands the input, rendered by
// scripts/reader.js, to the trabel-memory:reader agent. The session runs in an
// empty folder, always the same one ($TMP/trabel-reader-test), so no project is
// read and Claude Code keeps a single folder for it under ~/.claude/projects.
// As in a real save, lines the answer skipped are sent once more
// (reader.js --missing), and only a line still unanswered counts as missing.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { render, idOf, missingFrom } = require('../../scripts/reader');

const REPO = path.join(__dirname, '..', '..');
const BATCH = 10;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

// Each case becomes one file. Ids are F<k>.L<n>, as reader.js gives them.
function toFiles(cases, first) {
  return cases.map((c, k) => {
    const n = (first + k + 1) * 10;
    const before = c.before || [];
    const lines = [
      ...before.map((t, j) => ({ n: n - before.length + j, text: t, judged: false })),
      { n, text: c.line, judged: true },
      ...(c.after || []).map((t, j) => ({ n: n + j + 1, text: t, judged: false })),
    ];
    return { id: idOf(k, n), file: { path: c.file, summary: c.summary, whole: false, sections: [{ headings: c.headings, lines }] } };
  });
}

function runClaude(claude, prompt, cwd) {
  return new Promise((resolve) => {
    const args = ['-p', '--plugin-dir', REPO, '--no-session-persistence', '--tools', 'Agent', '--model', 'haiku'];
    const child = spawn(claude, args, { cwd, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out, err }));
    child.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
    child.stdin.end(prompt);
  });
}

// Every {"id", "pass", ...} object in the answers, even when the JSON around
// it is broken. A later answer for the same id comes first.
function allResults(text) {
  const out = [];
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    try {
      const o = JSON.parse(m[0]);
      if (o && typeof o.id === 'string' && typeof o.pass === 'boolean') out.unshift(o);
    } catch (e) { /* not a whole result */ }
  }
  return out;
}

async function main() {
  const claude = arg('--claude') || 'claude';
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
  const cwd = path.join(os.tmpdir(), 'trabel-reader-test');
  fs.mkdirSync(cwd, { recursive: true });

  let resent = 0;
  const batches = [];
  for (let i = 0; i < cases.length; i += BATCH) batches.push({ first: i, cases: cases.slice(i, i + BATCH) });

  const outcomes = await Promise.all(batches.map(async (b) => {
    const items = toFiles(b.cases, b.first);
    const files = items.map((x) => x.file);
    const ask = (input) => runClaude(claude,
      'Use the trabel-memory:reader agent. Give it exactly the text between the markers below as its whole task, ' +
      'then print its answer exactly as it returned it, with nothing added.\n<<<\n' + input + '\n>>>', cwd);
    const r = await ask(render(files));
    const missing = missingFrom(files, r.out);
    if (missing.length) {
      const again = await ask(render(missing));
      resent += (render(missing).match(/^\[F\d+\.L\d+\]/gm) || []).length;
      r.out += '\n' + again.out;
      r.err += again.err;
    }
    const results = allResults(r.out);
    return b.cases.map((c, k) => {
      const got = results.find((x) => x && x.id === items[k].id);
      const verdict = got ? (got.pass ? 'pass' : 'fail') : 'missing';
      return { c, got, verdict, raw: got ? null : (r.out || r.err).slice(0, 400) };
    });
  }));

  const all = outcomes.flat();
  let wrong = 0;
  for (const o of all) {
    const ok = o.verdict === o.c.expect;
    if (!ok) wrong++;
    const why = o.got && !o.got.pass ? ` (${o.got.reason}: ${o.got.missing})` : '';
    console.log(`${ok ? 'ok   ' : 'WRONG'} ${o.c.expect.padEnd(4)} -> ${o.verdict.padEnd(7)} ${o.c.id}${why}`);
    if (o.raw) console.log('      output: ' + o.raw.replace(/\s+/g, ' '));
  }
  const fails = all.filter((o) => o.c.expect === 'fail');
  const passes = all.filter((o) => o.c.expect === 'pass');
  console.log(
    `\nMust fail: ${fails.filter((o) => o.verdict === 'fail').length}/${fails.length} failed. ` +
      `Must pass: ${passes.filter((o) => o.verdict === 'pass').length}/${passes.length} passed.` +
      (resent ? ` Sent again after a skipped answer: ${resent}.` : ''),
  );
  process.exitCode = wrong ? 1 : 0;
}

main();
