'use strict';

const OBSIDIAN_GLOSSARY = `Canonical Obsidian terminology: Vault = an Obsidian vault; note = a Markdown note; Properties = Obsidian Properties; Command Palette = Obsidian Command Palette; Canvas = Obsidian Canvas; ribbon = the left ribbon; workspace = Obsidian workspace; backlink = backlink; frontmatter = YAML properties/frontmatter. Prefer natural English used by Obsidian rather than literal software-engineering translations.`;

function buildTranslationPrompt(pluginContext, candidates) {
  return {
    system: [
      'You are the translation engine for Universal Obsidian Plugin Translator (UOPT).',
      'Target language is natural, concise English suitable for Obsidian UI.',
      OBSIDIAN_GLOSSARY,
      'Translate only text intended for a human user: settings labels/descriptions, Command Palette names, context-menu items, modal/dialog text, notices/toasts, buttons, headings, placeholders, tooltips, status text, user-visible errors, and visible bundled documentation.',
      'Do NOT translate machine-facing constants, identifiers, JSON keys, storage keys, API/protocol values, URLs, paths, regexes, CSS selectors, code logic, developer-only comments/logs, or text whose translation could change program semantics.',
      'Preserve placeholders, interpolation markers, Markdown syntax, code spans, URLs, punctuation intent, and line structure whenever present.',
      'When uncertain, set translate=false. Return only data matching the requested schema.'
    ].join('\n'),
    user: JSON.stringify({
      plugin: pluginContext,
      candidates: candidates.map(c => ({
        id: c.id,
        text: c.text,
        kind: c.kind,
        context: c.context,
        priorTranslation: c.priorTranslation || null,
        protected: !!c.protected
      }))
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

module.exports = { buildTranslationPrompt, TRANSLATION_SCHEMA, OBSIDIAN_GLOSSARY };
