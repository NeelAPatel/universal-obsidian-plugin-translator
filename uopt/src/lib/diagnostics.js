'use strict';

const CONNECTION_CODES = new Set(['ECONNREFUSED','ECONNRESET','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT']);
const FILESYSTEM_CODES = new Set(['EACCES','EPERM','EROFS','ENOSPC','ENOENT','EBUSY','EMFILE','ENFILE']);

function messageOf(error) {
  return error && error.message ? String(error.message) : String(error || 'Unknown error');
}

function classifyFailure(error, context={}) {
  const message = messageOf(error);
  const lower = message.toLowerCase();
  const code = error && error.code ? String(error.code) : '';
  const stage = context.stage || error && error.uoptStage || '';

  if (stage === 'validation' || /validation failed/.test(lower)) {
    return {category:'Translation validation', stage:'Translation validation', message};
  }
  if (stage === 'file-changed' || /file changed during translation/.test(lower)) {
    return {category:'File changed', stage:'Pre-write safety check', message};
  }
  if (stage === 'filesystem' || FILESYSTEM_CODES.has(code)) {
    return {category:'Filesystem', stage:'Filesystem', message};
  }
  if (stage === 'provider' || context.provider) {
    if (/valid json|json parse|unexpected token.*json|structured response|schema|line protocol|candidate\(s\) unresolved|malformed.*response/.test(lower)) {
      return {category:'Provider format', stage:'Provider response parsing', message};
    }
    if (/empty response|returned no text|no text/.test(lower)) {
      return {category:'Provider response', stage:'Provider response', message};
    }
    if (CONNECTION_CODES.has(code) || /econnrefused|connection refused|network|fetch failed|timed? out|timeout|could not connect|failed to connect|dns|enotfound/.test(lower)) {
      return {category:'Provider connection', stage:'Provider request', message};
    }
    return {category:'Provider response', stage:'Provider request/response', message};
  }
  return {category:'Unknown', stage:'Unknown', message};
}

function createFailureDiagnostic(error, context={}) {
  const classified = classifyFailure(error, context);
  const batch = context.batch || error && error.uoptBatch || {};
  return {
    category:classified.category,
    stage:classified.stage,
    message:classified.message,
    pluginId:context.pluginId || null,
    file:context.file || null,
    provider:context.provider || null,
    model:context.model || null,
    batch:context.batch && typeof context.batch === 'number' ? context.batch : batch.batch || null,
    totalBatches:context.totalBatches || batch.totalBatches || null,
    candidateCount:context.candidateCount || batch.candidateCount || null,
    timestamp:context.timestamp || new Date().toISOString()
  };
}

module.exports = { classifyFailure, createFailureDiagnostic };
