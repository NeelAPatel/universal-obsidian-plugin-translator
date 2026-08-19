'use strict';
const crypto = require('node:crypto');

function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

function assignOllamaProtocolTokens(candidates=[]) {
  const used = new Set();
  return candidates.map((candidate,index) => {
    const identity = JSON.stringify([candidate.id,candidate.kind,candidate.start,candidate.end,candidate.text,index]);
    const digest = crypto.createHash('sha256').update(identity).digest('hex');
    let width = 16;
    let protocolId = `u_${digest.slice(0,width)}`;
    while (used.has(protocolId) && width < 64) {
      width = Math.min(64,width + 8);
      protocolId = `u_${digest.slice(0,width)}`;
    }
    if (used.has(protocolId)) throw new Error('Ollama protocol token collision');
    used.add(protocolId);
    return {...candidate,protocolId};
  });
}

function decodeLineValue(value) {
  const input = String(value || '');
  let out = '';
  for (let i=0;i<input.length;i++) {
    if (input[i] !== '\\' || i+1 >= input.length) { out += input[i]; continue; }
    const next=input[++i];
    if (next==='n') out += '\n';
    else if (next==='r') out += '\r';
    else if (next==='t') out += '\t';
    else if (next==='\\') out += '\\';
    else out += `\\${next}`;
  }
  return out;
}

function normalizeEscapedRecordSeparators(text,protocolIds) {
  const raw=String(text || '');
  if (!raw || !protocolIds.length) return raw;
  const alternatives=[...protocolIds].sort((a,b)=>b.length-a.length).map(escapeRegExp).join('|');
  const escapedNewlineBeforeKnownRecord = new RegExp('\\\\n(?=\\s*(?:'+alternatives+')(?:\\t|\\\\t))','g');
  return raw.replace(escapedNewlineBeforeKnownRecord,'\n');
}

function parseOllamaLineProtocol(text,candidates) {
  const tokenToId = new Map(candidates.map(c => [c.protocolId || c.id,c.id]));
  const protocolIds=[...tokenToId.keys()];
  const allowedIds=new Set(candidates.map(c=>c.id));
  const translations=new Map();
  const skippedIds=new Set();
  const decidedIds=new Set();
  const invalidLines=[];
  const records=new Map();
  const raw=String(text || '').trim();
  if (!raw) return {translations,skippedIds,decidedIds,unresolvedIds:new Set(allowedIds),invalidLines:['<empty response>']};

  const normalized=normalizeEscapedRecordSeparators(raw,protocolIds);
  for (const original of normalized.split(/\r?\n/)) {
    const line=original.trimEnd();
    const trimmed=line.trim();
    if (!trimmed || /^```(?:text|txt)?\s*$/i.test(trimmed) || trimmed==='```') continue;
    const working=line.trimStart();
    let token=null;
    let delimiterLength=0;
    for (const known of protocolIds) {
      if (working.startsWith(known+'\t')) { token=known; delimiterLength=known.length+1; break; }
      if (working.startsWith(known+'\\t')) { token=known; delimiterLength=known.length+2; break; }
    }
    if (!token) { invalidLines.push(original); continue; }
    const id=tokenToId.get(token);
    const encoded=working.slice(delimiterLength);
    if (!records.has(id)) records.set(id,[]);
    records.get(id).push({original,encoded});
  }

  for (const candidate of candidates) {
    const id=candidate.id;
    const rows=records.get(id) || [];
    if (rows.length !== 1) {
      if (rows.length > 1) invalidLines.push(...rows.map(row=>row.original));
      continue;
    }
    const value=decodeLineValue(rows[0].encoded).trimEnd();
    if (!value) { invalidLines.push(rows[0].original); continue; }
    if (/^__(?:SKIP)__$/i.test(value) || /^SKIP$/i.test(value)) {
      skippedIds.add(id); decidedIds.add(id); continue;
    }
    translations.set(id,value); decidedIds.add(id);
  }

  const unresolvedIds=new Set([...allowedIds].filter(id=>!decidedIds.has(id)));
  return {translations,skippedIds,decidedIds,unresolvedIds,invalidLines};
}

module.exports={assignOllamaProtocolTokens,parseOllamaLineProtocol,decodeLineValue,normalizeEscapedRecordSeparators};
