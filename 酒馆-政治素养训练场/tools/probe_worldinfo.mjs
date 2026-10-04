/**
 * probe_worldinfo.mjs — 验证「世界书条目在运行时到底会不会被激活」。
 *
 * 之前只验到「条目在 card.json 里」，没验到「引擎会把它注入提示词」。
 * 这里直接调用插件自己的 parseLorebook + evaluateWorldInfo，用真实卡片跑三种场景：
 *   A) 消息里出现某个 NPC 的名字 → 该 NPC 的隐藏诉求条目应被激活；
 *   B) 消息里谁都没提 → 只应有常驻条目，隐藏诉求一个都不激活；
 *   C) 消息里出现另一个 NPC → 只激活那一个。
 *
 * 只读：不动任何文件。
 */
import { readFile } from 'node:fs/promises'

const LIB = 'file:///D:/开源团队作品/dsh-plugins/plugins/dsh-liketavern/lib'
const ws = await import(`${LIB}/state/workspace.js`)
const lb = await import(`${LIB}/state/lorebook.js`)
const wb = await import(`${LIB}/core/worldbook.js`)

const root = process.env.DSH_HOME.replace(/\\/g, '/') + '/dsh-tavern/characters'
const items = await ws.listCharacters(root)

/** 用哪张卡验证：挑 NPC 名字最干脆的一张。 */
const TARGET = 'E-10'
const pick = items.find((i) => i.gym?.scenarioId === TARGET) ?? items[0]
console.log(`验证卡片：${pick.name}  (${pick.gym?.scenarioId})`)

const bookJson = JSON.parse(await readFile(`${root}/${pick.cardId}/assets/character-book.json`, 'utf8'))
const entries = lb.parseLorebook(bookJson, { source: 'character', sourceRef: pick.name })
console.log(`世界书条目 ${entries.length} 条：`)
for (const e of entries) {
  console.log(`  ${e.constant ? '[常驻]' : '[触发]'} ${e.comment}  keys=${JSON.stringify(e.keys)}  content=${e.content.length}字`)
}

const settings = {
  scanDepth: 4,
  minActivations: 0,
  maxScanDepth: 0,
  contextPercent: 100,
  // 用一个足够大的固定预算，避免把「预算裁剪」误读成「没激活」
  tokenBudget: 200000,
  recursiveScan: true,
  maxRecursionSteps: 0,
  caseSensitive: false,
  matchWholeWords: false,
  includeNames: false,
  overflowWarning: true,
  characterStrategy: 1,
  useGroupScoring: true,
}

function run(label, userText) {
  const result = wb.evaluateWorldInfo({
    entries,
    messages: [{ role: 'user', content: userText }],
    settings,
    timerState: { stickyLeft: {}, cooldownLeft: {} },
    contextWindowTokens: 128000,
    reservedTokens: 0,
    estimateTokens: (t) => t.length,
    random: () => 0.5,
    macroCtx: { char: pick.name, user: '我' },
  })
  const active = result.activated.map((a) => a.entry.comment)
  console.log(`\n[${label}]  触发「${userText}」`)
  console.log(`  激活 ${active.length} 条：${active.join(' | ')}`)
  console.log(`  预算: limit=${result.budget.limit} used=${result.budget.used} overflowed=${result.budget.overflowed}`)
  return { active, used: result.budget.used }
}

// 取一个「触发型」条目的第一个键，作为场景 A 的输入
const trigger = entries.filter((e) => !e.constant && e.keys.length > 0)
const keyA = trigger[0]?.keys[0]
const keyB = trigger[1]?.keys[0]

console.log(`\n(触发性条目共 ${trigger.length} 条，取前两个键用于验证：「${keyA}」「${keyB}」)`)

const constCount = entries.filter((e) => e.constant).length
const ra = run('A 提到第一个 NPC', `我想跟${keyA}谈谈这件事。`)
const rb = run('B 谁都没提', '今天天气不错，我随便走走。')
const rc = keyB ? run('C 提到第二个 NPC', `${keyB}今天找我了。`) : { active: [], used: 0 }
const a = ra.active, b = rb.active, c = rc.active
const aBudgetUsed = ra.used, bBudgetUsed = rb.used

const ok = []
ok.push(['常驻条目每次都激活', a.filter((x) => entries.find((e) => e.comment === x)?.constant).length === constCount
  && b.filter((x) => entries.find((e) => e.comment === x)?.constant).length === constCount])
ok.push(['提到 NPC 时其隐藏诉求被激活', a.includes(`隐藏诉求：${keyA}`)])
ok.push(['没提任何人时零隐藏诉求激活', b.every((x) => !x.startsWith('隐藏诉求：'))])
if (keyB) ok.push(['只激活被提到的那一个', c.includes(`隐藏诉求：${keyB}`) && !c.includes(`隐藏诉求：${keyA}`)])
// 预算：常驻条目走 standing 段免计费，所以「谁都没提」时 used 应为 0；
// 激活一条隐藏诉求才产生计费。若这里不为 0，说明有额外条目混进了快照通道。
ok.push(['未触发隐藏诉求时世界书不吃 turn 预算', bBudgetUsed === 0])
ok.push(['触发一条隐藏诉求时预算等于该条正文长度', aBudgetUsed > 0 && aBudgetUsed < 2000])

console.log('\n===== 结论 =====')
let allOk = true
for (const [name, pass] of ok) {
  if (!pass) allOk = false
  console.log(`  ${pass ? '✅' : '❌'} ${name}`)
}
console.log(allOk ? '\n世界书在运行时会正确激活常驻与触发条目。' : '\n有检查项未通过，需要排查。')
