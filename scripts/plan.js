#!/usr/bin/env node
'use strict';

// Working from a plan: where the work stands, read from the queue, and the
// mechanical moves between sessions. The plan file itself is never changed.
//
//   node plan.js [--json]   where the work stands, and what the gate would
//                           block in the next commit
//   node plan.js --advance  every task of session N is ticked: rewrites the
//                           queue for session N+1, with its tasks left to write
//   node plan.js --finish   every task of the last session is ticked: deletes
//                           the plan file and takes the plan out of the queue
//
// --advance and --finish refuse, with exit code 1, when the session is not
// finished. --finish also refuses when git does not hold the plan file exactly
// as it is, because git is the only place that remembers it.

const fs = require('fs');
const path = require('path');
const { git, gitText, repoRoot, hasHead, readBlobs } = require('./lib/git');
const S = require('./lib/settings');
const { loadFromDisk, readIfExists } = require('./lib/project');
const { parseQueue, checkPlan, advanceQueue, finishQueue } = require('./lib/plan');
const { messagesFor } = require('./lib/messages');

const MAX_CANDIDATES = 10;

// The change of one path in the working folder, compared with the last commit.
function changeOf(root, file) {
  const out = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', file]).toString('utf8');
  const entry = out.split('\0').find((e) => e.length > 3);
  if (!entry) return null;
  const xy = entry.slice(0, 2);
  return xy === '??' || xy.includes('A') ? 'A' : xy.includes('D') ? 'D' : 'M';
}

// Files that may be a build plan: .md files under docs/ outside docs/state/
// (the queue left out), and .md files at the root with "plan" in their name.
function candidates(root, settings) {
  const adopted = new Set(settings.adopted.map((a) => a.path));
  const out = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).toString('utf8');
  return [...new Set(out.split('\0').filter(Boolean))]
    .filter((f) => /\.md$/i.test(f) && !adopted.has(f) && fs.existsSync(path.join(root, f)))
    .filter((f) => (f.startsWith('docs/') ? !f.startsWith(S.STATE_DIR) && f !== S.NEXT_PATH : !f.includes('/') && /plan/i.test(f)))
    .sort();
}

function status(root, project) {
  const text = readIfExists(path.join(root, S.NEXT_PATH));
  const q = parseQueue(text);
  if (!q) return { plan: null, hasQueue: text != null, candidates: candidates(root, project.settings) };

  const headText = hasHead(root) ? readBlobs(root, ['HEAD:' + S.NEXT_PATH]).get('HEAD:' + S.NEXT_PATH) : null;
  const tracked = gitText(root, ['ls-files', '--', q.plan]).trim() !== '';
  const before = parseQueue(headText);
  const failures = checkPlan({
    before,
    after: q,
    exists: (p) => fs.existsSync(path.join(root, p)),
    changeOf: (p) => changeOf(root, p),
    decision: false,
  });
  return {
    plan: q.plan,
    planExists: fs.existsSync(path.join(root, q.plan)),
    planTracked: tracked,
    n: q.n,
    m: q.m,
    title: q.title,
    tasks: q.tasks.map((t) => ({ done: t.done, text: t.text })),
    left: q.left.map((s) => ({ number: s.number, text: s.text })),
    problems: q.problems,
    failures,
  };
}

