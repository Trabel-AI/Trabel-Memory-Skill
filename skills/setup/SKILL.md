---
name: setup
description: Sets up trabel-memory in the current project, once: state files per domain in docs/state, a queue in docs/NEXT.md, a block with rules and an index in CLAUDE.md, and the git gate that blocks commits whose code changed while its docs did not. Use when the person asks to set up project memory ("set up memory in this project", "תקים זיכרון בפרויקט הזה"), or when project instructions say to set it up where it does not exist yet.
allowed-tools: Read(${CLAUDE_PLUGIN_ROOT}/**) Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*) Bash(node --version) Bash(git rev-parse *) Bash(git status *) Bash(git ls-files *) Bash(git log *) Bash(git config --get *) Bash(git add *) Bash(git commit *)
---

# Set up project memory

The plugin's scripts are in `${CLAUDE_PLUGIN_ROOT}/scripts/`. Its data folder on this machine is `${CLAUDE_PLUGIN_DATA}`. Pass that path to the installer exactly as written here: the variable is not set in the shell.

Run each command on its own, in exactly the forms listed in `allowed-tools`: no `cd` before it, no `&&` chains, no pipes. Read and search files with the Read, Grep and Glob tools, never with shell commands. Anything else stops to ask the person for approval, once per command.

Before writing any file, read `${CLAUDE_PLUGIN_ROOT}/skills/rules.md`. It holds the rules every line you write must follow.

Setup writes files into the person's repository, so it runs only when asked (or when their project instructions ask for it). It is done once; running it again on a project that has memory repairs it.

## 1. Where and whether

1. Find the repository root: `git rev-parse --show-toplevel`. The memory always lives at the root, even when the session opened in a subfolder. If this is not a git repository, stop and say so: the memory needs git. Offer to run `git init`, and continue only if the person agrees.
2. Check Node: `node --version`. If it is missing or older than 18, tell the person the gate and the scripts cannot run without it, and how to install it (nodejs.org, the LTS version). Continue only after they have it: every later step runs a script.
3. If `docs/state/settings.json` already exists, the project has memory. Do not rebuild it. Repair instead: run step 5 (the gate) and `node "${CLAUDE_PLUGIN_ROOT}/scripts/index.js" --with-rules`, then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check.js"` and report what it found. Stop there.
4. If the working tree has uncommitted changes (`git status`), tell the person and suggest committing or stashing them first, so the setup commit holds only the memory. Continue if they say so.

## 2. Language

Decide the project's language, a two-letter code: from the existing CLAUDE.md, the README, and the language the person speaks with you. When they differ, the language the person speaks with you wins. Write it in `settings.json` as `language`. All state files, the queue and the index are written in it.

## 3. The files

Every file below is written in the project's language, following `rules.md`.

**Always:**

- `docs/state/settings.json`:
  ```json
  { "gate": "block", "language": "<code>" }
  ```
  Add `ignore` only for generated folders the default list does not cover (build output checked into git, vendored code). If `design.md` exists at the root, add it under `adopted` with a name, a summary and `owns` for the shared style files and UI components (see rules.md; it gets no card, because the tool that writes it may overwrite it).
- `docs/state/architecture.md`: structure, how to run, build and deploy, environment variables (names, never values). `owns`: explicit paths only, no stars: root config files (`package.json`, framework config), and shared helpers.
- `docs/state/conventions.md`: conventions and traps that cross domains. `owns`: explicit paths only, or an empty list.
- `docs/NEXT.md`: the queue. A heading and one line saying the queue is empty, in the project's language. If the person told you what they are working on now, write it as the queue instead, with a checkbox per step.

**An empty project** (no code files yet): that is all. Domain files are born when code is written.

**A project with code:**

1. List the code: `git ls-files`, and read the folder structure. Hints for domains: screen folders (routes, pages), feature folders, table name prefixes in the schema or migrations, API route groups.
2. Propose a split into domains, and ask for approval once. Show one compact table: domain, one-line summary, the patterns it will own. Add the general files (architecture, conventions) and the list of files that will be owned by them by name. This is the only question setup asks; if the person corrects the split, apply the correction without asking again.
3. After approval, write each domain file from the code itself: read the code of each domain before describing it. Follow the fixed order of sections. Write what the code does now. What you could not verify from the code (it depends on the database contents, on an outside service, on intent) is written as not verified, not guessed. Gaps you find (a missing check, a TODO in the code, dead code) become open items with today's date.
4. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check.js"`. Every code file must have an owner and no file may be over its ceiling. Fix and run it again until it reports nothing. Broad domains: split them before committing.

## 4. The CLAUDE.md block

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/index.js" --with-rules`. It writes the plugin's block into CLAUDE.md (creating the file if there is none): the rules in the project's language, and the index table built from the cards. Everything outside the block stays exactly as it was. Do not write the block by hand.

## 5. The gate

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/install.js" --data "${CLAUDE_PLUGIN_DATA}"
```

- Exit code 0: installed.
- Exit code 2: another tool manages the git hooks (Husky or similar). The output shows the one line the plugin wants to add to that tool's hook file. Show the person that line and where it goes, explain in one sentence that without it the gate does not run, and ask once. On yes, run the same command with `--add-to-tool` added. On no, the gate stays off: say so in the report, and it will be reported again at the start of each session until it is handled.
- Exit code 1: not installed. The output says why. Report it and what to do.

## 6. The new-reader test

Every state line is new, so the test reads whole files. Run it exactly as the save does (`${CLAUDE_PLUGIN_ROOT}/skills/save/SKILL.md`, step 8): `reader.js --data "${CLAUDE_PLUGIN_DATA}"`, its output as it is as the whole prompt of the Agent tool with `subagent_type` `trabel-memory:reader`, then `reader.js --missing` after each answer, rewriting failed lines for at most two rounds, and `reader.js --report` before the commit. Do not add anything to the reader's input: the reader must not know the project. You never pass the reader's answer to a script: the plugin catches it by itself.

## 7. Commit

Stage only the memory files: `docs/state/`, `docs/NEXT.md`, `CLAUDE.md`, and `design.md` only if it was not tracked and you adopted it. Commit with a message whose subject says the project memory was set up, and whose body lists the domains and why the split was chosen. If the split closed a real choice (two ways to cut the code), add a `Decision:` line. The gate runs on this commit. If it blocks, fix what it says and commit again.

## 8. Report

In the person's language, short, no jargon:

- What was created: the domains, one line each, and where the files are.
- Whether the gate is on. If not, why and what would turn it on.
- Anything not verified or found open, in one line each.
- The new-reader test: the lines `reader.js --report` printed, word for word.
- One line on how it works from now: they work as usual; at the end of meaningful work you save (`/trabel-memory:save`), and the docs are updated with the code.
