/**
 * 知行 · 北极星（人生面）
 *
 * 纯 Markdown、只存本机；不 import lib/ai.js，2.0 不调用任何模型。
 * 数据根/北极星/北极星.md（当前版本）、草稿.md、身份证据.md、历史/v{n}-{date}.md
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { dateKeyInZone } from './clock.js'
import { assertDateKey, ValidationError } from './store.js'

export const NORTHSTAR_DIR = '北极星'
export const NORTHSTAR_FILE = '北极星.md'
export const DRAFT_FILE = '草稿.md'
export const EVIDENCE_FILE = '身份证据.md'
export const HISTORY_DIR = '历史'
const MAX_SIZE = 200_000
const META_RE = /<!--\s*zhixing:northstar\s+version=(\d+)\s+updatedAt=([^\s]+)\s*-->/
const HISTORY_RE = /^v(\d+)-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.md$/

function mainPath(store) { return store.p(NORTHSTAR_DIR, NORTHSTAR_FILE) }
function draftPath(store) { return store.p(NORTHSTAR_DIR, DRAFT_FILE) }
function evidencePath(store) { return store.p(NORTHSTAR_DIR, EVIDENCE_FILE) }
function historyPath(store, name = '') { return store.p(NORTHSTAR_DIR, HISTORY_DIR, name) }

async function writeAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, text, 'utf8')
  await fs.rename(tmp, file)
}

/** 身份宣言的稳定短 id：文本变则 id 变。 */
export function identityId(text) {
  return `id-${crypto.createHash('sha1').update(String(text ?? '')).digest('hex').slice(0, 8)}`
}

/** Markdown → 结构化北极星；未知 `##` 段落原样保留。 */
export function parseNorthStar(markdown) {
  const text = String(markdown ?? '')
  const meta = META_RE.exec(text)
  const sections = []
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      current = { title: heading[1].trim(), lines: [] }
      sections.push(current)
      continue
    }
    if (current) current.lines.push(line)
  }
  const known = new Set(['反愿景', '一句话愿景', '身份宣言', '规则'])
  const sectionOf = (title) => sections.find((section) => section.title === title)
  const bodyOf = (title) => {
    const section = sectionOf(title)
    return section ? section.lines.join('\n').trim() : ''
  }
  const bulletsOf = (title) => {
    const section = sectionOf(title)
    return section
      ? section.lines.map((line) => line.trim()).filter((line) => /^[-*]\s+/.test(line)).map((line) => line.replace(/^[-*]\s+/, '').trim()).filter(Boolean)
      : []
  }
  return {
    exists: true,
    version: meta ? Number(meta[1]) : 0,
    updatedAt: meta ? meta[2] : '',
    antiVision: bodyOf('反愿景'),
    vision: bodyOf('一句话愿景'),
    identity: bulletsOf('身份宣言').map((item) => ({ id: identityId(item), text: item })),
    rules: bulletsOf('规则'),
    extra: sections.filter((section) => !known.has(section.title)).map((section) => ({
      title: section.title,
      body: section.lines.join('\n').trim(),
    })),
  }
}

/** 结构化北极星 → Markdown（固定标题 + 未知段落）。 */
export function serializeNorthStar({ version = 1, updatedAt, antiVision = '', vision = '', identity = [], rules = [], extra = [] }) {
  const lines = [`<!-- zhixing:northstar version=${version} updatedAt=${updatedAt || new Date().toISOString()} -->`, '# 北极星', '']
  const pushSection = (title, body) => { lines.push(`## ${title}`, '', String(body ?? '').trim(), '') }
  pushSection('反愿景', antiVision)
  pushSection('一句话愿景', vision)
  lines.push('## 身份宣言', '')
  for (const item of identity) lines.push(`- ${typeof item === 'string' ? item : item.text}`)
  lines.push('')
  lines.push('## 规则', '')
  for (const item of rules) lines.push(`- ${item}`)
  lines.push('')
  for (const section of extra) {
    if (!section?.title) continue
    pushSection(section.title, section.body ?? '')
  }
  return lines.join('\n')
}

