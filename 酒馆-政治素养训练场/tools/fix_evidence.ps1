#requires -Version 5.1
# 修正 evidence 串稿：句子本身在语料里存在，但取自别的文章（按来源 URL 分桶校验才能发现）。
# 注意：PowerShell 数组索引是 0-based，而报告里显示的是 1-based，别搞混。
$ErrorActionPreference = 'Stop'
$path = 'D:\开源团队作品\酒馆-政治素养训练场\01_素材库\cards\engineer.json'
$cards = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json

# E-07（腾讯云 · 伊顿公司 Davis Lu 案）自身来源里的三段原文
$e07 = @(
  '2019 年的一天，公司正式通知卢哥解雇，并要求他上交工作电脑。就在他交出电脑的当天，那个 “以名字命名” 的终止开关被触发了 —— 伊顿公司的 Active Directory 系统检测到卢哥的账号被禁用，瞬间执行预设指令，全球员工的网络访问全被切断。',
  '法庭文件显示，这次事故让伊顿公司损失了数十万美元 —— 包括紧急抢修的技术费用、订单延误的赔偿，还有员工停工造成的 productivity 损失。',
  '8 月 21 日，美国司法部的判决结果出炉：卢哥因 “故意损坏受保护计算机” 被判 4 年监禁，释放后还要接受 3 年监外监管。'
)

# E-01《我替全组背了 3 个月锅》自身来源里的两段原文
$e01 = @(
  '组里突然砸下来个新项目，全公司没一个人摸过流程，没人敢接。最后这活就顺理成章落到我头上了。说起来离谱，我那时候手头已经堆了三个排到期的周报，根本不是最闲的那个。但全组人都知道，我是最不会拒绝的那个。',
  '就这么跑了三个月，没人说我突然变凶变难说话，但是我自己的核心任务进度条，终于再也没掉过队。'
)

foreach ($c in $cards) {
  if ($c.id -eq 'E-07') {
    $c.evidence = $e07
    Write-Host 'E-07 evidence 已重置为该文自身的三段原文'
  }
  if ($c.id -eq 'E-01') {
    $c.evidence[0] = $e01[0]
    $c.evidence[1] = $e01[1]
    Write-Host 'E-01 evidence 已替换为该文自身的原文'
  }
}

$s = $cards | ConvertTo-Json -Depth 40
$s = $s -replace '\\u003c', '<' -replace '\\u003e', '>' -replace '\\u0027', "'" -replace '\\u0026', '&'
[IO.File]::WriteAllText($path, $s, (New-Object Text.UTF8Encoding($false)))
Write-Host "已写回 $path"
