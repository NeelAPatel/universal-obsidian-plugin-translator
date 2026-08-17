'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', 'uopt');
fs.rmSync(path.join(root, 'dist'), {recursive:true, force:true});
fs.mkdirSync(out, {recursive:true});
for (const file of ['main.js','manifest.json','styles.css']) {
  fs.copyFileSync(path.join(root,file), path.join(out,file));
}
console.log(`Release directory ready: ${out}`);
