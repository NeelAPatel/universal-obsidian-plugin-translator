# Universal Obsidian Plugin Translator (UOPT)

UOPT is a desktop-only Obsidian plugin that scans installed Community Plugins for non-English user-facing text and translates approved files into English.

Current release: **v0.1.6**

The canonical machine/AI-readable project identity is [`PROJECT.json`](./PROJECT.json). The actual plugin project lives in [`uopt/`](./uopt/).

## Repository layout

```text
universal-obsidian-plugin-translator/
├── PROJECT.json          # canonical title / shorthand / plugin id / version / repo
├── README.md
├── INSTALL.md
├── CHANGELOG.md
├── .github/workflows/
└── uopt/                 # plugin source, runtime, tests, scripts
    ├── main.js           # generated self-contained Obsidian runtime
    ├── manifest.json
    ├── styles.css
    ├── src/
    ├── tests/
    ├── scripts/
    └── package.json
```

## What v0.1.6 does

- **Scan all plugins** or scan one plugin at a time.
- Scan is read-only/local and does not call OpenAI or Ollama.
- **Translate all** eligible plugins or translate one plugin at a time.
- New plugins and newly introduced files require explicit approval before modification.
- Previously approved changed files remain eligible after upstream updates.
- Targets user-visible settings, Command Palette labels, context menus, modals, notices, buttons, headings, placeholders, tooltips, errors, and useful bundled help/documentation.
- Ignores localized documentation duplicates and non-English locale packs when an English sibling already exists.
- Provides a dedicated read-only **Selected File Preview** section with syntax-highlighted source.
- Markdown previews can switch between **Readable** and **Source** modes while preserving each mode's scroll position.
- Plugin/file tables keep one search bar, sortable columns, and a five-visible-row scrolling viewport; per-column filter controls are intentionally omitted.
- Ignored localization/support files stay hidden by default and can be revealed with **Show ignored**.
- Supports OpenAI and Ollama providers.
- OpenAI keeps JSON-schema Structured Outputs; Ollama uses a resilient line protocol so one malformed response row does not discard valid translations from the same batch.
- Ollama automatically retries only unresolved candidate IDs and preserves recovered translations as memory if a later retry is still needed.
- Ollama uses a larger 42k-character batch budget to reduce sequential local-model calls for large bundled plugins while OpenAI remains on the conservative generic budget.
- Ollama keeps the selected model resident for 15 minutes during connection tests and translation runs.
- Repeated Ollama prompts compact bulky plugin documentation and use shorter context for trivial UI labels while retaining richer context for ambiguous strings.
- Ollama response timing counters are captured for profiling model-load, prompt-evaluation, and generation latency.
- Generated bundles with `// src/...` markers carry source-module context and use module-aware packing only when it does not increase provider-call count.
- Keeps clean-original and translated snapshots before committing translations.
- Validates JavaScript/JSON and re-checks the source hash immediately before replacement.
- Does no polling, background scanning, or provider work while idle.
- Shows exact structured translation failures instead of collapsing provider/validation errors into a generic summary.
- Failed files expose category, stage, provider, model, batch context, Copy error, and single-file Retry actions.

## Install

### Easiest: release ZIP

Download `uopt.zip` from the latest GitHub release and extract it directly into your vault's `.obsidian/plugins/` directory.

The result must be exactly:

```text
<Vault>/.obsidian/plugins/uopt/
├── main.js
├── manifest.json
└── styles.css
```

Reload Obsidian, then enable **Universal Obsidian Plugin Translator** under **Settings → Community plugins**.

### macOS / Linux one-command installer

```bash
curl -fsSL https://raw.githubusercontent.com/NeelAPatel/universal-obsidian-plugin-translator/main/uopt/scripts/install.sh | bash -s -- "/path/to/your/Vault"
```

### Windows PowerShell one-command installer

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/NeelAPatel/universal-obsidian-plugin-translator/main/uopt/scripts/install.ps1'))) -VaultPath 'C:\Path\To\Vault'
```

### From a local clone

```bash
cd uopt
npm run install:vault -- "/path/to/your/Vault"
```

## First use

1. Open **Settings → Universal Obsidian Plugin Translator**.
2. Choose **OpenAI** or **Ollama** and save/test the provider.
3. Click **Scan all plugins**.
4. Review a plugin and select files for preview/approval.
5. Approve new plugin files UOPT is allowed to modify.
6. Click **Translate all** or the plugin-specific **Translate** button.
7. Reload the target plugin or Obsidian if already-loaded UI still shows the old strings.

## Scan behavior

UOPT deliberately avoids treating localization material as untranslated UI when it can identify intent safely. v0.1.6 continues to ignore:

- `README.zh-CN.md`/`README.ja.md`-style localized documentation variants when a canonical sibling such as `README.md` exists;
- non-English locale resources such as `locales/zh-CN.json` when an English sibling such as `locales/en.json` exists;
- Markdown language-selector lines such as `English | 简体中文 | 日本語` or equivalent linked selectors.

A sole non-English locale resource is **not** automatically ignored, because it may be the plugin's only source of user-facing UI strings.

## Translation behavior

UOPT aggressively discovers candidate text but asks the model to modify only human-facing text. Machine-facing constants, identifiers, JSON keys, storage keys, API/protocol values, URLs, paths, regexes, selectors, code logic, and developer-only comments/logs are excluded.

For plugin updates, UOPT preserves translation history and can reuse unchanged translations while translating newly changed content.

## Development

```bash
cd uopt
npm ci
npm test
npm run build
npm run verify
npm run package
```

`uopt/main.js` is generated. Edit `uopt/src/main.js` or files under `uopt/src/lib/`, then rebuild.

## Scope

v0.1.6 targets installed Community Plugins on Obsidian Desktop. It does not translate themes, CSS snippets, core plugins, vault notes, or arbitrary remote text fetched dynamically at runtime.