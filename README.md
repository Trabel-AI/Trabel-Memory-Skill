<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/Trabel-Memory-Skill-Logo-Dark.png">
    <img src="brand/Trabel-Memory-Skill-Logo-Light.png" alt="Trabel Memory Skill" width="420">
  </picture>
</p>

<p align="center"><a href="README.he.md">עברית</a></p>

# Trabel Memory Skill

A Claude Code plugin that gives every project a memory describing the project as it is now, so each new conversation starts from it and not from zero.

## The problem

Every conversation with Claude Code starts empty. Documentation is the obvious answer, and it usually fails in one of two ways:

- **It turns into a log.** "Updated on...", "we decided...", "we changed X to Y". To know what is true now, the reader has to replay the history.
- **It turns into one big file.** A real task needs one slice of the project: its data, its permissions, its screens. When the docs are split by kind of information, that slice is spread everywhere, so every conversation reads everything.

The test behind every rule in this plugin: would the next reader, who knows nothing, get a picture of the current state, or would they have to reconstruct a story?

## What it adds to a project

- **State files**, one per domain, in `docs/state/`. Each describes its part of the product as it is now, in a fixed order: open and broken, what the domain does, what the user sees and does, data and permissions, how it is built, traps. Each file declares at its top which code it owns.
- **A queue**, `docs/NEXT.md`: what is being done now. When it is done, it is replaced, not extended. When the work follows a build plan, the queue also says which session of the plan it stands on.
- **A block in `CLAUDE.md`**: the writing rules and an index of the state files, so Claude opens only the file that touches the task.
- **A git gate**: a `commit-msg` hook that blocks a commit whose code changed while the state file that owns it did not. It also blocks a plan session that was skipped or dropped.

History stays where it belongs: in git. The reason behind a significant decision goes into the commit message as a `Decision:` line.

## How it works day to day

1. **Setup, once per project:** `/trabel-memory:setup`. On a project with code, Claude proposes a split into domains and asks for one approval, then writes the state files from the code itself.
2. **Work as usual.** Claude reads the index and opens only the state file it needs.
3. **A new conversation picks the work up with one short phrase:** "continue from the plan", or `/trabel-memory:continue`. Claude reads the queue, opens only the state files its tasks touch, and starts working. A bare "continue" does not do this: it is what you write after a conversation was cut off, and it means go on with the work that was interrupted.
4. **Save at the end of meaningful work:** `/trabel-memory:save`, or just ask to save. Claude updates the docs from the diff, rewriting lines in place rather than adding notes under them, and commits code and docs together.
5. **The new-reader test.** Before the commit, every changed line of the docs goes to a separate agent that has never seen the project or the conversation. A line that only makes sense as a change from an earlier version, or that tells a story, fails and is rewritten.
6. **An interrupted conversation.** When a new conversation finds work that was not saved, it opens with a short report: what changed, and where the queue stands.
7. **New code gets an owner.** Code that no state file owns is caught by the gate and gets a domain file of its own.

Other commands: `/trabel-memory:open` lists every open item in the project, oldest and riskiest first. `/trabel-memory:guide` builds a user guide from the "what the user sees and does" sections.

## Working from a plan

A large build takes several conversations. Its plan is a file you wrote, usually in plan mode, in any shape and any length. The plugin only reads it: not a word of it changes unless you explicitly ask. Where the work stands is written only in the queue.

1. **Once, at the start:** `/trabel-memory:start-from-plan docs/plan.md`, or "start from the plan". A plan that is already divided into sessions is taken as it is. For one that is not, Claude proposes a division, each session the size of one conversation, and asks for one approval. If the last session is not a use of the product from the outside, Claude says so and asks whether to add one to the queue. Then it writes the queue, commits it, and starts session 1.
2. **Every new conversation:** "continue from the plan". Claude reads only the current session's part of the plan and checks the queue's tasks against it. A task that is missing from the queue is added, and you are told. This is an independent check: this conversation did not write the queue.
3. **Every save:** when every task of the session is ticked, the queue is rewritten for the next session. While tasks are open, they stay at the top and the session number does not move. After the last session the plan file is deleted and the plan leaves the queue, in the same commit. Git keeps the plan; there is no archive.

