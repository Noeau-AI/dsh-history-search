// 注入段渲染自测：从已打补丁的工作区 client.js 里抽出 HSR 组件块，
// 用最小 react / react-jsx-runtime 桩把它渲染出来，验证七种状态与「原文」阅读器。
// 目标文件必须处于已打补丁状态；--revert 后本测试会明确报「未找到注入块」。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_TARGET = 'D:\\AIBOX\\deepseekharness\\resources\\app\\dsh\\node_modules\\@deepseek-ai\\dsh-client-ui-workspace\\lib\\client.js'
const TARGET = process.env.HSR_CLIENT_JS || DEFAULT_TARGET
if (!existsSync(TARGET)) {
  console.error('目标文件不存在：' + TARGET)
  process.exit(2)
}
const src = readFileSync(TARGET, 'utf8')
const begin = src.indexOf('/* HSR:BEGIN */')
const end = src.indexOf('/* HSR:END */')
if (begin < 0 || end < 0) {
  console.error('未找到注入块标记（当前文件未打补丁）：' + TARGET)
  process.exit(2)
}
const block = src.slice(begin + '/* HSR:BEGIN */'.length, end)

function makeEngine() {
  const bag = new Map()
  let hookIndex = 0
  let pending = []
  let dirty = false
  const hooks = {
    useState(init) {
      const i = hookIndex++
      if (!bag.has(i)) bag.set(i, init)
      const set = (next) => {
        bag.set(i, typeof next === 'function' ? next(bag.get(i)) : next)
        dirty = true
      }
      return [bag.get(i), set]
    },
    useRef(init) {
      const i = 'ref' + hookIndex++
      if (!bag.has(i)) bag.set(i, { current: init })
      return bag.get(i)
    },
    useCallback(fn) { hookIndex++; return fn },
    useMemo(fn) { hookIndex++; return fn() },
    useEffect(fn) { hookIndex++; pending.push(fn) },
  }
  const react = {
    useState: hooks.useState,
    useEffect: hooks.useEffect,
    useRef: hooks.useRef,
    useCallback: hooks.useCallback,
    useMemo: hooks.useMemo,
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length > 1 ? children : children[0] } }),
  }
  const jsx = (type, props) => ({ type, props })
  const jsxs = (type, props) => ({ type, props })
  const react_jsx_runtime = { jsx, jsxs, Fragment: 'Fragment' }
  return { bag, pending, react, react_jsx_runtime, takeDirty: () => dirty, resetDirty: () => { dirty = false }, resetIndex: () => { hookIndex = 0 }, takePending: () => { const p = pending; pending = []; return p } }
}

function compile(engine) {
  const factory = new Function(
    'react',
    'react_jsx_runtime',
    'window',
    'fetch',
    'AbortController',
    'encodeURIComponent',
    block + '\n\t\treturn HistoryHits;',
  )
  return factory(
    engine.react,
    engine.react_jsx_runtime,
    { setTimeout: (fn) => { fn(); return 1 }, clearTimeout: () => {} },
    globalThis.fetch,
    AbortController,
    encodeURIComponent,
  )
}

// 收集树里的所有文本 + 所有节点（便于点某个 span）
function walk(node, out) {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) { for (const child of node) walk(child, out); return }
  if (typeof node === 'string' || typeof node === 'number') { out.text.push(String(node)); return }
  if (typeof node !== 'object') return
  out.nodes.push(node)
  walk(node.props && node.props.children, out)
}
function inspect(tree) {
  const out = { text: [], nodes: [] }
  walk(tree, out)
  return { text: out.text.join(' | '), nodes: out.nodes, joined: out.text.join('') }
}
function findNode(tree, predicate) {
  const { nodes } = inspect(tree)
  return nodes.find(predicate)
}

const RESULTS = {
  ok: true,
  query: '调度台',
  hitTotal: 3,
  totalSessions: 2,
  sessions: [
    {
      sessionId: 'session-a',
      title: '如何查找历史聊天记录',
      cwd: 'D:\\AIBOX\\deepseekharness',
      hitCount: 2,
      truncated: true,
      hits: [{ seq: 1, role: 'user', snippet: { pre: '在 ', match: '调度台', post: ' 里跑协议' } }],
    },
    { sessionId: 'session-b', title: '国学五问', cwd: 'D:\\AIBOX\\deepseekharness\\国学', hitCount: 1, truncated: false, hits: [] },
  ],
}
const TRANSCRIPT = {
  ok: true,
  id: 'session-a',
  meta: { title: '如何查找历史聊天记录' },
  total: 12,
  eventTotal: 40,
  records: [
    { seq: 1, role: 'user', text: '如何查找历史聊天记录' },
    { seq: 2, role: 'assistant', text: '工作区搜索只按标题匹配。' },
    { seq: 3, role: 'user', text: '那就是说中文搜不到内容。' },
  ],
}

