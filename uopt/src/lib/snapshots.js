'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function safeSegment(value) {
  return encodeURIComponent(String(value)).replace(/%/g, '_');
}
function fileKey(relativePath) {
  const digest = crypto.createHash('sha1').update(relativePath).digest('hex').slice(0,12);
  return `${safeSegment(relativePath)}--${digest}`;
}

class SnapshotStore {
  constructor(baseDir) { this.baseDir = baseDir; }
  async save(pluginId, relativePath, kind, hash, content) {
    const dir = path.join(this.baseDir, safeSegment(pluginId), fileKey(relativePath));
    await fs.mkdir(dir, { recursive:true });
    const file = path.join(dir, `${kind}-${hash}.txt`);
    await fs.writeFile(file, content, 'utf8');
    return file;
  }
  async read(snapshotPath) {
    return fs.readFile(snapshotPath, 'utf8');
  }
}

module.exports = { SnapshotStore, safeSegment, fileKey };
