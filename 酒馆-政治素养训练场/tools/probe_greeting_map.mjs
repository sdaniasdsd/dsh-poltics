/**
 * probe_greeting_map.mjs — 验证「选择扮演主角」的底层映射是否正确。
 *
 * 整个功能的假设是：`binding.greetingIndex = N` ⟺ 用户扮演剧情 JSON 里的第 N 个主角。
 * 这个假设此前从未验证过——如果错一位，用户就会扮演错的人，而且 UI 上完全看不出来。
 *
 * 做法：对每张真实卡片，用插件自己的 cardGreetingVariants + pickGreetingText
 * 取出每个下标对应的开场白，与源 JSON 里该主角的 opening 逐字对表。
 *
 * 附带：验证 NPC 名字出现在「助手消息」里时，其隐藏诉求也会被世界书激活
 * （NPC 自己开口时同样应当触发，不能只认用户发言）。
 *
 * 只读。
 */
import { readFile, readdir } from 'node:fs/promises'

const LIB = 'file:///D:/开源团队作品/dsh-plugins/plugins/dsh-liketavern/lib'
const ws = await import(`${LIB}/state/workspace.js`)
const gl = await import(`${LIB}/core/greetingLog.js`)
const lb = await import(`${LIB}/state/lorebook.js`)
const wiMod = await import(`${LIB}/core/worldbook.js`)

const GYM = 'D:/开源团队作品/酒馆-政治素养训练场/04_剧情/scenarios'
const root = process.env.DSH_HOME.replace(/\\/g, '/') + '/dsh-tavern/characters'

// 源 JSON：剧情 id → protagonists
const source = new Map()
for (const f of (await readdir(GYM)).filter((x) => x.endsWith('.json'))) {
  for (const s of JSON.parse(await readFile(`${GYM}/${f}`, 'utf8'))) source.set(s.id, s)
}

const items = await ws.listCharacters(root)
let checked = 0
const problems = []

console.log('=== 一、主角下标 → 开场白 映射 ===\n')
for (const it of items) {
  const card = (await ws.loadCharacter(root, it.cardId)).card
  const gym = card.extensions?.['tavern-gym']
  const scenario = source.get(gym?.scenarioId)
  if (!scenario) { problems.push(`${gym?.scenarioId}: 源 JSON 里找不到对应剧情`); continue }

  const variants = gl.cardGreetingVariants(card.firstMes, card.alternateGreetings)
  if (variants.length !== scenario.protagonists.length) {
    problems.push(`${gym.scenarioId}: 变体数 ${variants.length} ≠ 主角数 ${scenario.protagonists.length}`)
  }
  for (let i = 0; i < scenario.protagonists.length; i++) {
    const p = scenario.protagonists[i]
    const got = gl.pickGreetingText(variants, i)
    const want = (p.opening ?? '').trim()
    const ok = got === want
    if (!ok) problems.push(`${gym.scenarioId} 下标 ${i}（${p.name}）取到的开场白与源 JSON 不一致`)
    // 元数据表里的下标也要对上
    const meta = gym.protagonists.find((m) => m.index === i)
    if (!meta || meta.name !== p.name) problems.push(`${gym.scenarioId} 下标 ${i}: 元数据主角名「${meta?.name}」≠ 源「${p.name}」`)
    if (i < 2 || !ok) {
      console.log(`  ${gym.scenarioId} [${i}] ${(meta?.name ?? '?').padEnd(14)} ${ok ? '✅' : '❌'}  ${got.slice(0, 26)}…`)
    }
    checked++
  }
}

console.log(`\n共核对 ${checked} 个（剧情 × 主角）下标映射`)
console.log(problems.length === 0 ? '映射全部一致。' : `发现 ${problems.length} 处问题：`)
for (const p of problems.slice(0, 20)) console.log('  ✗', p)

// ---------------------------------------------------------------------------
console.log('\n=== 二、NPC 名字出现在助手消息里时是否触发 ===\n')
const pick = items.find((i) => i.gym?.scenarioId === 'E-10') ?? items[0]
const raw = JSON.parse(await readFile(`${root}/${pick.cardId}/assets/character-book.json`, 'utf8'))
const entries = lb.parseLorebook(raw, { source: 'character', sourceRef: pick.name })
const trigger = entries.filter((e) => !e.constant && e.keys.length > 0)
const key = trigger[0].keys[0]

const settings = {
  scanDepth: 4, minActivations: 0, maxScanDepth: 0, contextPercent: 100, tokenBudget: 200000,
  recursiveScan: true, maxRecursionSteps: 0, caseSensitive: false, matchWholeWords: false,
  includeNames: false, overflowWarning: true, characterStrategy: 1, useGroupScoring: true,
}
const activate = (messages) => wiMod.evaluateWorldInfo({
  entries, messages, settings, timerState: { stickyLeft: {}, cooldownLeft: {} },
  contextWindowTokens: 128000, reservedTokens: 0, estimateTokens: (t) => t.length, random: () => 0.5,
}).activated.map((a) => a.entry.comment).filter((x) => x.startsWith('隐藏诉求：'))

const cases = [
  ['用户发言提到', [{ role: 'user', content: `我想跟${key}谈谈。` }]],
  ['助手（NPC）发言提到', [{ role: 'user', content: '你好。' }, { role: 'assistant', content: `${key}推门进来了。` }]],
  ['更早的历史里提到', [{ role: 'user', content: `${key}昨天来过。` }, { role: 'assistant', content: '嗯。' }, { role: 'user', content: '今天呢？' }]],
  ['完全没提', [{ role: 'user', content: '今天天气不错。' }]],
]
for (const [label, messages] of cases) {
  const hit = activate(messages)
  console.log(`  ${label.padEnd(16)} → ${hit.length ? hit.join('、') : '（无）'}`)
}
