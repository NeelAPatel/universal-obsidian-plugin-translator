'use strict';
const { applyTranslations } = require('./patcher');

function candidateCost(c) {
  return String(c.text || '').length + String(c.context || '').length + 80;
}

function batchCandidates(candidates, maxChars = 14000) {
  const batches = [];
  let batch = [];
  let cost = 0;
  for (const candidate of candidates) {
    const next = candidateCost(candidate);
    if (batch.length && cost + next > maxChars) {
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

async function translateSource({ source, candidates, pluginContext, provider, maxBatchChars = 14000, onBatch, seedTranslations = new Map() }) {
  const translations = new Map(seedTranslations);
  const eligible = candidates.filter(c => !c.protected && !translations.has(c.id));
  const batches = batchCandidates(eligible, maxBatchChars);
  for (let i = 0; i < batches.length; i++) {
    if (onBatch) await onBatch(i + 1, batches.length, batches[i]);
    let result;
    try {
      result = await provider.translate(pluginContext, batches[i]);
    } catch (error) {
      if (error && typeof error === 'object') {
        error.uoptStage = error.uoptStage || 'provider';
        error.uoptBatch = { batch:i + 1, totalBatches:batches.length, candidateCount:batches[i].length };
      }
      throw error;
    }
    for (const [id, value] of result.entries()) translations.set(id, value);
  }
  return {
    content: applyTranslations(source, candidates, translations),
    translatedCount: translations.size,
    translations
  };
}

module.exports = { batchCandidates, translateSource };