function stubFetch(handler) {
  const calls = []
  globalThis.fetch = (url, options) => {
    calls.push(url)
    return Promise.resolve(handler(url, options))
  }
  return calls
}
const respond = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
})

const failures = []
function expect(name, condition, detail) {
  if (condition) { console.log('  ✔', name) } else { failures.push(name + (detail ? ' :: ' + detail : '')); console.log('  ✘', name, detail || '') }
}

async function renderWith(engine, props, rounds = 8) {
  const HistoryHits = compile(engine)
  let tree = null
  for (let i = 0; i < rounds; i++) {
    engine.resetIndex()
    engine.resetDirty()
    tree = HistoryHits(props)
    for (const fn of engine.takePending()) fn()
    await new Promise((r) => setTimeout(r, 0))
    await Promise.resolve()
    if (!engine.takeDirty()) break
  }
  return tree
}

console.log('注入块渲染自测 · 目标：' + TARGET)

// 1) idle：query 为空 → 不出任何节点
{
  const engine = makeEngine()
  stubFetch(() => respond(RESULTS))
  const tree = await renderWith(engine, { query: '', open: () => {}, t: (k) => k })
  expect('query 为空时返回 null', tree === null, JSON.stringify(tree))
}

// 2) ready：两组会话 + 标题行 + ≥ 标记
{
  const engine = makeEngine()
  const calls = stubFetch(() => respond(RESULTS))
  const tree = await renderWith(engine, { query: '调度台', open: () => {}, t: (k) => k })
  const { joined, nodes } = inspect(tree)
  expect('打的是 /api/search', calls.some((u) => u.includes('/dsh-history-search/api/search')), calls.join(','))
  expect('带 limit=12&per=2', calls.some((u) => u.includes('limit=12&per=2')))
  expect('标题「全历史」', joined.includes('全历史'))
  expect('副标题「跨全部工作区」', joined.includes('跨全部工作区'))
  expect('统计「2 会话 · 3 段命中」', joined.includes('2 会话 · 3 段命中'), joined)
  expect('会话标题出现', joined.includes('如何查找历史聊天记录') && joined.includes('国学五问'))
  expect('截断显示 ≥', joined.includes('≥2 条'), joined)
  expect('snippet 命中片段', joined.includes('调度台'))
  expect('snippet 前后文', joined.includes('在 ') && joined.includes(' 里跑协议'))
  expect('每行有 data-hsr-session', nodes.some((n) => n.props && n.props['data-hsr-session'] === 'session-a'))
  expect('每行可点击（role=button 或 onClick）', nodes.some((n) => n.props && (n.props.role === 'button' || typeof n.props.onClick === 'function')))
  expect('有「原文」入口', nodes.some((n) => n.props && n.props.children === '原文'))
}

// 3) empty：命中 0 会话 → 「无命中」
{
  const engine = makeEngine()
  stubFetch(() => respond({ ok: true, hitTotal: 0, sessions: [] }))
  const tree = await renderWith(engine, { query: 'zzz', open: () => {}, t: (k) => k })
  const { joined } = inspect(tree)
  expect('空结果提示「无命中」', joined.includes('无命中'), joined)
}

// 4) failed：HTTP 500 → 跳过而不炸
{
  const engine = makeEngine()
  stubFetch(() => respond({ ok: false }, 500))
  const tree = await renderWith(engine, { query: '调度台', open: () => {}, t: (k) => k })
  const { joined } = inspect(tree)
  expect('失败文案', joined.includes('全历史命中读取失败'), joined)
}

