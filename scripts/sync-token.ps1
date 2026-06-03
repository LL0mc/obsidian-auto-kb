# scripts/sync-token.ps1
# Syncs API token and B站 cookie from config to vault for Tampermonkey runtime
param(
    [string]$VaultPath = "D:\notebooks\Lmc\brew",
    [switch]$UpdateUserJs
)

$rawDir = "$VaultPath\kb\raw\bilibili"
$null = New-Item -ItemType Directory -Path $rawDir -Force

# 1. Sync Obsidian API token
$pluginData = "$VaultPath\.obsidian\plugins\obsidian-local-rest-api\data.json"
if (Test-Path $pluginData) {
    $token = (Get-Content $pluginData -Raw | ConvertFrom-Json).apiKey
    @{ token = $token; updated_at = (Get-Date -Format o) } | ConvertTo-Json | Set-Content "$rawDir\_token.json" -Encoding UTF8
    Write-Host "[OK] API token synced" -ForegroundColor Green
}

# 2. Sync B站 cookie from config.json
$configPath = Resolve-Path "$PSScriptRoot\..\config.json"
if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
    if ($config.bilibili_cookie -match 'SESSDATA=([^;]+)') {
        $sess = $matches[1]
        $jct = if ($config.bilibili_cookie -match 'bili_jct=([^;]+)') { $matches[1] } else { "" }
        $data = @{
            sessdata = $sess
            bili_jct = $jct
            updated_at = (Get-Date -Format o)
        }
        $data | ConvertTo-Json | Set-Content "$rawDir\_bili_cookie.json" -Encoding UTF8
        Write-Host "[OK] B站 cookie synced" -ForegroundColor Green
    }
}

Write-Host "`nDone. Tampermonkey scripts will pick up changes at runtime." -ForegroundColor Cyan
