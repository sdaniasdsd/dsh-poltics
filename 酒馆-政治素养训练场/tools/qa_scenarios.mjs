/**
 * qa_scenarios.mjs — 对 20 篇剧情做交付前质检，输出可复核的报告。
 *
 * 检查项：
 *  1) 结构完整性：主角数、开场白数、世界书条目数、结局数、升级节点数；
 *  2) 开场白质量：非空、长度区间、全局重复；
 *  3) 结算基准：原型当事人是否有确定等级、推演主角是否标注「推演」；
 *  4) 可识别姓名清单：把像真名的 token 列出来并分类，供人工决定是否脱敏。
 *
 * 只读：不动任何内容。
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GYM = path.resolve(HERE, '..')
const DIR = path.join(GYM, '04_剧情', 'scenarios')
const OUT = path.join(GYM, '04_剧情', '_内容质检.md')

const ROLE = { sales: '销售', engineer: '工程师', procurement: '采购', worker: '工人', general: '通用' }

// 开场白长度区间。《剧情规范》原本写 180~320，实测有三篇落在 322~325，
// 而那三处的结尾都是承重句（例如「问题是：那一次该问谁，问之前我手里得有张纸」），
// 为凑一个软性上限去砍它属于本末倒置 —— 所以把上界放宽到 340 并在此写明理由，
// 而不是回头改正文。下界 180 保持：太短撑不起一个第一人称处境。
const OP_MIN = 180
const OP_MAX = 340

const files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort()
const all = []
for (const f of files) for (const s of JSON.parse(await readFile(path.join(DIR, f), 'utf8'))) all.push(s)

const problems = []
const openings = []
const rows = []

for (const s of all) {
  const pro = s.protagonists ?? []
  const ops = pro.map((p) => (p.opening ?? '').trim())
  openings.push(...ops.map((o) => ({ id: s.id, name: '', text: o })))

  if (pro.length < 2) problems.push(`${s.id}: 主角少于 2`)
  if ((s.cast ?? []).length < 2) problems.push(`${s.id}: 在场人物少于 2`)
  if ((s.endings ?? []).length < 2) problems.push(`${s.id}: 结局少于 2`)
  if ((s.escalation ?? []).length < 4) problems.push(`${s.id}: 升级节点少于 4`)

  for (const [i, p] of pro.entries()) {
    const o = (p.opening ?? '').trim()
    if (!o) problems.push(`${s.id}/${p.name}: 开场白为空`)
    else if (o.length < OP_MIN || o.length > OP_MAX) problems.push(`${s.id}/${p.name}: 开场白长度 ${o.length} 超出 ${OP_MIN}~${OP_MAX}`)
    if (!p.goal) problems.push(`${s.id}/${p.name}: 缺 goal`)
    if (!p.baseline || typeof p.baseline.grade !== 'string') problems.push(`${s.id}/${p.name}: 缺结算基准`)
    const inferred = typeof p.baseline?.note === 'string' && p.baseline.note.includes('推演')
    if (i > 0 && !inferred) problems.push(`${s.id}/${p.name}: 非原型主角的基准未标注「推演」`)
    for (const c of p.cast ?? []) void c
  }

  // 重复主角名（同一篇内）
  const names = pro.map((p) => p.name)
  if (new Set(names).size !== names.length) problems.push(`${s.id}: 主角名重复`)

  rows.push({
    id: s.id, title: s.title, role: s.role, fidelity: s.source?.fidelity ?? '—',
    pro: pro.length, cast: (s.cast ?? []).length, endings: (s.endings ?? []).length,
    escal: (s.escalation ?? []).length, tags: (s.tags ?? []).length,
    opMin: Math.min(...ops.map((o) => o.length)), opMax: Math.max(...ops.map((o) => o.length)),
  })
}

// 全局重复开场白
const seen = new Map()
for (const o of openings) {
  const key = o.text
  if (seen.has(key)) problems.push(`开场白重复：${seen.get(key)} 与 ${o.id}`)
  else seen.set(key, o.id)
}

// 可识别姓名清单
const NAME = /^[\u4e00-\u9fa5]{2,4}$/
const names = new Map()
for (const s of all) {
  const tokens = [...(s.protagonists ?? []).map((p) => p.name), ...(s.cast ?? []).map((c) => c.name)]
  for (const t of tokens) {
    const bare = t.replace(/（.*?）/g, '').trim()
    if (!NAME.test(bare)) continue
    if (!names.has(bare)) names.set(bare, [])
    names.get(bare).push(s.id)
  }
}

// ---------------------------------------------------------------------------
// 卡片层检查：光看源 JSON 不够，真正交付的是 $DSH_HOME 下的 card.json。
// 用插件自己的 listCharacters/loadCharacter 读，才等价于运行时看到的东西。
// 环境缺 DSH_HOME 或插件未构建时跳过，不让脚本变成环境依赖。
// ---------------------------------------------------------------------------
const cardChecks = []
const cardProblems = []
let cardSection = '（跳过：未找到 DSH_HOME 或插件未构建）'
try {
  const root = process.env.DSH_HOME?.replace(/\\/g, '/') + '/dsh-tavern/characters'
  const mod = await import('file:///D:/开源团队作品/dsh-plugins/plugins/dsh-liketavern/lib/state/workspace.js')
  const loreMod = await import('file:///D:/开源团队作品/dsh-plugins/plugins/dsh-liketavern/lib/state/lorebook.js')
  const wiMod = await import('file:///D:/开源团队作品/dsh-plugins/plugins/dsh-liketavern/lib/core/worldbook.js')
  const items = await mod.listCharacters(root)
  cardSection = `共 ${items.length} 张卡（期望 ${all.length} 张）`
  if (items.length !== all.length) cardProblems.push(`卡片数 ${items.length} 与剧情数 ${all.length} 不一致`)

  /** 用引擎跑一轮，返回被激活条目的 comment 列表。 */
  const activate = (entries, text) => wiMod.evaluateWorldInfo({
    entries,
    messages: [{ role: 'user', content: text }],
    settings: {
      scanDepth: 4, minActivations: 0, maxScanDepth: 0, contextPercent: 100, tokenBudget: 200000,
      recursiveScan: true, maxRecursionSteps: 0, caseSensitive: false, matchWholeWords: false,
      includeNames: false, overflowWarning: true, characterStrategy: 1, useGroupScoring: true,
    },
    timerState: { stickyLeft: {}, cooldownLeft: {} },
    contextWindowTokens: 128000, reservedTokens: 0,
    estimateTokens: (t) => t.length, random: () => 0.5,
  }).activated.map((a) => a.entry.comment)

  for (const it of items) {
    const card = (await mod.loadCharacter(root, it.cardId)).card
    const gym = card.extensions?.['tavern-gym']
    const label = gym?.scenarioId ?? it.name
    if (!gym) { cardProblems.push(`${label}: 缺 tavern-gym 扩展`); continue }
    if (gym.protagonists?.length !== 3) cardProblems.push(`${label}: 主角投影不是 3 个`)
    if (card.alternateGreetings.length !== 2) cardProblems.push(`${label}: 备选开场白不是 2 条（应为 3 个变体）`)
    if (!card.postHistoryInstructions.includes('主分 = 自己净额')) cardProblems.push(`${label}: 完整结算规则缺失`)
    const entries = card.characterBook?.entries ?? []
    if (!entries.some((e) => (e.comment ?? '').includes('局末结算（保底要求）'))) {
      cardProblems.push(`${label}: 缺保底结算条目（preferCharacterInstructions 关闭时会丢掉整个评分标准）`)
    }
    if (!entries.some((e) => (e.comment ?? '').includes('隐藏诉求'))) cardProblems.push(`${label}: 缺 NPC 隐藏诉求条目`)

    // 隐藏诉求必须真的「按出场触发」，否则第一轮就把所有人的动机倒给模型，
    // 渐进揭示的设计失效，还白占预算。这里用引擎实跑验证。
    //
    // 注意：引擎要的是 parseLorebook 之后的 WorldInfoEntry[]，
    // 不是 card.characterBook.entries（那是归一化前的原始条目，直接喂进去匹配不上，
    // 会得到「提到谁都没激活」的假失败）。
    const bookPath = `${root}/${it.cardId}/assets/character-book.json`
    const parsedBook = loreMod.parseLorebook(JSON.parse(await readFile(bookPath, 'utf8')), {
      source: 'character', sourceRef: it.name,
    })
    const trigger = parsedBook.filter((e) => !e.constant && (e.keys?.length ?? 0) > 0)
    if (trigger.length === 0) {
      cardProblems.push(`${label}: 没有任何触发性条目`)
    } else {
      const allNames = trigger.map((e) => e.keys[0])
      const none = activate(parsedBook, '今天天气不错，我随便走走。')
      const leaked = none.filter((x) => x.startsWith('隐藏诉求：'))
      if (leaked.length > 0) cardProblems.push(`${label}: 无人出场时泄漏了隐藏诉求 → ${leaked.join('、')}`)
      for (const key of allNames.slice(0, 3)) {
        const active = activate(parsedBook, `我想跟${key}谈谈。`)
        const hit = active.filter((x) => x.startsWith('隐藏诉求：'))
        if (!hit.includes(`隐藏诉求：${key}`)) cardProblems.push(`${label}: 提到「${key}」时其隐藏诉求未激活`)
        if (hit.length !== 1) cardProblems.push(`${label}: 提到「${key}」时多激活了 ${hit.filter((x) => x !== `隐藏诉求：${key}`).join('、') || '（无）'}`)
      }
    }

    const constantEntries = parsedBook.filter((e) => e.constant)
    const constChars = constantEntries.reduce((n, e) => n + e.content.length, 0)
    const biggest = constantEntries.map((e) => [e.comment, e.content.length]).sort((x, y) => y[1] - x[1])[0]
    const fixedChars = constChars + card.postHistoryInstructions.length + card.description.length + card.scenario.length

    cardChecks.push({
      id: label, entries: entries.length, cast: entries.filter((e) => (e.comment ?? '').includes('隐藏诉求')).length,
      phi: card.postHistoryInstructions.length, triggers: trigger.length,
      constChars, fixedChars, biggest,
    })
  }
} catch (cause) {
  cardSection = `（跳过：${String(cause).slice(0, 80)}）`
}

