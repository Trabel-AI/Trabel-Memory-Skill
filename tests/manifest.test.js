'use strict';

// The plugin's manifests. A "version" pins users to that string: they get an
// update only when it goes up, so a fix pushed without raising it reaches no
// one. Without it the version is the commit, and every push is an update.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const manifest = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', name), 'utf8'));

test('plugin.json has no version', () => {
  assert.strictEqual('version' in manifest('plugin.json'), false);
});

test('the marketplace entry has no version', () => {
  const market = manifest('marketplace.json');
  const entry = market.plugins.find((p) => p.name === 'trabel-memory');
  assert.ok(entry, 'trabel-memory is listed in marketplace.json');
  assert.strictEqual('version' in entry, false);
  assert.strictEqual('version' in (market.metadata || {}), false);
});

// A plugin is installed with git. On Windows, git checks text files out with
// CRLF line endings unless the repository says otherwise, and a skill whose
// file has CRLF endings loses its allowed-tools: every script it runs then
// stops to ask the person. .gitattributes keeps LF everywhere.
test('.gitattributes keeps LF line endings on every checkout', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', '.gitattributes'), 'utf8');
  assert.match(text, /^\* text=auto eol=lf$/m);
});

// Setup and save read files inside the plugin (rules.md, the save skill).
// Those files are outside the person's project, so reading them asks for
// approval unless the skill grants it.
test('setup and save may read the plugin files without asking', () => {
  for (const name of ['setup', 'save']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'skills', name, 'SKILL.md'), 'utf8');
    const line = text.split('\n').find((l) => l.startsWith('allowed-tools:'));
    assert.ok(line && line.includes('Read(${CLAUDE_PLUGIN_ROOT}/**)'), name);
  }
});

// Setup and save end in a commit: that is what the person asked for when
// they ran them, so the commit must not stop to ask again.
test('setup and save may commit without asking', () => {
  for (const name of ['setup', 'save']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'skills', name, 'SKILL.md'), 'utf8');
    const line = text.split('\n').find((l) => l.startsWith('allowed-tools:'));
    assert.ok(line.includes('Bash(git add *)') && line.includes('Bash(git commit *)'), name);
  }
});
