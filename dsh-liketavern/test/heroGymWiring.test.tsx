/**
 * 英雄区「选择扮演主角」接线回归。
 *
 * 单测 gymProtagonists.test.tsx 只证明解析与渲染本身正确；本文件证明
 * **hero.tsx 真的把它接上了**——即浏览器里应当看到的行为，用组件渲染来断言：
 *   1) 卡带 tavern-gym 元数据时，预览卡出现主角选择器，且当前项是绑定的那个下标；
 *   2) 点第 N 个主角 → 只改 binding.greetingIndex = N，不产生第二套状态；
 *   3) 原来的匿名「1/3」翻页行被主角选择器取代，不会两套控件同时出现；
 *   4) 不带该元数据的普通卡仍然走原来的翻页行（不能把老用户的功能弄没）。
 */
import type { ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TavernHeroCharacter } from '../src/client/hero.js'
import { CharacterPicker } from '../src/client/characterPicker.js'
import { setTavernLocale } from '../src/client/i18n.js'
import type { CharacterDetail, TavernRemote } from '../src/client/types.js'

/** 每个用例注入自己的角色详情；默认给一张训练场剧情卡。 */
let currentDetail: CharacterDetail
const useGymDetail = (withGym: boolean) => {
  currentDetail = detail(withGym)
}

vi.mock('../src/client/styles.js', () => ({}))
vi.mock('../src/client/actions.js', () => ({ BINDING_CHANGED_EVENT: 'binding-changed' }))
vi.mock('../src/client/chip.js', () => ({
  bindingFromDefaults: async (_remote: unknown, sessionId: string, cardId: string) => ({ sessionId, cardId, greetingIndex: 0 }),
}))
vi.mock('../src/client/characterPicker.js', () => ({ CharacterPicker: () => null, rememberCharacter: () => {} }))
vi.mock('../src/client/cache.js', () => ({
  invalidateSessionBinding: () => {},
  CHARACTER_CHANGED_EVENT: 'character-changed',
  cachedAvatar: async () => ({ ok: true, value: { dataUrl: null } }),
  cachedCharacterDetail: async () => ({ ok: true, value: currentDetail }),
}))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: (p: { children?: ReactNode }) => <button>{p.children}</button>,
  Tooltip: (p: { children?: ReactNode }) => <>{p.children}</>,
  IconChevronLeftOutlineMedium: () => null,
  IconChevronRightOutlineMedium: () => null,
  IconChevronDownOutlineMedium: () => null,
  IconUserOutlineMedium: () => null,
}))

/** 造一张角色详情；withGym 决定是否带训练场主角元数据。 */
function detail(withGym: boolean): CharacterDetail {
  return {
    cardId: 'card', revision: 'r1', name: '副总拿我的成果做投名状', description: '', personality: '',
    scenario: '', firstMes: '我是陈大懒，后端主力。', alternateGreetings: ['我是 A 工，董事长招来的。', '我是副总，要向上交代。'],
    mesExample: '', systemPrompt: '', postHistoryInstructions: '', creatorNotes: '', creator: '',
    characterVersion: '1', tags: [], spec: 'chara_card_v2', hasCharacterBook: true,
    characterBookName: null, characterBookEntryCount: 9, hasAvatar: false, depthPrompt: null,
    extensions: withGym
      ? {
          'tavern-gym': {
            scenarioId: 'E-10',
            role: 'engineer',
            protagonists: [
              { index: 0, name: '陈大懒', position: '后端主力', difficulty: '普通', goal: '保住软著署名', baseline: { grade: 'B', main: 2.5 } },
              { index: 1, name: 'A 工', position: '关系户', difficulty: '困难', goal: '拿一个能立住的业绩', baseline: { grade: 'C', main: 1 } },
              { index: 2, name: '副总', position: '中层', difficulty: '困难', goal: '把功劳分给自己人且不留痕', baseline: { grade: 'C', main: 0.5 } },
            ],
          },
        }
      : {},
  }
}

let view: ReactTestRenderer | undefined
beforeEach(() => {
  setTavernLocale('zh')
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }))
  vi.stubGlobal('document', { body: {} })
  vi.stubGlobal('HTMLElement', class {})
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} })
})
afterEach(async () => {
  if (view) await act(async () => view!.unmount())
  view = undefined
  vi.unstubAllGlobals()
})

