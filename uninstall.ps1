# Universal Uninstaller for STG Native Tab Groups CSS Fix (userChrome)
# Run remotely from anywhere:
#   irm https://raw.githubusercontent.com/olegius88/stg-native-groups-css-fix/main/uninstall.ps1 | iex

$ErrorActionPreference = "Stop"
$addonId = "stg-native-groups-css@olegius.org"

$profilesRoot = Join-Path $env:APPDATA "Mozilla\Firefox\Profiles"
if (-not (Test-Path $profilesRoot)) {
    Write-Host "[ERROR] Firefox Profiles folder not found: $profilesRoot" -ForegroundColor Red
    exit 1
}

$blockRegex = "(?s)\r?\n?/\* === BEGIN STG-NATIVE-GROUPS-CSS-FIX === \*/.*?/\* === END STG-NATIVE-GROUPS-CSS-FIX === \*/\r?\n?"

$profiles = Get-ChildItem -Path $profilesRoot -Directory
foreach ($prof in $profiles) {
    Write-Host "Cleaning profile: $($prof.Name)" -ForegroundColor Cyan

    $destXpi = Join-Path $prof.FullName "extensions\$addonId.xpi"
    if (Test-Path $destXpi) {
        Remove-Item $destXpi -Force
        Write-Host "  [-] Removed extension: $destXpi" -ForegroundColor Yellow
    }

    $chromeCss = Join-Path $prof.FullName "chrome\userChrome.css"
    if (Test-Path $chromeCss) {
        $raw = Get-Content $chromeCss -Raw -Encoding UTF8
        $cleaned = [regex]::Replace($raw, $blockRegex, "")
        if ($cleaned -ne $raw) {
            Set-Content -Path $chromeCss -Value $cleaned -Encoding UTF8
            Write-Host "  [-] Removed CSS block from $chromeCss" -ForegroundColor Yellow
        }
    }
}

Write-Host "`nUninstall complete! Restart Firefox to apply changes." -ForegroundColor Green
