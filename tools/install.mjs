#!/usr/bin/env node
// 安装 / 卸载 / 校验 dsh-history-search
//
//   node tools/install.mjs              安装：profile node_modules 建 Junction + profile cordis.patch.yml 追加 insert 条目
//   node tools/install.mjs --uninstall  卸载：删 Junction + 从 patch 里移除对应 insert 条目（改前自动备份）
//   node tools/install.mjs --check      只检查当前接线状态，不改任何文件
//
// 全部操作幂等；任何一步失败都以非零码退出，并且不留下半截状态。

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, lstatSync, renameSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = join(HERE, '..')
const PKG_NAME = 'dsh-history-search'
const PLUGIN_ID = 'history-search'
// 早期本地开发用的是 @local/dsh-history-search，安装时顺手把旧接线清掉，避免同一插件被加载两次。
const LEGACY_NAME = '@local/dsh-history-search'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROFILE_NAME = process.env.DSH_PROFILE || 'desktop'
const PROFILE_DIR = join(HOME, 'profiles', PROFILE_NAME)
const LOCAL_DIR = join(PROFILE_DIR, 'node_modules')
const LINK_PATH = join(LOCAL_DIR, PKG_NAME)
const LEGACY_LINK = join(LOCAL_DIR, '@local', 'dsh-history-search')
const PATCH_FILE = join(PROFILE_DIR, 'cordis.patch.yml')
const BACKUP_DIR = process.env.DSH_HISTORY_BACKUP || join(process.env.TEMP || process.env.TEMP_DIR || '.', 'dsh-history-search-backup')

const argv = process.argv.slice(2)
const MODE = argv.includes('--uninstall') ? 'uninstall' : argv.includes('--check') ? 'check' : 'install'

const MARK = '# 全历史全文搜索（dsh-history-search'
const BLOCK = `${MARK}，源码在工作区 plugins\\dsh-history-search）：读 ~/.dsh/sessions 全部工作区归档，侧栏面板 + 工作区搜索框联动
- insert:
    - id: ${PLUGIN_ID}
      name: '${PKG_NAME}'
`

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function backup(path) {
  mkdirSync(BACKUP_DIR, { recursive: true })
  const to = join(BACKUP_DIR, `${path.split(/[\\/]/).pop()}.${stamp()}.bak`)
  copyFileSync(path, to)
  return to
}

function atomicWrite(path, text) {
  const tmp = path + '.tmp-' + process.pid
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}

// 清掉旧版 @local/* 接线：老的 Junction 与老的 patch 条目。
function removeLegacy() {
  if (existsSync(LEGACY_LINK)) {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `(Get-Item '${LEGACY_LINK}').Delete()`], { stdio: 'inherit' })
    console.log('已移除旧版 Junction：' + LEGACY_LINK)
  }
  if (!existsSync(PATCH_FILE)) return
  const text = readFileSync(PATCH_FILE, 'utf8')
  if (!text.includes(LEGACY_NAME)) return
  const bak = backup(PATCH_FILE)
  console.log('已备份 patch → ' + bak)
  const re = new RegExp('\\n*# 全历史全文搜索（@local/dsh-history-search[\\s\\S]*?- id: ' + PLUGIN_ID + "\\n      name: '" + LEGACY_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'\\n")
  const next = text.replace(re, '')
  if (next === text) throw new Error('没能移除旧版 patch 条目，请手工检查：' + PATCH_FILE)
  atomicWrite(PATCH_FILE, next)
  console.log('已移除旧版 patch 条目')
}

function linkState() {
  if (!existsSync(LINK_PATH)) return 'absent'
  try {
    lstatSync(LINK_PATH)
    return 'link'
  } catch {
    return 'absent'
  }
}

function patchState() {
  if (!existsSync(PATCH_FILE)) return { file: false, entry: false }
  const text = readFileSync(PATCH_FILE, 'utf8')
  return { file: true, entry: text.includes(`id: ${PLUGIN_ID}`) && text.includes(PKG_NAME) }
}

