---
name: open
description: Lists every open item in a project with trabel-memory - what is broken, not verified or temporary - oldest and riskiest first. Use when the person asks what is open, broken, pending or risky in the project ("what's open?", "מה פתוח?").
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/open.js*)
---

# Open items

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/open.js"`. It gathers every open item from the state files, oldest first, with its age in days and its full text. Nothing is stored: the picture is built from the files each time, so it cannot go stale.

If it says the project has no memory, say so and suggest `/trabel-memory:setup` in one line.

Present the items to the person in their language:

1. Put first what is both old and risky. Judge the risk from each item's own text: what breaks, for whom, and whether money, data or permissions are involved. An old item with a small risk goes below a younger item that can lose data.
2. For each item: the title, its domain file, its age, the risk in one line, and how it closes.
3. At the end, one line: how many items, and which one you would close first and why.

Do not change any file. Closing an item happens in a save, when its condition is met.