function render(s) {
  if (!s.plan) {
    const out = [s.hasQueue ? `The queue (${S.NEXT_PATH}) has no plan reference: it is a plain queue.` : `There is no queue (${S.NEXT_PATH}).`];
    if (s.candidates.length) {
      out.push('', 'Files that may be a build plan, and that the queue does not point at:');
      for (const f of s.candidates.slice(0, MAX_CANDIDATES)) out.push(`- ${f}`);
      if (s.candidates.length > MAX_CANDIDATES) out.push(`- and ${s.candidates.length - MAX_CANDIDATES} more`);
    }
    return out.join('\n');
  }

  const t = messagesFor('en');
  const done = s.tasks.filter((x) => x.done).length;
  const out = [
    `Plan: ${s.plan}${s.planExists ? (s.planTracked ? '' : ' (not in git yet: add it to the next commit)') : ' (the file does not exist)'}`,
    `Session ${s.n} of ${s.m}${s.title ? ': ' + s.title : ''}`,
    `${done} of ${s.tasks.length} tasks done.`,
    ...s.tasks.map((x) => `- [${x.done ? 'x' : ' '}] ${x.text}`),
  ];
  if (s.left.length) out.push('', 'Sessions left:', ...s.left.map((x) => `${x.number}. ${x.text}`));
  else out.push('', 'This is the last session.');

  if (s.tasks.length && done === s.tasks.length) {
    out.push('', s.n < s.m ? `Every task is ticked: session ${s.n} is finished. The save moves the queue on with --advance.` : 'Every task is ticked: the last session is finished. The save ends the plan with --finish.');
  }
  if (s.problems.length) out.push('', 'Problems in the queue:', ...s.problems.map((p) => `- ${p}`));

  out.push('', 'Compared with the last commit:');
  if (!s.failures.length) out.push('Nothing here would be blocked by the gate.');
  for (const f of s.failures) {
    out.push(`- ${planMessage(t, f)} ${t[f.kind + 'Fix']}`);
    if (f.expected && f.expected.length) out.push(...f.expected.map((l) => `    ${l}`));
  }
  return out.join('\n');
}

function planMessage(t, f) {
  switch (f.kind) {
    case 'planMissing': return t.planMissing(f.plan);
    case 'planJump': return t.planJump(f.from, f.to);
    case 'planBack': return t.planBack(f.from, f.to);
    case 'planList': return t.planList;
    case 'planEdited': return t.planEdited(f.plan);
    default: return t.planDropped(f.plan, f.n, f.m);
  }
}

function advance(root) {
  const file = path.join(root, S.NEXT_PATH);
  const r = advanceQueue(readIfExists(file) || '');
  if (!r.ok) return { code: 1, output: r.reason };
  fs.writeFileSync(file, r.text);
  return {
    code: 0,
    output: `The queue now stands on Session ${r.n} of ${r.m}: ${r.title}\nWrite its tasks under the session line, a checkbox each, from that part of the plan. Change nothing else in the queue.`,
  };
}

function finish(root, project) {
  const file = path.join(root, S.NEXT_PATH);
  const text = readIfExists(file) || '';
  const r = finishQueue(text, messagesFor(project.settings.language).queueEmpty);
  if (!r.ok) return { code: 1, output: r.reason };

  const planFile = path.join(root, r.plan);
  if (fs.existsSync(planFile)) {
    const tracked = gitText(root, ['ls-files', '--', r.plan]).trim() !== '';
    const inHead = hasHead(root) && readBlobs(root, ['HEAD:' + r.plan]).get('HEAD:' + r.plan) != null;
    if (!tracked || !inHead || changeOf(root, r.plan)) {
      return {
        code: 1,
        output: `${r.plan} is not committed as it is now, so deleting it would lose it: git is the only place that remembers the plan. Commit it first (a changed plan needs a Decision: line), then run --finish again.`,
      };
    }
    fs.rmSync(planFile);
  }
  fs.writeFileSync(file, r.text);
  return {
    code: 0,
    output: `The plan is finished: ${r.plan} is deleted and the plan left the queue. Commit both together with the last session's work. What failed in the last session is written as open items in its domain file.`,
  };
}

if (require.main === module) {
  let result;
  try {
    const root = repoRoot(process.cwd());
    const project = loadFromDisk(root);
    if (!project) {
      result = { code: 1, output: `No memory in this project: ${S.SETTINGS_PATH} does not exist.` };
    } else if (process.argv.includes('--advance')) {
      result = advance(root);
    } else if (process.argv.includes('--finish')) {
      result = finish(root, project);
    } else {
      const s = status(root, project);
      result = { code: 0, output: process.argv.includes('--json') ? JSON.stringify(s, null, 2) : render(s) };
    }
  } catch (err) {
    result = { code: 1, output: 'The plan check could not run: ' + String((err && err.message) || err).split(/\r?\n/)[0] };
  }
  process.stdout.write(result.output + '\n');
  process.exitCode = result.code;
}

module.exports = { status, render, planMessage };
