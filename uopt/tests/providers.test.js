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
