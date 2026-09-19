'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { gitText } = require('./git');

// The git commit-msg hook and the linker it runs.
//
// The plugin folder changes with every update, so the hook does not point at
// it. It runs a small linker in the plugin's data folder, which survives
// updates, and every session start rewrites the linker with the current folder.

const MARKER = 'trabel-memory';
const HOOK = 'commit-msg';
const SAVED = 'commit-msg.trabel-saved';
const LINKER = 'gate-link.js';
const BLOCKED = 20; // the same code as scripts/gate.js

const slash = (p) => p.replace(/\\/g, '/');
const shQuote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";

// The hook. It blocks only when the gate exits with BLOCKED. Any other
// failure lets the commit through with one warning line.
function hookText(dataDir) {
  const link = slash(path.join(dataDir, LINKER));
  return `#!/bin/sh
# ${MARKER}: the documentation gate. Written by the trabel-memory plugin,
# which rewrites this file. A commit-msg hook that was here before it is
# kept next to it as ${SAVED} and runs first.

saved="\${0%/*}/${SAVED}"
if [ -f "$saved" ]; then
  "$saved" "$@" || exit $?
fi

link=${shQuote(link)}
if ! command -v node >/dev/null 2>&1; then
  echo "trabel-memory: Node was not found, so the docs gate did not run. The commit goes through." >&2
  exit 0
fi
if [ ! -f "$link" ]; then
  echo "trabel-memory: the gate's link file is missing ($link), so the gate did not run. The commit goes through. Opening Claude Code in this project restores it." >&2
  exit 0
fi

out=$(node "$link" "$1" 2>&1)
code=$?
if [ "$code" -eq ${BLOCKED} ]; then
  printf '%s\\n' "$out" >&2
  exit 1
fi
if [ "$code" -ne 0 ]; then
  echo "trabel-memory: the gate failed (exit code $code), so the commit goes through." >&2
  exit 0
fi
if [ -n "$out" ]; then
  printf '%s\\n' "$out" >&2
fi
exit 0
`;
}

function linkerText(pluginRoot) {
  const gate = slash(path.join(pluginRoot, 'scripts', 'gate.js'));
  return `'use strict';
// ${MARKER}: points the git hooks at the plugin's current folder.
// Every Claude Code session start in a project with memory rewrites this file.
const fs = require('fs');
const gate = ${JSON.stringify(gate)};
if (!fs.existsSync(gate)) {
  process.stderr.write('trabel-memory: the plugin was not found at ' + gate + ', so the gate did not run. The commit goes through. Opening Claude Code restores the link.\\n');
} else {
  process.exitCode = require(gate).main(process.argv);
}
`;
}

// The one line added to another tool's hook file.
function toolLine(dataDir) {
  const hook = shQuote(slash(path.join(dataDir, HOOK)));
  return `[ ! -f ${hook} ] || sh ${hook} "$1" || exit 1 # ${MARKER}`;
}

// Where the plugin's data folder is. Given (--data or CLAUDE_PLUGIN_DATA)
// wins. Otherwise the default: the one folder under
// <claude config>/plugins/data whose name starts with "trabel-memory".
// Returns { dir } or { error }.
function findDataDir({ given, env = process.env, home = os.homedir() } = {}) {
  if (given) return { dir: path.resolve(given) };
  if (env.CLAUDE_PLUGIN_DATA) return { dir: path.resolve(env.CLAUDE_PLUGIN_DATA) };
  const base = path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'plugins', 'data');
  let names = [];
  try {
    names = fs.readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^trabel-memory($|-)/.test(d.name))
      .map((d) => d.name);
  } catch (e) {
    names = [];
  }
  if (names.length === 1) return { dir: path.join(base, names[0]) };
  const how = 'Run it again with --data <folder> (the value of CLAUDE_PLUGIN_DATA), or open a new Claude Code session in this project, which installs the gate by itself.';
  if (!names.length) {
    return { error: `The plugin's data folder was not found: no folder named trabel-memory* in ${slash(base)}. ${how}` };
  }
  return { error: `Several data folders match in ${slash(base)} (${names.join(', ')}), so it is not clear which one is in use. ${how}` };
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    return null;
  }
}