The queue while a plan is running:

```
Plan: docs/plan.md
Session 2 of 5: The customers screen (in the plan: chapter 3)

- [x] The customers table
- [ ] The new customer form

Sessions left:
3. Quotes (in the plan: chapter 4)
4. Reports (in the plan: chapter 5)
5. Using the product from the outside, like a new user (in the plan: chapter 6)
```

The gate blocks a queue that points at a plan that is not in git, and a session number that jumps or goes down. Unless the commit has a `Decision:` line, it also blocks a list of sessions left that changed in any way other than its top line dropping, a changed plan file, and a plan deleted or dropped from the queue before the last session ended. A queue with no plan reference is a plain queue, and everything works as it does without a plan.

What stays a judgement, reported rather than enforced: the division into sessions when Claude proposes it, whether a task was left out of a session (the next "continue from the plan" checks), whether a ticked task was done well (the save reports how it was checked, and the last session checks from the outside), and whether the words "continue from the plan" reach the continue command.

When you write a new plan: the last session in the plan uses the product from the outside - like a new user, from scratch, on temporary data, cleaning up after itself. It is not an internal check of the code. It is also recommended to write the plan already divided into sessions, and to write for each session how one knows it succeeded.

## Install

The repository is both the plugin and its catalog. In Claude Code in a terminal:

```
/plugin marketplace add Trabel-AI/Trabel-Memory-Skill
/plugin install trabel-memory@trabel
```

In the VS Code extension `/plugin` does not exist. The same two steps, from a terminal:

```
claude plugin marketplace add Trabel-AI/Trabel-Memory-Skill
claude plugin install trabel-memory@trabel --scope user
```

Either way, open a new session afterwards, so the plugin loads. When `claude` is not on the PATH, the VS Code extension carries the binary at `~/.vscode/extensions/anthropic.claude-code-*/resources/native-binary/`.

Requirements: git, and Node.js 18 or later (the gate and the scripts run on it, with no external packages). Installing needs no GitHub account.

## Updates

Every commit to the main branch is a release, and there are no version numbers. For a catalog that is not Anthropic's, Claude Code keeps automatic updates off, so the plugin turns them on for its own catalog, once per machine, in the first new session after it is installed, and tells you so. From then on Claude Code checks for a new version within ten minutes after a session starts, and the new version loads in the next session.

**Turn automatic updates off**, if you want to: in Claude Code in a terminal, `/plugin`, then **Marketplaces**, choose `trabel`, then **Disable auto-update**. Anywhere else, including the VS Code extension: open `~/.claude/settings.json`, find the `trabel` entry under `extraKnownMarketplaces`, and remove its `"autoUpdate": true` line. The plugin turns it on once per machine, so it stays off.

**Update by hand**, from a terminal, if a new version does not arrive:

```
claude plugin marketplace update trabel
claude plugin update trabel-memory@trabel
```

The new version loads in the next session, or after `/reload-plugins` in an open one.

## Exemptions

Three lines in a commit message, always in English so the gate recognises them in any project:

| Line | Written when | Effect |
|---|---|---|
| `Docs-Unchanged: <reason>` | The code changed but its behaviour did not (tidying, an internal fix) | The gate does not ask for a docs change |
| `Memory-Skip: <reason>` | Only when the person explicitly asked to save without the check | The gate skips this commit |
| `Decision: <what, what was weighed, why>` | A significant decision was made | It is how decisions are found later. In the gate, it only allows a deliberate change to a plan or to its list of sessions |

For a whole project, `docs/state/settings.json` sets the gate to `block` (the default), `warn` or `off`. A person can always bypass the gate with `git commit --no-verify`; the next save completes the docs that were skipped.

## Languages

The plugin's own instructions are in English. The docs it writes in a project, and the gate's messages, are in the project's language: Hebrew and English are supported, and any other language gets English messages.

## Status

Built and tested on Windows. The git hook has not yet been tested on macOS or Linux.
