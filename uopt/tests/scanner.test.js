const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { scanPluginDirectory, filterSortRows } = require('../src/lib/scanner');

test('scans supported plugin files recursively and ignores binaries', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uopt-scan-'));
  await fs.mkdir(path.join(dir,'docs'));
  await fs.writeFile(path.join(dir,'manifest.json'), JSON.stringify({id:'demo',name:'Demo',version:'1.0.0'}));
  await fs.writeFile(path.join(dir,'main.js'), 'new Notice("保存成功");');
  await fs.writeFile(path.join(dir,'docs','help.md'), '# 使用说明');
  await fs.writeFile(path.join(dir,'image.png'), Buffer.from([1,2,3]));
  const result = await scanPluginDirectory({pluginDir:dir,pluginId:'demo'});
  assert.deepEqual(result.files.map(f=>f.path).sort(), ['docs/help.md','main.js','manifest.json']);
  const main = result.files.find(f=>f.path==='main.js');
  assert.equal(main.candidateCount, 1);
  assert.equal(main.state, 'new-file');
  assert.equal(main.approved, false);
});

test('changed previously translated file stays approved and becomes updated-approved', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uopt-scan-'));
  await fs.writeFile(path.join(dir,'manifest.json'), JSON.stringify({id:'demo',name:'Demo',version:'2.0.0'}));
  await fs.writeFile(path.join(dir,'main.js'), 'new Notice("新消息");');
  const previous = { files:{'main.js':{path:'main.js',approved:true,everTranslated:true,originalHash:'old-o',translatedHash:'old-t'}} };
  const result = await scanPluginDirectory({pluginDir:dir,pluginId:'demo',previous});
  const main = result.files.find(f=>f.path==='main.js');
  assert.equal(main.state, 'updated-approved');
  assert.equal(main.approved, true);
});

test('filterSortRows searches all columns and sorts requested column', () => {
  const rows = [
    {name:'Zulu',status:'Current',count:2},
    {name:'Alpha',status:'Needs translation',count:5},
    {name:'Beta',status:'Current',count:1}
  ];
  assert.deepEqual(filterSortRows(rows,'current','name','asc').map(r=>r.name), ['Beta','Zulu']);
  assert.deepEqual(filterSortRows(rows,'','count','desc').map(r=>r.count), [5,2,1]);
});

test('filterSortRows supports simultaneous per-column search filters', () => {
  const rows = [
    {name:'Calendar Plus',version:'2.0.0',status:'Updated approved',language:'Chinese'},
    {name:'Calendar Legacy',version:'1.0.0',status:'Current',language:'Chinese'},
    {name:'Task Tools',version:'2.0.0',status:'Updated approved',language:'Japanese'}
  ];
  const result = filterSortRows(rows, 'calendar', 'name', 'asc', {
    version:'2.0',
    status:'updated',
    language:'chin'
  });
  assert.deepEqual(result.map(row => row.name), ['Calendar Plus']);
});

test('localized README variants are ignored when a canonical README is present', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uopt-scan-'));
  await fs.writeFile(path.join(dir,'manifest.json'), JSON.stringify({id:'demo',name:'Demo',version:'1.0.0'}));
  await fs.writeFile(path.join(dir,'README.md'), '# Demo\nEnglish documentation.');
  await fs.writeFile(path.join(dir,'README.zh-CN.md'), '# 使用说明\n这是中文文档。');
  const result = await scanPluginDirectory({pluginDir:dir,pluginId:'demo'});
  const localized = result.files.find(f=>f.path==='README.zh-CN.md');
  assert.equal(localized.candidateCount, 0);
  assert.equal(localized.state, 'ignored-localization');
  assert.match(localized.ignoredReason, /localized documentation variant/i);
});

test('non-English locale resources are ignored when an English sibling exists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uopt-scan-'));
  await fs.mkdir(path.join(dir,'locales'));
  await fs.writeFile(path.join(dir,'manifest.json'), JSON.stringify({id:'demo',name:'Demo',version:'1.0.0'}));
  await fs.writeFile(path.join(dir,'locales','en.json'), JSON.stringify({save:'Save'}));
  await fs.writeFile(path.join(dir,'locales','zh-CN.json'), JSON.stringify({save:'保存'}));
  const result = await scanPluginDirectory({pluginDir:dir,pluginId:'demo'});
  const zh = result.files.find(f=>f.path==='locales/zh-CN.json');
  assert.equal(zh.candidateCount, 0);
  assert.equal(zh.state, 'ignored-localization');
  assert.match(zh.ignoredReason, /english locale sibling/i);
});

test('sole non-English locale resource remains eligible when no English sibling exists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uopt-scan-'));
  await fs.mkdir(path.join(dir,'locales'));
  await fs.writeFile(path.join(dir,'manifest.json'), JSON.stringify({id:'demo',name:'Demo',version:'1.0.0'}));
  await fs.writeFile(path.join(dir,'locales','zh-CN.json'), JSON.stringify({save:'保存'}));
  const result = await scanPluginDirectory({pluginDir:dir,pluginId:'demo'});
  const zh = result.files.find(f=>f.path==='locales/zh-CN.json');
  assert.equal(zh.candidateCount, 1);
  assert.equal(zh.state, 'new-file');
});

test('single README with explicit English and foreign-language sections is treated as localization documentation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uopt-scan-'));
  await fs.writeFile(path.join(dir,'manifest.json'), JSON.stringify({id:'demo',name:'Demo',version:'1.0.0'}));
  await fs.writeFile(path.join(dir,'README.md'), '## English\nUse the command palette.\n\n## 简体中文\n使用命令面板。');
  const result = await scanPluginDirectory({pluginDir:dir,pluginId:'demo'});
  const readme = result.files.find(f=>f.path==='README.md');
  assert.equal(readme.candidateCount, 0);
  assert.equal(readme.state, 'ignored-localization');
  assert.match(readme.ignoredReason, /multiple language sections/i);
});

test('JSON bundle with English and non-English locale branches is ignored as localization data', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uopt-scan-'));
  await fs.writeFile(path.join(dir,'manifest.json'), JSON.stringify({id:'demo',name:'Demo',version:'1.0.0'}));
  await fs.writeFile(path.join(dir,'translations.json'), JSON.stringify({en:{save:'Save'},'zh-CN':{save:'保存'}}));
  const result = await scanPluginDirectory({pluginDir:dir,pluginId:'demo'});
  const translations = result.files.find(f=>f.path==='translations.json');
  assert.equal(translations.candidateCount, 0);
  assert.equal(translations.state, 'ignored-localization');
  assert.match(translations.ignoredReason, /multi-language localization bundle/i);
});
