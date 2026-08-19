'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const SECRET_KEY_RE = /(authorization|api[-_]?key|token|password|secret)/i;
const BEARER_RE = /Bearer\s+[^\s"']+/gi;
const OPENAI_KEY_RE = /\bsk-[A-Za-z0-9_-]{8,}\b/g;

function safeSegment(value) {
  return String(value == null ? '' : value).replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,'-').replace(/^-+|-+$/g,'') || 'item';
}

function redactSecrets(value, key='') {
  if (SECRET_KEY_RE.test(String(key || ''))) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(item => redactSecrets(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k,v] of Object.entries(value)) out[k] = redactSecrets(v,k);
    return out;
  }
  if (typeof value === 'string') return value.replace(BEARER_RE,'Bearer [REDACTED]').replace(OPENAI_KEY_RE,'[REDACTED]');
  return value;
}

async function dirSize(dir) {
  let total = 0;
  let entries = [];
  try { entries = await fs.readdir(dir,{withFileTypes:true}); } catch (_) { return 0; }
  for (const entry of entries) {
    const full = path.join(dir,entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else if (entry.isFile()) {
      try { total += (await fs.stat(full)).size; } catch (_) {}
    }
  }
  return total;
}

class TranslationRunLogger {
  constructor({baseDir,maxRuns=20,maxBytes=250*1024*1024,now=()=>new Date(),randomBytes=crypto.randomBytes}={}) {
    this.baseDir = baseDir;
    this.maxRuns = Math.max(1,Number(maxRuns)||20);
    this.maxBytes = Math.max(1,Number(maxBytes)||250*1024*1024);
    this.now = now;
    this.randomBytes = randomBytes;
    this.runId = null;
    this.runDir = null;
    this.meta = null;
    this.lastError = null;
  }

  async start(meta={}) {
    await fs.mkdir(this.baseDir,{recursive:true});
    await this.pruneRetention();
    const startedAt = this.now().toISOString();
    const stamp = startedAt.replace(/[:.]/g,'-');
    const suffix = this.randomBytes(3).toString('hex');
    this.runId = `${stamp}__${safeSegment(meta.pluginId || meta.pluginName || 'translation')}__${suffix}`;
    this.runDir = path.join(this.baseDir,this.runId);
    await fs.mkdir(this.runDir,{recursive:true});
    this.meta = redactSecrets({...meta,runId:this.runId,startedAt,status:'running'});
    await this.writeRun();
    await this.appendEvent('run_started',this.meta);
    return {runId:this.runId,runDir:this.runDir};
  }

  async writeRun(extra={}) {
    if (!this.runDir) return;
    this.meta = {...(this.meta||{}),...redactSecrets(extra)};
    await fs.writeFile(path.join(this.runDir,'run.json'),JSON.stringify(this.meta,null,2)+'\n','utf8');
  }

  async appendEvent(type,data={}) {
    if (!this.runDir) return;
    const row = redactSecrets({timestamp:this.now().toISOString(),type,...data});
    await fs.appendFile(path.join(this.runDir,'events.jsonl'),JSON.stringify(row)+'\n','utf8');
  }

  fileDir(file) {
    return path.join(this.runDir,safeSegment(file));
  }

  batchDir(ctx) {
    return path.join(this.fileDir(ctx.file),`batch-${String(ctx.batch || 0).padStart(2,'0')}`);
  }

  attemptBase(ctx) {
    return `attempt-${String(ctx.attempt || 1).padStart(2,'0')}`;
  }

  async writeCandidates(file,candidates,meta={}) {
    const dir=this.fileDir(file); await fs.mkdir(dir,{recursive:true});
    await fs.writeFile(path.join(dir,'candidates.json'),JSON.stringify(redactSecrets({file,...meta,candidates}),null,2)+'\n','utf8');
    await this.appendEvent('candidates_written',{file,candidateCount:Array.isArray(candidates)?candidates.length:0,...meta});
  }

  async recordAttemptRequest(ctx,request) {
    const dir=this.batchDir(ctx); await fs.mkdir(dir,{recursive:true});
    const base=this.attemptBase(ctx);
    await fs.writeFile(path.join(dir,`${base}.request.json`),JSON.stringify(redactSecrets(request),null,2)+'\n','utf8');
    await this.appendEvent('attempt_request',ctx);
  }

  async recordAttemptResponse(ctx,{response,output,parse,telemetry,error}={}) {
    const dir=this.batchDir(ctx); await fs.mkdir(dir,{recursive:true});
    const base=this.attemptBase(ctx);
    if (response !== undefined) await fs.writeFile(path.join(dir,`${base}.response.json`),JSON.stringify(redactSecrets(response),null,2)+'\n','utf8');
    if (output !== undefined) await fs.writeFile(path.join(dir,`${base}.output.txt`),redactSecrets(String(output)),'utf8');
    const parsePayload=redactSecrets({...parse,telemetry,error:error ? String(error.message || error) : undefined});
    await fs.writeFile(path.join(dir,`${base}.parse.json`),JSON.stringify(parsePayload,null,2)+'\n','utf8');
    await this.appendEvent('attempt_response',{...ctx,accepted:parse && parse.accepted,unresolved:parse && parse.unresolved,error:error ? String(error.message || error) : undefined});
  }

  async finish(status,summary={}) {
    if (!this.runDir) return;
    try {
      const finishedAt=this.now().toISOString();
      await this.writeRun({status,finishedAt,summary});
      await this.appendEvent('run_finished',{status,summary});
      await this.pruneRetention();
    } catch (error) {
      this.lastError = error && error.message ? error.message : String(error);
    }
  }

  async pruneRetention() {
    if (!this.baseDir) return;
    await fs.mkdir(this.baseDir,{recursive:true});
    let names = await fs.readdir(this.baseDir,{withFileTypes:true});
    let dirs = names.filter(e=>e.isDirectory()).map(e=>e.name).sort();
    while (dirs.length > this.maxRuns) {
      const victim=dirs.shift();
      if (this.runDir && path.basename(this.runDir)===victim) { dirs.push(victim); break; }
      await fs.rm(path.join(this.baseDir,victim),{recursive:true,force:true});
    }
    let sized=[];
    for (const name of dirs) sized.push({name,size:await dirSize(path.join(this.baseDir,name))});
    let total=sized.reduce((sum,x)=>sum+x.size,0);
    for (const item of sized) {
      if (total <= this.maxBytes) break;
      if (this.runDir && path.basename(this.runDir)===item.name) continue;
      await fs.rm(path.join(this.baseDir,item.name),{recursive:true,force:true});
      total -= item.size;
    }
  }

  async clearAll() {
    if (!this.baseDir) return;
    await fs.rm(this.baseDir,{recursive:true,force:true});
    await fs.mkdir(this.baseDir,{recursive:true});
  }
}

module.exports = { TranslationRunLogger, redactSecrets, safeSegment, dirSize };
