'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isMarkdownPath,
  previewLanguageForPath,
  tokenizeSource,
  proportionalScrollTop
} = require('../src/lib/preview');

test('detects Markdown preview files and source languages from file extensions', () => {
  assert.equal(isMarkdownPath('README.md'), true);
  assert.equal(isMarkdownPath('docs/help.markdown'), true);
  assert.equal(isMarkdownPath('main.js'), false);
  assert.equal(previewLanguageForPath('main.js'), 'javascript');
  assert.equal(previewLanguageForPath('config.json'), 'json');
  assert.equal(previewLanguageForPath('styles.css'), 'css');
  assert.equal(previewLanguageForPath('README.md'), 'markdown');
  assert.equal(previewLanguageForPath('unknown.dat'), 'plain');
});

test('JavaScript source tokenizer marks comments, keywords, strings, and numbers without changing text', () => {
  const source = 'const label = "保存"; // comment\nreturn label + 42;';
  const tokens = tokenizeSource(source, 'javascript');
  assert.equal(tokens.map(token => token.text).join(''), source);
  assert.ok(tokens.some(token => token.type === 'keyword' && token.text === 'const'));
  assert.ok(tokens.some(token => token.type === 'string' && token.text === '"保存"'));
  assert.ok(tokens.some(token => token.type === 'comment' && token.text === '// comment'));
  assert.ok(tokens.some(token => token.type === 'number' && token.text === '42'));
});

test('JSON source tokenizer distinguishes keys and values while preserving source', () => {
  const source = '{"name":"示例","enabled":true,"count":2}';
  const tokens = tokenizeSource(source, 'json');
  assert.equal(tokens.map(token => token.text).join(''), source);
  assert.ok(tokens.some(token => token.type === 'property' && token.text === '"name"'));
  assert.ok(tokens.some(token => token.type === 'string' && token.text === '"示例"'));
  assert.ok(tokens.some(token => token.type === 'boolean' && token.text === 'true'));
  assert.ok(tokens.some(token => token.type === 'number' && token.text === '2'));
});

test('Markdown source tokenizer highlights headings, links, code, and blockquote markers', () => {
  const source = '# 标题\n\n> 提示\n\nUse [Docs](https://example.com) and `code`.';
  const tokens = tokenizeSource(source, 'markdown');
  assert.equal(tokens.map(token => token.text).join(''), source);
  assert.ok(tokens.some(token => token.type === 'heading-marker' && token.text === '#'));
  assert.ok(tokens.some(token => token.type === 'blockquote-marker' && token.text === '>'));
  assert.ok(tokens.some(token => token.type === 'link' && token.text === '[Docs](https://example.com)'));
  assert.ok(tokens.some(token => token.type === 'code' && token.text === '`code`'));
});

test('proportional scroll fallback preserves approximate document position between modes', () => {
  assert.equal(proportionalScrollTop({top:450,scrollHeight:1000,clientHeight:100},{scrollHeight:2000,clientHeight:200}),900);
  assert.equal(proportionalScrollTop({top:0,scrollHeight:1000,clientHeight:100},{scrollHeight:2000,clientHeight:200}),0);
  assert.equal(proportionalScrollTop({top:900,scrollHeight:1000,clientHeight:100},{scrollHeight:500,clientHeight:100}),400);
});
