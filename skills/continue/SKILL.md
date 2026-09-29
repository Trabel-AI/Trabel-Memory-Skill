---
name: continue
description: Continues the work at the start of a session in a project with trabel-memory - reads the queue in docs/NEXT.md, and when the project works from a build plan, checks the queue's tasks against the current session's part of the plan, then opens only the state files the tasks touch and starts working. Use when the person asks, in words that name the plan or the queue, to go on from it - "continue from the plan", "continue from the queue", "keep going with the plan", "המשך על פי תוכנית", "המשך לפי התוכנית", "המשך לפי התור", "המשך לפי docs/NEXT.md". Not for a bare "continue", "המשך" or "תמשיך", even as the first message of a session - that means go on with the work that was interrupted, and does not start this skill.
---

# Continue

This skill runs no commands: read and search files with the Read, Grep and Glob tools only. That is on purpose. A skill that asks for tools in advance needs the person's approval each time Claude starts it, and a request to continue from the plan must work with no questions.

A bare "continue" or "המשך" does not start this skill, at any point of a conversation: the person means the work that was interrupted (a session that ran out, a machine that went down), not the queue. If that is all they wrote, this skill is not needed: go on with what was being done.

If `docs/state/settings.json` does not exist, the project has no memory: say so, suggest `/trabel-memory:setup` in one line, and stop.

## 1. Where the work stands

Read `docs/NEXT.md`. The queue points at a plan when it has these two lines, one directly below the other, in any language: a `label: path` line, and a line with the session number and the number of sessions before its first colon ("Session 2 of 5: name", "סשן 2 מתוך 5: שם"). Under them are the tasks of the current session, a checkbox each, and below those the sessions left, one numbered line each. When the session opened, the plugin may also have said where the plan stands, and listed problems in the queue.

## 2. The queue points at a plan

This conversation did not write the queue, so it is the independent check of it.

1. In the plan file, read only the part of the current session: the session line in the queue says where it is. Do not read the whole plan. If the plan file does not exist, say so and stop: the queue points at nothing.
2. Compare the queue's tasks with that part of the plan. A task the plan names for this session that is missing from the queue is added to it, with a checkbox, and you tell the person which tasks you added. Do not remove or reword tasks. Do not touch the session line or the list of sessions left: the save moves them, with a script. And never change the plan file: the person wrote it, and not a word of it changes unless they explicitly ask.
3. If the plugin listed problems in the queue when the session opened, fix the queue's shape first and tell the person.
4. If every task is already ticked, the last conversation ended without moving the queue on: save first (`/trabel-memory:save` moves it), then go on with the next session.

## 3. No plan

The queue has no such two lines: it is a plain queue.

- Look for a build plan the queue does not point at: Glob `docs/**/*.md` (leave out `docs/state/` and the queue itself) and `*plan*.md` at the root. If one of the files clearly is a build plan of several sessions that the work should follow (judge by its name and first lines; a guide, a spec or notes are not), do not guess where the work stands: tell the person to run `/trabel-memory:start-from-plan <that file>` first, and stop.
- Otherwise work from the queue alone.
- The queue is empty and there is no plan: say that nothing is queued, and ask what to work on.

## 4. Work

Tell the person in one or two sentences where the work stands: the session and its name, what is done and what is next. Open only the state files that touch the open tasks (the index table in CLAUDE.md says which file holds what), and start working on the first open task. Do not stop to ask whether to begin.

At the end of the session's work, save with the save skill (`trabel-memory:save`), started with no arguments. The save ticks what was done, and when the whole session is done it moves the queue on to the next session.
