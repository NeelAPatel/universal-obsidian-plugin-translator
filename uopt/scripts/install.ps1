param(
  [Parameter(Mandatory=$true)][string]$VaultPath,
  [string]$ConfigDir = ".obsidian"
)
$ErrorActionPreference = "Stop"
$Repo = "NeelAPatel/universal-obsidian-plugin-translator"
$PluginId = "uopt"
$Dest = Join-Path (Join-Path (Join-Path $VaultPath $ConfigDir) "plugins") $PluginId
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
foreach ($File in @("main.js", "manifest.json", "styles.css")) {
  $Url = "https://github.com/$Repo/releases/latest/download/$File"
  Write-Host "Installing $File from the latest release..."
  Invoke-WebRequest -UseBasicParsing $Url -OutFile (Join-Path $Dest $File)
}
Write-Host "Installed UOPT latest release to: $Dest"
Write-Host "Reload Obsidian, then enable Universal Obsidian Plugin Translator in Community plugins."
