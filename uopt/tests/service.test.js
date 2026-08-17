const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { UoptService, defaultState } = require('../src/lib/service');

test('scan discovers plugins but never approves a new foreign file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'uopt-service-'));
  const pluginsRoot = path.join(root,'plugins');
  const target = path.join(pluginsRoot,'demo');
  await fs.mkdir(target,{recursive:true});
  await fs.writeFile(path.join(target,'manifest.json'), JSON.stringify({id:'demo',name:'Demo',version:'1.0.0',description:'演示'}));
  await fs.writeFile(path.join(target,'main.js'), 'new Notice("保存成功");');
  const service = new UoptService({pluginsRoot,selfId:'uopt',snapshotRoot:path.join(root,'snapshots'),state:defaultState()});
  const result = await service.scanPlugin('demo');
  assert.equal(result.files['main.js'].state,'new-file');
  assert.equal(result.files['main.js'].approved,false);
  assert.equal(result.lastScan != null,true);
});

test('translate approved new file patches target and records snapshots', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'uopt-service-'));
  const pluginsRoot = path.join(root,'plugins');
  const target = path.join(pluginsRoot,'demo');
  await fs.mkdir(target,{recursive:true});
  await fs.writeFile(path.join(target,'manifest.json'), JSON.stringify({id:'demo',name:'Demo',version:'1.0.0'}));
  await fs.writeFile(path.join(target,'main.js'), 'new Notice("保存成功");');
  const state = defaultState();
  const service = new UoptService({pluginsRoot,selfId:'uopt',snapshotRoot:path.join(root,'snapshots'),state});
  await service.scanPlugin('demo');
  service.state.plugins.demo.files['main.js'].approved = true;
  const provider = { async translate(_ctx,batch){ return new Map(batch.map(c=>[c.id,'Saved successfully'])); } };
  const summary = await service.translatePlugin('demo',provider);
  const output = await fs.readFile(path.join(target,'main.js'),'utf8');
  assert.equal(output,'new Notice("Saved successfully");');
  assert.equal(summary.translatedFiles,1);
  const record = service.state.plugins.demo.files['main.js'];
  assert.ok(record.originalSnapshot);
  assert.ok(record.translatedSnapshot);
  assert.equal(record.state,'translated-current');
});

test('updated translated file remains approved after scan and translates again', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'uopt-service-'));
  const pluginsRoot = path.join(root,'plugins');
  const target = path.join(pluginsRoot,'demo');
  await fs.mkdir(target,{recursive:true});
  await fs.writeFile(path.join(target,'manifest.json'), JSON.stringify({id:'demo',name:'Demo',version:'1.0.0'}));
  await fs.writeFile(path.join(target,'main.js'), 'new Notice("保存");');
  const service = new UoptService({pluginsRoot,selfId:'uopt',snapshotRoot:path.join(root,'snapshots'),state:defaultState()});
  await service.scanPlugin('demo');
  service.state.plugins.demo.files['main.js'].approved = true;
  const provider = { async translate(_ctx,batch){ return new Map(batch.map(c=>[c.id,c.text==='保存'?'Save':'New message'])); } };
  await service.translatePlugin('demo',provider);
  await fs.writeFile(path.join(target,'main.js'),'new Notice("新消息");');
  await service.scanPlugin('demo');
  assert.equal(service.state.plugins.demo.files['main.js'].state,'updated-approved');
  assert.equal(service.state.plugins.demo.files['main.js'].approved,true);
  await service.translatePlugin('demo',provider);
  assert.equal(await fs.readFile(path.join(target,'main.js'),'utf8'),'new Notice("New message");');
});

test('lightweight discovery lists installed plugins without scanning file contents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'uopt-service-'));
  const pluginsRoot = path.join(root,'plugins');
  const target = path.join(pluginsRoot,'demo');
  await fs.mkdir(target,{recursive:true});
  await fs.writeFile(path.join(target,'manifest.json'), JSON.stringify({id:'demo',name:'Demo',version:'1.2.3'}));
  await fs.writeFile(path.join(target,'main.js'), 'new Notice("保存");');
  const service = new UoptService({pluginsRoot,selfId:'uopt',snapshotRoot:path.join(root,'snapshots'),state:defaultState()});
  const discovered = await service.discoverPlugins();
  assert.equal(discovered[0].name,'Demo');
  assert.equal(discovered[0].lastScan,null);
  assert.deepEqual(discovered[0].files,{});
});

