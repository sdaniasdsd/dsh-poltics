/**
 * 剧情库页签（panel/stories.tsx）的渲染行为。
 *
 * 这个页面只读不写，风险集中在「筛选条件」与「把摘要字段显示错」两件事上：
 *  - 只列带 gym 投影的剧情卡，普通角色卡不能混进来；
 *  - 主角数、原型结算要按摘要字段显示，缺结算时给明确说法而不是留空；
 *  - 搜索要能按主角名命中（用户记得的往往是「我想演口罩哥」而不是剧情名）。
 */
import type { ReactNode } from 'react'
import { act, create } from 'react-test-renderer'
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StoriesSection } from '../src/client/panel/stories.js'
import { SearchInput } from '../src/client/util.js'
import { setTavernLocale } from '../src/client/i18n.js'
import type { CharacterSummary, TavernRemote } from '../src/client/types.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: (props: { children?: ReactNode }) => <button>{props.children}</button>,
  Modal: (props: { open: boolean; children?: ReactNode }) => props.open ? <div>{props.children}</div> : null,
  Tooltip: (props: { children?: ReactNode }) => <>{props.children}</>,
  Toast: () => null,
  Menu: (props: { anchor?: ReactNode }) => <>{props.anchor}</>,
  IconChevronDownOutlineMedium: () => null,
  IconSearchOutlineMedium: () => null,
  IconUserOutlineMedium: () => null,
}))

/** 只给测试用到的字段，其余按类型补齐。 */
function summary(over: Partial<CharacterSummary> & { cardId: string; name: string }): CharacterSummary {
  return {
    hasAvatar: false, hasCharacterBook: false, characterBookName: null, characterBookEntryCount: 0,
    ...over,
  }
}

const gymCard = (id: string, name: string) => summary({
  cardId: id, name,
  gym: {
    scenarioId: id, role: 'engineer', protagonistCount: 3, kind: 'history', period: '曹魏正始年间',
    phases: [{ id: 1, name: '辞与就', window: '201—220', taskCount: 4 }, { id: 2, name: '四友', window: '220—226', taskCount: 3 }],
    protagonistNames: ['陈大懒', 'A 工', '副总'], grade: 'B',
    premise: '副总要把你的软著署名给关系户做投名状。', fidelity: '有加工',
  },
})
const plainCard = (id: string, name: string) => summary({ cardId: id, name })
const noGradeCard = (id: string, name: string) => summary({
  cardId: id, name,
  gym: {
    scenarioId: id, role: 'worker', protagonistCount: 2, kind: 'contemporary', period: '', phases: [],
    protagonistNames: ['梁土林', '武小刚'], grade: null,
    premise: '包工头欠薪还叫人动手，你手里有一台铲车。', fidelity: '直接转述',
  },
})
const suspectCard = (id: string, name: string) => summary({
  cardId: id, name,
  gym: {
    scenarioId: id, role: 'sales', protagonistCount: 3, kind: 'contemporary', period: '', phases: [],
    protagonistNames: ['苏棠', '周晗', '林远'], grade: 'C',
    premise: '公示栏上你的名字被撕下来了。', fidelity: '疑似虚构',
  },
})

let view: ReactTestRenderer | undefined
beforeEach(() => setTavernLocale('zh'))
afterEach(async () => {
  if (view) await act(async () => view.unmount())
  view = undefined
})

async function mount(items: CharacterSummary[], detail?: unknown) {
  const getCharacterDetail = vi.fn(async () => detail === undefined
    ? { ok: false as const, error: { code: 'x', message: 'no detail' } }
    : { ok: true as const, value: detail })
  const remote = {
    listCharacters: async () => ({ ok: true, value: { items } }),
    getCharacterDetail,
  } as unknown as TavernRemote
  await act(async () => { view = create(<StoriesSection remote={remote} />) })
  return { getCharacterDetail }
}

/** 造一份带完整简报的角色详情，供展开用例使用。 */
function gymDetail() {
  return {
    cardId: 'E-10', revision: 'r', name: '副总拿我的成果做投名状', description: '', personality: '',
    scenario: '', firstMes: '开场一', alternateGreetings: ['开场二', '开场三'], mesExample: '',
    systemPrompt: '', postHistoryInstructions: '', creatorNotes: '', creator: '', characterVersion: '1',
    tags: [], spec: 'chara_card_v2', hasCharacterBook: true, characterBookName: null,
    characterBookEntryCount: 9, hasAvatar: false, depthPrompt: null,
    extensions: {
      'tavern-gym': {
        scenarioId: 'E-10', role: 'engineer', version: 3, period: '曹魏正始年间',
        briefing: {
          stage: '曹操死后的曹魏，宗室与士族争朝政。',
          situation: '你和另一个人共执朝政。',
          period: '曹魏正始年间', span: '', stakes: '输了不只丢官。',
          rules: ['明规则：遗诏共执。', '潜规则：谁掌禁兵谁说了算。'], clock: '月底要报上去。',
        },
        howto: { talk: '用第一人称说话就行。', advance: '这一局分 2 关，按顺序推进。', settle: '说「结算」就会逐条判定。' },
        phases: [
          {
            id: 1, name: '辞与就', window: '201—220',
            situation: '曹操以司空之位征辟你。',
            tasks: ['把材料交给 A 工', '处理王威与高君雅'],
            focus: '第一次装病的成败决定后面四十年',
            opponentMoves: '曹操会派人核实',
            settleAt: '曹操是否相信了你的病',
          },
          { id: 2, name: '四友', window: '220—226', tasks: ['占住太子府的位置'] },
        ],
        protagonists: [
          {
            index: 0, name: '陈大懒', position: '后端主力', difficulty: '普通', goal: '保住软著署名',
            knows: ['代码是你写的'], unaware: ['副总已经在铺路'], leverage: ['只有你懂底层'], constraints: ['交接单差一个签字'],
            baseline: { grade: 'B', main: 2.5 },
          },
          { index: 1, name: 'A 工', position: '关系户', difficulty: '困难', goal: '拿一个能立住的业绩', baseline: { grade: 'C', main: 1 } },
        ],
      },
    },
  }
}

