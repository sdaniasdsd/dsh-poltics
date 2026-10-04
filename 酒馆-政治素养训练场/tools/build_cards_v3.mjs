/**
 * build_cards_v3.mjs — 把 04_剧情/scenarios_v3/*.json（历史副本）转成酒馆角色卡。
 *
 * 与 v2 转换器的区别：
 *  - 有 phases：每个阶段带**明确任务**（v2 是全开放不给任务，v3 阶段分明必须给）；
 *  - 有 sources + cross_checks：史料与交叉验证入档，并作为常驻条目给模型，
 *    让它知道哪些事实是存疑的，不要把孤证当定论；
 *  - 有 history_note：史实怎么走的、副本在哪里放宽——必须让模型知道，
 *    否则用户会以为自己改变了历史，其实只是重演。
 *
 * 构建前强制校验：所有引文必须在本地史料库里逐字命中，否则直接失败。
 *
 * 用法：node tools/build_cards_v3.mjs [--dry]
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GYM = path.resolve(HERE, '..')
const DIR = path.join(GYM, '04_剧情', 'scenarios_v3')
const CORPUS = path.join(GYM, '04_剧情', '史料库')
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
  return `${sanitizeCardName(s.title) || 'history'}-${createHash('sha1').update(`${s.id}|${s.title}`).digest('hex').slice(0, 8)}`
}
const bullet = (arr) => (arr ?? []).map((x) => `- ${x}`).join('\n')

// ---------------------------------------------------------------------------
// 引文校验（构建前强制）
// ---------------------------------------------------------------------------
const norm = (s) => String(s).replace(/[\s\u3000]/g, '')
const corpus = new Map()
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await walk(p)
    else if (e.name.endsWith('.txt')) corpus.set(path.relative(CORPUS, p).replace(/\\/g, '/'), norm(await readFile(p, 'utf8')))
  }
}
await walk(CORPUS)
/** 返回命中的语料相对路径，找不到返回 null。 */
function corpusHit(quote) {
  const q = norm(quote)
  if (q.length < 6) return undefined
  for (const [name, text] of corpus) if (text.includes(q)) return name
  return null
}
function requireQuote(label, quote) {
  const hit = corpusHit(quote)
  if (hit === undefined) throw new Error(`${label}: 引文过短，不能作为证据`)
  if (hit === null) throw new Error(`${label}: 引文不在史料库中 → 「${String(quote).slice(0, 40)}…」`)
  return hit
}

