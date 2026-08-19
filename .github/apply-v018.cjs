'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const write=(p,s)=>fs.writeFileSync(path.join(root,p),s,'utf8');
function replaceOnce(file,from,to){let s=read(file);if(!s.includes(from))throw new Error(`Pattern not found in ${file}: ${from.slice(0,100)}`);s=s.replace(from,to);write(file,s);}
function replaceBetween(file,startMarker,endMarker,replacement){let s=read(file);const a=s.indexOf(startMarker);if(a<0)throw new Error(`Start not found in ${file}: ${startMarker}`);const b=s.indexOf(endMarker,a);if(b<0)throw new Error(`End not found in ${file}: ${endMarker}`);s=s.slice(0,a)+replacement+s.slice(b);write(file,s);}
function replaceTestSection(file,title,nextTitle,replacement){const start=`test('${title}'`;const end=`test('${nextTitle}'`;replaceBetween(file,start,end,replacement+'\n\n');}

// Isolated, safety-focused Ollama wire protocol.
write('uopt/src/lib/ollama-protocol.js',`'use strict';
const crypto = require('node:crypto');

function escapeRegExp(value) { return String(value).replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&'); }

function assignOllamaProtocolTokens(candidates=[]) {
  const used = new Set();
  return candidates.map((candidate,index) => {
    const identity = JSON.stringify([candidate.id,candidate.kind,candidate.start,candidate.end,candidate.text,index]);
    const digest = crypto.createHash('sha256').update(identity).digest('hex');
    let width = 16;
    let protocolId = \`u_\${digest.slice(0,width)}\`;
    while (used.has(protocolId) && width < 64) {
      width = Math.min(64,width + 8);
      protocolId = \`u_\${digest.slice(0,width)}\`;
    }
    if (used.has(protocolId)) throw new Error('Ollama protocol token collision');
    used.add(protocolId);
    return {...candidate,protocolId};
  });
}

function decodeLineValue(value) {
  const input = String(value || '');
  let out = '';
  for (let i=0;i<input.length;i++) {
    if (input[i] !== '\\\\' || i+1 >= input.length) { out += input[i]; continue; }
    const next=input[++i];
    if (next==='n') out += '\\n';
    else if (next==='r') out += '\\r';
    else if (next==='t') out += '\\t';
    else if (next==='\\\\') out += '\\\\';
    else out += \`\\\\\${next}\`;
  }
  return out;
}

function normalizeEscapedRecordSeparators(text,protocolIds) {
  const raw=String(text || '');
  if (!raw || !protocolIds.length) return raw;
  const alternatives=[...protocolIds].sort((a,b)=>b.length-a.length).map(escapeRegExp).join('|');
  const escapedNewlineBeforeKnownRecord = new RegExp('\\\\\\\\n(?=\\\\s*(?:'+alternatives+')(?:\\\\t|\\\\\\\\t))','g');
  return raw.replace(escapedNewlineBeforeKnownRecord,'\\n');
}

function parseOllamaLineProtocol(text,candidates) {
  const tokenToId = new Map(candidates.map(c => [c.protocolId || c.id,c.id]));
  const protocolIds=[...tokenToId.keys()];
  const allowedIds=new Set(candidates.map(c=>c.id));
  const translations=new Map();
  const skippedIds=new Set();
  const decidedIds=new Set();
  const invalidLines=[];
  const records=new Map();
  const raw=String(text || '').trim();
  if (!raw) return {translations,skippedIds,decidedIds,unresolvedIds:new Set(allowedIds),invalidLines:['<empty response>']};

  const normalized=normalizeEscapedRecordSeparators(raw,protocolIds);
  for (const original of normalized.split(/\\r?\\n/)) {
    const line=original.trimEnd();
    const trimmed=line.trim();
    if (!trimmed || /^\`\`\`(?:text|txt)?\\s*$/i.test(trimmed) || trimmed==='\`\`\`') continue;
    const working=line.trimStart();
    let token=null;
    let delimiterLength=0;
    for (const known of protocolIds) {
      if (working.startsWith(known+'\\t')) { token=known; delimiterLength=known.length+1; break; }
      if (working.startsWith(known+'\\\\t')) { token=known; delimiterLength=known.length+2; break; }
    }
    if (!token) { invalidLines.push(original); continue; }
    const id=tokenToId.get(token);
    const encoded=working.slice(delimiterLength);
    if (!records.has(id)) records.set(id,[]);
    records.get(id).push({original,encoded});
  }

  for (const candidate of candidates) {
    const id=candidate.id;
    const rows=records.get(id) || [];
    if (rows.length !== 1) {
      if (rows.length > 1) invalidLines.push(...rows.map(row=>row.original));
      continue;
    }
    const value=decodeLineValue(rows[0].encoded).trimEnd();
    if (!value) { invalidLines.push(rows[0].original); continue; }
    if (/^__(?:SKIP)__$/i.test(value) || /^SKIP$/i.test(value)) {
      skippedIds.add(id); decidedIds.add(id); continue;
    }
    translations.set(id,value); decidedIds.add(id);
  }

  const unresolvedIds=new Set([...allowedIds].filter(id=>!decidedIds.has(id)));
  return {translations,skippedIds,decidedIds,unresolvedIds,invalidLines};
}

module.exports={assignOllamaProtocolTokens,parseOllamaLineProtocol,decodeLineValue,normalizeEscapedRecordSeparators};
`);

