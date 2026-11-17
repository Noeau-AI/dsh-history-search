// DSH 全历史全文搜索 · 浏览器半边
// 零构建：按 __ModuleLoader__ 契约手写，React 从宿主模块表取。
// 侧栏「历史搜索」入口 + 主区域整页面板（输入 → 跨全部工作区的历史命中 → 点击跳会话）。
// 数据来自 Host 半边 /dsh-history-search/api/search（只读，不写任何文件）。
window.__ModuleLoader__.load({
  id: 'dsh-history-search',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const API = '/dsh-history-search/api'
    const PANEL = 'history-search'
    const DEBOUNCE_MS = 260

    // ---------- 主题跟随 ----------
    let scheme = 'dark'
    const schemeListeners = new Set()
    function useScheme() {
      const [s, setS] = React.useState(scheme)
      React.useEffect(() => {
        setS(scheme)
        schemeListeners.add(setS)
        return () => schemeListeners.delete(setS)
      }, [])
      return s
    }

    // ---------- 小工具 ----------
    function pad(n) { return String(n).padStart(2, '0') }
    function fmtBytes(n) {
      if (!n) return '0 B'
      if (n < 1024) return n + ' B'
      if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
      if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'
      return (n / 1073741824).toFixed(1) + ' GB'
    }
    function baseName(p) {
      if (!p) return ''
      const parts = String(p).replace(/\\/g, '/').split('/').filter(Boolean)
      return parts.length ? parts[parts.length - 1] : ''
    }
    function fmtTime(t) {
      if (!t) return '—'
      const d = new Date(t)
      if (Number.isNaN(d.getTime())) return '—'
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    }
    const ROLE_LABEL = { user: '你', assistant: '助手', context: '注入', tool: '工具', system: '系统' }

    function SearchIcon(props) {
      const s = (props && props.size) || 18
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' },
        h('circle', { cx: 10.5, cy: 10.5, r: 6.2 }),
        h('path', { d: 'M15.2 15.2 20 20' }))
    }

    const CSS = `
.hsr-root{--hsr-sans:"PingFang SC","Microsoft YaHei","Segoe UI",system-ui,-apple-system,sans-serif;--hsr-mono:ui-monospace,"Cascadia Mono","SF Mono",Consolas,"Liberation Mono",monospace;--hsr-r:6px;position:relative;width:100%;height:100%;max-height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;font-family:var(--hsr-sans);font-size:13px;line-height:1.55;-webkit-font-smoothing:antialiased}
.hsr-dark{--hsr-line:rgba(148,178,220,.26);--hsr-line-soft:rgba(148,178,220,.14);--hsr-ink:#EDF5FF;--hsr-ink-2:#A6BEDC;--hsr-ink-3:#71889F;--hsr-accent:#59C8EC;--hsr-wash:rgba(89,200,236,.14);--hsr-bg:rgba(255,255,255,.03);--hsr-hl:rgba(89,200,236,.26);--hsr-hover:rgba(148,178,220,.10)}
.hsr-light{--hsr-line:rgba(60,70,80,.22);--hsr-line-soft:rgba(60,70,80,.12);--hsr-ink:#262B2E;--hsr-ink-2:#5B666B;--hsr-ink-3:#8A9398;--hsr-accent:#1685B4;--hsr-wash:rgba(22,133,180,.10);--hsr-bg:rgba(0,0,0,.02);--hsr-hl:rgba(22,133,180,.20);--hsr-hover:rgba(60,70,80,.07)}
.hsr-root,.hsr-root *{box-sizing:border-box}
.hsr-wrap{flex:1 1 auto;min-height:0;width:100%;max-width:1080px;margin:0 auto;padding:26px 26px 0;display:flex;flex-direction:column}
.hsr-top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding-bottom:14px;border-bottom:1px solid var(--hsr-line)}
.hsr-brand{display:flex;gap:11px;align-items:flex-start}
.hsr-mark{width:28px;height:28px;border:1px solid var(--hsr-line);border-radius:var(--hsr-r);display:flex;align-items:center;justify-content:center;color:var(--hsr-accent);flex:0 0 auto;margin-top:3px}
.hsr-title{margin:0;font-size:18px;font-weight:600;letter-spacing:.02em}
.hsr-sub{margin:2px 0 0;font-family:var(--hsr-mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--hsr-ink-3)}
.hsr-topright{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end;font-family:var(--hsr-mono);font-size:10.5px;letter-spacing:.08em;color:var(--hsr-ink-3)}
.hsr-btn{appearance:none;border:1px solid var(--hsr-line);background:transparent;color:var(--hsr-ink);font-family:var(--hsr-sans);font-size:12px;padding:5px 12px;border-radius:var(--hsr-r);cursor:pointer;transition:background .16s ease,border-color .16s ease}
.hsr-btn:hover{background:var(--hsr-wash);border-color:var(--hsr-accent)}
.hsr-btn.on{border-color:var(--hsr-accent);background:var(--hsr-wash);color:var(--hsr-ink)}
.hsr-btn:disabled{opacity:.4;cursor:default}
.hsr-searchbar{display:flex;align-items:center;gap:10px;margin:18px 0 10px;padding:10px 14px;border:1px solid var(--hsr-line);border-radius:var(--hsr-r);background:var(--hsr-bg)}
.hsr-searchbar:focus-within{border-color:var(--hsr-accent)}
.hsr-input{flex:1 1 auto;min-width:0;appearance:none;border:0;outline:0;background:transparent;color:var(--hsr-ink);font-family:var(--hsr-sans);font-size:15px;padding:2px 0}
.hsr-input::placeholder{color:var(--hsr-ink-3)}
.hsr-filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:0 0 14px;border-bottom:1px solid var(--hsr-line-soft)}
.hsr-chip{border:1px solid var(--hsr-line-soft);background:transparent;color:var(--hsr-ink-2);font-size:11.5px;padding:3px 10px;border-radius:999px;cursor:pointer}
.hsr-chip:hover{color:var(--hsr-ink);border-color:var(--hsr-line)}
.hsr-chip.on{border-color:var(--hsr-accent);color:var(--hsr-ink);background:var(--hsr-wash)}
.hsr-hint{font-family:var(--hsr-mono);font-size:10.5px;letter-spacing:.06em;color:var(--hsr-ink-3);margin-left:auto}
.hsr-top,.hsr-searchbar,.hsr-filters,.hsr-foot{flex:0 0 auto}
.hsr-scroll{position:relative;display:flex;flex:1 1 auto;min-height:120px;max-height:calc(100vh - 240px)}
.hsr-body{flex:1 1 auto;min-width:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding:6px 16px 8px 0;-webkit-overflow-scrolling:touch}
.hsr-body::-webkit-scrollbar{width:0;height:0}
.hsr-sb{position:absolute;top:2px;right:0;bottom:2px;width:11px;border-radius:8px;cursor:pointer;touch-action:none;background:transparent}
.hsr-sb.off{display:none}
.hsr-sb-thumb{position:absolute;left:0;right:0;min-height:32px;border-radius:8px;background:var(--hsr-line);border:2px solid transparent;background-clip:content-box}
.hsr-sb:hover .hsr-sb-thumb{background:var(--hsr-ink-3);background-clip:content-box}

.hsr-sess{margin:14px 0 0;border:1px solid var(--hsr-line-soft);border-radius:var(--hsr-r);overflow:hidden}
.hsr-sesshead{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:9px 13px;background:var(--hsr-bg);cursor:pointer}
.hsr-sesshead:hover{background:var(--hsr-hover)}
.hsr-sesstitle{font-size:13.5px;font-weight:600;color:var(--hsr-ink);flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hsr-meta{font-family:var(--hsr-mono);font-size:10.5px;letter-spacing:.05em;color:var(--hsr-ink-3);white-space:nowrap}
.hsr-hit{display:flex;gap:9px;align-items:flex-start;padding:8px 13px;border-top:1px solid var(--hsr-line-soft);cursor:pointer}
.hsr-hit:hover{background:var(--hsr-hover)}
.hsr-tag{flex:0 0 auto;font-family:var(--hsr-mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;padding:1px 6px;border-radius:3px;border:1px solid var(--hsr-line-soft);color:var(--hsr-ink-3);margin-top:2px}
.hsr-tag.user{color:var(--hsr-accent);border-color:var(--hsr-accent)}
.hsr-snip{flex:1 1 auto;min-width:0;font-size:12.5px;color:var(--hsr-ink-2);word-break:break-word}
.hsr-snip b{color:var(--hsr-ink);background:var(--hsr-hl);border-radius:2px;padding:0 1px;font-weight:600}
.hsr-empty{padding:26px 0;color:var(--hsr-ink-3);font-size:12.5px}
.hsr-foot{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:14px 0 14px;padding-top:12px;border-top:1px solid var(--hsr-line);font-family:var(--hsr-mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--hsr-ink-3)}
.hsr-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:var(--hsr-bg);backdrop-filter:blur(8px);border:1px solid var(--hsr-line);border-radius:var(--hsr-r);padding:9px 16px;font-size:12px;color:var(--hsr-ink);box-shadow:0 8px 30px rgba(0,0,0,.28);z-index:50}
.hsr-land{outline:2px solid var(--hsr-accent,#59C8EC);outline-offset:3px;border-radius:8px;animation:hsr-land-fade 2.4s ease-out}
@keyframes hsr-land-fade{0%{background:var(--hsr-hl,rgba(89,200,236,.26))}72%{background:var(--hsr-hl,rgba(89,200,236,.26))}100%{background:transparent}}
.hsr-toast-float{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9000;padding:9px 16px;border-radius:8px;border:1px solid rgba(148,178,220,.28);background:rgba(20,24,28,.93);color:#EDF5FF;font:12px/1.5 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;box-shadow:0 10px 34px rgba(0,0,0,.35);pointer-events:none}
@media (prefers-reduced-motion:reduce){.hsr-root *{transition:none!important}}
`

    function ensureStyle() {
      if (document.querySelector('style[data-dsh-hsr]')) return
      const el = document.createElement('style')
      el.setAttribute('data-dsh-hsr', '')
      el.textContent = CSS
      document.head.appendChild(el)
    }

    function buildUrl(q, f) {
      const p = new URLSearchParams({ q })
      p.set('role', f.role)
      if (f.cs) p.set('cs', '1')
      if (f.regex) p.set('regex', '1')
      if (f.tools) p.set('tools', '1')
      if (f.any) p.set('any', '1')
      p.set('limit', '40')
      p.set('per', '4')
      return API + '/search?' + p.toString()
    }

    function Snippet(props) {
      const s = props.snippet || {}
      return h('span', { className: 'hsr-snip' },
        s.pre || '',
        h('b', null, s.match || ''),
        s.post || '')
    }

    // ---- jump-to-hit: land the reading view on the message that matched -------------
    const JUMP_STEP_MS = 160
    const JUMP_BUDGET_MS = 20000
    const JUMP_IDLE_MS = 5000
    const JUMP_MAX_PAGES = 60

    function stripWs(v) {
      return String(v == null ? '' : v).replace(/[\s\u3000\u00a0]+/g, '')
    }

    function needlesFor(hit) {
      const s = (hit && hit.snippet) || {}
      const m = stripWs(s.match || '')
      const full = stripWs((s.pre || '') + (s.match || '') + (s.post || ''))
      const out = []
      const push = (v) => {
        if (!v || v.length < 2) return
        if (out.indexOf(v) === -1) out.push(v)
      }
      if (full.length >= 24) push(full)
      if (m.length >= 6) push(m)
      if (full.length >= 16) push(full.slice(0, 40))
      if (m.length >= 2) push(m)
      if (out.length === 0 && full.length > 0) push(full)
      return out
    }

    function chatRoot() {
      return document.querySelector('[data-conversation-scroll]') ||
        document.querySelector('[data-conversation-region]') || null
    }

    function floatToast(msg) {
      try {
        const el = document.createElement('div')
        el.className = 'hsr-toast-float'
        el.textContent = msg
        document.body.appendChild(el)
        window.setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el) }, 2800)
      } catch (e) {}
    }

    /** Walk rendered text and climb to the chat row that owns the matched text node. */
    function findAnchor(root, needles) {
      if (root === null || !root.isConnected) return null
      const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
      let node = walker.nextNode()
      while (node !== null) {
        const text = stripWs(node.nodeValue)
        if (text.length >= 6) {
          for (let i = 0; i < needles.length; i += 1) {
            if (text.indexOf(needles[i]) !== -1) {
              let el = node.parentElement
              let depth = 0
              let loose = null
              while (el !== null && depth < 14) {
                if (el.hasAttribute('data-chat-flow-key') || el.hasAttribute('data-chat-node-key')) return el
                if (loose === null && el.hasAttribute('data-slot') && el.getAttribute('data-slot') === 'conversation.chat.node') loose = el
                el = el.parentElement
                depth += 1
              }
              return loose !== null ? loose : node.parentElement
            }
          }
        }
        node = walker.nextNode()
      }
      return null
    }

    /** The chat view pages older history in; click that page control while we look for the hit. */
    function olderButton(root) {
      if (root === null) return null
      const scope = root.querySelector('[class*="_older"]')
      if (scope === null) return null
      const btn = scope.querySelector('button')
      if (btn === null || btn.disabled) return null
      return btn
    }

    function land(el) {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }) } catch (e) {}
      try {
        el.classList.remove('hsr-land')
        void el.offsetWidth
        el.classList.add('hsr-land')
        window.setTimeout(() => { try { el.classList.remove('hsr-land') } catch (e) {} }, 2600)
      } catch (e) {}
    }

    /**
     * Open a session through the workspace service, then scroll the reading view to the
     * matched message instead of leaving the reader at the tail. Older history is paged
     * in on demand, so this keeps clicking the "load earlier" control until the text
     * shows up. Resolves to `true` when the message was actually revealed.
     */
    function revealHit(hit) {
      return new Promise((resolve) => {
        const needles = needlesFor(hit)
        if (needles.length === 0) { resolve(false); return }
        let waited = 0
        let pages = 0
        let idle = 0
        let done = false
        let lastRoot = null
        let timer = null
        const finish = (ok) => {
          if (done) return
          done = true
          if (timer !== null) window.clearTimeout(timer)
          resolve(ok)
        }
        const tick = () => {
          if (done) return
          const root = chatRoot()
          if (root !== null) {
            const el = findAnchor(root, needles)
            if (el !== null) { land(el); finish(true); return }
            if (root !== lastRoot) { lastRoot = root; pages = 0; idle = 0 }
            const btn = olderButton(root)
            if (btn !== null && pages < JUMP_MAX_PAGES) {
              pages += 1
              idle = 0
              try { btn.click() } catch (e) {}
            } else {
              // nothing left to page in: the transcript is complete, stop waiting soon
              idle += JUMP_STEP_MS
              if (idle >= JUMP_IDLE_MS) { finish(false); return }
            }
          }
          waited += JUMP_STEP_MS
          if (waited >= JUMP_BUDGET_MS) { finish(false); return }
          timer = window.setTimeout(tick, JUMP_STEP_MS)
        }
        timer = window.setTimeout(tick, 90)
      })
    }

    function makePanel(ctx) {
      function Panel() {
        const s = useScheme()
        const [q, setQ] = React.useState('')
        const [filters, setFilters] = React.useState({ role: 'all', cs: false, regex: false, tools: false, any: false })
        const [state, setState] = React.useState({ status: 'idle', data: null, error: null })
        const [stats, setStats] = React.useState(null)
        const [selfcheck, setSelfcheck] = React.useState(null)
        const [toast, setToast] = React.useState(null)
        const inputRef = React.useRef(null)
        const bodyRef = React.useRef(null)
        const [sb, setSb] = React.useState({ ratio: 1, pos: 0 })

        const syncSb = React.useCallback(() => {
          const el = bodyRef.current
          if (!el) return
          const h = el.clientHeight
          const sh = el.scrollHeight
          if (sh <= h + 2) {
            setSb((prev) => (prev.ratio >= 1 ? prev : { ratio: 1, pos: 0 }))
            return
          }
          setSb({ ratio: h / sh, pos: el.scrollTop / (sh - h) })
        }, [])

        const dragSb = (e) => {
          const el = bodyRef.current
          if (!el || !e || !e.currentTarget) return
          const rect = e.currentTarget.getBoundingClientRect()
          const track = rect.height || 1
          const move = (ev) => {
            const sh = el.scrollHeight
            if (sh <= el.clientHeight) return
            const at = Math.min(1, Math.max(0, (ev.clientY - rect.top) / track))
            el.scrollTop = at * (sh - el.clientHeight)
          }
          move(e)
          const stop = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', stop)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', stop)
        }

        const flash = React.useCallback((msg) => {
          setToast(msg)
          window.setTimeout(() => setToast(null), 2600)
        }, [])

        React.useEffect(() => {
          fetch(API + '/stats', { headers: { accept: 'application/json' } })
            .then((r) => r.json())
            .then((j) => { if (j && j.ok) setStats(j) })
            .catch(() => {})
        }, [])

        const needle = q.trim()
        const filtersKey = filters.role + '|' + filters.cs + '|' + filters.regex + '|' + filters.tools + '|' + filters.any

        React.useEffect(() => {
          if (needle === '') { setState({ status: 'idle', data: null, error: null }); return }
          const ctrl = new AbortController()
          setState((prev) => ({ status: 'loading', data: prev.data, error: null }))
          const timer = window.setTimeout(() => {
            fetch(buildUrl(needle, filters), { signal: ctrl.signal, headers: { accept: 'application/json' } })
              .then((r) => r.json())
              .then((j) => {
                if (ctrl.signal.aborted) return
                if (j && j.ok) {
                  setState({ status: 'ready', data: j, error: null })
                  if (bodyRef.current) bodyRef.current.scrollTop = 0
                  window.setTimeout(syncSb, 0)
                }
                else setState({ status: 'error', data: null, error: (j && j.error) || '检索失败' })
              })
              .catch((e) => { if (!ctrl.signal.aborted) setState({ status: 'error', data: null, error: String((e && e.message) || e) }) })
          }, DEBOUNCE_MS)
          return () => { window.clearTimeout(timer); ctrl.abort() }
        }, [needle, filtersKey])

        const openSession = (sessionId, hit) => {
          let opened = false
          try {
            const r = ctx.uiWorkspace.openSession(sessionId)
            opened = true
            if (r && typeof r.then === 'function') r.then(() => {}, () => {})
          } catch (err) {
            console.error('[dsh-history-search] 打开会话失败', err)
            try { navigator.clipboard && navigator.clipboard.writeText(sessionId) } catch (e) {}
            flash('该会话打不开（可能属于未激活的工作区）：已复制 ID ' + sessionId)
          }
          if (!opened) return
          if (!hit) { flash('已打开会话'); return }
          flash('正在定位命中位置…')
          revealHit(hit).then((ok) => {
            if (ok) floatToast('已跳到命中位置')
            else floatToast('已打开会话，但没能在页面里定位到这段（可能更早或属于未渲染的分页）')
          })
        }

        const toggle = (key) => setFilters((f) => ({ ...f, [key]: !f[key] }))
        const setRole = (role) => setFilters((f) => ({ ...f, role }))

        const d = state.data
        const sessions = (d && d.sessions) || []
        const loading = state.status === 'loading'

        const filterButtons = ['all', 'user', 'assistant'].map((r) => h('button', {
          key: r, type: 'button', className: 'hsr-chip' + (filters.role === r ? ' on' : ''),
          onClick: () => setRole(r),
        }, r === 'all' ? '全部发言' : r === 'user' ? '只看我的输入' : '只看助手回复'))
        const optButtons = [['cs', '区分大小写'], ['regex', '正则'], ['tools', '含工具输出'], ['any', '含系统注入']].map((pair) => h('button', {
          key: pair[0], type: 'button', className: 'hsr-chip' + (filters[pair[0]] ? ' on' : ''),
          onClick: () => toggle(pair[0]),
        }, pair[1]))
        const hintText = d && d.ok
          ? (d.tookMs + 'ms · ' + d.totalSessions + ' 个会话 ' + d.hitTotal + ' 命中' +
             (d.hitTotal > 0 && d.returnedSessions < d.totalSessions ? '（只显示前 ' + d.returnedSessions + ' 个会话）' : ''))
          : '覆盖全部工作区的历史归档'

        const sessionCards = sessions.map((sess) => {
          const rows = sess.hits.map((hit, i) => h('div', {
            className: 'hsr-hit', key: 'h' + i, title: '第 ' + hit.seq + ' 条事件 · 点击跳到该处',
            onClick: () => openSession(sess.sessionId, hit),
          }, [
            h('span', { key: 'tag', className: 'hsr-tag ' + hit.role }, ROLE_LABEL[hit.role] || hit.role),
            h(Snippet, { key: 'snip', snippet: hit.snippet }),
          ]))
          const titleOnly = (sess.titleHit && rows.length === 0)
            ? h('div', { className: 'hsr-hit', onClick: () => openSession(sess.sessionId, null) }, [
              h('span', { key: 'tag', className: 'hsr-tag' }, '标题'),
              h('span', { key: 'snip', className: 'hsr-snip' }, '标题命中：' + sess.title),
            ])
            : null
          return h('div', { className: 'hsr-sess', key: sess.sessionId }, [
            h('div', {
              className: 'hsr-sesshead', key: 'head',
              title: (sess.cwd || '') + ' · ' + sess.sessionId,
              onClick: () => openSession(sess.sessionId, null),
            }, [
              h('span', { key: 'title', className: 'hsr-sesstitle' }, sess.title),
              h('span', { key: 'ws', className: 'hsr-meta' }, baseName(sess.cwd) || sess.workspaceSlug || '—'),
              h('span', { key: 'time', className: 'hsr-meta' }, fmtTime(sess.mtime)),
              h('span', { key: 'count', className: 'hsr-meta' }, sess.hitCount + ' 命中' + (sess.truncated ? '+' : '')),
            ]),
            rows,
            titleOnly,
          ])
        })

        const bodyChildren = [
          state.status === 'error' ? h('div', { key: 'err', className: 'hsr-empty' }, '检索失败：' + (state.error || '')) : null,
          state.status === 'idle' ? h('div', { key: 'idle', className: 'hsr-empty' }, '输入片段就开始搜。中文直接搜整段即可（例：调度台、天财、币安），也可输入正则。') : null,
          sessionCards,
          state.status === 'ready' && sessions.length === 0 ? h('div', { key: 'none', className: 'hsr-empty' }, '没有命中。可以试试缩短关键词，或勾上「含工具输出」「含系统注入」。') : null,
        ]

        const headerEl = h('header', { className: 'hsr-top' }, [
          h('div', { key: 'brand', className: 'hsr-brand' }, [
            h('span', { key: 'mark', className: 'hsr-mark' }, h(SearchIcon, { size: 15 })),
            h('div', { key: 'text' }, [
              h('h1', { key: 'title', className: 'hsr-title' }, '历史全文搜索'),
              h('p', { key: 'sub', className: 'hsr-sub' }, 'ALL WORKSPACES · 直读 session.v4.jsonl.zstd'),
            ]),
          ]),
          h('div', { key: 'right', className: 'hsr-topright' }, [
            stats ? h('span', { key: 'stat' }, (stats.files || 0) + ' 个会话 / ' + fmtBytes(stats.bytes)) : null,
            h('button', {
              key: 'new', className: 'hsr-btn', type: 'button',
              onClick: () => { if (!inputRef.current) return; inputRef.current.focus(); inputRef.current.select() },
            }, '新搜索'),
          ]),
        ])

        const barEl = h('div', { className: 'hsr-searchbar' }, [
          h(SearchIcon, { key: 'icon', size: 15 }),
          h('input', {
            key: 'input',
            ref: inputRef,
            className: 'hsr-input',
            type: 'text',
            value: q,
            autoFocus: true,
            placeholder: '输入任意片段（中文整段即可，不必分词）…',
            onChange: (e) => setQ(e.target.value),
          }),
          loading ? h('span', { key: 'loading', className: 'hsr-meta' }, '检索中…') : null,
          q ? h('button', { key: 'clear', className: 'hsr-btn', type: 'button', onClick: () => setQ('') }, '清除') : null,
        ])

        const filtersEl = h('div', { className: 'hsr-filters' }, [
          filterButtons,
          optButtons,
          h('span', { key: 'hint', className: 'hsr-hint' }, hintText),
        ])

        const runSelfcheck = () => {
          setSelfcheck({ phase: 'loading' })
          fetch(API + '/selfcheck', { headers: { accept: 'application/json' } })
            .then((r) => r.json())
            .then((j) => setSelfcheck({ phase: 'done', body: j }))
            .catch((err) => setSelfcheck({ phase: 'failed', error: String((err && err.message) || err) }))
        }
        const selfcheckEl = selfcheck === null
          ? null
          : selfcheck.phase === 'loading'
            ? h('span', { key: 'sc', className: 'hsr-meta' }, '自检中…')
            : selfcheck.phase === 'failed'
              ? h('span', { key: 'sc', className: 'hsr-meta' }, '自检失败：' + selfcheck.error)
              : h('span', {
                key: 'sc',
                className: 'hsr-meta',
                style: { whiteSpace: 'normal', lineHeight: '1.5' },
              }, (selfcheck.body && selfcheck.body.verdict) || '自检没有返回结论')

        const footEl = h('footer', { className: 'hsr-foot' }, [
          h('span', { key: 'ro' }, '只读 · 不改任何会话文件'),
          h('button', {
            key: 'sc-btn',
            className: 'hsr-btn',
            type: 'button',
            onClick: runSelfcheck,
            title: '现场解一遍最大的归档，看链路通不通（Node 版本 / 帧数 / 事件数）',
          }, '自检'),
          selfcheckEl,
          h('span', { key: 'cache' }, stats ? '归档 ' + fmtBytes(stats.bytes) + ' · 内存缓存 ' + (stats.cached || 0) : '—'),
          h('span', { key: 'root' }, stats && stats.sessionsRoot ? stats.sessionsRoot : ''),
        ])

        return h('div', { className: 'hsr-root ' + (s === 'light' ? 'hsr-light' : 'hsr-dark') }, [
          h('div', { key: 'wrap', className: 'hsr-wrap' }, [headerEl, barEl, filtersEl, h('div', { key: 'scroll', className: 'hsr-scroll' }, [
            h('div', { key: 'body', className: 'hsr-body', ref: bodyRef, onScroll: syncSb }, bodyChildren),
            h('div', {
              key: 'sb',
              className: 'hsr-sb' + (sb.ratio >= 1 ? ' off' : ''),
              onPointerDown: dragSb,
              onMouseDown: dragSb,
              title: '拖动或滚轮上下翻',
            }, h('div', {
              className: 'hsr-sb-thumb',
              style: { height: (sb.ratio * 100) + '%', top: (sb.pos * (1 - sb.ratio) * 100) + '%' },
            })),
          ]), footEl]),
          toast ? h('div', { key: 'toast', className: 'hsr-toast' }, toast) : null,
        ])
      }
      return Panel
    }

    function apply(ctx) {
      ensureStyle()
      ctx.inject(['theme'], (c) => {
        const push = (snap) => {
          const next = snap && snap.active && snap.active.colorScheme === 'light' ? 'light' : 'dark'
          if (next === scheme) return
          scheme = next
          schemeListeners.forEach((fn) => fn(next))
        }
        try { push(c.theme.getTheme()) } catch (e) { console.warn('[dsh-history-search] 读主题失败', e) }
        c.on('theme/change', push)
      })
      const Panel = makePanel(ctx)
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 3, label: () => '历史搜索' }, SearchIcon))
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, Panel))
    }

    return {
      inject: ['slots', 'uiWorkspace'],
      apply,
      /** Exposed for `test/jump-test.mjs` (pure functions, no host state). */
      __hsr: { needlesFor, findAnchor, revealHit },
    }
  },
})
