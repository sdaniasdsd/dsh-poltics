/**
 * probe-bundle.mjs — 从运行中的宿主取回它实际提供的 dsh-liketavern 客户端 bundle，
 * 并核对里面是否含有本次新增的「选择扮演主角」代码。
 *
 * 只读：连 SSE 拿 graph，再按 graph 给的 url 发一次 GET。
 */
import http from 'node:http'

const BASE = 'http://127.0.0.1:9873'.replace('9873', '19387')
const PLUGIN = 'dsh-liketavern'

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(BASE + pathname, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.setTimeout(6000, () => req.destroy(new Error('timeout')))
  })
}

/** 从 SSE 拿第一帧 graph。 */
function graphFrame() {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}/plugins/events`, { headers: { accept: 'text/event-stream' } }, (res) => {
      res.setEncoding('utf8')
      let buf = ''
      res.on('data', (chunk) => {
        buf += chunk
        const idx = buf.indexOf('data: {"type":"graph"')
        if (idx >= 0) {
          const line = buf.slice(idx + 6).split('\n')[0]
          try {
            const parsed = JSON.parse(line)
            req.destroy()
            resolve(parsed.graph)
          } catch { /* 等更多数据 */ }
        }
      })
    })
    req.on('error', reject)
    setTimeout(() => { req.destroy(); reject(new Error('未在 8 秒内收到 graph 帧')) }, 8000)
  })
}

const graph = await graphFrame()
console.log('graph.rev =', graph.rev, ' 入口数 =', graph.entries.length)

const entry = graph.entries.find((e) => e.id === PLUGIN)
if (!entry) {
  console.log('❌ graph 里没有', PLUGIN)
  console.log('可用入口:', graph.entries.map((e) => e.id).join(', '))
  process.exit(1)
}
console.log('\n宿主声明的入口:')
console.log('  id  =', entry.id)
console.log('  url =', entry.url)
console.log('  rev =', entry.rev)

const path = entry.url.startsWith('/') ? entry.url : '/' + entry.url
console.log('\nGET', BASE + path)
try {
  const res = await get(path)
  console.log('  HTTP', res.status, res.headers['content-type'], 'bytes =', res.body.length)
  const text = res.body.toString('utf8')
  const markers = [
    // 选择扮演主角（第一批）
    'GymProtagonistPicker', 'gymMetaOf', 'dsh-tavern-gym-item', 'hero.gym.pickRole', 'tavern-gym',
    // 剧情库页签（第二批）
    'StoriesSection', 'dsh-tavern-storyTile', 'dsh-tavern-storyGrade', 'panel.tab.story', 'stories.role.worker',
    // 可展开的主角简报（第三批）
    'dsh-tavern-storyBrief', 'dsh-tavern-storyRoleGoal', 'stories.leverage', 'stories.unaware', 'stories.briefFailed',
    // 历史副本（第四批）
    'stories.role.history',
    // 副本/关卡两级结构（第五批）
    'dsh-tavern-tracks', 'dsh-tavern-dungeon', 'dsh-tavern-chain', 'dsh-tavern-levelBody',
    'stories.track.history', 'stories.levelTasks', 'stories.noLevels', 'stories.singleLevel',
    // 背景与玩法（第六批）
    'dsh-tavern-briefing', 'stories.background', 'stories.howtoTalk', 'stories.searchHint',
  ]
  console.log('\n按新增代码标记核对宿主实际提供的 bundle：')
  let all = true
  for (const m of markers) {
    const ok = text.includes(m)
    if (!ok) all = false
    console.log(`  ${ok ? '✅' : '❌'} ${m}`)
  }
  console.log('\n' + (all
    ? '结论：宿主正在提供的 bundle 就是带「选择扮演主角」的新版本 —— 刷新后浏览器拿到的就是它。'
    : '结论：宿主提供的 bundle 与本地构建不一致，需要进一步排查。'))
} catch (e) {
  console.log('  取回失败:', e.message)
}
process.exit(0)
