/**
 * extract_sources.mjs — 把抓到的维基文库 HTML 抽成纯文本，建本地史料库。
 *
 * 为什么要落成本地 txt：写剧情时引用史料必须**逐字可核**。
 * 凭记忆写古文是这类工作最容易出错的地方，所以引文一律从本地文本里取，
 * 并由 build 脚本在构建时校验一遍（见 verify_quotes.mjs）。
 *
 * 来源仅限维基文库（公有领域文本，CC BY-SA）。ctext.org 明确拒绝抓取，不使用。
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GYM = path.resolve(HERE, '..')
const OUT = path.join(GYM, '04_剧情', '史料库')

const SRC_DIR = process.argv[2]
const SUBDIR = process.argv[3] ?? ''
if (!SRC_DIR) throw new Error('用法: node tools/extract_sources.mjs <抓取产物目录> [子目录]')

function htmlToText(html) {
  // 从正文容器开始截到文末：非贪婪匹配容易命中外层空 div，所以只定位起点。
  const start = html.indexOf('mw-parser-output')
  const body = start >= 0 ? html.slice(start) : html
  return body
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<sup[\s\S]*?<\/sup>/g, '')            // 上标注号
    .replace(/<\/(p|div|li|tr|h\d)>/g, '\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map((l) => l.trim()).join('\n')
    .trim()
}

await mkdir(path.join(OUT, SUBDIR), { recursive: true })
const files = (await readdir(SRC_DIR)).filter((f) => f.endsWith('.html'))
let missing = 0
for (const f of files) {
  const html = await readFile(path.join(SRC_DIR, f), 'utf8')
  // 不存在的页面必须按内容特征判别，不能按长度——
  // 《答司馬諫議書》这类短信只有一千余字，与 404 页面长度重叠，
  // 用长度阈值清洗会静默删掉真史料（本项目实际踩过一次）。
  if (html.includes('noarticletext') || html.includes('維基文庫沒有') || html.includes('维基文库没有')) {
    console.log(`  [页面不存在] ${f} —— 跳过，不写入`)
    missing++
    continue
  }
  const text = htmlToText(html)
  const out = path.join(OUT, SUBDIR, f.replace(/\.html$/, '.txt'))
  await writeFile(out, text, 'utf8')
  console.log(`  ${f}  ${html.length} → ${text.length} 字`)
}
console.log(`\n已写入 ${path.join(OUT, SUBDIR)}${missing ? `（跳过 ${missing} 个不存在的页面）` : ''}`)
