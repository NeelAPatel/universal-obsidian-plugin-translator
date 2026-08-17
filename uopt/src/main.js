'use strict';

const path = require('node:path');
const {
  Plugin,
  Notice,
  requestUrl,
  FileSystemAdapter
} = require('obsidian');
const { UoptService, defaultState } = require('./lib/service');
const { OpenAIProvider, OllamaProvider } = require('./lib/providers');
const { buildContextMemo, findRepositoryFromCommunityIndex, clampText } = require('./lib/context');
const { UoptSettingTab } = require('./lib/settings-tab');

const COMMUNITY_INDEX_URL = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json';

function mergeState(raw) {
  const defaults = defaultState();
  const data = raw && typeof raw === 'object' ? raw : {};
  return {
    ...defaults,
    ...data,
    plugins: data.plugins && typeof data.plugins === 'object' ? data.plugins : {},
    activity: Array.isArray(data.activity) ? data.activity.slice(0,100) : []
  };
}

class UniversalObsidianPluginTranslator extends Plugin {
  async onload() {
    this.settings = mergeState(await this.loadData());
    this.busy = false;
    this.communityIndexCache = null;
    this.settingsTab = null;

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice('UOPT requires Obsidian Desktop with a filesystem-backed vault.');
      return;
    }

    const vaultBase = typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : adapter.basePath;
    const configDirParts = String(this.app.vault.configDir || '.obsidian').split('/').filter(Boolean);
    this.pluginsRoot = path.join(vaultBase, ...configDirParts, 'plugins');
    this.snapshotRoot = path.join(this.pluginsRoot, this.manifest.id, 'snapshots');
    this.service = new UoptService({
      pluginsRoot:this.pluginsRoot,
      selfId:this.manifest.id,
      snapshotRoot:this.snapshotRoot,
      state:this.settings
    });

    this.settingsTab = new UoptSettingTab(this.app, this);
    this.addSettingTab(this.settingsTab);

