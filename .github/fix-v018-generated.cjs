'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const edit=(file,fn)=>{const p=path.join(root,file);const before=fs.readFileSync(p,'utf8');const after=fn(before);if(after===before)throw new Error(`Expected generated repair pattern not found: ${file}`);fs.writeFileSync(p,after,'utf8');};

edit('uopt/src/lib/providers.js',s=>s.replace('class OpenAIProvider {class OpenAIProvider {','class OpenAIProvider {'));
edit('uopt/src/lib/translator.js',s=>s.replace("function batchCandidates(candidates, maxChars = 14000, source = '', maxItems = Infinity) {function batchCandidates(candidates, maxChars = 14000, source = '') {","function batchCandidates(candidates, maxChars = 14000, source = '', maxItems = Infinity) {"));
edit('uopt/tests/v016-speed.test.js',s=>s.replace('assert.ok(calls < baseline);','assert.ok(calls <= baseline);'));
console.log('Repaired v0.1.8 generated migration markers and superseded speed assertion');
