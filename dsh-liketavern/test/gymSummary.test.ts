/**
 * listCharacters 的剧情投影（CharacterSummary.gym）行为。
 *
 * 重点是这条摘要**不能让卡消失**：card.json 可能是旧版或手工维护的，
 * 元数据形状不可信。任何异常的 tavern-gym 都只能让 gym 变成 undefined，
 * 不能影响 cardId/name/tags 等既有字段，也不能让整张卡从列表里掉出去。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createBlankCard } from '../src/state/card.js'
import { importCard, listCharacters } from '../src/state/workspace.js'

let root = ''
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'tavern-gym-summary-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

/** 造一张带指定 gym 元数据的卡并落盘，返回 cardId。 */
async function importWithGym(name: string, gym: unknown): Promise<string> {
  const base = createBlankCard(name)
  const card = gym === undefined ? base : { ...base, extensions: { ...base.extensions, 'tavern-gym': gym } }
  const { cardId } = await importCard(root, card)
  return cardId
}

const wellFormed = {
  scenarioId: 'E-10',
  role: 'engineer',
  premise: '副总要把你的软著署名给关系户做投名状。',
  fidelity: '有加工',
  protagonists: [
    { index: 0, name: '陈大懒', position: '后端主力', difficulty: '普通', baseline: { grade: 'B', main: 2.5 } },
    { index: 1, name: 'A 工', position: '关系户', difficulty: '困难', baseline: { grade: 'C', main: 1 } },
    { index: 2, name: '副总', position: '中层', difficulty: '困难', baseline: { grade: 'C', main: 0.5 } },
  ],
}

it('剧情卡投影出编号/岗位/主角数/主角名/原型结算/前情/可信度', async () => {
  const cardId = await importWithGym('副总拿我的成果做投名状', wellFormed)
  const items = await listCharacters(root)
  expect(items).toHaveLength(1)
  expect(items[0]!.gym).toEqual({
    scenarioId: 'E-10',
    role: 'engineer',
    protagonistCount: 3,
    protagonistNames: ['陈大懒', 'A 工', '副总'],
    grade: 'B',
    premise: '副总要把你的软著署名给关系户做投名状。',
    fidelity: '有加工',
    kind: 'contemporary',
    period: '',
    phases: [],
  })
})

it('普通卡没有 gym 字段，既有摘要不受影响', async () => {
  const cardId = await importWithGym('普通角色', undefined)
  const items = await listCharacters(root)
  expect(items[0]!.cardId).toBe(cardId)
  expect(items[0]!.gym).toBeUndefined()
})

it.each([
  ['不是对象', 'oops'],
  ['protagonists 不是数组', { protagonists: { a: 1 } }],
  ['条目没有 name', { protagonists: [{ position: 'x' }] }],
  ['protagonists 为空数组', { protagonists: [] }],
  ['条目全是非对象', { protagonists: ['甲', 1, null] }],
])('元数据异常（%s）只让 gym 缺省，卡片本身照常列出', async (_label, gym) => {
  await importWithGym('坏元数据卡', gym)
  const items = await listCharacters(root)
  expect(items).toHaveLength(1)
  expect(items[0]!.name).toBe('坏元数据卡')
  expect(items[0]!.gym).toBeUndefined()
})

it('缺 scenarioId/role/grade/premise/fidelity 时用空值补齐，主角名仍然保留', async () => {
  await importWithGym('半成品剧情卡', { protagonists: [{ name: '甲' }, { name: '乙' }] })
  const items = await listCharacters(root)
  expect(items[0]!.gym).toEqual({
    scenarioId: '', role: '', protagonistCount: 2, protagonistNames: ['甲', '乙'],
    grade: null, premise: '', fidelity: '', kind: 'contemporary', period: '', phases: [],
  })
})

it('混排时剧情卡与普通卡互不影响', async () => {
  await importWithGym('剧情甲', wellFormed)
  await importWithGym('普通乙', undefined)
  await importWithGym('坏元数据丙', { protagonists: 'bad' })
  const items = await listCharacters(root)
  expect(items).toHaveLength(3)
  const byName = new Map(items.map((i) => [i.name, i]))
  expect(byName.get('剧情甲')!.gym?.protagonistCount).toBe(3)
  expect(byName.get('普通乙')!.gym).toBeUndefined()
  expect(byName.get('坏元数据丙')!.gym).toBeUndefined()
})

it('手工把 extensions 改成坏形状后，列表仍然读得到这张卡（不因元数据消失）', async () => {
  const cardId = await importWithGym('手改卡', wellFormed)
  const path = join(root, cardId, 'card.json')
  const stored = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  await writeFile(path, JSON.stringify({ ...stored, extensions: { 'tavern-gym': 42 } }))
  const items = await listCharacters(root)
  expect(items).toHaveLength(1)
  expect(items[0]!.gym).toBeUndefined()
})