/** 剧情卡行：类名同时含 tile 与 storyTile。 */
const tiles = () => view!.root.findAll((node) => typeof node.type === 'string'
  && typeof node.props.className === 'string'
  && node.props.className.includes('dsh-tavern-storyTile'))

/** 把一棵子树里的文本拼起来，用于按行断言（实例没有 toJSON）。 */
function textOf(node: ReactTestInstance): string {
  const parts: string[] = []
  const walk = (n: ReactTestInstance) => {
    for (const child of n.children) {
      if (typeof child === 'string') parts.push(child)
      else walk(child)
    }
  }
  walk(node)
  return parts.join('')
}

async function search(text: string) {
  await act(async () => view!.root.findByType(SearchInput).props.onChange(text))
}

it('只列剧情卡，普通角色卡不混进来', async () => {
  await mount([gymCard('E-10', '副总拿我的成果做投名状'), plainCard('c1', '普通角色'), noGradeCard('W-05', '讨薪五次')])
  expect(tiles()).toHaveLength(2)
  const text = JSON.stringify(view!.toJSON())
  expect(text).toContain('副总拿我的成果做投名状')
  expect(text).toContain('讨薪五次')
  expect(text).not.toContain('普通角色')
})

it('显示主角数与原型结算；缺结算时给明确说法', async () => {
  await mount([gymCard('E-10', '副总拿我的成果做投名状'), noGradeCard('W-05', '讨薪五次')])
  const text = JSON.stringify(view!.toJSON())
  expect(text).toContain('3 个位置')
  expect(text).toContain('原型结算 B')
  // 新设计：闭着的副本行只给数量，不铺主角名单——名单与「无确定结局」都在展开后的位置区
  expect(text).not.toContain('陈大懒 / A 工 / 副总')
  expect(text).not.toContain('原型无确定结局')
  expect(text.match(/原型结算 B/g)).toHaveLength(1)
})

it('显示一句话前情，让用户在标题之外能判断这是什么局', async () => {
  await mount([gymCard('E-10', '副总拿我的成果做投名状')])
  expect(JSON.stringify(view!.toJSON())).toContain('副总要把你的软著署名给关系户做投名状。')
})

it('只有「疑似虚构」的来源打警示徽标，直接转述不打', async () => {
  await mount([suspectCard('S-09', '空降关系户顶了我的位子'), noGradeCard('W-05', '讨薪五次')])
  const rows = tiles()
  expect(rows).toHaveLength(2)
  expect(textOf(rows[0]!)).toContain('疑似虚构')
  // 「直接转述」不该出现警示徽标文案
  expect(textOf(rows[1]!)).not.toContain('疑似虚构')
})

it('搜索能按主角名命中，清空后恢复全部', async () => {
  await mount([gymCard('E-10', '副总拿我的成果做投名状'), noGradeCard('W-05', '讨薪五次')])
  await search('副总')
  expect(tiles()).toHaveLength(1)
  expect(JSON.stringify(view!.toJSON())).toContain('副总拿我的成果做投名状')

  await search('武小刚')
  expect(tiles()).toHaveLength(1)
  expect(JSON.stringify(view!.toJSON())).toContain('讨薪五次')

  await search('查无此剧')
  expect(tiles()).toHaveLength(0)
  expect(JSON.stringify(view!.toJSON())).toContain('没有匹配')

  await search('')
  expect(tiles()).toHaveLength(2)
})

it('一张剧情卡都没有时给出空态而不是空白页', async () => {
  await mount([plainCard('c1', '普通角色')])
  expect(tiles()).toHaveLength(0)
  const text = JSON.stringify(view!.toJSON())
  expect(text).toContain('还没有副本')
})

