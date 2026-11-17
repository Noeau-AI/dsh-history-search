// 离线验收：用假 ctx 把 Host 半边接起来，直接喂 HTTP 请求给它的 handler。
// 这样不用进 DSH 的 401 页面也能验证 zstd 解压、事件提取、中文子串命中、耗时。
import { apply, inject, name } from '../lib/index.js'

const routes = []
const ctx = {
  effect(fn) { return fn() },
  webServer: {
    register(route) { routes.push(route); return () => {} },
  },
}
apply(ctx)

function call(pathname) {
  const route = routes[0]
  const captured = { status: 0, body: null, headers: null }
  const req = { method: 'GET', url: pathname }
  const res = {
    writeHead(status, headers) { captured.status = status; captured.headers = headers },
    end(body) { captured.body = body },
  }
  route.handler(req, res)
  let parsed = null
  try { parsed = JSON.parse(captured.body) } catch { parsed = captured.body }
  return { status: captured.status, json: parsed }
}

console.log('plugin:', name, '| inject:', inject, '| routes:', routes.length, '| path:', routes[0] && routes[0].path)

const health = call('/dsh-history-search/api/health')
console.log('\n[health]', JSON.stringify(health.json))

const stats = call('/dsh-history-search/api/stats')
console.log('\n[stats]', JSON.stringify(stats.json))

for (const q of ['调度台', '天财', '历史聊天', '币安']) {
  const r = call('/dsh-history-search/api/search?q=' + encodeURIComponent(q))
  const j = r.json
  console.log('\n[search]', q, '→', j.ok ? `${j.tookMs}ms 会话 ${j.totalSessions} 命中 ${j.hitTotal}` : 'ERR ' + j.error)
  if (j.ok && j.sessions && j.sessions.length) {
    for (const s of j.sessions.slice(0, 3)) {
      console.log('  •', s.title, '|', s.cwd || s.workspaceSlug, '|', s.hitCount, '命中')
      const first = s.hits[0]
      if (first) console.log('     ↳', (first.snippet.pre + '【' + first.snippet.match + '】' + first.snippet.post).replace(/\s+/g, ' ').slice(0, 150))
    }
  }
}

const role = call('/dsh-history-search/api/search?q=' + encodeURIComponent('调度台') + '&role=user&per=1&limit=3')
console.log('\n[role=user]', role.json.ok ? `${role.json.totalSessions} 会话 / ${role.json.hitTotal} 命中 / ${role.json.tookMs}ms` : role.json.error)

const bad = call('/dsh-history-search/api/search?q=' + encodeURIComponent('([a-') + '&regex=1')
console.log('\n[bad regex]', bad.status, JSON.stringify(bad.json))

const noq = call('/dsh-history-search/api/search')
console.log('[no q]', noq.status, JSON.stringify(noq.json))

// ---- /api/session：原文兜底用的单会话读取 ----
const apiIndex = call('/dsh-history-search/api')
console.log('\n[api index]', apiIndex.status, JSON.stringify(apiIndex.json && apiIndex.json.endpoints))

const hit = call('/dsh-history-search/api/search?q=' + encodeURIComponent('历史聊天') + '&per=1&limit=1')
const sid = hit.json.ok && hit.json.sessions.length ? hit.json.sessions[0].sessionId : null
console.log('[session id]', sid)

if (sid) {
  const one = call('/dsh-history-search/api/session?id=' + encodeURIComponent(sid))
  if (one.json && one.json.ok) {
    console.log('[session]', String(one.json.total) + ' 条事件 · 返回 ' + one.json.records.length + ' 条 · ' + one.json.records[0].role + ': ' + String(one.json.records[0].text).replace(/\s+/g, ' ').slice(0, 60))
    const win = call('/dsh-history-search/api/session?id=' + encodeURIComponent(sid) + '&from=5&limit=3')
    console.log('[session window]', win.json.ok ? 'from=' + win.json.from + ' limit=' + win.json.limit + ' 返回 ' + win.json.records.length + ' 条' : win.json.error)
  } else {
    console.log('[session]', one.status, JSON.stringify(one.json))
  }
}

const noId = call('/dsh-history-search/api/session')
console.log('[session no id]', noId.status, JSON.stringify(noId.json))
const ghost = call('/dsh-history-search/api/session?id=not-a-real-session-id')
console.log('[session ghost]', ghost.status, JSON.stringify(ghost.json))
