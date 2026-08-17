const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContextMemo, findRepositoryFromCommunityIndex } = require('../src/lib/context');

test('context memo combines manifest and docs while respecting max characters', () => {
  const memo = buildContextMemo({
    manifest:{id:'x',name:'日历助手',version:'1.0.0',description:'管理日历'},
    localDocs:['# 使用说明\n这是一个日历插件。'.repeat(20)],
    repositoryReadme:'Repository README '.repeat(20),
    maxChars:500
  });
  assert.equal(memo.id,'x');
  assert.ok(memo.contextText.length <= 500);
  assert.match(memo.contextText,/日历助手/);
});

test('finds exact plugin repository in Obsidian community index', () => {
  const repo = findRepositoryFromCommunityIndex([{id:'abc',repo:'owner/repo'}], 'abc');
  assert.equal(repo,'owner/repo');
  assert.equal(findRepositoryFromCommunityIndex([{id:'abc',repo:'owner/repo'}], 'missing'), null);
});
