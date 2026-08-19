const test = require('node:test');
const assert = require('node:assert/strict');
const { batchCandidates, translateSource } = require('../src/lib/translator');
const { OllamaProvider } = require('../src/lib/providers');
const { buildOllamaTranslationPrompt } = require('../src/lib/prompts');
const {
  OLLAMA_BATCH_CHAR_BUDGET,
  OLLAMA_KEEP_ALIVE,
  compactOllamaPluginContext,
  compactOllamaCandidate,
  aggregateOllamaTelemetry
} = require('../src/lib/ollama-speed');

test('Ollama speed policy uses a larger local batch budget and keeps the model warm', () => {
  assert.equal(OLLAMA_BATCH_CHAR_BUDGET, 42000);
  assert.equal(OLLAMA_KEEP_ALIVE, '15m');
});

test('compact Ollama plugin context keeps identity but clips bulky docs', () => {
  const input = {name:'Canvas Enhance', id:'canvas-enhance', version:'1.0.0', repository:'x/y', contextText:'A'.repeat(10000)};
  const out = compactOllamaPluginContext(input, 2200);
  assert.equal(out.name,'Canvas Enhance');
  assert.equal(out.id,'canvas-enhance');
  assert.ok(out.contextText.length <= 2200);
});

test('simple short UI candidates carry less repeated context than ambiguous candidates', () => {
  const simple = compactOllamaCandidate({id:'c0',text:'保存',kind:'js-string',context:'x'.repeat(1000),semanticGroup:'src/settings.ts'});
  const rich = compactOllamaCandidate({id:'c1',text:'文件卡片分屏打开',kind:'js-string',context:'x'.repeat(1000),semanticGroup:'src/settings.ts'});
  assert.ok(simple.context.length < rich.context.length);
  assert.ok(simple.context.length <= 220);
  assert.ok(rich.context.length <= 700);
});

test('Ollama telemetry aggregation sums provider timing counters across retries', () => {
  const result = aggregateOllamaTelemetry([
    {total_duration:10,load_duration:2,prompt_eval_count:100,prompt_eval_duration:3,eval_count:20,eval_duration:5},
    {total_duration:20,load_duration:0,prompt_eval_count:30,prompt_eval_duration:4,eval_count:10,eval_duration:8}
  ]);
  assert.deepEqual(result,{attempts:2,totalDurationNs:30,loadDurationNs:2,promptEvalCount:130,promptEvalDurationNs:7,evalCount:30,evalDurationNs:13});
});

test('Ollama test connection explicitly checks server and keeps model warm', async () => {
  const calls=[];
  const provider=new OllamaProvider({baseUrl:'http://localhost:11434',model:'qwen3.5:9b',request:async req=>{
    calls.push(req);
    if(req.method==='GET') return {json:{models:[{name:'qwen3.5:9b'}]}};
    return {json:{message:{content:'OK'}}};
  }});
  assert.equal(await provider.testConnection(),'OK');
  assert.equal(calls[0].url,'http://localhost:11434/api/tags');
  const body=JSON.parse(calls[1].body);
  assert.equal(body.keep_alive,'15m');
  assert.deepEqual(provider.lastConnectionCheck,{serverReachable:true,modelResponded:true,model:'qwen3.5:9b',baseUrl:'http://localhost:11434'});
});

test('Ollama translation keeps model warm and exposes timing telemetry', async () => {
  const calls=[];
  const provider=new OllamaProvider({baseUrl:'http://localhost:11434',model:'qwen3.5:9b',request:async req=>{
    calls.push(JSON.parse(req.body));
    return {json:{message:{content:'c0\tSave'},total_duration:100,load_duration:5,prompt_eval_count:40,prompt_eval_duration:20,eval_count:7,eval_duration:70}};
  }});
  const result=await provider.translate({name:'Test'},[{id:'c0',text:'保存',kind:'js-string',context:'x'.repeat(500)}]);
  assert.equal(result.get('c0'),'Save');
  assert.equal(calls[0].keep_alive,'15m');
  assert.equal(provider.recommendedBatchChars,42000);
  assert.equal(provider.lastTelemetry.promptEvalCount,40);
  assert.equal(provider.lastTelemetry.evalCount,7);
});

test('Ollama prompt compacts bulky plugin and candidate context', () => {
  const prompt=buildOllamaTranslationPrompt({name:'Canvas Enhance',contextText:'P'.repeat(10000)},[
    {id:'c0',text:'保存',kind:'js-string',context:'C'.repeat(1000)},
    {id:'c1',text:'文件卡片分屏打开',kind:'js-string',context:'D'.repeat(1000)}
  ]);
  const payload=JSON.parse(prompt.user);
  assert.ok(payload.plugin.contextText.length <= 2200);
  assert.ok(payload.candidates[0].context.length <= 220);
  assert.ok(payload.candidates[1].context.length <= 700);
});

test('provider recommended batch budget reduces local model call count', async()=>{
  const source=Array.from({length:90},(_,i)=>`new Notice("设置${i}");`).join('\n');
  const candidates=Array.from({length:90},(_,i)=>{
    const text=`设置${i}`; const start=source.indexOf(`"${text}"`)+1;
    return {id:`c${i}`,text,start,end:start+text.length,kind:'js-string',quote:'"',context:'x'.repeat(220),protected:false};
  });
  const baseline=batchCandidates(candidates,14000,source).length;
  let calls=0;
  const provider={recommendedBatchChars:42000,lastTelemetry:null,async translate(_ctx,batch){calls++;return new Map(batch.map(c=>[c.id,`E${c.id}`]));}};
  await translateSource({source,candidates,pluginContext:{},provider,maxBatchChars:14000});
  assert.ok(calls < baseline);
});

test('batch completion receives provider telemetry for progress reporting', async()=>{
  const source='new Notice("保存");';
  const candidates=[{id:'c0',text:'保存',start:12,end:14,kind:'js-string',quote:'"',context:'x',protected:false}];
  const seen=[];
  const provider={recommendedBatchChars:42000,lastTelemetry:null,async translate(){this.lastTelemetry={totalDurationNs:100,evalCount:5};return new Map([['c0','Save']]);}};
  await translateSource({source,candidates,pluginContext:{},provider,onBatchComplete:async(...args)=>seen.push(args)});
  assert.equal(seen.length,1);
  assert.equal(seen[0][3].evalCount,5);
});
