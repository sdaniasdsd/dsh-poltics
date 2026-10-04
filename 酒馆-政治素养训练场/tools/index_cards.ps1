#requires -Version 5.1
<#
  index_cards.ps1 — 把 cards/*.json 汇总成人类可读的《素材卡总览》。
#>
param(
  [string]$CardsDir = 'D:\开源团队作品\酒馆-政治素养训练场\01_素材库\cards',
  [string]$Out      = 'D:\开源团队作品\酒馆-政治素养训练场\01_素材库\素材卡总览.md'
)

$ErrorActionPreference = 'Stop'
$roleName = @{
  sales       = '销售'
  engineer    = '工程师'
  procurement = '采购'
  worker      = '工人'
  general     = '通用 / 跨行业'
}
$gradeOrder = @('S','A','B','C','D','E','F')

$all = @()
foreach ($f in (Get-ChildItem -LiteralPath $CardsDir -Filter '*.json' | Sort-Object Name)) {
  $cards = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($cards -isnot [array]) { $cards = @($cards) }
  foreach ($c in $cards) { $all += $c }
}

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('# 素材卡总览')
[void]$sb.AppendLine('')
[void]$sb.AppendLine("共 $($all.Count) 张卡。等级含义见 [README](../README.md) 与 [评分标准](../02_评分标准/利益获取评分标准_v1.md)。")
[void]$sb.AppendLine('')
[void]$sb.AppendLine('> `原型结算` 是真实故事里当事人自己的利益净结果，用户打完一局可以跟它对表。')
[void]$sb.AppendLine('')

# 推荐榜
[void]$sb.AppendLine('## 一、优先上线（戏剧性 + 冲突 + 教学价值最高的卡）')
[void]$sb.AppendLine('')
$top = $all | Sort-Object -Property @{Expression={ $_.scores.drama + $_.scores.conflict + $_.scores.teachability }} -Descending | Select-Object -First 12
[void]$sb.AppendLine('| 卡号 | 标题 | 岗位 | 场景（训练场开场） | 原型结算 |')
[void]$sb.AppendLine('|---|---|---|---|---|')
foreach ($c in $top) {
  $g = if ($c.proxy_score -and $c.proxy_score.grade) { $c.proxy_score.grade } else { '—' }
  [void]$sb.AppendLine("| ``$($c.id)`` | $($c.title) | $($roleName[$c.role]) | $($c.scene) | $g |")
}
[void]$sb.AppendLine('')

# 负分教学卡
[void]$sb.AppendLine('## 二、负分教学卡（原型是 E / F 级，用来讲"哪一步开始错的"）')
[void]$sb.AppendLine('')
$neg = $all | Where-Object { $_.proxy_score -and ($_.proxy_score.grade -in @('E','F')) }
if ($neg) {
  [void]$sb.AppendLine('| 卡号 | 标题 | 岗位 | 原型结算 | 一句话教训 |')
  [void]$sb.AppendLine('|---|---|---|---|---|')
  foreach ($c in $neg) {
    $l = if ($c.lessons) { $c.lessons[0] } else { '' }
    [void]$sb.AppendLine("| ``$($c.id)`` | $($c.title) | $($roleName[$c.role]) | $($c.proxy_score.grade) ($($c.proxy_score.main)) | $l |")
  }
} else { [void]$sb.AppendLine('（无）') }
[void]$sb.AppendLine('')

# 按岗位全表
[void]$sb.AppendLine('## 三、全量清单（按岗位）')
[void]$sb.AppendLine('')
foreach ($role in @('sales','engineer','procurement','worker','general')) {
  $rs = $all | Where-Object { $_.role -eq $role } | Sort-Object -Property @{Expression={ $_.scores.drama + $_.scores.conflict + $_.scores.teachability }} -Descending
  if (-not $rs) { continue }
  [void]$sb.AppendLine("### $($roleName[$role])（$($rs.Count) 张）")
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('| 卡号 | 标题 | 类型 | 戏/冲/教 | 原型结算 | 可信度 | 核心冲突 | 来源 |')
  [void]$sb.AppendLine('|---|---|---|---|---|---|---|---|')
  foreach ($c in $rs) {
    $g = if ($c.proxy_score -and $c.proxy_score.grade) { "$($c.proxy_score.grade) ($($c.proxy_score.main))" } else { '—' }
    $s = "$($c.scores.drama)/$($c.scores.conflict)/$($c.scores.teachability)"
    [void]$sb.AppendLine("| ``$($c.id)`` | $($c.title) | $($c.type) | $s | $g | $($c.fidelity) | $($c.conflict_point) | [源]($($c.source.url)) |")
  }
  [void]$sb.AppendLine('')
}

# 统计
[void]$sb.AppendLine('## 四、统计')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('| 岗位 | 张数 | S | A | B | C | D | E | F | 无结局 |')
[void]$sb.AppendLine('|---|---|---|---|---|---|---|---|---|---|')
foreach ($role in @('sales','engineer','procurement','worker','general')) {
  $rs = $all | Where-Object { $_.role -eq $role }
  if (-not $rs) { continue }
  $cells = @()
  foreach ($gr in $gradeOrder) { $cells += ($rs | Where-Object { $_.proxy_score -and $_.proxy_score.grade -eq $gr }).Count }
  $none = ($rs | Where-Object { -not $_.proxy_score -or -not $_.proxy_score.grade }).Count
  [void]$sb.AppendLine("| $($roleName[$role]) | $($rs.Count) | $($cells -join ' | ') | $none |")
}
[void]$sb.AppendLine('')
[void]$sb.AppendLine('| 可信度 | 张数 |')
[void]$sb.AppendLine('|---|---|')
foreach ($grp in ($all | Group-Object fidelity | Sort-Object Count -Descending)) {
  [void]$sb.AppendLine("| $($grp.Name) | $($grp.Count) |")
}

[IO.File]::WriteAllText($Out, $sb.ToString(), (New-Object Text.UTF8Encoding($false)))
Write-Host "卡片总数: $($all.Count)"
Write-Host "输出: $Out"
