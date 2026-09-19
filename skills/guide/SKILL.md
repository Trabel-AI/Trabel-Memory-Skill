---
name: guide
description: Produces a user guide for a project with trabel-memory, from the "what the user sees and does" section of each domain file. Use when the person asks for a user guide, a help page, or an explanation of the product for its users ("write a user guide", "מדריך למשתמש").
---

# User guide

The guide is a product of the state files, not a file kept alongside them. Each domain file has a section on what the user sees and does, written so it can go into a guide almost as it is. The guide gathers those sections.

1. Read the index in the CLAUDE.md block. If `docs/state/settings.json` does not exist, the project has no memory: say so and suggest `/trabel-memory:setup` in one line.
2. For each domain file (not `architecture.md` or `conventions.md`), read the "what the user sees and does" section: the third `##` section, in the project's language. Skip a domain whose section is empty, and list it at the end as missing.
3. Write the guide in the project's language, for the product's users, not its developers: one part per domain, in an order a new user would follow, with the domain's name as the title. Keep what is written; remove file names, function names and anything technical. Add nothing that is not in the files: the guide describes only what the state files say.
4. Show the guide in the conversation.
5. Save it to a file only if the person asks, at a path they choose, never under `docs/state/`. A saved guide is a copy that will go stale; say so in one line when saving, and that asking again produces a fresh one.

If a section reads as history rather than as what the user does now, or contradicts another domain, do not fix it here. Mention it at the end, so it is fixed in the next save.
