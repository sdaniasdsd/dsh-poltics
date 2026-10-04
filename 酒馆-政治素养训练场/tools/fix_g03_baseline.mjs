/**
 * fix_g03_baseline.mjs — 修掉质检发现的一处语义缺陷。
 *
 * G-03 的三个主角里，`小兄弟 A` 与 `老大（你自己）` 的 baseline.note 都自称「原型当事人」，
 * 但素材卡 G-03 的 proxy_score 记的是 A 的处境（陪跑半年、主分 0.1 → D）。
 * 老大事后复盘的那个位置没有独立测得的结局，只能是从同一局面推演出来的。
 *
 * 这里只改这一条 note 的定性前缀，不动数字、不动正文，改完打印前后对照。
 */
import { readFile, writeFile } from 'node:fs/promises'

const FILE = 'D:/开源团队作品/酒馆-政治素养训练场/04_剧情/scenarios/general.json'
const OLD = '原型：原型当事人。按 R1，判断被印证、猜中 11 个人的爽感不计分；'
const NEW = '推演：老大是原文的叙述者，但素材卡的结算基准记的是 A 的处境，这个位置没有独立测得的结局，按同一局面推演。按 R1，判断被印证、猜中 11 个人的爽感不计分；'

const text = await readFile(FILE, 'utf8')
const hits = text.split(OLD).length - 1
if (hits !== 1) throw new Error(`预期命中 1 处，实际 ${hits} 处，拒绝修改`)
await writeFile(FILE, text.replace(OLD, NEW), 'utf8')

const arr = JSON.parse(await readFile(FILE, 'utf8'))
const s = arr.find((x) => x.id === 'G-03')
console.log('G-03 三个主角的基准定性：')
for (const p of s.protagonists) {
  const note = p.baseline?.note ?? ''
  console.log(`  ${p.name.padEnd(10)} ${p.baseline?.grade}(${p.baseline?.main})  推演=${note.includes('推演')}  原型=${note.includes('原型')}`)
  console.log(`      ${note.slice(0, 70)}…`)
}
