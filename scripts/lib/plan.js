'use strict';

const { splitLines } = require('./text');

// Working from a plan. The plan is a file the person wrote, in any shape; the
// plugin only reads it. Where the work stands is written in the queue alone:
//
//   Plan: docs/plan.md
//   Session 2 of 5: The customers screen
//
//   - [ ] The customers table
//
//   Sessions left:
//   3. Quotes (in the plan: chapter 4)
//
// The reference is recognised by its shape, so it works in any language: a
// "label: path" line, and right below it a line with two numbers (N, then M)
// before its first colon. The plan section runs until the next heading. Its
// checkboxes are the tasks of session N, and its unindented numbered lines are
// the sessions left. A queue without the reference is a plain queue.

const MARKER = /^[-*+#>|\d\s]/;
const PLAN_LINE = /^[^:]+:\s*(\S.*)$/;
const SESSION_LINE = /^[^\d:]*?(\d+)[^\d:]+?(\d+)\s*(?::\s*(.*))?$/;
const HEADING = /^#{1,6}\s/;
const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s*(.*)$/;
const SESSION_ITEM = /^(\d+)[.)]\s+(.+)$/;

function planPath(raw) {
  let p = raw.trim();
  const link = p.match(/^\[[^\]]*\]\(([^)]+)\)$/);
  if (link) {
    p = link[1].trim();
    try {
      p = decodeURIComponent(p);
    } catch (e) {
      // Not an encoded path. Keep it as it is.
    }
  }
  return p.replace(/^`(.*)`$/, '$1').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

// null when the queue has no plan reference.
function parseQueue(text) {
  if (text == null) return null;
  const lines = splitLines(text);
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i];
    const b = lines[i + 1];
    if (MARKER.test(a) || MARKER.test(b)) continue;
    const pm = a.match(PLAN_LINE);
    const sm = b.trim().match(SESSION_LINE);
    if (!pm || !sm) continue;
    const plan = planPath(pm[1]);
    const n = Number(sm[1]);
    const m = Number(sm[2]);
    if (!plan || n < 1 || n > m) continue;

    let end = i + 2;
    while (end < lines.length && !HEADING.test(lines[end])) end++;
    const tasks = [];
    const left = [];
    for (let k = i + 2; k < end; k++) {
      const task = lines[k].match(TASK);
      if (task) {
        tasks.push({ line: k, done: task[1] !== ' ', text: task[2].trim() });
        continue;
      }
      const item = lines[k].match(SESSION_ITEM);
      if (item) left.push({ line: k, number: Number(item[1]), text: item[2].trim().replace(/\s+/g, ' ') });
    }

    const problems = [];
    const expected = Array.from({ length: m - n }, (_, k) => n + 1 + k);
    if (left.length !== expected.length || left.some((s, k) => s.number !== expected[k])) {
      problems.push(
        expected.length
          ? `The list of sessions left must hold sessions ${expected.join(', ')}, one unindented line each ("${expected[0]}. name (where in the plan)"), and it holds ${left.length ? left.map((s) => s.number).join(', ') : 'none'}.`
          : `Session ${n} of ${m} is the last one, so no sessions are left, and the list holds ${left.map((s) => s.number).join(', ')}.`,
      );
    }
    if (!tasks.length) problems.push(`Session ${n} has no tasks: write its tasks under the session line, a checkbox each, from its part of the plan.`);

    return { plan, n, m, title: (sm[3] || '').trim(), planLine: i, sessionLine: i + 1, end, tasks, left, problems };
  }
  return null;
}

const sameList = (a, b) => a.length === b.length && a.every((s, i) => s.number === b[i].number && s.text === b[i].text);

// What the gate blocks between the queue of the last commit (before) and the
// queue going into this one (after); either may be null. exists(path) says
// whether the plan file is there, changeOf(path) gives its change in this
// commit ('A', 'M', 'D', ...) or null, decision is whether the commit message
// has a Decision: line. Returns [{ kind, ... }].
function checkPlan({ before, after, exists, changeOf, decision }) {
  const out = [];
  if (!before && !after) return out;

  if (after && !exists(after.plan)) out.push({ kind: 'planMissing', plan: after.plan });

  const samePlan = before && after && before.plan === after.plan;
  if (samePlan) {
    if (after.n < before.n) out.push({ kind: 'planBack', from: before.n, to: after.n });
    else if (after.n > before.n + 1) out.push({ kind: 'planJump', from: before.n, to: after.n });
    else if (!decision) {
      const expected = after.n === before.n ? before.left : before.left.slice(1);
      if (after.m !== before.m || !sameList(after.left, expected)) {
        out.push({ kind: 'planList', expected: expected.map((s) => `${s.number}. ${s.text}`) });
      }
    }
  }

  if (!decision) {
    for (const p of new Set([before && before.plan, after && after.plan].filter(Boolean))) {
      const change = changeOf(p);
      if (change === 'M' || change === 'T') out.push({ kind: 'planEdited', plan: p });
    }
    const dropped = before && (!samePlan || changeOf(before.plan) === 'D');
    const missingReported = after && after.plan === (before && before.plan) && out.some((f) => f.kind === 'planMissing');
    if (dropped && before.n < before.m && !missingReported) {
      out.push({ kind: 'planDropped', plan: before.plan, n: before.n, m: before.m });
    }
  }
  return out;
}