it('点开一行拉一次详情并显示完整简报，再收起；二次点开不重复请求', async () => {
  const { getCharacterDetail } = await mount([gymCard('E-10', '副总拿我的成果做投名状')], gymDetail())
  const tile = tiles()[0]!
  expect(textOf(tile)).toContain('点开看关卡')

  await act(async () => tile.props.onClick())
  expect(getCharacterDetail).toHaveBeenCalledTimes(1)
  expect(getCharacterDetail).toHaveBeenCalledWith({ cardId: 'E-10' })

  const expanded = textOf(view!.root)
  expect(expanded).toContain('起手就知道')
  expect(expanded).toContain('代码是你写的')
  expect(expanded).toContain('起手不知道')
  expect(expanded).toContain('副总已经在铺路')
  expect(expanded).toContain('手里的筹码')
  expect(expanded).toContain('约束与代价')
  expect(expanded).toContain('拿一个能立住的业绩')
  // 第二个主角没写简报数组，就不该出现空标题
  expect(expanded).toContain('A 工')

  // 收起再展开：走缓存，不再请求
  await act(async () => tiles()[0]!.props.onClick())
  expect(textOf(view!.root)).not.toContain('起手就知道')
  await act(async () => tiles()[0]!.props.onClick())
  expect(getCharacterDetail).toHaveBeenCalledTimes(1)
  expect(textOf(view!.root)).toContain('起手就知道')
})

it('两级结构：副本行给关卡数，展开后是关卡链，点关卡才出任务', async () => {
  await mount([gymCard('E-10', '副总拿我的成果做投名状')], gymDetail())
  // 第一级：副本行上只给「2 个关卡」，不给任务正文
  const tile = tiles()[0]!
  expect(textOf(tile)).toContain('2 个关卡')
  expect(textOf(tile)).toContain('曹魏正始年间')
  expect(textOf(tile)).not.toContain('项任务')

  // 第二级：展开副本 → 先看到背景与玩法，再看到关卡链
  await act(async () => tile.props.onClick())
  const opened0 = textOf(view!.root)
  expect(opened0).toContain('背景（进场前给你看）')
  expect(opened0).toContain('曹操死后的曹魏')
  expect(opened0).toContain('赌注')
  expect(opened0).toContain('怎么玩')
  expect(opened0).toContain('用第一人称说话就行')
  expect(opened0).toContain('说「结算」就会逐条判定')

  const chain = textOf(view!.root)
  expect(chain).toContain('关卡链')
  expect(chain).toContain('辞与就')
  expect(chain).toContain('201—220')
  expect(chain).toContain('2 项任务')
  expect(chain).toContain('四友')
  expect(chain).toContain('1 项任务')

  // 第三级：点某一关 → 才出现该关的明确任务与判定口径
  const levels = view!.root.findAll((node) => typeof node.type === 'string'
    && typeof node.props.className === 'string'
    && node.props.className.includes('dsh-tavern-level')
    && !node.props.className.includes('levelWrap')
    && !node.props.className.includes('levelNo')
    && !node.props.className.includes('levelName')
    && !node.props.className.includes('levelWindow')
    && !node.props.className.includes('levelTasks')
    && !node.props.className.includes('levelBody')
    && !node.props.className.includes('levelSituation')
    && !node.props.className.includes('levelNote'))
  expect(levels.length).toBe(2)
  expect(textOf(view!.root)).not.toContain('把材料交给 A 工')
  await act(async () => levels[0]!.props.onClick({ stopPropagation: () => {} }))
  const opened = textOf(view!.root)
  expect(opened).toContain('本关任务')
  expect(opened).toContain('把材料交给 A 工')
  expect(opened).toContain('博弈焦点')
  expect(opened).toContain('这一关如何判定成败')
})

it('旧宿主投影（gym 里没有 kind / period / phases）不白屏，并标出关卡未载入', async () => {
  // 回归用例：Node 侧的 state 层不随客户端热重载，宿主可能仍在跑旧版投影。
  // 曾经因为裸取 gym.phases.length 而整页白屏（Cannot read properties of undefined）。
  const legacy = {
    cardId: 'H-01', name: '正始年间：两个人共执朝政',
    hasAvatar: false, hasCharacterBook: false, characterBookName: null, characterBookEntryCount: 0,
    gym: {
      scenarioId: 'H-01', role: 'history', protagonistCount: 4,
      protagonistNames: ['司马懿'], grade: null, premise: '你和另一个人共执朝政。', fidelity: '正史多源',
    },
  } as unknown as CharacterSummary
  await mount([legacy], gymDetail())

  const tile = tiles()[0]!
  // kind 缺失时从 role 反推为历史；关卡数未知要明说，不能显示成「单关」
  expect(textOf(tile)).toContain('历史')
  expect(textOf(tile)).toContain('关卡未载入')
  expect(textOf(tile)).not.toContain('单关')

  // 展开也不能抛（详情侧另有 Array.isArray 守卫）
  await act(async () => tile.props.onClick())
  expect(tiles()).toHaveLength(1)
})

it('详情读取失败时给出可读提示，不抛错', async () => {
  await mount([gymCard('E-10', '副总拿我的成果做投名状')])
  await act(async () => tiles()[0]!.props.onClick())
  expect(textOf(view!.root)).toContain('关卡与位置读取失败')
})
