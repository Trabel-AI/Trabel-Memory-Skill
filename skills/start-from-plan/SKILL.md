---
name: start-from-plan
description: Starts work from a build plan of several sessions, once, in a project with trabel-memory - reads the plan file the person wrote, takes its sessions as they are (or proposes a split when it has none), writes the queue in docs/NEXT.md with the first session's tasks on top and the sessions left below, commits it, and begins session 1. Use when the person points at a plan and asks to start working from it ("start from the plan", "start from docs/plan.md", "התחל לפי התוכנית", "תתחיל לעבוד לפי docs/plan.md"). Not for going on with a plan that already started - that is trabel-memory:continue.
---

# Start from a plan

This skill runs no commands: read and search files with the Read, Grep and Glob tools only, and write the queue with Write. The checking and the commit are done by the save skill, which has its commands approved in advance.

**The plan belongs to the person.** It is a file they wrote, in any shape and any length. You only read it. Never change a word in it, never renumber or tidy it, never "fix" its format - not now and not in any later session - unless the person explicitly asks. Where the work stands is written only in the queue.

This runs once, at the start of a build. Later sessions go on with `/trabel-memory:continue`.

## 1. Is there memory

If `docs/state/settings.json` does not exist, the project has no memory: suggest `/trabel-memory:setup` in one line, and stop.

## 2. Find the plan

- The person gave a path (in their message, or after the command): use it.
- No path: look for it. Glob `docs/**/*.md` (leave out `docs/state/` and `docs/NEXT.md`) and `*plan*.md` at the root. One clear candidate (by its name and its first lines): use it, and say which. None, or more than one that could be it: ask the person which file, and wait.
- Read `docs/NEXT.md`. If it already points at a plan (the two lines described in step 7), the plan already started: say so, and go on with `/trabel-memory:continue` instead.

## 3. Read the whole plan

All of it, however long. You need every session's scope to write the queue.

## 4. The sessions

- **The plan is already divided into sessions** (or phases, stages, milestones the person clearly means as one sitting each): take the division exactly as it is. Do not ask, do not merge, split or reorder. Report it: "Found 5 sessions, starting with session 1".
- **The plan is not divided:** propose a division, each session the size of one conversation (one coherent piece of work that ends in a working, saved state), in the plan's own order. Show it as a short numbered list: a name per session and which part of the plan it covers. Ask for approval once, and wait. If the person corrects it, apply the correction without asking again. The division lives only in the queue; the plan file stays as it is.

## 5. The last session

The last session of a build should use the product from the outside: like a new user, from scratch, on temporary data, cleaning up after itself. It is not an internal check of the code. If the plan's last session is not that, say so in one sentence and ask whether to add such a session to the list in the queue. On yes, it becomes the last line of the list (and the number of sessions grows by one), with "not in the plan" where the other lines say where in the plan. Do not touch the plan either way.

## 6. What is already in the queue

If `docs/NEXT.md` holds open tasks (unticked checkboxes) that are not part of this plan, do not overwrite them silently: list them, and ask what to do with them - drop them, finish them first, or keep them. Kept tasks go below the plan section, under their own `##` heading, so they are not counted as tasks of a session.

## 7. Write the queue

Write `docs/NEXT.md` in the project's language (`language` in `docs/state/settings.json`), in exactly this shape. The plugin's scripts and the git gate read it by its shape, in any language:

```
# Next

Plan: docs/plan.md
Session 1 of 5: The customers screen (in the plan: chapter 3)

- [ ] The customers table
- [ ] The new customer form

Sessions left:
2. Quotes (in the plan: chapter 4)
3. Reports (in the plan: chapter 5)
4. Exports (in the plan: chapter 6)
5. Using the product from the outside, like a new user (in the plan: chapter 7)
```

- The plan line is `label: path`, the path from the repository root. **Directly below it**, with no blank line between them, the session line: the session number and then the number of sessions, as the only two numbers before its first colon, then the session's name and where it is in the plan ("סשן 1 מתוך 5: שם (בתוכנית: פרק 3)" in Hebrew). Both lines start at the margin with a letter: no `#`, no `-`, no bold.
- Under them, the tasks of session 1 only, a checkbox each: every task the plan names for it, none invented.
- Below, the sessions left: one unindented line per session, `number. name (where its full detail is in the plan)`, numbered 2 to the last, with no checkboxes and no headings. One short line each: the detail stays in the plan, and the queue stays under 100 lines.
- No `#` heading inside the plan section: a heading ends it.

## 8. Commit, and start

1. Save with the save skill (`trabel-memory:save`), started with no arguments: a skill started with arguments loses its approved commands. No code changed yet, so this save only checks the queue's shape with the plugin's script and commits the queue, together with the plan file if git does not hold it yet. A division you proposed and the person approved, or a last session that was added, goes into that commit as a `Decision:` line. If the script says the queue has no plan reference or lists a problem, fix the queue's shape and let the save go on.
2. Tell the person in one or two sentences what the queue holds now, and start working on session 1 in this same conversation: open only the state files its tasks touch. At the end of the session's work, save again.
