const test = require('node:test');
const assert = require('node:assert/strict');
const { extractCandidates, extractMarkdownLines } = require('../src/lib/candidates');

test('extracts foreign JavaScript string literals but skips comments', () => {
  const src = `// "注释不应该翻译"\nnew Notice("保存成功"); const key = '状态';`;
  const items = extractCandidates('main.js', src);
  assert.deepEqual(items.map(x => x.text), ['保存成功', '状态']);
  assert.ok(items.every(x => x.kind === 'js-string'));
});

test('extracts JSON values but never JSON keys', () => {
  const src = `{"设置":"设置页面","nested":{"按钮":"保存"}}`;
  const items = extractCandidates('locales.json', src);
  assert.deepEqual(items.map(x => x.text), ['设置页面', '保存']);
});

test('extracts CSS content values', () => {
  const src = `.x::before { content: "设置"; } .y { color: red; }`;
  const items = extractCandidates('styles.css', src);
  assert.deepEqual(items.map(x => x.text), ['设置']);
});

test('extracts foreign markdown lines but skips fenced code blocks', () => {
  const src = `# 使用说明\n\n这是帮助文本。\n\n\`\`\`js\nconsole.log("不要翻译")\n\`\`\``;
  const items = extractCandidates('README.md', src);
  assert.deepEqual(items.map(x => x.text), ['# 使用说明', '这是帮助文本。']);
});

test('markdown localization navigation links are ignored as translation noise', () => {
  const source = '# Plugin\n\n[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)\n\n正常说明需要翻译。';
  const items = extractMarkdownLines(source);
  assert.deepEqual(items.map(item => item.text), ['正常说明需要翻译。']);
});

test('plain language selector lines are ignored as documentation localization chrome', () => {
  const source = '# Plugin\n\nEnglish | 简体中文 | 日本語\n\n真正需要翻译的说明。';
  const items = extractMarkdownLines(source);
  assert.deepEqual(items.map(item => item.text), ['真正需要翻译的说明。']);
});
