# scripts/bili-fetch.ps1
# OpenCode entry point: fetch B站 video data, save to vault, ready for @clipper
param(
    [Parameter(Mandatory)] [string]$Url,
    [string]$VaultPath = "D:\notebooks\Lmc\brew"
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\bili-api.ps1"
$ConfigPath = Resolve-Path "$PSScriptRoot\..\config.json"
$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$cookie = $config.bilibili_cookie

$bvid = Get-BvIdFromUrl -Url $Url
if (-not $bvid) { Write-Error "Cannot parse BVID from URL"; exit 1 }

Write-Host "[1/4] Video info..." -ForegroundColor Cyan
$info = Get-VideoInfo -BvId $bvid
$v = $info
Write-Host "  Title: $($v.title)" -ForegroundColor Green

$raw = @{
    bvid = $bvid; aid = $v.aid; cid = $v.cid
    title = $v.title; desc = $v.desc
    owner = @{ mid = $v.owner.mid; name = $v.owner.name }
    stat = @{ view = $v.stat.view; like = $v.stat.like; coin = $v.stat.coin; favorite = $v.stat.favorite; reply = $v.stat.reply; danmaku = $v.stat.danmaku }
    pubdate = $v.pubdate; duration = $v.duration; pages = $v.pages.Count
    subtitle = $null; ai_summary = $null; comments = $null
    fetched_at = (Get-Date -Format o)
}

Write-Host "[2/4] Subtitle..." -ForegroundColor Cyan
try {
    $subResp = Invoke-BiliApi -Uri "https://api.bilibili.com/x/player/v2?aid=$($v.aid)&cid=$($v.cid)" -Cookie $cookie
    $candidates = $subResp.data.subtitle.subtitles
    Write-Host "  candidates: $($candidates.Count)" -ForegroundColor Gray
    foreach ($t in $candidates) {
        if ($t.subtitle_url) {
            $subUrl = $t.subtitle_url -replace '^//', 'https://'
            try {
                $subJson = Invoke-BiliHttp -Uri $subUrl | ConvertFrom-Json
                if ($subJson.body) {
                    $raw.subtitle = @{
                        segments = $subJson.body.Count; lang = $t.lan_doc
                        list = $subJson.body | ForEach-Object { @{ from = $_.from; to = $_.to; text = $_.content } }
                    }
                    Write-Host "  + $($subJson.body.Count) segments ($($t.lan_doc))" -ForegroundColor Green
                    break
                }
            } catch { Write-Host "  lang $($t.lan_doc): $($_.Exception.Message)" -ForegroundColor Gray }
        }
    }
} catch { Write-Host "  - Subtitle ($($_.Exception.Message))" -ForegroundColor Yellow }

Write-Host "[3/4] AI Summary..." -ForegroundColor Cyan
try {
    $keys = Get-WbiKeys -Cookie $cookie
    $aiSigned = Get-WbiSignedParams -Params @{bvid=$bvid; cid=[string]$v.cid; up_mid=[string]$v.owner.mid} -ImgKey $keys.img_key -SubKey $keys.sub_key
    $aiResp = Invoke-BiliApi -Uri "https://api.bilibili.com/x/web-interface/view/conclusion/get?bvid=$bvid&cid=$($v.cid)&up_mid=$($v.owner.mid)&wts=$($aiSigned.wts)&w_rid=$($aiSigned.w_rid)" -Cookie $cookie
    if ($aiResp.code -eq 0 -and $aiResp.data.model_result) {
        $raw.ai_summary = $aiResp.data.model_result
        Write-Host "  + OK" -ForegroundColor Green
    }
} catch { Write-Host "  - AI Summary unavailable" -ForegroundColor Yellow }

Write-Host "[4/4] Comments..." -ForegroundColor Cyan
try {
    $cmtResp = Invoke-BiliApi -Uri "https://api.bilibili.com/x/v2/reply/main?type=1&oid=$($v.aid)&pn=1&ps=8&mode=3" -Cookie $cookie
    if ($cmtResp.code -eq 0 -and $cmtResp.data.replies) {
        $raw.comments = @{ total = $cmtResp.data.cursor.all_count; top_hot = $cmtResp.data.replies }
        Write-Host "  + $($cmtResp.data.replies.Count) hot replies" -ForegroundColor Green
    }
} catch { Write-Host "  - Comments unavailable" -ForegroundColor Yellow }

# Build markdown
$lines = @()
$lines += '---'
$lines += "bvid: $bvid"
$lines += "aid: $($v.aid)"
$lines += "cid: $($v.cid)"
$lines += "title: $($v.title)"
$lines += "owner: $($v.owner.name)"
$lines += "duration: $($v.duration)"
$lines += "pubdate: $($v.pubdate)"
$lines += "pages: $($v.pages.Count)"
$lines += "fetched_at: $($raw.fetched_at)"
$lines += "views: $($v.stat.view) | likes: $($v.stat.like) | coins: $($v.stat.coin)"
if ($raw.subtitle) { $lines += "subtitle_segments: $($raw.subtitle.segments)" }
if ($raw.comments) { $lines += "comments_total: $($raw.comments.total)" }
if ($raw.ai_summary) { $lines += "has_ai_summary: true" }
$lines += '---'
$lines += ''
$lines += "# $($v.title)"
$lines += ''
if ($v.desc) {
    $lines += "## 简介"
    $lines += $v.desc
    $lines += ''
}
if ($raw.subtitle.list) {
    $lines += "## 字幕 ($($raw.subtitle.lang), $($raw.subtitle.segments) 条)"
    $lines += ''
    foreach ($seg in $raw.subtitle.list) {
        $m = [Math]::Floor($seg.from / 60)
        $s = "{0:00}" -f $([int]($seg.from % 60))
        $lines += "$($m):$($s) $($seg.text)"
    }
    $lines += ''
}
if ($raw.ai_summary.summary) {
    $lines += "## AI 摘要"
    $lines += $raw.ai_summary.summary
    $lines += ''
    if ($raw.ai_summary.outline.Count) {
        $lines += '### 大纲'
        foreach ($o in $raw.ai_summary.outline) {
            $lines += "- $($o.title)"
        }
        $lines += ''
    }
}
if ($raw.comments.top_hot.Count) {
    $lines += "## 热门评论"
    foreach ($c in $raw.comments.top_hot) {
        $lines += "- **$($c.member.uname)**: $($c.content.message)"
    }
    $lines += ''
}
$lines += '---'
$lines += "_抓取于 $($raw.fetched_at)_"

$md = $lines -join "`r`n"
$safeTitle = $v.title -replace '[<>:"/\\|?*]', '' -replace '\s+', ' '
if ($safeTitle.Length -gt 50) { $safeTitle = $safeTitle.Substring(0, 50) }
$safeTitle = $safeTitle.Trim()
$fname = "$safeTitle`_$bvid"
$outPath = "$VaultPath\kb\raw\bilibili\$fname.md"
$null = New-Item -ItemType Directory -Path (Split-Path $outPath -Parent) -Force
$md | Out-File -FilePath $outPath -Encoding UTF8
Write-Host "`n=== Saved: $fname.md ===" -ForegroundColor Green
