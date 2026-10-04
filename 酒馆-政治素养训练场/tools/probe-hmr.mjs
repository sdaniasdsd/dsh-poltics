/**
 * probe-hmr.mjs — 只读探测宿主的热重载通道，验证运行中的 GUI 是否会拿到重建后的插件 bundle。
 *
 * 做法：
 *  1) 连 http://127.0.0.1:19387/plugins/events（SSE），收初始帧；
 *  2) 若出现 dsh-liketavern 的版本/rev，与 lib/client.js 的 stat 对比；
 *  3) 再轻触 lib/client.js 的 mtime（不改内容），看宿主是否广播该插件的 rebuilt 帧。
 *
 * 全程只读 + 改一次 mtime；不写任何内容、不发任何业务请求。
 */
import { stat, utimes } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import http from 'node:http'

const LIB = 'D:/开源团队作品/dsh-plugins/plugins/dsh-liketavern/lib/client.js'
const URL_ = 'http://127.0.0.1:19387/plugins/events'
const PLUGIN = 'dsh-liketavern'

/** 宿主的 artifactRevision 口径：sha1(mtimeMs, ctimeMs, size)。 */
async function localRev() {
  const s = await stat(LIB)
  return {
    rev: createHash('sha1').update(`${s.mtimeMs}${s.ctimeMs}${s.size}`).digest('hex'),
    mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, size: s.size,
  }
}

const frames = []
const req = http.get(URL_, { headers: { accept: 'text/event-stream' } }, (res) => {
  console.log('HTTP', res.statusCode, res.headers['content-type'] ?? '')
  res.setEncoding('utf8')
  res.on('data', (chunk) => {
    for (const line of chunk.split('\n')) {
      const t = line.trim()
      if (t) frames.push(t)
    }
  })
})
req.on('error', (e) => console.log('连接错误:', e.message))

const before = await localRev()
console.log('本地 lib/client.js  ->  rev(sha1(mtime,ctime,size)) =', before.rev)
console.log('   mtime=', new Date(before.mtimeMs).toISOString(), 'size=', before.size)

await new Promise((r) => setTimeout(r, 4000))
console.log('\n--- 前 4 秒收到的帧数:', frames.length, '---')
for (const f of frames.slice(0, 25)) console.log('  ', f.slice(0, 220))

const hit = frames.filter((f) => f.includes(PLUGIN))
console.log('\n含 "%s" 的帧:', PLUGIN, hit.length)
for (const f of hit.slice(0, 8)) console.log('  ', f.slice(0, 400))
console.log('  本地 rev 是否出现在任何一帧里:', frames.some((f) => f.includes(before.rev)))

// 轻触 mtime 触发一次 rebuilt 广播（内容不变）
const t = new Date()
await utimes(LIB, t, t)
console.log('\n已轻触 lib/client.js 的 mtime（内容未改），等待宿主广播…')
const mark = frames.length
await new Promise((r) => setTimeout(r, 6000))
const added = frames.slice(mark)
console.log('新增帧数:', added.length)
for (const f of added.slice(0, 20)) console.log('  ', f.slice(0, 400))
const rebuilt = added.filter((f) => f.includes(PLUGIN))
console.log(`\n结论：宿主在 mtime 变化后广播了 ${PLUGIN} 相关帧 ${rebuilt.length} 条`)
req.destroy()
process.exit(0)
