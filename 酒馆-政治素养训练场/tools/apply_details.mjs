/**
 * apply_details.mjs — 把场景 JSON 里的「虚构细节设定」注入对应卡片的常驻世界书条目。
 *
 * 为什么必须常驻：细节是"问到就必须照答"的事实。若走关键词检索，
 * 玩家问「厂名是什么」时未必命中该条目，模型就会现编——那正是要修的问题。
 *
 * 映射方式：卡片扩展里的 tavern-gym.scenarioId ↔ 场景 JSON 的 id。
 * 幂等：按条目注释判重，重复运行不会重复插入。
 *
 * 用法：node tools/apply_details.mjs
 */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const GYM = 'D:/开源团队作品/酒馆-政治素养训练场'
const DSH_HOME = process.env.DSH_HOME
if (!DSH_HOME) throw new Error('缺少 DSH_HOME')
const CHAR_ROOT = path.join(DSH_HOME, 'dsh-tavern', 'characters')

const COMMENT = '虚构细节设定（确定值，不得另编）'
const SECTIONS = [
  ['people', '人物'],
  ['places', '机构与地点'],
  ['numbers', '数字'],
  ['papers', '单据与物件'],
  ['clock', '时间'],
]
const KEYS = { people: 'name', places: 'name', numbers: 'label', papers: 'name', clock: 'when' }

/** 把一个场景的 details 渲染成条目正文。 */
function render(id, title, d) {
  const out = [
    `# 虚构细节设定 · ${id} ${title}`,
    '',
    '以下是本局的**确定事实**。凡涉及这些内容，一律照此作答，**不得另编、不得改动数字与名字**。',
    '每一轮都必须与这里保持一致；玩家问到未列出的细节时，从这些事实推演，不要另造一套。',
  ]
  for (const [key, label] of SECTIONS) {
    const list = d?.[key]
    if (!Array.isArray(list) || list.length === 0) continue
    out.push('', `## ${label}`)
    for (const item of list) {
      if (typeof item !== 'object' || item === null) continue
      const head = item[KEYS[key]] ?? item.name ?? ''
      const note = item.note ?? item.role ?? item.value ?? item.what ?? ''
      const extra = [item.role, item.value, item.what]
        .filter((x) => typeof x === 'string' && x !== '' && x !== note)
        .join('；')
      const body = [note, extra].filter((x) => typeof x === 'string' && x !== '').join('；')
      out.push(`- ${head}${body ? `——${body}` : ''}`)
    }
  }
  return out.join('\n')
}

// 1) 收集所有场景的 details
const byId = new Map()
for (const dir of ['scenarios', 'scenarios_v2', 'scenarios_v3']) {
  const full = path.join(GYM, '04_剧情', dir)
  let files
  try {
    files = await readdir(full)
  } catch {
    continue
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    let arr
    try {
      arr = JSON.parse(await readFile(path.join(full, f), 'utf8'))
    } catch {
      continue
    }
    for (const s of arr) {
      if (s?.id && s.details) byId.set(s.id, { title: s.title ?? '', details: s.details })
    }
  }
}
console.log(`场景 JSON 里带 details 的：${byId.size} 个`)

// 2) 逐张卡注入
let changed = 0
let skipped = 0
let missing = 0
for (const dir of await readdir(CHAR_ROOT, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  const file = path.join(CHAR_ROOT, dir.name, 'card.json')
  let raw
  try {
    raw = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    continue
  }
  const sid = raw.extensions?.['tavern-gym']?.scenarioId
  const hit = sid ? byId.get(sid) : undefined
  if (!hit) {
    missing++
    continue
  }
  const book = raw.characterBook
  if (!book || !Array.isArray(book.entries)) continue
  if (book.entries.some((e) => e.comment === COMMENT)) {
    skipped++
    continue
  }
  const minOrder = book.entries.reduce((min, e) => {
    const n = typeof e.insertion_order === 'number' ? e.insertion_order : 100
    return n < min ? n : min
  }, 100)
  book.entries.unshift({
    keys: [],
    secondary_keys: [],
    comment: COMMENT,
    content: render(sid, hit.title, hit.details),
    constant: true,
    enabled: true,
    insertion_order: minOrder - 10,
    extensions: { position: 0, depth: 4 },
  })
  await writeFile(file, JSON.stringify(raw, null, 2), 'utf8')
  changed++
}
console.log(`注入：${changed} 张；已有跳过：${skipped} 张；场景无 details：${missing} 张`)