function eolOf(text) {
  return /\r\n/.test(text) ? '\r\n' : '\n';
}

function join(text, lines) {
  const bom = text.charCodeAt(0) === 0xfeff ? String.fromCharCode(0xfeff) : '';
  return bom + lines.join(eolOf(text)) + eolOf(text);
}

// The queue for session N+1: the top line of the list becomes the session
// line, and the tasks are left for Claude to write from the plan.
// { ok: true, text, n, m, title } or { ok: false, reason }.
function advanceQueue(text) {
  const q = parseQueue(text);
  if (!q) return { ok: false, reason: 'The queue has no plan reference.' };
  if (!q.tasks.length) return { ok: false, reason: `Session ${q.n} has no tasks written, so it cannot be finished.` };
  const open = q.tasks.filter((t) => !t.done);
  if (open.length) {
    return { ok: false, reason: `Session ${q.n} of ${q.m} is not finished, so the queue stays on it. Open tasks:\n${open.map((t) => `- [ ] ${t.text}`).join('\n')}` };
  }
  if (q.n === q.m) return { ok: false, reason: `Session ${q.n} of ${q.m} is the last one. Use --finish.` };
  const listProblem = q.problems.find((p) => p.startsWith('The list'));
  if (listProblem) return { ok: false, reason: listProblem };

  const lines = splitLines(text);
  const next = q.left[0];
  const session = lines[q.sessionLine];
  const colon = session.indexOf(':');
  const head = (colon < 0 ? session : session.slice(0, colon)).replace(/\d+/, String(q.n + 1)).trimEnd();

  // Between the session line and the list: the tasks go, and the list's label
  // (a line ending with a colon right above the list) stays while sessions are left.
  let labelAt = next.line - 1;
  while (labelAt > q.sessionLine && !lines[labelAt].trim()) labelAt--;
  const hasLabel = labelAt > q.sessionLine && /[:：]\s*$/.test(lines[labelAt]) && !TASK.test(lines[labelAt]);
  const rest = q.left.slice(1);
  const lastListLine = q.left[q.left.length - 1].line;

  const out = [...lines.slice(0, q.sessionLine), `${head}: ${next.text}`, ''];
  if (rest.length) {
    if (hasLabel) out.push('', lines[labelAt]);
    out.push(...rest.map((s) => lines[s.line]));
  }
  const tail = lines.slice(lastListLine + 1);
  while (tail.length && !tail[0].trim()) tail.shift();
  while (tail.length && !tail[tail.length - 1].trim()) tail.pop();
  if (tail.length) out.push('', ...tail);
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return { ok: true, text: join(text, out), n: q.n + 1, m: q.m, title: next.text };
}

// The queue after the last session: the plan section leaves it. emptyLine is
// written when nothing else is left in the queue.
function finishQueue(text, emptyLine) {
  const q = parseQueue(text);
  if (!q) return { ok: false, reason: 'The queue has no plan reference.' };
  if (q.n < q.m) return { ok: false, reason: `Session ${q.n} of ${q.m} is not the last one. Use --advance.` };
  const open = q.tasks.filter((t) => !t.done);
  if (!q.tasks.length || open.length) {
    return { ok: false, reason: `The last session is not finished, so the plan stays. Open tasks:\n${open.map((t) => `- [ ] ${t.text}`).join('\n') || '(no tasks are written)'}` };
  }
  const lines = splitLines(text);
  const before = lines.slice(0, q.planLine);
  const after = lines.slice(q.end);
  while (before.length && !before[before.length - 1].trim()) before.pop();
  while (after.length && !after[0].trim()) after.shift();
  while (after.length && !after[after.length - 1].trim()) after.pop();
  const rest = after.length ? after : [emptyLine];
  return { ok: true, text: join(text, before.length ? [...before, '', ...rest] : rest), plan: q.plan };
}

// The plan paths a queue text names, for "the plan file is not code".
function planPathsOf(...texts) {
  const paths = [];
  for (const text of texts) {
    const q = text != null ? parseQueue(text) : null;
    if (q && !paths.includes(q.plan)) paths.push(q.plan);
  }
  return paths;
}

module.exports = { parseQueue, checkPlan, advanceQueue, finishQueue, planPathsOf };
