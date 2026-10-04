/**
 * build_cards.mjs — 把 04_剧情/scenarios/*.json 转成 dsh-liketavern 的角色卡。
 *
 * 关键设计：不手写"归一化 card.json"，而是先构造 ST 格式卡，
 * 再调用插件自己的 parseJsonCard() 归一化、hydrateStoredCard() 回读校验。
 * 这样磁盘形状永远与插件 importCard 的产出一致，不依赖对格式的猜测。
 *
 * 用法：
 *   node tools/build_cards.mjs            # 转换并写入
 *   node tools/build_cards.mjs --dry      # 只校验，不写入
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GYM = path.resolve(HERE, '..')
const SCENARIO_DIR = path.join(GYM, '04_剧情', 'scenarios')
const PLUGIN = 'D:/开源团队作品/dsh-plugins/plugins/dsh-liketavern'
const DSH_HOME = process.env.DSH_HOME
if (!DSH_HOME) throw new Error('缺少 DSH_HOME 环境变量')
const CHAR_ROOT = path.join(DSH_HOME, 'dsh-tavern', 'characters')
const DRY = process.argv.includes('--dry')

const cardMod = await import(new URL(`file:///${PLUGIN}/lib/state/card.js`).href)
const { parseJsonCard, hydrateStoredCard } = cardMod

/** 与插件 sanitizeCardName 同口径：小写、非 [a-z0-9一-龥] 归并为 '-'、限长 24。 */
function sanitizeCardName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '')
}

/**
 * 确定性 cardId（插件用随机后缀避免同名覆盖；这里是内容管线，
 * 要求同一篇剧情每次重建落到同一目录，所以用固定盐的哈希）。
 */
function stableCardId(scenario) {
  const base = sanitizeCardName(scenario.title) || 'card'
  const suffix = createHash('sha1').update(`${scenario.id}|${scenario.title}`).digest('hex').slice(0, 8)
  return `${base}-${suffix}`
}

function bullet(lines, empty = '（未提及）') {
  const arr = (lines ?? []).filter((x) => typeof x === 'string' && x.trim() !== '')
  if (arr.length === 0) return empty
  return arr.map((x) => `- ${x.trim()}`).join('\n')
}

function npcRoster(cast) {
  return (cast ?? [])
    .map((c) => `**${c.name}**（${c.position}）\n表面：${c.surface}\n筹码：${c.leverage}`)
    .join('\n\n')
}

function protagonistBrief(p, index) {
  return [
    `### 主角 ${index + 1}：${p.name}（${p.position}）｜难度：${p.difficulty}`,
    `**本局你要争的**：${p.goal}`,
    `**起手就知道**：\n${bullet(p.knows)}`,
    `**起手不知道**：\n${bullet(p.unaware)}`,
    `**起手筹码**：\n${bullet(p.leverage)}`,
    `**约束与代价**：\n${bullet(p.constraints)}`,
    `**现实结算基准**：${p.baseline?.grade ?? '—'}（主分 ${p.baseline?.main ?? '—'}）— ${p.baseline?.note ?? ''}`,
  ].join('\n')
}

