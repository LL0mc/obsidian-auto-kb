function Get-MixinKey {
    param([string]$Orig)
    $tab = @(
        46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
        27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
        37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
        22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
    )
    $sb = [System.Text.StringBuilder]::new()
    for ($i = 0; $i -lt 32; $i++) {
        [void]$sb.Append($Orig[$tab[$i]])
    }
    return $sb.ToString()
}

function Get-WbiSignedParams {
    param(
        [Parameter(Mandatory)] [hashtable]$Params,
        [Parameter(Mandatory)] [string]$ImgKey,
        [Parameter(Mandatory)] [string]$SubKey
    )
    $mixinKey = Get-MixinKey -Orig ($ImgKey + $SubKey)
    $currTime = [int][Math]::Floor((Get-Date -UFormat %s))
    $Params['wts'] = $currTime
    $sorted = $Params.GetEnumerator() | Sort-Object Key
    $parts = @()
    foreach ($kv in $sorted) {
        $key = $kv.Key
        $value = "$($kv.Value)"
        $value = [regex]::Replace($value, "[!'()*]", '')
        $parts += "$([uri]::EscapeDataString($key))=$([uri]::EscapeDataString($value))"
    }
    $query = $parts -join '&'
    $hashInput = $query + $mixinKey
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($hashInput)
    $hash = $md5.ComputeHash($bytes)
    $wrid = ($hash | ForEach-Object { '{0:x2}' -f $_ }) -join ''
    $result = @{}
    foreach ($kv in $sorted) {
        $result[$kv.Key] = "$($kv.Value)"
    }
    $result['w_rid'] = $wrid
    return $result
}
