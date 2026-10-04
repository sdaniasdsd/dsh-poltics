/**
 * apply_stagecraft.mjs — 给已生成的卡片补上演出规则与对话示例。
 *
 * 为什么做成后处理而不是改三个转换器：三张卡的 schema 不同（v1/v2/v3），
 * 但「模型该怎么演」这件事与 schema 无关，是同一个要求。
 * 放在一处处理，30 张卡一次生效，也不会因为某个转换器漏改而出现不一致。
 *
 * 幂等：重复运行不会重复插入（按条目注释与规则首行判重）。
 *
 * 用法：node tools/apply_stagecraft.mjs
 */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { STAGECRAFT, exampleDialogue } from './stagecraft.mjs'

const DSH_HOME = process.env.DSH_HOME
if (!DSH_HOME) throw new Error('缺少 DSH_HOME')
const CHAR_ROOT = path.join(DSH_HOME, 'dsh-tavern', 'characters')

const MARK = '演出规则（每一轮都要遵守）'
const RULE_HEAD = STAGECRAFT.split('\n')[0]

/** 从扩展里取在场人物名，供示例对话使用。 */
function castNames(card) {
  const gym = card.extensions?.['tavern-gym']
  const list = gym?.protagonists
  if (Array.isArray(list) && list.length > 0) {
    return list.map((p) => ({ name: typeof p?.name === 'string' ? p.name : '' })).filter((p) => p.name)
  }
  return []
}

let changed = 0
let skipped = 0
const dirs = await readdir(CHAR_ROOT, { withFileTypes: true })
for (const dir of dirs) {
  if (!dir.isDirectory()) continue
  const file = path.join(CHAR_ROOT, dir.name, 'card.json')
  let raw
  try {
    raw = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    continue
  }
  const data = raw
  const book = data.characterBook
  if (!book || !Array.isArray(book.entries)) continue

  const already = book.entries.some((e) => e.comment === MARK)
    && typeof data.postHistoryInstructions === 'string'
    && data.postHistoryInstructions.includes(RULE_HEAD)
    && typeof data.mesExample === 'string'
    && data.mesExample.includes('<START>')
  if (already) {
    skipped++
    continue
  }

  // 1) 演出规则常驻条目，放最前（insertion_order 最小的那两个之前）
  if (!book.entries.some((e) => e.comment === MARK)) {
    const minOrder = book.entries.reduce((min, e) => {
      const n = typeof e.insertion_order === 'number' ? e.insertion_order : 100
      return n < min ? n : min
    }, 100)
    book.entries.unshift({
      keys: [],
      secondary_keys: [],
      comment: MARK,
      content: STAGECRAFT,
      constant: true,
      enabled: true,
      insertion_order: minOrder - 10,
      extensions: { position: 0, depth: 4 },
    })
  }

  // 2) post_history_instructions 末尾再强调一次（那是每轮最后的位置）
  if (typeof data.postHistoryInstructions !== 'string') data.postHistoryInstructions = ''
  if (!data.postHistoryInstructions.includes(RULE_HEAD)) {
    data.postHistoryInstructions = `${data.postHistoryInstructions}\n\n${STAGECRAFT}`
  }

  // 3) 对话示例：教模型回合结构。已有内容的卡不动它。
  if (typeof data.mesExample !== 'string' || !data.mesExample.includes('<START>')) {
    const names = castNames(raw)
    data.mesExample = exampleDialogue(names, data.name ?? '')
  }

  await writeFile(file, JSON.stringify(raw, null, 2), 'utf8')
  changed++
}

console.log(`补入演出规则与对话示例：${changed} 张；已有跳过：${skipped} 张`)