/** 读取当前北极星；没有文件返回 null。 */
export async function readNorthStar(store) {
  let raw = ''
  try { raw = await fs.readFile(mainPath(store), 'utf8') } catch { return null }
  const parsed = parseNorthStar(raw)
  return { ...parsed, raw }
}

/** /state 只用的摘要：不含正文。 */
export async function northStarSummary(store) {
  try {
    const data = await readNorthStar(store)
    return data ? { exists: true, version: data.version, updatedAt: data.updatedAt } : { exists: false, version: 0, updatedAt: '' }
  } catch {
    return { exists: false, version: 0, updatedAt: '' }
  }
}

function datePart(updatedAt) {
  const parsed = new Date(String(updatedAt ?? ''))
  return Number.isNaN(parsed.getTime()) ? dateKeyInZone(new Date()) : dateKeyInZone(parsed)
}

/**
 * 保存北极星。
 * - mode='version' 且已有内容：旧文件复制到 历史/v{旧版本}-{日期}.md，版本 +1
 * - mode='minor'（默认）：覆盖当前版本
 * - markdown 优先；否则用 fields 结构化字段（未知段落沿用旧文件的）
 */
export async function saveNorthStar(store, { markdown, fields, mode = 'minor' } = {}) {
  const existing = await readNorthStar(store)
  let data
  if (typeof markdown === 'string' && markdown.trim()) {
    data = parseNorthStar(markdown)
  } else if (fields && typeof fields === 'object') {
    data = {
      antiVision: String(fields.antiVision ?? '').trim(),
      vision: String(fields.vision ?? '').trim(),
      identity: (Array.isArray(fields.identity) ? fields.identity : []).map((item) => ({ text: String(typeof item === 'string' ? item : item?.text ?? '').trim() })).filter((item) => item.text),
      rules: (Array.isArray(fields.rules) ? fields.rules : []).map((item) => String(item ?? '').trim()).filter(Boolean),
      extra: existing?.extra ?? [],
    }
  } else {
    throw new ValidationError('没有可保存的北极星内容')
  }
  if (!data.antiVision && !data.vision && !data.identity.length && !data.rules.length) {
    throw new ValidationError('北极星至少要写一段内容')
  }

  const baseVersion = existing?.version ?? 0
  let version = baseVersion || 1
  if (existing && mode === 'version') {
    version = baseVersion + 1
    await fs.mkdir(historyPath(store), { recursive: true })
    const stamp = datePart(existing.updatedAt)
    let name = `v${baseVersion}-${stamp}.md`
    for (let index = 2; ; index += 1) {
      try { await fs.access(historyPath(store, name)); name = `v${baseVersion}-${stamp}-${index}.md` } catch { break }
    }
    await fs.copyFile(mainPath(store), historyPath(store, name))
  }

  const updatedAt = new Date().toISOString()
  const body = serializeNorthStar({
    version,
    updatedAt,
    antiVision: data.antiVision,
    vision: data.vision,
    identity: data.identity,
    rules: data.rules,
    extra: data.extra,
  })
  if (body.length > MAX_SIZE) throw new ValidationError('北极星内容太长（上限 200KB）')
  await writeAtomic(mainPath(store), body)
  return { version, updatedAt, identity: data.identity.map((item) => ({ ...item, id: identityId(item.text) })) }
}

export async function readDraft(store) {
  try { return await fs.readFile(draftPath(store), 'utf8') } catch { return '' }
}

export async function writeDraft(store, text) {
  const value = String(text ?? '')
  if (value.length > MAX_SIZE) throw new ValidationError('草稿太长（上限 200KB）')
  await writeAtomic(draftPath(store), value)
  return { saved: true }
}