const ok = <T,>(value: T) => ({ ok: true as const, value })

/** 造一个会话 fixture；greetingIndex 记录 remote 实际收到的下标。 */
function fixture() {
  const saved: Array<Record<string, unknown>> = []
  const remote = {
    getSessionBinding: async ({ sessionId }: { sessionId: string }) =>
      ok({ binding: { cardId: 'card', sessionId, greetingIndex: 0 }, userName: '旅人', canSwipeGreeting: true, conversationStarted: false }),
    listCharacters: async () => ok({ items: [] }),
    setSessionBinding: async ({ binding }: { binding: Record<string, unknown> }) => {
      saved.push(binding)
      return ok({ saved: true })
    },
    clearSessionBinding: async () => ok({ cleared: true }),
    ensureGreeting: async () => ok({ created: true, conversationStarted: true }),
  } as unknown as TavernRemote
  const sessions = { open: vi.fn(), refresh: vi.fn(async () => {}) }
  const node = <TavernHeroCharacter remote={remote} sessionId="s1" sessions={sessions}
    session={{ blank: true }} useSessions={() => 'tavern'} />
  return { saved, node }
}

/** 走到「已选卡、预览已加载」这一步（与用户在英雄区点一次卡等价）。 */
async function mountAndPick(node: ReactNode) {
  await act(async () => { view = create(node) })
  const chip = view!.root.findByProps({ 'data-tavern-hero-seat': '' }).findByType('button')
  await act(async () => chip.props.onClick())
  await act(async () => view!.root.findByType(CharacterPicker).props.onPick('card'))
}

const gymButtons = () =>
  view!.root.findAll((n) => typeof n.type === 'string' && n.type === 'button'
    && typeof n.props.className === 'string' && n.props.className.includes('dsh-tavern-gym-item'))

const swipeRows = () =>
  view!.root.findAll((n) => n.props && n.props.className === 'dsh-tavern-hero-swipe')

it('剧情卡：预览卡出现主角选择器，当前项是绑定的下标，旧的匿名翻页行被取代', async () => {
  useGymDetail(true)
  const f = fixture()
  await mountAndPick(f.node)

  const buttons = gymButtons()
  expect(buttons).toHaveLength(3)
  expect(buttons.map((b) => b.props['aria-checked'])).toEqual([true, false, false])
  // 三个主角的名字都渲染出来了
  const names = buttons.map((b) => b.findByProps({ className: 'dsh-tavern-gym-name' }).children.join(''))
  expect(names).toEqual(['陈大懒', 'A 工', '副总'])
  // 两套控件不能同时出现
  expect(swipeRows()).toHaveLength(0)
  // 当前主角的目标与结算基准可见
  const text = JSON.stringify(view!.toJSON())
  expect(text).toContain('保住软著署名')
  expect(text).toContain('现实结算')
})

it('点第 N 个主角只改 binding.greetingIndex，不引入第二套状态', async () => {
  useGymDetail(true)
  const f = fixture()
  await mountAndPick(f.node)
  // 选卡本身会写一次绑定（pickCharacter），从这里开始计数
  const before = f.saved.length

  await act(async () => gymButtons()[2]!.props.onClick())
  expect(f.saved).toHaveLength(before + 1)
  expect(f.saved.at(-1)).toMatchObject({ cardId: 'card', greetingIndex: 2 })

  await act(async () => gymButtons()[1]!.props.onClick())
  expect(f.saved).toHaveLength(before + 2)
  expect(f.saved.at(-1)).toMatchObject({ greetingIndex: 1 })
})

it('普通卡（无主角元数据）仍然走原来的翻页行，不会把既有功能弄没', async () => {
  useGymDetail(false)
  const f = fixture()
  await mountAndPick(f.node)

  expect(gymButtons()).toHaveLength(0)
  // 两条备选开场白 + 首条 = 3 个变体，所以翻页行应当存在
  expect(swipeRows()).toHaveLength(1)
})

it('元数据损坏时退回翻页行，而不是渲染半个选择器', async () => {
  useGymDetail(true)
  // 把 protagonists 弄成非法形状
  currentDetail = { ...currentDetail, extensions: { 'tavern-gym': { protagonists: 'not-an-array' } } }
  const f = fixture()
  await mountAndPick(f.node)

  expect(gymButtons()).toHaveLength(0)
  expect(swipeRows()).toHaveLength(1)
})