/** 结算规则：写进 postHistoryInstructions，局末由模型按表结算。 */
function judgeRules(scenario) {
  const s = scenario.scoring ?? {}
  return [
    '# 本局结算规则（局末必须执行）',
    '',
    '当用户表示「结算 / 结束 / 我这一局怎么样」时，你必须按下面的表逐项填写，禁止只给一句笼统评价。',
    '',
    '## 第一步：利益记账表',
    '| 序号 | 受益方（自己/他人:谁） | 类别 | 事项 | 量级 | 是否兑现 | 归因 |',
    '|---|---|---|---|---|---|---|',
    '（逐项填写。类别只能取：经济性/发展性/关系性/安全性/自主性/他人性。量级取 +3~−3。未兑现按 0.5 折算。）',
    '',
    '## 第二步：代价与风险敞口',
    '- 代价表：时间/关系/机会/道德合规，逐项折算',
    '- 风险敞口：无 / 轻微(−0.5) / 中度(−1.5) / 重大(−3 且一票降级)',
    '',
    '## 第三步：主分与等级',
    '主分 = 自己净额 + 0.8 × 他人净额',
    '等级：S ≥6 ｜ A 4~5.9 ｜ B 2~3.9 ｜ C 0.5~1.9 ｜ D −0.4~0.4 ｜ E −3~−0.5 ｜ F < −3',
    '',
    '## 必须遵守的判定细则',
    '- R1 情绪收益不计分。「他当场没话说」「我出了口气」记 0。',
    '- R2 未兑现的利益按 0.5 折算。',
    '- R3 重大合规敞口一票降级，最终等级最高 C。',
    '- R6 把对手搞垮但自己颗粒无收 → 记 D。',
    '- R7 伤害无关联第三方换来的利益 → 他人轴记负。',
    '- R8 灰色利益入账，但必须同时登记合规负债（不做道德说教，只做风险定价）。',
    '- R9 只对可归因的因果链计分，搭便车不计。',
    '- R10 同一笔利益不得重复计分。',
    '- R11 局面边界：跳槽/副业等边界外的收益不计入本局。',
    '- R12 他人轴只计具体自然人；公司、部门等组织受益不计入他人轴。',
    '',
    '## 本局的利益敞口',
    `自己：\n${bullet(s.stakes_self)}`,
    `相关方：\n${bullet(s.stakes_others)}`,
    '',
    `**最容易踩的坑**：${s.trap ?? '（未标注）'}`,
    '',
    '## 第四步：一句话复盘',
    '说清「你真正拿到手的是什么」和「你以为拿到但没拿到的是什么」。',
    '',
    '---',
    `现实里这个位置的结算基准：原型当事人 ${scenario.protagonists?.[0]?.name ?? ''} = ` +
      `${scenario.protagonists?.[0]?.baseline?.grade ?? '—'}（主分 ${scenario.protagonists?.[0]?.baseline?.main ?? '—'}）。`,
    '用户打出的主分高于基准 = 比现实当事人处理得更好；低于基准 = 现实里有一条更好的路，复盘时揭示。',
  ].join('\n')
}

