#requires -Version 5.1
<#
  verify_cards.ps1 — 校验素材卡：
    1. JSON 合法性
    2. 必填字段完整性
    3. evidence 是否逐字存在于原始语料中（防编造）
  输出校验报告。
#>
param(
  [string]$CardsDir = 'D:\开源团队作品\酒馆-政治素养训练场\01_素材库\cards',
  [string]$DumpDir  = 'D:\开源团队作品\酒馆-政治素养训练场\01_素材库\_dump',
  [string]$Report   = 'D:\开源团队作品\酒馆-政治素养训练场\01_素材库\_卡片校验报告.md'
)

$ErrorActionPreference = 'Stop'

# 归一化：去掉所有空白，并统一中英文引号/破折号。
# 目的：卡片里的 evidence 是从网页复制来的，换行与弯引号常与语料不一致；
# 这类差异属于转录格式问题，不属于编造，但语序与用字必须完全一致。
function Get-Norm([string]$s) {
  if ($null -eq $s) { return '' }
  $t = $s -replace '\s', ''
  $t = $t -replace [char]0x201C, '"' -replace [char]0x201D, '"' -replace [char]0x2033, '"'
  $t = $t -replace [char]0x2018, "'" -replace [char]0x2019, "'"
  $t = $t -replace [char]0x2014, '-' -replace [char]0x2015, '-'
  $t = $t -replace [char]0x3000, ''
  return $t
}

# 按【来源 URL】建立语料索引。
# 为什么不能只用一个总语料：evidence 只要在任意一篇文章里存在就能通过，
# 于是"把 A 文章的句子贴到 B 卡片上"这种串稿查不出来。按 URL 分桶才能发现。
$corpusByUrl = @{}
$corpus = New-Object System.Text.StringBuilder
foreach ($f in Get-ChildItem -LiteralPath $DumpDir -Filter '*.txt') {
  $txt = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
  [void]$corpus.AppendLine($txt)
  foreach ($blk in ($txt -split '(?m)^(?====== TITLE: )')) {
    if (-not $blk.Trim()) { continue }
    $m = [regex]::Match($blk, '(?m)^===== URL: (.+?)\s*$')
    if (-not $m.Success) { continue }
    $u = $m.Groups[1].Value.Trim()
    if (-not $corpusByUrl.ContainsKey($u)) { $corpusByUrl[$u] = New-Object System.Text.StringBuilder }
    [void]$corpusByUrl[$u].AppendLine($blk)
  }
}
$normByUrl = @{}
foreach ($k in $corpusByUrl.Keys) { $normByUrl[$k] = Get-Norm $corpusByUrl[$k].ToString() }
$normCorpus = Get-Norm $corpus.ToString()

