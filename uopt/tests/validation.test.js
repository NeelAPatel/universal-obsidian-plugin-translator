const test = require('node:test');
const assert = require('node:assert/strict');
const { validateContent } = require('../src/lib/validation');

test('accepts valid JavaScript and rejects broken JavaScript', () => {
  assert.deepEqual(validateContent('main.js', 'const x = "ok";'), { ok:true });
  const bad = validateContent('main.js', 'const x = ;');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Unexpected|token|expression/i);
});

test('accepts valid JSON and rejects broken JSON', () => {
  assert.equal(validateContent('manifest.json', '{"name":"x"}').ok, true);
  assert.equal(validateContent('manifest.json', '{"name":}').ok, false);
});

test('treats markdown as non-executable and valid', () => {
  assert.deepEqual(validateContent('README.md', '# hello'), { ok:true });
});
