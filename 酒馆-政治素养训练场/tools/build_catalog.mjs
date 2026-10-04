/**
 * build_catalog.mjs — 把 scenarios/*.json 汇总成人类可读的《剧情总览》。
 * 只读不写内容；用于人工核对 20 篇剧情的主角、结算基准与来源可信度。
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GYM = path.resolve(HERE, '..')
const DIR = path.join(GYM, '04_剧情', 'scenarios')
const OUT = path.join(GYM, '04_剧情', '剧情总览.md')

const ROLE = { sales: '销售', engineer: '工程师', procurement: '采购', worker: '工人', general: '通用／跨行业' }
const DIFF = { 普通: '🟦 普通', 困难: '🟨 困难', 地狱: '🟥 地狱' }

const files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort()
const all = []
for (const f of files) {
  const arr = JSON.parse(await readFile(path.join(DIR, f), 'utf8'))
  for (const s of arr) all.push(s)
}

const byRole = new Map()
for (const s of all) {
  if (!byRole.has(s.role)) byRole.set(s.role, [])
  byRole.get(s.role).push(s)
}

const L = []
L.push('# 剧情总览')
L.push('')
L.push(`共 **${all.length}** 篇剧情，` +
  `${all.reduce((n, s) => n + (s.protagonists?.length ?? 0), 0)} 个可扮演主角。`)
L.push('')
L.push('> 「现实结算」是真实故事里坐在那个位置的人的最终结果，用来给用户对表：')
L.push('> 打得比它高 = 比现实当事人处理得更好；比它低 = 现实里有一条更好的路。')
L.push('> 标注「推演」的是按《评分算例》从原型位置反推出来的，没有真实结局可依。')
L.push('')

L.push('## 一览')
L.push('')
L.push('| 编号 | 标题 | 岗位 | 主角 | 原型结算 | 可信度 |')
L.push('|---|---|---|---|---|---|')
for (const s of all) {
  const proto = s.protagonists?.[0]
  L.push(`| \`${s.id}\` | ${s.title} | ${ROLE[s.role] ?? s.role} | ${s.protagonists.length} | ` +
    `${proto?.baseline?.grade ?? '—'} (${proto?.baseline?.main ?? '—'}) | ${s.source?.fidelity ?? '—'} |`)
}
L.push('')

for (const [role, list] of byRole) {
  L.push(`## ${ROLE[role] ?? role}（${list.length} 篇）`)
  L.push('')
  for (const s of list) {
    L.push(`### \`${s.id}\` ${s.title}`)
    L.push('')
    L.push(`**前情**：${s.premise}`)
    L.push('')
    L.push(`**核心冲突**：${s.conflict_point ?? '—'}`)
    L.push('')
    L.push(`**来源**：[${s.source?.platform ?? '—'}](${s.source?.url ?? '#'})　·　可信度：\`${s.source?.fidelity ?? '—'}\`` +
      (s.tags?.length ? `　·　标签：${s.tags.join(' / ')}` : ''))
    L.push('')
    L.push('| 可扮演 | 位置 | 难度 | 要争的利益 | 现实结算 |')
    L.push('|---|---|---|---|---|')
    for (const p of s.protagonists ?? []) {
      const b = p.baseline ?? {}
      const inferred = typeof b.note === 'string' && b.note.includes('推演')
      L.push(`| **${p.name}** | ${p.position} | ${DIFF[p.difficulty] ?? p.difficulty} | ${p.goal} | ` +
        `${b.grade ?? '—'} (${b.main ?? '—'})${inferred ? ' 推演' : ' 原型'} |`)
    }
    L.push('')
    L.push(`**在场的人**：${(s.cast ?? []).map((c) => `${c.name}（${c.position}）`).join('　·　')}`)
    L.push('')
    L.push(`**最容易踩的坑**：${s.scoring?.trap ?? '—'}`)
    L.push('')
    L.push(`<details><summary>升级线（${(s.escalation ?? []).length} 个节点）</summary>`)
    L.push('')
    for (const [i, e] of (s.escalation ?? []).entries()) L.push(`${i + 1}. ${e}`)
    L.push('')
    L.push('</details>')
    L.push('')
  }
}

await writeFile(OUT, L.join('\n'), 'utf8')
console.log(`已写出 ${OUT}`)
console.log(`剧情 ${all.length} 篇，主角 ${all.reduce((n, s) => n + (s.protagonists?.length ?? 0), 0)} 个`)
for (const [role, list] of byRole) console.log(`  ${ROLE[role] ?? role}: ${list.length} 篇`)
