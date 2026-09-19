---
name: save
description: Saves work in a project with trabel-memory - updates the state files from the diff, runs the new-reader test on the changed lines, and commits code and docs together through the gate. Use at the end of meaningful work, when the person asks to save or commit ("save", "שמור"), or before stopping in the middle of a task. There is no need to ask separately for a docs update: it is part of saving.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*) Bash(git status *) Bash(git diff *) Bash(git log *) Bash(git show *) Bash(git add *) Bash(git commit *) Bash(git rev-parse *) Bash(git ls-files *)
---

# Save

The plugin's scripts are in `${CLAUDE_PLUGIN_ROOT}/scripts/`. Read `${CLAUDE_PLUGIN_ROOT}/skills/rules.md` before changing a state file, unless you already read it in this session.

If `docs/state/settings.json` does not exist, the project has no memory: commit as usual, and suggest `/trabel-memory:setup` in one line.

Work in this order. Every step reads the files and git, not your memory of the session: in a long session the beginning is no longer in context.

## 1. What changed

`git status` and `git diff` (and `git diff --staged`). Read the diff itself, not only the file list. For each changed code file, know what it does now.

## 2. Docs that fell behind

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/lag.js"`. It lists code that changed in earlier commits after the last update of the state file that owns it, with no `Docs-Unchanged:` line: the gate was bypassed, failed open, or ran on a machine without the plugin. For each file it lists, read those commits (`git show`) and complete the docs now, together with this save.

## 3. Each changed code file: its owner, updated by replacing

For each code file in the diff, find the state file that owns it (the most exact `owns` pattern; `check.js` in step 6 lists what has no owner). Then decide:

- **Behaviour changed** (what a user sees, what the code returns or stores, how it is run or deployed, a permission, a flow): update the owner. Find the lines that describe what changed and **rewrite them in place**. If the change makes a written fact false, that line is deleted and the true one takes its place: never a correction under it, never "now...", "no longer...", "updated:". Add new lines only for things the file did not describe at all, in the section they belong to.
- **Behaviour did not change** (tidying, renaming inside a file, moving code around with the same result, formatting, an internal fix that keeps the result): do not touch the docs. Add to the commit message `Docs-Unchanged: <reason>` in the project's language. A save may be all this: code only, no docs edits, and that is correct.
- **Code with no owner:** decide yourself whether it extends an existing domain or is a new one. Behaviour a user would call by a new name is a new domain: create `docs/state/<domain>.md` with a card (`name`, `summary`, `owns`), the fixed sections, and what the code does. Do not ask the person first; report it. Shared helpers go by explicit path into `architecture.md` or `conventions.md`.

## 4. Open items the change touches

For every open item whose subject this change touches, choose exactly one:

- **Confirm:** new evidence supports it. Add the evidence to the item.
- **Weaken:** evidence against it. Rewrite the item and say why it is weaker.
- **Kill:** its closing condition is met. Delete the whole item, and in the same save rewrite the state lines it was about, so the file describes how things are now. An item closed by a decision (not by code) is killed the same way, and the decision becomes an ordinary fact in the state, plus a `Decision:` line in the commit.
- **Leave:** nothing new. Do not touch it.

There is no fifth option: never add a note or a date under an item.

## 5. New gaps

A gap found during the work (not verified, temporary, broken, a risk) becomes an open item at the top of its domain file, in the shape from rules.md, with today's date.

## 6. Ceilings, ownership, index

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check.js"`.

- Code with no owner: give it one (step 3).
- A file over its ceiling: shorten it first (delete what the code says clearly on its own); split only if that is not enough, and move `owns` with the split.
- A broad domain: mention it in the report as a sign to split. Split now only if the person agrees or the file is also over its ceiling.

Then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/index.js" --with-rules`. It rebuilds the index from the cards and refreshes the rules in the CLAUDE.md block from the plugin's template.

## 7. The queue

In `docs/NEXT.md`, tick what this work completed. A queue whose items are all done is replaced (with the next task if there is one, or emptied), never extended with history.

## 8. The new-reader test

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/reader.js" --data "${CLAUDE_PLUGIN_DATA}"`. If it says no state lines changed, skip to step 9. Otherwise give its output, exactly as it is, as the whole prompt of the Agent tool with `subagent_type` `trabel-memory:reader`. Add nothing to it: the reader must not see the session, the diff or the project, because whoever wrote a line cannot judge it.

You never pass the reader's answer to a script. The plugin catches it by itself, straight from Claude Code, the moment the reader finishes, and the scripts read only what was caught; anything piped or typed into them is ignored.

The reader sometimes skips a line. After each answer, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/reader.js" --missing --data "${CLAUDE_PLUGIN_DATA}"`. If it prints "Every line has an answer.", go on. Otherwise its output is the input again with only the unanswered lines: give it to the reader as it is, once. This resend is not one of the two rounds below.

For each failed line (`unclear`, `story` or `diff`), rewrite it so it states the current state, using what the reader said was missing, then run `reader.js` and the reader again. At most two rounds. A line that still fails does not stop the save.

Last, before the commit, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/reader.js" --report --data "${CLAUDE_PLUGIN_DATA}"`. Its lines are the report's lines about the test: how many lines, how many passed, how many were rewritten, and each line that did not pass or was not checked. Keep them for step 11 as they are. Do not count or add anything yourself; if it says the test did not run, that is what the report says.

## 9. Commit

Stage the code and the docs together, and commit. The message: a subject that says what changed; a body that says what and why. A significant decision (it closes a direction or rules out an alternative) gets a `Decision:` line: what was decided, what was weighed, why. `Docs-Unchanged:` when step 3 said so. `Memory-Skip:` only if the person told you to save without the check.

## 10. If the gate blocks

It prints what failed and what to do, in the project's language. Fix it and commit again. Never add `Memory-Skip:` to get past it on your own.

## 11. Report

In the person's language, short:

```
Saved. Updated: commissions.md (the monthly report, the new table), architecture.md (a new environment variable).
Not updated on purpose: customers.md. The change there was tidying with no change in behaviour.
Open items: one closed (commission on a cancelled deal), one opened (the report was not checked against a month with no deals).
The gate blocked once: a new file with no owner, assigned to commissions.
New-reader test: 14 lines, 13 passed, 1 rewritten.
```

The lines about the new-reader test are the lines `reader.js --report` printed in step 8, word for word, translated only if the person speaks another language than the project.

Include a new domain file if one was born, lagging docs completed from step 2, broad domains from step 6, and a gate that is not installed if `install.js` or the session start said so.
