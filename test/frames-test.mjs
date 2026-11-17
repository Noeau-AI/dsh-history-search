// 多帧 zstd 解码回归：桌面端运行时（Electron 的 Node 24.21）整段解只回第一帧，
// 这是「插件能装、接口能开、但一条都搜不到」的根因。这里把两件事钉死：
//   1) 逐帧解码必须把每一帧都解出来（frames > 1，且文本行数远大于第一帧）；
//   2) 在能整段解的运行时（标准 Node 24.22）里，逐帧结果必须与整段结果逐字节一致。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import zlib from 'node:zlib'
import { decodeZstd } from '../lib/zstd-frames.js'

const ROOT = process.env.DSH_HISTORY_SESSIONS || join(process.env.DSH_HOME || join(process.env.USERPROFILE || '.', '.dsh'), 'sessions')

function collect(dir, out) {
  for (const ws of readdirSync(dir, { withFileTypes: true })) {
    if (!ws.isDirectory()) continue
    const wsDir = join(dir, ws.name)
    for (const ent of readdirSync(wsDir, { withFileTypes: true })) {
      if (ent.isFile()) continue
      for (const f of readdirSync(join(wsDir, ent.name), { withFileTypes: true })) {
        if (/\.jsonl\.zst(d)?$/i.test(f.name)) out.push(join(wsDir, ent.name, f.name))
      }
    }
  }
}

const files = []
collect(ROOT, files)
const samples = files
  .slice()
  .sort((a, b) => statSync(b).size - statSync(a).size)
  .slice(0, 3)

console.log('node', process.versions.node, '| 归档', files.length, '个 | 取样', samples.length, '个')
const failures = []
function check(name, ok, detail) {
  console.log((ok ? '  ✔ ' : '  ✘ ') + name + (detail ? ' :: ' + detail : ''))
  if (!ok) failures.push(name)
}

for (const path of samples) {
  const raw = readFileSync(path)
  const info = {}
  const text = decodeZstd(raw, info)
  const lines = text.split('\n')
  let jsonLines = 0
  for (const line of lines) { if (line.length < 2) continue; try { JSON.parse(line); jsonLines += 1 } catch {} }
  const label = path.split('\\').slice(-3).join('/')
  check(label + ' 帧数 > 1', (info.frames || 0) > 1, 'frames=' + info.frames + ' broken=' + info.broken)
  check(label + ' 有 JSON 事件行', jsonLines > 0, 'lines=' + lines.length + ' json=' + jsonLines)
  check(label + ' 第一行是 session 事件', text.startsWith('{"type":"session"'), text.slice(0, 40))

  let whole = null
  try { whole = zlib.zstdDecompressSync(raw).toString('utf8') } catch {}
  if (whole && whole.length >= text.length) {
    check(label + ' 与整段解码一致', whole === text, whole.length + ' vs ' + text.length)
  } else if (whole) {
    // 只解出第一帧的运行时：说明逐帧版确实补回了内容
    check(label + ' 逐帧解出的内容多于第一帧', text.length > whole.length, whole.length + ' → ' + text.length)
  }
}

console.log('\n结果：' + (failures.length === 0 ? '全部通过' : failures.length + ' 项失败'))
if (failures.length) process.exit(1)
