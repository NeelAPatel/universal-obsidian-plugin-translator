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