// providers.js: use opaque protocol tokens for Ollama and re-export protocol helpers.
replaceOnce('uopt/src/lib/providers.js',"const { OLLAMA_BATCH_CHAR_BUDGET, OLLAMA_KEEP_ALIVE, aggregateOllamaTelemetry } = require('./ollama-speed');\n","const { OLLAMA_BATCH_CHAR_BUDGET, OLLAMA_BATCH_MAX_CANDIDATES, OLLAMA_KEEP_ALIVE, aggregateOllamaTelemetry } = require('./ollama-speed');\nconst { assignOllamaProtocolTokens, parseOllamaLineProtocol, decodeLineValue } = require('./ollama-protocol');\n");
replaceBetween('uopt/src/lib/providers.js','function decodeLineValue(value) {','class OpenAIProvider {','class OpenAIProvider {');
replaceOnce('uopt/src/lib/providers.js',"    this.recommendedBatchChars = OLLAMA_BATCH_CHAR_BUDGET;\n","    this.recommendedBatchChars = OLLAMA_BATCH_CHAR_BUDGET;\n    this.recommendedBatchCandidates = OLLAMA_BATCH_MAX_CANDIDATES;\n");
replaceOnce('uopt/src/lib/providers.js',"    const translations = new Map();\n    const decidedIds = new Set();\n    const candidateById = new Map(candidates.map(c => [c.id, c]));\n    let pending = [...candidates];\n","    const protocolCandidates = assignOllamaProtocolTokens(candidates);\n    const translations = new Map();\n    const decidedIds = new Set();\n    const candidateById = new Map(protocolCandidates.map(c => [c.id, c]));\n    let pending = [...protocolCandidates];\n");
replaceOnce('uopt/src/lib/providers.js',"      pending = candidates.filter(c => !decidedIds.has(c.id));\n","      pending = protocolCandidates.filter(c => !decidedIds.has(c.id));\n");
replaceOnce('uopt/src/lib/providers.js',"  normalizeTranslationResult, parseJsonText, parseOllamaLineProtocol, decodeLineValue\n};\n","  normalizeTranslationResult, parseJsonText, parseOllamaLineProtocol, decodeLineValue, assignOllamaProtocolTokens\n};\n");

