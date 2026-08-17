'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { sha256 } = require('./hash');
const { detectLanguages } = require('./language');
const { extractCandidates } = require('./candidates');
const { classifyFileState, nextApproval } = require('./state');

const SUPPORTED_EXTENSIONS = new Set(['.js','.cjs','.mjs','.json','.md','.markdown','.txt','.css','.html','.htm','.yaml','.yml']);
const SKIP_DIRS = new Set(['.git','node_modules','.svn','snapshots']);
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;

const LOCALE_DIR_RE = /(?:^|\/)(?:locale|locales|i18n|translations?|lang|langs|languages|l10n)(?:\/|$)/i;
const LOCALE_TOKEN_RE = /^(?:en|zh|ja|jp|ko|kr|ru|uk|ar|he|fa|hi|bn|th|vi|id|ms|fr|de|es|pt|it|pl|tr|nl|cs|sk|hu|ro|bg|el|sv|no|da|fi)(?:[-_][a-z0-9]{2,8})?$/i;
const ENGLISH_LOCALE_TOKEN_RE = /^en(?:[-_][a-z0-9]{2,8})?$/i;

function splitLocalizedDocVariant(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const dir = path.posix.dirname(normalized);
  const base = path.posix.basename(normalized);
  const match = base.match(/^(.+?)[._-]([a-z]{2,3}(?:[-_][a-z0-9]{2,8})?)\.(md|markdown|txt|html?)$/i);
  if (!match || !LOCALE_TOKEN_RE.test(match[2])) return null;
  return {
    locale:match[2],
    canonical:path.posix.join(dir === '.' ? '' : dir, `${match[1]}.${match[3]}`),
    stem:match[1],
    ext:`.${match[3]}`
  };
}

function localeResourceInfo(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (!LOCALE_DIR_RE.test(normalized)) return null;
  const ext = path.posix.extname(normalized);
  const token = path.posix.basename(normalized, ext);
  if (!LOCALE_TOKEN_RE.test(token)) return null;
  return {dir:path.posix.dirname(normalized), token, ext};
}


const LANGUAGE_HEADING_RE = /^(?:#{1,6}\s*)?(english|简体中文|繁體中文|繁体中文|中文|日本語|한국어|русский|español|français|deutsch|português|italiano)\s*$/i;

function hasMultilingualDocSections(relativePath, content) {
  if (!/\.(?:md|markdown|txt|html?)$/i.test(relativePath)) return false;
  const headings = String(content || '').split(/\r?\n/)
    .map(line => line.trim())
    .map(line => line.match(LANGUAGE_HEADING_RE))
    .filter(Boolean)
    .map(match => match[1].toLowerCase());
  const hasEnglish = headings.includes('english');
  const hasForeign = headings.some(label => label !== 'english');
  return hasEnglish && hasForeign;
}

function isLocaleKey(key) {
  return LOCALE_TOKEN_RE.test(String(key || ''));
}

function objectContainsEnglishAndForeignLocaleBranches(value, depth=0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) return false;
  const keys = Object.keys(value);
  const localeKeys = keys.filter(isLocaleKey);
  if (localeKeys.length >= 2 && localeKeys.some(key => ENGLISH_LOCALE_TOKEN_RE.test(key)) && localeKeys.some(key => !ENGLISH_LOCALE_TOKEN_RE.test(key))) {
    return true;
  }
  return keys.some(key => objectContainsEnglishAndForeignLocaleBranches(value[key], depth + 1));
}

function contentLocalizationIgnoreReason(relativePath, content) {
  if (hasMultilingualDocSections(relativePath, content)) {
    return 'Documentation contains explicit multiple language sections including English.';
  }
  if (/\.json$/i.test(relativePath)) {
    try {
      const parsed = JSON.parse(content);
      if (objectContainsEnglishAndForeignLocaleBranches(parsed)) {
        return 'Multi-language localization bundle already includes an English branch.';
      }
    } catch (_) {}
  }
  return null;
}

function localizationIgnoreReason(relativePath, allRelativePaths) {
  const paths = allRelativePaths instanceof Set ? allRelativePaths : new Set(allRelativePaths || []);
  const doc = splitLocalizedDocVariant(relativePath);
  if (doc && !ENGLISH_LOCALE_TOKEN_RE.test(doc.locale) && paths.has(doc.canonical)) {
    return 'Localized documentation variant; canonical documentation is present.';
  }
  const locale = localeResourceInfo(relativePath);
  if (locale && !ENGLISH_LOCALE_TOKEN_RE.test(locale.token)) {
    const englishSibling = [...paths].some(candidate => {
      const info = localeResourceInfo(candidate);
      return info && info.dir === locale.dir && info.ext === locale.ext && ENGLISH_LOCALE_TOKEN_RE.test(info.token);
    });
    if (englishSibling) return 'Localization resource has an English locale sibling.';
  }
  return null;
}

async function walkSupportedFiles(rootDir, options = {}) {
  const maxFileBytes = options.maxFileBytes || DEFAULT_MAX_FILE_BYTES;
  const out = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes:true });
    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
      const stat = await fs.stat(absolute);
      if (stat.size > maxFileBytes) continue;
      out.push({ absolute, relative:path.relative(rootDir, absolute).split(path.sep).join('/'), size:stat.size });
    }
  }
  await walk(rootDir);
  return out;
}

