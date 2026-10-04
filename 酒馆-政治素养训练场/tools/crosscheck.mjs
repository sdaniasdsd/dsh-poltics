/**
 * crosscheck.mjs — 在本地史料库里做交叉验证：同一件事，不同史料怎么说。
 *
 * 这是历史副本区别于当代副本的地方：当代素材多是单一自述，只能标可信度；
 * 历史材料可以拿两三份独立史源对着读，分歧本身就是信息——
 * 谁在替谁说话、哪一份是官方口径、哪一份来自敌国或私记。
 *
 * 用法: node tools/crosscheck.mjs <关键词> [前后字数]
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.join(path.resolve(HERE, '..'), '04_剧情', '史料库')

const term = process.argv[2]
if (!term) throw new Error('用法: node tools/crosscheck.mjs <关键词> [前后字数]')
const SPAN = Number(process.argv[3] ?? 160)

const files = []
async function walk(dir, prefix = '') {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) await walk(path.join(dir, e.name), prefix + e.name + '/')
    else if (e.name.endsWith('.txt')) files.push([prefix + e.name, path.join(dir, e.name)])
  }
}
await walk(DIR)
files.sort()
let hits = 0
for (const [label, full] of files) {
  const text = await readFile(full, 'utf8')
  let idx = 0
  const found = []
  while ((idx = text.indexOf(term, idx)) !== -1) {
    found.push(idx)
    idx += term.length
  }
  if (found.length === 0) continue
  console.log(`\n${'='.repeat(70)}\n《${label.replace('.txt', '')}》 —— 命中 ${found.length} 处\n${'='.repeat(70)}`)
  for (const [n, at] of found.entries()) {
    const a = Math.max(0, at - SPAN)
    const b = Math.min(text.length, at + term.length + SPAN)
    console.log(`\n--- 第 ${n + 1} 处 ---`)
    console.log(text.slice(a, b).replace(/\n+/g, ' '))
    hits++
  }
}
console.log(`\n\n共 ${hits} 处。`)
