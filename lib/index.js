// DSH 全历史全文搜索 · Host 半边
//
// 只做一件事：把 ~/.dsh/sessions 下所有工作区、所有历史会话（session.v4.jsonl.zstd）
// 解压成纯文本，然后做**子串搜索**（中文整段、英文不区分大小写、可选正则）。
//
// 为什么不用官方的 sessionQuery / FTS5：
//   dsh-session-query-sqlite 的 quoteFtsData 会把整条查询包成一个 phrase，
//   而 SQLite unicode61 不切分中文 → "历史聊天" 这种词在 FTS 里永远 0 命中。
//   本插件绕开索引，直接读归档文件，所以任何中文片段都能命中，也不看"当前工作区可见会话"。
//
// 只读：不写任何会话文件，不删除、不修改。缓存只在内存里。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as zlib from 'node:zlib'
import { decodeZstd } from './zstd-frames.js'

export const name = 'dsh-history-search'
export const inject = ['webServer']

const BASE = '/dsh-history-search'
const SESSIONS_ROOT =
  process.env.DSH_HISTORY_SESSIONS ||
  join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sessions')
// 用户真实输入（不含 harness 注入的 runtime-context / skill-catalog / time-context 等）
const USER_SOURCE = process.env.DSH_HISTORY_USER_SOURCE || 'user'
const ZSTD_OK = typeof zlib.zstdDecompressSync === 'function'
const CACHE_LIMIT = 260

const cache = new Map() // path -> { path, mtimeMs, size, meta, records }
const zstdStats = { frames: 0, broken: 0, files: 0 } // 帧解码计数（/api/health 可见）

// ---------------------------------------------------------------- 文件发现
function listSessionFiles(root) {
  const out = []
  let wsEntries
  try {
    wsEntries = readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ws of wsEntries) {
    if (!ws.isDirectory()) continue
    const wsDir = join(root, ws.name)
    let entries
    try {
      entries = readdirSync(wsDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      const full = join(wsDir, ent.name)
      if (ent.isFile() && /\.jsonl\.zst(d)?$/i.test(ent.name)) {
        // 少数布局：会话文件直接躺在工作区目录里
        out.push({ path: full, workspaceSlug: ws.name, dirName: null })
        continue
      }
      if (!ent.isDirectory()) continue
      let inner
      try {
        inner = readdirSync(full, { withFileTypes: true })
      } catch {
        continue
      }
      for (const f of inner) {
        if (!f.isFile()) continue
        if (!/\.jsonl\.zst(d)?$/i.test(f.name)) continue
        out.push({ path: join(full, f.name), workspaceSlug: ws.name, dirName: ent.name })
      }
    }
  }
  return out
}

// 兼容 .zstd 与（假想）未压缩 jsonl：按魔数判断
function readJsonl(path) {
  const raw = readFileSync(path)
  const looksZstd = raw.length > 4 && raw.readUInt32LE(0) === 0xfd2fb528
  if (!looksZstd) return raw.toString('utf8')
  if (!ZSTD_OK) throw new Error('当前 Node 无 zlib.zstdDecompressSync（需要 Node ≥ 22.15 / 23.8）')
  // 归档是「一帧一批」的多帧 zstd：桌面端运行时（Electron 的 Node 24.21）整段解只回第一帧，
  // 必须自己走帧边界逐帧解，否则 1.8MB 的会话只解出 244 字节 → 一条记录都提不出来。
  const info = {}
  const text = decodeZstd(raw, info)
  zstdStats.frames += info.frames || 0
  zstdStats.broken += info.broken || 0
  zstdStats.files += 1
  return text
}

// ---------------------------------------------------------------- 事件提取
function textOfContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'reasoning' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

function compact(text) {
  if (!text) return ''
  // 去掉代码块围栏与超长空白，保留可读内容
  return text.replace(/\r/g, '')
}

function parseSession(path, workspaceSlug, dirName) {
  const text = readJsonl(path)
  const meta = {
    sessionId: dirName || null,
    cwd: null,
    createdAt: null,
    title: null,
    workspaceSlug,
    parentSessionId: null,
  }
  const records = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.length < 2) continue
    let ev
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    if (!ev || typeof ev !== 'object') continue
    const data = ev.data ?? {}
    if (ev.type === 'session') {
      if (ev.id) meta.sessionId = ev.id
      if (ev.cwd) meta.cwd = ev.cwd
      if (ev.createdAt) meta.createdAt = ev.createdAt
      if (ev.parentSessionId) meta.parentSessionId = ev.parentSessionId
      continue
    }
    if (ev.type === 'session/title') {
      if (typeof data.title === 'string' && data.title.trim()) meta.title = data.title.trim()
      continue
    }
    if (ev.type === 'user/message') {
      const kind = (data.source && data.source.kind) || 'none'
      const body = compact(textOfContent(data.content))
      if (!body) continue
      records.push({
        seq: ev.seq ?? i,
        time: ev.time ?? null,
        role: kind === USER_SOURCE ? 'user' : 'context',
        sourceKind: kind,
        text: body,
      })
      continue
    }
    if (ev.type === 'assistant/message') {
      const msg = data.message ?? data
      const body = compact(textOfContent(msg && msg.content))
      if (!body) continue
      records.push({ seq: ev.seq ?? i, time: ev.time ?? null, role: 'assistant', sourceKind: 'assistant', text: body })
      continue
    }
    if (ev.type === 'tool/result') {
      const msg = data.message ?? data
      const body = compact(textOfContent(msg && msg.content))
      if (!body) continue
      const toolName = (data.name || (msg && msg.name) || data.toolName || '') + ''
      records.push({ seq: ev.seq ?? i, time: ev.time ?? null, role: 'tool', sourceKind: toolName || 'tool', text: body })
      continue
    }
    if (ev.type === 'system/message') {
      const msg = data.message ?? data
      const body = compact(textOfContent(msg && msg.content))
      if (!body) continue
      records.push({ seq: ev.seq ?? i, time: ev.time ?? null, role: 'system', sourceKind: 'system', text: body })
    }
  }
  return { meta, records }
}

