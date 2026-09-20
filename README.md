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
- **A queue**, `docs/NEXT.md`: what is being done now. When it is done, it is replaced, not extended.
- **A block in `CLAUDE.md`**: the writing rules and an index of the state files, so Claude opens only the file that touches the task.
- **A git gate**: a `commit-msg` hook that blocks a commit whose code changed while the state file that owns it did not.

History stays where it belongs: in git. The reason behind a significant decision goes into the commit message as a `Decision:` line.

## How it works day to day

1. **Setup, once per project:** `/trabel-memory:setup`. On a project with code, Claude proposes a split into domains and asks for one approval, then writes the state files from the code itself.
2. **Work as usual.** Claude reads the index and opens only the state file it needs.
3. **Save at the end of meaningful work:** `/trabel-memory:save`, or just ask to save. Claude updates the docs from the diff, rewriting lines in place rather than adding notes under them, and commits code and docs together.
4. **The new-reader test.** Before the commit, every changed line of the docs goes to a separate agent that has never seen the project or the conversation. A line that only makes sense as a change from an earlier version, or that tells a story, fails and is rewritten.
5. **An interrupted conversation.** When a new conversation finds work that was not saved, it opens with a short report: what changed, and where the queue stands.
6. **New code gets an owner.** Code that no state file owns is caught by the gate and gets a domain file of its own.

Other commands: `/trabel-memory:open` lists every open item in the project, oldest and riskiest first. `/trabel-memory:guide` builds a user guide from the "what the user sees and does" sections.

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

Updates arrive on their own: every commit to the main branch is a release.

Requirements: git, and Node.js 18 or later (the gate and the scripts run on it, with no external packages). While the repository is private, installing needs a GitHub account with access to it, and git signed in to that account.

## Exemptions

Three lines in a commit message, always in English so the gate recognises them in any project:

| Line | Written when | Effect |
|---|---|---|
| `Docs-Unchanged: <reason>` | The code changed but its behaviour did not (tidying, an internal fix) | The gate does not ask for a docs change |
| `Memory-Skip: <reason>` | Only when the person explicitly asked to save without the check | The gate skips this commit |
| `Decision: <what, what was weighed, why>` | A significant decision was made | No effect on the gate; it is how decisions are found later |

For a whole project, `docs/state/settings.json` sets the gate to `block` (the default), `warn` or `off`. A person can always bypass the gate with `git commit --no-verify`; the next save completes the docs that were skipped.

## Languages

The plugin's own instructions are in English. The docs it writes in a project, and the gate's messages, are in the project's language: Hebrew and English are supported, and any other language gets English messages.

## Status

Built and tested on Windows. The git hook has not yet been tested on macOS or Linux.
