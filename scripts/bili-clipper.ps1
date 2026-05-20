param(
    [Parameter(Mandatory)] [string]$Url,
    [string]$Vault = "brew",
    [string]$Folder = "Bilibili",
    [string]$ObsidianCli = "D:\Coding\Obsidian\Obsidian\Obsidian.com"
)

. "$PSScriptRoot\bili-api.ps1"
$ProjectRoot = Resolve-Path "$PSScriptRoot\.."
$ConfigPath = "$ProjectRoot\config.json"

if (Test-Path $ConfigPath) {
    $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    $Cookie = $config.bilibili_cookie
    if (-not $Cookie) { $Cookie = $env:BILI_COOKIE }
    if (-not $Vault) { $Vault = $config.default_vault }
    if (-not $Folder) { $Folder = $config.default_folder }
} else {
    $Cookie = $env:BILI_COOKIE
}

function New-NoteContent {
    param($VideoInfo, $SummaryText, $ContentSource, $BvId)
    $title = $VideoInfo.title
    $desc = $VideoInfo.desc
    $owner = $VideoInfo.owner.name
    $mid = $VideoInfo.owner.mid
    $duration = $VideoInfo.duration
    $tname = $VideoInfo.tname
    $viewCount = $VideoInfo.stat.view
    $likeCount = $VideoInfo.stat.like
    $pubdate = if ($VideoInfo.pubdate) {
        (Get-Date -Year 1970 -Month 1 -Day 1).AddSeconds($VideoInfo.pubdate).ToString("yyyy-MM-dd")
    } else { "unknown" }
    $durMin = [math]::Floor($duration / 60)
    $durSec = $duration % 60
    $today = (Get-Date).ToString("yyyy-MM-dd")

    $lines = @()
    $lines += "---"
    $lines += "title: $title"
    $lines += "source: bilibili"
    $lines += "url: https://www.bilibili.com/video/$BvId"
    $lines += "bvid: $BvId"
    $lines += "uploader: $owner"
    $lines += "uploader_id: $mid"
    $lines += "category: $tname"
    $lines += "duration: ${durMin}m${durSec}s"
    $lines += "date: $today"
    $lines += "views: $viewCount"
    $lines += "likes: $likeCount"
    $lines += "content_source: $ContentSource"
    $lines += "status: inbox"
    $lines += "tags:"
    $lines += "  - bilibili"
    $lines += "  - clip"
    $lines += "---"
    $lines += ""
    $lines += "# $title"
    $lines += ""
    $lines += "> Uploader: **[$owner](https://space.bilibili.com/$mid)** | Category: $tname | Duration: ${durMin}m${durSec}s | Published: $pubdate"
    $lines += ">"
    $lines += "> [Views: $viewCount](https://www.bilibili.com/video/$BvId) | Likes: $likeCount"
    $lines += ""
    $lines += "---"

    if ($desc) {
        $lines += ""
        $lines += "## Description"
        $lines += ""
        $lines += $desc
        $lines += ""
        $lines += "---"
    }

    if ($SummaryText) {
        $lines += ""
        $lines += $SummaryText
        $lines += ""
        $lines += "---"
    }

    $lines += ""
    $lines += "## Notes"
    $lines += ""
    $lines += ""
    $lines += "---"
    $lines += ""
    $lines += "## Links"
    $lines += ""
    $lines += "- [Source Video](https://www.bilibili.com/video/$BvId)"
    $lines += "- [Uploader Homepage](https://space.bilibili.com/$mid)"

    return $lines -join "`n"
}

Write-Host ""
Write-Host "=== Bilibili -> Obsidian Clipper ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] Parsing video ID..." -ForegroundColor Cyan
$bvid = Get-BvIdFromUrl -Url $Url
if (-not $bvid) {
    Write-Error "Cannot parse video ID from URL: $Url"
    exit 1
}
Write-Host "  BVID: $bvid"

Write-Host "[2/4] Fetching video info..." -ForegroundColor Cyan
$videoInfo = Get-VideoInfo -BvId $bvid
if (-not $videoInfo) {
    Write-Error "Cannot fetch video info"
    exit 1
}
Write-Host "  Title: $($videoInfo.title)"
Write-Host "  Uploader: $($videoInfo.owner.name)"
Write-Host "  Category: $($videoInfo.tname)"

Write-Host "[3/4] Getting content understanding..." -ForegroundColor Cyan
$summaryText = $null
$contentSource = "metadata_only"

