'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

class Plugin {}
class PluginSettingTab {}
class Notice {}
class FileSystemAdapter {}
class Setting {}

function restrictedRequire(id) {
  if (id.startsWith('.')) throw new Error(`relative runtime require is forbidden: ${id}`);
  if (id === 'obsidian') {
    return {Plugin, PluginSettingTab, Notice, FileSystemAdapter, Setting, requestUrl: async()=>({})};
  }
  if (id.startsWith('node:')) return require(id);
  throw new Error(`unexpected runtime dependency: ${id}`);
}

test('bundled main.js loads when relative runtime require is unavailable', () => {
  const code = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const module = {exports:{}};
  const context = vm.createContext({module,exports:module.exports,require:restrictedRequire,console,process,Buffer,setTimeout,clearTimeout,window:{setTimeout,clearTimeout},document:{createElement:()=>({})}});
  new vm.Script(code,{filename:'main.js'}).runInContext(context);
  assert.equal(typeof module.exports, 'function');
});
