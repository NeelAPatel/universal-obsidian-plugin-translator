'use strict';
const { buildTranslationPrompt, TRANSLATION_SCHEMA } = require('./prompts');

function extractOpenAIText(json) {
  if (json && typeof json.output_text === 'string') return json.output_text;
  const pieces = [];
  for (const item of (json && Array.isArray(json.output) ? json.output : [])) {
    for (const part of (item && Array.isArray(item.content) ? item.content : [])) {
      if (part && part.type === 'output_text' && typeof part.text === 'string') pieces.push(part.text);
    }
  }
  return pieces.join('');
}

function extractOllamaText(json) {
  if (json && json.message && typeof json.message.content === 'string') return json.message.content;
  if (json && typeof json.response === 'string') return json.response;
  return '';
}

function normalizeTranslationResult(payload, candidates) {
  const allowed = new Set(candidates.map(c => c.id));
  const map = new Map();
  const rows = payload && Array.isArray(payload.translations) ? payload.translations : [];
  for (const row of rows) {
    if (!row || !allowed.has(row.id) || row.translate !== true) continue;
    const value = typeof row.translation === 'string' ? row.translation.trimEnd() : '';
    if (value) map.set(row.id, value);
  }
  return map;
}

function parseJsonText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Translation provider returned an empty response');
  try { return JSON.parse(trimmed); }
  catch (_) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Translation provider did not return valid JSON');
    return JSON.parse(match[0]);
  }
}

class OpenAIProvider {
  constructor({ apiKey, model, request }) {
    this.apiKey = apiKey;
    this.providerName = 'OpenAI';
    this.model = model || 'gpt-5-mini';
    this.request = request;
  }
  async testConnection() {
    if (!this.apiKey) throw new Error('OpenAI API key is empty');
    const res = await this.request({
      url:'https://api.openai.com/v1/responses', method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${this.apiKey}`},
      body: JSON.stringify({ model:this.model, input:'Reply with exactly OK.', max_output_tokens:16, store:false })
    });
    const text = extractOpenAIText(res.json || {});
    if (!text) throw new Error('OpenAI connection succeeded but returned no text');
    return text.trim();
  }
  async translate(pluginContext, candidates) {
    const prompt = buildTranslationPrompt(pluginContext, candidates);
    const res = await this.request({
      url:'https://api.openai.com/v1/responses', method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${this.apiKey}`},
      body: JSON.stringify({
        model:this.model,
        store:false,
        input:[
          {role:'system',content:[{type:'input_text',text:prompt.system}]},
          {role:'user',content:[{type:'input_text',text:prompt.user}]}
        ],
        text:{format:{type:'json_schema',name:'uopt_translation',strict:true,schema:TRANSLATION_SCHEMA}}
      })
    });
    const payload = parseJsonText(extractOpenAIText(res.json || {}));
    return normalizeTranslationResult(payload, candidates);
  }
}

class OllamaProvider {
  constructor({ baseUrl, model, request }) {
    this.baseUrl = String(baseUrl || 'http://localhost:11434').replace(/\/$/, '');
    this.providerName = 'Ollama';
    this.model = model || 'qwen3:8b';
    this.request = request;
  }
  async testConnection() {
    const res = await this.request({
      url:`${this.baseUrl}/api/chat`, method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:this.model,messages:[{role:'user',content:'Reply with exactly OK.'}],stream:false,think:false,keep_alive:0})
    });
    const text = extractOllamaText(res.json || {});
    if (!text) throw new Error('Ollama connection succeeded but returned no text');
    return text.trim();
  }
  async translate(pluginContext, candidates) {
    const prompt = buildTranslationPrompt(pluginContext, candidates);
    const res = await this.request({
      url:`${this.baseUrl}/api/chat`, method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:this.model,
        messages:[{role:'system',content:prompt.system},{role:'user',content:prompt.user}],
        stream:false,
        think:false,
        format:TRANSLATION_SCHEMA
      })
    });
    const payload = parseJsonText(extractOllamaText(res.json || {}));
    return normalizeTranslationResult(payload, candidates);
  }
}

module.exports = { OpenAIProvider, OllamaProvider, extractOpenAIText, extractOllamaText, normalizeTranslationResult, parseJsonText };
