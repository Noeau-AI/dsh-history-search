// 跳转落点自测：用假 DOM 模拟「对话视图分页加载更早的历史 + 折叠轮次」
// 断言重点：
//   1. needlesFor 会区分强针（长、唯一）与弱针（短、易假阳性），并剥掉片段两端的省略号
//   2. 命中就在首屏 → 直接落点，不去点「加载更早」
//   3. 命中在更深的分页里、近处还有同名短词的假阳性 → 必须先翻页，最后落在真命中行
//   4. 只翻到没有更早的页之后才允许用弱针兜底（返回 'weak'）
//   5. 全部分页都没有这段文字、也没有轮次线索 → 返回 false 且不落点
//   6. 文字压根不在任何分页（思考/工具里的命中）→ 按 data-chat-turn 落到那一轮并展开折叠（返回 'turn'）
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

let spec = null
globalThis.NodeFilter = { SHOW_TEXT: 4 }
globalThis.window = {
  __ModuleLoader__: { load(s) { spec = s } },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
}
globalThis.document = {
  head: { appendChild() {} },
  body: { appendChild() {} },
  createElement: () => ({
    setAttribute(k, v) { this[k] = v },
    textContent: '',
    className: '',
    parentNode: null,
    removeChild() {},
  }),
  querySelector: () => null,
}

const h = (type, props, ...children) => ({ type, props: props || {}, children })
const React = {
  createElement: h,
  useState: (init) => [init, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
  Fragment: 'Fragment',
}
const requireStub = (name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
}
new Function('window', 'require', src)(globalThis.window, requireStub)
const mod = spec.factory(requireStub)
const { needlesFor, revealHit } = mod.__hsr

// ---- 假 DOM ----------------------------------------------------------------------
const stats = { landed: [], clicks: 0, folds: 0 }

function walkerOver(nodes) {
  let i = -1
  return { nextNode() { i += 1; return i < nodes.length ? nodes[i] : null } }
}

// opts: {turn, kind, text, fold}
function makeRow(key, text, opts = {}) {
  const attrs = { 'data-chat-flow-key': key, 'data-chat-node-key': key }
  if (opts.turn !== undefined) attrs['data-chat-turn'] = String(opts.turn)
  if (opts.kind !== undefined) attrs['data-chat-flow-kind'] = opts.kind
  let button = null
  if (opts.fold === true) {
    button = {
      _expanded: 'false',
      getAttribute(n) { return n === 'aria-expanded' ? this._expanded : null },
      click() { this._expanded = 'true'; stats.folds += 1 },
    }
  }
  const row = {
    attrs,
    offsetWidth: 10,
    classList: { add() {}, remove() {} },
    scrollIntoView() { stats.landed.push(key) },
    hasAttribute: (n) => Object.prototype.hasOwnProperty.call(row.attrs, n),
    getAttribute: (n) => (Object.prototype.hasOwnProperty.call(row.attrs, n) ? row.attrs[n] : null),
    querySelector: (sel) => (sel === 'button' && button !== null ? button : null),
  }
  const textNode = { nodeValue: text, parentElement: row }
  row.ownerDocument = { createTreeWalker: (target) => walkerOver(target && target._nodes ? target._nodes : []) }
  row._nodes = text.length > 0 ? [textNode] : []
  return row
}

// pages: [[{key,text,turn,kind,fold} | '文本']…]；一页一页往前翻，翻到最后一页就翻不动了
function makeRoot(pages) {
  let shown = 0
  const rows = pages.map((entries, p) => entries.map((e, i) => {
    const opts = typeof e === 'string' ? {} : e
    const key = opts.key || 'p' + p + '-' + i
    return makeRow(key, typeof e === 'string' ? e : (opts.text || ''), opts)
  }))
  const visible = () => {
    const out = []
    for (let p = 0; p <= shown && p < rows.length; p += 1) out.push(...rows[p])
    return out
  }
  const visibleNodes = () => {
    const out = []
    for (const r of visible()) out.push(...r._nodes)
    return out
  }
  const older = {
    disabled: false,
    click() {
      stats.clicks += 1
      if (shown >= rows.length - 1) { older.disabled = true; return }
      setTimeout(() => { shown += 1 }, 60)
    },
  }
  const root = {
    isConnected: true,
    get textContent() { return visibleNodes().map((n) => n.nodeValue).join('') },
    querySelectorAll: (sel) => {
      const all = visible()
      const m = /^\[data-chat-turn="(\d+)"\]$/.exec(sel)
      if (m !== null) return all.filter((r) => r.getAttribute('data-chat-turn') === m[1])
      return all
    },
    querySelector: (sel) => {
      if (sel === '[class*="_older"]') return older.disabled ? null : { querySelector: () => older }
      return null
    },
    ownerDocument: { createTreeWalker: (target) => walkerOver(target === root ? visibleNodes() : (target._nodes || [])) },
  }
  return root
}

function installRoot(root) {
  globalThis.document.querySelector = (sel) =>
    (sel === '[data-conversation-scroll]' || sel === '[data-conversation-region]') ? root : null
}

function landedKeys() {
  return Array.from(new Set(stats.landed))
}
// landed 会有两次 scrollIntoView（+260ms 的补滚），用例之间必须等它落完，
// 否则上一个用例的补落点会串到下个用例的 stats 里。
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 420))
}
function reset() {
  stats.landed = []
  stats.clicks = 0
  stats.folds = 0
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) throw new Error('断言失败：' + name + (detail ? ' —— ' + detail : ''))
}