/** 世界书条目：常驻的放 constant，NPC 隐藏诉求按名字触发。 */
function buildBookEntries(scenario) {
  const entries = []
  let order = 100

  entries.push({
    keys: [],
    secondary_keys: [],
    comment: '局面与冲突',
    content: [
      `# 局面：${scenario.title}`,
      `前情：${scenario.premise}`,
      `背景：${scenario.setting}`,
      `核心冲突：${scenario.conflict_point ?? ''}`,
    ].join('\n'),
    constant: true,
    enabled: true,
    insertion_order: order,
    extensions: { position: 0, depth: 4 },
  })
  order += 10

  entries.push({
    keys: [],
    secondary_keys: [],
    comment: '人物名册（表面）',
    content: `# 在场的人\n\n${npcRoster(scenario.cast)}`,
    constant: true,
    enabled: true,
    insertion_order: order,
    extensions: { position: 0, depth: 4 },
  })
  order += 10

  entries.push({
    keys: [],
    secondary_keys: [],
    comment: '信息不对称',
    content: `# 谁不知道什么\n\n${scenario.info_asymmetry}`,
    constant: true,
    enabled: true,
    insertion_order: order,
    extensions: { position: 0, depth: 4 },
  })
  order += 10

  entries.push({
    keys: [],
    secondary_keys: [],
    comment: '升级时间线（按轮次推进）',
    content: [
      '# 局面会自己恶化（按对话推进依次发生，不要一次全抛出）',
      ...(scenario.escalation ?? []).map((x, i) => `${i + 1}. ${x}`),
      '',
      '推进原则：前 2 轮只呈现第 1~2 个节点；用户每做出一次实质性动作，推进一个节点；',
      '用户长时间不动作时，按节点顺序自行推进，并在叙述里体现出代价。',
    ].join('\n'),
    constant: true,
    enabled: true,
    insertion_order: order,
    extensions: { position: 0, depth: 4 },
  })
  order += 10

  for (const c of scenario.cast ?? []) {
    entries.push({
      keys: [c.name],
      secondary_keys: [],
      comment: `隐藏诉求：${c.name}`,
      content: [
        `# ${c.name}（${c.position}）的隐藏诉求`,
        `**表面**：${c.surface}`,
        `**实际要的**：${c.hidden}`,
        `**手里的筹码**：${c.leverage}`,
        c.reveal_at ? `**何时暴露**：${c.reveal_at}` : '',
        '',
        '扮演要求：不要把这段直接说出来。让对方的行为、措辞和让步节奏体现它；',
        '在用户做出足以触发的动作时才让它显形。',
      ]
        .filter(Boolean)
        .join('\n'),
      constant: false,
      enabled: true,
      insertion_order: order,
      // exclude_recursion 是关键：常驻的「人物名册」「可扮演主角」条目里列了所有 NPC 的名字，
      // 递归扫描会拿它们的正文继续扫键，把每一条隐藏诉求在第一轮就全部激活——
      // 「这个人出场时他的动机才进提示词」的设计会完全失效。
      // 实测（tools/probe_worldinfo.mjs）：不加这一项时三种场景都激活全部 4 条；
      // 加上之后只在消息里真的出现该 NPC 名字时才激活。
      extensions: { position: 0, depth: 4, exclude_recursion: true },
    })
    order += 10
  }

  entries.push({
    keys: [],
    secondary_keys: [],
    comment: '可扮演主角（仅作提示，勿向用户剧透）',
    content: [
      '# 这一局有哪些位置可以坐',
      ...(scenario.protagonists ?? []).map((p, i) => protagonistBrief(p, i)),
      '',
      '（用户当前已经选定了其中一个位置，其开场白就是他的第一人称视角。不要复述这张清单。）',
    ].join('\n'),
    constant: true,
    enabled: true,
    insertion_order: order,
    extensions: { position: 0, depth: 4 },
  })
  order += 10

  // 结算要求的保底副本。
  // 完整结算规则写在卡片的 postHistoryInstructions 里，它覆盖预设的 jailbreak 槽位
  // （src/core/assemble.ts:550）——但那个覆盖受用户开关 preferCharacterInstructions 控制，
  // 关掉之后整段规则会从提示词里消失（实测 JUDGE=true → false）。
  // 这里用一条短常驻条目保住「必须结算」这个要求本身：开关是用户主动关的，
  // 丢掉细则可以接受，丢掉要求不行。
  entries.push({
    keys: [],
    secondary_keys: [],
    comment: '局末结算（保底要求）',
    content: [
      '# 局末结算（必须执行）',
      '',
      '用户说「结算／结束／我这一局怎么样」时，按四步逐项填写，禁止只给一句笼统评价：',
      '① 利益记账表（序号｜受益方｜类别｜事项｜量级｜是否兑现｜归因）',
      '② 代价与风险敞口（无／轻微−0.5／中度−1.5／重大−3，重大则最终等级最高 C）',
      '③ 主分 = 自己净额 + 0.8 × 他人净额；S≥6｜A 4~5.9｜B 2~3.9｜C 0.5~1.9｜D −0.4~0.4｜E −3~−0.5｜F<−3',
      '④ 一句话复盘：你真正拿到手的是什么；你以为拿到但没拿到的是什么',
      '',
      '铁律：情绪收益不计分；未兑现按 0.5 折算；重大合规敞口一票降级；',
      '把对手搞垮而自己颗粒无收记 D；伤害无关联第三方记入他人轴负值；',
      '灰色利益入账同时登记合规负债；只对可归因的因果链计分；同一笔利益不重复计分；',
      '局面边界外的收益不算本局；他人轴只计具体自然人。',
    ].join('\n'),
    constant: true,
    enabled: true,
    insertion_order: order,
    extensions: { position: 0, depth: 4 },
  })

  return entries
}

