/**
 * build_cards_v2.mjs — 把 04_剧情/scenarios_v2/*.json（开放式博弈模型）转成角色卡。
 *
 * 与 v1 转换器的区别：
 *  - 不再有 scene / escalation / endings，世界由参与者动机自行演化；
 *  - 参与者的完整档案（要什么/筹码/否决权/质押/恐惧/约束/会怎么走）与博弈结构十一项
 *    全部作为**常驻**世界书条目 —— 开放式推演需要模型随时能看到全部参与者的利益结构；
 *  - 结算条目按 scoring.objectives 逐条判定；
 *  - 校验 evidence 是否逐字来自素材卡。
 *
 * 用法：node tools/build_cards_v2.mjs [--dry]
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GYM = path.resolve(HERE, '..')
const DIR = path.join(GYM, '04_剧情', 'scenarios_v2')
const CARD_SRC = path.join(GYM, '01_素材库', 'cards')
const PLUGIN = 'D:/开源团队作品/dsh-plugins/plugins/dsh-liketavern'
const DSH_HOME = process.env.DSH_HOME
if (!DSH_HOME) throw new Error('缺少 DSH_HOME')
const CHAR_ROOT = path.join(DSH_HOME, 'dsh-tavern', 'characters')
const DRY = process.argv.includes('--dry')

const { parseJsonCard, hydrateStoredCard } = await import(`file:///${PLUGIN}/lib/state/card.js`)

function sanitizeCardName(name) {
  return name.toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/g, '')
}
function stableCardId(s) {
  const base = sanitizeCardName(s.title) || 'card'
  return `${base}-${createHash('sha1').update(`${s.id}|${s.title}`).digest('hex').slice(0, 8)}`
}
const bullet = (arr) => (arr ?? []).map((x) => `- ${x}`).join('\n')

// ---------------------------------------------------------------------------
// evidence 校验：逐字来自素材卡
// ---------------------------------------------------------------------------
const corpus = []
for (const f of (await readdir(CARD_SRC)).filter((x) => x.endsWith('.json'))) {
  corpus.push(await readFile(path.join(CARD_SRC, f), 'utf8'))
}
const corpusText = corpus.join('\n')
const norm = (s) => s.replace(/\s/g, '').replace(/[""]/g, '"').replace(/['']/g, "'")
const corpusNorm = norm(corpusText)

function bookEntries(s) {
  const e = []
  let order = 100
  const push = (comment, content, constant = true) => {
    e.push({ keys: [], secondary_keys: [], comment, content, constant, enabled: true, insertion_order: order, extensions: { position: 0, depth: 4 } })
    order += 10
  }

  push('局面与规则', [
    `# 局面：${s.title}`,
    `处境：${s.premise}`,
    '',
    `**公司**：${s.arena.company}`,
    `**层面**：${s.arena.stage}`,
    `**时钟**：${s.arena.clock}`,
    '',
    '**明规则与潜规则**：',
    bullet(s.arena.rules),
  ].join('\n'))

  push('参与者全表（模型可见，勿向用户交底）', [
    '# 在场的人：他要什么、他有什么、他押了什么、他怕什么',
    '',
    ...s.players.map((p) => [
      `## ${p.name}｜${p.seat}`,
      `**他要什么**：`,
      bullet(p.wants),
      `**手里的筹码**：`,
      bullet(p.chips),
      `**能否决什么**：`,
      bullet(p.veto),
      `**已经押在桌上的**：`,
      bullet(p.pledged),
      `**他怕什么**：`,
      bullet(p.fears),
      `**他的约束**：`,
      bullet(p.constraint),
      `**他大概会怎么走**：`,
      bullet(p.moves),
    ].join('\n')),
    '',
    '扮演要求：不要把这一表直接说出来。让每个人的行为、措辞、让步节奏体现它。',
  ].join('\n'))

  const g = s.game
  push('博弈结构（政治素养基本盘）', [
    '# 这一局的博弈结构',
    '',
    `**资源与筹码**：${g.resources}`,
    '',
    `**否决权与议程控制**：${g.veto_and_agenda}`,
    '',
    `**质押与担保**：${g.pledge_risk}`,
    '',
    `**承诺与可信度**：${g.commitment}`,
    '',
    `**可信威胁与退出选项**：${g.credible_threat}`,
    '',
    `**信息结构**：${g.information}`,
    '',
    `**联盟与背叛**：${g.coalition}`,
    '',
    `**时间与耐心**：${g.time_pressure}`,
    '',
    `**规则与裁量**：${g.rules_vs_discretion}`,
    '',
    `**正当性与升级层面**：${g.legitimacy}`,
    '',
    `**退出与升级信号**：${g.exit}`,
  ].join('\n'))

  push('可扮演位置（模型可见，勿向用户交底）', [
    '# 这张卡有哪几个位置可以坐',
    '',
    ...s.protagonists.map((p, i) => [
      `## 位置 ${i + 1}：${p.name}（${p.difficulty}）`,
      `**身份**：${p.identity}`,
      `**岗位**：${p.post}`,
      `**他手里有什么**：`,
      bullet(p.resources),
      `**他的软肋**：`,
      bullet(p.liabilities),
      `**别人眼里他是**：${p.reputation}`,
      `**目的分层**：`,
      `- 兑现：${(p.objectives.cash ?? []).join('；')}`,
      `- 位置：${(p.objectives.position ?? []).join('；')}`,
      `- 安全：${(p.objectives.safety ?? []).join('；')}`,
      `- 底线：${(p.objectives.floor ?? []).join('；')}`,
      `- 忌讳：${(p.objectives.taboo ?? []).join('；')}`,
    ].join('\n')),
    '',
    '（用户已经选了其中一个位置，其开场白就是他的第一人称视角。不要复述这张清单。）',
  ].join('\n'))

  push('本局评分目标', [
    '# 本局评分目标（局末逐条判定）',
    '',
    ...s.scoring.objectives.map((o) => `- [权重 ${o.weight}] ${o.text}`),
    '',
    `**代价轴**：${s.scoring.cost_axes.join('、')}`,
    '',
    `**结算方式**：${s.scoring.settle}`,
  ].join('\n'))

  push('局末结算（必须执行）', [
    '# 局末结算（必须执行）',
    '',
    '用户说「结算／结束／我这一局怎么样」时，按四步逐项填写，禁止只给一句笼统评价：',
    '① 逐条判定上面「本局评分目标」里的每一条：达成 / 部分达成 / 未达成，并说明依据；',
    '② 代价：按代价轴逐项折算（时间与精力／关系损耗／机会成本／道德与合规负债／暴露面）；',
    '③ 主分 = Σ(达成目标权重) − 代价 − 风险敞口折算；敞口分 无/轻微−0.5/中度−1.5/重大−3（重大则最高只能给 C）；',
    '④ 一句话复盘：你真正拿到手的是什么；你以为拿到但没拿到的是什么。',
    '',
    '铁律：情绪收益不计分（R1）；未兑现按 0.5 折算（R2）；重大合规敞口一票降级（R3）；',
    '把对手搞垮而自己颗粒无收记 D（R6）；伤害无关联第三方记入他人轴负值（R7）；',
    '灰色利益入账同时登记合规负债（R8）；只对可归因的因果链计分（R9）；同一笔利益不重复计分（R10）；',
    '局面边界外的收益不算本局（R11）；他人轴只计具体自然人（R12）。',
    '',
    '不评价手段漂不漂亮。只看目的达成没有、代价多大、还剩多少敞口。',
  ].join('\n'))

  return e
}

function buildStCard(s) {
  const pro = s.protagonists ?? []
  if (pro.length < 1) throw new Error(`${s.id}: 没有可扮演位置`)
  const openings = pro.map((p) => (p.opening ?? '').trim())
  const [firstMes, ...rest] = openings
  if (!firstMes) throw new Error(`${s.id}: 第一个位置没有开场白`)

  const variantMeta = pro.map((p, i) => ({
    index: i, name: p.name, difficulty: p.difficulty,
    identity: p.identity, post: p.post, reputation: p.reputation,
    resources: p.resources, liabilities: p.liabilities,
    objectives: p.objectives,
    baseline: null,
  }))

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: s.title,
      description: [
        s.premise, '',
        '## 局面', s.arena.company, s.arena.stage,
        '## 规则', ...(s.arena.rules ?? []).map((r) => `- ${r}`),
      ].join('\n'),
      personality: '',
      scenario: [
        '## 这是一个开放式的局', '',
        '没有预设剧情，也不会有注定发生的事。局面由在场每个人的利益与恐惧推动。', '',
        '## 你这一局的目的是分层的', '',
        '- 兑现（钱与实物）／位置（职级、署名、关键项目）／安全（不被追责、档案干净）',
        '- 底线：绝不能让渡的东西；忌讳：不能用的手段',
        '',
        '## 提示', '',
        '第一人称扮演。不要替用户做决定，不要解释规则，不要预告将要发生什么。',
      ].join('\n'),
      first_mes: firstMes,
      alternate_greetings: rest,
      mes_example: '',
      system_prompt: '',
      post_history_instructions: [
        '# 本局结算规则', '',
        `结算方式：${s.scoring.settle}`, '',
        '评分目标：',
        ...s.scoring.objectives.map((o) => `- [权重 ${o.weight}] ${o.text}`),
        '',
        `代价轴：${s.scoring.cost_axes.join('、')}`,
        '',
        '铁律：情绪收益不计分；未兑现按 0.5 折算；重大合规敞口一票降级（最高 C）；',
        '把对手搞垮而自己颗粒无收记 D；伤害无关联第三方记入他人轴负值；',
        '灰色利益入账同时登记合规负债；只对可归因的因果链计分；同一笔利益不重复计分；',
        '局面边界外的收益不算本局；他人轴只计具体自然人。',
        '',
        '不评价手段漂不漂亮。只看目的达成没有、代价多大、还剩多少敞口。',
      ].join('\n'),
      creator_notes: [
        `模型版本：v2（开放式博弈，无预设剧情）`,
        `素材来源：${s.source.platform} ${s.source.url}`,
        `可信度：${s.source.fidelity}`,
        `剧情编号：${s.id}（${s.role}）`,
        '基于公开网络平台的他人自述/转述，不代表事实已核实。',
      ].join('\n'),
      creator: '政治素养训练场',
      character_version: '2',
      tags: [s.role, 'v2-开放局', ...s.tags],
      character_book: { name: `${s.title}·博弈设定集`, entries: bookEntries(s) },
      extensions: {
        'tavern-gym': {
          version: 2,
          scenarioId: s.id,
          role: s.role,
          premise: s.premise,
          fidelity: s.source.fidelity,
          source: s.source,
          protagonists: variantMeta,
          greetingOrder: variantMeta.map((m) => m.name),
          /**
           * 玩家可见的简报。只放能给玩家看的：局面、规则、时钟、赌注。
           * 在场人物的隐藏诉求与各位置的「起手不知道」留在世界书里，不进这里。
           */
          briefing: {
            stage: s.arena.company,
            situation: s.premise,
            period: s.arena.stage,
            span: '',
            stakes: s.stakes ?? '',
            rules: s.arena.rules,
            clock: s.arena.clock,
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
// 开场白机械自查
//
// 这是全卡最容易写坏的地方：不自觉地把「分析」「自身优势」「当事人后来的结果」
// 写进开场白，等于把答案印在题目上。规则写进文档没用，得让它在构建时直接报错。
//
// 下限刻意设成 120 而不是 v1 的 180：局面本身可以很短，为了凑字数往里加东西，
// 加的通常正是这四类不该有的内容。
// ---------------------------------------------------------------------------
const OPEN_MIN = 120
const OPEN_MAX = 340
/** 出现即判定为「交底」而非「局面」。 */
const OPEN_BANNED = [
  ['只有我', '自身优势盘点'],
  ['只有他知道', '自身优势盘点'],
  ['底牌', '自身优势盘点'],
  ['筹码', '博弈术语'],
  ['把柄', '博弈术语'],
  ['质押', '博弈术语'],
  ['退路', '自身优势盘点'],
  ['个人英雄主义', '政治分析'],
  ['走人一条路', '政治分析'],
  ['我该怎么办', '自我提示'],
  ['我应该', '自我提示'],
  ['接下来', '预告'],
  ['你将要', '预告'],
  ['会有人', '预告'],
  ['注定', '预告'],
]

function checkOpening(s, p) {
  const text = (p.opening ?? '').trim()
  const problems = []
  if (text.length < OPEN_MIN || text.length > OPEN_MAX) {
    problems.push(`长度 ${text.length} 不在 ${OPEN_MIN}~${OPEN_MAX}`)
  }
  for (const [word, kind] of OPEN_BANNED) {
    if (text.includes(word)) problems.push(`含「${word}」（${kind}）`)
  }
  if (problems.length) throw new Error(`${s.id}/${p.name} 开场白不合格：${problems.join('；')}`)
}

// ---------------------------------------------------------------------------

if (!existsSync(DIR)) throw new Error(`没有 ${DIR}`)
const files = (await readdir(DIR)).filter((f) => f.endsWith('.json'))
let total = 0
for (const f of files.sort()) {
  const items = JSON.parse(await readFile(path.join(DIR, f), 'utf8'))
  for (const s of items) {
    for (const k of ['id', 'title', 'role', 'premise', 'arena', 'players', 'game', 'protagonists', 'scoring']) {
      if (!s[k]) throw new Error(`${s.id}: 缺字段 ${k}`)
    }
    const missingGame = ['resources', 'veto_and_agenda', 'pledge_risk', 'commitment', 'credible_threat',
      'information', 'coalition', 'time_pressure', 'rules_vs_discretion', 'legitimacy', 'exit']
      .filter((k) => !s.game[k])
    if (missingGame.length) throw new Error(`${s.id}: 博弈结构缺 ${missingGame.join('/')}`)
    for (const p of s.protagonists) {
      for (const k of ['cash', 'position', 'safety', 'floor', 'taboo']) {
        if (!p.objectives?.[k]?.length) throw new Error(`${s.id}/${p.name}: 目的分层缺 ${k}`)
      }
      checkOpening(s, p)
    }
    // evidence 逐字校验
    const bad = (s.evidence ?? []).filter((x) => !corpusNorm.includes(norm(x)))
    if (bad.length) throw new Error(`${s.id}: ${bad.length} 段 evidence 无法在素材卡里逐字命中`)

    const st = buildStCard(s)
    const card = parseJsonCard(st)
    const stored = { ...card, pngBytes: null }
    const json = JSON.stringify(stored, null, 2)
    const back = hydrateStoredCard(JSON.parse(json))
    if ((back.alternateGreetings ?? []).length !== s.protagonists.length - 1) throw new Error(`${s.id}: 变体数不符`)
    if (back.extensions?.['tavern-gym']?.version !== 2) throw new Error(`${s.id}: 扩展版本不符`)

    const cardId = stableCardId(s)
    if (!DRY) {
      const dir = path.join(CHAR_ROOT, cardId)
      await mkdir(path.join(dir, 'assets'), { recursive: true })
      await writeFile(path.join(dir, 'card.json'), json, 'utf8')
      await writeFile(path.join(dir, 'assets', 'character-book.json'), JSON.stringify(st.data.character_book, null, 2), 'utf8')
      await writeFile(path.join(dir, 'assets', 'regex-scripts.json'), '[]', 'utf8')
    }
    const chars = back.characterBook.entries.reduce((n, e) => n + e.content.length, 0)
    console.log(`  ${s.id}  ${cardId}  位置${s.protagonists.length}  参与者${s.players.length}  世界书${back.characterBook.entries.length}条/${chars}字`)
    total++
  }
}
console.log(`\n${DRY ? '（dry run）' : '已写入'} ${total} 张 v2 卡`)
