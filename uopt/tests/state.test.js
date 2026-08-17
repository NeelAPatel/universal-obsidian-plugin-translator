const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFileState, nextApproval } = require('../src/lib/state');

test('new file is blocked by default', () => {
  const state = classifyFileState({ previous: undefined, currentHash: 'a', hasForeign: true });
  assert.equal(state, 'new-file');
  assert.equal(nextApproval(undefined, state), false);
});

test('unchanged translated file is current', () => {
  const previous = { translatedHash: 't', originalHash: 'o', approved: true, everTranslated: true };
  assert.equal(classifyFileState({ previous, currentHash: 't', hasForeign: false }), 'translated-current');
  assert.equal(nextApproval(previous, 'translated-current'), true);
});

test('updated previously translated file remains eligible', () => {
  const previous = { translatedHash: 't', originalHash: 'o', approved: true, everTranslated: true };
  assert.equal(classifyFileState({ previous, currentHash: 'new-upstream', hasForeign: true }), 'updated-approved');
  assert.equal(nextApproval(previous, 'updated-approved'), true);
});

test('English-only new file needs no translation and remains unapproved', () => {
  const state = classifyFileState({ previous: undefined, currentHash: 'x', hasForeign: false });
  assert.equal(state, 'no-translation');
  assert.equal(nextApproval(undefined, state), false);
});
