'use strict';

const { PluginSettingTab, Setting, Notice, MarkdownRenderer, Component } = require('obsidian');
const { filterSortRows } = require('./scanner');
const { pluginStatus, pluginNeedsCount, pluginBlockedCount, formatTime } = require('./ui-model');
const { isMarkdownPath, previewLanguageForPath, tokenizeSource, proportionalScrollTop } = require('./preview');

function el(parent, tag, cls, text) {
  const node = parent.createEl ? parent.createEl(tag, {cls, text}) : document.createElement(tag);
  if (!parent.createEl) {
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    parent.appendChild(node);
  }
  return node;
}
function button(parent, text, cls, onClick) {
  const b = el(parent,'button',cls,text);
  b.type = 'button';
  b.addEventListener('click', async event => {
    event.stopPropagation();
    if (b.disabled) return;
    await onClick(event,b);
  });
  return b;
}
function input(parent, type, value, placeholder) {
  const i = el(parent,'input','uopt-input');
  i.type = type;
  i.value = value || '';
  if (placeholder) i.placeholder = placeholder;
  return i;
}
function select(parent, value, options) {
  const s = el(parent,'select','uopt-input');
  for (const [v,label] of options) {
    const o = document.createElement('option');
    o.value=v; o.textContent=label; s.appendChild(o);
  }
  s.value=value;
  return s;
}
function stateLabel(state) {
  const labels = {
    'new-file':'New file', 'known-untranslated':'Untranslated', 'updated-approved':'Updated / approved',
    'original-restored':'Original restored', 'translated-current':'Translated / current', 'no-translation':'No translation needed',
    'ignored-localization':'Ignored localization/docs'
  };
  return labels[state] || state || 'Unknown';
}
function fileType(path) {
  const idx = path.lastIndexOf('.');
  return idx >= 0 ? path.slice(idx+1).toUpperCase() : 'FILE';
}
function createSortHeader(row, label, key, state, onSort) {
  const th = el(row,'th','uopt-sort-header');
  const active = state.key === key;
  const marker = active ? (state.dir === 'asc' ? ' ↑' : ' ↓') : '';
  const b = button(th, `${label}${marker}`, 'uopt-sort-button', () => onSort(key));
  b.title = `Sort by ${label}`;
  return th;
}

class UoptSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.selectedPluginId = null;
    this.selectedFilePath = null;
    this.previewRequestToken = 0;
    this.pluginQuery = '';
    this.fileQuery = '';
    this.pluginSort = {key:'name',dir:'asc'};
    this.fileSort = {key:'path',dir:'asc'};
    this.pendingFocus = null;
    this.showIgnoredFiles = false;
    this.previewModeByFile = new Map();
    this.previewScroll = new Map();
    this.previewTransition = null;
    this.previewRenderComponent = null;
    this.discoveryStarted = false;
    this.discoveryLoaded = false;
    this.refreshQueued = false;
  }

  requestRefresh(focusId=null, selectionStart=null, selectionEnd=null) {
    if (focusId) this.pendingFocus = {focusId, selectionStart, selectionEnd};
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    window.setTimeout(() => {
      this.refreshQueued = false;
      if (this.containerEl && this.containerEl.isConnected) {
        this.display();
        if (this.pendingFocus) {
          const pending = this.pendingFocus;
          this.pendingFocus = null;
          const target = this.containerEl.querySelector(`#${pending.focusId}`);
          if (target) {
            target.focus();
            if (typeof target.setSelectionRange === 'function') {
              const start = pending.selectionStart == null ? target.value.length : pending.selectionStart;
              const end = pending.selectionEnd == null ? start : pending.selectionEnd;
              target.setSelectionRange(start,end);
            }
          }
        }
      }
    }, 0);
  }

  async ensureDiscovery() {
    if (this.discoveryStarted) return;
    this.discoveryStarted = true;
    try {
      await this.plugin.discoverPlugins();
      this.discoveryLoaded = true;
      const ids = Object.keys(this.plugin.settings.plugins);
      if (!this.selectedPluginId && ids.length) this.selectedPluginId = ids[0];
    } catch (error) {
      new Notice(`UOPT could not list installed plugins: ${error.message || error}`);
    }
    this.requestRefresh();
  }

  display() {
    const {containerEl} = this;
    if (this.previewRenderComponent) {
      this.previewRenderComponent.unload();
      this.previewRenderComponent = null;
    }
    containerEl.empty();
    if (containerEl.classList) containerEl.classList.add('uopt-settings-container');
    const root = el(containerEl,'div','uopt-root');
    new Setting(root)
      .setName('Universal Obsidian Plugin Translator')
      .setDesc('Scan installed Community Plugins, review what needs English translation, and translate approved files in place with recoverable snapshots. UOPT performs no polling or translation work while idle.')
      .setHeading();

    if (!this.discoveryLoaded) {
      const loading = el(root,'div','uopt-banner uopt-banner-neutral','Loading installed plugin metadata…');
      loading.setAttribute('aria-live','polite');
      void this.ensureDiscovery();
    }

    const flow = el(root,'main','uopt-flow');
    this.renderGlobalActions(flow);
    this.renderSummary(flow);
    this.renderPluginTable(flow);
    this.renderPluginDetail(flow);
    this.renderSelectedFilePreview(flow);
    this.renderModelCard(flow);
    this.renderActivityCard(flow);
  }

  renderModelCard(parent) {
    const card = el(parent,'section','uopt-card uopt-model-card');
    const head = el(card,'div','uopt-card-head');
    el(head,'div','uopt-card-title','Model Settings');
    el(head,'div','uopt-card-subtitle','Used only when Translate runs');
    const body = el(card,'div','uopt-card-body');

    const fieldProvider = el(body,'label','uopt-field');
    el(fieldProvider,'span','uopt-label','Provider');
    const provider = select(fieldProvider,this.plugin.settings.provider,[['openai','OpenAI'],['ollama','Ollama']]);

    const openaiWrap = el(body,'div','uopt-provider-openai');
    const keyLabel = el(openaiWrap,'label','uopt-field');
    el(keyLabel,'span','uopt-label','OpenAI API key');
    const apiKey = input(keyLabel,'password',this.plugin.settings.openaiApiKey,'sk-…');
    el(keyLabel,'span','uopt-help','UOPT stores this locally in plugin data so it survives reloads.');
    const modelLabel = el(openaiWrap,'label','uopt-field');
    el(modelLabel,'span','uopt-label','OpenAI model');
    const openaiModel = input(modelLabel,'text',this.plugin.settings.openaiModel,'gpt-5-mini');

    const ollamaWrap = el(body,'div','uopt-provider-ollama');
    const urlLabel = el(ollamaWrap,'label','uopt-field');
    el(urlLabel,'span','uopt-label','Ollama URL');
    const ollamaUrl = input(urlLabel,'text',this.plugin.settings.ollamaUrl,'http://localhost:11434');
    const ollamaModelLabel = el(ollamaWrap,'label','uopt-field');
    el(ollamaModelLabel,'span','uopt-label','Ollama model');
    const ollamaModel = input(ollamaModelLabel,'text',this.plugin.settings.ollamaModel,'qwen3:8b');

    const syncVisibility = () => {
      openaiWrap.classList.toggle('uopt-hidden',provider.value !== 'openai');
      ollamaWrap.classList.toggle('uopt-hidden',provider.value !== 'ollama');
    };
    provider.addEventListener('change',syncVisibility);
    syncVisibility();

    const actions = el(body,'div','uopt-actions');
    const readDraft = () => ({
      provider:provider.value,
      openaiApiKey:apiKey.value.trim(),
      openaiModel:openaiModel.value.trim(),
      ollamaUrl:ollamaUrl.value.trim(),
      ollamaModel:ollamaModel.value.trim()
    });
    const save = button(actions,'Save settings','mod-cta uopt-button',async(_e,b)=>{
      b.disabled=true;
      try { await this.plugin.saveProviderSettings(readDraft()); }
      finally { b.disabled=false; this.requestRefresh(); }
    });
    const test = button(actions,'Test connection','uopt-button',async(_e,b)=>{
      b.disabled=true;
      try { await this.plugin.testProvider(readDraft()); }
      catch (_) {}
      finally { b.disabled=false; this.requestRefresh(); }
    });
    save.disabled = this.plugin.busy;
    test.disabled = this.plugin.busy;
  }

  renderActivityCard(parent) {
    const card = el(parent,'section','uopt-card');
    const head = el(card,'div','uopt-card-head uopt-card-head-row');
    const titleWrap = el(head,'div');
    el(titleWrap,'div','uopt-card-title','Activity');
    el(titleWrap,'div','uopt-card-subtitle','Recent actions');
    button(head,'Clear','uopt-button uopt-button-small',async()=>{
      this.plugin.settings.activity=[];
      this.plugin.service.state.activity=[];
      await this.plugin.saveSettings();
      this.requestRefresh();
    });
    const body = el(card,'div','uopt-card-body');
    const log = el(body,'div','uopt-activity');
    const items = this.plugin.settings.activity || [];
    if (!items.length) el(log,'div','uopt-empty','No activity yet.');
    for (const item of items.slice(0,30)) {
      const row = el(log,'div',`uopt-log uopt-log-${item.tone || 'info'}`);
      el(row,'div','uopt-log-message',item.message);
      el(row,'div','uopt-log-time',formatTime(item.timestamp));
    }
  }

  renderGlobalActions(parent) {
    const toolbar = el(parent,'div','uopt-toolbar uopt-global-actions');
    const scanAll = button(toolbar,'Scan all plugins','mod-cta uopt-button',async(_e,b)=>{
      b.disabled=true;
      try { await this.plugin.runScanAll(); }
      catch (_) {}
      finally { b.disabled=false; this.requestRefresh(); }
    });
    const translateAll = button(toolbar,'Translate all','uopt-button',async(_e,b)=>{
      b.disabled=true;
      try { await this.plugin.runTranslateAll(); }
      catch (_) {}
      finally { b.disabled=false; this.requestRefresh(); }
    });
    scanAll.disabled=this.plugin.busy;
    translateAll.disabled=this.plugin.busy;
    el(toolbar,'div','uopt-idle-status',this.plugin.busy ? 'Working…' : 'Idle · 0 background activity');
  }

  renderSummary(parent) {
    const card = el(parent,'section','uopt-card uopt-summary-card');
    const head = el(card,'div','uopt-card-head');
    el(head,'div','uopt-card-title','Summary');
    el(head,'div','uopt-card-subtitle','Current state from the latest scan. Scan is local and read-only.');
    const body = el(card,'div','uopt-card-body');
    this.renderMetrics(body);
  }

  renderMetrics(parent) {
    const plugins = Object.values(this.plugin.settings.plugins || {});
    const scanned = plugins.filter(p=>p.lastScan);
    const need = scanned.filter(p=>pluginNeedsCount(p)>0).length;
    const blocked = scanned.reduce((n,p)=>n+pluginBlockedCount(p),0);
    const eligible = scanned.filter(p=>p.includeInTranslateAll!==false && this.plugin.service.eligibleFiles(p.id).length>0).length;
    const grid = el(parent,'div','uopt-metrics');
    for (const [label,value,desc] of [
      ['Installed',plugins.length,'Community plugins'],
      ['Need translation',need,'After latest scans'],
      ['Approval required',blocked,'New/unapproved files'],
      ['Ready',eligible,'Approved translation work']
    ]) {
      const card=el(grid,'div','uopt-metric');
      el(card,'div','uopt-metric-label',label);
      el(card,'div','uopt-metric-value',String(value));
      el(card,'div','uopt-metric-desc',desc);
    }
  }

  renderPluginTable(parent) {
    const card = el(parent,'section','uopt-card');
    const head = el(card,'div','uopt-card-head');
    el(head,'div','uopt-card-title','Plugin Summary');
    el(head,'div','uopt-card-subtitle','Select a row for file-level details. New files are never approved automatically.');
    const body = el(card,'div','uopt-card-body');
    const searchRow = el(body,'div','uopt-search-row');
    const search = input(searchRow,'search',this.pluginQuery,'Search plugins…');
    search.id='uopt-plugin-search';
    search.addEventListener('input',()=>{
      this.pluginQuery=search.value;
      this.requestRefresh(search.id,search.selectionStart,search.selectionEnd);
    });

    const raw = Object.values(this.plugin.settings.plugins || {}).map(p=>{
      const status=pluginStatus(p);
      return {
        id:p.id,name:p.name||p.id,version:p.version||'',status:status.label,statusTone:status.tone,
        needs:pluginNeedsCount(p),blocked:pluginBlockedCount(p),lastScan:p.lastScan||'',lastTranslate:p.lastTranslate||'',
        bulk:p.includeInTranslateAll!==false?'Enabled':'Excluded',record:p
      };
    });
    const rows = filterSortRows(raw,this.pluginQuery,this.pluginSort.key,this.pluginSort.dir);
    const scroll = el(body,'div','uopt-table-scroll uopt-five-rows');
    const table = el(scroll,'table','uopt-table');
    const thead=el(table,'thead'); const hr=el(thead,'tr','uopt-sort-row');
    const sort=(key)=>{this.toggleSort(this.pluginSort,key);this.requestRefresh();};
    createSortHeader(hr,'Plugin','name',this.pluginSort,sort);
    createSortHeader(hr,'Version','version',this.pluginSort,sort);
    createSortHeader(hr,'Status','status',this.pluginSort,sort);
    createSortHeader(hr,'Needs','needs',this.pluginSort,sort);
    createSortHeader(hr,'Last scan','lastScan',this.pluginSort,sort);
    createSortHeader(hr,'Last translate','lastTranslate',this.pluginSort,sort);
    createSortHeader(hr,'Translate all','bulk',this.pluginSort,sort);
    el(hr,'th','uopt-actions-head','Actions');
    const tbody=el(table,'tbody');
    if (!rows.length) {
      const tr=el(tbody,'tr'); const td=el(tr,'td','uopt-empty','No plugins match this search.'); td.colSpan=8;
    }
    for (const row of rows) {
      const tr=el(tbody,'tr',row.id===this.selectedPluginId?'uopt-selected-row':'');
      tr.addEventListener('click',()=>{
        this.selectedPluginId=row.id;
        this.selectedFilePath=null;
        this.fileQuery='';
        this.showIgnoredFiles=false;
        this.requestRefresh();
      });
      const name=el(tr,'td'); el(name,'div','uopt-plugin-name',row.name); el(name,'div','uopt-small',row.id);
      el(tr,'td',null,row.version);
      const st=el(tr,'td'); el(st,'span',`uopt-pill uopt-pill-${row.statusTone}`,row.status);
      const needs=el(tr,'td'); el(needs,'div',null,String(row.needs)); if(row.blocked) el(needs,'div','uopt-small',`${row.blocked} blocked`);
      el(tr,'td',null,formatTime(row.lastScan));
      el(tr,'td',null,formatTime(row.lastTranslate));
      const bulk=el(tr,'td');
      const label=el(bulk,'label','uopt-switch-label');
      const checkbox=el(label,'input','uopt-switch'); checkbox.type='checkbox'; checkbox.checked=row.record.includeInTranslateAll!==false; checkbox.disabled=this.plugin.busy;
      el(label,'span','uopt-small',checkbox.checked?'Enabled':'Excluded');
      checkbox.addEventListener('click',e=>e.stopPropagation());
      checkbox.addEventListener('change',async()=>{
        this.plugin.service.setBulkEnabled(row.id,checkbox.checked); await this.plugin.saveSettings();
        await this.plugin.addActivity(`${row.name}: Translate all ${checkbox.checked?'enabled':'excluded'}.`,'info'); this.requestRefresh();
      });
      const actions=el(tr,'td','uopt-row-actions');
      const scan=button(actions,'Scan','uopt-button uopt-button-small',async()=>{try{await this.plugin.runScanPlugin(row.id);}catch(_){}this.requestRefresh();});
      const translate=button(actions,'Translate','uopt-button uopt-button-small',async()=>{try{await this.plugin.runTranslatePlugin(row.id);}catch(_){}this.requestRefresh();});
      scan.disabled=this.plugin.busy; translate.disabled=this.plugin.busy || !row.record.lastScan;
    }
  }

  renderPluginDetail(parent) {
    const card = el(parent,'section','uopt-card');
    const head = el(card,'div','uopt-card-head');
    el(head,'div','uopt-card-title','Plugin Detail');
    el(head,'div','uopt-card-subtitle','Per-file permission is the safety boundary. Previously approved changed files stay approved; new files do not.');
    const body=el(card,'div','uopt-card-body');
    const plugin=this.plugin.settings.plugins[this.selectedPluginId];
    if (!plugin) { el(body,'div','uopt-empty','Select a plugin from the summary table.'); return; }
    const status=pluginStatus(plugin);
    const top=el(body,'div','uopt-detail-top');
    const info=el(top,'div'); el(info,'div','uopt-detail-name',plugin.name||plugin.id); el(info,'div','uopt-small',`${plugin.id} · ${plugin.version||'unknown'}`);
    el(top,'span',`uopt-pill uopt-pill-${status.tone}`,status.label);

    const meta=el(body,'div','uopt-detail-meta');
    for(const [k,v] of [
      ['Last scan',formatTime(plugin.lastScan)],['Last translate',formatTime(plugin.lastTranslate)],
      ['Translation history',plugin.everTranslated?'Translated before':'Never translated'],
      ['Repository context',plugin.repository?plugin.repository:'Fetched only when Translate runs, if discoverable']
    ]) { el(meta,'div','uopt-meta-key',k); el(meta,'div','uopt-meta-value',v); }

    const detailActions=el(body,'div','uopt-actions');
    const scan=button(detailActions,'Scan plugin','uopt-button',async()=>{try{await this.plugin.runScanPlugin(plugin.id);}catch(_){}this.requestRefresh();});
    const translate=button(detailActions,'Translate plugin','mod-cta uopt-button',async()=>{try{await this.plugin.runTranslatePlugin(plugin.id);}catch(_){}this.requestRefresh();});
    const approve=button(detailActions,'Approve detected files','uopt-button',async()=>{
      let changed=0;
      for(const file of Object.values(plugin.files||{})) {
        if(file.candidateCount>0 && ['new-file','known-untranslated','updated-approved','original-restored'].includes(file.state) && !file.approved) {file.approved=true;changed++;}
      }
      await this.plugin.saveSettings(); await this.plugin.addActivity(`${plugin.name}: approved ${changed} detected file(s).`,'info'); this.requestRefresh();
    });
    scan.disabled=this.plugin.busy; translate.disabled=this.plugin.busy || !plugin.lastScan; approve.disabled=this.plugin.busy || !plugin.lastScan;

    if (!plugin.lastScan) {
      el(body,'div','uopt-banner uopt-banner-neutral','This plugin has not been scanned yet. Scan it to see file-level translation needs.');
      return;
    }

    const allFiles=Object.values(plugin.files||{});
    const ignoredCount=allFiles.filter(file=>file.state==='ignored-localization').length;
    const fileTools=el(body,'div','uopt-file-tools');
    const ignoredText=el(fileTools,'div');
    el(ignoredText,'div','uopt-label','Detected files');
    el(ignoredText,'div','uopt-help',`${ignoredCount} localization/support file(s) ignored by default.`);
    if (ignoredCount) {
      const ignoredLabel=el(fileTools,'label','uopt-switch-label');
      const showIgnored=el(ignoredLabel,'input','uopt-switch');
      showIgnored.type='checkbox';
      showIgnored.checked=this.showIgnoredFiles;
      el(ignoredLabel,'span','uopt-small','Show ignored');
      showIgnored.addEventListener('change',()=>{
        this.showIgnoredFiles=showIgnored.checked;
        const selected=plugin.files && plugin.files[this.selectedFilePath];
        if (!this.showIgnoredFiles && selected && selected.state==='ignored-localization') this.selectedFilePath=null;
        this.requestRefresh();
      });
    }

    const searchRow=el(body,'div','uopt-search-row');
    const search=input(searchRow,'search',this.fileQuery,'Search files…');
    search.id='uopt-file-search';
    search.addEventListener('input',()=>{
      this.fileQuery=search.value;
      this.requestRefresh(search.id,search.selectionStart,search.selectionEnd);
    });

    const raw=allFiles.filter(f=>this.showIgnoredFiles || f.state!=='ignored-localization').map(f=>({
      path:f.path,type:fileType(f.path),languages:(f.languages||[]).join(', ')||'English/none',state:stateLabel(f.state),
      candidates:f.candidateCount||0,allowed:f.state==='ignored-localization'?'Ignored':(f.approved?'Allowed':'Blocked'),record:f
    }));
    const rows=filterSortRows(raw,this.fileQuery,this.fileSort.key,this.fileSort.dir);
    const scroll=el(body,'div','uopt-table-scroll uopt-five-rows');
    const table=el(scroll,'table','uopt-table uopt-file-table');
    const thead=el(table,'thead');const hr=el(thead,'tr','uopt-sort-row');
    const sort=(key)=>{this.toggleSort(this.fileSort,key);this.requestRefresh();};
    createSortHeader(hr,'File','path',this.fileSort,sort);
    createSortHeader(hr,'Type','type',this.fileSort,sort);
    createSortHeader(hr,'Languages','languages',this.fileSort,sort);
    createSortHeader(hr,'State','state',this.fileSort,sort);
    createSortHeader(hr,'Candidates','candidates',this.fileSort,sort);
    createSortHeader(hr,'Allowed','allowed',this.fileSort,sort);
    const tbody=el(table,'tbody');
    if(!rows.length){const tr=el(tbody,'tr');const td=el(tr,'td','uopt-empty','No files match this search.');td.colSpan=6;}
    for(const row of rows){
      const selected = row.path===this.selectedFilePath ? 'uopt-selected-row' : '';
      const tr=el(tbody,'tr',selected);
      tr.addEventListener('click',()=>{this.selectedFilePath=row.path;this.requestRefresh();});
      const pathCell=el(tr,'td','uopt-file-path',row.path);
      if (row.record.ignoredReason) pathCell.title=row.record.ignoredReason;
      el(tr,'td',null,row.type); el(tr,'td',null,row.languages);
      const st=el(tr,'td'); el(st,'span','uopt-pill uopt-pill-neutral',row.state); el(tr,'td',null,String(row.candidates));
      const allowed=el(tr,'td'); const label=el(allowed,'label','uopt-switch-label'); const cb=el(label,'input','uopt-switch'); cb.type='checkbox'; cb.checked=row.record.approved;
      const immutable = row.record.state==='no-translation' || row.record.state==='translated-current' || row.record.state==='ignored-localization';
      cb.disabled=this.plugin.busy || immutable; el(label,'span','uopt-small',row.record.state==='ignored-localization'?'Ignored':(cb.checked?'Allowed':'Blocked'));
      cb.addEventListener('click',event=>event.stopPropagation());
      cb.addEventListener('change',async()=>{this.plugin.service.setFileApproval(plugin.id,row.path,cb.checked);await this.plugin.saveSettings();await this.plugin.addActivity(`${plugin.name} / ${row.path}: ${cb.checked?'allowed':'blocked'} for translation.`,'info');this.requestRefresh();});
    }
  }

  renderSelectedFilePreview(parent) {
    const card=el(parent,'section','uopt-card uopt-file-preview-card');
    const head=el(card,'div','uopt-card-head uopt-card-head-row');
    const titleWrap=el(head,'div');
    el(titleWrap,'div','uopt-card-title','Selected File Preview');
    const plugin=this.plugin.settings.plugins[this.selectedPluginId];
    if (!plugin || !this.selectedFilePath) {
      el(titleWrap,'div','uopt-card-subtitle','Select a detected file to inspect it.');
      const body=el(card,'div','uopt-card-body');
      el(body,'div','uopt-empty','Select a file from Plugin Detail to preview it here.');
      return;
    }

    const file=plugin.files && plugin.files[this.selectedFilePath];
    if (!file) {
      el(titleWrap,'div','uopt-card-subtitle','The selected file is no longer present in the latest scan.');
      const body=el(card,'div','uopt-card-body');
      el(body,'div','uopt-empty','Select another file from Plugin Detail.');
      return;
    }

    const language=previewLanguageForPath(this.selectedFilePath);
    const markdown=isMarkdownPath(this.selectedFilePath);
    const fileKey=this.previewFileKey(plugin.id,this.selectedFilePath);
    const mode=markdown ? (this.previewModeByFile.get(fileKey)||'readable') : 'source';
    el(titleWrap,'div','uopt-card-subtitle',`${this.selectedFilePath} · ${fileType(this.selectedFilePath)} · ${(file.languages||[]).join(', ')||'English/none'}`);

    if (markdown) {
      const modes=el(head,'div','uopt-preview-modes');
      for (const [value,label] of [['readable','Readable'],['source','Source']]) {
        const modeButton=button(modes,label,`uopt-button uopt-button-small ${mode===value?'is-active':''}`,()=>{
          if (mode===value) return;
          const viewport=card.querySelector('.uopt-preview-viewport');
          if (viewport) {
            const from=this.capturePreviewScroll(plugin.id,this.selectedFilePath,mode,viewport);
            this.previewTransition={fileKey,from};
          }
          this.previewModeByFile.set(fileKey,value);
          this.requestRefresh();
        });
        modeButton.setAttribute('aria-pressed',mode===value?'true':'false');
      }
    } else {
      el(head,'span','uopt-pill uopt-pill-neutral','Source');
    }

    const body=el(card,'div','uopt-card-body uopt-preview-body');
    const meta=el(body,'div','uopt-preview-meta');
    el(meta,'span','uopt-pill uopt-pill-neutral',stateLabel(file.state));
    el(meta,'span','uopt-pill uopt-pill-neutral',file.approved?'Allowed':'Blocked');
    if (file.ignoredReason) el(body,'div','uopt-banner uopt-banner-neutral',file.ignoredReason);

    const viewport=el(body,'div','uopt-preview-viewport');
    viewport.setAttribute('tabindex','0');
    viewport.setAttribute('aria-label',`${this.selectedFilePath} ${mode} preview`);
    el(viewport,'div','uopt-preview-loading','Loading preview…');
    const requestToken=++this.previewRequestToken;
    void this.plugin.service.readFilePreview(plugin.id,this.selectedFilePath,{maxChars:40000}).then(async preview=>{
      if (requestToken!==this.previewRequestToken || !viewport.isConnected) return;
      viewport.empty ? viewport.empty() : viewport.replaceChildren();
      if (markdown && mode==='readable') {
        const rendered=el(viewport,'div','uopt-preview-markdown markdown-rendered');
        const component=new Component();
        component.load();
        this.previewRenderComponent=component;
        await MarkdownRenderer.render(this.app,preview.content||'',rendered,this.selectedFilePath,component);
      } else {
        this.renderHighlightedSource(viewport,preview.content||'',language);
      }
      if (preview.truncated) el(body,'div','uopt-help',`Preview truncated at 40,000 of ${preview.totalChars.toLocaleString()} characters.`);
      this.restorePreviewScroll(plugin.id,this.selectedFilePath,mode,viewport);
      viewport.addEventListener('scroll',()=>this.capturePreviewScroll(plugin.id,this.selectedFilePath,mode,viewport),{passive:true});
    }).catch(error=>{
      if (requestToken!==this.previewRequestToken || !viewport.isConnected) return;
      viewport.textContent=`Unable to preview file: ${error.message || error}`;
    });
  }

  renderHighlightedSource(parent, source, language) {
    const pre=el(parent,'pre','uopt-preview-code');
    const code=el(pre,'code',`uopt-highlight uopt-language-${language}`);
    for (const item of tokenizeSource(source,language)) {
      if (item.type==='plain') code.appendChild(code.ownerDocument.createTextNode(item.text));
      else el(code,'span',`uopt-token uopt-token-${item.type}`,item.text);
    }
  }

  previewFileKey(pluginId,filePath) { return `${pluginId}::${filePath}`; }
  previewScrollKey(pluginId,filePath,mode) { return `${this.previewFileKey(pluginId,filePath)}::${mode}`; }

  capturePreviewScroll(pluginId,filePath,mode,viewport) {
    const snapshot={top:viewport.scrollTop,scrollHeight:viewport.scrollHeight,clientHeight:viewport.clientHeight};
    this.previewScroll.set(this.previewScrollKey(pluginId,filePath,mode),snapshot);
    return snapshot;
  }

  restorePreviewScroll(pluginId,filePath,mode,viewport) {
    const key=this.previewScrollKey(pluginId,filePath,mode);
    const saved=this.previewScroll.get(key);
    const transition=this.previewTransition;
    const apply=()=>{
      if (!viewport.isConnected) return;
      if (saved) viewport.scrollTop=saved.top;
      else if (transition && transition.fileKey===this.previewFileKey(pluginId,filePath)) {
        viewport.scrollTop=proportionalScrollTop(transition.from,{scrollHeight:viewport.scrollHeight,clientHeight:viewport.clientHeight});
      }
      if (transition && transition.fileKey===this.previewFileKey(pluginId,filePath)) this.previewTransition=null;
      this.capturePreviewScroll(pluginId,filePath,mode,viewport);
    };
    if (typeof window!=='undefined' && typeof window.requestAnimationFrame==='function') window.requestAnimationFrame(apply);
    else apply();
  }

  toggleSort(state,key){ if(state.key===key) state.dir=state.dir==='asc'?'desc':'asc'; else {state.key=key;state.dir='asc';} }
  renderOnly(){ this.requestRefresh(); }
}

module.exports = { UoptSettingTab };
