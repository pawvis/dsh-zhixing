/** 知行 · 目标 AI：文档拆解与日报进度建议 */
import { callModel } from './ai.js'
import { defaultRange, normalizeCycle } from './goals.js'

const CHUNK_SIZE = 6000
const MAX_CHUNKS = 8

export function chunkText(text, size = CHUNK_SIZE, maxChunks = MAX_CHUNKS) {
  const paragraphs = String(text ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const chunks = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length + 2 > size && current) {
      chunks.push(current)
      current = ''
    }
    while (paragraph.length > size) {
      chunks.push(paragraph.slice(0, size))
      current = paragraph.slice(size)
      break
    }
    if (paragraph.length > size) continue
    current = current ? `${current}\n\n${paragraph}` : paragraph
  }
  if (current) chunks.push(current)
  if (chunks.length > maxChunks) {
    return { chunks: chunks.slice(0, maxChunks), truncated: true, total: chunks.length }
  }
  return { chunks, truncated: false, total: chunks.length }
}

export function parseJsonLoosely(text) {
  const raw = String(text ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try { return JSON.parse(raw) } catch { /* 尝试截取第一个 JSON 对象 */ }
  const start = raw.search(/[[{]/)
  if (start < 0) throw new Error('模型输出里没有 JSON')
  const opener = raw[start]
  const closer = opener === '[' ? ']' : '}'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === opener) depth += 1
    else if (ch === closer) {
      depth -= 1
      if (depth === 0) return JSON.parse(raw.slice(start, i + 1))
    }
  }
  throw new Error('模型输出的 JSON 不完整')
}

const IMPORT_SYSTEM = `你是「知行」的目标拆解器。把文档内容拆成结构化的目标列表。
只输出 JSON，不要代码围栏，不要解释。格式：
{"goals":[{"title":"目标标题","cycle":"周|月|年","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","measure":"衡量方式","parentIndex":null}]}
规则：
1. 保留原文的目标层级：年度 → 月度 → 周。parentIndex 指向本次输出数组里父目标的索引（从 0 开始），顶层用 null。
2. 每条必须有可验证的衡量方式；原文没有就根据内容补一个合理的。
3. 起止日期缺失时按当前时间给出该周期的起止日期。
4. 最多输出 30 条，合并重复项。
5. cycle 只能是「周」「月」「年」。`

export async function decomposeGoals(ctx, text, { date = dateKeyNow(), override } = {}) {
  const { chunks, truncated, total } = chunkText(text)
  if (!chunks.length) throw new Error('文档里没有可拆解的文字')
  const collected = []
  for (const [index, chunk] of chunks.entries()) {
    const prompt = `今天是 ${date}。
这是文档的第 ${index + 1}/${chunks.length} 段，请只拆解这一段里的目标：

${chunk}`
    const result = await callModel(ctx, { system: IMPORT_SYSTEM, user: prompt, maxTokens: 2500, override })
    let parsed = null
    try { parsed = parseJsonLoosely(result.text) } catch (error) { throw new Error(`第 ${index + 1} 段拆解失败：${error.message}`) }
    const goals = Array.isArray(parsed) ? parsed : parsed?.goals
    if (!Array.isArray(goals)) throw new Error(`第 ${index + 1} 段没有返回 goals 数组`)
    for (const goal of goals) {
      const fallback = defaultRange(normalizeCycle(goal.cycle))
      collected.push({
        title: String(goal.title ?? '').trim(),
        cycle: normalizeCycle(goal.cycle),
        startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(goal.startDate)) ? String(goal.startDate) : fallback.startDate,
        endDate: /^\d{4}-\d{2}-\d{2}$/.test(String(goal.endDate)) ? String(goal.endDate) : fallback.endDate,
        measure: String(goal.measure ?? '').trim() || '完成 1 个可验证的结果',
        parentIndex: Number.isInteger(goal.parentIndex) ? goal.parentIndex : null,
      })
    }
  }
  return { goals: collected.filter((goal) => goal.title), truncated, total, model: null }
}

function dateKeyNow() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const ANALYZE_SYSTEM = `你是「知行」的目标进度分析器。给你一份当天的工作日报和一组目标。
判断日报里的哪些内容实质推进了哪个目标，并给出进度建议。
只输出 JSON，不要代码围栏，不要解释。格式：
{"suggestions":[{"goalId":"目标 id","suggestedProgress":60,"reason":"一句理由","quote":"日报原文里的一句话"}]}
规则：
1. 只给真正被推进的目标建议；没有推进的目标不要出现。
2. suggestedProgress 是 0-100 的整数，必须在原进度基础上前进；最多 +30。
3. quote 必须逐字来自日报。
4. 最多 6 条。`

export async function analyzeReportForGoals(ctx, { markdown, goals, override }) {
  const leaves = goals.filter((goal) => !goals.some((item) => item.parentId === goal.id))
  if (!leaves.length) return { suggestions: [] }
  const list = leaves.map((goal) => `- id=${goal.id}｜${goal.title}｜衡量：${goal.measure}｜当前 ${goal.progress}%`).join('\n')
  const prompt = `目标列表（只分析叶子目标）：
${list}

当天日报：
${markdown}`
  const result = await callModel(ctx, { system: ANALYZE_SYSTEM, user: prompt, maxTokens: 1500, override })
  const parsed = parseJsonLoosely(result.text)
  const items = Array.isArray(parsed) ? parsed : parsed?.suggestions
  if (!Array.isArray(items)) throw new Error('模型没有返回 suggestions 数组')
  const byId = new Map(leaves.map((goal) => [goal.id, goal]))
  const suggestions = []
  for (const item of items) {
    const goal = byId.get(String(item.goalId))
    if (!goal) continue
    const to = Math.max(0, Math.min(100, Math.round(Number(item.suggestedProgress))))
    if (!Number.isFinite(to) || to <= goal.progress) continue
    suggestions.push({
      id: `${goal.id}-${Date.now().toString(36)}${suggestions.length}`,
      goalId: goal.id,
      goalTitle: goal.title,
      from: goal.progress,
      to,
      reason: String(item.reason ?? '').trim() || '日报显示有推进',
      quote: String(item.quote ?? '').trim(),
      model: result.selection,
      at: new Date().toISOString(),
      status: 'pending',
    })
  }
  return { suggestions, model: result.selection }
}
