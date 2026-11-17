// 对着「正在运行的桌面端」做验收：不需要登录态，插件路由是宿主内网口的自带前缀路由。
// 用法：node tools\verify.mjs [查询词] [端口]
//   端口缺省取 DSH_WEB_URL，再缺省 61185。
// 退出码 0 = 链路通（health 有 node 字段、stats records > 0、selfcheck ok、搜索有命中）。
import { execFileSync } from 'node:child_process'

const query = process.argv[2] || '调度台'
const port = process.argv[3] || (process.env.DSH_WEB_URL || 'http://127.0.0.1:61185').replace(/.*:(\d+)\/*$/, '$1')
const BASE = 'http://127.0.0.1:' + port + '/dsh-history-search/api'

async function get(path, timeoutMs = 60000) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(BASE + path, { signal: ctl.signal, headers: { accept: 'application/json' } })
    const body = await res.text()
    let json = null
    try { json = JSON.parse(body) } catch {}
    return { status: res.status, json, body }
  } finally {
    clearTimeout(timer)
  }
}

const problems = []
function line(ok, label, detail) {
  console.log((ok ? '  ✔ ' : '  ✘ ') + label + (detail ? '  ' + detail : ''))
  if (!ok) problems.push(label)
}

console.log('检测 ' + BASE + '（查询词：' + query + '）')

const health = await get('/health', 20000)
if (health.status !== 200 || !health.json) {
  console.log('  ✘ 接口连不上（HTTP ' + health.status + '）：宿主没加载插件，或端口不对。先 node tools\\install.mjs --check')
  process.exit(2)
}
const h = health.json
line(true, '接口可达', 'files=' + h.files + ' node=' + (h.node || '—') + ' zstdFrames=' + (h.zstdFrames || 0))
line(Boolean(h.node), '运行的是新版宿主代码', h.node ? 'node ' + h.node : '没有 node 字段 → 宿主还跑着旧代码，需要完全重启桌面端')

const stats = await get('/stats')
const s = stats.json || {}
line((s.records || 0) > 0, '归档解析出对话记录', 'records=' + (s.records || 0) + ' files=' + (s.files || 0) + ' bytes=' + (s.bytes || 0))
if (!(s.records > 0)) {
  console.log('    → records=0 通常意味着解压只拿到第一帧：跑 node test\\frames-test.mjs 定位')
}

const self = await get('/selfcheck')
const sc = self.json || {}
line(Boolean(sc.ok), '自检（现解最大归档）', sc.frames ? 'frames=' + sc.frames + ' events=' + sc.events + ' took=' + sc.tookMs + 'ms' : '')
if (sc.verdict) console.log('    ' + sc.verdict)

const search = await get('/search?q=' + encodeURIComponent(query) + '&limit=20&per=3')
const q = search.json || {}
line((q.hitTotal || 0) > 0, '搜索「' + query + '」', (q.totalSessions || 0) + ' 个会话 / ' + (q.hitTotal || 0) + ' 条命中 / ' + (q.tookMs || 0) + 'ms')
if (q.sessions && q.sessions.length) {
  for (const sess of q.sessions.slice(0, 3)) {
    const hit = sess.hits && sess.hits[0]
    const snip = hit && hit.snippet ? (hit.snippet.pre || '') + '[' + (hit.snippet.match || '') + ']' + (hit.snippet.post || '') : ''
    console.log('    · ' + (sess.title || sess.sessionId) + '  [' + (sess.role || '') + ']  ' + snip.slice(0, 90))
  }
}

console.log('\n结论：' + (problems.length === 0 ? '链路通，侧栏面板与放大镜内联段都能出结果' : problems.length + ' 项不通过：' + problems.join(' / ')))
process.exit(problems.length === 0 ? 0 : 1)
