'use strict';

const { compactOllamaPluginContext, compactOllamaCandidate } = require('./ollama-speed');

const OBSIDIAN_GLOSSARY = `Canonical Obsidian terminology: Vault = an Obsidian vault; note = a Markdown note; Properties = Obsidian Properties; Command Palette = Obsidian Command Palette; Canvas = Obsidian Canvas; ribbon = the left ribbon; workspace = Obsidian workspace; backlink = backlink; frontmatter = YAML properties/frontmatter. Prefer natural English used by Obsidian rather than literal software-engineering translations.`;

function commonTranslationRules() {
  return [
    'You are the translation engine for Universal Obsidian Plugin Translator (UOPT).',
    'Target language is natural, concise English suitable for Obsidian UI.',
    OBSIDIAN_GLOSSARY,
    'Translate only text intended for a human user: settings labels/descriptions, Command Palette names, context-menu items, modal/dialog text, notices/toasts, buttons, headings, placeholders, tooltips, status text, user-visible errors, and visible bundled documentation.',
    'Do NOT translate machine-facing constants, identifiers, JSON keys, storage keys, API/protocol values, URLs, paths, regexes, CSS selectors, code logic, developer-only comments/logs, or text whose translation could change program semantics.',
    'Preserve placeholders, interpolation markers, Markdown syntax, code spans, URLs, punctuation intent, and line structure whenever present.'
  ];
}

function candidatePayload(candidates) {
  return candidates.map(c => ({
    id: c.id,
    text: c.text,
    kind: c.kind,
    sourceSection: c.semanticGroup || null,
    context: c.context,
    priorTranslation: c.priorTranslation || null,
    protected: !!c.protected
  }));
}

function buildTranslationPrompt(pluginContext, candidates) {
  return {
    system: [
      ...commonTranslationRules(),
      'When uncertain, set translate=false. Return only data matching the requested schema.'
    ].join('\n'),
    user: JSON.stringify({ plugin: pluginContext, candidates: candidatePayload(candidates) })
  };
}

function buildOllamaTranslationPrompt(pluginContext, candidates, options={}) {
  const retry = !!options.retry;
  return {
    system: [
      ...commonTranslationRules(),
      'Return plain text only. Do not return JSON, Markdown fences, prose, reasoning, headings, or explanations.',
      'Return exactly one record for every candidate: copy its opaque candidate token, then ONE REAL TAB character, then the translation.',
      'Separate records with REAL newline characters. Do not write the two literal characters \\t or \\n as protocol separators.',
      'If a candidate must not be translated, use the literal translation value __SKIP__.',
      'Candidate tokens must be copied exactly from the input. Never shorten, increment, infer, or invent tokens.',
      String.raw`Only inside the translation value: escape backslash as \\, tab as \t, newline as \n, and carriage return as \r so each record remains one physical output line.`,
      retry ? 'This is a retry containing only candidates that were unresolved previously. Answer every candidate.' : 'Answer every candidate exactly once.'
    ].join('\n'),
    user: JSON.stringify({
      plugin: compactOllamaPluginContext(pluginContext),
      candidates: candidates.map(compactOllamaCandidate)
    })
  };
}

const TRANSLATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          translate: { type: 'boolean' },
          translation: { type: 'string' }
        },
        required: ['id','translate','translation']
      }
    }
  },
  required: ['translations']
};

module.exports = { buildTranslationPrompt, buildOllamaTranslationPrompt, TRANSLATION_SCHEMA, OBSIDIAN_GLOSSARY };