// Writes a file only when its content changed. Returns true if it wrote.
function writeIfChanged(file, text, mode) {
  if (readIfExists(file) === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  if (mode) fs.chmodSync(file, mode);
  return true;
}

// Another tool manages the hooks when core.hooksPath points somewhere other
// than the repository's own hooks folder.
function hooksLocation(root) {
  const common = path.resolve(root, gitText(root, ['rev-parse', '--git-common-dir']).trim());
  const own = path.join(common, 'hooks');
  let configured = '';
  try {
    configured = gitText(root, ['config', '--get', 'core.hooksPath']).trim();
  } catch (e) {
    configured = ''; // not set
  }
  if (!configured) return { own };
  const dir = path.resolve(root, configured.replace(/^~(?=[\\/]|$)/, os.homedir()));
  if (slash(dir).toLowerCase() === slash(own).toLowerCase()) return { own };
  // Husky points hooksPath at .husky/_ and keeps the user's hooks in .husky.
  const husky = path.basename(dir) === '_' && path.basename(path.dirname(dir)) === '.husky';
  return {
    own,
    tool: husky ? 'Husky' : `core.hooksPath (${configured})`,
    toolFile: husky ? path.join(path.dirname(dir), HOOK) : path.join(dir, HOOK),
  };
}

// Installs or repairs the gate in one repository.
// Returns { status, dataDir, hookFile?, savedFile?, tool?, toolFile?, line?, message }
// status: installed | unchanged | tool-installed | tool-needs-approval | conflict
function install({ root, pluginRoot, dataDir, addToTool = false }) {
  writeIfChanged(path.join(dataDir, LINKER), linkerText(pluginRoot));
  writeIfChanged(path.join(dataDir, HOOK), hookText(dataDir), 0o755);

  const where = hooksLocation(root);
  if (where.tool) {
    const line = toolLine(dataDir);
    const current = readIfExists(where.toolFile);
    const lines = current == null ? [] : current.split(/\r?\n/);
    const at = lines.findIndex((l) => l.includes('# ' + MARKER));
    const base = { dataDir, tool: where.tool, toolFile: where.toolFile, line };
    if (at >= 0 && lines[at] === line) {
      return { ...base, status: 'unchanged', message: `The gate runs from ${where.tool}: ${slash(where.toolFile)}.` };
    }
    if (at < 0 && !addToTool) {
      return {
        ...base,
        status: 'tool-needs-approval',
        message: `Another tool manages the git hooks (${where.tool}), so the gate is not installed. With approval, this line is added to ${slash(where.toolFile)}:\n${line}`,
      };
    }
    if (at >= 0) {
      lines[at] = line; // the data folder moved
    } else {
      if (!lines.length) lines.push('#!/bin/sh');
      if (lines[lines.length - 1] === '') lines.pop();
      lines.push(line, '');
    }
    const eol = current && current.includes('\r\n') ? '\r\n' : '\n';
    writeIfChanged(where.toolFile, lines.join(eol), current == null ? 0o755 : null);
    return { ...base, status: 'tool-installed', message: `The gate now runs from ${where.tool}: a line was added to ${slash(where.toolFile)}.` };
  }

  const hookFile = path.join(where.own, HOOK);
  const savedFile = path.join(where.own, SAVED);
  const text = hookText(dataDir);
  const current = readIfExists(hookFile);
  let saved = null;
  if (current != null && !current.includes(MARKER + ': the documentation gate')) {
    if (fs.existsSync(savedFile)) {
      return {
        dataDir, hookFile, savedFile, status: 'conflict',
        message: `The gate is not installed: ${slash(hookFile)} belongs to someone else, and ${slash(savedFile)} already exists, so there is nowhere to keep it. Merge the two by hand, then run the installer again.`,
      };
    }
    fs.renameSync(hookFile, savedFile);
    saved = savedFile;
  }
  const wrote = writeIfChanged(hookFile, text, 0o755);
  const kept = saved ? ` The existing commit-msg hook was kept as ${slash(saved)} and runs first.` : '';
  return {
    dataDir, hookFile, savedFile: saved, status: wrote ? 'installed' : 'unchanged',
    message: (wrote ? `The gate is installed: ${slash(hookFile)}.` : `The gate is installed and up to date: ${slash(hookFile)}.`) + kept,
  };
}

module.exports = { MARKER, HOOK, SAVED, LINKER, BLOCKED, hookText, linkerText, toolLine, findDataDir, hooksLocation, install };
