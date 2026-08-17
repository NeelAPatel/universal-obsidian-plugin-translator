'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFailure, createFailureDiagnostic } = require('../src/lib/diagnostics');

function err(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

test('classifies provider format, response, connection, validation, file-change, filesystem, and unknown failures', () => {
  assert.equal(classifyFailure(err('Translation provider did not return valid JSON'), {stage:'provider'}).category, 'Provider format');
  assert.equal(classifyFailure(err('Ollama line protocol left 1 candidate(s) unresolved after 3 attempts'), {stage:'provider'}).category, 'Provider format');
  assert.equal(classifyFailure(err('Translation provider returned an empty response'), {stage:'provider'}).category, 'Provider response');
  assert.equal(classifyFailure(err('connect ECONNREFUSED 127.0.0.1:11434','ECONNREFUSED'), {stage:'provider'}).category, 'Provider connection');
  assert.equal(classifyFailure(err('Validation failed for main.js: Unexpected token'), {stage:'validation'}).category, 'Translation validation');
  assert.equal(classifyFailure(err('File changed during translation: main.js'), {stage:'file-changed'}).category, 'File changed');
  assert.equal(classifyFailure(err('EACCES: permission denied','EACCES'), {stage:'filesystem'}).category, 'Filesystem');
  assert.equal(classifyFailure(err('mystery'), {}).category, 'Unknown');
});

test('creates a serializable diagnostic with provider and batch metadata', () => {
  const diagnostic = createFailureDiagnostic(err('Translation provider did not return valid JSON'), {
    stage:'provider', pluginId:'demo', file:'main.js', provider:'Ollama', model:'qwen3.5:9b', batch:2, totalBatches:13, candidateCount:31,
    timestamp:'2026-08-16T23:00:00.000Z'
  });
  assert.deepEqual(diagnostic, {
    category:'Provider format', stage:'Provider response parsing', message:'Translation provider did not return valid JSON',
    pluginId:'demo', file:'main.js', provider:'Ollama', model:'qwen3.5:9b', batch:2, totalBatches:13, candidateCount:31,
    timestamp:'2026-08-16T23:00:00.000Z'
  });
  assert.doesNotThrow(() => JSON.stringify(diagnostic));
});
