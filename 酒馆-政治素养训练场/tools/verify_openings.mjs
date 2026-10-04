/**
 * verify_openings.mjs — 校验副本开场与关卡正文是否符合「活场景 + 背景说明」规范。
 *
 * 不信任 agent 的自评：逐条自己查。
 *   1. 结构：活场景 / 分隔线 / 【背景】 / 派系 / 现状 / 考量
 *   2. 活场景必须有直接对白（「」或""），且不能为空
 *   3. 引导词：背景里不得出现判断性措辞
 *   4. 剧透：现状段不得写历史结局
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const ROOT = 'D:/开源团队作品/酒馆-政治素养训练场/04_剧情'

/** 引导倾向词：背景里出现即违规。 */
const LEADING = ['你应该', '你应该', '幸好', '危险的是', '关键是', '必须', '聪明的做法', '最好的选择', '明智', '上策', '下策', '切忌', '切记']

/** 结局词：出现在「现状」段里即疑似剧透。 */
const SPOILER = ['最终失败', '果然', '此后不久', '这一仗打输了', '从此一蹶不振']

const problems = []
const stats = { openings: 0, levels: 0, scanned: 0 }

/** 取出背景里的三节。 */
function sections(text) {
  const i = text.indexOf('【背景】')
  if (i < 0) return null
  const body = text.slice(i)
  const cut = (name) => {
    const a = body.indexOf(`\n${name}\n`)
    if (a < 0) return null
    const rest = body.slice(a + name.length + 2)
    const next = ['派系', '现状', '考量'].map((n) => rest.indexOf(`\n${n}\n`)).filter((x) => x >= 0)
    return next.length ? rest.slice(0, Math.min(...next)) : rest
  }
  return { 派系: cut('派系'), 现状: cut('现状'), 考量: cut('考量'), all: body }
}

function check(text, where) {
  if (typeof text !== 'string' || text.length < 120) {
    problems.push(`${where}: 过短或非字符串（${typeof text}）`)
    return
  }
  if (!text.includes('——————')) problems.push(`${where}: 缺分隔线`)
  if (!text.includes('【背景】')) problems.push(`${where}: 缺【背景】`)
  const s = sections(text)
  if (!s) return
  for (const name of ['派系', '现状', '考量']) {
    if (!s[name] || s[name].trim().length < 8) problems.push(`${where}: 【${name}】缺失或过短`)
  }
  // 活场景必须是对白
  const scene = text.slice(0, text.indexOf('——————'))
  if (!/[「」“”"]/.test(scene)) problems.push(`${where}: 活场景没有直接对白`)
  if (scene.trim().length < 40) problems.push(`${where}: 活场景过短`)
  // 活场景结尾必须留下一个可接的话头。
  // 两种合法收尾：① 直接引语收尾（问句）；② 明确的等待陈述（等你答／等着／没有走…）。
  // 只认问号是过严的——「他没有走，等你吩咐。」同样是合格的等待。
  const tail = scene.trim().slice(-26)
  const quoteEnd = /[？?」》"]$/.test(scene.trim())
  // 等待的写法很多：等你／等她／等一句答话／等一个答复／等人点头／等回话／没有走／电话没挂…
  // 判据放宽到「尾段出现『等』或明确的未了结动作」，避免把合格收尾误判成问题。
  const waitEnd = /等|没有走|没走|没挂|没挪步|不接话|没有人接话|没有说话|没有人说话|看着这边|望着这边|盯着这边|看着你/.test(tail)
  if (!quoteEnd && !waitEnd) {
    problems.push(`${where}: 活场景结尾既非问句也非明确的等待（结尾「${scene.trim().slice(-18)}」）`)
  }
  // 引导词
  for (const w of LEADING) {
    if (s.all.includes(w)) problems.push(`${where}: 背景含引导词「${w}」`)
  }
  // 剧透
  if (s.现状) {
    for (const w of SPOILER) {
      if (s.现状.includes(w)) problems.push(`${where}: 现状疑似剧透「${w}」`)
    }
  }
}

const dirs = [
  ['scenarios', 0],
  ['scenarios_v2', 0],
  ['scenarios_v3', 1],
]
for (const [dir] of dirs) {
  const full = path.join(ROOT, dir)
  for (const f of await readdir(full)) {
    if (!f.endsWith('.json')) continue
    let arr
    try {
      arr = JSON.parse(await readFile(path.join(full, f), 'utf8'))
    } catch (cause) {
      problems.push(`${dir}/${f}: JSON 解析失败 — ${String(cause).slice(0, 80)}`)
      continue
    }
    stats.scanned++
    for (const s of arr) {
      for (const [i, p] of (s.protagonists ?? []).entries()) {
        stats.openings++
        check(p.opening, `${s.id} 位置${i}(${p.name})`)
      }
      for (const ph of s.phases ?? []) {
        stats.levels++
        check(ph.situation, `${s.id} 关卡${ph.id}(${ph.name})`)
      }
    }
  }
}

console.log(`扫描 ${stats.scanned} 个场景文件 ｜ 开场 ${stats.openings} ｜ 关卡 ${stats.levels}`)
if (problems.length === 0) {
  console.log('✅ 全部通过')
} else {
  console.log(`❌ ${problems.length} 处问题：`)
  for (const p of problems) console.log('  - ' + p)
}
process.exit(problems.length === 0 ? 0 : 1)
