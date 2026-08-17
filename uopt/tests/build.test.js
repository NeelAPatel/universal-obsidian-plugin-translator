'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('runtime main.js is self-contained and has no relative requires', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.doesNotMatch(main, /require\(["']\.\.?\//, 'Obsidian runtime bundle must not depend on sibling source modules');
});

test('runtime main.js is generated from src rather than being source-of-truth', () => {
  assert.ok(fs.existsSync(path.join(root,'src','main.js')));
  assert.ok(fs.existsSync(path.join(root,'scripts','build.cjs')));
  const main = fs.readFileSync(path.join(root,'main.js'),'utf8');
  assert.match(main,/GENERATED FILE/);
});

test('manual runtime payload is the standard three files', () => {
  for (const file of ['main.js','manifest.json','styles.css']) {
    assert.ok(fs.existsSync(path.join(root,file)), `${file} must exist at repository root`);
  }
});
