/**
 * verify_quotes.mjs — 校验剧情 JSON 里的每一条史料引文都能在本地史料库里逐字命中。
 *
 * 为什么必须机器校验：凭记忆写古文是这类工作最容易犯的错——写出来的句子读起来
 * 完全像真的，但正史里没有。人眼看不出来，indexOf 一眼就看出来。
 *
 * 校验范围：sources[].quote、cross_checks[].sources[].quote、evidence[]。
 * 比较时只做「去空白 + 繁简不转换」的宽松归一：标点与空白差异放行，
 * **字词差异一律报错**——因为改一个字就是改写史料。
 *
 * 用法: node tools/verify_quotes.mjs [场景目录]
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GYM = path.resolve(HERE, '..')
const SCEN = process.argv[2] ?? path.join(GYM, '04_剧情', 'scenarios_v3')
const CORPUS = path.join(GYM, '04_剧情', '史料库')

/** 只去空白与全角空格；不做繁简转换——繁简混用本身就是引文被改写过的信号。 */
const norm = (s) => String(s).replace(/[\s\u3000]/g, '')

async function loadCorpus(root) {
  const map = new Map()
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.name.endsWith('.txt')) map.set(path.relative(CORPUS, p), norm(await readFile(p, 'utf8')))
    }
  }
  await walk(root)
  return map
}

const corpus = await loadCorpus(CORPUS)
const allText = [...corpus.values()].join('\n')
console.log(`史料库：${corpus.size} 份，合计 ${allText.length} 字（已归一）\n`)

/** 返回命中该引文的所有语料文件名；找不到返回空数组。
 *  返回全部而不是第一个：同一部书可能同时存在于多个副本的史料库里，
 *  只取第一个会把「在别处命中」误报成「出处不符」。 */
function find(quote) {
  const q = norm(quote)
  if (q.length < 6) return 'TOO_SHORT'
  const hits = []
  for (const [name, text] of corpus) if (text.includes(q)) hits.push(name)
  return hits
}

const files = (await readdir(SCEN)).filter((f) => f.endsWith('.json'))
let checked = 0
const problems = []

for (const f of files) {
  const items = JSON.parse(await readFile(path.join(SCEN, f), 'utf8'))
  for (const s of items) {
    const label = s.id ?? f
    const claim = (where, quote) => {
      checked++
      const hits = find(quote)
      if (hits === 'TOO_SHORT') { problems.push(`${label} ${where}: 引文过短（<6 字），无法作为证据`); return null }
      if (hits.length === 0) {
        problems.push(`${label} ${where}: 引文在史料库里找不到 → 「${String(quote).slice(0, 40)}…」`)
        return null
      }
      return hits
    }
    for (const [i, src] of (s.sources ?? []).entries()) {
      const hits = claim(`sources[${i}](${src.work})`, src.quote)
      // 只要求「声明的文件确实包含这条引文」，不要求它是唯一命中处。
      if (hits && src.local && !hits.some((h) => h.replace(/\\/g, '/').endsWith(src.local))) {
        problems.push(`${label} sources[${i}]: 声明出自 ${src.local}，但该文件里找不到（实际命中：${hits.join('、') || '无'}）`)
      }
    }
    for (const [i, cc] of (s.cross_checks ?? []).entries()) {
      for (const [j, src] of (cc.sources ?? []).entries()) {
        claim(`cross_checks[${i}].sources[${j}]`, src.quote)
      }
      if (!cc.divergence || cc.divergence.length < 10) problems.push(`${label} cross_checks[${i}]: divergence 太短或缺失`)
      if (!cc.our_choice) problems.push(`${label} cross_checks[${i}]: 缺 our_choice`)
      if (!cc.why_it_matters) problems.push(`${label} cross_checks[${i}]: 缺 why_it_matters`)
    }
    for (const [i, q] of (s.evidence ?? []).entries()) claim(`evidence[${i}]`, q)
  }
}

console.log(`校验引文 ${checked} 条`)
if (problems.length === 0) {
  console.log('✅ 全部逐字命中，且 cross_checks 结构完整。')
} else {
  console.log(`❌ ${problems.length} 处问题：`)
  for (const p of problems) console.log('  -', p)
  process.exitCode = 1
}
