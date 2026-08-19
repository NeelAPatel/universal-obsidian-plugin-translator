'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { assignOllamaProtocolTokens, parseOllamaLineProtocol } = require('../src/lib/providers');
const { batchCandidates, translateSource } = require('../src/lib/translator');
const { OLLAMA_BATCH_CHAR_BUDGET, OLLAMA_BATCH_MAX_CANDIDATES } = require('../src/lib/ollama-speed');
const { memorySeed, shouldInvalidateTranslationMemory } = require('../src/lib/service');

function c(id,text,start){ return {id,text,start,end:start+text.length,kind:'js-string',context:'ctx'}; }

test('Ollama protocol uses deterministic opaque non-sequential tokens that remain unique for duplicate source text', () => {
  const input=[c('c0','通用',10),c('c1','通用',30),c('c2','门户',50)];
  const first=assignOllamaProtocolTokens(input);
  const second=assignOllamaProtocolTokens(input);
  assert.deepEqual(first.map(x=>x.protocolId),second.map(x=>x.protocolId));
  assert.equal(new Set(first.map(x=>x.protocolId)).size,3);
  for (const row of first) {
    assert.match(row.protocolId,/^u_[a-f0-9]{16,64}$/);
    assert.notEqual(row.protocolId,row.id);
  }
});

test('parser accepts both physical TSV records and safely escaped protocol separators', () => {
  const candidates=assignOllamaProtocolTokens([c('c0','通用',10),c('c1','门户',30)]);
  const [a,b]=candidates.map(x=>x.protocolId);
  const physical=parseOllamaLineProtocol(`${a}\tGeneral\n${b}\tPortals`,candidates);
  assert.deepEqual([...physical.translations.entries()],[['c0','General'],['c1','Portals']]);
  assert.equal(physical.unresolvedIds.size,0);
  const escaped=parseOllamaLineProtocol(`${a}\\tGeneral\\n${b}\\tPortals`,candidates);
  assert.deepEqual([...escaped.translations.entries()],[['c0','General'],['c1','Portals']]);
  assert.equal(escaped.unresolvedIds.size,0);
});

test('escaped newlines inside a translation value are preserved unless followed by a known protocol token', () => {
  const candidates=assignOllamaProtocolTokens([c('c0','说明',10),c('c1','门户',30)]);
  const [a,b]=candidates.map(x=>x.protocolId);
  const parsed=parseOllamaLineProtocol(`${a}\\tLine one\\nLine two\\n${b}\\tPortals`,candidates);
  assert.equal(parsed.translations.get('c0'),'Line one\nLine two');
  assert.equal(parsed.translations.get('c1'),'Portals');
});

test('duplicate records for one token are ambiguous and remain unresolved instead of silently accepting one', () => {
  const candidates=assignOllamaProtocolTokens([c('c0','通用',10)]);
  const token=candidates[0].protocolId;
  const parsed=parseOllamaLineProtocol(`${token}\tGeneral\n${token}\tCommon`,candidates);
  assert.equal(parsed.translations.size,0);
  assert.deepEqual([...parsed.unresolvedIds],['c0']);
  assert.ok(parsed.invalidLines.length>=2);
});

test('one valid record plus malformed reuse of the same known token is ambiguous and retried', () => {
  const candidates=assignOllamaProtocolTokens([c('c0','通用',10)]);
  const token=candidates[0].protocolId;
  const parsed=parseOllamaLineProtocol(`${token}\tGeneral\n${token} malformed duplicate`,candidates);
  assert.equal(parsed.translations.size,0);
  assert.deepEqual([...parsed.unresolvedIds],['c0']);
});

test('unknown or invented protocol tokens can never satisfy a candidate', () => {
  const candidates=assignOllamaProtocolTokens([c('c0','通用',10)]);
  const parsed=parseOllamaLineProtocol('u_deadbeefdeadbeef\tGeneral',candidates);
  assert.equal(parsed.translations.size,0);
  assert.deepEqual([...parsed.unresolvedIds],['c0']);
});

test('Ollama batches obey both the character budget and a hard candidate-count ceiling', () => {
  assert.equal(OLLAMA_BATCH_CHAR_BUDGET,24000);
  assert.equal(OLLAMA_BATCH_MAX_CANDIDATES,48);
  const items=Array.from({length:130},(_,i)=>c(`c${i}`,'字',i*10));
  const batches=batchCandidates(items,OLLAMA_BATCH_CHAR_BUDGET,'',OLLAMA_BATCH_MAX_CANDIDATES);
  assert.ok(batches.length>=3);
  assert.ok(batches.every(batch=>batch.length<=48));
});

test('translate orchestration cannot raise an Ollama provider above its 24k safety ceiling', async() => {
  const candidates=Array.from({length:30},(_,i)=>({id:`c${i}`,text:'字',start:i,end:i+1,kind:'js-string',context:'x'.repeat(1000),protected:false}));
  const sizes=[];
  const provider={recommendedBatchChars:24000,recommendedBatchCandidates:48,lastTelemetry:null,async translate(_ctx,batch){sizes.push(batch.length);return new Map();}};
  await translateSource({source:'',candidates,pluginContext:{},provider,maxBatchChars:50000});
  assert.ok(sizes.length>=2,'an explicit larger caller budget must not override the provider safety ceiling');
  assert.ok(sizes.every(size=>size<=48));
});

test('provider-format failures invalidate persisted translation memory and prevent it from seeding another run', () => {
  const file={translationMemory:[{key:'js-string||通用',translation:'General'}],lastFailure:{category:'Provider format'}};
  assert.equal(shouldInvalidateTranslationMemory(file),true);
  const source='"通用"';
  const candidates=[{id:'c0',text:'通用',kind:'js-string',start:1,end:3}];
  const seed=memorySeed(source,candidates,shouldInvalidateTranslationMemory(file)?[]:file.translationMemory);
  assert.equal(seed.size,0);
});
