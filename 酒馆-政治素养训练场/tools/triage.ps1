#requires -Version 5.1
param(
  [string]$RawDir = 'D:\开源团队作品\酒馆-政治素养训练场\01_素材库\raw',
  [string]$Out    = 'D:\开源团队作品\酒馆-政治素养训练场\01_素材库\_triage.md',
  [int]$Preview   = 500
)

$ErrorActionPreference = 'Stop'
$sb = New-Object System.Text.StringBuilder
$files = Get-ChildItem -LiteralPath $RawDir -Filter '*.json' | Sort-Object Name
$n = 0
foreach ($f in $files) {
  $j = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  [void]$sb.AppendLine("## 批次 $($f.BaseName)")
  foreach ($r in $j.results) {
    if ($r.error) { continue }
    foreach ($a in $r.answers) {
      $n++
      $t = $a.text
      $head = if ($t.Length -gt $Preview) { $t.Substring(0, $Preview) } else { $t }
      [void]$sb.AppendLine("")
      [void]$sb.AppendLine("### [$n] $($r.title)")
      [void]$sb.AppendLine("- 批次: $($f.BaseName) | 作者: $($a.author) | 总字数: $($a.chars) | 链接: $($r.url)")
      [void]$sb.AppendLine('```')
      [void]$sb.AppendLine(($head -replace "`r", ''))
      [void]$sb.AppendLine('```')
    }
  }
}
[IO.File]::WriteAllText($Out, $sb.ToString(), (New-Object Text.UTF8Encoding($false)))
"条目总数: $n"
"输出: $Out"
"字符数: $($sb.Length)"
