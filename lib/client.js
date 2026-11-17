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
.hsr-land{outline:3px solid var(--hsr-accent,#59C8EC);outline-offset:5px;border-radius:10px;box-shadow:0 0 0 6px var(--hsr-hl,rgba(89,200,236,.26));animation:hsr-land-blink 4s ease-out}
@keyframes hsr-land-blink{0%{outline-color:var(--hsr-accent,#59C8EC);box-shadow:0 0 0 10px var(--hsr-hl,rgba(89,200,236,.34))}55%{outline-color:var(--hsr-accent,#59C8EC);box-shadow:0 0 0 6px var(--hsr-hl,rgba(89,200,236,.2))}100%{outline-color:transparent;box-shadow:none}}
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
    // 对话视图有几个坑：
    //   1. 更早的轮次要点「加载更早」才会挂出来，没加载的分页里那段的文字根本不在 DOM 里；
    //   2. 已经挂出来的轮次会被折成一行摘要（data-turn-process-hidden / hidden=until-found），
    //      正文还在树里但视觉上不可见 —— 对隐藏元素 scrollIntoView 是空操作，必须先展开；
    //   3. 有些命中来自思考/工具参数，chat 视图本来就不把它当正文渲染；
    //   4. 点开另一个会话时，旧会话的 DOM 还挂在原地一会儿，这时扫到的全是上一个会话的文本；
    //   5. 后出现的消息会引用前面的话，纯文本命中很容易落在"引用那句的思考"里。
    // 所以顺序是：先等目标会话真的换上来 → 按"这条命中属于第几轮"直接找那一轮并展开 →
    // 再在该轮子树里找原文 → 都找不到才退回全页文本扫描（优先接受同轮的命中）→ 最后短片段兜底。
    const JUMP_BUDGET_MS = 40000
    const JUMP_POLL_MS = 150
    const JUMP_LOAD_WAIT_MS = 3500
    const JUMP_MAX_PAGES = 40
    const JUMP_READY_WAIT_MS = 12000
    const JUMP_SESSION_WAIT_MS = 12000
    const JUMP_STRONG_MIN = 14
    const JUMP_FLAT_MIN = 24
    const JUMP_MATCH_MIN = 8
    const TURN_CACHE = {}

    function stripWs(v) {
      return String(v == null ? '' : v).replace(/[\s\u3000\u00a0]+/g, '')
    }

    // 折成单空格（保留词边界），用于按"读起来的样子"比对；纯去空白的版本只用于长针兜底，
    // 因为去空白会把 "...the script then test it" 变成 "...thescriptthentestit"，太容易误中。
    function collapseWs(v) {
      return String(v == null ? '' : v).replace(/\s+/g, ' ').replace(/^ +| +$/g, '')
    }

    function trimEllipsis(v) {
      return String(v == null ? '' : v).replace(/^[…．.]+/u, '').replace(/[…．.]+$/u, '')
    }

    function needlesFor(hit) {
      const s = (hit && hit.snippet) || {}
      const m = collapseWs(trimEllipsis(s.match || ''))
      const full = collapseWs(trimEllipsis((s.pre || '') + (s.match || '') + (s.post || '')))
      const out = []
      const add = (v, tier, mode) => {
        if (!v || v.length < 2) return
        for (let i = 0; i < out.length; i += 1) if (out[i].v === v) return
        out.push({ v: v, tier: tier, mode: mode })
      }
      if (full.length >= JUMP_STRONG_MIN) add(full, 'strong', 'text')
      if (m.length >= JUMP_MATCH_MIN) add(m, 'strong', 'text')
      if (full.length >= JUMP_STRONG_MIN * 2) add(full.slice(0, 40), 'strong', 'text')
      const flat = stripWs(full)
      if (flat.length >= JUMP_FLAT_MIN) add(flat, 'strong', 'flat')
      if (m.length >= 2) add(m, 'weak', 'text')
      if (full.length >= 10) add(full.slice(-24), 'weak', 'text')
      const preTail = collapseWs(trimEllipsis(s.pre || ''))
      const postHead = collapseWs(trimEllipsis(s.post || ''))
      if (preTail.length >= 12) add(preTail.slice(-16), 'weak', 'text')
      if (postHead.length >= 12) add(postHead.slice(0, 16), 'weak', 'text')
      return out
    }

    function chatRoot() {
      return document.querySelector('[data-conversation-scroll]') ||
        document.querySelector('[data-conversation-region]') || null
    }

    // 当前真正挂着的会话（data-conversation-session="session-<uuid>"）
    function mountedSession() {
      const el = document.querySelector('[data-conversation-session]')
      return el === null ? null : el.getAttribute('data-conversation-session')
    }

    function floatToast(msg) {
      try {
        const el = document.createElement('div')
        el.className = 'hsr-toast-float'
        el.textContent = msg
        document.body.appendChild(el)
        window.setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el) }, 3200)
      } catch (e) {}
    }

    function sleep(ms) {
      return new Promise((resolve) => { window.setTimeout(resolve, ms) })
    }

    function dbg(msg, extra) {
      try {
        const log = (window.__hsrDebug = window.__hsrDebug || [])
        log.push({ at: Date.now(), msg: msg, extra: extra === undefined ? null : extra })
        if (log.length > 200) log.splice(0, log.length - 200)
      } catch (e) {}
    }

    // Walk rendered text and climb to the chat row that owns the matched text node.
    function findAnchor(root, needles) {
      if (root === null || !root.isConnected) return null
      const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
      let node = walker.nextNode()
      while (node !== null) {
        const collapsed = collapseWs(node.nodeValue)
        if (collapsed.length >= 6) {
          let flat = null
          for (let i = 0; i < needles.length; i += 1) {
            const n = needles[i]
            const hay = n.mode === 'flat' ? (flat === null ? (flat = stripWs(node.nodeValue)) : flat) : collapsed
            if (hay.indexOf(n.v) !== -1) {
              let el = node.parentElement
              let depth = 0
              let loose = null
              while (el != null && depth < 14) {
                if (el.hasAttribute('data-chat-flow-key') || el.hasAttribute('data-chat-node-key')) return el
                if (loose === null && el.hasAttribute('data-slot') && el.getAttribute('data-slot') === 'conversation.chat.node') loose = el
                el = el.parentElement || null
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

    // The chat view pages older history in; this is that control (class or label based).
    function olderButton(root) {
      if (root === null) return null
      const scope = root.querySelector('[class*="_older"]')
      if (scope !== null) {
        const btn = scope.querySelector('button')
        if (btn !== null && !btn.disabled) return btn
        return null
      }
      const buttons = root.querySelectorAll('button')
      for (let i = 0; i < buttons.length; i += 1) {
        const label = stripWs(buttons[i].textContent || '')
        if (!buttons[i].disabled && (label === '加载更早' || label === 'Load earlier' || label === '加载更多')) return buttons[i]
      }
      return null
    }

    function mountedSize(root) {
      return String(root.querySelectorAll('[data-chat-flow-key]').length) + ':' + String((root.textContent || '').length)
    }

    // Click "load earlier" and wait until the mounted transcript actually grew.
    async function pageOlder(root, btn) {
      const before = mountedSize(root)
      try { btn.click() } catch (e) {}
      const deadline = Date.now() + JUMP_LOAD_WAIT_MS
      while (Date.now() < deadline) {
        await sleep(JUMP_POLL_MS)
        const now = chatRoot()
        if (now === null) return false
        if (mountedSize(now) !== before) {
          await sleep(120)
          return true
        }
      }
      return false
    }

    function land(el) {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }) } catch (e) {}
      // the chat re-aligns its own tail after a page settles; assert the landing twice
      window.setTimeout(() => { try { el.scrollIntoView({ block: 'center', inline: 'nearest' }) } catch (e) {} }, 260)
      try {
        el.classList.remove('hsr-land')
        void el.offsetWidth
        el.classList.add('hsr-land')
        window.setTimeout(() => { try { el.classList.remove('hsr-land') } catch (e) {} }, 4200)
      } catch (e) {}
    }

    // 命中所在的轮次：第几条真人输入（1 起）。用会话记录里 role=user 的顺序推算。
    function turnIndexFor(records, seq) {
      if (!records || seq == null) return 0
      let n = 0
      for (let i = 0; i < records.length; i += 1) {
        if (records[i].role === 'user' && records[i].seq <= seq) n += 1
      }
      return n
    }

    function sessionRecords(sessionId) {
      if (!sessionId) return Promise.resolve(null)
      if (TURN_CACHE[sessionId] !== undefined) return Promise.resolve(TURN_CACHE[sessionId])
      return fetch(API + '/session?id=' + encodeURIComponent(sessionId) + '&limit=4000&any=1')
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          const recs = (body && body.records) || null
          TURN_CACHE[sessionId] = recs
          return recs
        })
        .catch(() => {
          TURN_CACHE[sessionId] = null
          return null
        })
    }

    function turnRows(root, idx) {
      if (root === null || idx === null || Number(idx) <= 0) return []
      return Array.from(root.querySelectorAll('[data-chat-turn="' + String(idx) + '"]'))
    }

    function findTurnRow(root, idx) {
      const rows = turnRows(root, idx)
      if (rows.length === 0) return null
      for (let i = 0; i < rows.length; i += 1) {
        if (rows[i].getAttribute('data-chat-flow-kind') === 'user') return rows[i]
      }
      return rows[0]
    }

    // 展开某一轮被折叠起来的正文（"已完成，用时…" 那一行里的开关）
    function expandTurn(row) {
      const turn = row === null ? null : row.getAttribute('data-chat-turn')
      const root = chatRoot()
      if (root === null || turn == null) return false
      let expanded = false
      const rows = turnRows(root, turn)
      for (let i = 0; i < rows.length; i += 1) {
        if (rows[i].getAttribute('data-chat-flow-kind') !== 'turn-process') continue
        const btn = rows[i].querySelector('button')
        if (btn !== null && btn.getAttribute('aria-expanded') === 'false') {
          try { btn.click(); expanded = true } catch (e) {}
        }
      }
      return expanded
    }

    // 元素所在的那一轮（向上找 data-chat-turn）
    function turnOf(el) {
      let e = el
      let depth = 0
      while (e != null && depth < 16) {
        if (typeof e.getAttribute === 'function' && e.getAttribute('data-chat-turn') != null) return e.getAttribute('data-chat-turn')
        e = e.parentElement || null
        depth += 1
      }
      return null
    }

    // 在某一轮的所有行里找针（先强后弱）
    function findInTurn(root, idx, needles) {
      const rows = turnRows(root, idx)
      for (let i = 0; i < rows.length; i += 1) {
        const el = findAnchor(rows[i], needles)
        if (el !== null) return el
      }
      return null
    }

    // Find the message that matched a hit inside the reading view and put it in front of
    // the reader. Resolves to 'strong' (the matched passage itself), 'weak' (only a short
    // fragment matched), 'turn' (landed on the containing turn) or false.
    async function revealHit(hit, turnIdx, sessionId, ownerText) {
      const needles = needlesFor(hit)
      dbg('reveal:start', { needles: needles.map((n) => n.tier + '/' + n.mode + ':' + n.v.slice(0, 24)), turnIdx: turnIdx })
      if (needles.length === 0) return false
      const strong = []
      const weak = []
      for (let i = 0; i < needles.length; i += 1) {
        if (needles[i].tier === 'strong') strong.push(needles[i])
        else weak.push(needles[i])
      }
      const t0 = Date.now()
      let clicks = 0

      // 0a) 先等目标会话真的换上来（否则扫到的是上一个会话的文本，会误以为命中）
      const want = sessionId ? (String(sessionId).indexOf('session-') === 0 ? String(sessionId) : 'session-' + String(sessionId)) : null
      if (want !== null) {
        while (Date.now() - t0 < JUMP_SESSION_WAIT_MS) {
          if (mountedSession() === want) break
          await sleep(JUMP_POLL_MS)
        }
        if (mountedSession() !== want) dbg('reveal:session-timeout', { want: want, got: mountedSession() })
      }

      // 0b) 等视图把消息挂出来（刚点开会话时这里是空的）
      while (Date.now() - t0 < JUMP_SESSION_WAIT_MS + JUMP_READY_WAIT_MS) {
        const r = chatRoot()
        if (r !== null && r.querySelectorAll('[data-chat-flow-key]').length > 0) break
        await sleep(JUMP_POLL_MS)
      }

      // 1) 最可靠的锚：这一轮的真人输入原文。data-chat-turn 的编号只是"当前已加载窗口内"的序号，
      //    和会话里的第几条人话并不一定对齐，所以先用提问原文把那一轮找出来。
      let ownerRow = null
      const ownerNeedle = ownerText ? collapseWs(ownerText).slice(0, 40) : ''
      if (ownerNeedle.length >= 8) {
        for (let tries = 0; tries < 80; tries += 1) {
          if (Date.now() - t0 > JUMP_BUDGET_MS) break
          const root = chatRoot()
          if (root === null) { await sleep(JUMP_POLL_MS); continue }
          const found = findAnchor(root, [{ v: ownerNeedle, tier: 'strong', mode: 'text' }])
          if (found !== null) {
            ownerRow = found
            const ownerTurn = turnOf(found)
            land(found)
            if (ownerTurn !== null) expandTurn(findTurnRow(root, ownerTurn))
            await sleep(340)
            const exact = strong.length > 0 ? findInTurn(chatRoot(), ownerTurn, strong) : null
            if (exact !== null) { land(exact); dbg('reveal:owner-strong', { turn: ownerTurn }); return 'strong' }
            const loose = weak.length > 0 ? findInTurn(chatRoot(), ownerTurn, weak) : null
            if (loose !== null) { land(loose); dbg('reveal:owner-weak', { turn: ownerTurn }); return 'weak' }
            dbg('reveal:owner-turn', { turn: ownerTurn })
            return 'turn'
          }
          const btn = olderButton(root)
          if (btn !== null && clicks < JUMP_MAX_PAGES) {
            clicks += 1
            dbg('reveal:page-for-owner', { clicks: clicks })
            await pageOlder(root, btn)
            continue
          }
          dbg('reveal:owner-missing', null)
          break
        }
      }

      // 2) 知道轮次就按轮次走：更早的轮次要点「加载更早」翻出来，折叠的要展开
      let turnMissed = false
      if (turnIdx > 0) {
        for (let tries = 0; tries < 80; tries += 1) {
          if (Date.now() - t0 > JUMP_BUDGET_MS) break
          const root = chatRoot()
          if (root === null) { await sleep(JUMP_POLL_MS); continue }
          const row = findTurnRow(root, turnIdx)
          if (row !== null) {
            const wasFolded = row.getAttribute('data-turn-process-hidden') === 'true'
            land(row)
            expandTurn(row)
            await sleep(340)
            const exact = strong.length > 0 ? findInTurn(chatRoot(), turnIdx, strong) : null
            if (exact !== null) { land(exact); dbg('reveal:turn-strong', { turnIdx: turnIdx }); return 'strong' }
            const loose = weak.length > 0 ? findInTurn(chatRoot(), turnIdx, weak) : null
            if (loose !== null) { land(loose); dbg('reveal:turn-weak', { turnIdx: turnIdx }); return 'weak' }
            if (wasFolded) land(findTurnRow(chatRoot(), turnIdx))
            dbg('reveal:turn-accept', { turnIdx: turnIdx })
            return 'turn'
          }
          const btn = olderButton(root)
          if (btn !== null && clicks < JUMP_MAX_PAGES) {
            clicks += 1
            dbg('reveal:page-for-turn', { clicks: clicks, turnIdx: turnIdx })
            await pageOlder(root, btn)
            continue
          }
          turnMissed = true
          dbg('reveal:turn-missing', { turnIdx: turnIdx })
          break
        }
        if (turnMissed === false) return 'turn'
      }

      // 3) 全页文本扫描：优先接受"同一条命中那一轮"的匹配，别的轮次里的引用只当候选
      let fallbackEl = null
      for (let tries = 0; tries < 80; tries += 1) {
        if (Date.now() - t0 > JUMP_BUDGET_MS) break
        const root = chatRoot()
        if (root === null) break
        const size = mountedSize(root)
        dbg('reveal:scan', { size: size, clicks: clicks, strong: strong.length, session: mountedSession() })
        const hitEl = strong.length > 0 ? findAnchor(root, strong) : null
        if (hitEl !== null) {
          const turn = turnOf(hitEl)
          const folded = hitEl.getAttribute('data-turn-process-hidden') === 'true' || (hitEl.parentElement !== null && hitEl.closest !== undefined && false)
          if (turn === null || turnIdx <= 0 || String(turn) === String(turnIdx)) {
            if (folded) { expandTurn(findTurnRow(root, turn)); await sleep(320); land(findTurnRow(chatRoot(), turn)) }
            land(hitEl)
            dbg('reveal:strong-accept', { size: size, turn: turn })
            return 'strong'
          }
          if (fallbackEl === null) fallbackEl = hitEl
          dbg('reveal:skip-other-turn', { turn: turn, want: turnIdx })
        }
        const btn = olderButton(root)
        if (btn !== null && clicks < JUMP_MAX_PAGES) {
          clicks += 1
          dbg('reveal:page', { clicks: clicks })
          await pageOlder(root, btn)
          continue
        }
        break
      }

      if (fallbackEl !== null && turnIdx <= 0) {
        land(fallbackEl)
        dbg('reveal:other-turn-accept', null)
        return 'weak'
      }

      // 3b) 最后兜底：短片段
      const root = chatRoot()
      if (root !== null && weak.length > 0 && turnIdx <= 0) {
        const looseEl = findAnchor(root, weak)
        if (looseEl !== null) {
          dbg('reveal:weak-accept', null)
          land(looseEl)
          return 'weak'
        }
      }
      // 4) 连滚动窗口都到不了：把读者带到最早能看的位置，并如实说明
      const firstRoot = chatRoot()
      const firstRows = firstRoot === null ? [] : firstRoot.querySelectorAll('[data-chat-flow-key]')
      if (firstRows.length > 0) {
        dbg('reveal:top-accept', { turnIdx: turnIdx })
        land(firstRows[0])
        return 'top'
      }
      dbg('reveal:fail', { turnIdx: turnIdx })
      return false
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
          const go = (idx, owner) => revealHit(hit, idx, sessionId, owner).then((mode) => {
            if (mode === 'strong') floatToast('已跳到命中位置')
            else if (mode === 'weak') floatToast('已跳到最接近的位置：只匹配到片段，原文这段可能还在没加载的分页里')
            else if (mode === 'turn') floatToast('已跳到命中所在的那一轮（这段文字在该轮里被折叠，已展开）')
            else if (mode === 'top') floatToast('这段在阅读视图能加载的范围之外（更早的轮次已经被压缩掉了），已把你带到最早能看的位置')
            else floatToast('已打开会话，但没能在页面里定位到这段（它可能在更早的分页或思考/工具里）')
          })
          if (hit.seq === undefined || hit.seq === null) { go(0, null); return }
          sessionRecords(sessionId).then((recs) => {
            let owner = null
            if (recs) {
              for (let i = recs.length - 1; i >= 0; i -= 1) {
                if (recs[i].role === 'user' && recs[i].seq <= hit.seq) { owner = recs[i].text || null; break }
              }
            }
            go(turnIndexFor(recs, hit.seq), owner)
          }, () => { go(0, null) })
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
      __hsr: { needlesFor, findAnchor, revealHit, turnIndexFor, findTurnRow, expandTurn },
    }
  },
})
