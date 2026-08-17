'use strict';

function classifyFileState({ previous, currentHash, hasForeign }) {
  if (!previous) return hasForeign ? 'new-file' : 'no-translation';
  if (previous.translatedHash && currentHash === previous.translatedHash) return 'translated-current';
  if (previous.everTranslated && previous.approved) {
    if (!hasForeign && currentHash === previous.originalHash) return 'original-restored';
    return 'updated-approved';
  }
  if (!hasForeign) return 'no-translation';
  return 'known-untranslated';
}

function nextApproval(previous, state) {
  if (!previous) return false;
  if (state === 'no-translation') return !!previous.approved;
  return !!previous.approved;
}

module.exports = { classifyFileState, nextApproval };
