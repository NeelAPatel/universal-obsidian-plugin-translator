'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');

test('macOS/Linux installer creates uopt directory before downloads', () => {
  const root = path.resolve(__dirname,'..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'uopt-shell-'));
  const bin = path.join(tmp,'bin');
  fs.mkdirSync(bin);
  const fakeCurl = path.join(bin,'curl');
  fs.writeFileSync(fakeCurl, '#!/usr/bin/env bash\nset -e\nout=""\nwhile [[ $# -gt 0 ]]; do if [[ "$1" == "-o" ]]; then out="$2"; shift 2; else shift; fi; done\n[[ -n "$out" ]] || exit 3\nprintf "fake" > "$out"\n');
  fs.chmodSync(fakeCurl,0o755);
  const vault = path.join(tmp,'Vault');
  fs.mkdirSync(vault);
  const result = spawnSync('bash',[path.join(root,'scripts','install.sh'),vault],{
    encoding:'utf8', env:{...process.env, PATH:`${bin}:${process.env.PATH}`}
  });
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(fs.readdirSync(path.join(vault,'.obsidian','plugins','uopt')).sort(),['main.js','manifest.json','styles.css']);
});