if ($Cookie) {
    Write-Host "  Layer 1 -> Trying AI subtitle..." -ForegroundColor DarkCyan
    $subtitleData = Get-VideoSubtitle -Aid $videoInfo.aid -Cid $videoInfo.cid -Cookie $Cookie
    if ($subtitleData -and $subtitleData.segments -and $subtitleData.segments.Count -gt 0) {
        $aiSummary = Get-VideoAiSummary -BvId $bvid -Cid $videoInfo.cid -UpMid $videoInfo.owner.mid -Cookie $Cookie
        $subtitleText = Parse-SubtitleToText -SubtitleData $subtitleData
        $aiSummaryText = if ($aiSummary) { Format-AiSummaryToText -AiData $aiSummary } else { $null }
        $parts = @()
        if ($aiSummaryText) { $parts += $aiSummaryText }
        if ($subtitleText) { $parts += $subtitleText }
        $summaryText = $parts -join "`n`n"
        $contentSource = if ($aiSummaryText) { "subtitle+summary" } else { "subtitle_only" }
        Write-Host "  + Subtitle OK ($($subtitleData.segments.Count) segments)" -ForegroundColor Green
    } else {
        Write-Host "  - No subtitle available, trying AI summary..." -ForegroundColor Yellow
        $aiData = Get-VideoAiSummary -BvId $bvid -Cid $videoInfo.cid -UpMid $videoInfo.owner.mid -Cookie $Cookie
        if ($aiData -and $aiData.model_result -and $aiData.model_result.result_type -gt 0) {
            $summaryText = Format-AiSummaryToText -AiData $aiData
            $contentSource = "ai_summary"
            $summaryLines = ($summaryText -split "`n").Count
            Write-Host "  + AI summary OK ($summaryLines lines)" -ForegroundColor Green
        } else {
            Write-Host "  - AI summary not available" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "  - No cookie configured, skip subtitle and AI summary" -ForegroundColor Yellow
}

if (-not $summaryText) {
    Write-Host "  Layer 3 -> Trying danmaku analysis..." -ForegroundColor DarkCyan
    $danmakuNodes = Get-Danmaku -Cid $videoInfo.cid
    if ($danmakuNodes -and $danmakuNodes.Count -gt 0) {
        $summaryText = Parse-DanmakuToText -DanmakuNodes $danmakuNodes
        $contentSource = "danmaku"
        Write-Host "  + Danmaku OK ($($danmakuNodes.Count) items)" -ForegroundColor Green
    } else {
        Write-Host "  - No danmaku data" -ForegroundColor Yellow
    }
}

Write-Host "[4/4] Generating note and writing..." -ForegroundColor Cyan
$safeTitle = $videoInfo.title -replace '[\\/:*?"<>|]', '_'
if ($safeTitle.Length -gt 60) { $safeTitle = $safeTitle.Substring(0, 57) + "..." }
$filename = "$safeTitle.md"

$content = New-NoteContent -VideoInfo $videoInfo -SummaryText $summaryText -ContentSource $contentSource -BvId $bvid

function Write-NoteToVault {
    param([string]$VaultName, [string]$FolderPath, [string]$FileName, [string]$FileContent)
    $vaultPath = $null
    if ($config -and $config.vaults.$VaultName) {
        $vaultPath = $config.vaults.$VaultName
    } else {
        $knownVaults = @{ brew = "D:\notebooks\Lmc\brew"; escalator = "D:\notebooks\Work\escalator" }
        $vaultPath = $knownVaults[$VaultName]
    }
    if ($vaultPath -and (Test-Path $vaultPath)) {
        $targetDir = "$vaultPath\$FolderPath"
        if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }
        $targetFile = "$targetDir\$FileName"
        Set-Content -Path $targetFile -Value $FileContent -Encoding UTF8
        return $targetFile
    }
    return $null
}

$finalPath = Write-NoteToVault -VaultName $Vault -FolderPath $Folder -FileName $filename -FileContent $content

if ($finalPath) {
    Write-Host ""
    Write-Host "  + Note created!" -ForegroundColor Green
    Write-Host "  Vault: $Vault"
    Write-Host "  Path: $Folder/$filename"
    Write-Host "  Source: $contentSource"
    return @{ success = $true; vault = $Vault; path = "$Folder/$filename" }
} else {
    Write-Host "  - Cannot find vault path, saving to output/" -ForegroundColor Yellow
    $outDir = "$ProjectRoot\output"
    if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
    $outPath = "$outDir\$filename"
    Set-Content -Path $outPath -Value $content -Encoding UTF8
    Write-Host ""
    Write-Host "  + Note saved to: $outPath" -ForegroundColor Green
    Write-Host "  Source: $contentSource"
    return @{ success = $false; path = $outPath }
}
