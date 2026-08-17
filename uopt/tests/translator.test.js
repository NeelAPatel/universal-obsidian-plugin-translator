const test = require('node:test');
const assert = require('node:assert/strict');
const { batchCandidates, translateSource } = require('../src/lib/translator');

test('batches candidates by configured approximate character budget', () => {
  const items = [
    {id:'c0',text:'a'.repeat(20),context:'x'.repeat(20)},
    {id:'c1',text:'b'.repeat(20),context:'x'.repeat(20)},
    {id:'c2',text:'c'.repeat(20),context:'x'.repeat(20)}
  ];
  const batches = batchCandidates(items, 90);
  assert.ok(batches.length >= 2);
  assert.deepEqual(batches.flat().map(x=>x.id), ['c0','c1','c2']);
});

test('translation orchestration patches only provider-approved candidates', async () => {
  const source = `new Notice("保存成功"); const machine = "内部状态";`;
  const candidates = [
    {id:'c0',start:12,end:16,text:'保存成功',kind:'js-string',quote:'"',context:'new Notice("保存成功")',protected:false},
    {id:'c1',start:37,end:41,text:'内部状态',kind:'js-string',quote:'"',context:'const machine = "内部状态"',protected:false}
  ];
  const provider = {
    async translate(_context, batch){
      assert.equal(batch.length, 2);
      return new Map([['c0','Saved successfully']]);
    }
  };
  const result = await translateSource({source,candidates,pluginContext:{name:'Test'},provider,maxBatchChars:10000});
  assert.equal(result.content, `new Notice("Saved successfully"); const machine = "内部状态";`);
  assert.equal(result.translatedCount, 1);
});

test('provider failure carries the active translation batch metadata', async () => {
  const source = 'new Notice("一"); new Notice("二");';
  const candidates = [
    {id:'c0',start:12,end:13,text:'一',kind:'js-string',quote:'"',context:'A'.repeat(70),protected:false},
    {id:'c1',start:29,end:30,text:'二',kind:'js-string',quote:'"',context:'B'.repeat(70),protected:false}
  ];
  let calls = 0;
  const provider = {
    async translate(){
      calls++;
      if (calls === 2) throw new Error('Translation provider did not return valid JSON');
      return new Map();
    }
  };
  await assert.rejects(
    () => translateSource({source,candidates,pluginContext:{},provider,maxBatchChars:160}),
    error => {
      assert.equal(error.uoptBatch.batch,2);
      assert.equal(error.uoptBatch.totalBatches,2);
      assert.equal(error.uoptBatch.candidateCount,1);
      assert.equal(error.uoptStage,'provider');
      return true;
    }
  );
});

test('semantic batching does not cross generated source module boundaries', () => {
  const source = [
    '// src/settings.ts',
    'const a = "通用";',
    'const b = "保存";',
    '// src/commands.ts',
    'const c = "画布内搜索";',
    'const d = "关闭";'
  ].join('\n');
  const mk = (id,text) => ({id,text,context:'x',start:source.indexOf(`"${text}"`)+1,protected:false});
  const candidates = [mk('c0','通用'),mk('c1','保存'),mk('c2','画布内搜索'),mk('c3','关闭')];
  const batches = batchCandidates(candidates,300,source);
  assert.equal(batches.length,2);
  assert.deepEqual(batches[0].map(c=>c.id),['c0','c1']);
  assert.deepEqual(batches[1].map(c=>c.id),['c2','c3']);
  assert.equal(batches[0][0].semanticGroup,'src/settings.ts');
  assert.equal(batches[1][0].semanticGroup,'src/commands.ts');
});

test('terminal provider failure carries partial translations recovered before the failure', async () => {
  const source = 'new Notice("保存"); new Notice("删除");';
  const candidates = [
    {id:'c0',start:12,end:14,text:'保存',kind:'js-string',quote:'"',context:'new Notice("保存")',protected:false},
    {id:'c1',start:30,end:32,text:'删除',kind:'js-string',quote:'"',context:'new Notice("删除")',protected:false}
  ];
  const provider = {
    async translate(){
      const error = new Error('Ollama line protocol left 1 candidate(s) unresolved');
      error.uoptPartialTranslations = new Map([['c0','Save']]);
      error.uoptUnresolvedIds = ['c1'];
      throw error;
    }
  };
  await assert.rejects(
    () => translateSource({source,candidates,pluginContext:{},provider,maxBatchChars:10000}),
    error => {
      assert.deepEqual([...error.uoptPartialTranslations.entries()],[['c0','Save']]);
      assert.deepEqual(error.uoptUnresolvedIds,['c1']);
      return true;
    }
  );
});


test('semantic batching never increases provider call count over baseline batching', () => {
  const source = Array.from({length:12},(_,i)=>`// src/module-${i}.ts\nconst x${i} = "设置${i}";`).join('\n');
  const candidates = Array.from({length:12},(_,i)=>{
    const text=`设置${i}`;
    return {id:`c${i}`,text,context:'x'.repeat(20),start:source.indexOf(`"${text}"`)+1,protected:false};
  });
  const baseline = batchCandidates(candidates,260,'');
  const semantic = batchCandidates(candidates,260,source);
  assert.ok(semantic.length <= baseline.length);
});