// Smaller, bounded local-model batches; compact payload exposes only opaque token on the wire.
replaceOnce('uopt/src/lib/ollama-speed.js','const OLLAMA_BATCH_CHAR_BUDGET = 42000;\n',"const OLLAMA_BATCH_CHAR_BUDGET = 24000;\nconst OLLAMA_BATCH_MAX_CANDIDATES = 48;\n");
replaceOnce('uopt/src/lib/ollama-speed.js','    id:candidate.id,\n','    id:candidate.protocolId || candidate.id,\n');
replaceOnce('uopt/src/lib/ollama-speed.js','  OLLAMA_BATCH_CHAR_BUDGET,\n','  OLLAMA_BATCH_CHAR_BUDGET,\n  OLLAMA_BATCH_MAX_CANDIDATES,\n');

// Make physical delimiters unambiguous in the model instruction.
replaceOnce('uopt/src/lib/prompts.js',"      'Return exactly one record for every candidate using: candidate-id<TAB>translation',\n      'If a candidate must not be translated, use the literal translation value __SKIP__.',\n      'Candidate IDs must be copied exactly. Never invent IDs.',\n      String.raw`A translation must stay on one physical output line. Escape backslash as \\\\, tab as \\t, newline as \\n, and carriage return as \\r inside the translation value.`,\n","      'Return exactly one record for every candidate: copy its opaque candidate token, then ONE REAL TAB character, then the translation.',\n      'Separate records with REAL newline characters. Do not write the two literal characters \\\\t or \\\\n as protocol separators.',\n      'If a candidate must not be translated, use the literal translation value __SKIP__.',\n      'Candidate tokens must be copied exactly from the input. Never shorten, increment, infer, or invent tokens.',\n      String.raw`Only inside the translation value: escape backslash as \\\\, tab as \\t, newline as \\n, and carriage return as \\r so each record remains one physical output line.`,\n");

// Batching obeys both character and candidate-count ceilings, including semantic groups.
replaceBetween('uopt/src/lib/translator.js','function splitBudget(items, maxChars) {','function batchCandidates(candidates, maxChars = 14000, source = \'\') {',`function splitBudget(items, maxChars, maxItems = Infinity) {
  const batches = [];
  let batch = [];
  let cost = 0;
  const itemLimit = Number.isFinite(Number(maxItems)) && Number(maxItems) > 0 ? Math.floor(Number(maxItems)) : Infinity;
  for (const candidate of items) {
    const next = candidateCost(candidate);
    if (batch.length && (cost + next > maxChars || batch.length >= itemLimit)) {
      batches.push(batch);
      batch = [];
      cost = 0;
    }
    batch.push(candidate);
    cost += next;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function batchCandidates(candidates, maxChars = 14000, source = '', maxItems = Infinity) {`);
