#!/usr/bin/env node
/**
 * Validate the awesome-dsh-plugin market entry before it is submitted.
 *
 * The catalog parser is strict and its errors are reported as vague one-liners
 * ("unknown field \"0\"", "url must be a https://github.com/owner/repo link").
 * Both of those came from one real mistake: the file was written as a YAML
 * sequence (`- url: ...`) instead of a mapping (`url: ...`). This script
 * reproduces the catalog's rules locally so that class of mistake fails here,
 * in a second, instead of in CI ten minutes later.
 *
 * Usage:
 *   node tools/validate-entry.mjs [path]     (default: market/entry.yml)
 */
import { readFileSync } from 'node:fs'

const ALLOWED = ['url', 'name', 'category', 'description', 'icon', 'tarball']
const CATEGORIES = ['agi', 'ui', 'usage', 'theme', 'model', 'identity', 'session', 'memory', 'tools', 'wsl',
  'browser', 'vision', 'voice', 'docs', 'skill', 'workflow', 'git', 'notify', 'dev', 'security', 'remote', 'market', 'fun']

/** Minimal YAML reader: top-level scalar keys, one nested map (`description`), `key: value` pairs. */
function parseEntry(text) {
  const problems = []
  const data = {}
  let nestedKey = null
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  lines.forEach((raw, idx) => {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) return
    const topIndent = raw.match(/^(\s*)/)[1].length
    const body = raw.trim()
    if (body.startsWith('- ')) {
      problems.push(`line ${idx + 1}: the entry is a YAML sequence ("- ${body.slice(2, 12)}…"); the catalog expects a mapping`)
      return
    }
    const m = body.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/)
    if (!m) { problems.push(`line ${idx + 1}: not a "key: value" line — ${body.slice(0, 40)}`); return }
    const key = m[1]
    const value = m[2].trim()
    if (topIndent === 0) {
      if (!ALLOWED.includes(key)) problems.push(`line ${idx + 1}: unknown field "${key}" — an entry may only declare ${ALLOWED.join(', ')}`)
      if (value === '') { nestedKey = key; data[key] = {} } else { nestedKey = null; data[key] = stripQuotes(value) }
      return
    }
    if (nestedKey === null) { problems.push(`line ${idx + 1}: indented "${key}" under no parent key`); return }
    data[nestedKey][key] = stripQuotes(value)
  })
  return { data, problems }
}

function stripQuotes(v) {
  const s = v.trim()
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1).replace(s.startsWith("'") ? /''/g : /\\"/g, s.startsWith("'") ? "'" : '"')
  }
  return s
}

const path = process.argv[2] || 'market/entry.yml'
let text
try { text = readFileSync(path, 'utf8') } catch (e) { console.log(`✗ 读不到 ${path}: ${e.message}`); process.exit(2) }
if (text.includes('\t')) console.log('· 提示：文件里有 tab，YAML 不允许用 tab 缩进')

const { data, problems } = parseEntry(text)

if (typeof data.url !== 'string' || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(data.url)) {
  problems.push(`"url" must be a https://github.com/owner/repo link (got: ${JSON.stringify(data.url ?? null)})`)
}
if (typeof data.name !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(data.name)) {
  problems.push(`"name" must be owner/repo (got: ${JSON.stringify(data.name ?? null)})`)
}
if (data.url && data.name && data.url !== `https://github.com/${data.name}`) {
  problems.push(`"url" (${data.url}) does not match "name" (${data.name}) — the catalog requires them to agree`)
}
if (typeof data.category !== 'string' || !CATEGORIES.includes(data.category)) {
  problems.push(`"category" must be one of: ${CATEGORIES.join(', ')} (got: ${JSON.stringify(data.category ?? null)})`)
}
const desc = data.description
if (desc === null || typeof desc !== 'object' || Array.isArray(desc)) {
  problems.push('"description" must be a map with at least an "en" key')
} else {
  if (typeof desc.en !== 'string' || desc.en.trim() === '') problems.push('"description.en" is required')
  else if (!desc.en.trim().endsWith('.')) problems.push('"description.en" must end with a period')
  if (desc.zh !== undefined && typeof desc.zh !== 'string') problems.push('"description.zh" must be a string when present')
  for (const k of Object.keys(desc)) if (!['en', 'zh'].includes(k)) problems.push(`"description.${k}" is not a known locale key`)
}
if (data.icon !== undefined) {
  if (!/^https:\/\/raw\.githubusercontent\.com\/|\/\/github\.com\/.*\/blob\//.test(data.icon)) {
    problems.push('"icon" must be a bitmap hosted on GitHub (raw.githubusercontent.com or a repo blob link), not an SVG or a third-party host')
  }
  if (!/\.(png|jpe?g|webp)(\?.*)?$/i.test(data.icon)) problems.push('"icon" must be png/jpg/jpeg/webp')
}
if (data.tarball !== undefined) {
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//.test(data.tarball)) {
    problems.push('"tarball" must be a https://github.com/owner/repo/releases/download/<tag>/<file> link')
  }
  if (!/\.(tgz|tar\.gz)$/i.test(data.tarball)) problems.push('"tarball" must end in .tgz or .tar.gz')
  const tagged = data.tarball.match(/\/download\/([^/]+)\//)
  if (tagged && tagged[1] === 'latest') problems.push('"tarball" must pin a tag, not "latest" — latest/download resolves the tag but not a versioned filename')
}

// Extra facts the catalog enforces elsewhere, reported as notes rather than failures.
const notes = []
if (data.tarball === undefined) notes.push('no "tarball": the catalog installs from `dsh plugin --profile web add github:owner/repo`, which is accepted but needs no build step')
if (data.icon === undefined) notes.push('no "icon": the market falls back to the first image in the README')

if (problems.length > 0) {
  console.log(`✗ ${problems.length} problem(s) in ${path}`)
  for (const p of problems) console.log('  ' + p)
  if (notes.length) { console.log('· notes'); for (const n of notes) console.log('  ' + n) }
  process.exit(1)
}
console.log(`✓ ${path} 通过`)
for (const [k, v] of Object.entries(data)) console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120)}`)
if (notes.length) { console.log('· notes'); for (const n of notes) console.log('  ' + n) }
