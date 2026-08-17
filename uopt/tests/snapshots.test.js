const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SnapshotStore } = require('../src/lib/snapshots');

test('stores original and translated snapshots outside target plugin files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uopt-snap-'));
  const store = new SnapshotStore(dir);
  const original = await store.save('example-plugin', 'docs/help.md', 'original', 'hash1', '原文');
  const translated = await store.save('example-plugin', 'docs/help.md', 'translated', 'hash2', 'English');
  assert.notEqual(original, translated);
  assert.equal(await fs.readFile(original, 'utf8'), '原文');
  assert.equal(await fs.readFile(translated, 'utf8'), 'English');
  assert.ok(original.startsWith(dir));
});

test('uses collision-safe path encoding for nested files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uopt-snap-'));
  const store = new SnapshotStore(dir);
  const a = await store.save('p', 'a/b.md', 'original', 'h1', 'a');
  const b = await store.save('p', 'a__b.md', 'original', 'h2', 'b');
  assert.notEqual(a, b);
});