function report() {
  const ls = linkState()
  const ps = patchState()
  console.log(`插件目录    : ${PLUGIN_DIR}`)
  console.log(`包名        : ${PKG_NAME}`)
  console.log(`profile     : ${PROFILE_DIR}`)
  console.log(`Junction    : ${ls === 'link' ? '已建立 → ' + LINK_PATH : '缺失'}`)
  console.log(`patch 条目  : ${ps.file ? (ps.entry ? '已注册' : '未注册（' + PATCH_FILE + '）') : 'patch 文件不存在'}`)
  console.log(`结论        : ${ls === 'link' && ps.entry ? '接线完成（重启桌面端后生效）' : '未接线完成'}`)
  return ls === 'link' && ps.entry
}

function doInstall() {
  if (!existsSync(join(PLUGIN_DIR, 'package.json'))) {
    throw new Error('插件目录里没有 package.json，路径不对：' + PLUGIN_DIR)
  }

  removeLegacy()

  if (linkState() === 'absent') {
    mkdirSync(LOCAL_DIR, { recursive: true })
    // 用 PowerShell 建 Junction（Node 的 symlink 需要额外权限，Junction 不需要）
    
    execFileSync('powershell', ['-NoProfile', '-Command',
      `New-Item -ItemType Junction -Path '${LINK_PATH}' -Target '${PLUGIN_DIR}' | Out-Null`], { stdio: 'inherit' })
    console.log('Junction 已建立')
  } else {
    console.log('Junction 已存在，跳过')
  }

  if (!existsSync(PATCH_FILE)) throw new Error('找不到 profile patch 文件：' + PATCH_FILE)
  const before = readFileSync(PATCH_FILE, 'utf8')
  if (before.includes(`id: ${PLUGIN_ID}`) && before.includes(PKG_NAME)) {
    console.log('patch 条目已存在，跳过')
  } else {
    const bak = backup(PATCH_FILE)
    console.log('已备份 patch → ' + bak)
    const sep = before.endsWith('\n') ? '\n' : '\n\n'
    atomicWrite(PATCH_FILE, before + sep + BLOCK)
    console.log('已追加 insert 条目')
  }
  report()
  console.log('\n下一步：完全退出并重新启动 DeepSeek Harness（新插件在启动时加载）。')
}

function doUninstall() {
  if (linkState() !== 'absent') {
    
    execFileSync('powershell', ['-NoProfile', '-Command',
      `(Get-Item '${LINK_PATH}').Delete()`], { stdio: 'inherit' })
    console.log('Junction 已删除')
  }
  if (existsSync(PATCH_FILE)) {
    const text = readFileSync(PATCH_FILE, 'utf8')
    if (text.includes(`id: ${PLUGIN_ID}`) && text.includes(MARK)) {
      const bak = backup(PATCH_FILE)
      console.log('已备份 patch → ' + bak)
      const re = new RegExp('\n*' + MARK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?- id: ' + PLUGIN_ID + "\n      name: '" + PKG_NAME + "'\n")
      const next = text.replace(re, '')
      if (next === text) throw new Error('没能从 patch 里移除条目，请手工检查：' + PATCH_FILE)
      atomicWrite(PATCH_FILE, next)
      console.log('已移除 patch 条目')
    } else {
      console.log('patch 里没有本插件条目，跳过')
    }
  }
  report()
  console.log('\n已卸载（重启桌面端后完全生效）。插件源码仍保留在 plugins\\dsh-history-search。')
}

try {
  if (MODE === 'check') {
    const ok = report()
    process.exit(ok ? 0 : 1)
  } else if (MODE === 'uninstall') {
    doUninstall()
  } else {
    doInstall()
  }
} catch (err) {
  console.error('失败：' + (err && err.message ? err.message : err))
  process.exit(1)
}