// ---- 用例 1：分级针 ---------------------------------------------------------------
const longHit = { snippet: { pre: '…那就先按本地样本', match: '调度台', post: '流程走一遍并保留回滚…' } }
const ns1 = needlesFor(longHit)
const strongs = ns1.filter((n) => n.tier === 'strong').map((n) => n.v)
check('needlesFor 有强针', strongs.length > 0, JSON.stringify(ns1))
check('强针剥掉了省略号', strongs.every((v) => !v.startsWith('…') && !v.endsWith('…')), JSON.stringify(strongs))
check('短 match 归入弱针', ns1.some((n) => n.tier === 'weak' && n.v === '调度台'), JSON.stringify(ns1))

const shortHit = { snippet: { pre: '', match: '调度台', post: '' } }
const ns2 = needlesFor(shortHit)
check('只剩短 match 时没有强针', ns2.filter((n) => n.tier === 'strong').length === 0, JSON.stringify(ns2))
check('短 match 仍在候选里', ns2.some((n) => n.v === '调度台'), JSON.stringify(ns2))

// ---- 用例 2：命中在首屏 → 直接落点 ------------------------------------------------
await settle()
reset()
installRoot(makeRoot([['最近一轮的对话，随口提到 调度台 两个字', '命中就在这一屏：那就先按本地样本调度台流程走一遍并保留回滚']]))
const r2 = await revealHit(longHit, 0)
check('用例2 返回 strong', r2 === 'strong', String(r2))
check('用例2 唯一落点行 = 1', landedKeys().length === 1, String(landedKeys()))
check('用例2 没点分页', stats.clicks === 0, String(stats.clicks))

// ---- 用例 3：近处假阳性 + 真命中在更早的分页 --------------------------------------
await settle()
reset()
installRoot(makeRoot([
  ['最新一轮：这里也有 调度台 三个字，但只是提到'],
  ['中间一轮：顺带提到 调度台'],
  ['很早的那句，正是这次命中的原文：那就先按本地样本调度台流程走一遍并保留回滚'],
]))
const r3 = await revealHit(longHit, 0)
check('用例3 返回 strong', r3 === 'strong', String(r3))
check('用例3 翻了至少两页', stats.clicks >= 2, String(stats.clicks))
check('用例3 唯一落点行 = 1', landedKeys().length === 1, String(landedKeys()))
check('用例3 落在最深那页的行', landedKeys()[0] === 'p2-0', landedKeys().join(','))

// ---- 用例 4：只有短词、原文不在任何分页 → 弱针兜底 --------------------------------
await settle()
reset()
installRoot(makeRoot([['这里只有 调度台 这几个字']]))
const r4 = await revealHit(shortHit, 0)
check('用例4 返回 weak', r4 === 'weak', String(r4))
check('用例4 唯一落点行 = 1', landedKeys().length === 1, String(landedKeys()))

// ---- 用例 5：整段文字都不在页面里、也没有轮次线索 → 带到最早能看的位置 -------------
await settle()
reset()
installRoot(makeRoot([['完全不相干的对话内容'], ['还是不相干']]))
const r5 = await revealHit({ snippet: { pre: '这段文字', match: '根本不存在于页面', post: '任何分页里' } }, 0)
check('用例5 返回 top', r5 === 'top', String(r5))
check('用例5 落在最早的一行', landedKeys()[0] === 'p0-0', landedKeys().join(','))

// ---- 用例 6：文字不在页面里，但知道属于第 1 轮 → 落轮次并展开折叠 ----------------
await settle()
reset()
installRoot(makeRoot([
  [
    { key: 'p0-u1', text: '第一轮的问题：随便聊聊', turn: 1, kind: 'user' },
    { key: 'p0-t1', text: '已完成 · 用时 12 秒', turn: 1, kind: 'turn-process', fold: true },
    { key: 'p0-u2', text: '第二轮的问题：再看看别的', turn: 2, kind: 'user' },
  ],
]))
const r6 = await revealHit({ snippet: { pre: '思考里才有的', match: '那句自我纠正', post: '页面不渲染它' } }, 1)
check('用例6 返回 turn', r6 === 'turn', String(r6))
check('用例6 落在第一轮的 user 行', landedKeys()[0] === 'p0-u1', landedKeys().join(','))
check('用例6 只落一个行', landedKeys().length === 1, landedKeys().join(','))
check('用例6 点开了折叠开关', stats.folds >= 1, String(stats.folds))

console.log('jump test OK（' + results.length + ' 项断言）')
for (const r of results) console.log('  ✓ ' + r.name + (r.detail ? ' → ' + r.detail : ''))
