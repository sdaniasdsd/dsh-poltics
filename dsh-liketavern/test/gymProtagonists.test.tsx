/**
 * 训练场「选择扮演主角」的解析与渲染行为。
 *
 * 重点不是镜像实现，而是锁住三件会静默出错的事：
 * 1) extensions 表是外部 JSON，形状不可信 —— 坏数据必须整体降级为 null（退回原来的开场白翻页），
 *    不能渲染出半个选择器或让 hero 崩掉；
 * 2) 下标契约 —— 组件的 index 必须原样来自卡里的 index，它就是 binding.greetingIndex；
 * 3) 难度只认三档刻度，其余按「普通」处理，避免自定义卡把样式撑坏。
 */
import { act, create } from 'react-test-renderer'
import type { ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GymProtagonistPicker, gymMetaOf } from '../src/client/gymProtagonists.js'
import { setTavernLocale } from '../src/client/i18n.js'
import type { CharacterDetail } from '../src/client/types.js'

const mounted: ReactTestRenderer[] = []
beforeEach(() => setTavernLocale('zh'))
afterEach(async () => {
  for (const view of mounted.splice(0)) await act(async () => view.unmount())
})

/** 造一张最小可用的角色详情，extensions 由用例注入。 */
function detailWith(extensions: Record<string, unknown>): CharacterDetail {
  return {
    cardId: 'gym-card', revision: 'r1', name: '副总拿我的成果做投名状', description: '', personality: '',
    scenario: '', firstMes: '开场一', alternateGreetings: ['开场二', '开场三'], mesExample: '',
    systemPrompt: '', postHistoryInstructions: '', creatorNotes: '', creator: '政治素养训练场',
    characterVersion: '1', tags: [], spec: 'chara_card_v2', hasCharacterBook: true,
    characterBookName: null, characterBookEntryCount: 9, hasAvatar: false, depthPrompt: null, extensions,
  }
}

const wellFormed = {
  'tavern-gym': {
    scenarioId: 'E-10',
    role: 'engineer',
    protagonists: [
      {
        index: 0, name: '陈大懒', position: '后端主力', difficulty: '普通', goal: '保住软著署名',
        knows: ['代码是你写的', 'A 工是董事长亲自招来的'],
        unaware: ['副总已经在给 A 工铺路'],
        leverage: ['全部底层逻辑只有你清楚'],
        // 坏元素（数字、空串）必须被丢掉
        constraints: ['离职交接单还差 A 工一个签字', 42, '   '],
        baseline: { grade: 'B', main: 2.5 },
      },
      { index: 1, name: 'A 工', position: '关系户', difficulty: '困难', goal: '拿到一个能立住的业绩', baseline: { grade: 'C', main: 1 } },
      { index: 2, name: '副总', position: '中层', difficulty: '困难', goal: '把功劳分给自己人且不留痕', baseline: { grade: 'C', main: 0.5 } },
    ],
  },
}

it('解析完整主角表：顺序、下标、难度与结算基准逐项保留', () => {
  const meta = gymMetaOf(detailWith(wellFormed))
  expect(meta).not.toBeNull()
  expect(meta!.scenarioId).toBe('E-10')
  expect(meta!.role).toBe('engineer')
  expect(meta!.protagonists.map((p) => p.name)).toEqual(['陈大懒', 'A 工', '副总'])
  expect(meta!.protagonists.map((p) => p.index)).toEqual([0, 1, 2])
  expect(meta!.protagonists.map((p) => p.difficulty)).toEqual(['普通', '困难', '困难'])
  expect(meta!.protagonists[0]!.main).toBe(2.5)
  expect(meta!.protagonists[0]!.grade).toBe('B')
})

it('主角简报数组：正常项保留，非字符串与空串被丢掉，缺字段回落空数组', () => {
  const meta = gymMetaOf(detailWith(wellFormed))!
  const first = meta.protagonists[0]!
  expect(first.knows).toEqual(['代码是你写的', 'A 工是董事长亲自招来的'])
  expect(first.unaware).toEqual(['副总已经在给 A 工铺路'])
  expect(first.leverage).toEqual(['全部底层逻辑只有你清楚'])
  expect(first.constraints).toEqual(['离职交接单还差 A 工一个签字'])
  // 没写这些字段的主角拿到空数组，而不是 undefined（渲染层不必再判空）
  const second = meta.protagonists[1]!
  expect(second.knows).toEqual([])
  expect(second.unaware).toEqual([])
  expect(second.leverage).toEqual([])
  expect(second.constraints).toEqual([])
})

