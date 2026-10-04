#requires -Version 5.1
<#
  collect_douyin.ps1 — 抓取抖音视频/图文页的正文、评论区与相关视频。

  背景（2026-09 实测）：
    抖音的登录墙只在 /search/ 搜索页。详情页不需要登录即可读取：
      · 文案 + 话题标签
      · 播放/点赞/评论/分享数、发布时间、作者
      · 评论区前 ~10 条 + 可展开的回复（"发表评论"才需要登录）
      · 相关视频列表（15+ 条同题材条目）—— 这是天然的发现图谱
    发现（discovery）不走站内搜索，改用 web_search：
      它能索引到 https://www.douyin.com/shipin/{id} 与 /video/{id} / /note/{id}

  用法：
    & collect_douyin.ps1 -UrlsFile tools\urls_douyin.txt -RequestId dy01
#>
param(
  [Parameter(Mandatory = $true)][string]$UrlsFile,
  [Parameter(Mandatory = $true)][string]$RequestId,
  [string]$Task   = "douyin-harvest",
  [string]$OutDir = "D:\开源团队作品\酒馆-政治素养训练场\01_素材库\raw",
  [int]$Concurrency = 3,
  [int]$TimeoutMs   = 170000
)

$ErrorActionPreference = 'Stop'
$cli   = Join-Path $env:LOCALAPPDATA 'Tabbit\LocalAgent\bin\tabbit-cli.exe'
$work  = Join-Path $PSScriptRoot '_work'
if (-not (Test-Path $work))   { New-Item -ItemType Directory -Path $work   -Force | Out-Null }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
if (-not (Test-Path $cli))    { throw "tabbit-cli 不存在: $cli" }

$urls = Get-Content -LiteralPath $UrlsFile -Encoding UTF8 |
        Where-Object { $_ -and $_.Trim() -ne '' -and -not $_.Trim().StartsWith('#') } |
        ForEach-Object { $_.Trim() }
if (-not $urls) { throw "URL 列表为空: $UrlsFile" }
$urlsJson = '[' + (($urls | ForEach-Object { ConvertTo-Json $_ -Compress }) -join ',') + ']'

$prog = @'
const targets = __URLS__;
const CONC = __CONC__;

function clean(s) { return (s || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim(); }

async function grab(u) {
  const tab = await context.newPage();
  try {
    await tab.goto(u, { waitUntil: "domcontentloaded", timeout: 45000 });
    await tab.waitForTimeout(6000);
    for (let i = 0; i < 3; i++) { await tab.mouse.wheel(0, 800); await tab.waitForTimeout(1200); }
    return await tab.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const qa = (s) => Array.from(document.querySelectorAll(s));
      const t = (e) => ((e && e.innerText) || "").replace(/\s+/g, " ").trim();
      const comments = qa('[data-e2e="comment-item"]').map(t).filter((x) => x.length > 4).slice(0, 15);
      const related = []; const seen = new Set();
      for (const a of qa('a[href*="/video/"], a[href*="/shipin/"], a[href*="/note/"]')) {
        const href = (a.href || "").split("?")[0];
        if (!href || seen.has(href)) continue;
        const txt = t(a);
        if (txt.length < 8) continue;
        seen.add(href); related.push({ url: href, text: txt.slice(0, 140) });
        if (related.length >= 15) break;
      }
      const body = t(document.body);
      return {
        finalUrl: location.href,
        title: document.title,
        desc: t(q('[data-e2e="video-desc"]')) || t(q('[data-e2e="detail-video-desc"]')),
        bodyExcerpt: body.slice(0, 1200),
        comments: comments,
        related: related
      };
    });
  } catch (e) {
    return { url: u, error: String(e).slice(0, 250) };
  } finally { await tab.close(); }
}

const results = [];
for (let i = 0; i < targets.length; i += CONC) {
  const wave = targets.slice(i, i + CONC);
  const settled = await Promise.allSettled(wave.map((x) => grab(x)));
  for (let k = 0; k < settled.length; k++) {
    const s = settled[k];
    results.push(s.status === "fulfilled" ? s.value : { url: wave[k], error: String(s.reason).slice(0, 250) });
  }
}
return { requested: targets.length, count: results.length, results: results };
'@

$prog = $prog.Replace('__URLS__', $urlsJson).Replace('__CONC__', [string]$Concurrency)
$progPath = Join-Path $work "$RequestId.prog.js"
$outPath  = Join-Path $work "$RequestId.out.json"
$errPath  = Join-Path $work "$RequestId.err.txt"
[IO.File]::WriteAllText($progPath, $prog, (New-Object Text.UTF8Encoding($false)))

Write-Host "[douyin] URL 数: $($urls.Count)  requestId=$RequestId"
Start-Process -FilePath $cli `
  -ArgumentList @('nodejs', '--task', $Task, '--request-id', $RequestId, '--timeout-ms', [string]$TimeoutMs) `
  -RedirectStandardInput $progPath -RedirectStandardOutput $outPath -RedirectStandardError $errPath `
  -NoNewWindow -Wait | Out-Null

$raw = Get-Content -LiteralPath $outPath -Raw -Encoding UTF8
if (-not $raw) { throw "tabbit 无输出。stderr: $(Get-Content -LiteralPath $errPath -Raw -ErrorAction SilentlyContinue)" }
$j = $raw | ConvertFrom-Json
if ($j.status -ne 'succeeded') { throw "tabbit 状态 $($j.status): $raw" }

$payload = $null
$res = $j.result
if ($res.PSObject.Properties.Name -contains 'resourceId' -and $res.resourceId) {
  # 结果超过 16 KiB 时宿主不内联，改成分片资源；不读会被任务清理掉。
  Write-Host "[douyin] 结果较大，分片读取 resourceId=$($res.resourceId) bytes=$($res.byteLength)"
  $offset = 0
  $sb = New-Object System.Text.StringBuilder
  while ($true) {
    $rf = Join-Path $work "$RequestId.res.json"
    $ef = Join-Path $work "$RequestId.res.err.txt"
    Start-Process -FilePath $cli `
      -ArgumentList @('resource', '--task', $Task, '--resource', $res.resourceId, '--offset', [string]$offset, '--max-bytes', '65536') `
      -RedirectStandardOutput $rf -RedirectStandardError $ef -NoNewWindow -Wait | Out-Null
    $c = Get-Content -LiteralPath $rf -Raw -Encoding UTF8 | ConvertFrom-Json
    [void]$sb.Append($c.data)
    if ($c.eof) { break }
    $offset = $c.nextOffset
  }
  $payload = $sb.ToString()
} else {
  $payload = $res.value | ConvertTo-Json -Depth 30
}
if (-not $payload) { throw "结果为空：既无 value 也无 resourceId。stdout: $raw" }

$final = Join-Path $OutDir "$RequestId.json"
[IO.File]::WriteAllText($final, $payload, (New-Object Text.UTF8Encoding($false)))

$v = $payload | ConvertFrom-Json
$rs = @($v.results)
$ok = @($rs | Where-Object { -not $_.error }).Count
Write-Host "[douyin] 成功 $ok / $($rs.Count)  输出: $final"
foreach ($r in $rs) {
  if ($r.error) { Write-Host ("  [失败] " + $r.url + " :: " + $r.error) }
  else {
    $cm = @($r.comments); $rl = @($r.related)
    Write-Host ("  [OK] 评论 $($cm.Count) 条 | 相关视频 $($rl.Count) 条 | " + $r.title)
  }
}