replaceOnce('uopt/src/lib/translator.js','  if (!sourceModuleMarkers(source).length) return splitBudget(annotated, maxChars);\n','  if (!sourceModuleMarkers(source).length) return splitBudget(annotated, maxChars, maxItems);\n');
replaceOnce('uopt/src/lib/translator.js','  const baselineBatches = splitBudget(annotated, maxChars);\n','  const baselineBatches = splitBudget(annotated, maxChars, maxItems);\n');
replaceOnce('uopt/src/lib/translator.js','    if (groupCost > maxChars) {\n      flushPacked();\n      batches.push(...splitBudget(semanticGroup, maxChars));\n','    if (groupCost > maxChars || semanticGroup.length > maxItems) {\n      flushPacked();\n      batches.push(...splitBudget(semanticGroup, maxChars, maxItems));\n');
replaceOnce('uopt/src/lib/translator.js','    if (packed.length && packedCost + groupCost > maxChars) flushPacked();\n','    if (packed.length && (packedCost + groupCost > maxChars || packed.length + semanticGroup.length > maxItems)) flushPacked();\n');
replaceOnce('uopt/src/lib/translator.js','async function translateSource({ source, candidates, pluginContext, provider, filePath = null, maxBatchChars = null, onBatch, onBatchComplete, onAttempt, seedTranslations = new Map() }) {\n','async function translateSource({ source, candidates, pluginContext, provider, filePath = null, maxBatchChars = null, maxBatchCandidates = null, onBatch, onBatchComplete, onAttempt, seedTranslations = new Map() }) {\n');
replaceOnce('uopt/src/lib/translator.js',"  const providerBudget = Math.max(0, Number(provider && provider.recommendedBatchChars) || 0);\n  const baseBudget = configuredBudget || 14000;\n  const effectiveBatchChars = providerBudget ? Math.max(baseBudget, providerBudget) : baseBudget;\n  const batches = batchCandidates(eligible, effectiveBatchChars, source);\n","  const providerBudget = Math.max(0, Number(provider && provider.recommendedBatchChars) || 0);\n  const configuredCandidateLimit = Math.max(0, Number(maxBatchCandidates) || 0);\n  const providerCandidateLimit = Math.max(0, Number(provider && provider.recommendedBatchCandidates) || 0);\n  const baseBudget = configuredBudget || 14000;\n  const effectiveBatchChars = providerBudget ? Math.max(baseBudget, providerBudget) : baseBudget;\n  const effectiveBatchCandidates = configuredCandidateLimit && providerCandidateLimit ? Math.min(configuredCandidateLimit,providerCandidateLimit) : configuredCandidateLimit || providerCandidateLimit || Infinity;\n  const batches = batchCandidates(eligible, effectiveBatchChars, source, effectiveBatchCandidates);\n");

// Failed provider-format memory is quarantined: never seed it, never persist new partial results from a failed file.
replaceOnce('uopt/src/lib/service.js','function memoryKey(source, candidate) {\n',"function shouldInvalidateTranslationMemory(file) {\n  return !!(file && file.lastFailure && file.lastFailure.category === 'Provider format');\n}\n\nfunction memoryKey(source, candidate) {\n");
replaceOnce('uopt/src/lib/service.js','    const files = Object.fromEntries(result.files.map(f => [f.path, f]));\n',"    const files = Object.fromEntries(result.files.map(f => [f.path, f]));\n    for (const file of Object.values(files)) {\n      if (shouldInvalidateTranslationMemory(file)) file.translationMemory = [];\n    }\n");
replaceOnce('uopt/src/lib/service.js','        const seedTranslations = memorySeed(source, candidates, file.translationMemory);\n',"        if (shouldInvalidateTranslationMemory(file)) file.translationMemory = [];\n        const seedTranslations = memorySeed(source, candidates, file.translationMemory);\n");
replaceOnce('uopt/src/lib/service.js',"      } catch (error) {\n        if (source && candidates.length && error && error.uoptPartialTranslations instanceof Map) {\n          const recoveredMemory = translationMemoryEntries(source, candidates, error.uoptPartialTranslations);\n          if (recoveredMemory.length) file.translationMemory = mergeTranslationMemory(file.translationMemory, recoveredMemory);\n        }\n        const failureStage = error && error.uoptStage;\n","      } catch (error) {\n        const failureStage = error && error.uoptStage;\n");
replaceOnce('uopt/src/lib/service.js','module.exports = { UoptService, defaultState, memoryKey, memorySeed, translationMemoryEntries, mergeTranslationMemory };\n','module.exports = { UoptService, defaultState, memoryKey, memorySeed, translationMemoryEntries, mergeTranslationMemory, shouldInvalidateTranslationMemory };\n');

