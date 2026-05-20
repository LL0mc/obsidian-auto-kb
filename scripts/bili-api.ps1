. "$PSScriptRoot\wbi-sign.ps1"

$script:UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

function Invoke-BiliHttp {
    param([string]$Uri, [string]$Cookie = "")
    $req = [System.Net.WebRequest]::CreateHttp($Uri)
    $req.Method = "GET"
    $req.UserAgent = $script:UserAgent
    $req.Referer = "https://www.bilibili.com/"
    $req.Timeout = 15000
    if ($Cookie) {
        $req.Headers.Add("Cookie", $Cookie)
    }
    $resp = $req.GetResponse()
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    $body = $reader.ReadToEnd()
    $reader.Close()
    return $body
}

function Invoke-BiliApi {
    param([string]$Uri, [string]$Cookie = "")
    $body = Invoke-BiliHttp -Uri $Uri -Cookie $Cookie
    return $body | ConvertFrom-Json
}

function Get-BvIdFromUrl {
    param([string]$Url)
    if ($Url -match 'BV[a-zA-Z0-9]{10,}') {
        return $Matches[0]
    }
    if ($Url -match 'av(\d+)') {
        return "av$($Matches[1])"
    }
    return $null
}

function Get-VideoInfo {
    param([string]$BvId)
    if ($BvId -match '^BV') {
        $uri = "https://api.bilibili.com/x/web-interface/view?bvid=$BvId"
    } else {
        $uri = "https://api.bilibili.com/x/web-interface/view?aid=$($BvId -replace '^av','')"
    }
    $resp = Invoke-BiliApi -Uri $uri
    if ($resp.code -ne 0) {
        return $null
    }
    return $resp.data
}

function Get-VideoAiSummary {
    param(
        [Parameter(Mandatory)] [string]$BvId,
        [Parameter(Mandatory)] [string]$Cid,
        [Parameter(Mandatory)] [string]$UpMid,
        [string]$Cookie = ""
    )
    $keys = Get-WbiKeys -Cookie $Cookie
    if (-not $keys) {
        return $null
    }
    $params = @{
        bvid      = $BvId
        cid       = $Cid
        up_mid    = $UpMid
    }
    $signed = Get-WbiSignedParams -Params $params -ImgKey $keys.img_key -SubKey $keys.sub_key
    $queryString = "bvid=$BvId&cid=$Cid&up_mid=$UpMid&wts=$($signed.wts)&w_rid=$($signed.w_rid)"
    $uri = "https://api.bilibili.com/x/web-interface/view/conclusion/get?$queryString"
    $resp = Invoke-BiliApi -Uri $uri -Cookie $Cookie
    if ($resp.code -ne 0) {
        return $null
    }
    return $resp.data
}

function Get-WbiKeys {
    param([string]$Cookie = "")
    try {
        $body = Invoke-BiliHttp -Uri "https://api.bilibili.com/x/web-interface/nav" -Cookie $Cookie
        $json = $body | ConvertFrom-Json
        if (-not $json.data.wbi_img) {
            return $null
        }
        $imgKey = ($json.data.wbi_img.img_url -split '/')[-1] -replace '\.png$',''
        $subKey = ($json.data.wbi_img.sub_url -split '/')[-1] -replace '\.png$',''
        return @{ img_key = $imgKey; sub_key = $subKey }
    } catch {
        return $null
    }
}

function Get-Danmaku {
    param([string]$Cid)
    $uri = "https://comment.bilibili.com/$Cid.xml"
    try {
        $req = [System.Net.WebRequest]::CreateHttp($uri)
        $req.Method = "GET"
        $req.UserAgent = $script:UserAgent
        $req.Referer = "https://www.bilibili.com/"
        $req.Timeout = 15000
        $resp = $req.GetResponse()
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $xmlText = $reader.ReadToEnd()
        $reader.Close()
        $xml = [xml]$xmlText
        return $xml.i.d
    } catch {
        return $null
    }
}

function Parse-DanmakuToText {
    param($DanmakuNodes)
    if (-not $DanmakuNodes) { return $null }
    $lines = @()
    foreach ($d in $DanmakuNodes) {
        try {
            $p = $d.p -split ','
            $time = [int][math]::Floor([double]$p[0])
            $min = [int][math]::Floor($time / 60)
            $sec = [int]($time % 60)
            $mm = if ($min -lt 10) { "0$min" } else { "$min" }
            $ss = if ($sec -lt 10) { "0$sec" } else { "$sec" }
            $text = "$($d.'#text')"
            $lines += "[$mm`:$ss] $text"
        } catch {
            continue
        }
    }
    return $lines -join "`n"
}

