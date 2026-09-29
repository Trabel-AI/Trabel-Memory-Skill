# trabel-memory: how the memory is written

Shared by the plugin's skills. The short version of these rules lives in the project's CLAUDE.md block, which every session reads; this file is the full version for the moments the files are written.

## The test behind every line

Would the next reader, who knows nothing, get a picture of the current state, or would they have to reconstruct a story? A sentence that makes sense only as a difference from an earlier version is written wrong.

## Three lifecycles

| | Answers | Lifecycle | Where |
|---|---|---|---|
| State | Where things stand | Overwritten in place | `docs/state/` |
| Queue | What to do now | Replaced whole when finished, never extended | `docs/NEXT.md` |
| Log | What happened and why | Accumulates, never changes | Commit messages |

There is no log file, no decisions file and no archive folder. A reason that still shapes the work today is written as a plain fact in the state.

## Writing state

- **State, not a log.** Present tense, no date of a change or an update, no "we decided". "The engine computes X", not "we changed the engine to X".
- **Replace, do not add.** A line that stopped being true is deleted and the true line is written in its place. No correction under it, no strikethrough, no "update:". Git keeps every earlier version, so deleting loses nothing. When a change makes a written fact false, find that line and rewrite it; do not append a new line that contradicts it.
- **One fact, one home.** Another file that needs the fact links to it instead of restating it. A copy always goes stale, and invisibly.
- **The code wins.** When a document contradicts the code, the code is right, and the document is fixed in the same commit.
- **Same commit.** Docs change in the commit of the code they describe.
- **From the diff, not from memory.** What changed is read from `git status` and `git diff`, not from what you remember of the session.
- **Closing a gap changes the state.** An open item that is deleted always comes with a change to the state description it was about, even when it closed by a decision and not by code. The decision is written as an ordinary fact.
- **Unknown is written as unknown.** An empty field is a failure. "Unknown, and this is what is missing to know it" is a success.
- **Order by importance.** What is broken or open is at the top of the file, what is healthy below.
- **Write in the project's language** (`language` in `docs/state/settings.json`). Card keys and commit trailers stay in English.

## Files

```
CLAUDE.md               the plugin's block: short rules + an index built automatically
docs/
  NEXT.md               the queue
  state/
    settings.json       gate mode, ignore list, project language, adopted files
    architecture.md     structure, running, deployment
    conventions.md      conventions and traps that cross domains
    <domain>.md         one file per domain
```

A domain is something a user of the product would call by name (customers, quotes, commissions). A domain file holds the whole slice: its data, permissions, screens, and what the user sees.

### The card at the top of a state file

Keys in English always; values in the project's language.

```
---
name: Commissions
summary: The commission engine, each employee's commission model, and the monthly report for payroll
owns:
  - src/app/**/commissions/**
  - src/lib/commissions*.ts
budget: 300
---
```

`summary` is the row in the index; write it so a reader can decide from it alone whether to open the file. `budget` is optional (300 by default); raise it only as a visible, explicit decision.

### Fixed order in a domain file

1. **Open and broken:** what does not work, is not verified, or is temporary.
2. **What the domain does,** in two or three lines.
3. **What the user sees and does.** Written in words that could go into a user guide almost as they are.
4. **Data and permissions.**
5. **How it is built:** flows, and where each thing is in the code.
6. **Traps.**

Use these as `##` headings, in the project's language.

### An open item

```
### A commission on a cancelled deal is not cancelled
Opened: 2026-09-08
Risk: an employee gets a commission in the monthly report on a deal the customer cancelled.
How it closes: the owner decides whether a cancellation deletes the commission or offsets it next month; then the engine implements it.
Where in the code: src/lib/commissions.ts, the monthlyReport function
```

- Open items live at the top of their domain file, under the first section. There is no central file.
- The script recognises an item without knowing the language: a `###` heading whose first line below is one word, a colon, and a date as `YYYY-MM-DD`. Keep that shape exactly, with the label in the project's language (`נפתח:` in Hebrew).
- The date of a change or an update is not allowed in state files: it turns the line into a log entry. That date, the age of a gap, is allowed: it is information. So is a date that is a fact about the world the product lives in: a validity, a deadline, a term in a contract ("The rate is valid until 2026-12-31").

### Ceilings

- 300 lines per state file (card included), 100 for the queue, 60 for the rules in the CLAUDE.md block.
- Over a ceiling, shorten first: delete what the code already says clearly. Only if that is not enough, split into two domains, and ownership splits with them.
- These always survive shortening and splitting: trap warnings, the evidence behind a risk item, the condition for closing an open item, and everything marked not verified.

## Working from a plan

A build of several sessions follows a plan: a file the person wrote, usually in plan mode, in any shape and any length.

- **The plan is read, never written.** No script and no session changes a word in it, renumbers it or tidies it, unless the person explicitly asks; then the commit says so in a `Decision:` line. The plan is not a state file and not a log: where the work stands is written only in the queue.
- `/trabel-memory:start-from-plan <path>` runs once: it writes the queue from the plan and starts session 1. Every later conversation opens with `/trabel-memory:continue` (or "continue from the plan"; a bare "continue" means go on with the work that was interrupted, and does not run it): it checks the queue's tasks against the current session's part of the plan, and works. The save moves the queue from session to session.
- The plan file is not code: it needs no owner, wherever it is.

