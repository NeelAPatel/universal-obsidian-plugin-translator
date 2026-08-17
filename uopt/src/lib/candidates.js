'use strict';

const path = require('node:path');
const { hasForeignScript } = require('./language');

const LANGUAGE_NAV_LABELS = /(?:english|简体中文|繁體中文|繁体中文|中文|日本語|한국어|русский|español|français|deutsch|português|italiano)/i;
const LOCALIZED_DOC_LINK = /(?:readme|docs?|guide|manual|help)[._/-]?(?:en|zh|ja|jp|ko|kr|ru|es|fr|de|pt|it)(?:[-_][a-z]{2,4})?\.(?:md|markdown|txt|html?)/i;

function isMarkdownLocalizationNavigationLine(line) {
  const value = String(line || '').trim();
  const links = [...value.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
  if (links.length >= 2) {
    const languageSignals = links.filter(match => LANGUAGE_NAV_LABELS.test(match[1]) || LOCALIZED_DOC_LINK.test(match[2])).length;
    const withoutLinks = value.replace(/\[[^\]]+\]\([^)]+\)/g, '').replace(/[|·•/\\–—,:;()\[\]\s-]/g, '');
    if (languageSignals >= 2 && withoutLinks.length === 0) return true;
  }
  const plainParts = value.split(/[|·•/\\–—,:;]/).map(part => part.trim()).filter(Boolean);
  return plainParts.length >= 2 && plainParts.every(part => LANGUAGE_NAV_LABELS.test(part.replace(/^#+\s*/, '')));
}

function contextAround(source, start, end, radius = 180) {
  return source.slice(Math.max(0, start - radius), Math.min(source.length, end + radius));
}

function decodeQuoted(raw, quote) {
  try {
    if (quote === '"') return JSON.parse(`"${raw}"`);
  } catch (_) {}
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(new RegExp(`\\\\${quote}`, 'g'), quote)
    .replace(/\\\\/g, '\\');
}

function extractJsStrings(source) {
  const out = [];
  let i = 0;
  let id = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i + 1 < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      const bodyStart = i + 1;
      let j = bodyStart;
      let escaped = false;
      let dynamicTemplate = false;
      while (j < source.length) {
        const c = source[j];
        if (escaped) {
          escaped = false;
          j++;
          continue;
        }
        if (c === '\\') {
          escaped = true;
          j++;
          continue;
        }
        if (quote === '`' && c === '$' && source[j + 1] === '{') {
          dynamicTemplate = true;
        }
        if (c === quote) break;
        j++;
      }
      if (j >= source.length) break;
      const raw = source.slice(bodyStart, j);
      const text = decodeQuoted(raw, quote);
      if (!dynamicTemplate && hasForeignScript(text)) {
        const before = source.slice(Math.max(0, i - 24), i);
        const after = source.slice(j + 1, Math.min(source.length, j + 25));
        const possibleRegex = /^\s*\/[gimsuyd]*/.test(after) && /\/\s*$/.test(before);
        out.push({
          id: `c${id++}`,
          start: bodyStart,
          end: j,
          text,
          raw,
          kind: 'js-string',
          quote,
          protected: possibleRegex,
          context: contextAround(source, i, j + 1)
        });
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

function extractJsonValues(source) {
  const out = [];
  let i = 0;
  let id = 0;
  while (i < source.length) {
    if (source[i] !== '"') { i++; continue; }
    const startQuote = i;
    let j = i + 1;
    let escaped = false;
    while (j < source.length) {
      const c = source[j];
      if (escaped) { escaped = false; j++; continue; }
      if (c === '\\') { escaped = true; j++; continue; }
      if (c === '"') break;
      j++;
    }
    if (j >= source.length) break;
    const raw = source.slice(i + 1, j);
    let k = j + 1;
    while (k < source.length && /\s/.test(source[k])) k++;
    const isKey = source[k] === ':';
    if (!isKey) {
      let text = raw;
      try { text = JSON.parse(`"${raw}"`); } catch (_) {}
      if (hasForeignScript(text)) {
        out.push({ id:`c${id++}`, start:i+1, end:j, text, raw, kind:'json-string', quote:'"', protected:false, context:contextAround(source,startQuote,j+1) });
      }
    }
    i = j + 1;
  }
  return out;
}

function extractCssContent(source) {
  const out = [];
  const re = /content\s*:\s*(["'])(.*?)\1/gims;
  let m;
  let id = 0;
  while ((m = re.exec(source))) {
    const quote = m[1];
    const raw = m[2];
    const text = decodeQuoted(raw, quote);
    if (!hasForeignScript(text)) continue;
    const whole = m[0];
    const bodyOffset = whole.indexOf(quote) + 1;
    const start = m.index + bodyOffset;
    const end = start + raw.length;
    out.push({ id:`c${id++}`, start, end, text, raw, kind:'css-string', quote, protected:false, context:contextAround(source,m.index,m.index+m[0].length) });
  }
  return out;
}

function extractMarkdownLines(source) {
  const out = [];
  let offset = 0;
  let inFence = false;
  let id = 0;
  const lines = source.split(/(?<=\n)/);
  for (const segment of lines) {
    const line = segment.endsWith('\n') ? segment.slice(0, -1) : segment;
    const trimmed = line.trimStart();
    if (/^```|^~~~/.test(trimmed)) {
      inFence = !inFence;
      offset += segment.length;
      continue;
    }
    if (!inFence && hasForeignScript(line) && !isMarkdownLocalizationNavigationLine(line)) {
      out.push({ id:`c${id++}`, start:offset, end:offset+line.length, text:line, raw:line, kind:'raw', quote:null, protected:false, context:line });
    }
    offset += segment.length;
  }
  return out;
}

function extractHtmlText(source) {
  const out = [];
  let id = 0;
  const textRe = />([^<]+)</g;
  let m;
  while ((m = textRe.exec(source))) {
    const text = m[1];
    if (!hasForeignScript(text)) continue;
    const start = m.index + 1;
    out.push({ id:`c${id++}`, start, end:start+text.length, text, raw:text, kind:'raw', quote:null, protected:false, context:contextAround(source,m.index,m.index+m[0].length) });
  }
  const attrRe = /\b(title|placeholder|aria-label)\s*=\s*(["'])(.*?)\2/gims;
  while ((m = attrRe.exec(source))) {
    const text = m[3];
    if (!hasForeignScript(text)) continue;
    const pos = m[0].lastIndexOf(text);
    const start = m.index + pos;
    out.push({ id:`c${id++}`, start, end:start+text.length, text, raw:text, kind:'html-attribute', quote:m[2], protected:false, context:contextAround(source,m.index,m.index+m[0].length) });
  }
  return out.sort((a,b)=>a.start-b.start).map((x,idx)=>({...x,id:`c${idx}`}));
}

function extractYamlLines(source) {
  return extractMarkdownLines(source);
}

function extractCandidates(filePath, source) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.js','.mjs','.cjs','.ts','.tsx','.jsx'].includes(ext)) return extractJsStrings(source);
  if (ext === '.json') return extractJsonValues(source);
  if (ext === '.css') return extractCssContent(source);
  if (['.md','.markdown','.txt'].includes(ext)) return extractMarkdownLines(source);
  if (['.html','.htm'].includes(ext)) return extractHtmlText(source);
  if (['.yaml','.yml'].includes(ext)) return extractYamlLines(source);
  return [];
}

module.exports = { extractCandidates, extractJsStrings, extractJsonValues, extractCssContent, extractMarkdownLines, extractHtmlText, isMarkdownLocalizationNavigationLine };