test('does not overwrite a target file that changes while translation is in flight', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'uopt-service-'));
  const pluginsRoot = path.join(root,'plugins');
  const target = path.join(pluginsRoot,'demo');
  await fs.mkdir(target,{recursive:true});
  await fs.writeFile(path.join(target,'manifest.json'), JSON.stringify({id:'demo',name:'Demo',version:'1.0.0'}));
  const targetFile = path.join(target,'main.js');
  await fs.writeFile(targetFile, 'new Notice("保存");');
  const service = new UoptService({pluginsRoot,selfId:'uopt',snapshotRoot:path.join(root,'snapshots'),state:defaultState()});
  await service.scanPlugin('demo');
  service.state.plugins.demo.files['main.js'].approved = true;
  const provider = {
    async translate(_ctx,batch){
      await fs.writeFile(targetFile, 'new Notice("上游更新");');
      return new Map(batch.map(c=>[c.id,'Save']));
    }
  };
  const result = await service.translatePlugin('demo',provider);
  assert.equal(result.translatedFiles,0);
  assert.equal(result.errors.length,1);
  assert.match(result.errors[0].error,/changed during translation/i);
  assert.equal(await fs.readFile(targetFile,'utf8'),'new Notice("上游更新");');
});

test('reuses exact prior translation memory on updated files without provider call', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'uopt-service-'));
  const pluginsRoot = path.join(root,'plugins');
  const target = path.join(pluginsRoot,'demo');
  await fs.mkdir(target,{recursive:true});
  await fs.writeFile(path.join(target,'manifest.json'), JSON.stringify({id:'demo',name:'Demo',version:'1.0.0'}));
  const targetFile = path.join(target,'main.js');
  await fs.writeFile(targetFile, 'new Notice("保存");');
  const service = new UoptService({pluginsRoot,selfId:'uopt',snapshotRoot:path.join(root,'snapshots'),state:defaultState()});
  await service.scanPlugin('demo');
  service.state.plugins.demo.files['main.js'].approved = true;
  let calls = 0;
  const provider = {async translate(_ctx,batch){calls++;return new Map(batch.map(c=>[c.id,'Save']));}};
  await service.translatePlugin('demo',provider);
  assert.equal(calls,1);
  await fs.writeFile(targetFile, 'new Notice("保存"); const version=2;');
  await service.scanPlugin('demo');
  calls=0;
  await service.translatePlugin('demo',provider);
  assert.equal(calls,0);
  assert.equal(await fs.readFile(targetFile,'utf8'),'new Notice("Save"); const version=2;');
});

test('readFilePreview returns read-only text and truncation metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'uopt-service-'));
  const pluginsRoot = path.join(root,'plugins');
  const target = path.join(pluginsRoot,'demo');
  await fs.mkdir(target,{recursive:true});
  await fs.writeFile(path.join(target,'manifest.json'), JSON.stringify({id:'demo'}));
  await fs.writeFile(path.join(target,'help.md'), '0123456789ABCDEFGHIJ');
  const service = new UoptService({pluginsRoot,selfId:'uopt',snapshotRoot:path.join(root,'snapshots'),state:defaultState()});
  const preview = await service.readFilePreview('demo','help.md',{maxChars:10});
  assert.equal(preview.content,'0123456789');
  assert.equal(preview.truncated,true);
  assert.equal(preview.totalChars,20);
});

test('readFilePreview rejects traversal outside the plugin directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'uopt-service-'));
  const pluginsRoot = path.join(root,'plugins');
  const target = path.join(pluginsRoot,'demo');
  await fs.mkdir(target,{recursive:true});
  await fs.writeFile(path.join(target,'manifest.json'), JSON.stringify({id:'demo'}));
  await fs.writeFile(path.join(root,'secret.txt'), 'secret');
  const service = new UoptService({pluginsRoot,selfId:'uopt',snapshotRoot:path.join(root,'snapshots'),state:defaultState()});
  await assert.rejects(() => service.readFilePreview('demo','../../secret.txt'), /unsafe plugin file path/i);
});
