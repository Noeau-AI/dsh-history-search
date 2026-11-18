# dsh-history-search · 全历史全文搜索

给 DSH（DeepSeek Harness）加一个**跨全部工作区、跨全部历史会话的全文搜索**。

官方侧栏那个放大镜只做两件事：按**会话标题**本地过滤，以及调宿主 `sessions.search` 查**当前工作区可见会话**的正文。它有两个硬伤：

1. 标题匹配之外，正文命中只覆盖「当前工作区 + 列表里可见」的会话，别的 workspace 的老对话搜不到；
2. 官方走 SQLite FTS5，`quoteFtsData()` 把整条查询当**一个 phrase** 引起来，unicode61 又不切分中文 —— 中文必须**整段连续**命中。搜「历史聊天」命中 0 条，「加速」只有 9 条。

这个插件绕开 FTS5：**直接解压 `~/.dsh/sessions` 下的 `session.v4.jsonl.zstd`** 原文件，用子串/正则匹配正文。中文不用分词，输入任意片段都能命中；覆盖全部工作区、全部会话，包括早就归档、侧栏列表里看不见的那些。

## 装了什么

| 半边 | 文件 | 作用 |
| --- | --- | --- |
| Host | `lib/index.js` | `inject: ['webServer']`，注册前缀路由 `/dsh-history-search`；遍历 `sessions/**/session.v4.jsonl.zstd`，按魔数 `0xfd2fb528` 判断 zstd 并 `zlib.zstdDecompressSync` 解压；按 mtime+size 做内存 LRU（上限 260 个会话） |
| Client | `lib/client.js` | 零构建手写 `window.__ModuleLoader__.load(...)`；往 `sidebar.panellist` 注册「历史搜索」图标入口（order 3），往 `main` 注册整页面板；跟随深浅色主题 |

面板功能：260ms 防抖输入框、角色筛选（全部发言 / 只看我的输入 / 只看助手回复）、区分大小写、正则、含工具输出、含系统注入、按会话分组的结果（命中片段高亮）、点标题或点命中行打开对应会话、页脚显示归档体积与缓存数。

## 0.1.6 只有打包与校验的变化

0.1.6 不改插件行为。它把两样东西装进了包里：

- `market/entry.yml` —— 提交给 awesome-dsh-plugin 目录的那份条目本身，跟着代码一起版本化，避免"仓库里 v0.1.5、目录里却写着别的版本"这种漂移。
- `tools/validate-entry.mjs` —— 本地校验条目形态（0.1.5 那版条目被写成 YAML 序列，CI 报 `unknown field "0"`，肉眼很难看出来）。
- 两处 README 恢复了与包内一致的状态（0.1.5 的 Release 资产是在这两节写进仓库之前打的）。

## 提交市场条目前先本地校验

目录的解析器很严，报错又很含糊：把条目写成 YAML 序列（`- url: ...`）而不是映射（`url: ...`），CI 会在 `READMEs match data/plugins` 这一步失败，只给你 `unknown field "0"` 和 `"url" must be a https://github.com/owner/repo link` 两句。本插件第一次投稿踩的就是这个。

`market/entry.yml` 是保存在本仓库里的目录条目，`node tools/validate-entry.mjs` 按目录规则检查它（映射形态、字段白名单、`owner/repo` 形式的 url、合法分类、以句号结尾的英文描述、GitHub 托管的位图图标、钉了 tag 的 Release tarball）。有形态错误时一秒内非零退出。

```
node tools/validate-entry.mjs            # 默认读 market/entry.yml
```

## 发布在哪

