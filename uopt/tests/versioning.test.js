'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname,'..');
const repoRoot = path.resolve(root,'..');

test('PROJECT.json is the canonical UOPT identity and all version metadata agrees on 0.1.2', () => {
  const project = JSON.parse(fs.readFileSync(path.join(repoRoot,'PROJECT.json'),'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  const versions = JSON.parse(fs.readFileSync(path.join(root,'versions.json'),'utf8'));
  assert.equal(project.title, 'Universal Obsidian Plugin Translator');
  assert.equal(project.shortName, 'UOPT');
  assert.equal(project.pluginId, 'uopt');
  assert.equal(project.repository, 'NeelAPatel/universal-obsidian-plugin-translator');
  assert.equal(project.projectDirectory, 'uopt');
  assert.equal(project.version, '0.1.2');
  assert.equal(pkg.version, project.version);
  assert.equal(manifest.version, project.version);
  assert.equal(manifest.id, project.pluginId);
  assert.equal(manifest.name, project.title);
  assert.equal(versions[project.version], manifest.minAppVersion);
});
