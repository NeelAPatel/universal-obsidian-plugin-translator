'use strict';
const path = require('node:path');
const vm = require('node:vm');

function validateContent(filePath, content) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === '.json') JSON.parse(content);
    else if (ext === '.js' || ext === '.cjs') new vm.Script(content, { filename:filePath });
    return { ok:true };
  } catch (error) {
    return { ok:false, error: error && error.message ? error.message : String(error) };
  }
}
module.exports = { validateContent };