The queue while a plan is running, in the project's language:

```
# Next

Plan: docs/plan.md
Session 2 of 5: The customers screen (in the plan: chapter 3)

- [x] The customers table
- [ ] The new customer form

Sessions left:
3. Quotes (in the plan: chapter 4)
4. Reports (in the plan: chapter 5)
5. Using the product from the outside, like a new user (in the plan: chapter 6)
```

- The scripts recognise it by shape, in any language: a `label: path` line, and **directly below it** a line whose only two numbers before its first colon are N and then M (`סשן 2 מתוך 5: ...` in Hebrew). Both lines start at the margin with a letter. The path is from the repository root.
- Under them, the tasks of session N only, a checkbox each. Below, the sessions left: one unindented line per session, `number. name (where in the plan)`, numbered N+1 to M, with no checkboxes. The last session has no list.
- The plan section ends at the next `#` heading. Tasks that are not from the plan go below it, under their own `##` heading.
- When every task is ticked, the save runs `plan.js --advance`: N goes up by one, the top line of the list becomes the session line, the rest of the list stays word for word, and the new session's tasks are written from its part of the plan. While a task is open, the queue stays on the session. After the last session, `plan.js --finish` deletes the plan file and takes the plan out of the queue, in the same commit; git keeps the plan, and there is no archive.
- The gate blocks a queue that points at a plan that is not in git, and a session number that jumps or goes down. It blocks these unless the commit has a `Decision:` line: a list of sessions left that changed in any way other than its top line dropping, a changed plan file, and a plan deleted or dropped from the queue before the last session ended.
- A queue without the two lines is a plain queue, and everything works as it does without a plan.

What stays a judgement, and is reported rather than enforced: the division into sessions when Claude proposes it (the person approves it once); whether a task was left out of a session (the next conversation's `continue` checks the queue against the plan); whether a ticked task was done well (the save reports how it was checked, and the last session checks from the outside).

### Writing a new plan

This applies to a new plan only; an existing plan is never changed to fit it.

- The last session in the plan uses the product from the outside - like a new user, from scratch, on temporary data, cleaning up after itself. It is not an internal check of the code.
- Recommended, not enforced: write the plan already divided into sessions, each the size of one conversation, and write for each session how one knows it succeeded.

## Ownership

- Each state file declares in `owns` the code paths it is responsible for. There is no separate map.
- A pattern matches the full path from the repository root: `*` is any run of characters inside one folder, `**` as a whole segment is any number of folders (zero included), `?` is one character. `package.json` matches only the file at the root.
- Code is every file in git that is not under `docs/`, is not a CLAUDE.md, is not an adopted file, is not the plan file the queue points at, and is not on the ignore list (lock files, images, generated files and tests by default; the project adds to it in `settings.json`).
- When several patterns match a file, the most exact one wins (more fixed characters). Only a tie gives a file two owners.
- **No pattern may swallow new code,** because "code with no owner" is what catches a new domain:
  - `architecture.md` and `conventions.md` hold only explicit file paths, no stars. Code shared by all domains (helpers, project config) goes there by name.
  - A domain file never holds a pattern made only of stars (`**`, `*`, `**/*`).
  - A single domain pattern may not hold more than 40% of the code files once the project has 20 of them.
- Code with no owner gets one. Decide on your own whether it extends an existing domain or opens a new one, and report it. New behaviour a user would call by a new name is a new domain file: write it with a card, the fixed sections, and its `owns`. Do not ask the person first.

## Commit message lines

Always in English, so the gate recognises them in every project; the text after them is in the project's language.

| Line | When | What it does |
|---|---|---|
| `Docs-Unchanged: <reason>` | On your own, when behaviour did not change: tidying, renaming inside a file, an internal fix with the same result | Exempts the commit from "code without docs". Kept in git and reported. |
| `Memory-Skip: <reason>` | Only when the person said to save without the check | The whole gate skips this commit |
| `Decision: <what, what was weighed, why>` | A significant decision: one that closes a direction or rules out an alternative | Nothing in the gate. "Why did we decide X" is answered by searching these lines |

A line with nothing after the colon does not count.

## The scripts

All in the plugin's `scripts/` folder (the skill that sent you here gives its full path), run with `node` from anywhere inside the repository:

| Script | What it does |
|---|---|
| `index.js [--with-rules]` | Rebuilds the index table in the CLAUDE.md block from the cards. `--with-rules` also writes the rules above it from the plugin's template |
| `check.js` | Code with no owner, files over their ceiling, domains too broad |
| `lag.js` | Code whose docs fell behind in earlier commits |
| `reader.js --data <folder> [--missing \| --report]` | The changed state lines, with their addresses, for the new-reader test; `--missing` the lines no captured answer covers; `--report` the report's lines about the test. The reader's answers are caught by the plugin itself, never passed in |
| `open.js` | Every open item, oldest first |
| `plan.js [--advance \| --finish]` | Where the work stands in the plan, and what the gate would block; `--advance` moves the queue to the next session; `--finish` deletes the plan and takes it out of the queue after the last session |
| `install.js --data <folder>` | Installs or repairs the git gate |

Never edit the index table by hand; run `index.js`.
