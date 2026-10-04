/**
 * prompt_weight.mjs — 量化一篇剧情给提示词带来的固定开销。
 *
 * 一份剧情卡有三处会长期占住上下文：
 *   1) 常驻世界书条目（进 standing 段，免 turn 预算，但每轮都在）；
 *   2) postHistoryInstructions（完整结算规则，覆盖预设 jailbreak 槽位）；
 *   3) description + scenario（角色定义段）。
 * 触发型条目只在对应 NPC 出场时才占位，这里单列不并入固定开销。
 *
 * 只读。字符数是实测值；token 给区间估计（中文常见分词器约 1 token / 1.0~1.2 字）。
 */
import { readFile } from 'node:fs/promises'

const LIB = 'file:///D:/开源团队作品/dsh-plugins/plugins/dsh-liketavern/lib'
const ws = await import(`${LIB}/state/workspace.js`)
const loreMod = await import(`${LIB}/state/lorebook.js`)

const root = process.env.DSH_HOME.replace(/\\/g, '/') + '/dsh-tavern/characters'
const items = await ws.listCharacters(root)

const rows = []
for (const it of items) {
  const card = (await ws.loadCharacter(root, it.cardId)).card
  const raw = JSON.parse(await readFile(`${root}/${it.cardId}/assets/character-book.json`, 'utf8'))
  const entries = loreMod.parseLorebook(raw, { source: 'character', sourceRef: it.name })

  const constant = entries.filter((e) => e.constant)
  const trigger = entries.filter((e) => !e.constant)
  const constChars = constant.reduce((n, e) => n + e.content.length, 0)
  const triggerChars = trigger.reduce((n, e) => n + e.content.length, 0)

  rows.push({
    id: it.gym?.scenarioId ?? it.name,
    name: it.name,
    constCount: constant.length,
    constChars,
    triggerCount: trigger.length,
    triggerChars,
    phi: card.postHistoryInstructions.length,
    desc: card.description.length,
    scen: card.scenario.length,
    // 固定开销 = 常驻 + postHistory + 角色定义段（description + scenario）
    fixed: constChars + card.postHistoryInstructions.length + card.description.length + card.scenario.length,
    biggestConst: constant.map((e) => [e.comment, e.content.length]).sort((a, b) => b[1] - a[1])[0],
  })
}

rows.sort((a, b) => b.fixed - a.fixed)

const tok = (n) => `${Math.round(n / 1.2)}~${n}`
/** 粗略 token 区间：中文约 1 token / 1.0~1.2 字。 */
const fmt = (n) => `${n} 字 ≈ ${Math.round(n / 1.2)}~${n} tok`

console.log('固定开销排序（常驻世界书 + 完整结算规则 + 角色定义段）\n')
console.log('剧情    固定开销        常驻条数/字数      结算规则      最大常驻条目')
for (const r of rows) {
  console.log(
    `${r.id.padEnd(6)} ${String(r.fixed).padStart(6)} 字  ` +
    `${String(r.constCount).padStart(2)}条/${String(r.constChars).padStart(5)}字  ` +
    `${String(r.phi).padStart(5)}字  ` +
    `${r.biggestConst[0]}(${r.biggestConst[1]}字)`,
  )
}

const sum = rows.reduce((n, r) => n + r.fixed, 0)
const max = rows[0]
console.log(`\n20 篇合计固定开销: ${sum} 字 ≈ ${fmt(sum)}`)
console.log(`最重一篇: ${max.id} ${max.name} → ${fmt(max.fixed)}`)
console.log(`最轻一篇: ${rows[rows.length - 1].id} → ${fmt(rows[rows.length - 1].fixed)}`)
console.log(`\n（触发型条目不计入固定开销：每篇 ${rows[0].triggerCount}~${Math.max(...rows.map((r) => r.triggerCount))} 条，`)
console.log(`  合计 ${rows[0].triggerChars}~${Math.max(...rows.map((r) => r.triggerChars))} 字，只在对应 NPC 出场时占位）`)

// 最大常驻条目是哪个
const biggest = rows.map((r) => r.biggestConst).sort((a, b) => b[1] - a[1])[0]
console.log(`\n全局最大的常驻条目: 「${biggest[0]}」${biggest[1]} 字`)
