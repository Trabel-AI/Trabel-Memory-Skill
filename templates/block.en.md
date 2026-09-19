## Project memory

The files in the table below describe the project as it is now. Read the queue, then only the state file that touches your task. Do not read everything.

### How state files are written
- State, not a log: present tense, no dates, no "we decided" or "we changed". "The engine computes X", not "we changed the engine to X".
- A line that stopped being true is deleted, and the true one is written in its place. No correction under it, no strikethrough. Git keeps the old version.
- One fact lives in one file. Another file that needs it links to it.
- When the docs contradict the code, the code is right, and the docs are fixed in the same commit.
- What is unknown is written as unknown, with what is missing to know it.
- What is broken or open goes at the top of the file, what is healthy below.
- Fixed order in a domain file: open and broken, what the domain does, what the user sees and does, data and permissions, how it is built, traps.
- An open item: a `###` heading, then `Opened: YYYY-MM-DD`, the risk, how it closes, and where in the code. That is the only date allowed in state files.
- An open item that closes is deleted, and the state it touched changes in the same save.
- Ceiling: 300 lines per state file, 100 for the queue. Over it, shorten first, and split only if that is not enough.

### Who owns which code
- Each state file declares the code it is responsible for in the card at its top (`owns`).
- New code with no owner gets one: an existing domain, or a new domain file. Decide on your own and report it.
- Code shared by all domains belongs to `architecture.md` or `conventions.md`, as explicit paths without stars.

### How to work
- Before a task with several steps, write it in docs/NEXT.md with a checkbox per step. A finished queue is replaced, not extended.
- At the end of meaningful work, save: `/trabel-memory:save`. The save updates the docs from the diff and commits.
- The docs change in the same commit as the code they describe.
- A change that does not change behavior (tidying code, an internal fix): leave the docs alone and add `Docs-Unchanged: <reason>` to the commit message.
- A significant decision goes in the commit message as `Decision: <what was decided, what was weighed, why>`. "Why did we decide X" is found by searching those lines in git.
- `Memory-Skip: <reason>` only when the person explicitly asked to save without the check.
- The docs gate in git blocks a commit where code changed and its docs did not. When it blocks, fix what the message says and try again.
- The table below is built from the cards automatically. Do not edit it by hand.
