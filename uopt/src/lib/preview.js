'use strict';

const path = require('node:path');

const JS_KEYWORDS = new Set([
  'as','async','await','break','case','catch','class','const','continue','debugger','default','delete','do','else','export',
  'extends','finally','for','from','function','get','if','import','in','instanceof','let','new','of','return','set','static',
  'super','switch','this','throw','try','typeof','var','void','while','with','yield'
]);
const JS_LITERALS = new Set(['true','false','null','undefined','NaN','Infinity']);

function isMarkdownPath(filePath) {
  return /\.(?:md|markdown)$/i.test(String(filePath || ''));
}

function previewLanguageForPath(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (['.js','.mjs','.cjs','.jsx','.ts','.tsx'].includes(ext)) return 'javascript';
  if (ext === '.json' || ext === '.json5') return 'json';
  if (ext === '.css' || ext === '.scss' || ext === '.less') return 'css';
  if (ext === '.html' || ext === '.htm' || ext === '.xml' || ext === '.svg') return 'html';
  if (ext === '.yaml' || ext === '.yml') return 'yaml';
  if (isMarkdownPath(filePath)) return 'markdown';
  if (['.sh','.bash','.zsh','.fish','.ps1'].includes(ext)) return 'shell';
  return 'plain';
}

function token(type, text) { return {type, text}; }
function push(tokens, type, text) { if (text) tokens.push(token(type, text)); }

function readQuoted(source, start, quote) {
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (source[i] === quote) { i++; break; }
    i++;
  }
  return i;
}

