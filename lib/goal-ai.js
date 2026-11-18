/** 知行 · 目标 AI：文档拆解与日报进度建议 */
import { callModel } from './ai.js'
import { todayKey } from './clock.js'
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

/** 把字符串里的裸控制字符（换行、制表符）转义：模型偶尔会在 JSON 字符串里直接换行。 */
function escapeControlChars(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of String(text ?? '')) {
    const code = ch.charCodeAt(0)
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue }
      if (ch === '\\') { out += ch; escaped = true; continue }
      if (ch === '"') { inString = false; out += ch; continue }
      if (code < 0x20) { out += `\\u${code.toString(16).padStart(4, '0')}`; continue }
      out += ch
      continue
    }
    if (ch === '"') inString = true
    out += ch
  }
  return out
}

/** 常见脏数据：尾逗号、模型用中文引号当 JSON 定界符。只在正常解析失败后使用。 */
function sanitizeJsonText(text) {
  return escapeControlChars(String(text ?? '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u201c\u201d]/g, '"'))
}

/** 从 start 开始找配对的右括号；带字符串状态和括号类型校验。 */
function matchBracket(source, start) {
  const stack = []
  let inString = false
  let escaped = false
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{' || ch === '[') { stack.push(ch); continue }
    if (ch === '}' || ch === ']') {
      const open = stack.pop()
      if ((open === '{' && ch !== '}') || (open === '[' && ch !== ']')) return -1
      if (!stack.length) return i
    }
  }
  return -1
}

function closersOf(stack) {
  let out = ''
  for (let i = stack.length - 1; i >= 0; i -= 1) out += stack[i] === '{' ? '}' : ']'
  return out
}

/**
 * 截断修复：输出被 maxTokens 截断时，从后往前找「已经完整」的切点，
 * 补上缺的右括号再解析。{"goals":[{...},{...} 这种对象包数组以前会直接失败。
 */
function repairTruncated(source, start) {
  const stack = []
  let inString = false
  let escaped = false
  const cuts = []
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{' || ch === '[') { stack.push(ch); continue }
    if (ch === '}' || ch === ']') {
      if (stack.length) stack.pop()
      cuts.push({ at: i + 1, closers: closersOf(stack) })
    }
  }
  const attempts = []
  for (let k = cuts.length - 1; k >= 0 && attempts.length < 80; k -= 1) attempts.push(cuts[k])
  attempts.push({ at: source.length, closers: closersOf(stack) })
  for (const { at, closers } of attempts) {
    const body = source.slice(start, at).replace(/,\s*$/, '')
    if (!body) continue
    for (const candidate of [body + closers, sanitizeJsonText(body) + closers]) {
      try { return JSON.parse(candidate) } catch { /* 继续往前裁 */ }
    }
  }
  return null
}

export function parseJsonLoosely(text) {
  const raw = String(text ?? '').trim().replace(/^\uFEFF/, '')
  if (!raw) throw new Error('模型输出为空')
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  for (const candidate of [raw, unfenced]) {
    if (!candidate) continue
    for (const attempt of [candidate, escapeControlChars(candidate), sanitizeJsonText(candidate)]) {
      try { return JSON.parse(attempt) } catch { /* 继续尝试更宽松的解析 */ }
    }
  }
  const source = unfenced || raw
  const start = source.search(/[[{]/)
  if (start < 0) throw new Error('模型输出里没有 JSON')
  const end = matchBracket(source, start)
  if (end > start) {
    const balanced = source.slice(start, end + 1)
    for (const attempt of [balanced, escapeControlChars(balanced), sanitizeJsonText(balanced)]) {
      try { return JSON.parse(attempt) } catch { /* 继续 */ }
    }
  }
  const repaired = repairTruncated(source, start)
  if (repaired !== null) return repaired
  // 数组里已经有完整的元素时，至少把这几条交回去，而不是整段失败。
  if (source[start] === '[') {
    const items = []
    let cursor = start + 1
    while (cursor < source.length) {
      while (cursor < source.length && /[\s,]/.test(source[cursor])) cursor += 1
      if (source[cursor] !== '{' && source[cursor] !== '[') break
      const itemEnd = matchBracket(source, cursor)
      if (itemEnd < 0) break
      const chunk = source.slice(cursor, itemEnd + 1)
      let parsed = null
      for (const attempt of [chunk, sanitizeJsonText(chunk)]) {
        try { parsed = JSON.parse(attempt); break } catch { /* 继续 */ }
      }
      if (parsed === null) break
      items.push(parsed)
      cursor = itemEnd + 1
    }
    if (items.length) return items
  }
  throw new Error('模型输出的 JSON 不完整')
}

/** 兜底：整段 JSON 救不回来时，把里面每个完整的目标对象单独捞出来。 */
export function salvageGoalObjects(text) {
  const source = String(text ?? '')
  const marker = source.search(/"goals"\s*:/)
  let cursor = marker >= 0 ? source.indexOf('[', marker) : 0
  if (cursor < 0) cursor = 0
  const items = []
  while (cursor < source.length) {
    if (source[cursor] !== '{') { cursor += 1; continue }
    const end = matchBracket(source, cursor)
    if (end < 0) break
    const chunk = source.slice(cursor, end + 1)
    for (const attempt of [chunk, sanitizeJsonText(chunk)]) {
      try {
        const parsed = JSON.parse(attempt)
        if (parsed && typeof parsed.title === 'string' && parsed.title.trim()) items.push(parsed)
        break
      } catch { /* 这个对象坏了，跳过 */ }
    }
    cursor = end + 1
  }
  return items
}

const IMPORT_SYSTEM = `你是「知行」的目标拆解器。把文档内容拆成结构化的目标列表。
只输出 JSON，不要代码围栏，不要解释。格式：
{"goals":[{"title":"目标标题","detail":"详细说明","cycle":"年|季度|月|周","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","measure":"衡量方式","parentIndex":null}]}
规则：
1. 层级固定为 年 → 季度 → 月 → 周。子目标的周期必须比上级低一级（年下面挂季度，季度下面挂月，月下面挂周），不要把「年」挂在「年」下面。
2. 原文里并列的年度目标各自作为一条「年」目标（parentIndex 为 null），不要额外编一个总括目标把它们包起来。
3. 按「近细远粗」往下拆：每个年度目标拆出 2~4 个季度里程碑（写清是哪个季度、交付什么）；只把最近的一个季度拆到月；只把最近的一个月拆到周。
4. parentIndex 指向本次输出数组里上级目标的索引（从 0 开始），上级必须排在子目标前面。
5. 每条必须有可验证的衡量方式；原文没有就根据内容补一个合理的。
6. 日期要和周期对应：季度用该季度首尾日（如 Q1 = 01-01 ~ 03-31），月用当月首尾日，周用周一到周日；子目标日期落在上级日期范围内。
7. 最多输出 40 条，合并重复项。
8. title 是简短的目标标题，最多 20 个汉字，只留核心结果；背景、具体范围、做法、交付物等细节全部写进 detail（最多 200 字），不要把整段原文塞进 title。detail 可以为空字符串。`

/** 目标标题的字数上限（按字符数算，中文一个字算 1）。 */
export const GOAL_TITLE_MAX = 20
/** 详细说明的长度上限。 */
const GOAL_DETAIL_MAX = 500

const ABBREVIATE_SYSTEM = `你是「知行」的目标标题缩写器。输入是一些过长的目标标题，请把它们缩写成简短的目标标题，并把被省略的具体内容写进详细说明。
只输出 JSON，不要代码围栏，不要解释。格式：
{"items":[{"index":0,"title":"简短标题","detail":"详细说明"}]}
规则：
1. index 是输入的序号，每条输入都要有一条输出，不能漏。
2. title 保留目标的核心结果，最多 20 个汉字，不要用「完成」「推进」这类没有信息量的开头硬凑。
3. 原标题里的范围、做法、交付物、时间限定等细节写进 detail（最多 200 字），不要丢失信息；detail 可以为空字符串。
4. 不要合并、拆分或改变目标的周期和层级。`

/** 按字符数算标题长度。 */
function titleLength(text) {
  return Array.from(String(text ?? '')).length
}

const RANK = { 周: 1, 月: 2, 季度: 3, 年: 4 }

/** 修正层级：上级必须比自己周期高；按树的先序重新排列，保证上级在前。 */
export function normalizeImportTree(goals) {
  const list = goals.map((goal) => ({ ...goal }))
  const parentOf = (i) => {
    const pi = list[i].parentIndex
    return Number.isInteger(pi) && pi >= 0 && pi < list.length && pi !== i ? pi : null
  }
  for (let i = 0; i < list.length; i += 1) {
    let pi = parentOf(i)
    const seen = new Set([i])
    while (pi !== null && (RANK[list[pi].cycle] ?? 0) <= (RANK[list[i].cycle] ?? 0) && !seen.has(pi)) {
      seen.add(pi)
      pi = parentOf(pi)
    }
    list[i].parentIndex = pi !== null && !seen.has(pi) ? pi : null
  }
  // 断环：沿上级链回到自己的，改成顶层。
  for (let i = 0; i < list.length; i += 1) {
    const seen = new Set([i])
    let cur = list[i].parentIndex
    while (cur !== null && cur !== undefined) {
      if (seen.has(cur)) { list[i].parentIndex = null; break }
      seen.add(cur)
      cur = list[cur].parentIndex
    }
  }
  const order = []
  const visit = (i) => {
    order.push(i)
    list.forEach((goal, j) => { if (goal.parentIndex === i) visit(j) })
  }
  list.forEach((goal, i) => { if (goal.parentIndex === null) visit(i) })
  const newIndex = new Map(order.map((oldIndex, idx) => [oldIndex, idx]))
  return order.map((oldIndex) => {
    const goal = list[oldIndex]
    return { ...goal, parentIndex: goal.parentIndex === null ? null : newIndex.get(goal.parentIndex) }
  })
}

/** 模型输出里的第一个顶层 JSON 值是否完整闭合（用来判断是不是被 maxTokens 截断）。 */
function jsonLooksComplete(text) {
  const source = String(text ?? '')
  const start = source.search(/[[{]/)
  if (start < 0) return false
  const stack = []
  let inString = false
  let escaped = false
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{' || ch === '[') { stack.push(ch); continue }
    if (ch === '}' || ch === ']') {
      stack.pop()
      if (!stack.length) return true
    }
  }
  return false
}

/** 解析一段模型输出：正常 JSON → 截断修复 → 逐个目标对象兜底。ok=false 表示完全没救回来。 */
function parseGoalsOutput(text) {
  const complete = jsonLooksComplete(text)
  try {
    const parsed = parseJsonLoosely(text)
    const goals = Array.isArray(parsed) ? parsed : parsed?.goals
    if (Array.isArray(goals)) return { ok: true, goals, partial: !complete }
  } catch { /* 走兜底 */ }
  const salvaged = salvageGoalObjects(text)
  if (salvaged.length) return { ok: true, goals: salvaged, partial: true }
  return { ok: false, goals: [], partial: false }
}

/** 每批最多让模型改多少条标题，控制单次输出不要被 maxTokens 截断。 */
const ABBREVIATE_BATCH = 40

/** 一次批量缩写请求；失败或输出不可用返回 null，由调用方保持原样。 */
async function abbreviateBatch(ctx, batch, override) {
  const input = batch
    .map(({ goal, index }) => `- index=${index}｜${goal.title}｜说明：${goal.detail || '（空）'}｜衡量：${goal.measure}`)
    .join('\n')
  try {
    const result = await callModel(ctx, {
      system: ABBREVIATE_SYSTEM,
      user: `把这些目标标题缩写到 ${GOAL_TITLE_MAX} 个汉字以内：\n${input}`,
      maxTokens: 6000,
      override,
      timeoutMs: 60_000,
    })
    const parsed = parseJsonLoosely(result.text)
    const items = Array.isArray(parsed) ? parsed : parsed?.items
    if (!Array.isArray(items)) return null
    const byIndex = new Map()
    for (const item of items) {
      const index = Number(item?.index)
      if (Number.isInteger(index)) byIndex.set(index, item)
    }
    return byIndex
  } catch { return null }
}

/**
 * 模型给出的标题仍然超过上限时，用少量额外的批量调用缩写（只发过长的标题），
 * 把细节转进 detail。缩写失败或结果不合格时保持原样，不影响拆解结果。
 */
export async function shortenLongTitles(ctx, goals, override) {
  const long = goals
    .map((goal, index) => ({ goal, index }))
    .filter(({ goal }) => titleLength(goal.title) > GOAL_TITLE_MAX)
  if (!long.length) return goals
  const shortened = goals.slice()
  for (let start = 0; start < long.length; start += ABBREVIATE_BATCH) {
    const batch = long.slice(start, start + ABBREVIATE_BATCH)
    const byIndex = await abbreviateBatch(ctx, batch, override)
    if (!byIndex) continue
    for (const { goal, index } of batch) {
      const item = byIndex.get(index)
      if (!item) continue
      const title = String(item.title ?? '').trim()
      // 只接受真正变短的标题；模型又给了超长标题就保持原样。
      if (!title || titleLength(title) > GOAL_TITLE_MAX) continue
      // 优先用模型给的详细说明；没给就把原标题完整保留下来，避免丢信息。
      const detail = (String(item.detail ?? '').trim() || goal.detail || goal.title).slice(0, GOAL_DETAIL_MAX)
      shortened[index] = { ...goal, title, detail }
    }
  }
  return shortened
}

export async function decomposeGoals(ctx, text, { date = dateKeyNow(), override } = {}) {
  const { chunks, truncated, total } = chunkText(text)
  if (!chunks.length) throw new Error('文档里没有可拆解的文字')
  const collected = []
  let partial = false
  for (const [index, chunk] of chunks.entries()) {
    // 跨段的上级：前面的段落已经拆出的目标，用全局序号交给模型引用。
    const offset = collected.length
    const previousBlock = offset
      ? `\n已拆出的目标（parentIndex 可以引用这些全局序号里的目标）：
${collected.map((goal, i) => `${i}｜${goal.title}｜${goal.cycle}`).join('\n')}
本段第一条目标的全局序号是 ${offset}，往后的目标依次 +1。`
      : ''
    const prompt = `今天是 ${date}。
这是文档的第 ${index + 1}/${chunks.length} 段，请只拆解这一段里的目标：${previousBlock}

${chunk}`
    const result = await callModel(ctx, { system: IMPORT_SYSTEM, user: prompt, maxTokens: 8000, override, timeoutMs: 180_000 })
    let parsed = parseGoalsOutput(result.text)
    if (!parsed.ok) {
      // 常见于 maxTokens 被推理占满、JSON 被截断：用更短、更低思考强度的补救请求再要一次。
      const retry = await callModel(ctx, {
        system: `${IMPORT_SYSTEM}
补救规则：只输出一个 JSON 对象，不要解释、不要 markdown；最多 10 条目标，measure 控制在 40 字以内。`,
        user: `今天是 ${date}。
只拆这一段，输出合法 JSON：${previousBlock}

${chunk}`,
        maxTokens: 3000,
        override,
        reasoningEffort: 'low',
      }).catch(() => null)
      if (retry) parsed = parseGoalsOutput(retry.text)
      if (!parsed.ok) {
        const error = new Error(`第 ${index + 1} 段拆解失败：模型这次没有返回可用的 JSON，请再点一次「AI 拆解」`)
        error.raw = String((retry ?? result).text ?? '').slice(0, 20000)
        throw error
      }
    }
    if (parsed.partial) partial = true
    // parentIndex 是全局序号（前面段落的目标 + 本段目标连续编号），合并后可直接当 collected 下标用。
    for (const goal of parsed.goals) {
      const fallback = defaultRange(normalizeCycle(goal.cycle))
      collected.push({
        title: String(goal.title ?? '').trim(),
        cycle: normalizeCycle(goal.cycle),
        startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(goal.startDate)) ? String(goal.startDate) : fallback.startDate,
        endDate: /^\d{4}-\d{2}-\d{2}$/.test(String(goal.endDate)) ? String(goal.endDate) : fallback.endDate,
        measure: String(goal.measure ?? '').trim() || '完成 1 个可验证的结果',
        detail: String(goal.detail ?? '').trim().slice(0, GOAL_DETAIL_MAX),
        parentIndex: Number.isInteger(goal.parentIndex) && goal.parentIndex >= 0 && goal.parentIndex < offset + parsed.goals.length ? goal.parentIndex : null,
      })
    }
  }
  // 去掉空标题时要同步修正 parentIndex。
  const keep = []
  const remap = new Map()
  collected.forEach((goal, i) => { if (goal.title) { remap.set(i, keep.length); keep.push(goal) } })
  const cleaned = keep.map((goal) => ({ ...goal, parentIndex: goal.parentIndex !== null && remap.has(goal.parentIndex) ? remap.get(goal.parentIndex) : null }))
  // 标题仍然过长时自动缩写一次，细节进「详细说明」。
  const shortened = await shortenLongTitles(ctx, cleaned, override)
  return { goals: normalizeImportTree(shortened), truncated, total, partial, model: null }
}

function dateKeyNow() {
  return todayKey()
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

/** 已完成（进度 100 或状态完成）和已过截止日期的目标，不再要进度建议。 */
export function needsProgressSuggestion(goal, today = dateKeyNow()) {
  const progress = Number(goal?.progress)
  if (goal?.paused === true) return false
  if (Number.isFinite(progress) && progress >= 100) return false
  if (['完成', '已完成', 'completed', 'done'].includes(String(goal?.status ?? ''))) return false
  const endDate = String(goal?.endDate ?? '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate < today) return false
  return true
}

/**
 * 把模型给出的进度建议收敛成可执行建议：按目标 id 匹配，
 * 只允许前进，单次最多 +30，并限制在 0-100。
 */
export function refineProgressSuggestions(leaves, items) {
  const byId = new Map((leaves ?? []).map((goal) => [String(goal.id), goal]))
  const suggestions = []
  for (const item of Array.isArray(items) ? items : []) {
    const goal = byId.get(String(item?.goalId))
    if (!goal) continue
    const from = Math.max(0, Math.min(100, Math.round(Number(goal.progress) || 0)))
    const raw = Math.round(Number(item?.progress))
    if (!Number.isFinite(raw)) continue
    const to = Math.max(0, Math.min(100, Math.min(raw, from + 30)))
    if (to <= from) continue
    suggestions.push({
      id: goal.id,
      goalId: goal.id,
      title: goal.title,
      cycle: goal.cycle,
      from,
      to,
      reason: String(item?.reason ?? '').trim().slice(0, 200) || '根据日报和周报的推进',
    })
  }
  return suggestions
}

export async function analyzeReportForGoals(ctx, { markdown, goals, override }) {
  const today = dateKeyNow()
  const reportText = String(markdown ?? '')
  const leaves = goals
    .filter((goal) => !goals.some((item) => item.parentId === goal.id))
    .filter((goal) => needsProgressSuggestion(goal, today))
  if (!leaves.length) return { suggestions: [] }
  const list = leaves.map((goal) => `- id=${goal.id}｜${goal.title}｜衡量：${goal.measure}｜当前 ${goal.progress}%`).join('\n')
  const prompt = `目标列表（只分析叶子目标）：
${list}

当天日报：
${reportText}`
  const result = await callModel(ctx, { system: ANALYZE_SYSTEM, user: prompt, maxTokens: 1500, override })
  const parsed = parseJsonLoosely(result.text)
  const items = Array.isArray(parsed) ? parsed : parsed?.suggestions
  if (!Array.isArray(items)) throw new Error('模型没有返回 suggestions 数组')
  const byId = new Map(leaves.map((goal) => [goal.id, goal]))
  const suggestions = []
  for (const item of items) {
    const goal = byId.get(String(item.goalId))
    if (!goal) continue
    const from = Math.max(0, Math.min(100, Math.round(Number(goal.progress) || 0)))
    const raw = Math.round(Number(item.suggestedProgress))
    if (!Number.isFinite(raw)) continue
    // 代码兜底：单次最多 +30，不能只靠 prompt 约束。
    const to = Math.max(0, Math.min(100, Math.min(raw, from + 30)))
    if (to <= from) continue
    // 依据必须逐字出现在当天日报原文里，编造的直接丢弃。
    const quote = String(item.quote ?? '').trim()
    if (!quote || !reportText.includes(quote)) continue
    suggestions.push({
      id: `${goal.id}-${Date.now().toString(36)}${suggestions.length}`,
      goalId: goal.id,
      goalTitle: goal.title,
      from,
      to,
      reason: String(item.reason ?? '').trim() || '日报显示有推进',
      quote,
      model: result.selection,
      at: new Date().toISOString(),
      status: 'pending',
    })
  }
  return { suggestions, model: result.selection }
}
