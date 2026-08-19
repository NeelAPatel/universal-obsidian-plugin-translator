'use strict';
const { buildTranslationPrompt, buildOllamaTranslationPrompt, TRANSLATION_SCHEMA } = require('./prompts');
const { OLLAMA_BATCH_CHAR_BUDGET, OLLAMA_KEEP_ALIVE, aggregateOllamaTelemetry } = require('./ollama-speed');

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

function decodeLineValue(value) {
  const input = String(value || '');
  let out = '';
  for (let i = 0; i < input.length; i++) {
    if (input[i] !== '\\' || i + 1 >= input.length) {
      out += input[i];
      continue;
    }
    const next = input[++i];
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else if (next === '\\') out += '\\';
    else out += `\\${next}`;
  }
  return out;
}

function parseOllamaLineProtocol(text, candidates) {
  const allowed = new Set(candidates.map(c => c.id));
  const translations = new Map();
  const skippedIds = new Set();
  const decidedIds = new Set();
  const invalidLines = [];
  const raw = String(text || '').trim();
  if (!raw) {
    return {translations, skippedIds, decidedIds, unresolvedIds:new Set(allowed), invalidLines:['<empty response>']};
  }

  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const original = lines[index];
    const line = original.trimEnd();
    const trimmed = line.trim();
    if (!trimmed || /^```(?:text|txt)?\s*$/i.test(trimmed) || trimmed === '```') continue;

    const tab = line.indexOf('\t');
    if (tab <= 0) {
      invalidLines.push(original);
      continue;
    }
    const id = line.slice(0, tab).trim();
    const encoded = line.slice(tab + 1);
    if (!allowed.has(id) || decidedIds.has(id)) {
      invalidLines.push(original);
      continue;
    }
    const value = decodeLineValue(encoded).trimEnd();
    if (!value) {
      invalidLines.push(original);
      continue;
    }
    if (/^__(?:SKIP)__$/i.test(value) || /^SKIP$/i.test(value)) {
      skippedIds.add(id);
      decidedIds.add(id);
      continue;
    }
    translations.set(id, value);
    decidedIds.add(id);
  }

  const unresolvedIds = new Set([...allowed].filter(id => !decidedIds.has(id)));
  return {translations, skippedIds, decidedIds, unresolvedIds, invalidLines};
}

class OpenAIProvider {
  constructor({ apiKey, model, request }) {
    this.apiKey = apiKey;
    this.providerName = 'OpenAI';
    this.model = model || 'gpt-5-mini';
    this.request = request;
    this.recommendedBatchChars = 14000;
    this.lastTelemetry = null;
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
  constructor({ baseUrl, model, request, maxProtocolAttempts, keepAlive }) {
    this.baseUrl = String(baseUrl || 'http://localhost:11434').replace(/\/$/, '');
    this.providerName = 'Ollama';
    this.model = model || 'qwen3:8b';
    this.request = request;
    this.maxProtocolAttempts = Math.max(1, Number(maxProtocolAttempts) || 3);
    this.keepAlive = keepAlive || OLLAMA_KEEP_ALIVE;
    this.recommendedBatchChars = OLLAMA_BATCH_CHAR_BUDGET;
    this.lastTelemetry = null;
    this.lastConnectionCheck = null;
  }
  async testConnection() {
    try {
      await this.request({url:`${this.baseUrl}/api/tags`,method:'GET'});
    } catch (error) {
      const wrapped = new Error(`Ollama server is not reachable at ${this.baseUrl}: ${error && error.message ? error.message : error}`);
      wrapped.code = error && error.code;
      throw wrapped;
    }
    let res;
    try {
      res = await this.request({
        url:`${this.baseUrl}/api/chat`, method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:this.model,messages:[{role:'user',content:'Reply with exactly OK.'}],stream:false,think:false,keep_alive:this.keepAlive,options:{temperature:0}})
      });
    } catch (error) {
      const wrapped = new Error(`Ollama server is reachable, but model ${this.model} could not respond: ${error && error.message ? error.message : error}`);
      wrapped.code = error && error.code;
      throw wrapped;
    }
    const text = extractOllamaText(res.json || {});
    if (!text) throw new Error(`Ollama server is reachable, but model ${this.model} returned no text`);
    this.lastConnectionCheck = {serverReachable:true,modelResponded:true,model:this.model,baseUrl:this.baseUrl};
    return text.trim();
  }
  async translate(pluginContext, candidates) {
    const translations = new Map();
    const decidedIds = new Set();
    const candidateById = new Map(candidates.map(c => [c.id, c]));
    let pending = [...candidates];
    let lastInvalidLines = [];
    const telemetrySamples = [];

    for (let attempt = 1; attempt <= this.maxProtocolAttempts && pending.length; attempt++) {
      const prompt = buildOllamaTranslationPrompt(pluginContext, pending, {retry:attempt > 1});
      let res;
      try {
        res = await this.request({
          url:`${this.baseUrl}/api/chat`, method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            model:this.model,
            messages:[{role:'system',content:prompt.system},{role:'user',content:prompt.user}],
            stream:false,
            think:false,
            keep_alive:this.keepAlive,
            options:{temperature:0}
          })
        });
      } catch (error) {
        this.lastTelemetry = aggregateOllamaTelemetry(telemetrySamples);
        if (error && typeof error === 'object') {
          error.uoptStage = error.uoptStage || 'provider';
          error.uoptPartialTranslations = new Map(translations);
          error.uoptUnresolvedIds = pending.map(c => c.id);
          error.uoptTelemetry = this.lastTelemetry;
        }
        throw error;
      }

      if (res && res.json) telemetrySamples.push(res.json);
      const parsed = parseOllamaLineProtocol(extractOllamaText(res.json || {}), pending);
      lastInvalidLines = parsed.invalidLines;
      for (const [id, value] of parsed.translations.entries()) translations.set(id, value);
      for (const id of parsed.decidedIds) decidedIds.add(id);
      pending = candidates.filter(c => !decidedIds.has(c.id));
    }

    this.lastTelemetry = aggregateOllamaTelemetry(telemetrySamples);
    if (pending.length) {
      const recovered = translations.size;
      const error = new Error(`Ollama line protocol left ${pending.length} candidate(s) unresolved after ${this.maxProtocolAttempts} attempt(s); recovered ${recovered} translation(s)`);
      error.uoptStage = 'provider';
      error.uoptPartialTranslations = new Map(translations);
      error.uoptUnresolvedIds = pending.map(c => c.id);
      error.uoptInvalidLines = lastInvalidLines.slice(0,10);
      error.uoptTelemetry = this.lastTelemetry;
      throw error;
    }

    return new Map([...translations.entries()].filter(([id]) => candidateById.has(id)));
  }
}

module.exports = {
  OpenAIProvider, OllamaProvider, extractOpenAIText, extractOllamaText,
  normalizeTranslationResult, parseJsonText, parseOllamaLineProtocol, decodeLineValue
};
