'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname,'..');

test('settings render order is Summary, Plugin Summary, Plugin Detail, Model Settings, Activity', () => {
  const source = fs.readFileSync(path.join(root,'src','lib','settings-tab.js'),'utf8');
  const display = source.slice(source.indexOf('display()'), source.indexOf('  renderModelCard(parent)'));
  const expected = ['renderSummary(', 'renderPluginTable(', 'renderPluginDetail(', 'renderModelCard(', 'renderActivityCard('];
  let last = -1;
  for (const marker of expected) {
    const pos = display.indexOf(marker);
    assert.ok(pos > last, `${marker} must appear after the prior section in display()`);
    last = pos;
  }
});

test('settings CSS opts into full width and aligns row action buttons', () => {
  const css = fs.readFileSync(path.join(root,'styles.css'),'utf8');
  assert.match(css,/\.uopt-settings-container\s*\{[^}]*max-width\s*:\s*none\s*!important/i);
  assert.match(css,/\.uopt-root\s*\{[^}]*width\s*:\s*100%/i);
  assert.match(css,/\.uopt-row-actions\s*\{[^}]*grid-template-columns/i);
});

test('plugin detail includes selectable file preview UI', () => {
  const source = fs.readFileSync(path.join(root,'src','lib','settings-tab.js'),'utf8');
  assert.match(source,/selectedFilePath/);
  assert.match(source,/renderFilePreview/);
  assert.match(source,/uopt-file-preview/);
});
