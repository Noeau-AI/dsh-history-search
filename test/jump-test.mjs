// 点击命中行「跳到该处」的离线自测：用假 DOM（chat 滚动容器 + 文本节点 + 分页按钮）
// 跑 revealHit，验证它会在命中文本出现在 DOM 后滚到该行、必要时先点「加载更早」，
// 并在文本始终不出现时按预算放弃。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

let spec = null
const headChildren = []
const bodyChildren = []
globalThis.NodeFilter = { SHOW_TEXT: 4 }
globalThis.window = {
  __ModuleLoader__: { load(s) { spec = s } },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
}
globalThis.document = {
  head: { appendChild: (el) => headChildren.push(el) },
  createElement: () => ({
    setAttribute(k, v) { this[k] = v },
    textContent: '',
    className: '',
    removeChild() {},
  }),
  querySelector: () => null,
}
globalThis.document.body = { appendChild: (el) => bodyChildren.push(el) }

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

// ---- 假 DOM 构造 -------------------------------------------------------------------
let landed = []
let clicks = []

function makeRow(key, text) {
  const row = {
    attrs: { 'data-chat-flow-key': key, 'data-chat-node-key': key },
    classList: { add(c) { row._cls = c }, remove() {} },
    _cls: null,
    offsetWidth: 10,
    textContent: text,
    scrollIntoViewCalls: 0,
    scrollIntoView() { row.scrollIntoViewCalls += 1; landed.push(key) },
  }
  const textNode = { nodeValue: text, parentElement: row }
  row.hasAttribute = (n) => Object.prototype.hasOwnProperty.call(row.attrs, n)
  row.getAttribute = (n) => row.attrs[n]
  return { row, textNode }
}

function makeRoot({ pages }) {
  // pages: [[text, ...], ...] —— 每点一次「加载更早」翻出一页更早的内容
  let shown = 0
  const all = pages.map((texts) => texts.map((t, i) => makeRow('k' + shown + '-' + i, t)))
  const visible = () => {
    const out = []
    for (let p = 0; p <= shown && p < all.length; p += 1) out.push(...all[p].map((r) => r.textNode))
    return out
  }
  const older = {
    disabled: false,
    click() { clicks.push(shown); if (shown < all.length - 1) { shown += 1 } else { older.disabled = true } },
  }
  const scope = {
    querySelector: (sel) => (sel === 'button' ? older : null),
  }
  const root = {
    isConnected: true,
    get textContent() { return visible().map((n) => n.nodeValue).join('') },
    querySelector: (sel) => (sel === '[class*="_older"]' ? (older.disabled ? null : scope) : null),
    ownerDocument: {
      createTreeWalker() {
        const nodes = visible()
        let i = -1
        return { nextNode() { i += 1; return i < nodes.length ? nodes[i] : null } }
      },
    },
  }
  return root
}

function installRoot(root) {
  globalThis.document.querySelector = (sel) =>
    (sel === '[data-conversation-scroll]' || sel === '[data-conversation-region]') ? root : null
}

// ---- 用例 1：needlesFor 从命中片段里派生候选串 ---------------------------------------
const hit = { seq: 12, snippet: { pre: '那就先按本地样本', match: '调度台', post: '流程走一遍' } }
const ns = needlesFor(hit)
if (ns.length === 0) throw new Error('needlesFor 返回空')
if (!Object.values(ns).includes('调度台')) throw new Error('needlesFor 缺 match: ' + JSON.stringify(ns))

// ---- 用例 2：命中在已渲染页里 → 直接落点，不点分页 ----------------------------------
landed = []
clicks = []
installRoot(makeRoot({ pages: [['最近的对话 与调度台 无关的结尾', '命中在这：打开调度台 看看']] }))
const ok2 = await revealHit({ snippet: { pre: '打开', match: '调度台', post: ' 看看' } })
if (ok2 !== true) throw new Error('用例2 应返回 true')
if (landed.length !== 1) throw new Error('用例2 应落点一次, 实际 ' + landed.length)
if (clicks.length !== 0) throw new Error('用例2 不该点分页, 实际 ' + clicks.length)

// ---- 用例 3：命中在更早的分页里 → 先点「加载更早」再落点 ----------------------------
landed = []
clicks = []
installRoot(makeRoot({ pages: [['最新一轮对话的尾巴'], ['中间一轮'], ['很早的那句：把调度台 面板改成可滚动']] }))
const ok3 = await revealHit({ snippet: { pre: '把', match: '调度台', post: ' 面板改成可滚动' } })
if (ok3 !== true) throw new Error('用例3 应返回 true')
if (clicks.length < 2) throw new Error('用例3 应至少点两次分页, 实际 ' + clicks.length)
if (landed.length !== 1) throw new Error('用例3 应落点一次, 实际 ' + landed.length)

// ---- 用例 4：文本永远不出现 → 失败（不落点） ----------------------------------------
landed = []
clicks = []
installRoot(makeRoot({ pages: [['完全不相干的对话内容']] }))
const ok4 = await revealHit({ snippet: { pre: 'x', match: '这个词根本不在页面里', post: 'y' } })
if (ok4 !== false) throw new Error('用例4 应返回 false')
if (landed.length !== 0) throw new Error('用例4 不该落点')

console.log('jump test OK')
console.log('  needlesFor:', JSON.stringify(ns))
console.log('  用例2 直接落点 / 用例3 翻页后落点 / 用例4 放弃')
