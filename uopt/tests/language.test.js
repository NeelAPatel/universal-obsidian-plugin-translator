const test = require('node:test');
const assert = require('node:assert/strict');
const { hasForeignScript, detectLanguages, foreignRatio } = require('../src/lib/language');

test('detects common non-English scripts but ignores ordinary English accents', () => {
  assert.equal(hasForeignScript('Settings'), false);
  assert.equal(hasForeignScript('Café settings'), false);
  assert.equal(hasForeignScript('插件设置'), true);
  assert.equal(hasForeignScript('設定を保存'), true);
  assert.equal(hasForeignScript('설정 저장'), true);
  assert.equal(hasForeignScript('Настройки'), true);
});

test('returns useful language labels for mixed text', () => {
  assert.deepEqual(detectLanguages('保存 設定 カレンダー 설정'), ['Chinese', 'Japanese', 'Korean']);
});

test('foreign ratio stays zero for English and positive for non-English', () => {
  assert.equal(foreignRatio('Save settings'), 0);
  assert.ok(foreignRatio('保存设置') > 0.5);
});
