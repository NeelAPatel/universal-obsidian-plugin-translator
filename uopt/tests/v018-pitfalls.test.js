'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {UoptService,defaultState,memoryKey,TRANSLATION_MEMORY_VERSION}=require('../src/lib/service');
const {extractCandidates}=require('../src/lib/candidates');
const {TranslationRunLogger}=require('../src/lib/run-logger');

async function fixture(source='new Notice("保存");') {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'uopt-v018-'));
  const pluginsRoot=path.join(root,'plugins');
  const target=path.join(pluginsRoot,'demo');
  await fs.mkdir(target,{recursive:true});
  await fs.writeFile(path.join(target,'manifest.json'),JSON.stringify({id:'demo',name:'Demo',version:'1.0.0'}));
  await fs.writeFile(path.join(target,'main.js'),source);
  const service=new UoptService({pluginsRoot,selfId:'uopt',snapshotRoot:path.join(root,'snapshots'),state:defaultState()});
  await service.scanPlugin('demo');
  service.state.plugins.demo.files['main.js'].approved=true;
  return {root,pluginsRoot,target,service};
}

test('unversioned pre-v0.1.8 translation memory is never reused, then successful v0.1.8 memory is versioned',async()=>{
  const {target,service}=await fixture();
  const source=await fs.readFile(path.join(target,'main.js'),'utf8');
  const candidate=extractCandidates('main.js',source)[0];
  const file=service.state.plugins.demo.files['main.js'];
  file.translationMemory=[{key:memoryKey(source,candidate),source:candidate.text,kind:candidate.kind,translation:'STALE'}];
  delete file.translationMemoryVersion;
  let calls=0;
  const provider={providerName:'Ollama',model:'qwen3.5:9b',async translate(_ctx,batch){calls++;return new Map(batch.map(c=>[c.id,'Fresh']));}};
  const result=await service.translatePlugin('demo',provider);
  assert.equal(result.translatedFiles,1);
  assert.equal(calls,1,'legacy memory must not suppress a provider call');
  assert.equal(await fs.readFile(path.join(target,'main.js'),'utf8'),'new Notice("Fresh");');
  assert.equal(file.translationMemoryVersion,TRANSLATION_MEMORY_VERSION);
});

test('v0.1.8 translation-memory provenance survives a later scan',async()=>{
  const {service}=await fixture();
  const provider={providerName:'Ollama',model:'qwen3.5:9b',async translate(_ctx,batch){return new Map(batch.map(c=>[c.id,'Saved']));}};
  await service.translatePlugin('demo',provider);
  await service.scanPlugin('demo');
  assert.equal(service.state.plugins.demo.files['main.js'].translationMemoryVersion,TRANSLATION_MEMORY_VERSION);
});

test('translation logging failures are diagnostic-only and cannot fail or alter a successful target translation',async()=>{
  const {target,service}=await fixture();
  const runLogger={
    async writeCandidates(){throw new Error('disk full');},
    async appendEvent(){throw new Error('disk full');}
  };
  const provider={providerName:'Ollama',model:'qwen3.5:9b',async translate(_ctx,batch){return new Map(batch.map(c=>[c.id,'Saved']));}};
  const result=await service.translatePlugin('demo',provider,{runLogger});
  assert.equal(result.errors.length,0);
  assert.equal(result.translatedFiles,1);
  assert.equal(await fs.readFile(path.join(target,'main.js'),'utf8'),'new Notice("Saved");');
  assert.match(runLogger.lastError,/disk full/);
});

test('translated snapshot failure happens before atomic replacement so the client plugin remains byte-for-byte original',async()=>{
  const {target,service}=await fixture();
  const targetFile=path.join(target,'main.js');
  const original=await fs.readFile(targetFile,'utf8');
  const realSave=service.snapshotStore.save.bind(service.snapshotStore);
  service.snapshotStore.save=async(pluginId,relativePath,kind,hash,content)=>{
    if(kind==='translated') throw new Error('snapshot disk full');
    return realSave(pluginId,relativePath,kind,hash,content);
  };
  const provider={providerName:'Ollama',model:'qwen3.5:9b',async translate(_ctx,batch){return new Map(batch.map(c=>[c.id,'Saved']));}};
  const result=await service.translatePlugin('demo',provider);
  assert.equal(result.translatedFiles,0);
  assert.equal(result.errors.length,1);
  assert.match(result.errors[0].error,/snapshot disk full/);
  assert.equal(await fs.readFile(targetFile,'utf8'),original);
});

test('final run-log flush failure is fail-open and only records logger.lastError',async()=>{
  const logger=new TranslationRunLogger({baseDir:path.join(os.tmpdir(),'uopt-v018-log')});
  logger.runDir='/synthetic/run';
  logger.writeRun=async()=>{throw new Error('final log disk full');};
  await assert.doesNotReject(()=>logger.finish('success',{translatedFiles:1}));
  assert.match(logger.lastError,/final log disk full/);
});