async function readManifest(pluginDir, fallbackId) {
  try {
    const raw = await fs.readFile(path.join(pluginDir,'manifest.json'),'utf8');
    const parsed = JSON.parse(raw);
    return { ...parsed, id: parsed.id || fallbackId };
  } catch (_) {
    return { id:fallbackId, name:fallbackId, version:'unknown', description:'' };
  }
}

function previousFileMap(previous) {
  if (!previous || !previous.files) return {};
  if (Array.isArray(previous.files)) return Object.fromEntries(previous.files.map(f => [f.path,f]));
  return previous.files;
}

async function scanPluginDirectory({ pluginDir, pluginId, previous, maxFileBytes }) {
  const manifest = await readManifest(pluginDir, pluginId);
  const prevMap = previousFileMap(previous);
  const fileEntries = await walkSupportedFiles(pluginDir, { maxFileBytes });
  const files = [];
  const allRelativePaths = new Set(fileEntries.map(entry => entry.relative));
  for (const entry of fileEntries) {
    const content = await fs.readFile(entry.absolute, 'utf8');
    const hash = sha256(content);
    const ignoredReason = localizationIgnoreReason(entry.relative, allRelativePaths) || contentLocalizationIgnoreReason(entry.relative, content);
    const candidates = ignoredReason ? [] : extractCandidates(entry.relative, content);
    const hasForeign = candidates.length > 0;
    const prev = prevMap[entry.relative];
    const state = ignoredReason ? 'ignored-localization' : classifyFileState({ previous:prev, currentHash:hash, hasForeign });
    const approved = ignoredReason ? false : nextApproval(prev, state);
    files.push({
      path:entry.relative,
      size:entry.size,
      hash,
      candidateCount:candidates.length,
      languages:ignoredReason ? detectLanguages(content) : detectLanguages(candidates.map(c=>c.text).join('\n')),
      state,
      approved,
      ignoredReason,
      everTranslated:!!(prev && prev.everTranslated),
      originalHash:prev && prev.originalHash || null,
      translatedHash:prev && prev.translatedHash || null,
      originalSnapshot:prev && prev.originalSnapshot || null,
      translatedSnapshot:prev && prev.translatedSnapshot || null,
      translationMemory:prev && Array.isArray(prev.translationMemory) ? prev.translationMemory : [],
      lastTranslated:prev && prev.lastTranslated || null,
      lastScan:new Date().toISOString()
    });
  }
  return { pluginId, manifest, files };
}

async function collectLocalDocs(pluginDir, maxChars = 9000) {
  const files = await walkSupportedFiles(pluginDir, { maxFileBytes:2 * 1024 * 1024 });
  const allRelativePaths = new Set(files.map(file => file.relative));
  const contextFiles = files.filter(file => !localizationIgnoreReason(file.relative, allRelativePaths));
  const preferred = contextFiles.filter(f => /(^|\/)(readme|help|docs?|guide|usage|manual)[^/]*\.(md|markdown|txt|html?)$/i.test(f.relative));
  const fallbacks = contextFiles.filter(f => /\.(md|markdown)$/i.test(f.relative));
  const ordered = [...preferred, ...fallbacks.filter(f => !preferred.some(p => p.relative === f.relative))];
  const docs = [];
  let used = 0;
  for (const file of ordered) {
    if (used >= maxChars) break;
    const raw = await fs.readFile(file.absolute,'utf8');
    if (contentLocalizationIgnoreReason(file.relative, raw)) continue;
    const remaining = maxChars - used;
    const excerpt = raw.slice(0, remaining);
    docs.push(`${file.relative}\n${excerpt}`);
    used += excerpt.length;
  }
  return docs;
}

function filterSortRows(rows, query, sortKey, direction = 'asc', columnFilters = {}) {
  const q = String(query || '').trim().toLowerCase();
  const activeFilters = Object.entries(columnFilters || {})
    .map(([key, value]) => [key, String(value || '').trim().toLowerCase()])
    .filter(([, value]) => value);
  const filtered = rows.filter(row => {
    if (q && !Object.values(row).some(value => String(value ?? '').toLowerCase().includes(q))) return false;
    return activeFilters.every(([key, value]) => String(row[key] ?? '').toLowerCase().includes(value));
  });
  if (!sortKey) return filtered;
  const factor = direction === 'desc' ? -1 : 1;
  return filtered.sort((a,b) => {
    const av = a[sortKey]; const bv = b[sortKey];
    if (typeof av === 'number' && typeof bv === 'number') return (av-bv)*factor;
    return String(av ?? '').localeCompare(String(bv ?? ''), undefined, {numeric:true,sensitivity:'base'}) * factor;
  });
}

module.exports = { SUPPORTED_EXTENSIONS, walkSupportedFiles, scanPluginDirectory, collectLocalDocs, filterSortRows, readManifest, splitLocalizedDocVariant, localeResourceInfo, localizationIgnoreReason, contentLocalizationIgnoreReason, hasMultilingualDocSections, objectContainsEnglishAndForeignLocaleBranches };
