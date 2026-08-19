'use strict';

const OLLAMA_BATCH_CHAR_BUDGET = 24000;
const OLLAMA_BATCH_MAX_CANDIDATES = 48;
const OLLAMA_KEEP_ALIVE = '15m';

function clip(text, maxChars) {
  const value = String(text || '');
  if (value.length <= maxChars) return value;
  return maxChars <= 1 ? value.slice(0,maxChars) : value.slice(0, maxChars - 1) + '…';
}

function compactOllamaPluginContext(pluginContext={}, maxContextChars=2200) {
  const out = {};
  for (const key of ['name','id','version','repository','description']) {
    if (pluginContext[key] != null && pluginContext[key] !== '') out[key] = pluginContext[key];
  }
  const contextText = pluginContext.contextText || pluginContext.summary || '';
  if (contextText) out.contextText = clip(contextText, maxContextChars);
  if (Array.isArray(pluginContext.languages)) out.languages = pluginContext.languages.slice(0,8);
  return out;
}

function isSimpleUiCandidate(candidate={}) {
  const text = String(candidate.text || '').trim();
  if (!text || text.length > 4) return false;
  if (/\s/.test(text) && text.length > 3) return false;
  if (/[\n\r{}<>:$]/.test(text)) return false;
  return true;
}

function compactOllamaCandidate(candidate={}) {
  const simple = isSimpleUiCandidate(candidate);
  const contextLimit = simple ? 220 : 700;
  return {
    id:candidate.protocolId || candidate.id,
    text:candidate.text,
    kind:candidate.kind,
    sourceSection:candidate.semanticGroup || null,
    context:clip(candidate.context, contextLimit),
    priorTranslation:candidate.priorTranslation || null,
    protected:!!candidate.protected
  };
}

function aggregateOllamaTelemetry(samples=[]) {
  const sum = key => samples.reduce((total,sample)=>total + Number(sample && sample[key] || 0),0);
  return {
    attempts:samples.length,
    totalDurationNs:sum('total_duration'),
    loadDurationNs:sum('load_duration'),
    promptEvalCount:sum('prompt_eval_count'),
    promptEvalDurationNs:sum('prompt_eval_duration'),
    evalCount:sum('eval_count'),
    evalDurationNs:sum('eval_duration')
  };
}

module.exports = {
  OLLAMA_BATCH_CHAR_BUDGET,
  OLLAMA_BATCH_MAX_CANDIDATES,
  OLLAMA_KEEP_ALIVE,
  compactOllamaPluginContext,
  compactOllamaCandidate,
  aggregateOllamaTelemetry,
  isSimpleUiCandidate
};