$required = @('id','role','title','source','type','scores','scene','setting','cast','stakes',
              'conflict_point','escalation','info_asymmetry','protagonist_actions','outcome',
              'proxy_score','lessons','branches','evidence','fidelity')

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('# 素材卡校验报告')
[void]$sb.AppendLine('')
[void]$sb.AppendLine("生成时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
[void]$sb.AppendLine('')

$all = @()
$files = Get-ChildItem -LiteralPath $CardsDir -Filter '*.json' -ErrorAction SilentlyContinue | Sort-Object Name
if (-not $files) { throw "没找到任何卡片文件: $CardsDir" }

foreach ($f in $files) {
  [void]$sb.AppendLine("## $($f.Name)  ($([math]::Round($f.Length/1024,1)) KB)")
  [void]$sb.AppendLine('')
  try {
    $cards = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    [void]$sb.AppendLine("**JSON 解析失败**: $($_.Exception.Message)")
    [void]$sb.AppendLine('')
    continue
  }
  if ($cards -isnot [array]) { $cards = @($cards) }
  [void]$sb.AppendLine('| id | 标题 | 类型 | 戏剧/冲突/教学 | 等级 | 主分 | evidence | 缺字段 |')
  [void]$sb.AppendLine('|---|---|---|---|---|---|---|---|')

  foreach ($c in $cards) {
    $missing = @()
    foreach ($k in $required) { if (-not $c.PSObject.Properties.Name.Contains($k)) { $missing += $k } }

    $evOk = 0; $evTotal = 0; $evFail = @(); $evCross = 0
    $srcUrl = if ($c.source -and $c.source.url) { ([string]$c.source.url).Trim() } else { '' }
    $hay = $null
    if ($srcUrl -and $normByUrl.ContainsKey($srcUrl)) { $hay = $normByUrl[$srcUrl] }
    if ($c.evidence) {
      foreach ($e in $c.evidence) {
        $evTotal++
        $probe = Get-Norm $e
        $hitOwn = ($null -ne $hay) -and $probe.Length -ge 8 -and $hay.Contains($probe)
        if ($hitOwn) { $evOk++ }
        else {
          # 不在自己的来源里，但能在全语料里找到 = 串稿（贴错文章）
          if ($probe.Length -ge 8 -and $normCorpus.Contains($probe)) {
            $evOk++; $evCross++
            $evFail += ("[串稿] " + $e.Substring(0, [Math]::Min(40, $e.Length)))
          } else {
            $evFail += ("[查无] " + $e.Substring(0, [Math]::Min(40, $e.Length)))
          }
        }
      }
    }

    $g = if ($c.proxy_score -and $c.proxy_score.grade) { $c.proxy_score.grade } else { '—' }
    $m = if ($c.proxy_score -and $null -ne $c.proxy_score.main) { $c.proxy_score.main } else { '—' }
    $s = if ($c.scores) { "$($c.scores.drama)/$($c.scores.conflict)/$($c.scores.teachability)" } else { '—' }

    [void]$sb.AppendLine("| $($c.id) | $($c.title) | $($c.type) | $s | $g | $m | $evOk/$evTotal | $($missing -join ',') |")
    if (-not $hay -and $srcUrl) { [void]$sb.AppendLine("| | ↳ 来源 URL 未在语料中匹配: $srcUrl | | | | | | |") }
    if ($evFail.Count -gt 0) {
      foreach ($x in $evFail) { [void]$sb.AppendLine("| | ↳ evidence $x… | | | | | | |") }
    }
    $all += [pscustomobject]@{ Id=$c.id; Role=$c.role; Title=$c.title; Grade=$g; Main=$m; EvOk=$evOk; EvTotal=$evTotal; EvCross=$evCross; Missing=($missing -join ',') }
  }
  [void]$sb.AppendLine('')
}

# 汇总
[void]$sb.AppendLine('## 汇总')
[void]$sb.AppendLine('')
[void]$sb.AppendLine("卡片总数: $($all.Count)")
[void]$sb.AppendLine('')
[void]$sb.AppendLine('按角色：')
foreach ($grp in ($all | Group-Object Role | Sort-Object Name)) {
  [void]$sb.AppendLine("- $($grp.Name): $($grp.Count)")
}
[void]$sb.AppendLine('')
[void]$sb.AppendLine('按等级：')
foreach ($grp in ($all | Group-Object Grade | Sort-Object Name)) {
  [void]$sb.AppendLine("- $($grp.Name): $($grp.Count)")
}
[void]$sb.AppendLine('')
$badEv = @($all | Where-Object { $_.EvOk -lt $_.EvTotal })
$badF  = @($all | Where-Object { $_.Missing -ne '' })
[void]$sb.AppendLine("evidence 未全部命中的卡片: $($badEv.Count)")
foreach ($b in $badEv) { [void]$sb.AppendLine("  - $($b.Id) $($b.Title) ($($b.EvOk)/$($b.EvTotal))") }
[void]$sb.AppendLine('')
$cross = @($all | Where-Object { $_.EvCross -gt 0 })
[void]$sb.AppendLine("evidence 串稿（句子存在但不属于该卡的来源 URL）: $($cross.Count) 张")
foreach ($b in $cross) { [void]$sb.AppendLine("  - $($b.Id) $($b.Title) ($($b.EvCross) 段)") }
[void]$sb.AppendLine('')
[void]$sb.AppendLine("缺字段的卡片: $($badF.Count)")
foreach ($b in $badF) { [void]$sb.AppendLine("  - $($b.Id) 缺: $($b.Missing)") }

[IO.File]::WriteAllText($Report, $sb.ToString(), (New-Object Text.UTF8Encoding($false)))
Write-Host "卡片总数: $($all.Count)"
Write-Host "evidence 未全中: $($badEv.Count)   串稿: $($cross.Count)   缺字段: $($badF.Count)"
Write-Host "报告: $Report"