    this.addCommand({ id:'scan-all-plugins', name:'Scan all community plugins', callback:()=>this.runScanAll() });
    this.addCommand({ id:'translate-all-approved', name:'Translate all approved plugin changes', callback:()=>this.runTranslateAll() });
  }

  async saveSettings() {
    if (this.service) this.settings = this.service.state;
    await this.saveData(this.settings);
  }

  async addActivity(message, tone='info', details=null) {
    const entry = { timestamp:new Date().toISOString(), tone, message };
    if (details && typeof details === 'object') entry.details = details;
    this.settings.activity = [entry, ...(this.settings.activity || [])].slice(0,100);
    if (this.service) this.service.state.activity = this.settings.activity;
    await this.saveSettings();
  }

  notify(message, timeout=5000) {
    new Notice(message, timeout);
  }

  async discoverPlugins() {
    if (!this.service) return [];
    const result = await this.service.discoverPlugins();
    await this.saveSettings();
    return result;
  }

  providerFromSettings(override={}) {
    const request = params => requestUrl(params);
    const provider = override.provider || this.settings.provider;
    if (provider === 'ollama') {
      return new OllamaProvider({
        baseUrl: override.ollamaUrl ?? this.settings.ollamaUrl,
        model: override.ollamaModel ?? this.settings.ollamaModel,
        request
      });
    }
    return new OpenAIProvider({
      apiKey: override.openaiApiKey ?? this.settings.openaiApiKey,
      model: override.openaiModel ?? this.settings.openaiModel,
      request
    });
  }

  async saveProviderSettings(draft) {
    this.settings.provider = draft.provider;
    this.settings.openaiApiKey = draft.openaiApiKey || '';
    this.settings.openaiModel = draft.openaiModel || 'gpt-5-mini';
    this.settings.ollamaUrl = draft.ollamaUrl || 'http://localhost:11434';
    this.settings.ollamaModel = draft.ollamaModel || 'qwen3:8b';
    await this.saveSettings();
    await this.addActivity(`Saved ${draft.provider === 'ollama' ? 'Ollama' : 'OpenAI'} provider settings.`, 'success');
  }

  async testProvider(draft) {
    if (this.busy) throw new Error('UOPT is already running another operation');
    this.busy = true;
    try {
      const provider = this.providerFromSettings(draft);
      const answer = await provider.testConnection();
      await this.addActivity(`${draft.provider === 'ollama' ? 'Ollama' : 'OpenAI'} connection test succeeded (${answer.slice(0,40)}).`, 'success');
      this.notify('UOPT provider connection succeeded.');
      return answer;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      await this.addActivity(`Provider connection test failed: ${message}`, 'error');
      this.notify(`UOPT provider test failed: ${message}`, 8000);
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async runScanPlugin(pluginId) {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.addActivity(`Scanning ${pluginId}…`, 'action');
      const record = await this.service.scanPlugin(pluginId);
      await this.saveSettings();
      const need = Object.values(record.files).filter(f => ['new-file','known-untranslated','updated-approved','original-restored'].includes(f.state)).length;
      const blocked = Object.values(record.files).filter(f => ['new-file','known-untranslated'].includes(f.state) && !f.approved).length;
      await this.addActivity(`Scan complete for ${record.name}: ${need} file(s) need attention, ${blocked} require approval.`, 'success');
      this.notify(`Scan complete: ${record.name}`);
      return record;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      await this.addActivity(`Scan failed for ${pluginId}: ${message}`, 'error');
      this.notify(`UOPT scan failed: ${message}`, 8000);
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async runScanAll() {
    if (this.busy || !this.service) return;
    this.busy = true;
    try {
      await this.addActivity('Scan all started.', 'action');
      const ids = await this.service.listPluginIds();
      let completed = 0;
      for (const id of ids) {
        const record = await this.service.scanPlugin(id);
        completed++;
        await this.saveSettings();
        await this.addActivity(`Scanned ${record.name} (${completed}/${ids.length}).`, 'info');
      }
      await this.addActivity(`Scan all complete: ${completed} plugin(s) analyzed. No target files were modified.`, 'success');
      this.notify(`UOPT scan complete: ${completed} plugin(s).`);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      await this.addActivity(`Scan all failed: ${message}`, 'error');
      this.notify(`UOPT scan all failed: ${message}`, 8000);
      throw error;
    } finally {
      this.busy = false;
      if (this.settingsTab) this.settingsTab.requestRefresh();
    }
  }

  async getCommunityIndex() {
    if (this.communityIndexCache) return this.communityIndexCache;
    const response = await requestUrl({ url:COMMUNITY_INDEX_URL, method:'GET' });
    const json = response.json || JSON.parse(response.text);
    this.communityIndexCache = Array.isArray(json) ? json : [];
    return this.communityIndexCache;
  }

  async fetchRepositoryContext(pluginId) {
    try {
      const index = await this.getCommunityIndex();
      const repo = findRepositoryFromCommunityIndex(index, pluginId);
      if (!repo) return null;
      const urls = [
        `https://raw.githubusercontent.com/${repo}/HEAD/README.md`,
        `https://raw.githubusercontent.com/${repo}/HEAD/readme.md`
      ];
      let readme = '';
      for (const url of urls) {
        try {
          const response = await requestUrl({url,method:'GET'});
          if (response.text) { readme = response.text; break; }
        } catch (_) {}
      }
      return {repo,readme:readme.slice(0,5000)};
    } catch (_) {
      return null;
    }
  }

  async enrichContextForTranslation(pluginId) {
    const plugin = this.settings.plugins[pluginId];
    if (!plugin || !plugin.contextMemo) return;
    const repoInfo = await this.fetchRepositoryContext(pluginId);
    if (!repoInfo || !repoInfo.readme) return;
    plugin.repository = repoInfo.repo;
    const marker = '\n\n--- PUBLIC REPOSITORY README ---\n';
    const baseContext = String(plugin.contextMemo.contextText || '').split(marker)[0];
    plugin.contextMemo = {
      ...plugin.contextMemo,
      contextText: clampText(`${baseContext}${marker}${repoInfo.readme}`, 14000)
    };
  }

  async runTranslatePlugin(pluginId) {
    if (this.busy) return;
    this.busy = true;
    try {
      return await this.translatePluginInternal(pluginId);
    } finally {
      this.busy = false;
      if (this.settingsTab) this.settingsTab.requestRefresh();
    }
  }

  async translatePluginInternal(pluginId, options={}) {
    const plugin = this.settings.plugins[pluginId];
    if (!plugin || !plugin.lastScan) throw new Error('Scan this plugin before translating it');
    const onlyFiles = Array.isArray(options.onlyFiles) ? options.onlyFiles : null;
    const eligible = this.service.eligibleFiles(pluginId).filter(file => !onlyFiles || onlyFiles.includes(file.path));
    if (!eligible.length) {
      await this.addActivity(`${plugin.name}: nothing approved needs translation.`, 'info');
      this.notify(`${plugin.name}: nothing approved needs translation.`);
      return {translatedFiles:0,translatedStrings:0,errors:[]};
    }
    const label = onlyFiles && onlyFiles.length === 1 ? `${plugin.name} / ${onlyFiles[0]}` : plugin.name;
    await this.addActivity(`${options.retry ? 'Retrying' : 'Translating'} ${label}: ${eligible.length} approved file(s).`, 'action');
    await this.enrichContextForTranslation(pluginId);
    const provider = this.providerFromSettings();
    const result = await this.service.translatePlugin(pluginId, provider, {
      onlyFiles,
      onBatch: async ({file,batch,total,items}) => {
        await this.addActivity(`${plugin.name} / ${file}: translation batch ${batch}/${total}.`, 'info', {
          pluginId, file, provider:provider.providerName || null, model:provider.model || null,
          batch, totalBatches:total, candidateCount:Array.isArray(items) ? items.length : null
        });
      }
    });
    await this.saveSettings();
    if (result.errors.length) {
      for (const failure of result.errors) {
        const diagnostic = failure.diagnostic || {pluginId,file:failure.file,message:failure.error,category:'Unknown',stage:'Unknown'};
        await this.addActivity(`${plugin.name} / ${failure.file}: ${diagnostic.category} — ${diagnostic.message}`, 'error', diagnostic);
      }
      await this.addActivity(`${plugin.name}: ${result.translatedFiles} file(s) translated; ${result.errors.length} failed. Expand the error entry for exact diagnostics.`, 'error');
    } else {
      await this.addActivity(`${plugin.name}: translated ${result.translatedStrings} string(s) across ${result.translatedFiles} file(s).`, 'success');
    }
    this.notify(`${plugin.name}: translation ${result.errors.length ? 'finished with errors' : 'complete'}. Reload the plugin or Obsidian if its UI is already open.`, 7000);
    return result;
  }

  async runRetryFile(pluginId, filePath) {
    if (this.busy) return;
    this.busy = true;
    try {
      const plugin = this.settings.plugins[pluginId];
      const file = plugin && plugin.files && plugin.files[filePath];
      if (!plugin || !file) throw new Error('The selected plugin file is no longer available');
      if (!file.approved) throw new Error('Approve this file before retrying it');
      const result = await this.translatePluginInternal(pluginId, {onlyFiles:[filePath], retry:true});
      if (!result.errors.length) this.notify(`${plugin.name} / ${filePath}: retry succeeded.`);
      return result;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      await this.addActivity(`Retry failed for ${pluginId} / ${filePath}: ${message}`, 'error', {
        pluginId, file:filePath, category:'Unknown', stage:'Retry setup', message,
        provider:this.settings.provider === 'ollama' ? 'Ollama' : 'OpenAI',
        model:this.settings.provider === 'ollama' ? this.settings.ollamaModel : this.settings.openaiModel,
        timestamp:new Date().toISOString()
      });
      this.notify(`UOPT retry failed: ${message}`, 8000);
      throw error;
    } finally {
      this.busy = false;
      if (this.settingsTab) this.settingsTab.requestRefresh();
    }
  }

  async runTranslateAll() {
    if (this.busy || !this.service) return;
    this.busy = true;
    try {
      await this.addActivity('Translate all started.', 'action');
      const plugins = Object.values(this.settings.plugins)
        .filter(p => p.lastScan && p.includeInTranslateAll !== false)
        .sort((a,b)=>String(a.name).localeCompare(String(b.name)));
      let processed = 0;
      let skipped = 0;
      for (const plugin of plugins) {
        if (!this.service.eligibleFiles(plugin.id).length) {
          skipped++;
          continue;
        }
        await this.translatePluginInternal(plugin.id);
        processed++;
        await this.saveSettings();
      }
      await this.addActivity(`Translate all complete: ${processed} plugin(s) processed, ${skipped} had nothing approved to do.`, 'success');
      this.notify(`UOPT Translate all complete: ${processed} plugin(s). Reload Obsidian if translated UI is already loaded.`, 8000);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      await this.addActivity(`Translate all failed: ${message}`, 'error');
      this.notify(`UOPT Translate all failed: ${message}`, 8000);
      throw error;
    } finally {
      this.busy = false;
      if (this.settingsTab) this.settingsTab.requestRefresh();
    }
  }
}

module.exports = UniversalObsidianPluginTranslator;