function buildStCard(scenario) {
  const protags = scenario.protagonists ?? []
  if (protags.length < 2) throw new Error(`${scenario.id}: 主角少于 2 个`)
  const openings = protags.map((p) => (p.opening ?? '').trim())
  const [firstMes, ...rest] = openings
  if (!firstMes) throw new Error(`${scenario.id}: 第一个主角没有开场白`)

  // 主角元数据随卡走：客户端经 getCharacterDetail.extensions 读取，零新增 RPC。
  // 顺序必须与插件 cardGreetingVariants 一致：[firstMes, ...alternateGreetings]。
  // 这里带上完整简报（knows/unaware/leverage/constraints），让剧情库点开就能判断"我想坐哪个位置"，
  // 而不必先开始一局才发现坐错了。
  const strArr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim() !== '') : [])
  const variantMeta = protags.map((p, i) => ({
    index: i,
    name: p.name,
    position: p.position,
    difficulty: p.difficulty,
    goal: p.goal,
    knows: strArr(p.knows),
    unaware: strArr(p.unaware),
    leverage: strArr(p.leverage),
    constraints: strArr(p.constraints),
    baseline: p.baseline ?? null,
  }))

  const description = [
    scenario.premise,
    '',
    '## 背景',
    scenario.setting,
    '',
    '## 在场的人（表面）',
    npcRoster(scenario.cast),
  ].join('\n')

  const sc = [
    `## 核心冲突`,
    scenario.conflict_point ?? '',
    '',
    `## 你这一局的利益敞口`,
    `自己：`,
    ...(scenario.scoring?.stakes_self ?? []).map((x) => `- ${x}`),
    `相关方：`,
    ...(scenario.scoring?.stakes_others ?? []).map((x) => `- ${x}`),
    '',
    `## 提示`,
    '这是第一人称扮演。不要替用户做决定，不要在此处解释规则。',
  ].join('\n')

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: scenario.title,
      description,
      personality: '',
      scenario: sc,
      first_mes: firstMes,
      alternate_greetings: rest,
      mes_example: '',
      system_prompt: '',
      post_history_instructions: judgeRules(scenario),
      creator_notes: [
        `素材来源：${scenario.source?.platform ?? ''} ${scenario.source?.url ?? ''}`,
        `可信度：${scenario.source?.fidelity ?? '未标注'}`,
        `剧情编号：${scenario.id}（${scenario.role}）`,
        '本卡内容基于公开网络平台的他人自述/转述，不代表事实已核实；带「有加工」「疑似虚构」标记的素材只用于训练推演。',
      ].join('\n'),
      creator: '政治素养训练场',
      character_version: '1',
      tags: [scenario.role, ...(scenario.tags ?? [])].filter(Boolean),
      character_book: { name: `${scenario.title}·设定集`, entries: buildBookEntries(scenario) },
      extensions: {
        'tavern-gym': {
          version: 1,
          scenarioId: scenario.id,
          role: scenario.role,
          // premise / fidelity 让「剧情库」列表不必再拉一次详情就能显示前情与可信度。
          premise: scenario.premise ?? '',
          fidelity: scenario.source?.fidelity ?? '',
          source: scenario.source ?? null,
          protagonists: variantMeta,
          // 「选择扮演主角」的 UI 直接读这个表；顺序即 greetingIndex。
          greetingOrder: variantMeta.map((m) => m.name),
          /**
           * 玩家可见的简报。只放能给玩家看的：局面、场景、在场人物的表面身份。
           * cast[].hidden（隐藏诉求）绝不进这里——那是模型用的。
           * 开场白是角色视角（两眼一抹黑），背景放在副本页给，两者分工不同。
           */
          briefing: {
            stage: scenario.setting ?? '',
            situation: scenario.premise ?? '',
            period: scenario.role ? '' : '',
            span: '',
            stakes: scenario.stakes ?? '',
            rules: scenario.rules ?? [],
            clock: scenario.clock ?? '',
          },
          howto: {
            talk: '用第一人称说话就行——想做什么、想说什么，直接打字。不必从选项里挑，也没有预设的对白。',
            advance: '这一局一次成局，不划分关卡。局面由在场各方的利益推动，没有预设剧情；你走到哪一步，取决于你做了什么。',
            settle: '想结束这一局时说「结算」，会按目标逐条判定，并算出代价与剩余敞口。',
          },
        },
      },
    },
  }
}

