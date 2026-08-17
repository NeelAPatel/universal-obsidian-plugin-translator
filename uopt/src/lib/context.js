'use strict';

function clampText(text, maxChars) {
  const value = String(text || '');
  if (value.length <= maxChars) return value;
  return value.slice(0, Math.max(0, maxChars - 24)) + '\n[…context truncated…]';
}

function buildContextMemo({ manifest = {}, localDocs = [], repositoryReadme = '', maxChars = 12000 }) {
  const header = [
    `Plugin ID: ${manifest.id || ''}`,
    `Plugin name: ${manifest.name || ''}`,
    `Version: ${manifest.version || ''}`,
    `Description: ${manifest.description || ''}`,
    `Author: ${manifest.author || ''}`
  ].join('\n');
  const docs = localDocs.filter(Boolean).join('\n\n--- LOCAL DOC ---\n\n');
  const repo = repositoryReadme ? `\n\n--- REPOSITORY README ---\n\n${repositoryReadme}` : '';
  const contextText = clampText(`${header}\n\n--- LOCAL INSTALLED DOCUMENTATION ---\n\n${docs}${repo}`, maxChars);
  return {
    id: manifest.id || '',
    name: manifest.name || manifest.id || '',
    version: manifest.version || '',
    description: manifest.description || '',
    contextText
  };
}

function findRepositoryFromCommunityIndex(index, pluginId) {
  if (!Array.isArray(index)) return null;
  const match = index.find(item => item && item.id === pluginId && typeof item.repo === 'string');
  return match ? match.repo : null;
}

module.exports = { buildContextMemo, findRepositoryFromCommunityIndex, clampText };
