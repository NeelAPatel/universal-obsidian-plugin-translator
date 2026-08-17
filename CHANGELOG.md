# Changelog

## 0.1.5

- Replaced Ollama JSON-schema translation output with a resilient tab-delimited line protocol while keeping OpenAI Structured Outputs unchanged.
- Valid Ollama candidate translations now survive malformed sibling lines; only unresolved candidates are retried, up to three protocol attempts.
- Added a regression test for the real Canvas Enhance failure shape: 29 candidates with one malformed response row retries only that candidate instead of discarding the other 28.
- Retains recovered Ollama translations as translation memory if a provider-format failure remains, without partially writing the target plugin file. A later **Retry file** call sends only unresolved translation work.
- Adds `// src/...` source-module labels and prefers module-aware packing when it does not increase provider-call count; otherwise it keeps baseline batching while retaining semantic labels in the prompt.
- Ollama requests use deterministic temperature 0 and continue to disable thinking for translation output.

## 0.1.4

- Added structured per-file translation diagnostics with failure category, stage, exact message, provider, model, batch, candidate count, and timestamp.
- Activity error entries now expose expandable diagnostics instead of only a generic validation/provider summary.
- Failed file rows are visibly marked and the Selected File Preview shows the last translation error.
- Added **Copy error** and **Retry file** actions. Retry targets only the selected approved failed file and uses the normal snapshot/validation/hash-safe write path.
- Preserved `lastError` for compatibility while storing structured `lastFailure` diagnostics that clear after a successful translation.

## 0.1.3

- Reworked settings into the approved single-column flow: global actions → 2×2 Summary → Plugin Summary → Plugin Detail → Selected File Preview → Model Settings → Activity.
- Kept one search bar and sortable columns for plugin/file tables while removing per-column filter controls.
- Kept plugin and file tables capped at five visible rows before scrolling.
- Moved file preview into a dedicated always-visible section directly after Plugin Detail.
- Added syntax-highlighted read-only source previews for common plugin file types.
- Added Markdown **Readable / Source** preview modes using Obsidian's native Markdown renderer.
- Preserved independent Markdown Source/Readable scroll positions, with proportional positioning on the first mode switch.
- Hid ignored localization/support files by default with an explicit **Show ignored** control.

## 0.1.2

- Reworked the settings page into a full-width responsive flow: Summary → Plugin Summary → Plugin Detail → Model Settings → Activity.
- Aligned per-plugin Scan/Translate table actions.
- Added selectable read-only file previews in Plugin Detail.
- Added localization-aware scanning to ignore duplicate localized documentation and non-English locale packs when an English sibling already exists.
- Added a canonical root `PROJECT.json` for project title, shorthand, plugin ID, version, repository, and project directory.
- Restructured the repository around a dedicated `uopt/` project directory with root-level GitHub automation and project metadata.

## 0.1.1

### Fixed

- Bundled all UOPT runtime modules into the root `main.js` so Obsidian does not depend on sibling CommonJS source modules at load time.
- Standardized the install payload to `uopt/main.js`, `uopt/manifest.json`, and `uopt/styles.css` only.
- Added a runtime smoke test that explicitly rejects relative `require()` calls to reproduce the v0.1 load failure.
- Added a local one-command vault installer.

### Added

- GitHub Actions CI for tests, bundle verification, and release-payload checks.
- Tag-driven release workflow that publishes `main.js`, `manifest.json`, `styles.css`, and `uopt.zip`.
- macOS/Linux and Windows release installers.
- `versions.json` for Obsidian release compatibility metadata.

## 0.1.0

Initial proof-of-concept implementation. This version used sibling runtime modules and could fail to load when installed directly in Obsidian.