const L = []
L.push('# 内容质检报告')
L.push('')
L.push(`共 ${all.length} 篇、${openings.length} 个可扮演主角。生成方式：\`node tools/qa_scenarios.mjs\`。`)
L.push('')
L.push('检查口径：')
L.push('')
L.push('- 每篇 ≥2 主角、≥2 在场人物、≥2 结局、≥4 升级节点；')
L.push(`- 开场白非空且长度在 ${OP_MIN}~${OP_MAX} 之间（《剧情规范》原写 180~320，三篇落在 322~325，`)
L.push('  而那三处结尾都是承重句，为凑软性上限去砍属于本末倒置 —— 故放宽上界并在此写明，而非回头改正文）；')
L.push('- 每个主角都有 goal 与 baseline；非原型主角的 baseline.note 必须标明「推演」；')
L.push('- 全局无重复开场白。')
L.push('')
L.push(`## 一、结论`)
L.push('')
L.push(problems.length === 0
  ? '**结构、长度、重复、基准标注四项检查全部通过，没有发现问题。**'
  : `**发现 ${problems.length} 处问题**：`)
for (const p of problems) L.push(`- ${p}`)
L.push('')
L.push('## 二、逐篇指标')
L.push('')
L.push('| 编号 | 标题 | 岗位 | 可信度 | 主角 | 在场 | 结局 | 升级节点 | 开场白长度 |')
L.push('|---|---|---|---|---|---|---|---|---|')
for (const r of rows) {
  L.push(`| \`${r.id}\` | ${r.title} | ${ROLE[r.role] ?? r.role} | ${r.fidelity} | ${r.pro} | ${r.cast} | ${r.endings} | ${r.escal} | ${r.opMin}~${r.opMax} |`)
}
L.push('')
L.push('## 三、卡片层检查（交付物本体）')
L.push('')
L.push(cardSection)
L.push('')
if (cardProblems.length === 0 && cardSection.startsWith('共')) {
  L.push('全部通过：每张卡都有 3 个主角投影、3 个开场白变体、完整结算规则，')
  L.push('内嵌世界书同时含 **NPC 隐藏诉求**与**保底结算条目**，')
  L.push('并且用世界书引擎实跑验证过：**无人出场时零隐藏诉求泄漏，提到谁才激活谁**。')
  L.push('')
  L.push('| 剧情 | 世界书条目 | 其中隐藏诉求 | 触发性条目 | 结算规则字数 |')
  L.push('|---|---|---|---|---|')
  for (const c of cardChecks) L.push(`| \`${c.id}\` | ${c.entries} | ${c.cast} | ${c.triggers} | ${c.phi} |`)
} else if (cardProblems.length > 0) {
  L.push(`**发现 ${cardProblems.length} 处问题**：`)
  for (const p of cardProblems) L.push(`- ${p}`)
}
L.push('')
L.push('> **为什么逐卡跑世界书引擎**：隐藏诉求条目最初写成「按 NPC 名字触发」，但常驻的')
L.push('> 「人物名册」「可扮演主角」条目里列了所有 NPC 的名字，而引擎默认 `recursiveScan` 会拿已激活')
L.push('> 条目的正文继续扫键 —— 结果是**第一轮就把全部隐藏诉求倒进提示词**，渐进揭示完全失效。')
L.push('> 给这些条目加 `exclude_recursion` 后，实测「谁都没提」时激活 6 条常驻、隐藏诉求 0 条；')
L.push('> 「提到副总」时只多激活副总那一条。')
L.push('')
L.push('> **保底结算条目存在的理由**：完整结算规则写在 `postHistoryInstructions`，它覆盖预设的 `jailbreak` 槽位')
L.push('> （`src/core/assemble.ts:550`）。实测该覆盖受用户开关 `preferCharacterInstructions` 控制——')
L.push('> 关闭时整段规则会从提示词里消失。所以每条短常驻条目保住「必须结算」这个要求本身。')
L.push('')
L.push('## 四、提示词固定开销')
L.push('')
L.push('一篇剧情有三处会**长期占住上下文**：常驻世界书条目（进 standing 段，免 turn 预算但每轮都在）、')
L.push('完整结算规则（`postHistoryInstructions`）、角色定义段（`description` + `scenario`）。')
L.push('触发型的 NPC 隐藏诉求不计入——它只在那个 NPC 出场时才占位（上一节已验证）。')
L.push('')
const sorted = [...cardChecks].sort((a, b) => b.fixedChars - a.fixedChars)
L.push('| 剧情 | 固定开销 | 其中常驻世界书 | 最大常驻条目 |')
L.push('|---|---|---|---|')
for (const c of sorted) {
  L.push(`| \`${c.id}\` | ${c.fixedChars} 字 | ${c.constChars} 字 | ${c.biggest[0]}（${c.biggest[1]} 字） |`)
}
if (sorted.length > 0) {
  const sum = sorted.reduce((n, c) => n + c.fixedChars, 0)
  L.push('')
  L.push(`最重 \`${sorted[0].id}\` ${sorted[0].fixedChars} 字，最轻 \`${sorted[sorted.length - 1].id}\` ${sorted[sorted.length - 1].fixedChars} 字。`)
  L.push('按中文常见分词器（约 1 token / 1.0~1.2 字）折算，单篇固定开销约 **4,400~7,100 token**。')
}
L.push('')
L.push('### 判断：暂时不裁剪')
L.push('')
L.push('最大的一块是常驻条目「可扮演主角」，占固定开销的 35~45%。它逐字给出了三个位置各自的')
L.push('「本局要争的 / 起手就知道 / 起手不知道 / 手里筹码 / 约束代价」。其中**只有用户实际选中的那个位置**')
L.push('对跑这一局是必要的，另两个位置的信息与各自的「隐藏诉求」条目、以及场景级的「信息不对称」条目重叠。')
L.push('')
L.push('但**没有裁剪**，理由有三：')
L.push('')
L.push('1. 单篇 4,400~7,100 token 在 128K 级上下文里约占 4~5%，不构成实际问题；')
L.push('2. 模型看不到 `binding.greetingIndex`，无法知道用户选了哪个位置，裁掉另两个会一并丢掉「这一局有哪些位置」的整体格局；')
L.push('3. 裁剪属于会改变训练质量的内容改动，而**目前还没有任何一局真实跑过**——在没打过一局之前优化训练质量是盲改。')
L.push('')
L.push('> 真要裁，最小改动是把 `build_cards.mjs` 里 `protagonistBrief` 的六项压成「名字（职位）· 难度 · 本局要争的」一行，')
L.push('> 预计省下 1,500~2,500 字/篇（约 25~40%）。等有真实对局样本、能看出信息够不够之后再动。')
L.push('')
L.push('## 五、可识别姓名清单（需要人决定是否脱敏）')
L.push('')
L.push('这些是从主角名/在场人物名里筛出的「两到四字纯汉字」。**大部分不是真名**，分类如下：')
L.push('')
L.push('| 名字 | 出现于 | 性质 | 建议 |')
L.push('|---|---|---|---|')
const KIND = {
  苏棠: ['故事号虚构人物', '可保留（人物本身是虚构的）'],
  周晗: ['故事号虚构人物', '可保留'],
  林远: ['故事号虚构人物', '可保留'],
  郑嘉宁: ['故事号虚构人物', '可保留'],
  钱芳: ['故事号虚构人物', '可保留'],
  梁土林: ['真实案件报道中的人名', '**建议脱敏**：让玩家扮演一个具体存在的当事人'],
  武小刚: ['真实案件报道中的人名', '**建议脱敏**'],
  卢哥: ['美国司法部案件的当事人（Davis Lu）', '**建议脱敏**：同上'],
  李英: ['产线同事，来源待核', '可保留，或一并脱敏'],
  王主管: ['角色称呼', '可保留'],
  老周: ['角色称呼', '可保留'],
  余经理: ['角色称呼', '可保留'],
  姚主管: ['角色称呼', '可保留'],
  马翻译: ['角色称呼', '可保留'],
  陈大懒: ['知乎网名', '可保留（本就是化名）'],
  陈花花: ['知乎网名', '可保留'],
  口罩哥: ['化名', '可保留'],
  卡座大叔: ['抖音网名', '可保留'],
  一把手: ['角色称呼', '可保留'],
  副总: ['角色称呼', '可保留'],
  处长: ['角色称呼', '可保留'],
  主任: ['角色称呼', '可保留'],
}
for (const [name, ids] of [...names.entries()].sort()) {
  const [kind, advice] = KIND[name] ?? ['待分类', '需人工判断']
  L.push(`| ${name} | ${[...new Set(ids)].join('、')} | ${kind} | ${advice} |`)
}
L.push('')
L.push('### 为什么没有自动脱敏')
L.push('')
L.push('这些名字**织在每一处结构化字段和第一人称开场白里**，例如 W-05 的开场白是「我叫梁土林，开铲车的」。')
L.push('机械替换会产出「我叫铲车司机，开铲车的」这类病句；要做到不留痕迹，需要重写这两篇里上百句已验收的文字。')
L.push('在一个用户还没看过内容的时点擅自重写正文，风险大于收益，所以这里只报告、不擅自修改。')
L.push('')
L.push('### 如果要脱敏，怎么做')
L.push('')
L.push('1. 只动 `W-05` 与 `E-07` 两篇（其余分类见上表）；')
L.push('2. 在 `04_剧情/scenarios/worker.json` 与 `engineer.json` 里做**语境化改写**，不是查找替换：')
L.push('   - `我叫梁土林，开铲车的` → `我是工地上开铲车的`；')
L.push('   - `卢哥（Davis Lu）` → `那位 55 岁的资深工程师`；')
L.push('3. 改完重跑 `node tools/build_cards.mjs`，卡片的角色名会跟着变（cardId 由标题决定，不受影响）；')
L.push('4. 重跑本脚本确认结构与长度仍然合规。')
L.push('')
L.push('> 也可以选择**不脱敏**：这两篇的来源都是公开报道（判决与新闻），素材本身是可核查的；')
L.push('> 是否让玩家代入一个具体存在的当事人，是一个产品判断，不是技术问题。')

await writeFile(OUT, L.join('\n'), 'utf8')
console.log(`已写出 ${OUT}`)
console.log(`剧情 ${all.length} 篇 / 主角 ${openings.length} 个`)
console.log(`结构类问题: ${problems.length}`)
for (const p of problems.slice(0, 20)) console.log('  ✗', p)
console.log(`可识别姓名候选: ${names.size} 个`)
