'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { scanPluginDirectory, collectLocalDocs } = require('./scanner');
const { buildContextMemo } = require('./context');
const { extractCandidates } = require('./candidates');
const { translateSource } = require('./translator');
const { validateContent } = require('./validation');
const { SnapshotStore } = require('./snapshots');
const { sha256 } = require('./hash');
const { createFailureDiagnostic } = require('./diagnostics');

function defaultState() {
  return {
    provider:'openai',
    openaiApiKey:'',
    openaiModel:'gpt-5-mini',
    ollamaUrl:'http://localhost:11434',
    ollamaModel:'qwen3:8b',
    plugins:{},
    activity:[]
  };
}

function memoryKey(source, candidate) {
  const before = source.slice(Math.max(0, candidate.start - 100), candidate.start)
    .replace(/\s+/g, ' ').trim().slice(-80);
  return `${candidate.kind}|${before}|${candidate.text}`;
}

function memorySeed(source, candidates, memory) {
  const index = new Map((Array.isArray(memory) ? memory : []).map(item => [item.key, item.translation]));
  const seed = new Map();
  for (const candidate of candidates) {
    const translation = index.get(memoryKey(source, candidate));
    if (translation) seed.set(candidate.id, translation);
  }
  return seed;
}

class UoptService {
  constructor({ pluginsRoot, selfId='uopt', snapshotRoot, state, repositoryContextFetcher=null }) {
    this.pluginsRoot = pluginsRoot;
    this.selfId = selfId;
    this.snapshotStore = new SnapshotStore(snapshotRoot);
    this.state = state || defaultState();
    if (!this.state.plugins) this.state.plugins = {};
    this.repositoryContextFetcher = repositoryContextFetcher;
  }

  async discoverPlugins() {
    const ids = await this.listPluginIds();
    const discovered = [];
    for (const pluginId of ids) {
      const pluginDir = path.join(this.pluginsRoot, pluginId);
      let manifest;
      try { manifest = JSON.parse(await fs.readFile(path.join(pluginDir, 'manifest.json'), 'utf8')); }
      catch (_) { manifest = { id:pluginId, name:pluginId, version:'unknown', description:'' }; }
      const previous = this.state.plugins[pluginId];
      if (previous) {
        previous.name = manifest.name || previous.name || pluginId;
        previous.version = manifest.version || previous.version || 'unknown';
        previous.manifest = { ...previous.manifest, ...manifest, id:manifest.id || pluginId };
        discovered.push(previous);
      } else {
        const record = {
          id:pluginId, name:manifest.name || pluginId, version:manifest.version || 'unknown',
          manifest:{...manifest,id:manifest.id || pluginId}, includeInTranslateAll:true, everTranslated:false,
          lastScan:null, lastTranslate:null, repository:null, contextMemo:null, files:{}
        };
        this.state.plugins[pluginId] = record;
        discovered.push(record);
      }
    }
    return discovered;
  }

