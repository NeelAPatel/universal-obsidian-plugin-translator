'use strict';

function escapeJsLike(text, quote) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(new RegExp(quote === '`' ? '`' : quote, 'g'), `\\${quote}`)
    .replace(quote === '`' ? /\$\{/g : /(?!)/g, quote === '`' ? '\\${' : '');
}

function encodeTranslation(candidate, translation) {
  if (candidate.kind === 'json-string') return JSON.stringify(String(translation)).slice(1, -1);
  if (candidate.kind === 'js-string' || candidate.kind === 'css-string' || candidate.kind === 'html-attribute') {
    return escapeJsLike(translation, candidate.quote || '"');
  }
  return String(translation);
}

function applyTranslations(source, candidates, translations) {
  const patches = [];
  for (const c of candidates) {
    if (!translations.has(c.id)) continue;
    if (c.protected) continue;
    patches.push({ start:c.start, end:c.end, value:encodeTranslation(c, translations.get(c.id)) });
  }
  patches.sort((a,b)=>a.start-b.start);
  for (let i=1;i<patches.length;i++) {
    if (patches[i].start < patches[i-1].end) throw new Error('Translation patch ranges overlap');
  }
  let out = source;
  for (let i=patches.length-1;i>=0;i--) {
    const p = patches[i];
    out = out.slice(0,p.start) + p.value + out.slice(p.end);
  }
  return out;
}

module.exports = { applyTranslations, encodeTranslation };
