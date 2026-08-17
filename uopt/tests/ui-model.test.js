const test = require('node:test');
const assert = require('node:assert/strict');
const { pluginStatus, pluginNeedsCount, pluginBlockedCount } = require('../src/lib/ui-model');

test('unscanned plugin reports Never scanned', () => {
  assert.equal(pluginStatus({lastScan:null,files:{}}).label,'Never scanned');
});

test('new blocked files take priority over updated approved state', () => {
  const plugin = {lastScan:'x',files:{
    'a.js':{state:'updated-approved',approved:true,candidateCount:2},
    'b.js':{state:'new-file',approved:false,candidateCount:3}
  }};
  assert.equal(pluginStatus(plugin).label,'Approval required');
  assert.equal(pluginNeedsCount(plugin),2);
  assert.equal(pluginBlockedCount(plugin),1);
});

test('current plugin reports translated current', () => {
  const plugin = {lastScan:'x',everTranslated:true,files:{'a.js':{state:'translated-current',approved:true,candidateCount:0}}};
  assert.equal(pluginStatus(plugin).label,'Translated / current');
});
