# Changelog

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
