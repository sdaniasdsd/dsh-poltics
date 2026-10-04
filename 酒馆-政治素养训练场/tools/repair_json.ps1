#requires -Version 5.1
# 修复 engineer.json：会写坏的分工代理留下了未转义的引号。
# 规则：只对「整行就是一个 JSON 字符串」的行转义内部引号；带 ": " 的键值行一律跳过。
param(
  [string]$Path = 'D:\开源团队作品\酒馆-政治素养训练场\01_素材库\cards\engineer.json',
  [switch]$Rollback
)

$ErrorActionPreference = 'Stop'
$raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8

$bsq = [char]92 + [char]34     # 反斜杠 + 引号
$raw = $raw.Replace($bsq, '"')  # 步骤1：先回滚此前误加的转义

$lines = $raw -split "`n"
$pat = '^(\s*)"(.*)"(,?)\s*$'
$fixed = 0; $skipped = 0
for ($i = 0; $i -lt $lines.Count; $i++) {
  $m = [regex]::Match($lines[$i], $pat)
  if (-not $m.Success) { continue }
  $mid = $m.Groups[2].Value
  if ($mid -match '": ') { $skipped++; continue }   # 键值行
  if ($mid -notmatch '"') { continue }
  $lines[$i] = $m.Groups[1].Value + '"' + ($mid.Replace('"', $bsq)) + '"' + $m.Groups[3].Value
  $fixed++
}
$out = ($lines -join "`n")
[IO.File]::WriteAllText($Path, $out, (New-Object Text.UTF8Encoding($false)))

Write-Host "回滚并转义完成：修正 $fixed 行，跳过键值行 $skipped 行"
try {
  $o = $out | ConvertFrom-Json
  Write-Host "JSON 合法，卡片数: $(@($o).Count)"
  foreach ($c in @($o)) { Write-Host "  $($c.id) | $($c.title)" }
} catch {
  Write-Host "仍然解析失败: $($_.Exception.Message)"
}