// Update legacy tests whose v0.1.6/v0.1.7 contracts are intentionally superseded.
let speed=read('uopt/tests/v016-speed.test.js');
speed=speed.replace('  OLLAMA_BATCH_CHAR_BUDGET,\n  OLLAMA_KEEP_ALIVE,','  OLLAMA_BATCH_CHAR_BUDGET,\n  OLLAMA_BATCH_MAX_CANDIDATES,\n  OLLAMA_KEEP_ALIVE,');
speed=speed.replace("test('Ollama speed policy uses a larger local batch budget and keeps the model warm', () => {\n  assert.equal(OLLAMA_BATCH_CHAR_BUDGET, 42000);\n  assert.equal(OLLAMA_KEEP_ALIVE, '15m');\n});","test('Ollama speed policy uses bounded safety batches and keeps the model warm', () => {\n  assert.equal(OLLAMA_BATCH_CHAR_BUDGET, 24000);\n  assert.equal(OLLAMA_BATCH_MAX_CANDIDATES, 48);\n  assert.equal(OLLAMA_KEEP_ALIVE, '15m');\n});");
speed=speed.replace("  const provider=new OllamaProvider({baseUrl:'http://localhost:11434',model:'qwen3.5:9b',request:async req=>{\n    calls.push(JSON.parse(req.body));\n    return {json:{message:{content:'c0\\tSave'},total_duration:100,load_duration:5,prompt_eval_count:40,prompt_eval_duration:20,eval_count:7,eval_duration:70}};\n  }});","  const provider=new OllamaProvider({baseUrl:'http://localhost:11434',model:'qwen3.5:9b',request:async req=>{\n    const body=JSON.parse(req.body); calls.push(body);\n    const payload=JSON.parse(body.messages.find(m=>m.role==='user').content);\n    return {json:{message:{content:`${payload.candidates[0].id}\\tSave`},total_duration:100,load_duration:5,prompt_eval_count:40,prompt_eval_duration:20,eval_count:7,eval_duration:70}};\n  }});");
speed=speed.replace('  assert.equal(provider.recommendedBatchChars,42000);','  assert.equal(provider.recommendedBatchChars,24000);\n  assert.equal(provider.recommendedBatchCandidates,48);');
speed=speed.replace(/recommendedBatchChars:42000/g,'recommendedBatchChars:24000');
write('uopt/tests/v016-speed.test.js',speed);

replaceTestSection('uopt/tests/providers.test.js','Ollama retries only unresolved candidates and keeps valid translations from the first response','Ollama terminal protocol failure exposes recovered translations instead of discarding them',`test('Ollama retries only unresolved opaque tokens and keeps valid translations from the first response', async () => {
  const { OllamaProvider } = require('../src/lib/providers');
  const calls=[]; let firstTokens=[];
  const provider=new OllamaProvider({baseUrl:'http://localhost:11434',model:'qwen3.5:9b',maxProtocolAttempts:3,request:async req=>{
    const body=JSON.parse(req.body); calls.push(body);
    const payload=JSON.parse(body.messages.find(m=>m.role==='user').content);
    const ids=payload.candidates.map(c=>c.id);
    if (calls.length===1) { firstTokens=ids; return {json:{message:{content:\`${'${ids[0]}'}\\tGeneral\\n${'${ids[1]}'} malformed\\n${'${ids[2]}'}\\tSaved successfully\`}}}; }
    assert.deepEqual(ids,[firstTokens[1]]);
    return {json:{message:{content:\`${'${ids[0]}'}\\t__SKIP__\`}}};
  }});
  const candidates=[
    {id:'c0',text:'通用',kind:'js-string',context:'label: "通用"'},
    {id:'c1',text:'内部状态',kind:'js-string',context:'const machine = "内部状态"'},
    {id:'c2',text:'保存成功',kind:'js-string',context:'new Notice("保存成功")'}
  ];
  const result=await provider.translate({name:'Canvas Enhance'},candidates);
  assert.deepEqual([...result.entries()],[['c0','General'],['c2','Saved successfully']]);
  assert.equal(calls.length,2);
  assert.ok(firstTokens.every(id=>/^u_[a-f0-9]{16,64}$/.test(id)));
  assert.equal(calls[0].format,undefined);
  assert.equal(calls[0].options.temperature,0);
});`);