function Get-VideoSubtitle {
    param(
        [Parameter(Mandatory)] [string]$Aid,
        [Parameter(Mandatory)] [string]$Cid,
        [string]$Cookie = "",
        [string]$Lang = "ai-zh"
    )
    $playerUrl = "https://api.bilibili.com/x/player/v2?aid=$Aid&cid=$Cid"
    $body = Invoke-BiliHttp -Uri $playerUrl -Cookie $Cookie
    $resp = $body | ConvertFrom-Json
    if ($resp.code -ne 0 -or -not $resp.data.subtitle.subtitles) {
        return $null
    }
    $subtitles = $resp.data.subtitle.subtitles
    $target = $null
    foreach ($sub in $subtitles) {
        if ($sub.lan -eq $Lang) {
            $target = $sub; break
        }
    }
    if (-not $target) {
        return $null
    }
    $subUrl = $target.subtitle_url
    if ($subUrl -match '^//') { $subUrl = "https:$subUrl" }
    $subBody = Invoke-BiliHttp -Uri $subUrl -Cookie $Cookie
    $subJson = $subBody | ConvertFrom-Json
    if (-not $subJson.body) {
        return $null
    }
    return @{ segments = $subJson.body; lang = $target.lan_doc }
}

function Parse-SubtitleToText {
    param($SubtitleData)
    if (-not $SubtitleData -or -not $SubtitleData.segments) { return $null }
    $lines = @()
    $lines += "## AI Transcript ($($SubtitleData.lang))"
    $lines += ""
    $segments = $SubtitleData.segments
    $groupSize = 5
    for ($i = 0; $i -lt $segments.Count; $i += $groupSize) {
        $end = [Math]::Min($i + $groupSize, $segments.Count)
        $texts = @()
        for ($j = $i; $j -lt $end; $j++) {
            $texts += $segments[$j].content
        }
        $combined = ($texts | Where-Object { $_ -match '\S' }) -join ' '
        $combined = $combined -replace '\s+', ' '
        $combined = $combined.Trim()
        if (-not $combined) { continue }
        $seg = $segments[$i]
        $ts = [int][math]::Floor([double]$seg.from)
        $mm = if ($ts/60 -lt 10) { "0$([int]($ts/60))" } else { "$([int]($ts/60))" }
        $ss = if ($ts%60 -lt 10) { "0$($ts%60)" } else { "$($ts%60)" }
        $lines += "[$mm`:$ss] $combined"
    }
    return $lines -join "`n"
}

function Format-AiSummaryToText {
    param($AiData)
    if (-not $AiData -or -not $AiData.model_result) { return $null }
    $result = $AiData.model_result
    $lines = @()
    if ($result.summary) {
        $lines += "## AI Summary"
        $lines += ""
        $lines += $result.summary
        $lines += ""
    }
    if ($result.outline -and $result.outline.Count -gt 0) {
        $lines += "## Outline"
        $lines += ""
        foreach ($section in $result.outline) {
            $lines += "### $($section.title)"
            if ($section.part_outline) {
                foreach ($po in $section.part_outline) {
                    $ts = [int][math]::Floor([double]$po.timestamp / 1000)
                    $min = [int][math]::Floor($ts / 60)
                    $sec = [int]($ts % 60)
                    $mm = if ($min -lt 10) { "0$min" } else { "$min" }
                    $ss = if ($sec -lt 10) { "0$sec" } else { "$sec" }
                    $lines += "- [$mm`:$ss] $($po.content)"
                }
            }
            $lines += ""
        }
    }
    if ($result.subtitle -and $result.subtitle.Count -gt 0) {
        $lines += "## AI Subtitle"
        $lines += ""
        foreach ($sub in $result.subtitle) {
            $ts = [int][math]::Floor([double]$sub.timestamp / 1000)
            $min = [int][math]::Floor($ts / 60)
            $sec = [int]($ts % 60)
            $mm = if ($min -lt 10) { "0$min" } else { "$min" }
            $ss = if ($sec -lt 10) { "0$sec" } else { "$sec" }
            $lines += "[$mm`:$ss] $($sub.text)"
        }
    }
    return $lines -join "`n"
}
