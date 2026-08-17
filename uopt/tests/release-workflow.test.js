'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');

test('release workflow publishes the PROJECT version from main without requiring a pre-existing tag', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(workflow, /push:\s*\n\s+branches:\s*\[main\]/);
  assert.match(workflow, /PROJECT_VERSION=.*require\('\.\.\/PROJECT\.json'\)\.version/);
  assert.match(workflow, /gh release view \"\$PROJECT_VERSION\"/);
  assert.match(workflow, /gh release create \"\$PROJECT_VERSION\"/);
  assert.doesNotMatch(workflow, /GITHUB_REF_NAME/);
});
