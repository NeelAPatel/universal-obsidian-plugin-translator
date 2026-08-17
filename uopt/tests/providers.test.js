const test = require('node:test');
const assert = require('node:assert/strict');
const { extractOpenAIText, extractOllamaText, normalizeTranslationResult } = require('../src/lib/providers');

test('extracts text from OpenAI Responses API output array', () => {
  const json = { output:[{type:'message',content:[{type:'output_text',text:'{"translations":[]}'}]}] };
  assert.equal(extractOpenAIText(json), '{"translations":[]}');
});

test('extracts Ollama chat message content', () => {
  assert.equal(extractOllamaText({message:{content:'{"translations":[]}'}}), '{"translations":[]}');
});

test('normalizes only known translated candidate ids', () => {
  const candidates = [{id:'c0'},{id:'c1'}];
  const result = normalizeTranslationResult({translations:[
    {id:'c0',translate:true,translation:'Save'},
    {id:'c1',translate:false,translation:''},
    {id:'evil',translate:true,translation:'x'}
  ]}, candidates);
  assert.deepEqual([...result.entries()], [['c0','Save']]);
});

test('Ollama line protocol keeps valid rows when one row is malformed and supports skip decisions', () => {
  const { parseOllamaLineProtocol } = require('../src/lib/providers');
  const candidates = [
    {id:'c0',text:'通用'},
    {id:'c1',text:'内部状态'},
    {id:'c2',text:'保存成功'}
  ];
  const parsed = parseOllamaLineProtocol([
    '```text',
    'c0\tGeneral',
    'this row is malformed',
    'c1\t__SKIP__',
    'c2\tSaved successfully',
    '```'
  ].join('\n'), candidates);
  assert.deepEqual([...parsed.translations.entries()], [['c0','General'],['c2','Saved successfully']]);
  assert.deepEqual([...parsed.skippedIds], ['c1']);
  assert.deepEqual([...parsed.unresolvedIds], []);
  assert.equal(parsed.invalidLines.length,1);
});

test('Ollama line protocol decodes escaped tabs, newlines, carriage returns, and backslashes', () => {
  const { parseOllamaLineProtocol } = require('../src/lib/providers');
  const candidates = [{id:'c0',text:'内容'}];
  const parsed = parseOllamaLineProtocol('c0\tLine 1\\nLine 2\\tTabbed\\rReturn\\\\Path', candidates);
  assert.equal(parsed.translations.get('c0'), 'Line 1\nLine 2\tTabbed\rReturn\\Path');
});

test('Ollama retries only unresolved candidates and keeps valid translations from the first response', async () => {
  const { OllamaProvider } = require('../src/lib/providers');
  const calls = [];
  const responses = [
    {message:{content:'c0\tGeneral\nc1 malformed\nc2\tSaved successfully'}},
    {message:{content:'c1\t__SKIP__'}}
  ];
  const provider = new OllamaProvider({
    baseUrl:'http://localhost:11434', model:'qwen3.5:9b', maxProtocolAttempts:3,
    request: async req => {
      calls.push(JSON.parse(req.body));
      return {json:responses.shift()};
    }
  });
  const candidates = [
    {id:'c0',text:'通用',kind:'js-string',context:'label: "通用"'},
    {id:'c1',text:'内部状态',kind:'js-string',context:'const machine = "内部状态"'},
    {id:'c2',text:'保存成功',kind:'js-string',context:'new Notice("保存成功")'}
  ];
  const result = await provider.translate({name:'Canvas Enhance'}, candidates);
  assert.deepEqual([...result.entries()], [['c0','General'],['c2','Saved successfully']]);
  assert.equal(calls.length,2);
  assert.equal(calls[0].format, undefined);
  assert.equal(calls[0].options.temperature,0);
  const retryPrompt = calls[1].messages.find(m=>m.role==='user').content;
  assert.match(retryPrompt,/"id":"c1"/);
  assert.doesNotMatch(retryPrompt,/"id":"c0"/);
  assert.doesNotMatch(retryPrompt,/"id":"c2"/);
});

