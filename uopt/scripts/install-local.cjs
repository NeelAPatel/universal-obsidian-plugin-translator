'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const vault = process.argv[2] ? path.resolve(process.argv[2]) : null;
const configDir = process.argv[3] || '.obsidian';
if (!vault) {
  console.error('Usage: node scripts/install-local.cjs /path/to/ObsidianVault [config-dir]');
  process.exit(2);
}
const dest = path.join(vault, configDir, 'plugins', 'uopt');
fs.mkdirSync(dest, {recursive:true});
for (const file of ['main.js','manifest.json','styles.css']) {
  fs.copyFileSync(path.join(root,file), path.join(dest,file));
}
console.log(`Installed UOPT to ${dest}`);