replaceTestSection('uopt/tests/providers.test.js','Ollama terminal protocol failure exposes recovered translations instead of discarding them','Canvas Enhance regression: one malformed row out of 29 retries only that candidate',`test('Ollama terminal protocol failure exposes recovered translations in-memory without making them persistence-safe', async () => {
  const { OllamaProvider } = require('../src/lib/providers');
  let calls=0; let firstToken=null;
  const provider=new OllamaProvider({baseUrl:'http://localhost:11434',model:'qwen3.5:9b',maxProtocolAttempts:2,request:async req=>{
    calls++;
    const body=JSON.parse(req.body); const payload=JSON.parse(body.messages.find(m=>m.role==='user').content);
    const ids=payload.candidates.map(c=>c.id);
    if (calls===1) { firstToken=ids[0]; return {json:{message:{content:\`${'${ids[0]}'}\\tGeneral\\n${'${ids[1]}'} malformed\`}}}; }
    return {json:{message:{content:'still malformed'}}};
  }});
  const candidates=[{id:'c0',text:'通用',kind:'js-string',context:'label'},{id:'c1',text:'保存',kind:'js-string',context:'notice'}];
  await assert.rejects(()=>provider.translate({name:'Canvas Enhance'},candidates),error=>{
    assert.match(error.message,/1 candidate\\(s\\) unresolved/i);
    assert.equal(error.uoptStage,'provider');
    assert.deepEqual([...error.uoptPartialTranslations.entries()],[['c0','General']]);
    assert.deepEqual(error.uoptUnresolvedIds,['c1']);
    assert.match(firstToken,/^u_/);
    return true;
  });
});`);

replaceTestSection('uopt/tests/providers.test.js','Canvas Enhance regression: one malformed row out of 29 retries only that candidate','Ollama prompt describes escapes literally rather than inserting control characters',`test('Canvas Enhance regression: one malformed opaque-token row retries only that candidate', async () => {
  const { OllamaProvider } = require('../src/lib/providers');
  const candidates=Array.from({length:29},(_,i)=>({id:\`c\${i}\`,text:i===17?'画布内搜索':\`设置\${i}\`,kind:'js-string',semanticGroup:'src/settings.ts',context:\`SETTINGS option \${i}\`}));
  const calls=[]; let firstIds=[];
  const provider=new OllamaProvider({baseUrl:'http://localhost:11434',model:'qwen3.5:9b',request:async req=>{
    const body=JSON.parse(req.body); calls.push(body); const payload=JSON.parse(body.messages.find(m=>m.role==='user').content); const ids=payload.candidates.map(c=>c.id);
    if (calls.length===1) { firstIds=ids; const content=ids.map((id,i)=>i===17?\`${'${id}'} malformed\`:\`${'${id}'}\\tEnglish \${i}\`).join('\\n'); return {json:{message:{content}}}; }
    assert.deepEqual(ids,[firstIds[17]]); return {json:{message:{content:\`${'${ids[0]}'}\\tSearch canvas\`}}};
  }});
  const result=await provider.translate({name:'Canvas Enhance'},candidates);
  assert.equal(result.size,29); assert.equal(result.get('c17'),'Search canvas'); assert.equal(calls.length,2);
  assert.ok(firstIds.every(id=>/^u_[a-f0-9]{16,64}$/.test(id)));
});`);