test('Ollama terminal protocol failure exposes recovered translations instead of discarding them', async () => {
  const { OllamaProvider } = require('../src/lib/providers');
  let calls = 0;
  const provider = new OllamaProvider({
    baseUrl:'http://localhost:11434', model:'qwen3.5:9b', maxProtocolAttempts:2,
    request: async () => {
      calls++;
      return {json:{message:{content:calls === 1 ? 'c0\tGeneral\nc1 malformed' : 'still malformed'}}};
    }
  });
  const candidates = [
    {id:'c0',text:'通用',kind:'js-string',context:'label: "通用"'},
    {id:'c1',text:'保存',kind:'js-string',context:'new Notice("保存")'}
  ];
  await assert.rejects(
    () => provider.translate({name:'Canvas Enhance'}, candidates),
    error => {
      assert.match(error.message,/1 candidate\(s\) unresolved/i);
      assert.equal(error.uoptStage,'provider');
      assert.deepEqual([...error.uoptPartialTranslations.entries()], [['c0','General']]);
      assert.deepEqual(error.uoptUnresolvedIds,['c1']);
      return true;
    }
  );
});

test('Canvas Enhance regression: one malformed row out of 29 retries only that candidate', async () => {
  const { OllamaProvider } = require('../src/lib/providers');
  const candidates = Array.from({length:29},(_,i)=>({
    id:`c${i}`,
    text:i===17?'画布内搜索':`设置${i}`,
    kind:'js-string',
    semanticGroup:'src/settings.ts',
    context:`SETTINGS option ${i}`
  }));
  const first = candidates.map((c,i)=>i===17 ? `${c.id} malformed` : `${c.id}\tEnglish ${i}`).join('\n');
  const calls = [];
  const provider = new OllamaProvider({
    baseUrl:'http://localhost:11434', model:'qwen3.5:9b',
    request:async req => {
      const body=JSON.parse(req.body);
      calls.push(body);
      return {json:{message:{content:calls.length===1?first:'c17\tSearch canvas'}}};
    }
  });
  const result = await provider.translate({name:'Canvas Enhance'},candidates);
  assert.equal(result.size,29);
  assert.equal(result.get('c17'),'Search canvas');
  assert.equal(calls.length,2);
  const retryUser = calls[1].messages.find(m=>m.role==='user').content;
  assert.match(retryUser,/"id":"c17"/);
  assert.equal((retryUser.match(/"id":"c/g)||[]).length,1);
});

test('Ollama prompt describes escapes literally rather than inserting control characters', () => {
  const { buildOllamaTranslationPrompt } = require('../src/lib/prompts');
  const prompt = buildOllamaTranslationPrompt({},[{id:'c0',text:'保存',kind:'js-string',context:''}]);
  assert.match(prompt.system,/tab as \\t/);
  assert.match(prompt.system,/newline as \\n/);
  assert.match(prompt.system,/carriage return as \\r/);
});

test('OpenAI keeps JSON-schema Structured Outputs while Ollama uses the line protocol', async () => {
  const { OpenAIProvider } = require('../src/lib/providers');
  let requestBody = null;
  const provider = new OpenAIProvider({
    apiKey:'sk-test', model:'gpt-5-mini',
    request:async req => {
      requestBody = JSON.parse(req.body);
      return {json:{output:[{content:[{type:'output_text',text:'{"translations":[{"id":"c0","translate":true,"translation":"Save"}]}'}]}]}};
    }
  });
  const result = await provider.translate({},[{id:'c0',text:'保存',kind:'js-string',context:'new Notice("保存")'}]);
  assert.equal(result.get('c0'),'Save');
  assert.equal(requestBody.text.format.type,'json_schema');
  assert.equal(requestBody.text.format.strict,true);
});
