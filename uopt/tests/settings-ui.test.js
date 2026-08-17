'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname,'..');

test('settings render order is Summary, Plugin Summary, Plugin Detail, Selected File Preview, Model Settings, Activity', () => {
  const source = fs.readFileSync(path.join(root,'src','lib','settings-tab.js'),'utf8');
  const display = source.slice(source.indexOf('display()'), source.indexOf('  renderModelCard(parent)'));
  const expected = ['renderSummary(', 'renderPluginTable(', 'renderPluginDetail(', 'renderSelectedFilePreview(', 'renderModelCard(', 'renderActivityCard('];
  let last = -1;
  for (const marker of expected) {
    const pos = display.indexOf(marker);
    assert.ok(pos > last, `${marker} must appear after the prior section in display()`);
    last = pos;
  }
});

test('single-column settings layout is centered, readable, and summary metrics are a permanent 2x2 grid', () => {
  const css = fs.readFileSync(path.join(root,'styles.css'),'utf8');
  assert.match(css,/\.uopt-root\s*\{[^}]*max-width\s*:\s*(?:1152px|1200px|72rem)/i);
  assert.match(css,/\.uopt-root\s*\{[^}]*margin\s*:\s*0\s+auto/i);
  assert.match(css,/\.uopt-metrics\s*\{[^}]*grid-template-columns\s*:\s*repeat\(2\s*,\s*minmax\(0\s*,\s*1fr\)\)/i);
  assert.doesNotMatch(css,/@media[^}]+\.uopt-metrics\s*\{[^}]*grid-template-columns\s*:\s*1fr/i);
});

test('plugin and file tables keep global search and sorting but remove per-column filter UI', () => {
  const source = fs.readFileSync(path.join(root,'src','lib','settings-tab.js'),'utf8');
  assert.match(source,/Search plugins/);
  assert.match(source,/Search files/);
  assert.match(source,/createSortHeader/);
  assert.doesNotMatch(source,/renderColumnFilters/);
  assert.doesNotMatch(source,/pluginFilters/);
  assert.doesNotMatch(source,/fileFilters/);
  const css = fs.readFileSync(path.join(root,'styles.css'),'utf8');
  assert.doesNotMatch(css,/uopt-filter-row/);
  assert.match(css,/\.uopt-five-rows\s*\{[^}]*max-height/i);
});

test('row action buttons use fixed aligned columns', () => {
  const css = fs.readFileSync(path.join(root,'styles.css'),'utf8');
  assert.match(css,/\.uopt-row-actions\s*\{[^}]*grid-template-columns/i);
  assert.match(css,/\.uopt-row-actions\s+\.uopt-button\s*\{[^}]*width\s*:\s*100%/i);
});

test('file selection drives a first-class preview with syntax highlighting and Markdown mode controls', () => {
  const source = fs.readFileSync(path.join(root,'src','lib','settings-tab.js'),'utf8');
  assert.match(source,/selectedFilePath/);
  assert.match(source,/renderSelectedFilePreview/);
  assert.match(source,/tokenizeSource/);
  assert.match(source,/MarkdownRenderer/);
  assert.match(source,/Readable/);
  assert.match(source,/Source/);
  assert.match(source,/previewScroll/);
  assert.match(source,/proportionalScrollTop/);
});

test('plugin detail hides ignored localization/support files by default with an explicit Show ignored control', () => {
  const source = fs.readFileSync(path.join(root,'src','lib','settings-tab.js'),'utf8');
  assert.match(source,/showIgnoredFiles/);
  assert.match(source,/Show ignored/);
  assert.match(source,/localization\/support file/);
});

test('global Scan all and Translate all actions sit above the Summary section', () => {
  const source = fs.readFileSync(path.join(root,'src','lib','settings-tab.js'),'utf8');
  const display = source.slice(source.indexOf('display()'), source.indexOf('  renderModelCard(parent)'));
  const actions = display.indexOf('renderGlobalActions(');
  const summary = display.indexOf('renderSummary(');
  assert.ok(actions >= 0 && actions < summary);
});

test('v0.1.4 surfaces structured failure diagnostics with expandable Activity details and file retry controls', () => {
  const source = fs.readFileSync(path.join(root,'src','lib','settings-tab.js'),'utf8');
  assert.match(source,/lastFailure/);
  assert.match(source,/Show details/);
  assert.match(source,/Copy error/);
  assert.match(source,/Retry file/);
  assert.match(source,/Provider/);
  assert.match(source,/Model/);
  assert.match(source,/Batch/);
  assert.match(source,/formatFailureForClipboard/);
  assert.match(source,/runRetryFile/);
  const css = fs.readFileSync(path.join(root,'styles.css'),'utf8');
  assert.match(css,/uopt-diagnostic/);
  assert.match(css,/uopt-log-details/);
});
