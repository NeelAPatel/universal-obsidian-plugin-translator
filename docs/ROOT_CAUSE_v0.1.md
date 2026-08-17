# v0.1 load failure root cause

## Symptom

Obsidian discovered the local UOPT plugin but reported that it failed to load.

## Root cause

The v0.1 repository's `main.js` required sibling source modules such as:

```js
require('./lib/service')
require('./lib/providers')
require('./lib/settings-tab')
```

That is normal for a Node project source tree, but it is not the release shape expected by Obsidian community plugins. Obsidian's published plugin API guidance requires dependencies to be bundled into `main.js`, and its sample plugin documents a manual install containing `main.js`, `manifest.json`, and `styles.css` in the plugin-ID directory.

The source repository was also easy to mistake for the runtime payload because it contained tests/docs/source directly beside `main.js`.

## v0.1.1 correction

- Source moved under `src/`.
- `scripts/build.cjs` bundles all internal modules into one generated root `main.js`.
- Release packaging emits exactly three runtime files under `dist/uopt/`.
- An automated VM smoke test loads the generated bundle with relative runtime `require()` calls forbidden.
- Release installers always target `.obsidian/plugins/uopt/`.
