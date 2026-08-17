# UOPT v0.1.2 Installation

## Recommended manual install

1. Download `uopt.zip` from the latest release.
2. Extract it into your vault's plugin directory, normally `<Vault>/.obsidian/plugins/`.
3. Confirm the final layout is exactly:

   ```text
   <Vault>/.obsidian/plugins/uopt/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

4. Reload Obsidian.
5. Enable **Universal Obsidian Plugin Translator** under **Settings → Community plugins**.

Do **not** copy the repository's `uopt/` source directory wholesale into `.obsidian/plugins/`. The installed runtime is only the three release files above.

## macOS / Linux one command

```bash
curl -fsSL https://raw.githubusercontent.com/NeelAPatel/universal-obsidian-plugin-translator/main/uopt/scripts/install.sh | bash -s -- "/path/to/your/Vault"
```

## Windows PowerShell one command

```powershell
& ([scriptblock]::Create((irm 'https://raw.githubusercontent.com/NeelAPatel/universal-obsidian-plugin-translator/main/uopt/scripts/install.ps1'))) -VaultPath 'C:\Path\To\Vault'
```

## Local source checkout

```bash
cd uopt
npm run install:vault -- "/path/to/your/Vault"
```
