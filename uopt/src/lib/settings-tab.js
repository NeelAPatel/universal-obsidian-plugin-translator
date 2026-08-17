'use strict';

const { PluginSettingTab, Setting, Notice } = require('obsidian');
const { filterSortRows } = require('./scanner');
const { pluginStatus, pluginNeedsCount, pluginBlockedCount, formatTime } = require('./ui-model');

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
    this.pluginFilters = {name:'',version:'',status:'',needs:'',lastScan:'',lastTranslate:'',bulk:''};
    this.fileFilters = {path:'',type:'',languages:'',state:'',candidates:'',allowed:''};
    this.pluginSort = {key:'name',dir:'asc'};
    this.fileSort = {key:'path',dir:'asc'};
    this.pendingFocus = null;
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
    this.renderSummary(flow);
    this.renderPluginTable(flow);
    this.renderPluginDetail(flow);
    this.renderModelCard(flow);
    this.renderActivityCard(flow);
  }

  renderModelCard(parent) {
    const card = el(parent,'section','uopt-card uopt-model-card');
    const head = el(card,'div','uopt-card-head');
    el(head,'div','uopt-card-title','Model settings');
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

  renderSummary(parent) {
    const card = el(parent,'section','uopt-card uopt-summary-card');
    const head = el(card,'div','uopt-card-head');
    el(head,'div','uopt-card-title','Summary');
    el(head,'div','uopt-card-subtitle','Scan is local and read-only. Translate only processes approved work.');
    const body = el(card,'div','uopt-card-body');
    const toolbar = el(body,'div','uopt-toolbar');
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
      ['Translate all ready',eligible,'Plugins with approved work']
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
    el(head,'div','uopt-card-title','Plugin summary');
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
    const rows = filterSortRows(raw,this.pluginQuery,this.pluginSort.key,this.pluginSort.dir,this.pluginFilters);
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
    this.renderColumnFilters(thead,[
      ['name','Plugin'],['version','Version'],['status','Status'],['needs','Needs'],
      ['lastScan','Last scan'],['lastTranslate','Last translate'],['bulk','Translate all']
    ],this.pluginFilters,'plugin');
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
        this.fileFilters={path:'',type:'',languages:'',state:'',candidates:'',allowed:''};
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
    el(head,'div','uopt-card-title','Plugin detail');
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

    const searchRow=el(body,'div','uopt-search-row');
    const search=input(searchRow,'search',this.fileQuery,'Search files…');
    search.id='uopt-file-search';
    search.addEventListener('input',()=>{
      this.fileQuery=search.value;
      this.requestRefresh(search.id,search.selectionStart,search.selectionEnd);
    });

    const raw=Object.values(plugin.files||{}).map(f=>({
      path:f.path,type:fileType(f.path),languages:(f.languages||[]).join(', ')||'English/none',state:stateLabel(f.state),
      candidates:f.candidateCount||0,allowed:f.state==='ignored-localization'?'Ignored':(f.approved?'Allowed':'Blocked'),record:f
    }));
    const rows=filterSortRows(raw,this.fileQuery,this.fileSort.key,this.fileSort.dir,this.fileFilters);
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
    this.renderColumnFilters(thead,[
      ['path','File'],['type','Type'],['languages','Languages'],['state','State'],['candidates','Candidates'],['allowed','Allowed']
    ],this.fileFilters,'file');
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
    this.renderFilePreview(body,plugin);
  }

  renderFilePreview(parent, plugin) {
    const wrap=el(parent,'section','uopt-file-preview');
    const head=el(wrap,'div','uopt-file-preview-head');
    el(head,'div','uopt-card-title','File preview');
    if (!this.selectedFilePath) {
      el(wrap,'div','uopt-empty','Select a file row to preview the currently installed file.');
      return;
    }
    const file=plugin.files && plugin.files[this.selectedFilePath];
    const meta=el(head,'div','uopt-small',this.selectedFilePath);
    meta.title=this.selectedFilePath;
    if (file && file.ignoredReason) el(wrap,'div','uopt-banner uopt-banner-neutral',file.ignoredReason);
    const pre=el(wrap,'pre','uopt-preview-code','Loading preview…');
    const requestToken=++this.previewRequestToken;
    void this.plugin.service.readFilePreview(plugin.id,this.selectedFilePath,{maxChars:20000}).then(preview=>{
      if (requestToken!==this.previewRequestToken || !pre.isConnected) return;
      pre.textContent=preview.content || '(empty file)';
      if (preview.truncated) {
        el(wrap,'div','uopt-help',`Preview truncated at 20,000 of ${preview.totalChars.toLocaleString()} characters.`);
      }
    }).catch(error=>{
      if (requestToken!==this.previewRequestToken || !pre.isConnected) return;
      pre.textContent=`Unable to preview file: ${error.message || error}`;
    });
  }

  renderColumnFilters(thead, columns, state, prefix) {
    const row=el(thead,'tr','uopt-filter-row');
    for(const [key,label] of columns) {
      const th=el(row,'th','uopt-filter-cell');
      const control=input(th,'search',state[key]||'',`Filter ${label}…`);
      control.id=`uopt-${prefix}-filter-${key}`;
      control.setAttribute('aria-label',`Filter ${label}`);
      control.addEventListener('click',event=>event.stopPropagation());
      control.addEventListener('input',()=>{
        state[key]=control.value;
        this.requestRefresh(control.id,control.selectionStart,control.selectionEnd);
      });
    }
    if(prefix==='plugin') el(row,'th','uopt-filter-cell');
  }

  toggleSort(state,key){ if(state.key===key) state.dir=state.dir==='asc'?'desc':'asc'; else {state.key=key;state.dir='asc';} }
  renderOnly(){ this.requestRefresh(); }
}

module.exports = { UoptSettingTab };
