'use strict';

const SCRIPT_PATTERNS = [
  ['Chinese', /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u],
  ['Japanese', /[\u3040-\u30FF\u31F0-\u31FF]/u],
  ['Korean', /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u],
  ['Cyrillic', /[\u0400-\u052F]/u],
  ['Arabic', /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u],
  ['Hebrew', /[\u0590-\u05FF]/u],
  ['Thai', /[\u0E00-\u0E7F]/u],
  ['Devanagari', /[\u0900-\u097F]/u]
];

const FOREIGN_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\u31F0-\u31FF\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF\u0400-\u052F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0590-\u05FF\u0E00-\u0E7F\u0900-\u097F]/u;

function hasForeignScript(text) {
  return FOREIGN_CHAR.test(text || '');
}

function detectLanguages(text) {
  const value = text || '';
  const result = [];
  for (const [name, re] of SCRIPT_PATTERNS) {
    if (re.test(value)) result.push(name);
  }
  return result;
}

function foreignRatio(text) {
  const chars = Array.from((text || '').replace(/\s/g, ''));
  if (!chars.length) return 0;
  let foreign = 0;
  for (const ch of chars) if (FOREIGN_CHAR.test(ch)) foreign++;
  return foreign / chars.length;
}

module.exports = { hasForeignScript, detectLanguages, foreignRatio };
