const test = require('node:test');
const assert = require('node:assert/strict');
const { applyTranslations, encodeTranslation } = require('../src/lib/patcher');

test('escapes quote characters when patching JavaScript literal bodies', () => {
  const candidate = { start: 12, end: 16, kind:'js-string', quote:"'", text:'用户设置' };
  assert.equal(encodeTranslation(candidate, "User's settings"), "User\\'s settings");
});

test('applies multiple non-overlapping replacements without shifting offsets', () => {
  const source = `a="保存"; b='取消';`;
  const candidates = [
    { id:'a', start:3, end:5, kind:'js-string', quote:'"', text:'保存' },
    { id:'b', start:11, end:13, kind:'js-string', quote:"'", text:'取消' }
  ];
  const out = applyTranslations(source, candidates, new Map([['a','Save'],['b','Cancel']]));
  assert.equal(out, `a="Save"; b='Cancel';`);
});

test('rejects overlapping replacement ranges', () => {
  const source = 'abcdef';
  const candidates = [
    {id:'a',start:1,end:4,kind:'raw',text:'bcd'},
    {id:'b',start:3,end:5,kind:'raw',text:'de'}
  ];
  assert.throws(() => applyTranslations(source, candidates, new Map([['a','X'],['b','Y']])), /overlap/i);
});