// ---------------------------------------------------------------------------

if (!existsSync(SCENARIO_DIR)) throw new Error(`没有剧情目录: ${SCENARIO_DIR}`)
const files = (await readdir(SCENARIO_DIR)).filter((f) => f.endsWith('.json'))
if (files.length === 0) throw new Error('剧情目录里没有 json')

let total = 0
const report = []
for (const f of files.sort()) {
  const raw = await readFile(path.join(SCENARIO_DIR, f), 'utf8')
  const scenarios = JSON.parse(raw)
  if (!Array.isArray(scenarios)) throw new Error(`${f} 不是数组`)

  for (const scenario of scenarios) {
    for (const k of ['id', 'title', 'role', 'premise', 'setting', 'cast', 'protagonists']) {
      if (!scenario[k]) throw new Error(`${f} 的 ${scenario.id ?? '?'} 缺字段 ${k}`)
    }
    const st = buildStCard(scenario)
    const card = parseJsonCard(st) // 插件自己的归一化
    // 落盘形状与 importCard 一致：去掉 pngBytes
    const stored = { ...card, pngBytes: null }
    const json = JSON.stringify(stored, null, 2)

    // 用插件自己的 hydrateStoredCard 回读，证明磁盘形状可被 loadCharacter 接受
    const back = hydrateStoredCard(JSON.parse(json))
    const okVariant = (back.alternateGreetings ?? []).length === scenario.protagonists.length - 1
    const okBook = Array.isArray(back.characterBook?.entries) && back.characterBook.entries.length > 0
    const okExt = back.extensions?.['tavern-gym']?.protagonists?.length === scenario.protagonists.length
    if (!okVariant || !okBook || !okExt) {
      throw new Error(
        `${scenario.id} 回读校验失败 variant=${okVariant} book=${okBook} ext=${okExt}`,
      )
    }

    const cardId = stableCardId(scenario)
    const dir = path.join(CHAR_ROOT, cardId)
    if (!DRY) {
      await mkdir(path.join(dir, 'assets'), { recursive: true })
      await writeFile(path.join(dir, 'card.json'), json, 'utf8')
      await writeFile(
        path.join(dir, 'assets', 'character-book.json'),
        JSON.stringify(st.data.character_book, null, 2),
        'utf8',
      )
      await writeFile(path.join(dir, 'assets', 'regex-scripts.json'), '[]', 'utf8')
    }
    total += 1
    report.push({
      id: scenario.id,
      cardId,
      title: scenario.title,
      protags: scenario.protagonists.length,
      bookEntries: back.characterBook.entries.length,
      variants: (back.alternateGreetings ?? []).length,
    })
  }
}

console.log(DRY ? '== DRY RUN（未写入）==' : '== 已写入 ==')
console.log(`角色卡根目录: ${CHAR_ROOT}`)
for (const r of report) {
  console.log(`  ${r.id.padEnd(6)} ${r.cardId.padEnd(34)} 主角${r.protags} 变体${r.variants} 世界书${r.bookEntries}条  ${r.title}`)
}
console.log(`共 ${total} 张卡`)