function loadSession(file) {
  const hit = cache.get(file.path)
  let st
  try {
    st = statSync(file.path)
  } catch {
    return null
  }
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    cache.delete(file.path)
    cache.set(file.path, hit) // 触摸 LRU
    return hit
  }
  let parsed
  try {
    parsed = parseSession(file.path, file.workspaceSlug, file.dirName)
  } catch (err) {
    return { error: String((err && err.message) || err), path: file.path, mtimeMs: st.mtimeMs, size: st.size, records: [], meta: {} }
  }
  const entry = {
    path: file.path,
    mtimeMs: st.mtimeMs,
    size: st.size,
    meta: parsed.meta,
    records: parsed.records,
  }
  cache.set(file.path, entry)
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    cache.delete(oldest)
  }
  return entry
}

/** 按会话 id 或目录名定位会话文件，返回 {file, entry} 或 null。 */
function findSessionById(id) {
  if (!id) return null
  const files = listSessionFiles(SESSIONS_ROOT)
  for (const file of files) {
    if (file.dirName === id) {
      const entry = loadSession(file)
      if (entry && !entry.error) return { file, entry }
    }
  }
  for (const file of files) {
    const entry = loadSession(file)
    if (!entry || entry.error) continue
    if (entry.meta && entry.meta.id === id) return { file, entry }
  }
  return null
}

// ---------------------------------------------------------------- 搜索
function makeSnippet(text, index, matchLen, pad = 46) {
  const start = Math.max(0, index - pad)
  const end = Math.min(text.length, index + matchLen + pad * 2)
  const raw = text.slice(start, end).replace(/\s+/g, ' ')
  return {
    pre: (start > 0 ? '…' : '') + raw.slice(0, index - start),
    match: text.slice(index, index + matchLen),
    post: raw.slice(index - start + matchLen) + (end < text.length ? '…' : ''),
  }
}

function buildMatcher(opts) {
  const raw = opts.query
  if (opts.regex) {
    let flags = ''
    if (!opts.cs) flags += 'i'
    let re
    try {
      re = new RegExp(raw, flags)
    } catch (err) {
      const e = new Error('正则不合法：' + String((err && err.message) || err))
      e.code = 'E_BAD_REGEX'
      throw e
    }
    return (text) => {
      const m = re.exec(text)
      return m ? { index: m.index, len: m[0].length || 1 } : null
    }
  }
  const needle = opts.cs ? raw : raw.toLowerCase()
  return (text) => {
    const hay = opts.cs ? text : text.toLowerCase()
    const i = hay.indexOf(needle)
    return i < 0 ? null : { index: i, len: needle.length }
  }
}

function roleAllowed(record, opts) {
  if (record.role === opts.role || opts.role === 'all') {
    if (record.role === 'context' && !opts.any) return false
    if (record.role === 'tool' && !opts.tools) return false
    if (record.role === 'system' && !opts.any) return false
    return true
  }
  return false
}