it.each([
  ['没有该键', {}],
  ['不是对象', { 'tavern-gym': 'oops' }],
  ['数组套错层', { 'tavern-gym': [{ name: '甲' }, { name: '乙' }] }],
  ['protagonists 不是数组', { 'tavern-gym': { protagonists: { a: 1 } } }],
  ['只有 1 个主角', { 'tavern-gym': { protagonists: [{ name: '甲' }] } }],
  ['条目缺 name', { 'tavern-gym': { protagonists: [{ position: 'x' }, { position: 'y' }] } }],
  ['条目不是对象', { 'tavern-gym': { protagonists: ['甲', '乙'] } }],
])('形状不可信时整体降级为 null（%s）', (_label, extensions) => {
  expect(gymMetaOf(detailWith(extensions as Record<string, unknown>))).toBeNull()
})

it('坏条目被跳过，剩两个有效主角时仍可用；缺 index 时按数组位置补齐', () => {
  const meta = gymMetaOf(
    detailWith({
      'tavern-gym': {
        protagonists: [
          { name: '甲', position: 'a', difficulty: '普通', goal: 'g' },
          { position: '没有名字' },
          { name: '乙', position: 'b', difficulty: '地狱', goal: 'h' },
        ],
      },
    }),
  )
  expect(meta).not.toBeNull()
  expect(meta!.protagonists.map((p) => p.name)).toEqual(['甲', '乙'])
  expect(meta!.protagonists.map((p) => p.index)).toEqual([0, 2])
})

it.each([
  ['困难', '困难'],
  ['地狱', '地狱'],
  ['普通', '普通'],
  ['hard', '普通'],
  [undefined, '普通'],
  [7, '普通'],
])('难度刻度收口：%s -> %s', (input, expected) => {
  const meta = gymMetaOf(
    detailWith({ 'tavern-gym': { protagonists: [{ name: '甲', difficulty: input }, { name: '乙', difficulty: '普通' }] } }),
  )
  expect(meta!.protagonists[0]!.difficulty).toBe(expected)
})

it('选择器渲染出每个主角，标记当前项，点击上报该主角的 index', async () => {
  const meta = gymMetaOf(detailWith(wellFormed))!
  const onSelect = vi.fn()
  let view!: ReactTestRenderer
  await act(async () => {
    view = create(<GymProtagonistPicker meta={meta} index={1} onSelect={onSelect} />)
  })
  mounted.push(view)

  const buttons = view.root.findAll(
    (node) => typeof node.type === 'string' && node.type === 'button',
  )
  expect(buttons).toHaveLength(3)
  // 当前项必须是第 2 个（index=1），而不是数组里的第 0 个
  expect(buttons.map((b) => b.props['aria-checked'])).toEqual([false, true, false])
  expect(buttons[1]!.findByProps({ className: 'dsh-tavern-gym-name' }).children.join('')).toBe('A 工')

  await act(async () => buttons[2]!.props.onClick())
  expect(onSelect).toHaveBeenCalledWith(2)
})

it('当前下标越界时回退展示第一个主角，不抛错', async () => {
  const meta = gymMetaOf(detailWith(wellFormed))!
  let view!: ReactTestRenderer
  await act(async () => {
    view = create(<GymProtagonistPicker meta={meta} index={99} onSelect={() => {}} />)
  })
  mounted.push(view)
  const buttons = view.root.findAll((n) => typeof n.type === 'string' && n.type === 'button')
  expect(buttons.map((b) => b.props['aria-checked'])).toEqual([false, false, false])
  // 回退到 protagonists[0]，所以展示的是第一个主角的目标
  expect(JSON.stringify(view.toJSON())).toContain('保住软著署名')
})
