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
        try {
            Remove-Item $oldXpi -Force -ErrorAction Stop
            Write-Host "  [-] Removed old API version ($oldApiAddonId.xpi)" -ForegroundColor Yellow
        } catch {
            Write-Host "  [!] Old API XPI is in use by running Firefox; close Firefox and re-run if needed" -ForegroundColor Yellow
        }
    }

    # Cleanup leftovers from previous installer versions (possibly broken builds)
    $leftovers = @(
        (Join-Path $extDir "staged\$addonId.xpi"),
        (Join-Path $extDir "$addonId.xpi.bak")
    )
    foreach ($lf in $leftovers) {
        if (Test-Path $lf) {
            try {
                Remove-Item $lf -Force -ErrorAction Stop
                Write-Host "  [-] Removed leftover: $lf" -ForegroundColor Yellow
            } catch {}
        }
    }

    $destXpi = Join-Path $extDir "$addonId.xpi"
    try {
        Copy-Item -Path $xpiSource -Destination $destXpi -Force -ErrorAction Stop
        Write-Host "  [+] Installed extension: $destXpi" -ForegroundColor Green
    } catch {
        # File is locked in memory by running Firefox - rename old file and copy new one
        $bakXpi = Join-Path $extDir "$addonId.xpi.bak"
        try {
            Remove-Item $bakXpi -Force -ErrorAction SilentlyContinue
            Move-Item -Path $destXpi -Destination $bakXpi -Force -ErrorAction Stop
            Copy-Item -Path $xpiSource -Destination $destXpi -Force -ErrorAction Stop
            Write-Host "  [+] Updated running extension via rename-swap: $destXpi" -ForegroundColor Green
        } catch {
            Write-Host "  [!] Could not replace locked XPI: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    # 3. Clean and update chrome/userChrome.css if managed block exists (purges old :first-of-type rules)
    $chromeDir = Join-Path $prof.FullName "chrome"
    $userChromePath = Join-Path $chromeDir "userChrome.css"
    if (Test-Path $userChromePath) {
        $ucContent = Get-Content $userChromePath -Raw -Encoding UTF8
        $beginMarker = "/* === BEGIN STG-NATIVE-GROUPS-CSS-FIX === */"
        $endMarker = "/* === END STG-NATIVE-GROUPS-CSS-FIX === */"
        $startIdx = $ucContent.IndexOf($beginMarker)
        $endIdx = $ucContent.IndexOf($endMarker)
        if ($startIdx -ne -1 -and $endIdx -ne -1 -and $endIdx -gt $startIdx) {
            $before = $ucContent.Substring(0, $startIdx).TrimEnd()
            $after = $ucContent.Substring($endIdx + $endMarker.Length).TrimStart()
            $newBlock = @"
$beginMarker
/* Полностью скрывать нативную группу Firefox (плашку, счетчик, линию), когда все вкладки группы скрыты через Simple Tab Groups */
#tabbrowser-tabs tab-group:not(:has(tab.tabbrowser-tab:not([hidden]))) {
    display: none !important;
}

/* Закрепленные вручную вкладки внутри свернутых групп (компактный вид: фавиконка) */
#tabbrowser-tabs tab-group[collapsed] > tab.tabbrowser-tab[group-pinned="true"]:not([hidden]) {
    display: flex !important;
    visibility: visible !important;
}
#tabbrowser-tabs tab-group[collapsed] > tab.tabbrowser-tab[group-pinned="true"]:not([hidden]):not([selected]) {
    max-width: 44px !important;
    min-width: 40px !important;
    padding-inline: 4px !important;
}
#tabbrowser-tabs tab-group[collapsed] > tab.tabbrowser-tab[group-pinned="true"]:not([hidden]):not([selected]) .tab-label-container {
    display: none !important;
}
#tabbrowser-tabs tab.tabbrowser-tab[group-pinned="true"]:not([hidden]) .tab-icon-image {
    outline: 2px solid #10b981 !important;
    outline-offset: 1px !important;
    border-radius: 4px !important;
}
$endMarker
"@
            $finalUc = if ($before -and $after) { "$before`r`n`r`n$newBlock`r`n`r`n$after" } elseif ($before) { "$before`r`n`r`n$newBlock" } elseif ($after) { "$newBlock`r`n`r`n$after" } else { $newBlock }
            Set-Content -Path $userChromePath -Value $finalUc -Encoding UTF8
            Write-Host "  [+] Updated userChrome.css with clean rules (purged legacy rules)" -ForegroundColor Green
        }
    }
}

Write-Host "`nDone! Restart Firefox to activate the extension and write rules to userChrome.css." -ForegroundColor Green
