param(
    [Parameter(Mandatory)] [string]$Url,
    [string]$Vault = "brew",
    [string]$KbDir = ""  # e.g. D:\notebooks\Lmc\brew\kb
)

. "$PSScriptRoot\bili-api.ps1"
$ProjectRoot = Resolve-Path "$PSScriptRoot\.."
$ConfigPath = "$ProjectRoot\config.json"

$config = $null
if (Test-Path $ConfigPath) {
    $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
}
$Cookie = if ($config) { $config.bilibili_cookie } else { $env:BILI_COOKIE }
if (-not $Vault -and $config) { $Vault = $config.default_vault }
if (-not $KbDir -and $config) { $KbDir = $config.kb_dir }

Write-Host ""
Write-Host "=== Bilibili Raw Data Fetcher ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] Parsing video ID..." -ForegroundColor Cyan
$bvid = Get-BvIdFromUrl -Url $Url
if (-not $bvid) { Write-Error "Cannot parse video ID"; exit 1 }
Write-Host "  BVID: $bvid"

Write-Host "[2/4] Fetching video info..." -ForegroundColor Cyan
$videoInfo = Get-VideoInfo -BvId $bvid
if (-not $videoInfo) { Write-Error "Cannot fetch video info"; exit 1 }
Write-Host "  Title: $($videoInfo.title)"
Write-Host "  Uploader: $($videoInfo.owner.name)"

Write-Host "[3/4] Fetching all content layers..." -ForegroundColor Cyan

# Build raw data package
$rawData = @{
    bvid       = $bvid
    aid        = $videoInfo.aid
    cid        = $videoInfo.cid
    video      = @{
        title     = $videoInfo.title
        desc      = $videoInfo.desc
        uploader  = @{ name = $videoInfo.owner.name; mid = $videoInfo.owner.mid }
        duration  = $videoInfo.duration
        category  = $videoInfo.tname
        pubdate   = $videoInfo.pubdate
        stats     = @{ views = $videoInfo.stat.view; likes = $videoInfo.stat.like }
        tags      = if ($videoInfo.tags) { $videoInfo.tags } else { @() }
    }
    subtitle   = $null
    ai_summary = $null
    comments   = $null
    fetched_at = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
}

# Layer 1: Subtitle
if ($Cookie) {
    Write-Host "  -> Fetching subtitle..." -ForegroundColor DarkCyan
    $subtitleData = Get-VideoSubtitle -Aid $videoInfo.aid -Cid $videoInfo.cid -Cookie $Cookie
    if ($subtitleData -and $subtitleData.segments) {
        $rawData.subtitle = @{
            segments  = $subtitleData.segments.Count
            lang      = $subtitleData.lang
            raw_text  = Get-SubtitleRawText -SubtitleData $subtitleData
        }
        Write-Host "    + $($subtitleData.segments.Count) segments" -ForegroundColor Green
    } else {
        Write-Host "    - No subtitle" -ForegroundColor Yellow
    }
}

# Layer 2: AI Summary
if ($Cookie) {
    Write-Host "  -> Fetching AI summary..." -ForegroundColor DarkCyan
    $aiSummary = Get-VideoAiSummary -BvId $bvid -Cid $videoInfo.cid -UpMid $videoInfo.owner.mid -Cookie $Cookie
    if ($aiSummary -and $aiSummary.model_result) {
        $rawData.ai_summary = @{
            summary   = $aiSummary.model_result.summary
            outline   = $aiSummary.model_result.outline
            subtitle  = $aiSummary.model_result.subtitle
        }
        Write-Host "    + OK" -ForegroundColor Green
    } else {
        Write-Host "    - Not available" -ForegroundColor Yellow
    }
}

# Bonus: Comments
if ($Cookie) {
    Write-Host "  -> Fetching top comments..." -ForegroundColor DarkCyan
    $comments = Get-VideoComments -Aid $videoInfo.aid -Cookie $Cookie -Count 8 -Sort "2"
    if ($comments -and $comments.comments) {
        $rawData.comments = @{
            total    = $comments.count
            top_hot  = $comments.comments
        }
        Write-Host "    + $($comments.count) total, $($comments.comments.Count) hot fetched" -ForegroundColor Green
    } else {
        Write-Host "    - No comments" -ForegroundColor Yellow
    }
}

Write-Host "[4/4] Saving raw data..." -ForegroundColor Cyan
$rawDir = "$KbDir\raw\bilibili"
if (-not (Test-Path $rawDir)) { New-Item -ItemType Directory -Path $rawDir -Force | Out-Null }
$rawPath = "$rawDir\$bvid.json"
$rawData | ConvertTo-Json -Depth 10 | Set-Content -Path $rawPath -Encoding UTF8

Write-Host ""
Write-Host "  + Raw data saved: $rawPath" -ForegroundColor Green
Write-Host "  + Ready for agent processing" -ForegroundColor Green
Write-Host ""

return @{
    success  = $true
    bvid     = $bvid
    raw_path = $rawPath
    vault    = $Vault
    kb_dir   = $KbDir
}
