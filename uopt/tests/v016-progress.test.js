'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname,'..');

test('v0.1.6 keeps a transient current operation and refreshes the UI as scan/translation advances', () => {
  const source = fs.readFileSync(path.join(root,'src','main.js'),'utf8');
  assert.match(source,/this\.operation\s*=\s*null/);
  assert.match(source,/setOperation\(/);
  assert.match(source,/clearOperation\(/);
  assert.match(source,/kind:'scan'/);
  assert.match(source,/kind:'translate'/);
  assert.match(source,/batch/);
  assert.match(source,/totalBatches/);
});

test('settings UI surfaces current operation instead of only a generic Working label', () => {
  const source = fs.readFileSync(path.join(root,'src','lib','settings-tab.js'),'utf8');
  assert.match(source,/renderCurrentOperation/);
  assert.match(source,/Current operation/);
  assert.match(source,/uopt-operation/);
  assert.match(source,/operation\.batch/);
  assert.match(source,/operation\.totalBatches/);
  assert.match(source,/Scanning…/);
  assert.match(source,/Translating…/);
});

test('operation status has dedicated styling', () => {
  const css = fs.readFileSync(path.join(root,'styles.css'),'utf8');
  assert.match(css,/\.uopt-operation\s*\{/);
  assert.match(css,/\.uopt-operation-progress\s*\{/);
});