function searchAll(opts) {
  const started = Date.now()
  const files = listSessionFiles(SESSIONS_ROOT)
  const matches = buildMatcher(opts)
  const perSession = Math.min(opts.per, 20)
  const sessions = []
  let hitTotal = 0
  let scannedBytes = 0
  let errors = 0
  let titleHits = 0

  for (const file of files) {
    const entry = loadSession(file)
    if (!entry) continue
    if (entry.error) {
      errors += 1
      continue
    }
    scannedBytes += entry.size
    const meta = entry.meta || {}
    if (opts.from) {
      const t = meta.createdAt ? Number(meta.createdAt) : entry.mtimeMs
      if (t < opts.from) continue
    }
    if (opts.to) {
      const t = meta.createdAt ? Number(meta.createdAt) : entry.mtimeMs
      if (t > opts.to) continue
    }
    if (opts.ws && !(meta.cwd || '').toLowerCase().includes(opts.ws.toLowerCase())) continue

    const hits = []
    let titleHit = false
    if (meta.title) {
      const m = !opts.regex
        ? matches(meta.title)
        : (opts.cs ? meta.title.includes(opts.query) : meta.title.toLowerCase().includes(opts.query.toLowerCase())) ? { index: meta.title.toLowerCase().indexOf(opts.query.toLowerCase()), len: opts.query.length } : null
      if (m) titleHit = true
    }
    for (const record of entry.records) {
      if (!roleAllowed(record, opts)) continue
      const m = matches(record.text)
      if (!m) continue
      hits.push({
        seq: record.seq,
        time: record.time,
        role: record.role,
        sourceKind: record.sourceKind,
        snippet: makeSnippet(record.text, m.index, m.len),
      })
      if (hits.length >= perSession) break
    }
    if (titleHit) titleHits += 1
    if (!hits.length && !titleHit) continue
    hitTotal += hits.length
    sessions.push({
      sessionId: meta.sessionId || file.dirName || file.path,
      title: meta.title || '(无标题)',
      cwd: meta.cwd || null,
      workspaceSlug: file.workspaceSlug,
      mtime: entry.mtimeMs,
      createdAt: meta.createdAt || null,
      titleHit,
      hitCount: hits.length,
      truncated: hits.length >= perSession,
      hits,
    })
  }

  sessions.sort((a, b) => b.mtime - a.mtime)
  const total = sessions.length
  const kept = sessions.slice(0, opts.limit)
  return {
    query: opts.query,
    tookMs: Date.now() - started,
    files: files.length,
    scannedBytes,
    errors,
    cached: cache.size,
    totalSessions: total,
    returnedSessions: kept.length,
    hitTotal,
    titleHits,
    sessions: kept,
  }
}

