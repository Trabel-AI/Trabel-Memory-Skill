'use strict';

const path = require('path');
const { stripBom } = require('./text');
const { toRegExp } = require('./glob');

const SETTINGS_PATH = 'docs/state/settings.json';
const STATE_DIR = 'docs/state/';
const NEXT_PATH = 'docs/NEXT.md';
const CLAUDE_PATH = 'CLAUDE.md';

const GATE_MODES = ['block', 'warn', 'off'];
const DEFAULT_BUDGET = 300;
const NEXT_BUDGET = 100;
const RULES_BUDGET = 60;

// A single pattern in a domain file may not take more than this share of the
// code files, once the project has at least BROAD_MIN_FILES of them.
const BROAD_SHARE = 0.4;
const BROAD_MIN_FILES = 20;

// Files that are never code. Projects add to this list in settings.json.
const DEFAULT_IGNORE = [
  // package lock files
  '**/package-lock.json', '**/npm-shrinkwrap.json', '**/yarn.lock', '**/pnpm-lock.yaml',
  '**/bun.lock', '**/bun.lockb', '**/deno.lock', '**/Cargo.lock', '**/poetry.lock',
  '**/Pipfile.lock', '**/uv.lock', '**/Gemfile.lock', '**/composer.lock', '**/go.sum',
  '**/packages.lock.json', '**/pubspec.lock', '**/Podfile.lock', '**/mix.lock',
  // images
  '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.webp', '**/*.avif', '**/*.bmp',
  '**/*.ico', '**/*.svg', '**/*.tif', '**/*.tiff', '**/*.heic',
  // generated files
  '**/*.min.js', '**/*.min.css', '**/*.map', '**/*.generated.*', '**/*.snap',
  '**/__snapshots__/**',
  // tests
  '**/*.test.*', '**/*.spec.*', '**/*_test.*', '**/test_*.py', '**/__tests__/**',
  '**/test/**', '**/tests/**',
];

function parseSettings(text) {
  const raw = JSON.parse(stripBom(text));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('settings.json is not a JSON object');
  }
  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []);
  const adopted = (Array.isArray(raw.adopted) ? raw.adopted : [])
    .filter((a) => a && typeof a.path === 'string' && a.path.trim())
    .map((a) => {
      const budget = parseInt(a.budget, 10);
      return {
        path: a.path.trim().replace(/\\/g, '/').replace(/^\.\//, ''),
        name: typeof a.name === 'string' ? a.name : '',
        summary: typeof a.summary === 'string' ? a.summary : '',
        owns: strings(a.owns),
        budget: Number.isFinite(budget) && budget > 0 ? budget : null,
      };
    });
  return {
    gate: GATE_MODES.includes(raw.gate) ? raw.gate : 'block',
    language: typeof raw.language === 'string' && raw.language.trim() ? raw.language.trim() : 'en',
    ignore: strings(raw.ignore),
    adopted,
  };
}

// Code: a tracked file outside docs/, not CLAUDE.md, not an adopted state file,
// not the plan file the queue points at (notCode), and not on the ignore list.
// Ignore patterns match without regard to case.
function makeIsCode(settings, notCode = []) {
  const ignore = [...DEFAULT_IGNORE, ...settings.ignore].map((p) => toRegExp(p, 'i'));
  const adopted = new Set(settings.adopted.map((a) => a.path));
  const plans = new Set(notCode);
  return (file) =>
    !file.startsWith('docs/') &&
    path.posix.basename(file) !== CLAUDE_PATH &&
    !adopted.has(file) &&
    !plans.has(file) &&
    !ignore.some((re) => re.test(file));
}

module.exports = {
  SETTINGS_PATH, STATE_DIR, NEXT_PATH, CLAUDE_PATH,
  GATE_MODES, DEFAULT_BUDGET, NEXT_BUDGET, RULES_BUDGET, BROAD_SHARE, BROAD_MIN_FILES, DEFAULT_IGNORE,
  parseSettings, makeIsCode,
};