  async listPluginIds() {
    const entries = await fs.readdir(this.pluginsRoot, {withFileTypes:true});
    const ids = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === this.selfId) continue;
      try {
        await fs.access(path.join(this.pluginsRoot, entry.name, 'manifest.json'));
        ids.push(entry.name);
      } catch (_) {}
    }
    return ids.sort((a,b)=>a.localeCompare(b));
  }

  async scanPlugin(pluginId) {
    const pluginDir = path.join(this.pluginsRoot, pluginId);
    const previous = this.state.plugins[pluginId];
    const result = await scanPluginDirectory({pluginDir, pluginId, previous});
    const files = Object.fromEntries(result.files.map(f => [f.path, f]));
    const localDocs = await collectLocalDocs(pluginDir);
    let repoInfo = null;
    if (this.repositoryContextFetcher) {
      try { repoInfo = await this.repositoryContextFetcher(pluginId); } catch (_) { repoInfo = null; }
    }
    const contextMemo = buildContextMemo({
      manifest:result.manifest,
      localDocs,
      repositoryReadme:repoInfo && repoInfo.readme || '',
      maxChars:12000
    });
    const record = {
      id:pluginId,
      name:result.manifest.name || pluginId,
      version:result.manifest.version || 'unknown',
      manifest:result.manifest,
      includeInTranslateAll: previous ? previous.includeInTranslateAll !== false : true,
      everTranslated: previous ? !!previous.everTranslated : false,
      lastScan:new Date().toISOString(),
      lastTranslate:previous && previous.lastTranslate || null,
      repository:repoInfo && repoInfo.repo || previous && previous.repository || null,
      contextMemo,
      files
    };
    this.state.plugins[pluginId] = record;
    return record;
  }

  async scanAll() {
    const ids = await this.listPluginIds();
    const results = [];
    for (const id of ids) results.push(await this.scanPlugin(id));
    return results;
  }

  setFileApproval(pluginId, relativePath, approved) {
    const plugin = this.state.plugins[pluginId];
    if (!plugin || !plugin.files[relativePath]) throw new Error('Unknown plugin file');
    plugin.files[relativePath].approved = !!approved;
  }

  setBulkEnabled(pluginId, enabled) {
    const plugin = this.state.plugins[pluginId];
    if (!plugin) throw new Error('Unknown plugin');
    plugin.includeInTranslateAll = !!enabled;
  }

  eligibleFiles(pluginId) {
    const plugin = this.state.plugins[pluginId];
    if (!plugin) return [];
    return Object.values(plugin.files).filter(f => f.approved && ['new-file','known-untranslated','updated-approved','original-restored'].includes(f.state));
  }


  async readFilePreview(pluginId, relativePath, options={}) {
    const pluginDir = path.resolve(this.pluginsRoot, pluginId);
    const candidate = path.resolve(pluginDir, ...String(relativePath || '').split('/'));
    const prefix = pluginDir.endsWith(path.sep) ? pluginDir : pluginDir + path.sep;
    if (candidate !== pluginDir && !candidate.startsWith(prefix)) throw new Error('Unsafe plugin file path');
    const maxChars = Math.max(1, Number(options.maxChars) || 20000);
    const content = await fs.readFile(candidate, 'utf8');
    return {
      content:content.slice(0,maxChars),
      truncated:content.length > maxChars,
      totalChars:content.length,
      path:String(relativePath || '')
    };
  }

  async translatePlugin(pluginId, provider, options={}) {
    const plugin = this.state.plugins[pluginId];
    if (!plugin) throw new Error('Scan this plugin before translating it');
    const onlyFiles = Array.isArray(options.onlyFiles) ? new Set(options.onlyFiles) : null;
    const targetFiles = this.eligibleFiles(pluginId).filter(file => !onlyFiles || onlyFiles.has(file.path));
    let translatedFiles = 0;
    let translatedStrings = 0;
    const errors = [];
    const providerName = provider && (provider.providerName || provider.constructor && provider.constructor.name) || 'Unknown';
    const providerModel = provider && provider.model || '';

    for (let fileIndex=0; fileIndex<targetFiles.length; fileIndex++) {
      const file = targetFiles[fileIndex];
      const absolute = path.join(this.pluginsRoot, pluginId, ...file.path.split('/'));
      let source = '';
      let sourceHash = '';
      let candidates = [];
      let currentBatch = null;
      try {
        try {
          source = await fs.readFile(absolute,'utf8');
          sourceHash = sha256(source);
        } catch (error) {
          error.uoptStage = 'filesystem';
          throw error;
        }
        candidates = extractCandidates(file.path, source);
        let originalSnapshot;
        try {
          originalSnapshot = await this.snapshotStore.save(pluginId, file.path, 'original', sourceHash, source);
        } catch (error) {
          error.uoptStage = 'filesystem';
          throw error;
        }
        const seedTranslations = memorySeed(source, candidates, file.translationMemory);
        const result = await translateSource({
          source,
          candidates,
          pluginContext:plugin.contextMemo,
          provider,
          seedTranslations,
          maxBatchChars:options.maxBatchChars || 14000,
          onBatch: async (batch,total,items) => {
            currentBatch = {batch,totalBatches:total,candidateCount:items.length};
            if (options.onBatch) await options.onBatch({pluginId,file:file.path,fileIndex:fileIndex+1,fileTotal:targetFiles.length,batch,total,items});
          }
        });
        const validation = validateContent(file.path, result.content);
        if (!validation.ok) {
          const error = new Error(`Validation failed for ${file.path}: ${validation.error}`);
          error.uoptStage = 'validation';
          throw error;
        }
        let currentBeforeWrite;
        try {
          currentBeforeWrite = await fs.readFile(absolute, 'utf8');
        } catch (error) {
          error.uoptStage = 'filesystem';
          throw error;
        }
        if (sha256(currentBeforeWrite) !== sourceHash) {
          const error = new Error(`File changed during translation: ${file.path}. UOPT did not overwrite it.`);
          error.uoptStage = 'file-changed';
          throw error;
        }
        const translatedHash = sha256(result.content);
        if (result.content !== source) {
          const tempPath = `${absolute}.uopt-tmp-${process.pid}-${Date.now()}`;
          try {
            await fs.writeFile(tempPath, result.content, 'utf8');
            await fs.rename(tempPath, absolute);
          } catch (writeError) {
            writeError.uoptStage = 'filesystem';
            try { await fs.rm(tempPath, {force:true}); } catch (_) {}
            throw writeError;
          }
        }
        let translatedSnapshot;
        try {
          translatedSnapshot = await this.snapshotStore.save(pluginId, file.path, 'translated', translatedHash, result.content);
        } catch (error) {
          error.uoptStage = 'filesystem';
          throw error;
        }
        const translationMemory = candidates
          .filter(candidate => result.translations.has(candidate.id))
          .map(candidate => ({key:memoryKey(source,candidate),source:candidate.text,kind:candidate.kind,translation:result.translations.get(candidate.id)}));
        Object.assign(file, {
          originalHash:sourceHash,
          translatedHash,
          originalSnapshot,
          translatedSnapshot,
          translationMemory,
          everTranslated:true,
          approved:true,
          state:'translated-current',
          lastTranslated:new Date().toISOString(),
          lastError:null,
          lastFailure:null
        });
        translatedFiles++;
        translatedStrings += result.translatedCount;
      } catch (error) {
        const failureStage = error && error.uoptStage;
        const batchMeta = failureStage === 'provider' ? (error && error.uoptBatch || currentBatch || {}) : {};
        const diagnostic = createFailureDiagnostic(error, {
          stage:failureStage,
          pluginId,
          file:file.path,
          provider:providerName,
          model:providerModel,
          batch:batchMeta.batch,
          totalBatches:batchMeta.totalBatches,
          candidateCount:batchMeta.candidateCount
        });
        file.lastError = diagnostic.message;
        file.lastFailure = diagnostic;
        errors.push({file:file.path,error:diagnostic.message,diagnostic});
      }
    }
    if (translatedFiles > 0) {
      plugin.everTranslated = true;
      plugin.lastTranslate = new Date().toISOString();
    }
    return {translatedFiles, translatedStrings, errors};
  }
}

module.exports = { UoptService, defaultState, memoryKey, memorySeed };
