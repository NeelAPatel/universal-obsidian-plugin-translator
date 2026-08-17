'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');

test('local installer copies only the three runtime files into .obsidian/plugins/uopt', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(),'uopt-vault-'));
  const result = spawnSync(process.execPath,[path.join(__dirname,'..','scripts','install-local.cjs'),vault],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const dest = path.join(vault,'.obsidian','plugins','uopt');
  assert.deepEqual(fs.readdirSync(dest).sort(),['main.js','manifest.json','styles.css']);
});
