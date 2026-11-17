// 浏览器半边的离线冒烟：用最小 React/ctx 桩把 factory 与 Panel 渲染树跑一遍，
// 确认模块契约（inject/apply）、槽位注册、以及渲染树结构（无多余括号/undefined 组件）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

let spec = null
globalThis.window = {
  __ModuleLoader__: { load(s) { spec = s } },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
}
const headChildren = []
globalThis.document = {
  head: { appendChild: (el) => headChildren.push(el) },
  createElement: () => ({ setAttribute(k, v) { this[k] = v }, textContent: '' }),
  querySelector: (sel) => headChildren.find((el) => el['data-dsh-hsr'] === '') || null,
}

const h = (type, props, ...children) => ({
  type,
  props: { ...(props || {}), children: children.length ? children : (props ? props.children : undefined) },
})
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

// 跑 loader
new Function('window', 'require', src)(globalThis.window, requireStub)
if (!spec) throw new Error('__ModuleLoader__.load 未被调用')
if (spec.id !== 'dsh-history-search') throw new Error('模块 id 不符: ' + spec.id)

const mod = spec.factory(requireStub)
if (typeof mod.apply !== 'function') throw new Error('缺少 apply')
if (!Array.isArray(mod.inject)) throw new Error('缺少 inject 声明')

// 记录槽位注册
const registered = []
const ctx = {
  inject: (deps, fn) => { fn(ctx) },
  theme: { getTheme: () => ({ active: { colorScheme: 'dark' } }) },
  on: () => {},
  slots: {
    inject: (name, fn) => { fn(ctx) },
    register: (meta, comp) => { registered.push({ meta, comp }); return () => {} },
  },
  uiWorkspace: { openSession: () => {} },
}
globalThis.fetch = (url) => Promise.resolve({ json: () => Promise.resolve({ ok: true, files: 3, bytes: 1024 }) })

mod.apply(ctx)

const names = registered.map((r) => r.meta.name)
if (!names.includes('sidebar.panellist')) throw new Error('未注册 sidebar.panellist: ' + names)
if (!names.includes('main')) throw new Error('未注册 main 面板: ' + names)

const main = registered.find((r) => r.meta.name === 'main')
const tree = main.comp()

// 渲染树结构体检
const seen = new Set()
let nodes = 0
const walk = (node, depth) => {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return }
  if (typeof node !== 'object') return
  nodes++
  const label = typeof node.type === 'function' ? (node.type.name || 'fn') : String(node.type)
  if (label === 'undefined' || label === 'fn') throw new Error('渲染树里出现未定义组件: ' + label)
  if (node.props && node.props.className) seen.add(node.props.className.split(' ')[0])
  walk(node.props && node.props.children, depth + 1)
}
walk(tree, 0)

const required = ['hsr-root', 'hsr-wrap', 'hsr-top', 'hsr-searchbar', 'hsr-filters', 'hsr-body', 'hsr-foot']
for (const cls of required) {
  if (!seen.has(cls)) throw new Error('渲染树缺少节点: ' + cls)
}

console.log('client smoke OK')
console.log('  模块 id:', spec.id)
console.log('  inject :', mod.inject.join(', '))
console.log('  槽位   :', names.join(', '))
console.log('  节点数 :', nodes)
console.log('  关键类 :', [...seen].slice(0, 12).join(' '))
