// zstd 多帧解码：DSH 的 session.v4.jsonl.zstd 是「按批追加」的多帧归档（一个文件上千帧）。
// Node 24.22 的 zlib.zstdDecompressSync 能把整段多帧一次解完，但桌面端运行时（Electron 的 Node 24.21）
// 只解第一帧 —— 1.8MB 的归档只回 244 字节。所以这里自己走帧边界，逐帧解压再拼起来。
import zlib from 'node:zlib'

const FRAME_MAGIC = 0xfd2fb528
const SKIP_MAGIC = 0x184d2a50
const SKIP_MASK = 0xfffffff0

/** 从 start 起算这一帧的结束偏移（严格按 RFC 8878 的帧头 + 块头走）。 */
function frameEnd(buf, start) {
  let p = start + 4
  if (p >= buf.length) throw new Error('帧头截断')
  const fhd = buf[p]
  p += 1
  const fcsFlag = fhd >> 6
  const singleSegment = (fhd >> 5) & 1
  const checksum = (fhd >> 2) & 1
  const dictFlag = fhd & 3
  if (!singleSegment) p += 1 // Window_Descriptor
  if (dictFlag === 1) p += 1
  else if (dictFlag === 2) p += 2
  else if (dictFlag === 3) p += 4
  if (fcsFlag === 0) { if (singleSegment) p += 1 } // 只有 single-segment 才带 1 字节 FCS
  else if (fcsFlag === 1) p += 2
  else if (fcsFlag === 2) p += 4
  else p += 8
  if (p > buf.length) throw new Error('帧头越界')
  // 块序列
  for (;;) {
    if (p + 3 > buf.length) throw new Error('块头截断')
    const header = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16)
    p += 3
    const last = header & 1
    const type = (header >> 1) & 3
    const size = header >> 3
    if (type === 0) p += size // Raw_Block
    else if (type === 1) p += 1 // RLE_Block
    else if (type === 2) p += size // Compressed_Block
    else throw new Error('保留块类型')
    if (p > buf.length) throw new Error('块越界')
    if (last) break
  }
  if (checksum) p += 4
  if (p > buf.length) throw new Error('校验和截断')
  return p
}

/**
 * 把多帧 zstd 缓冲解成文本。截断的文件（进程崩溃留下的半截帧）只解到断点为止，
 * 而不是整份丢掉 —— 半份历史比 0 条强。
 * @param {Buffer} raw
 * @param {{frames?: number}} [info] 可选统计出口
 * @returns {string}
 */
export function decodeZstd(raw, info) {
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('当前 Node 无 zlib.zstdDecompressSync（需要 Node ≥ 22.15 / 23.8）')
  }
  const chunks = []
  let frames = 0
  let broken = 0
  let off = 0
  const n = raw.length
  while (off + 4 <= n) {
    const magic = raw.readUInt32LE(off)
    if (magic === FRAME_MAGIC) {
      let end
      try {
        end = frameEnd(raw, off)
      } catch {
        broken += 1
        break // 帧边界坏了，剩下不解
      }
      try {
        chunks.push(zlib.zstdDecompressSync(raw.subarray(off, end)))
        frames += 1
      } catch {
        broken += 1
        break
      }
      off = end
      continue
    }
    if ((magic & SKIP_MASK) === SKIP_MAGIC) {
      const size = raw.readUInt32LE(off + 4)
      off += 8 + size
      if (off > n) {
        broken += 1
        break
      }
      continue
    }
    broken += 1 // 非 zstd 尾块（对不齐就别猜）
    break
  }
  if (info) {
    info.frames = frames
    info.broken = broken
  }
  if (frames === 0) {
    // 退路：整段单帧解（标准 Node 上可用，桌面端只能拿到第一帧，但也比空白强）
    return zlib.zstdDecompressSync(raw).toString('utf8')
  }
  return Buffer.concat(chunks).toString('utf8')
}
