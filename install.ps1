# Universal Local & Remote Installer for STG Native Tab Groups CSS Fix (userChrome)
# Run remotely from anywhere:
#   irm https://raw.githubusercontent.com/olegius88/stg-native-groups-css-fix/main/install.ps1 | iex

$ErrorActionPreference = "Stop"
$addonId = "stg-native-groups-css@olegius.org"
$oldApiAddonId = "stg-native-groups-fix@olegius.org"
$remoteXpiUrl = "https://raw.githubusercontent.com/olegius88/stg-native-groups-css-fix/main/stg-native-groups-css.xpi"

$scriptDir = $null
if ($MyInvocation.MyCommand.Path) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$xpiSource = $null
if ($scriptDir) {
    $candidate = Join-Path $scriptDir "stg-native-groups-css.xpi"
    if (Test-Path $candidate) {
        $xpiSource = $candidate
    }
}

if (-not $xpiSource) {
    $xpiSource = Join-Path $env:TEMP "stg-native-groups-css.xpi"
    Write-Host "Downloading latest stg-native-groups-css.xpi from GitHub..." -ForegroundColor Cyan
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $remoteXpiUrl -OutFile $xpiSource -UseBasicParsing
    Write-Host "  [+] Downloaded to $xpiSource" -ForegroundColor Green
}

$profilesRoot = Join-Path $env:APPDATA "Mozilla\Firefox\Profiles"
if (-not (Test-Path $profilesRoot)) {
    Write-Host "[ERROR] Firefox Profiles folder not found: $profilesRoot" -ForegroundColor Red
    exit 1
}

$profiles = Get-ChildItem -Path $profilesRoot -Directory
foreach ($prof in $profiles) {
    Write-Host "Processing profile: $($prof.Name)" -ForegroundColor Cyan

    # 1. Configure user.js for Experiment API and userChrome.css support
    $userJsPath = Join-Path $prof.FullName "user.js"
    $userJsContent = ""
    if (Test-Path $userJsPath) {
        $userJsContent = Get-Content $userJsPath -Raw -Encoding UTF8
    }

    $requiredPrefs = @(
        'user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);',
        'user_pref("xpinstall.signatures.required", false);',
        'user_pref("extensions.experiments.enabled", true);',
        'user_pref("extensions.autoDisableScopes", 0);'
    )

    $modified = $false
    foreach ($prefLine in $requiredPrefs) {
        $prefName = ($prefLine -split '"')[1]
        if ($userJsContent -notmatch [regex]::Escape($prefName)) {
            $userJsContent = $userJsContent.TrimEnd() + "`r`n" + $prefLine + "`r`n"
            $modified = $true
        }
    }

    if ($modified) {
        Set-Content -Path $userJsPath -Value $userJsContent.TrimStart() -Encoding UTF8
        Write-Host "  [+] Updated user.js (enabled experiments & stylesheets)" -ForegroundColor Green
    }

    # 2. Copy XPI to profile extensions directory
    $extDir = Join-Path $prof.FullName "extensions"
    if (-not (Test-Path $extDir)) {
        New-Item -ItemType Directory -Path $extDir -Force | Out-Null
    }

    $oldXpi = Join-Path $extDir "$oldApiAddonId.xpi"
    if (Test-Path $oldXpi) {
        Remove-Item $oldXpi -Force
        Write-Host "  [-] Removed old API version ($oldApiAddonId.xpi)" -ForegroundColor Yellow
    }

    $destXpi = Join-Path $extDir "$addonId.xpi"
    Copy-Item -Path $xpiSource -Destination $destXpi -Force
    Write-Host "  [+] Installed extension: $destXpi" -ForegroundColor Green
}

Write-Host "`nDone! Restart Firefox to activate the extension and write rules to userChrome.css." -ForegroundColor Green
