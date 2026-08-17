#!/usr/bin/env bash
set -euo pipefail

REPO="NeelAPatel/universal-obsidian-plugin-translator"
PLUGIN_ID="uopt"

if [[ $# -lt 1 ]]; then
  echo "Usage: install.sh /path/to/ObsidianVault [config-dir]" >&2
  echo "Example: install.sh \"$HOME/Documents/My Vault\"" >&2
  exit 2
fi

VAULT_PATH="${1%/}"
CONFIG_DIR="${2:-.obsidian}"
DEST="$VAULT_PATH/$CONFIG_DIR/plugins/$PLUGIN_ID"
BASE="https://github.com/$REPO/releases/latest/download"

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
mkdir -p "$DEST"

for file in main.js manifest.json styles.css; do
  echo "Installing $file from the latest release..."
  curl -fsSL "$BASE/$file" -o "$DEST/$file"
done

echo "Installed UOPT latest release to: $DEST"
echo "Reload Obsidian, then enable Universal Obsidian Plugin Translator in Community plugins."