// ---------------------------------------------------------------- HTTP
function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function num(v, dflt, min, max) {
  // 注意 Number(null) === 0、Number('') === 0：缺省参数必须先判空，否则会掉到 min 上。
  if (v === null || v === undefined) return dflt
  const t = String(v).trim()
  if (t === '') return dflt
  const n = Number(t)
  if (!Number.isFinite(n)) return dflt
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function searchOptions(url) {
  const role = (url.searchParams.get('role') || 'all').toLowerCase()
  return {
    query: (url.searchParams.get('q') || '').trim(),
    role: ['all', 'user', 'assistant', 'context', 'tool', 'system'].includes(role) ? role : 'all',
    cs: url.searchParams.get('cs') === '1',
    regex: url.searchParams.get('regex') === '1',
    any: url.searchParams.get('any') === '1',
    tools: url.searchParams.get('tools') === '1',
    ws: url.searchParams.get('ws') || '',
    from: url.searchParams.get('from') ? Date.parse(url.searchParams.get('from')) : 0,
    to: url.searchParams.get('to') ? Date.parse(url.searchParams.get('to')) : 0,
    limit: num(url.searchParams.get('limit'), 30, 1, 200),
    per: num(url.searchParams.get('per'), 3, 1, 20),
  }
}

function stats() {
  const files = listSessionFiles(SESSIONS_ROOT)
  let bytes = 0
  let records = 0
  let newest = 0
  for (const f of files) {
    const entry = loadSession(f)
    if (!entry || entry.error) continue
    bytes += entry.size
    records += entry.records.length
    if (entry.mtimeMs > newest) newest = entry.mtimeMs
  }
  return {
    ok: true,
    sessionsRoot: SESSIONS_ROOT,
    zstd: ZSTD_OK,
    files: files.length,
    bytes,
    records,
    cached: cache.size,
    newestMtime: newest || null,
  }
}

export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: BASE,
      handler(req, res) {
        const url = new URL(req.url || '/', 'http://x')
        const rest = (url.pathname.slice(BASE.length) || '/').replace(/\/+$/, '') || '/'
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
          return sendJson(res, 405, { ok: false, error: 'method' })
        }
        try {
          if (rest === '/api/health') {
            return sendJson(res, 200, { ok: true, zstd: ZSTD_OK, node: process.versions.node, sessionsRoot: SESSIONS_ROOT, files: listSessionFiles(SESSIONS_ROOT).length, cached: cache.size, zstdFrames: zstdStats.frames, zstdBroken: zstdStats.broken })
          }
          if (rest === '/api/stats') return sendJson(res, 200, stats())
          // 自检：现场解一遍最大的归档，回答「这台机器上这条链路到底通不通」。
          if (rest === '/api/selfcheck') {
            const files = listSessionFiles(SESSIONS_ROOT)
            const sized = files.map((f) => {
              let size = 0
              try { size = statSync(f.path).size } catch {}
              return { path: f.path, size }
            })
            const biggest = sized.slice().sort((a, b) => (b.size || 0) - (a.size || 0))[0]
            const out = { ok: false, node: process.versions.node, zstd: ZSTD_OK, files: files.length, sessionsRoot: SESSIONS_ROOT }
            if (!biggest) {
              out.verdict = '没有找到任何会话归档：' + SESSIONS_ROOT
              return sendJson(res, 200, out)
            }
            const t0 = Date.now()
            const raw = readFileSync(biggest.path)
            const info = {}
            let text = ''
            try {
              text = decodeZstd(raw, info)
            } catch (err) {
              out.error = String((err && err.message) || err)
            }
            const lines = text.split('\n')
            let records = 0
            for (const line of lines) {
              if (line.length < 2) continue
              try { if (JSON.parse(line)) records += 1 } catch {}
            }
            let wholeFileBytes = 0
            try { wholeFileBytes = zlib.zstdDecompressSync(raw).length } catch {}
            out.file = biggest.path
            out.fileBytes = raw.length
            out.frames = info.frames || 0
            out.broken = info.broken || 0
            out.decodedBytes = Buffer.byteLength(text)
            out.events = records
            out.wholeFileBytes = wholeFileBytes
            out.tookMs = Date.now() - t0
            out.firstLine = text.slice(0, 120)
            out.ok = records > 0 && (info.frames || 0) > 0
            if (out.ok) {
              const tail = wholeFileBytes < out.decodedBytes
                ? '（本运行时的整段解只回 ' + wholeFileBytes + ' 字节，所以逐帧解码是必需的）'
                : '（本运行时整段解也能解全，结果与逐帧一致）'
              out.verdict = '正常：这个归档 ' + out.frames + ' 帧全解出来了，' + records + ' 条事件可用' + tail
            } else {
              out.verdict = '异常：只解出 ' + records + ' 条事件，检查 ' + biggest.path
            }
            return sendJson(res, 200, out)
          }
          if (rest === '/api/reset') {
            cache.clear()
            return sendJson(res, 200, { ok: true, cleared: true })
          }
          if (rest === '/api/search') {
            const opts = searchOptions(url)
            if (!opts.query) return sendJson(res, 400, { ok: false, error: '缺少 q 参数' })
            if (opts.query.length > 400) return sendJson(res, 400, { ok: false, error: '查询过长' })
            const result = searchAll(opts)
            return sendJson(res, 200, { ok: true, ...result })
          }
          if (rest === '/api/session') {
            const id = url.searchParams.get('id') || ''
            if (!id) return sendJson(res, 400, { ok: false, error: '缺少 id 参数' })
            const found = findSessionById(id)
            if (!found) return sendJson(res, 404, { ok: false, error: '找不到该会话：' + id })
            const from = num(url.searchParams.get('from'), 0, 0, 100000)
            const limit = num(url.searchParams.get('limit'), 400, 1, 4000)
            const all = found.entry.records
            // 默认只回"对话正文"（我的输入 + 助手回复）；系统注入/工具输出用 any=1 或 role 显式放开。
            const anyFlag = url.searchParams.get('any') === '1'
            const roleWant = (url.searchParams.get('role') || '').toLowerCase()
            const body = anyFlag
              ? all
              : all.filter((r) => (roleWant ? r.role === roleWant : (r.role === 'user' || r.role === 'assistant')))
            const slice = body.slice(from, from + limit)
            return sendJson(res, 200, {
              ok: true,
              id: found.entry.meta.sessionId || id,
              path: found.file.path,
              workspaceSlug: found.file.workspaceSlug,
              meta: found.entry.meta,
              total: body.length,
              eventTotal: all.length,
              role: anyFlag ? 'any' : (roleWant || 'conversation'),
              from,
              limit,
              records: slice,
            })
          }
          if (rest === '/' || rest === '/api') {
            return sendJson(res, 200, { ok: true, endpoints: ['/api/search?q=', '/api/session?id=', '/api/stats', '/api/health', '/api/selfcheck', '/api/reset'], sessionsRoot: SESSIONS_ROOT })
          }
          return sendJson(res, 404, { ok: false, error: 'not found' })
        } catch (err) {
          const code = err && err.code === 'E_BAD_REGEX' ? 400 : 500
          return sendJson(res, code, { ok: false, error: String((err && err.message) || err) })
        }
      },
    }),
  )
}