// ---------------------------------------------------------------------------
function bookEntries(s) {
  const e = []
  let order = 100
  const push = (comment, content) => {
    e.push({ keys: [], secondary_keys: [], comment, content, constant: true, enabled: true, insertion_order: order, extensions: { position: 0, depth: 4 } })
    order += 10
  }

  push('时代与赌注', [
    `# ${s.title}`,
    `**纪年**：${s.period}`,
    `**跨度**：${s.span}`,
    `**处境**：${s.premise}`,
    '',
    `**时代**：${s.setting}`,
    '',
    `**赌注**：${s.stakes}`,
  ].join('\n'))

  push('在场的人（模型可见，勿向用户交底）', [
    '# 这一局有谁：他要什么、他有什么、他押了什么、他怕什么',
    '',
    ...s.players.map((p) => [
      `## ${p.name}｜${p.seat}`,
      `**他要什么**：`, bullet(p.wants),
      `**手里的筹码**：`, bullet(p.chips),
      `**能否决什么**：`, bullet(p.veto),
      `**已经押在桌上的**：`, bullet(p.pledged),
      `**他怕什么**：`, bullet(p.fears),
      `**他的约束**：`, bullet(p.constraint),
      `**他大概会怎么走**：`, bullet(p.moves),
    ].join('\n')),
    '',
    '扮演要求：不要把这一表直接说出来。让每个人的行为、措辞、让步节奏体现它。',
  ].join('\n'))

  push('阶段任务（本副本的主干）', [
    '# 六个阶段：每个阶段要办成什么',
    '',
    '**这是历史副本与当代副本最大的不同：阶段分明，任务明确。**',
    '用户不需要自己猜该干什么——每一阶段都告诉他这一阶段要办成什么。',
    '怎么做到，仍然完全由用户决定。',
    '',
    ...s.phases.map((ph) => [
      `## 阶段 ${ph.id}：${ph.name}（${ph.window}）`,
      `**局面**：${ph.situation}`,
      `**本阶段任务（必须让用户知道）**：`, bullet(ph.tasks),
      `**博弈焦点**：${ph.focus}`,
      `**对手可能怎么走**：${ph.opponent_moves}`,
      `**判定**：${ph.settle_at}`,
    ].join('\n')),
    '',
    '推进要求：用户完成（或明确放弃）本阶段任务后，再进入下一阶段；不要跳阶段，也不要替用户跳。',
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

  push('史实基线与取材（模型必须知道）', [
    '# 史实怎么走的，副本在哪里放宽了',
    '',
    g.history_note,
    '',
    '**要求**：不要替用户复述史实，也不要用「历史上你后来会……」这类口气。',
    '史实是基线，不是剧本；用户在阶段内的选择完全自由。',
    '',
    '---',
    '',
    '# 史料与交叉验证（本副本的取材）',
    '',
    '下面每一处都是同一件事在不同史源里的记载差异。**遇到存疑处不要当作定论陈述**，',
    '也不要主动向用户讲解史料学——除非用户问起。',
    '',
    ...s.cross_checks.map((cc, i) => [
      `## 存疑 ${i + 1}：${cc.fact}`,
      ...cc.sources.map((src) => `- 《${src.work}》：${src.quote}`),
      `**分歧**：${cc.divergence}`,
      `**本副本取**：${cc.our_choice}`,
      `**为什么重要**：${cc.why_it_matters}`,
    ].join('\n')),
  ].join('\n'))

  push('可扮演位置（模型可见，勿向用户交底）', [
    '# 这张卡有哪几个位置可以坐',
    '',
    ...s.protagonists.map((p, i) => [
      `## 位置 ${i + 1}：${p.name}（${p.difficulty}）`,
      `**身份**：${p.identity}`,
      `**位置**：${p.post}`,
      `**他手里有什么**：`, bullet(p.resources),
      `**他的软肋**：`, bullet(p.liabilities),
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

  push('分阶段评分与终局结算', [
    '# 分阶段评分（每阶段末判定一次）',
    '',
    ...s.scoring.phase_scores.map((ps) => `- 阶段 ${ps.phase}（权重 ${ps.weight}）：${ps.criteria.join('；')}`),
    '',
    '# 终局目标（逐条判定）',
    '',
    ...s.scoring.final_objectives.map((o) => `- [权重 ${o.weight}] ${o.text}`),
    '',
    `**代价轴**：${s.scoring.cost_axes.join('、')}`,
    '',
    s.scoring.settle,
  ].join('\n'))

  push('局末结算（必须执行）', [
    '# 局末结算（必须执行）',
    '',
    '用户说「结算／结束／我这一局怎么样」时，按四步逐项填写，禁止只给一句笼统评价：',
    '① **分阶段回看**：逐阶段说明当时完成了哪些任务、哪些没完成、是什么原因；',
    '② **逐条判定终局目标**：达成 / 部分达成 / 未达成，并说明依据；',
    '③ **代价**：按代价轴逐项折算；风险敞口按 无／轻微−0.5／中度−1.5／重大−3（重大则最高只能给 C）；',
    '④ **一句话复盘**：你真正拿到手的是什么；你以为拿到但没拿到的是什么。',
    '',
    '**本副本额外强制**：终局必须单独回答一个问题——你许下的诺言兑现了吗？',
    '如果没有，你为此付出了什么、又是否为此付过任何代价。这一条不折算权重，但必须写出来。',
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
      description: [s.premise, '', '## 时代', s.setting, '', '## 赌注', s.stakes, '', `## 纪年`, s.period].join('\n'),
      personality: '',
      scenario: [
        '## 这是一个跨越数十年的历史局',
        '',
        s.span,
        '',
        '## 它与一局定胜负的局不同',
        '',
        '- 分阶段推进，**每个阶段都有明确任务**（见设定集「阶段任务」）',
        '- 阶段内的做法完全由你决定，没有预设路径',
        '- 每个阶段结束时会判定一次，然后进入下一阶段',
        '- 史实是基线，不是剧本：你可以走和史实不同的路',
        '',
        '## 你的目的是分层的',
        '',
        '- 兑现（钱与实物）／位置（权位、名分、兵权）／安全（不被清算、家族存续）',
        '- 底线：绝不能让渡的东西；忌讳：不能用的手段',
        '',
        '## 提示',
        '',
        '第一人称扮演。不要替用户做决定，不要解释规则，不要预告将要发生什么，',
        '也不要用「历史上你后来会……」的口气复述史实。',
      ].join('\n'),
      first_mes: firstMes,
      alternate_greetings: rest,
      mes_example: '',
      system_prompt: '',
      post_history_instructions: [
        '# 本局结算规则（历史副本）', '',
        s.scoring.settle, '',
        '分阶段评分：',
        ...s.scoring.phase_scores.map((ps) => `- 阶段 ${ps.phase}（权重 ${ps.weight}）：${ps.criteria.join('；')}`),
        '',
        '终局目标：',
        ...s.scoring.final_objectives.map((o) => `- [权重 ${o.weight}] ${o.text}`),
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
        '模型版本：v3（历史副本：长周期 · 多阶段 · 明确任务 · 史料交叉验证）',
        `剧情编号：${s.id}｜纪年：${s.period}`,
        `史料来源：维基文库（公有领域，CC BY-SA），共 ${s.sources.length} 条引文、${s.cross_checks.length} 处交叉验证，全部逐字校验。`,
        '本副本基于正史记载；存疑之处已在设定集中列出各说，未作定论。',
      ].join('\n'),
      creator: '政治素养训练场',
      character_version: '3',
      tags: [s.role, 'v3-历史副本', ...s.tags],
      character_book: { name: `${s.title}·史料与博弈设定集`, entries: bookEntries(s) },
      extensions: {
        'tavern-gym': {
          version: 3,
          scenarioId: s.id,
          role: s.role,
          premise: s.premise,
          period: s.period,
          fidelity: '正史多源',
          source: { platform: '维基文库', url: s.sources[0]?.url ?? '', fidelity: '正史多源' },
          protagonists: variantMeta,
          greetingOrder: variantMeta.map((m) => m.name),
          // 关卡（阶段）的完整内容随扩展走，供前端「副本 → 关卡」两级结构直接展示。
          // 模型用的是世界书里那份，两份内容一致，只是取用路径不同。
          phases: s.phases.map((p) => ({
            id: p.id,
            name: p.name,
            window: p.window,
            situation: p.situation,
            tasks: p.tasks,
            focus: p.focus,
            opponentMoves: p.opponent_moves,
            settleAt: p.settle_at,
            taskCount: p.tasks.length,
          })),
          crossCheckCount: s.cross_checks.length,
          sourceCount: s.sources.length,
          /**
           * 玩家可见的简报。与世界书那套的区别：**这里只放可以给玩家看的东西**。
           * 在场人物的隐藏诉求绝不进这里——那是模型用的。
           * 开场白保持角色视角的「两眼一抹黑」，背景与目标放在副本页给，
           * 两者分工明确：进局之前你知道自己在什么局里，进局之后你只知道你看见的。
           */
          briefing: {
            stage: s.setting,
            situation: s.premise,
            period: s.period,
            span: s.span,
            stakes: s.stakes,
            // v3 没有单独的规则清单：明规则与潜规则写在 setting 里，节拍由各关的 window 给出。
            rules: [],
            clock: s.phases.map((p) => `${p.name}（${p.window}）`).join(' → '),
          },
          /** 怎么玩：对话方式、关卡推进、什么时候结算。 */
          howto: {
            talk: '用第一人称说话就行——想做什么、想说什么，直接打字。不必从选项里挑，也没有预设的对白。',
            advance: `这一局分 ${s.phases.length} 关，按顺序推进。每关的「本关任务」在副本页里列出来了；做完（或明确放弃）本关，局面会推进到下一关。`,
            settle: '想结束这一局时说「结算」，会按阶段分与终局目标逐条判定，并算出代价与剩余敞口。',
          },
        },
      },
    },
  }
}

// ---------------------------------------------------------------------------
if (!existsSync(DIR)) throw new Error(`没有 ${DIR}`)
const files = (await readdir(DIR)).filter((f) => f.endsWith('.json'))
let total = 0
for (const f of files.sort()) {
  const items = JSON.parse(await readFile(path.join(DIR, f), 'utf8'))
  for (const s of items) {
    for (const k of ['id', 'title', 'period', 'span', 'premise', 'setting', 'stakes', 'players', 'phases', 'game', 'protagonists', 'scoring', 'sources']) {
      if (!s[k]) throw new Error(`${s.id}: 缺字段 ${k}`)
    }
    if (s.schema !== 'v3-history') throw new Error(`${s.id}: schema 必须是 v3-history`)
    if (s.phases.length < 3 || s.phases.length > 6) throw new Error(`${s.id}: 阶段数 ${s.phases.length} 不在 3~6`)
    for (const ph of s.phases) {
      if (!ph.tasks?.length) throw new Error(`${s.id} 阶段 ${ph.id}: 没有任务（v3 必须给明确任务）`)
      for (const k of ['name', 'window', 'situation', 'focus', 'opponent_moves', 'settle_at']) {
        if (!ph[k]) throw new Error(`${s.id} 阶段 ${ph.id}: 缺 ${k}`)
      }
    }
    if (!s.game.history_note) throw new Error(`${s.id}: 缺 game.history_note（必须说明史实基线与放宽处）`)
    for (const [i, cc] of (s.cross_checks ?? []).entries()) {
      if (!cc.our_choice || !cc.why_it_matters) throw new Error(`${s.id} cross_checks[${i}]: 结构不全`)
    }
    // 引文强制校验
    let quotes = 0
    for (const [i, src] of s.sources.entries()) { requireQuote(`${s.id} sources[${i}](${src.work})`, src.quote); quotes++ }
    for (const [i, cc] of (s.cross_checks ?? []).entries()) {
      for (const [j, src] of cc.sources.entries()) { requireQuote(`${s.id} cross_checks[${i}].sources[${j}]`, src.quote); quotes++ }
    }
    for (const [i, q] of (s.evidence ?? []).entries()) { requireQuote(`${s.id} evidence[${i}]`, q); quotes++ }

    const st = buildStCard(s)
    const card = parseJsonCard(st)
    const json = JSON.stringify({ ...card, pngBytes: null }, null, 2)
    const back = hydrateStoredCard(JSON.parse(json))
    if ((back.alternateGreetings ?? []).length !== s.protagonists.length - 1) throw new Error(`${s.id}: 变体数不符`)
    if (back.extensions?.['tavern-gym']?.version !== 3) throw new Error(`${s.id}: 扩展版本不符`)

    const cardId = stableCardId(s)
    if (!DRY) {
      const dir = path.join(CHAR_ROOT, cardId)
      await mkdir(path.join(dir, 'assets'), { recursive: true })
      await writeFile(path.join(dir, 'card.json'), json, 'utf8')
      await writeFile(path.join(dir, 'assets', 'character-book.json'), JSON.stringify(st.data.character_book, null, 2), 'utf8')
      await writeFile(path.join(dir, 'assets', 'regex-scripts.json'), '[]', 'utf8')
    }
    const chars = back.characterBook.entries.reduce((n, e) => n + e.content.length, 0)
    console.log(`  ${s.id}  ${cardId}`)
    console.log(`      位置${s.protagonists.length} 参与者${s.players.length} 阶段${s.phases.length} 引文${quotes}条 交叉验证${s.cross_checks.length}处`)
    console.log(`      世界书${back.characterBook.entries.length}条/${chars}字`)
    total++
  }
}
console.log(`\n${DRY ? '（dry run）' : '已写入'} ${total} 张 v3 历史副本卡（校验引文全部逐字命中）`)
