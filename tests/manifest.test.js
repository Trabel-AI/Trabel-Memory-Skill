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
