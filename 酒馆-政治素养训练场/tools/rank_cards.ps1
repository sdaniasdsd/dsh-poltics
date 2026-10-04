#requires -Version 5.1
# 细节丰富度排序：把「细节丰富」变成可复核的指标，而不是凭感觉挑。
# 指标：证据字数、人物数、升级节点数、信息不对称叙述长度、分支数、是否有确定结算。
param(
  [string]$CardsDir = 'D:\开源团队作品\酒馆-政治素养训练场\01_素材库\cards',
  [string]$Out      = 'D:\开源团队作品\酒馆-政治素养训练场\01_素材库\_细节丰富度排序.md'
)

$ErrorActionPreference = 'Stop'
$rows = @()
foreach ($f in Get-ChildItem -LiteralPath $CardsDir -Filter '*.json' | Sort-Object Name) {
  $cards = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($c in $cards) {
    $evChars = 0; foreach ($e in @($c.evidence)) { $evChars += ([string]$e).Length }
    $cast    = @($c.cast).Count
    $escal   = @($c.escalation).Count
    $iaLen   = ([string]$c.info_asymmetry).Length
    $branch  = @($c.branches).Count
    $lesson  = @($c.lessons).Count
    $hasNum  = if (([string]$c.conflict_point + [string]$c.outcome.self + [string]$c.outcome.cost) -match '\d') { 1 } else { 0 }
    $settled = if ($c.proxy_score -and $c.proxy_score.grade) { 1 } else { 0 }
    $score   = [math]::Round(
                 ($evChars / 40) + ($cast * 1.5) + ($escal * 1.5) + ($iaLen / 60) + ($branch * 0.8) + ($hasNum * 1.5) + ($settled * 1.5),
                 2)
    $rows += [pscustomobject]@{
      Id = $c.id; Role = $c.role; Title = $c.title
      EvChars = $evChars; Ev = @($c.evidence).Count; Cast = $cast; Escal = $escal
      Ia = $iaLen; Branch = $branch; Lesson = $lesson; Num = $hasNum; Settled = $settled
      Drama = $c.scores.drama; Conflict = $c.scores.conflict; Teach = $c.scores.teachability
      Fidelity = $c.fidelity; Grade = if ($c.proxy_score) { $c.proxy_score.grade } else { '—' }
      Richness = $score
    }
  }
}

$sorted = $rows | Sort-Object Richness -Descending
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('# 素材卡「细节丰富度」排序')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('指标说明（均为可复核的客观量）：')
[void]$sb.AppendLine('- `证据字` 原文引用总字数 — 有多少可直接核对的细节')
[void]$sb.AppendLine('- `人物` 有名有姓/有职位的角色数 — 能撑起几个 NPC')
[void]$sb.AppendLine('- `节点` 冲突升级时间线长度 — 剧情有多少个转折')
[void]$sb.AppendLine('- `不对称` 信息不对称叙述字数 — 训练场的"隐藏信息"有多少料')
[void]$sb.AppendLine('- `分支` 可选择走向数 / `数字` 原文含具体数字（金额、天数、比例）')
[void]$sb.AppendLine('- `结算` 是否有确定结局（方法型无结局 = 0）')
[void]$sb.AppendLine('')
[void]$sb.AppendLine("共 $($sorted.Count) 张卡。")
[void]$sb.AppendLine('')
[void]$sb.AppendLine('| 排名 | 卡号 | 岗位 | 标题 | 丰富度 | 证据字 | 人物 | 节点 | 不对称 | 分支 | 数字 | 结算 | 戏/冲/教 | 原型 | 可信度 |')
[void]$sb.AppendLine('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
$i = 0
foreach ($r in $sorted) {
  $i++
  [void]$sb.AppendLine("| $i | ``$($r.Id)`` | $($r.Role) | $($r.Title) | **$($r.Richness)** | $($r.EvChars) | $($r.Cast) | $($r.Escal) | $($r.Ia) | $($r.Branch) | $($r.Num) | $($r.Settled) | $($r.Drama)/$($r.Conflict)/$($r.Teach) | $($r.Grade) | $($r.Fidelity) |")
}
[IO.File]::WriteAllText($Out, $sb.ToString(), (New-Object Text.UTF8Encoding($false)))
Write-Host "共 $($sorted.Count) 张"
Write-Host "Top 25:"
$sorted | Select-Object -First 25 | ForEach-Object { "  {0,6}  {1,-6} {2,-12} {3}" -f $_.Richness, $_.Id, $_.Role, $_.Title }
Write-Host "报告: $Out"
