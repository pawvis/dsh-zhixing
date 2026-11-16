/**
 * 知行 · 会话日志采集
 *
 * 只读取「今天创建 / 当前活跃 / 最近 7 天创建」的会话，按本地日期过滤事件，
 * 在本地把工具原始输出剪掉，只保留：用户说了什么、改了哪些文件、助手结论摘要。
 * 交给模型的永远是摘要，不落盘会话原文。
 */
import { dayStartInZone } from './clock.js'
import { addDays } from './store.js'

const SCAN_DAYS = 7
const MAX_SESSIONS = 50
const FILE_TOOLS = new Set(['write', 'edit', 'apply_patch', 'create_worktree'])

function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function firstLine(text, max = 120) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max)}…` : line
}

function filesFromTool(name, rawArgs) {
  if (!FILE_TOOLS.has(name) || typeof rawArgs !== 'string') return []
  const paths = []
  try {
    const args = JSON.parse(rawArgs)
    for (const key of ['path', 'file_path', 'filePath', 'target']) {
      if (typeof args?.[key] === 'string') paths.push(args[key])
    }
  } catch { /* 非 JSON 参数：按补丁文本处理 */ }
  for (const m of rawArgs.matchAll(/\*\*\* (?:Add|Update|Delete) File:\s*(.+)/g)) paths.push(m[1].trim())
  for (const m of rawArgs.matchAll(/^\+\+\+ b\/(.+)$/gm)) paths.push(m[1].trim())
  return paths
}

function relativePath(file, cwd) {
  if (!cwd || !file.startsWith(cwd)) return file
  return file.slice(cwd.length).replace(/^\//, '')
}

async function digestSession(query, record, dayStart, dayEnd) {
  const header = record.header
  const log = await query.readSession(header.id)
  const events = Array.isArray(log?.events) ? log.events : []
  const digest = {
    sessionId: header.id,
    cwd: header.cwd ?? '',
    createdAt: header.createdAt,
    live: record.live === true,
    human: [],
    files: [],
    assistant: [],
    toolCalls: 0,
    eventCount: events.length,
  }
  for (const event of events) {
    const data = event?.data ?? {}
    if (!(event.time >= dayStart && event.time < dayEnd)) continue
    if (event.type === 'user/message') {
      const sourceKind = data.source?.kind
      const text = textOf(data.content)
      if (!text) continue
      if (sourceKind && sourceKind !== 'user') continue
      if (digest.human.length < 6) digest.human.push(firstLine(text, 160))
    } else if (event.type === 'assistant/message') {
      const text = textOf(data.message?.content)
      if (text && digest.assistant.length < 3) digest.assistant.push(firstLine(text, 160))
    } else if (event.type === 'tool/call') {
      digest.toolCalls += 1
      for (const file of filesFromTool(data.name, data.arguments)) {
        const rel = relativePath(file, header.cwd)
        if (!digest.files.includes(rel)) digest.files.push(rel)
      }
    }
  }
  return digest
}

export async function collectSessionDigest(ctx, { date, maxSessions = MAX_SESSIONS } = {}) {
  const query = ctx.get('sessionQuery')
  if (!query || typeof query.listSessions !== 'function' || typeof query.readSession !== 'function') {
    return { supported: false, scanned: 0, sessions: [], workspaces: [], note: '宿主未提供 sessionQuery 服务，本次只能使用人工输入与导入文件' }
  }
  const dayStart = dayStartInZone(date)
  const dayEnd = dayStartInZone(addDays(date, 1))
  const since = dayStartInZone(addDays(date, -SCAN_DAYS))
  let records = []
  try {
    records = await query.listSessions()
  } catch (error) {
    return { supported: false, scanned: 0, sessions: [], workspaces: [], note: `会话列表读取失败：${error instanceof Error ? error.message : String(error)}` }
  }
  const candidates = records
    .filter((record) => {
      const header = record?.header
      if (!header) return false
      if (record.live) return true
      return header.createdAt >= since
    })
    .sort((a, b) => b.header.createdAt - a.header.createdAt)
    .slice(0, maxSessions)

  const sessions = []
  const workspaces = new Set()
  for (const record of candidates) {
    try {
      const digest = await digestSession(query, record, dayStart, dayEnd)
      const today = digest.human.length + digest.files.length + digest.assistant.length > 0
      if (!today) continue
      sessions.push(digest)
      if (digest.cwd) workspaces.add(digest.cwd)
    } catch (error) {
      // 单个会话读取失败不阻断整体采集。
      sessions.push({
        sessionId: record.header.id,
        cwd: record.header.cwd ?? '',
        error: error instanceof Error ? error.message : String(error),
        human: [], files: [], assistant: [], toolCalls: 0,
      })
    }
  }
  return {
    supported: true,
    scanned: candidates.length,
    sessions,
    workspaces: [...workspaces],
    note: candidates.length === 0 ? '今天没有可读取的会话' : `扫描 ${candidates.length} 个会话，命中 ${sessions.length} 个`,
  }
}

/** 把会话摘要压成给模型看的一小段文本（不带任何工具原始输出 / 会话原文）。 */
export function sessionPromptBlock(digest) {
  if (!digest?.supported) return `（会话日志不可用：${digest?.note ?? '未知原因'}）`
  if (!digest.sessions.length) return '（今天没有从 Harness 会话采集到内容）'
  const lines = []
  for (const session of digest.sessions.slice(0, 20)) {
    if (session.error) { lines.push(`- 会话 ${session.sessionId.slice(0, 8)}：读取失败（${session.error}）`); continue }
    const parts = [`- 会话 ${session.sessionId.slice(0, 8)}` + (session.cwd ? `（${session.cwd}）` : '')]
    if (session.human.length) parts.push(`  用户指令：${session.human.join(' / ')}`)
    if (session.files.length) parts.push(`  改动文件：${session.files.slice(0, 12).join('、')}${session.files.length > 12 ? ` 等 ${session.files.length} 个` : ''}`)
    if (session.assistant.length) parts.push(`  助手结论：${session.assistant[0]}`)
    lines.push(parts.join('\n'))
  }
  return lines.join('\n')
}
