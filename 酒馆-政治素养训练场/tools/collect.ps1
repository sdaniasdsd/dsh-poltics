#requires -Version 5.1
<#
  collect.ps1 — 通过 Tabbit 浏览器批量抓取网页正文，落盘为 JSON。

  用法：
    pwsh -File collect.ps1 -UrlsFile <urls.txt> -RequestId <唯一ID> [-Task material-harvest]
#>
param(
  [Parameter(Mandatory = $true)][string]$UrlsFile,
  [Parameter(Mandatory = $true)][string]$RequestId,
  [string]$Task       = "material-harvest",
  [string]$OutDir     = "D:\开源团队作品\酒馆-政治素养训练场\01_素材库\raw",
  [int]$MaxAnswers    = 4,
  [int]$MaxChars      = 3500,
  [int]$Concurrency   = 3,
  [int]$TimeoutMs     = 180000
)

$ErrorActionPreference = 'Stop'
$cli     = Join-Path $env:LOCALAPPDATA 'Tabbit\LocalAgent\bin\tabbit-cli.exe'
$tools   = $PSScriptRoot
$work    = Join-Path $tools '_work'
if (-not (Test-Path $work)) { New-Item -ItemType Directory -Path $work -Force | Out-Null }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

if (-not (Test-Path $cli)) { throw "tabbit-cli 不存在: $cli" }

# ---------- 读取 URL ----------
$urls = Get-Content -LiteralPath $UrlsFile -Encoding UTF8 |
        Where-Object { $_ -and $_.Trim() -ne '' -and -not $_.Trim().StartsWith('#') } |
        ForEach-Object { $_.Trim() }
if (-not $urls) { throw "URL 列表为空: $UrlsFile" }

$urlsJson = '[' + (($urls | ForEach-Object { ConvertTo-Json $_ -Compress }) -join ',') + ']'

# ---------- 生成浏览器程序 ----------
$progTemplate = @'
const targets = __URLS__;
const CONC = __CONC__;

async function grab(url) {
  const tab = await context.newPage();
  try {
    await tab.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await tab.waitForTimeout(2500);
    return await tab.evaluate((cfg) => {
      const clean = (s) => (s || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      const out = { url: location.href, title: document.title, heading: "", answers: [] };
      const h = document.querySelector(".QuestionHeader-title") || document.querySelector("h1");
      out.heading = h ? clean(h.innerText) : "";
      const items = document.querySelectorAll(".List-item");
      for (const it of items) {
        const body = it.querySelector(".RichContent-inner") || it.querySelector(".RichText");
        if (!body) continue;
        const t = clean(body.innerText);
        if (t.length < 200) continue;
        const a = it.querySelector(".AuthorInfo-name");
        const v = it.querySelector(".VoteButton--up");
        out.answers.push({
          author: a ? clean(a.innerText) : "",
          vote: v ? clean(v.innerText) : "",
          chars: t.length,
          text: t.slice(0, cfg.MAXC)
        });
        if (out.answers.length >= cfg.MAXA) break;
      }
      if (!out.answers.length) {
        const main = document.querySelector("article, .Post-RichTextContainer, .RichText, .article-content, main") || document.body;
        const t = clean(main.innerText);
        out.answers.push({ author: "", vote: "", chars: t.length, text: t.slice(0, cfg.MAXC) });
      }
      return out;
    }, { MAXA: __MAXA__, MAXC: __MAXC__ });
  } catch (e) {
    return { url: url, error: String(e).slice(0, 300) };
  } finally {
    await tab.close();
  }
}

const results = [];
for (let i = 0; i < targets.length; i += CONC) {
  const wave = targets.slice(i, i + CONC);
  const settled = await Promise.allSettled(wave.map(function (u) { return grab(u); }));
  for (let k = 0; k < settled.length; k++) {
    const s = settled[k];
    results.push(s.status === "fulfilled" ? s.value : { url: wave[k], error: String(s.reason).slice(0, 300) });
  }
}
return { requested: targets.length, count: results.length, results: results };
'@

$prog = $progTemplate.
  Replace('__URLS__', $urlsJson).
  Replace('__CONC__', [string]$Concurrency).
  Replace('__MAXA__', [string]$MaxAnswers).
  Replace('__MAXC__', [string]$MaxChars)

$progPath = Join-Path $work "$RequestId.prog.js"
$outPath  = Join-Path $work "$RequestId.out.json"
$errPath  = Join-Path $work "$RequestId.err.txt"
[IO.File]::WriteAllText($progPath, $prog, (New-Object Text.UTF8Encoding($false)))

Write-Host "[collect] URL 数: $($urls.Count)  task=$Task  requestId=$RequestId"

# ---------- 调用 nodejs ----------
$p = Start-Process -FilePath $cli `
  -ArgumentList @('nodejs', '--task', $Task, '--request-id', $RequestId, '--timeout-ms', [string]$TimeoutMs) `
  -RedirectStandardInput $progPath -RedirectStandardOutput $outPath -RedirectStandardError $errPath `
  -NoNewWindow -Wait -PassThru

$raw = Get-Content -LiteralPath $outPath -Raw -Encoding UTF8
if (-not $raw) { throw "tabbit 无输出。stderr: $(Get-Content -LiteralPath $errPath -Raw -ErrorAction SilentlyContinue)" }
$j = $raw | ConvertFrom-Json

if ($j.status -ne 'succeeded') {
  throw "tabbit 状态 $($j.status): $raw"
}

# ---------- 取回结果（内联或资源分片） ----------
$res = $j.result
if ($res.PSObject.Properties.Name -contains 'resourceId' -and $res.resourceId) {
  Write-Host "[collect] 结果较大，分片读取 resourceId=$($res.resourceId) bytes=$($res.byteLength)"
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
  $payload = ($res.value | ConvertTo-Json -Depth 30)
}

$final = Join-Path $OutDir "$RequestId.json"
[IO.File]::WriteAllText($final, $payload, (New-Object Text.UTF8Encoding($false)))

# ---------- 简报 ----------
$v = $payload | ConvertFrom-Json
if ($v.results) {
  $ok = ($v.results | Where-Object { -not $_.error }).Count
  Write-Host "[collect] 成功 $ok / $($v.results.Count)  输出: $final"
  foreach ($r in $v.results) {
    if ($r.error) { Write-Host ("  [失败] " + $r.url + " :: " + $r.error) }
    else { Write-Host ("  [OK] " + $r.answers.Count + " 段 | " + $r.title) }
  }
} else {
  Write-Host "[collect] 输出: $final"
}
Write-Host "[collect] err: $(Get-Content -LiteralPath $errPath -Raw -ErrorAction SilentlyContinue)"