function tokenizeJavaScript(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '/' && source[i+1] === '/') {
      const end = source.indexOf('\n', i);
      const next = end < 0 ? source.length : end;
      push(tokens,'comment',source.slice(i,next)); i = next; continue;
    }
    if (ch === '/' && source[i+1] === '*') {
      const end = source.indexOf('*/', i+2);
      const next = end < 0 ? source.length : end + 2;
      push(tokens,'comment',source.slice(i,next)); i = next; continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = readQuoted(source,i,ch);
      push(tokens,'string',source.slice(i,end)); i=end; continue;
    }
    const number = source.slice(i).match(/^(?:0[xX][\da-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (number) { push(tokens,'number',number[0]); i += number[0].length; continue; }
    const ident = source.slice(i).match(/^[A-Za-z_$][\w$]*/);
    if (ident) {
      const word = ident[0];
      push(tokens, JS_KEYWORDS.has(word) ? 'keyword' : JS_LITERALS.has(word) ? 'literal' : 'plain', word);
      i += word.length; continue;
    }
    push(tokens,'plain',ch); i++;
  }
  return tokens;
}

function tokenizeJson(source) {
  const tokens=[];
  let i=0;
  while(i<source.length){
    const ch=source[i];
    if(ch==='"'){
      const end=readQuoted(source,i,'"');
      let j=end;
      while(j<source.length && /\s/.test(source[j])) j++;
      push(tokens,source[j]===':'?'property':'string',source.slice(i,end));
      i=end;continue;
    }
    const number=source.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if(number){push(tokens,'number',number[0]);i+=number[0].length;continue;}
    const literal=source.slice(i).match(/^(?:true|false|null)\b/);
    if(literal){push(tokens,literal[0]==='null'?'literal':'boolean',literal[0]);i+=literal[0].length;continue;}
    push(tokens,'plain',ch);i++;
  }
  return tokens;
}

function inlineMarkdownTokens(text) {
  const patterns = [
    {type:'code', re:/`[^`\n]+`/g},
    {type:'link', re:/!?(?:\[[^\]\n]*\])\([^\)\n]+\)/g},
    {type:'strong', re:/\*\*[^*\n]+\*\*|__[^_\n]+__/g},
    {type:'emphasis', re:/(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)/g}
  ];
  const ranges=[];
  for(const pattern of patterns){
    pattern.re.lastIndex=0;
    let match;
    while((match=pattern.re.exec(text))){ranges.push({start:match.index,end:match.index+match[0].length,type:pattern.type,text:match[0]});}
  }
  ranges.sort((a,b)=>a.start-b.start || b.end-a.end);
  const selected=[];
  let cursor=0;
  for(const range of ranges){if(range.start<cursor)continue;selected.push(range);cursor=range.end;}
  const out=[]; cursor=0;
  for(const range of selected){push(out,'plain',text.slice(cursor,range.start));push(out,range.type,range.text);cursor=range.end;}
  push(out,'plain',text.slice(cursor));
  return out;
}

function tokenizeMarkdown(source) {
  const tokens=[];
  const parts=source.split(/(\n)/);
  for(const part of parts){
    if(part==='\n'){push(tokens,'plain','\n');continue;}
    let line=part;
    const heading=line.match(/^(\s*)(#{1,6})(?=\s)/);
    if(heading){push(tokens,'plain',heading[1]);push(tokens,'heading-marker',heading[2]);line=line.slice(heading[0].length);tokens.push(...inlineMarkdownTokens(line));continue;}
    const quote=line.match(/^(\s*)(>)(?=\s?)/);
    if(quote){push(tokens,'plain',quote[1]);push(tokens,'blockquote-marker',quote[2]);line=line.slice(quote[0].length);tokens.push(...inlineMarkdownTokens(line));continue;}
    const list=line.match(/^(\s*)([-+*]|\d+\.)(?=\s)/);
    if(list){push(tokens,'plain',list[1]);push(tokens,'list-marker',list[2]);line=line.slice(list[0].length);tokens.push(...inlineMarkdownTokens(line));continue;}
    tokens.push(...inlineMarkdownTokens(line));
  }
  return tokens;
}

function tokenizeCss(source) {
  const tokens=[]; let i=0;
  while(i<source.length){
    if(source[i]==='/'&&source[i+1]==='*'){const end=source.indexOf('*/',i+2);const next=end<0?source.length:end+2;push(tokens,'comment',source.slice(i,next));i=next;continue;}
    if(source[i]==='"'||source[i]==="'"){const end=readQuoted(source,i,source[i]);push(tokens,'string',source.slice(i,end));i=end;continue;}
    const color=source.slice(i).match(/^#[\da-fA-F]{3,8}\b/);if(color){push(tokens,'number',color[0]);i+=color[0].length;continue;}
    const prop=source.slice(i).match(/^--?[A-Za-z_-][\w-]*(?=\s*:)/);if(prop){push(tokens,'property',prop[0]);i+=prop[0].length;continue;}
    const number=source.slice(i).match(/^\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg)?/);if(number){push(tokens,'number',number[0]);i+=number[0].length;continue;}
    push(tokens,'plain',source[i]);i++;
  }
  return tokens;
}

function tokenizeHtml(source) {
  const tokens=[];let i=0;
  while(i<source.length){
    if(source.startsWith('<!--',i)){const end=source.indexOf('-->',i+4);const next=end<0?source.length:end+3;push(tokens,'comment',source.slice(i,next));i=next;continue;}
    if(source[i]==='<'){const end=source.indexOf('>',i+1);const next=end<0?source.length:end+1;push(tokens,'tag',source.slice(i,next));i=next;continue;}
    push(tokens,'plain',source[i]);i++;
  }
  return tokens;
}

function tokenizeYaml(source) {
  const tokens=[];
  for(const part of source.split(/(\n)/)){
    if(part==='\n'){push(tokens,'plain','\n');continue;}
    const commentAt=part.indexOf('#');
    const core=commentAt>=0?part.slice(0,commentAt):part;
    const key=core.match(/^(\s*)([^:#][^:]*)(:)/);
    if(key){push(tokens,'plain',key[1]);push(tokens,'property',key[2]);push(tokens,'plain',key[3]);tokens.push(...tokenizeJavaScript(core.slice(key[0].length)));}
    else tokens.push(...tokenizeJavaScript(core));
    if(commentAt>=0) push(tokens,'comment',part.slice(commentAt));
  }
  return tokens;
}

function tokenizeSource(source, language='plain') {
  const text=String(source ?? '');
  if(language==='javascript') return tokenizeJavaScript(text);
  if(language==='json') return tokenizeJson(text);
  if(language==='markdown') return tokenizeMarkdown(text);
  if(language==='css') return tokenizeCss(text);
  if(language==='html') return tokenizeHtml(text);
  if(language==='yaml') return tokenizeYaml(text);
  if(language==='shell') return tokenizeJavaScript(text);
  return [token('plain',text)];
}

function proportionalScrollTop(fromViewport, toViewport) {
  const fromMax=Math.max(0,Number(fromViewport.scrollHeight||0)-Number(fromViewport.clientHeight||0));
  const toMax=Math.max(0,Number(toViewport.scrollHeight||0)-Number(toViewport.clientHeight||0));
  if(fromMax<=0||toMax<=0) return 0;
  const ratio=Math.max(0,Math.min(1,Number(fromViewport.top||0)/fromMax));
  return Math.round(ratio*toMax);
}

module.exports={isMarkdownPath,previewLanguageForPath,tokenizeSource,proportionalScrollTop};