// Replace the old unsafe service-memory regression with the new quarantine behavior.
let serviceTests=read('uopt/tests/service.test.js');
const oldStart="test('provider-format failure persists recovered translations as memory without partially writing the plugin file'";
const oldEnd="  assert.equal(await fs.readFile(targetFile,'utf8'),'// src/settings.ts\\nnew Notice(\"Save\");\\nnew Notice(\"Delete\");');\n});";
const a=serviceTests.indexOf(oldStart); const b=serviceTests.indexOf(oldEnd,a);
if(a<0||b<0) throw new Error('Old service provider-format memory test not found');
const newServiceTest=`test('provider-format failure never persists recovered translations and retry starts from a clean file', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'uopt-service-')); const pluginsRoot=path.join(root,'plugins'); const target=path.join(pluginsRoot,'canvas-enhance');
  await fs.mkdir(target,{recursive:true}); await fs.writeFile(path.join(target,'manifest.json'),JSON.stringify({id:'canvas-enhance',name:'Canvas Enhance',version:'1.0.3'}));
  const targetFile=path.join(target,'main.js'); const original='// src/settings.ts\\nnew Notice("保存");\\nnew Notice("删除");'; await fs.writeFile(targetFile,original);
  const service=new UoptService({pluginsRoot,selfId:'uopt',snapshotRoot:path.join(root,'snapshots'),state:defaultState()}); await service.scanPlugin('canvas-enhance'); service.state.plugins['canvas-enhance'].files['main.js'].approved=true;
  const failingProvider={providerName:'Ollama',model:'qwen3.5:9b',async translate(_ctx,batch){const error=new Error('Ollama line protocol left 1 candidate(s) unresolved after 3 attempts'); error.uoptStage='provider'; error.uoptPartialTranslations=new Map([[batch[0].id,'Save']]); error.uoptUnresolvedIds=[batch[1].id]; throw error;}};
  const failed=await service.translatePlugin('canvas-enhance',failingProvider); assert.equal(failed.translatedFiles,0); assert.equal(await fs.readFile(targetFile,'utf8'),original);
  const record=service.state.plugins['canvas-enhance'].files['main.js']; assert.equal(record.translationMemory.length,0); assert.equal(record.lastFailure.category,'Provider format');
  let retryBatch=null; const retryProvider={providerName:'Ollama',model:'qwen3.5:9b',async translate(_ctx,batch){retryBatch=batch; return new Map(batch.map(c=>[c.id,c.text==='保存'?'Save':'Delete']));}};
  const retry=await service.translatePlugin('canvas-enhance',retryProvider,{onlyFiles:['main.js']}); assert.equal(retry.translatedFiles,1); assert.equal(retryBatch.length,2);
  assert.equal(await fs.readFile(targetFile,'utf8'),'// src/settings.ts\\nnew Notice("Save");\\nnew Notice("Delete");');
});`;
serviceTests=serviceTests.slice(0,a)+newServiceTest+serviceTests.slice(b+oldEnd.length); write('uopt/tests/service.test.js',serviceTests);

// Version metadata and compatibility.
for(const file of ['PROJECT.json','uopt/package.json','uopt/manifest.json','uopt/package-lock.json']) { const data=JSON.parse(read(file)); data.version='0.1.8'; if(data.packages&&data.packages[''])data.packages[''].version='0.1.8'; write(file,JSON.stringify(data,null,2)+'\n'); }
const versions=JSON.parse(read('uopt/versions.json')); versions['0.1.8']='1.7.2'; write('uopt/versions.json',JSON.stringify(versions,null,2)+'\n');
let versionTest=read('uopt/tests/versioning.test.js').replace(/0\.1\.7/g,'0.1.8'); write('uopt/tests/versioning.test.js',versionTest);
let changelog=read('CHANGELOG.md'); if(!changelog.startsWith('## 0.1.8')) changelog=`## 0.1.8\n\n- Replaced sequential Ollama wire IDs with deterministic opaque candidate tokens to prevent silent translation drift.\n- Added safe recovery for literal \\t / \\n protocol separators while preserving escapes inside translation values.\n- Reduced Ollama batches to at most 24k estimated characters and 48 candidates.\n- Duplicate or invented candidate tokens are rejected and retried rather than silently accepted.\n- Provider-format failures now quarantine/discard partial translation memory; previously failed format memory is invalidated before reuse.\n- Retained v0.1.7 full request/response/parser logging for forensic verification.\n\n`+changelog; write('CHANGELOG.md',changelog);
console.log('Applied UOPT v0.1.8 Ollama safety migration');
