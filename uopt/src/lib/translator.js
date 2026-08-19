'use strict';
const { applyTranslations } = require('./patcher');

function candidateCost(c) {
  return String(c.text || '').length + String(c.context || '').length + 80;
}

function sourceModuleMarkers(source) {
  const markers = [];
  const re = /^\s*\/\/\s+((?:[^\n]*\/)?src\/[^\n]+?\.(?:ts|tsx|js|jsx|mjs|cjs))\s*$/gm;
  let match;
  while ((match = re.exec(String(source || '')))) {
    markers.push({start:match.index,label:match[1].trim()});
  }
  return markers;
}

function annotateSemanticGroups(candidates, source='') {
  const markers = sourceModuleMarkers(source);
  if (!markers.length) return candidates.map(c => ({...c, semanticGroup:c.semanticGroup || null}));
  let markerIndex = 0;
  let current = null;
  return candidates.map(candidate => {
    while (markerIndex < markers.length && markers[markerIndex].start <= candidate.start) {
      current = markers[markerIndex].label;
      markerIndex++;
    }
    return {...candidate, semanticGroup:candidate.semanticGroup || current || 'source'};
  });
}

function splitBudget(items, maxChars, maxItems = Infinity) {
  const batches = [];
  let batch = [];
  let cost = 0;
  const itemLimit = Number.isFinite(Number(maxItems)) && Number(maxItems) > 0 ? Math.floor(Number(maxItems)) : Infinity;
  for (const candidate of items) {
    const next = candidateCost(candidate);
    if (batch.length && (cost + next > maxChars || batch.length >= itemLimit)) {
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

function batchCandidates(candidates, maxChars = 14000, source = '', maxItems = Infinity) {
  const annotated = annotateSemanticGroups(candidates, source);
  if (!annotated.length) return [];
  if (!sourceModuleMarkers(source).length) return splitBudget(annotated, maxChars, maxItems);

  const groups = [];
  let group = [];
  let groupKey = annotated[0].semanticGroup;
  for (const candidate of annotated) {
    if (group.length && candidate.semanticGroup !== groupKey) {
      groups.push(group);
      group = [];
      groupKey = candidate.semanticGroup;
    }
    group.push(candidate);
  }
  if (group.length) groups.push(group);

  const baselineBatches = splitBudget(annotated, maxChars, maxItems);
  const batches = [];
  let packed = [];
  let packedCost = 0;
  const flushPacked = () => {
    if (packed.length) batches.push(packed);
    packed = [];
    packedCost = 0;
  };

  for (const semanticGroup of groups) {
    const groupCost = semanticGroup.reduce((sum,candidate)=>sum + candidateCost(candidate),0);
    if (groupCost > maxChars || semanticGroup.length > maxItems) {
      flushPacked();
      batches.push(...splitBudget(semanticGroup, maxChars, maxItems));
      continue;
    }
    if (packed.length && (packedCost + groupCost > maxChars || packed.length + semanticGroup.length > maxItems)) flushPacked();
    packed.push(...semanticGroup);
    packedCost += groupCost;
  }
  flushPacked();
  return batches.length <= baselineBatches.length ? batches : baselineBatches;
}

async function translateSource({ source, candidates, pluginContext, provider, filePath = null, maxBatchChars = null, maxBatchCandidates = null, onBatch, onBatchComplete, onAttempt, seedTranslations = new Map() }) {
  const translations = new Map(seedTranslations);
  const eligible = candidates.filter(c => !c.protected && !translations.has(c.id));
  const configuredBudget = Math.max(0, Number(maxBatchChars) || 0);
  const providerBudget = Math.max(0, Number(provider && provider.recommendedBatchChars) || 0);
  const configuredCandidateLimit = Math.max(0, Number(maxBatchCandidates) || 0);
  const providerCandidateLimit = Math.max(0, Number(provider && provider.recommendedBatchCandidates) || 0);
  const effectiveBatchChars = providerBudget
    ? (configuredBudget ? Math.min(configuredBudget, providerBudget) : providerBudget)
    : (configuredBudget || 14000);
  const effectiveBatchCandidates = configuredCandidateLimit && providerCandidateLimit
    ? Math.min(configuredCandidateLimit,providerCandidateLimit)
    : configuredCandidateLimit || providerCandidateLimit || Infinity;
  const batches = batchCandidates(eligible, effectiveBatchChars, source, effectiveBatchCandidates);
  for (let i = 0; i < batches.length; i++) {
    if (onBatch) await onBatch(i + 1, batches.length, batches[i]);
    let result;
    try {
      result = await provider.translate(pluginContext, batches[i], {
        file:filePath || 'unknown',
        batch:i + 1,
        totalBatches:batches.length,
        onAttempt: onAttempt ? info => onAttempt({...info,batch:i + 1,totalBatches:batches.length,file:filePath || info.file || 'unknown'}) : null
      });
    } catch (error) {
      if (error && typeof error === 'object') {
        if (error.uoptPartialTranslations instanceof Map) {
          for (const [id, value] of error.uoptPartialTranslations.entries()) translations.set(id, value);
        }
        error.uoptPartialTranslations = new Map(translations);
        error.uoptStage = error.uoptStage || 'provider';
        error.uoptBatch = { batch:i + 1, totalBatches:batches.length, candidateCount:batches[i].length };
      }
      throw error;
    }
    for (const [id, value] of result.entries()) translations.set(id, value);
    if (onBatchComplete) await onBatchComplete(i + 1, batches.length, batches[i], provider && provider.lastTelemetry || null);
  }
  return {
    content: applyTranslations(source, candidates, translations),
    translatedCount: translations.size,
    translations
  };
}

module.exports = { batchCandidates, translateSource, sourceModuleMarkers, annotateSemanticGroups };