// 5) 原文阅读器：点「原文」→ 拉 /api/session → 出记录 + 页脚
{
  const engine = makeEngine()
  const calls = stubFetch((url) => (url.includes('/api/session') ? respond(TRANSCRIPT) : respond(RESULTS)))
  const tree = await renderWith(engine, { query: '调度台', open: () => {}, t: (k) => k })
  const original = findNode(tree, (n) => n.props && n.props.children === '原文')
  expect('找到「原文」入口', Boolean(original))
  if (original) {
    original.props.onClick({ stopPropagation: () => {} })
    const next = await renderWith(engine, { query: '调度台', open: () => {}, t: (k) => k })
    const { joined, nodes } = inspect(next)
    expect('打了 /api/session', calls.some((u) => u.includes('/dsh-history-search/api/session?id=session-a')), calls.join(','))
    expect('出现阅读器面板', nodes.some((n) => n.props && n.props['data-hsr'] === 'reader'))
    expect('面板标题用会话标题', joined.includes('如何查找历史聊天记录'))
    expect('有关闭原文', joined.includes('关闭原文'))
    expect('记录正文出现', joined.includes('工作区搜索只按标题匹配。'))
    expect('角色标签出现', joined.includes('assistant'))
    expect('页脚含对话条数与原始事件数', joined.includes('共 12 条对话记录（原始事件 40 条）'), joined)
  }
}

// 6) 原文读取失败：404 → 文案
{
  const engine = makeEngine()
  stubFetch((url) => (url.includes('/api/session') ? respond({ ok: false }, 404) : respond(RESULTS)))
  const tree = await renderWith(engine, { query: '调度台', open: () => {}, t: (k) => k })
  const original = findNode(tree, (n) => n.props && n.props.children === '原文')
  if (original) {
    original.props.onClick({ stopPropagation: () => {} })
    const next = await renderWith(engine, { query: '调度台', open: () => {}, t: (k) => k })
    const { joined } = inspect(next)
    expect('读取失败文案带状态码', joined.includes('原文读取失败：HTTP 404'), joined)
  } else {
    expect('找到「原文」入口（失败场景）', false)
  }
}

// 7) open 抛错 → 回退读原文（跨工作区老会话的现实路径）
{
  const engine = makeEngine()
  const calls = stubFetch((url) => (url.includes('/api/session') ? respond(TRANSCRIPT) : respond(RESULTS)))
  const boom = () => { throw new Error('unavailable') }
  const tree = await renderWith(engine, { query: '调度台', open: boom, t: (k) => k })
  const row = findNode(tree, (n) => n.props && n.props['data-hsr-session'] === 'session-a')
  expect('找到会话行', Boolean(row))
  if (row) {
    row.props.onClick()
    const next = await renderWith(engine, { query: '调度台', open: boom })
    const { nodes } = inspect(next)
    expect('open 抛错后回退到原文面板', nodes.some((n) => n.props && n.props['data-hsr'] === 'reader'))
  }
}

// 8) open 返回 rejected promise → 同样回退
{
  const engine = makeEngine()
  const calls = stubFetch((url) => (url.includes('/api/session') ? respond(TRANSCRIPT) : respond(RESULTS)))
  const reject = () => Promise.reject(new Error('no such session'))
  const tree = await renderWith(engine, { query: '调度台', open: reject })
  const row = findNode(tree, (n) => n.props && n.props['data-hsr-session'] === 'session-a')
  if (row) {
    row.props.onClick()
    await new Promise((r) => setTimeout(r, 0))
    const next = await renderWith(engine, { query: '调度台', open: reject })
    const { nodes } = inspect(next)
    expect('promise 拒绝后回退到原文面板', nodes.some((n) => n.props && n.props['data-hsr'] === 'reader'))
    expect('此时确实请求了 /api/session', calls.some((u) => u.includes('/api/session')))
  } else {
    expect('找到会话行（promise 场景）', false)
  }
}

// 9) 数据面畸形：sessions 不是数组、命中字段缺失 → 不炸
{
  const engine = makeEngine()
  stubFetch(() => respond({ ok: true, sessions: 'nope', hitTotal: 'x' }))
  const tree = await renderWith(engine, { query: 'q', open: () => {}, t: (k) => k })
  const { joined } = inspect(tree)
  expect('畸形数据按空结果处理', joined.includes('无命中'), joined)
}

console.log('\n结果：' + (failures.length === 0 ? '全部通过' : failures.length + ' 项失败'))
if (failures.length) { for (const f of failures) console.log('  - ' + f); process.exit(1) }
