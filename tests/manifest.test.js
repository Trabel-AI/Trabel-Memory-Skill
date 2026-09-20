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

// A skill with allowed-tools needs the person's approval each time Claude
// starts it on its own (from words, not from a slash command), and a skill
// that Claude starts with an argument loses its pre-approved commands.
// "continue" must work with one word and no questions, and start-from-plan
// usually gets the plan path as an argument. So both ask for no tools and
// run no commands: the save skill checks and commits for them.
test('the plan skills ask for no tools in advance, and run no commands', () => {
  for (const name of ['start-from-plan', 'continue']) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'skills', name, 'SKILL.md'), 'utf8');
    assert.ok(!text.includes('\r'), name + ': LF line endings');
    assert.ok(text.split('\n').includes('name: ' + name), name);
    assert.ok(!/^allowed-tools:/m.test(text), name);
    assert.ok(!text.includes('${CLAUDE_PLUGIN_ROOT}'), name);
  }
});

// The queue's shape is written in two places, because start-from-plan cannot
// read rules.md without asking: both must show the same example.
test('start-from-plan and rules.md describe the same queue shape', () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'skills', 'rules.md'), 'utf8');
  const skill = fs.readFileSync(path.join(__dirname, '..', 'skills', 'start-from-plan', 'SKILL.md'), 'utf8');
  const { parseQueue } = require('../scripts/lib/plan');
  const example = (text) => text.split('```').find((part) => /\nPlan: /.test(part));
  for (const [name, text] of [['rules.md', rules], ['start-from-plan', skill]]) {
    const q = parseQueue(example(text).replace(/^\w*\n/, ''));
    assert.ok(q, name + ': the example is a queue the script recognises');
    assert.deepStrictEqual(q.problems, [], name);
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