| 渠道 | 地址 |
| --- | --- |
| 源码仓库 | <https://github.com/Noeau-AI/dsh-history-search> |
| Release tarball | <https://github.com/Noeau-AI/dsh-history-search/releases/tag/v0.1.6>（`dsh-history-search-0.1.6.tgz`，360 183 bytes，sha256 `468e078ca6578378314413a10f4898966aa325e59ada45b0ccc2e0038cbd63f5`） |
| dsh 插件市场（awesome-dsh-plugin.com） | 目录投稿 `data/plugins/Noeau-AI__dsh-history-search.yml` → PR [#16364](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/16364)；合并并重建站点后即可在市场页搜到 |
| npm | 未发布 —— 配好 npm token 后在本目录 `npm publish` 即可（`dsh-history-search` 这个包名还空着） |

## 安装

### 方式一：从 GitHub 装（推荐）

```powershell
dsh plugin --profile web add github:Noeau-AI/dsh-history-search
```

或从 GitHub Release 的预打包 tarball 装（免 `allowBuilds` 构建授权）：

```powershell
dsh plugin --profile web add "https://github.com/Noeau-AI/dsh-history-search/releases/download/v0.1.2/dsh-history-search-0.1.2.tgz"
```

装完**完全退出并重新启动 DeepSeek Harness** —— 插件在宿主启动时加载，运行中的实例不会热加载。启动后侧栏会多出一个放大镜图标「历史搜索」。

### 方式二：源码目录就地接线（开发/自用）

```powershell
cd <本仓库目录>
node tools\install.mjs            # 建 Junction + 往 profile cordis.patch.yml 追加 insert 条目
node tools\install.mjs --check    # 只检查接线状态
node tools\install.mjs --uninstall
```

`install.mjs` 做的事：

1. 在 `%DSH_HOME%\profiles\<profile>\node_modules\dsh-history-search` 建 **Junction** 指向本源目录（Junction 不需要额外权限；早期若是 `@local\dsh-history-search` 的旧接线，会顺手清掉，避免同一插件被加载两次）；
2. 在 `%DSH_HOME%\profiles\<profile>\cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: history-search
      name: 'dsh-history-search'
```

改动前都会把 patch 备份到 `%TEMP%\dsh-history-search-backup\`，写入走临时文件 + rename 的原子替换，重复执行幂等。

## HTTP 接口（自己调试用）

```
GET /dsh-history-search/api/search?q=&role=&cs=&regex=&tools=&any=&ws=&from=&to=&limit=&per
GET /dsh-history-search/api/session?id=&from=&limit=&any=&role=
GET /dsh-history-search/api/stats
GET /dsh-history-search/api/health
GET /dsh-history-search/api/selfcheck
GET /dsh-history-search/api/reset
```

- `q` 必填，否则 400 `缺少 q 参数`
- `role`：`all`(默认，user+assistant) / `user` / `assistant`；`tools=1` 放开工具输出，`any=1` 放开全部注入上下文（runtime-context / skill-catalog / time-context 那些）
- `cs=1` 区分大小写；`regex=1` 走正则（非法正则返回 400 `正则不合法：…`）
- `ws` 过滤工作区 slug，`from`/`to` 按 mtime 过滤（epoch ms）
- `per` 每会话最多命中条数（1–20，默认 3）；`limit` 最多返回会话数（1–200，默认 30）

`/api/selfcheck` 是「这台机器上到底通不通」的现场体检：现解一遍最大的归档，回 `node`（宿主运行时版本）、`frames`、`broken`、`decodedBytes`、`events`、`wholeFileBytes`（整段一次解能解出多少）和一句 `verdict`。侧栏面板页脚那个「自检」按钮打的就是它（`ok:true` + 「7455 帧全解出来了」才算链路真通）。

`/api/session` 读单个会话的正文（内联搜索结果点「原文」用的就是它）：`id` 必填（会话 UUID，`/api/search` 返回的 `sessionId`），缺省 400 `缺少 id 参数`、找不到 404 `找不到该会话：…`；`from` 默认 0、`limit` 默认 400（上限 4000）；**默认只回对话正文**（我的输入 + 助手回复），`any=1` 才回系统注入/工具输出，`role=user|assistant|tool|system|context` 可精确指定。

```json
{ "ok": true, "id": "session-…", "path": "C:\\Users\\…\\session.v4.jsonl.zstd",
  "workspaceSlug": "--D-AIBOX--", "meta": { "title": "…", "cwd": "D:\\AIBOX", "createdAt": 179… },
  "total": 178, "eventTotal": 441, "role": "conversation", "from": 0, "limit": 400,
  "records": [ { "seq": 1, "time": 179…, "role": "user", "sourceKind": "user", "text": "如何查找历史聊天记录…" } ] }
```

响应：

```json
{ "ok": true, "tookMs": 49, "totalSessions": 32, "returnedSessions": 32, "hitTotal": 66,
  "sessions": [ { "sessionId": "…", "title": "…", "cwd": "D:\\AIBOX", "workspaceSlug": "--D-AIBOX--",
                  "mtime": 1794928709803, "hitCount": 1, "truncated": false, "titleHit": false,
                  "hits": [ { "seq": 12, "time": 1794…, "role": "user",
                              "snippet": { "pre": "…", "match": "调度台", "post": "…" } } ] } ] }
```

## 实测（本机 123 个会话 / 52.7 MB 归档）

| 查询 | 结果 |
| --- | --- |
| `stats` | 123 个归档 / 52.7 MB / 14127 条对话记录；冷启 2.4s，缓存后不再解压 |
| `调度台` | 33 个会话 / 67 条命中（热启 32–40ms） |
| `天财` | 23 个会话 / 52 条命中 |
| `历史聊天` | 1 个会话 3 条命中（正是「工作区搜索只能找对话名」那句） |
| `role=user` + `调度台` | 27 个会话 / 27 条命中 |
| 非法正则 `([a-` | 400，报错文本回显 |

冷启代价来自一次性解压 52.7MB zstd（约 13–16 万次帧解压）；解压与解析结果缓存进内存，同一进程内后续查询都在 50ms 级。`api/reset` 清缓存。

## 多帧 zstd：桌面端为什么必须自己走帧边界

会话归档不是「一个大 zstd 帧」，而是**每个事件批次一帧**（单个大归档有 2000–7000 帧）。这里有个会让人以为插件是假的坑：

```text
标准 Node 24.22.1   : zlib.zstdDecompressSync(整个文件) → 46479909 字节，全部事件 ✓
桌面端 Electron 24.21: zlib.zstdDecompressSync(整个文件) → 189 字节，只有第一帧 ✗
```

桌面端宿主进程跑的是 **Electron 自带的 Node 24.21.0**（`process.versions.node`），它的 `zstdDecompressSync` 对多帧输入只返回第一帧。于是早期版本表现为：插件装上了、接口 200、`/api/stats` 里 `records: 0`、不管输入什么都搜不到。

修复：`lib/zstd-frames.js` 按 RFC 8878 自己走帧边界（magic `0xfd2fb528`、skippable `0x184d2a50`、FHD 里 FCS 只在 single-segment 时才是 1 字节、3 字节块头 `last/type/size`），逐帧调 `zstdDecompressSync` 再拼接；截断的尾巴只解到断点为止并计入 `broken`。`/api/health` 会回 `node`（运行时版本）、`zstdFrames`、`zstdBroken`，看一眼就知道当前跑的是哪套代码。

同一份代码在两个运行时下结果必须一致，这是回归测试 `test\frames-test.mjs` 钉住的：取最大的 3 个归档，断言帧数 > 1、行都是合法 JSON、首行是 `session` 事件；在能整段解的运行时里还要求逐帧结果与整段结果**逐字节一致**（实测 46479909 / 15550788 / 11224115 三份完全相同），在只解第一帧的运行时里则断言逐帧内容远多于整段（`189 → 46479909`）。

想复现运行时差异，用桌面端自己的二进制当 node 跑：

```powershell
$env:ELECTRON_RUN_AS_NODE="1"
& "<安装目录>\DeepSeek Harness.exe" test\frames-test.mjs
Remove-Item Env:\ELECTRON_RUN_AS_NODE
```

## 离线自测（不需要改宿主、不需要重启）

```powershell
node test\frames-test.mjs       # 多帧 zstd 解码回归（取最大 3 个归档，双运行时都必须过）
node test\host-test.mjs         # 假 ctx + mock req/res，直喂 handler：health/stats/search/session/400-404 分支
node test\client-smoke.mjs      # 最小 React 桩跑 factory + Panel 渲染树，校验槽位注册与 DOM 结构
node test\injected-render.mjs   # 从打补丁后的工作区 client.js 抽出注入块，八种状态 + 原文阅读器全渲染一遍
```

## 工作区放大镜里也加一段「全历史」

侧栏图标是独立面板；如果你更想就在**工作区那个放大镜搜索框里**直接看到跨工作区命中，再打一个补丁（它改的是官方 bundle 里的 `dsh-client-ui-workspace\lib\client.js`）：

```powershell
cd <本仓库目录>
node tools\patch-workspace-search.mjs            # 打补丁（幂等，已打过就 no write）
node tools\patch-workspace-search.mjs --check    # 只看状态：component block / mount block 是否在
node tools\patch-workspace-search.mjs --revert   # 剥回官方原样（字节级还原）
```

注入的内容：`SearchResults` 返回的 children 末尾追加一个 `HistoryHits` 组件 —— 在原有「标题匹配 + 当前工作区命中」结果下面，多一段「**全历史 · 跨全部工作区 · N 会话 · M 段命中**」。每行右边有「原文」，点它就在搜索框内展开该会话正文（走 `/api/session`），不用切走；点整行则照旧打开会话，若那个会话跨工作区打不开（不在已加载列表里），自动回退成展开原文。

补丁细节：组件块用 `/* HSR:BEGIN */ … /* HSR:END */` 包住，挂载点用 `/* HSR:BEGIN-RENDER */ … /* HSR:END-RENDER */`；每次改动前备份到默认的 `%TEMP%\dsh-history-search-backup\`（可用 `HSR_BACKUP_DIR` 改），写入前先 `node --check`，不合法就不落盘。**这个补丁改的是官方文件**，`node tools\install.mjs --uninstall` 只管插件接线，剥补丁要用 `--revert`；应用升级把官方 bundle 覆盖后，重跑一次 `patch-workspace-search.mjs` 即可（若报锚点找不到，先 `--revert` 再重打）。

## 点击跳到命中位置（0.1.5）

0.1.5 只改看得见的部分：落点高亮从「描边框」换成 **3px 外框 + 外发光脉冲，亮 4.2 秒**（原来 2.4 秒、在暗色主题里几乎看不出来）。定位逻辑与 0.1.4 完全一致。

## 点击跳到命中位置（0.1.4）

点一条命中会打开会话，**并把命中的那段文字滚到眼前**，不是停在对话最底部。

落地顺序：

1. **先等目标会话真的换上来。** 打开新会话时旧会话的 DOM 还会挂在原地一会儿，所以要等 `[data-conversation-session]` 报出你点的那个会话（最多 12 秒）。没有这道门时，它会在"你正在看的那个会话"里找到长得一样的句子然后假装成功。
2. **用这一轮的提问原文当锚。** 从 `/api/session` 取该命中 `seq` 之前最近的一条 `user` 记录，拿那句话在 DOM 里找。`data-chat-turn` 的编号只是"当前已加载窗口内"的序号，跟会话里的第几条人话不一定对齐，所以提问原文更可靠。
3. **落点 → 展开 → 再精确。** 先把那一轮滚到屏幕中间；如果这一轮被折叠着（`data-turn-process-hidden`，思考/工具那一段），点开开关；然后在这一轮的子树里再找精确片段。
4. **需要时往前翻页。** 那一轮还没挂出来就点「加载更早」，等挂载指纹（`rows:textLength`）真的变了再扫。
5. **够不着就直说。** 比可加载窗口更早的内容（比如压缩检查点之前的）在阅读视图里根本渲染不出来，这时会把读者带到能看的最早位置，并如实说明。

针的比对是分空白敏感的：按折叠成单空格的文本比对（保住词边界），只有长度 ≥ 24 的针才允许去空白再试一次 —— 这样就不会再出现 `e the script then test it` 被折成 `ethescriptthentestit` 到处误中的情况。

提示语会区分四种结果：精确命中 / 只匹配到片段 / 落在命中所在的那一轮 / 这段在可加载窗口之外。

## 点击跳到命中位置（0.1.3）

以前点一条命中只会打开会话、停在很长的对话最底部。0.1.3 起会**落到命中那段文字上**：

1. 先用 `uiWorkspace.openSession` 正常打开会话；
2. 面板随即遍历对话正文的文本节点找这条命中的片段（优先最长候选、忽略空白，中文换行不影响命中）；
3. 这段文字还在更早的分页里没渲染出来时，面板会点对话自己的「加载更早」按钮再重试 —— 最多 60 页、20 秒；
4. 找到后把该行滚到视口中央、描边高亮 2.4 秒（`.hsr-land`），并弹 `已跳到命中位置`；
5. 始终找不到（太早或从未渲染）就如实提示，不会假装跳过去了。

对话包里的跳转能力（`loadThrough(seq)` + `scrollToTurn`）只从 conversation 槽位注入的 view 暴露，侧栏插件拿不到，所以这里改走 DOM：滚动容器 `[data-conversation-scroll]`，消息行 `data-chat-flow-key` / `data-chat-node-key`。`test/jump-test.mjs` 用假 DOM 钉住三条路径（首屏命中、翻两页后命中、始终不出现）。

## 列表滚动（0.1.2）

面板整体是「顶部工具栏 + 可滚动结果区 + 底部页脚」的纵向 flex：`.hsr-root` 撑满主列并 `overflow:hidden`，`.hsr-scroll` 拿走剩余高度，`.hsr-body` 是唯一滚动容器（`overflow-y:auto` + `overscroll-behavior:contain`，`max-height:calc(100vh - 240px)` 兜底）。

要这么写是因为官方主列 `CenterColumn`（`dsh-client-ui-layout\lib\client.js` 的 `.mP3x-q_centerCol`）本身是 `display:flex;flex-direction:column;overflow:hidden`——面板若用 `min-height:100%` 撑高，超出的部分会被它直接裁掉，表现就是「没有滚动条、滚轮也不动」。

右侧那条竖滚动条是**自绘的**（`.hsr-sb` + `.hsr-sb-thumb`），不依赖系统滚动条：Chromium 在 Windows 上默认用 overlay 滚动条，`::-webkit-scrollbar{width:11px}` 不会占位也不常显，所以自己画一条 11px 的轨道 + 滑块，滚轮/拖动/点轨道都能滚，滑块位置按 `clientHeight/scrollHeight` 与 `scrollTop` 实时同步。换了关键词会先回到顶部再重算滑块。
## 排查

| 现象 | 处理 |
| --- | --- |
| 侧栏没多出图标 | `node tools\install.mjs --check` 看 Junction / patch 条目；确认已**完全重启**桌面端 |
| 面板能开但一直显示「检索失败」 | 看 `node tools\install.mjs --check` 是否报未注册；宿主日志里搜 `dsh-history-search` |
| 搜不到刚说的话 | 当前会话还在内存里，只有落盘之后才会进归档；等这轮结束或换会话再搜 |
| 中文搜不到 | 本插件是子串匹配，整段输入即可；如果勾了「正则」，`(` `[` 之类要转义 |
| 应用升级后失效 | 官方 bundle 会被覆盖（Junction 与 patch 条目通常保留）；重跑 `node tools\install.mjs` 即可 |
| 放大镜里没有「全历史」那一段 | `node tools\patch-workspace-search.mjs --check`；不在就 `node tools\patch-workspace-search.mjs` 重打 |
| 面板有命中但内联段一直是 0 | 宿主里加载的还是旧版插件代码（插件改了但没重启），重启桌面端即恢复 |
| 装好了却「搜什么都 0 命中」 | 先看 `/dsh-history-search/api/health`：没有 `node`/`zstdFrames` 字段 = 宿主还跑着旧代码（重启）；`records` 是 0 而 `files` 正常 = 解压只拿到第一帧，跑 `node test\frames-test.mjs` 定位 |

## 相关

- 插件市场：<https://awesome-dsh-plugin.com/p/Noeau-AI/dsh-history-search/>
- 命令行版（不开 UI 直接搜）：本仓库 `tools\` 之外还有一份独立脚本 [dsh-history-search.mjs](https://github.com/Noeau-AI/dsh-history-search/tree/main/tools) 风格的实现，`--list` / `--dump` / `--json` / `--role` / `--regex` 都支持
- 会话归档格式：`~/.dsh/sessions/<workspace-slug>/<session-id>/session.v4.jsonl.zstd`，首行 `session` 事件带 `id/cwd/createdAt`，标题在 `session/title` → `data.title`