/** 历史版本列表（新→旧）。 */
export async function historyList(store) {
  let names = []
  try { names = await fs.readdir(historyPath(store)) } catch { return [] }
  return names
    .map((name) => {
      const match = HISTORY_RE.exec(name)
      if (!match) return null
      return { name, version: Number(match[1]), date: match[2] }
    })
    .filter(Boolean)
    .sort((a, b) => b.version - a.version || (a.date < b.date ? 1 : -1))
}

/** 按版本号读取历史；不存在返回 null。 */
export async function readHistory(store, version) {
  const target = Number(version)
  if (!Number.isInteger(target) || target < 1) throw new ValidationError('历史版本号不对')
  const found = (await historyList(store)).find((item) => item.version === target)
  if (!found) return null
  try { return { ...found, markdown: await fs.readFile(historyPath(store, found.name), 'utf8') } } catch { return null }
}

function parseEvidence(markdown) {
  const sections = []
  let current = null
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      current = { title: heading[1].trim(), entries: [] }
      sections.push(current)
      continue
    }
    const bullet = /^\s*[-*]\s+(\d{4}-\d{2}-\d{2})\s+(.+?)\s*$/.exec(line)
    if (current && bullet) current.entries.push({ date: bullet[1], text: bullet[2] })
  }
  return sections
}

function serializeEvidence(sections) {
  const lines = ['# 身份证据', '']
  for (const section of sections) {
    lines.push(`## ${section.title}`, '')
    for (const entry of section.entries) lines.push(`- ${entry.date} ${entry.text}`)
    lines.push('')
  }
  return lines.join('\n')
}

async function readEvidence(store) {
  try { return parseEvidence(await fs.readFile(evidencePath(store), 'utf8')) } catch { return [] }
}

/** 每条身份宣言的本月证据数量与明细。 */
export async function identityEvidence(store, identities, now = new Date()) {
  const sections = await readEvidence(store)
  const month = dateKeyInZone(now).slice(0, 7)
  const byTitle = new Map(sections.map((section) => [section.title, section.entries]))
  return (identities ?? []).map((item) => {
    const text = typeof item === 'string' ? item : item.text
    const entries = (byTitle.get(text) ?? []).filter((entry) => entry.date.startsWith(month))
    return { id: identityId(text), text, evidenceCount: entries.length, evidence: entries }
  })
}

/**
 * 追加身份证据（偏航报告用）。picks: [{ identityId, date, text, source }]
 * 同一行不重复追加。
 */
export async function appendIdentityEvidence(store, picks = []) {
  const northstar = await readNorthStar(store)
  if (!northstar) throw new ValidationError('还没有北极星，先写北极星再勾身份证据')
  const byId = new Map(northstar.identity.map((item) => [item.id, item.text]))
  const sections = await readEvidence(store)
  const sectionOf = (title) => {
    let found = sections.find((section) => section.title === title)
    if (!found) { found = { title, entries: [] }; sections.push(found) }
    return found
  }
  const added = []
  for (const pick of Array.isArray(picks) ? picks : []) {
    const title = byId.get(String(pick?.identityId ?? ''))
    if (!title) continue
    const date = assertDateKey(pick?.date || dateKeyInZone(new Date()))
    const text = String(pick?.text ?? '').trim()
    if (!text) continue
    const source = String(pick?.source ?? '').trim()
    const line = source ? `${text}（来源：${source}）` : text
    const target = sectionOf(title)
    if (target.entries.some((entry) => entry.date === date && entry.text === line)) continue
    target.entries.push({ date, text: line })
    added.push({ identityId: pick.identityId, date, text: line })
  }
  if (added.length) {
    const body = serializeEvidence(sections)
    if (body.length > MAX_SIZE) throw new ValidationError('身份证据文件太大（上限 200KB）')
    await writeAtomic(evidencePath(store), body)
  }
  return { added: added.length, items: added }
}
