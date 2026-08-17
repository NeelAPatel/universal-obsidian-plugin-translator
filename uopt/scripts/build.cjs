'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'src', 'main.js');
const output = path.join(root, 'main.js');
const modules = new Map();

function moduleId(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function resolveLocal(fromFile, request) {
  let target = path.resolve(path.dirname(fromFile), request);
  if (!path.extname(target)) target += '.js';
  if (!fs.existsSync(target)) {
    throw new Error(`Cannot resolve ${request} from ${moduleId(fromFile)}`);
  }
  return target;
}

function collect(file) {
  const abs = path.resolve(file);
  if (modules.has(abs)) return;
  let source = fs.readFileSync(abs, 'utf8');
  const deps = [];
  source = source.replace(/require\((['"])(\.\.?\/[^'"]+)\1\)/g, (_all, _quote, request) => {
    const target = resolveLocal(abs, request);
    deps.push(target);
    return `__uopt_require__(${JSON.stringify(moduleId(target))})`;
  });
  modules.set(abs, source);
  for (const dep of deps) collect(dep);
}

collect(entry);

const moduleBlocks = [...modules.entries()].map(([file, source]) => {
  return `${JSON.stringify(moduleId(file))}: function(module, exports, __uopt_require__) {\n${source}\n}`;
});

const banner = `/*\n * Universal Obsidian Plugin Translator\n * GENERATED FILE — edit src/ and run npm run build.\n */\n`;
const bundle = `${banner}'use strict';\n\nconst __uopt_modules__ = {\n${moduleBlocks.join(',\n')}\n};\nconst __uopt_cache__ = Object.create(null);\nfunction __uopt_require__(id) {\n  if (__uopt_cache__[id]) return __uopt_cache__[id].exports;\n  const factory = __uopt_modules__[id];\n  if (!factory) throw new Error('UOPT bundle module not found: ' + id);\n  const module = { exports: {} };\n  __uopt_cache__[id] = module;\n  factory(module, module.exports, __uopt_require__);\n  return module.exports;\n}\nmodule.exports = __uopt_require__(${JSON.stringify(moduleId(entry))});\n`;

fs.writeFileSync(output, bundle, 'utf8');
console.log(`Bundled ${modules.size} modules -> ${path.relative(root, output)}`);
