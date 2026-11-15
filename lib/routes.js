/** 知行 · HTTP API（页面与调试入口共用） */
import fs from 'node:fs/promises'
import path from 'node:path'
import { buildReportPrompt, callModel, listAvailableModels, recordAiUsage, resolveSelection, REPORT_SYSTEM_PROMPT, selectionLabel } from './ai.js'
import { analyzeReportForGoals, decomposeGoals, parseJsonLoosely } from './goal-ai.js'
import { checkGoalAlerts, createGoal, deleteGoal, recomputeParents, updateGoal, validateGoal } from './goals.js'
import { extractText } from './office.js'
import { deliver } from './reminders.js'
import { applyManualTodos, applyPlanToTodos, DONE_HEADING, parseReport, postponeTodos, setTodoStatus, splitSections, stripSource } from './report.js'
import { collectSessionDigest, sessionPromptBlock } from './sessions.js'
import { DEFAULT_TEMPLATE, fillTemplate, validateTemplate } from './report-html.js'
import { defaultsAsItems, quoteOfDay, readCustomQuotes, writeCustomQuotes } from './quotes.js'
import { addDays, dateKey, nowStamp, parseDateKey } from './store.js'

const MAX_BODY = 40 * 1024 * 1024

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) { reject(new Error('请求体太大（上限 40MB）')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) { resolve({}); return }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (error) { reject(new Error(`请求体不是合法 JSON：${error.message}`)) }
    })
    req.on('error', reject)
  })
}

function emptyCollect(date) {
  return { date, session: null, manual: [], files: [], updatedAt: null }
}

function emptySuggestions() {
  return { version: 1, items: [] }
}

/** 把会话摘要整理成「采集草稿」，供用户在界面上继续编辑。 */
function materialDraft(digest, date) {
  if (!digest?.supported) return `【${date} Harness 会话】\n（${digest?.note ?? '会话日志不可用'}）`
  if (!digest.sessions?.length) return `【${date} Harness 会话】\n（今天没有从 Harness 会话采集到内容）`
  const lines = [`【${date} Harness 会话】`]
  digest.sessions.forEach((session, index) => {
    if (session.error) { lines.push(`- 会话 ${index + 1}：读取失败（${session.error}）`); return }
    lines.push(`- 会话 ${index + 1}${session.cwd ? `（${session.cwd}）` : ''}`)
    if (session.human?.length) lines.push(`  用户指令：${session.human.join(' / ')}`)
    if (session.files?.length) lines.push(`  改动文件：${session.files.slice(0, 12).join('、')}${session.files.length > 12 ? ` 等 ${session.files.length} 个` : ''}`)
    if (session.assistant?.length) lines.push(`  助手结论：${session.assistant[0]}`)
  })
  lines.push('', '（可以继续补充或修改上面的内容，再生成日报）')
  return lines.join('\n')
}

/** 把任意文字收成一条待办标题：第一句、去非法字符、截 40 字。 */
export function todoTitleFrom(text) {
  const raw = String(text ?? '').replace(/\r/g, '').trim()
  if (!raw) return ''
  const first = raw.split(/[。！？!?；;\n]/)[0] || raw
  const cleaned = first
    .replace(/[\\/:*?"<>|\u0000-\u001F\u007F]/g, ' ')
    .replace(/[#*>`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s。！？!?，,、；;：:…\-–—"'“”‘’（）()【】\[\]]+|[\s。！？!?，,、；;：:…\-–—"'“”‘’（）()【】\[\]]+$/g, '')
    .slice(0, 40)
    .trim()
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return ''
  return cleaned
}

function isoWeekKey(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day + 3)
  const firstThursday = new Date(d.getFullYear(), 0, 4)
  const firstDay = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3)
  const week = 1 + Math.round((d - firstThursday) / (7 * 86_400_000))
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`
}

function summaryRange(period, dateStr) {
  const base = parseDateKey(dateStr)
  if (period === 'month') {
    const from = new Date(base.getFullYear(), base.getMonth(), 1)
    const to = new Date(base.getFullYear(), base.getMonth() + 1, 0)
    return { from: dateKey(from), to: dateKey(to), name: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`, label: `${from.getFullYear()} 年 ${from.getMonth() + 1} 月月报` }
  }
  const day = (base.getDay() + 6) % 7
  const monday = new Date(base.getFullYear(), base.getMonth(), base.getDate() - day)
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  return { from: dateKey(monday), to: dateKey(sunday), name: isoWeekKey(base), label: `${isoWeekKey(base)} 周报` }
}

/** 汇总的读者：可选的读者描述只影响提示词，不改变数据。 */
export function cleanAudience(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)
}

function summarySystemPrompt({ title, period, audience }) {
  const unit = period === 'month' ? '月' : '周'
  const base = `你是「知行」的${title}汇总器。基于下面的日报生成一份中文${title}。只输出 Markdown，不要代码围栏。格式：
## 概览
## 关键进展
## 风险与问题
## ${period === 'month' ? '下月计划' : '下周计划'}
规则：每条进展后用（来源：MM-DD）标日期；概览 1-2 句；关键进展 3-8 条；没有风险整节省略；计划 3-5 条。`
  if (!audience) return base
  if (/^自己/.test(audience)) {
    return `你是「知行」的${title}复盘器，读者是作者本人，用于自我复盘，不是向上汇报。只输出 Markdown，不要代码围栏。结构：
## 时间花在哪儿
## 拖延与卡住的事
## 下${unit}怎么调整
规则：语气自然、诚实，可以直接写感受和判断；每条尽量用（来源：MM-DD）标日期；没有内容的整节省略。`
  }
  if (/^团队/.test(audience)) {
    return `你是「知行」的${title}汇总器，读者是团队成员，要详细、可核对。只输出 Markdown，不要代码围栏。结构：
## ${period === 'month' ? '本月' : '本周'}进展
按目标分组：每组先一句结论，再列具体产出（尽量用目标标题做小标题）。
## 阻塞与风险
## 需要对齐的事
规则：每条用（来源：MM-DD）标日期；没有内容的整节省略。`
  }
  if (/^上级/.test(audience)) {
    return `你是「知行」的${title}汇总器，读者是上级，要极简。只输出 Markdown，不要代码围栏。
要求：3-5 行，最多 5 条 bullet；只写「成果 / 风险 / 需要的支持」；不要小标题，不要长篇。
每条用（来源：MM-DD）标日期。`
  }
  return `你是「知行」的${title}汇总器，读者是「${audience}」。只输出 Markdown，不要代码围栏。
按这位读者最关心的成果、风险、需要支持来组织；3-8 条，每条用（来源：MM-DD）标日期。`
}

/** 汇总的多版本字段：只接受 0-8 个 { audience, content, aiGenerated }。 */
export function normalizeVersions(input) {
  if (!Array.isArray(input)) return null
  const items = []
  for (const item of input.slice(0, 8)) {
    const audience = cleanAudience(item?.audience)
    const content = String(item?.content ?? '').trim().slice(0, 20_000)
    if (!audience || !content) continue
    items.push({ audience, content, aiGenerated: item?.aiGenerated === true })
  }
  return items
}

const TAG_STOPWORDS = new Set(['完成', '目标', '衡量', '方式', '一个', '交付', '通过', '用户', '结果'])

function goalTokens(goal) {
  const text = `${goal.title ?? ''} ${goal.measure ?? ''}`
  const tokens = new Set()
  for (const run of text.match(/[\u4e00-\u9fa5]{2,}/g) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const gram = run.slice(i, i + 2)
      if (!TAG_STOPWORDS.has(gram)) tokens.add(gram)
    }
  }
  for (const word of text.match(/[a-zA-Z]{3,}/g) ?? []) tokens.add(word.toLowerCase())
  return [...tokens]
}

/** 根据日报正文猜关联目标（本地匹配，不调用模型）。 */
export function matchGoals(markdown, goals) {
  if (!goals.length) return []
  const text = String(markdown ?? '').toLowerCase()
  const scored = []
  for (const goal of goals) {
    let score = 0
    if (goal.title && text.includes(String(goal.title).toLowerCase())) score += 8
    for (const token of goalTokens(goal)) {
      if (text.includes(token)) score += token.length >= 3 ? 3 : 1
    }
    if (score > 0) scored.push({ id: goal.id, score })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 3).map((item) => item.id)
}

/** 去掉一行开头的列表 / 标题标记，剩余部分仍是原文里的连续片段。 */
function evidenceLine(line) {
  const raw = String(line ?? '').trim()
  const stripped = raw.replace(/^#{1,6}\s+/, '').replace(/^(?:[-*+]|\d+[.)])\s+/, '').trim()
  return stripped || raw
}

/**
 * 把 matchGoals 的结果摊开成「目标 + 把握度 + 依据原句」。
 * 只用本地匹配，不调用模型；依据必须能在日报原文里逐字找到，否则丢弃。
 */
export function goalSuggestions(markdown, goals) {
  const text = String(markdown ?? '')
  if (!text.trim() || !goals.length) return []
  const ids = matchGoals(text, goals)
  if (!ids.length) return []
  const lower = text.toLowerCase()
  const lines = text.split(/\r?\n/)
  const doneLines = String(splitSections(text).get(DONE_HEADING) ?? '').split(/\r?\n/)
  const items = []
  for (const id of ids) {
    const goal = goals.find((item) => item.id === id)
    if (!goal) continue
    const title = String(goal.title ?? '').trim()
    let score = 0
    let keyword = ''
    const matchedTitle = Boolean(title) && lower.includes(title.toLowerCase())
    const matchedTokens = []
    if (matchedTitle) { score += 8; keyword = title }
    for (const token of goalTokens(goal)) {
      if (!lower.includes(token)) continue
      score += token.length >= 3 ? 3 : 1
      // 记录命中次数：跨词边界的 2 字 gram 偶尔更「显眼」，用出现次数把它压下去。
      matchedTokens.push({ token, count: lower.split(token).length - 1 })
    }
    if (!keyword) {
      const inDone = (token) => doneLines.some((line) => line.toLowerCase().includes(token))
      const best = matchedTokens
        .map((item) => ({ ...item, done: inDone(item.token) }))
        .sort((a, b) => (Number(b.done) - Number(a.done)) || (b.count - a.count) || (b.token.length - a.token.length))[0]
      if (best) keyword = best.token
    }
    if (!keyword) continue
    // 依据行：优先「今天干了什么」里的原句，其次任意一行；命中目标词越多越优先。
    const tokenList = matchedTokens.map((item) => item.token.toLowerCase())
    const lineHits = (line) => {
      const value = line.toLowerCase()
      let hits = tokenList.reduce((count, token) => count + (value.includes(token) ? 1 : 0), 0)
      if (matchedTitle && value.includes(title.toLowerCase())) hits += 100
      return hits
    }
    const pickLine = (list) => list
      .map((line, index) => ({ line, index, hits: lineHits(line) }))
      .filter((item) => item.hits > 0 && item.line.toLowerCase().includes(keyword.toLowerCase()))
      .sort((a, b) => b.hits - a.hits || a.index - b.index)[0]?.line
    const quoteLine = pickLine(doneLines) ?? pickLine(lines)
    if (!quoteLine) continue
    const quote = evidenceLine(quoteLine)
    if (!quote || !text.includes(quote)) continue
    items.push({
      goalId: goal.id,
      goalTitle: goal.title,
      cycle: goal.cycle,
      confidence: score >= 8 ? '高' : score >= 3 ? '中' : '低',
      score,
      keyword,
      quote,
      reason: matchedTitle ? `日报里出现了目标标题「${title}」` : `日报里出现了关键词「${keyword}」`,
    })
  }
  return items.slice(0, 3)
}

let weatherCache = { ts: 0, key: '', data: null }

function cityFromTimezone(tz) {
  const text = String(tz ?? '').trim()
  if (!text) return ''
  const last = text.split('/').pop() ?? ''
  return last.replace(/_/g, ' ').trim()
}

async function currentWeather(city = '', timezone = '') {
  const key = String(city ?? '').trim() || cityFromTimezone(timezone)
  if (weatherCache.data && weatherCache.key === key && Date.now() - weatherCache.ts < 30 * 60_000) return weatherCache.data
  try {
    const target = key ? `https://wttr.in/${encodeURIComponent(key)}` : 'https://wttr.in/'
    const response = await fetch(`${target}?format=%c+%t&m&lang=zh`, {
      headers: { 'user-agent': 'curl/8.7' },
      signal: AbortSignal.timeout(10_000),
    })
    const text = (await response.text()).trim()
    if (!response.ok || !text || text.length > 200) throw new Error('天气服务返回异常')
    const data = { ok: true, text, city: key }
    weatherCache = { ts: Date.now(), key, data }
    return data
  } catch (error) {
    const data = { ok: false, error: error instanceof Error ? error.message : String(error) }
    weatherCache = { ts: Date.now(), key, data }
    return data
  }
}

function parseSummaryRange(name) {
  const month = /^(\d{4})-(\d{2})$/.exec(name)
  if (month) {
    const year = Number(month[1])
    const index = Number(month[2]) - 1
    return { from: dateKey(new Date(year, index, 1)), to: dateKey(new Date(year, index + 1, 0)), kind: '月报' }
  }
  const week = /^(\d{4})-W(\d{2})$/.exec(name)
  if (week) {
    const year = Number(week[1])
    const weekNo = Number(week[2])
    const jan4 = new Date(year, 0, 4)
    const monday = new Date(jan4.getFullYear(), jan4.getMonth(), jan4.getDate() - ((jan4.getDay() + 6) % 7) + (weekNo - 1) * 7)
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
    return { from: dateKey(monday), to: dateKey(sunday), kind: '周报' }
  }
  return null
}

function stripHtml(text) {
  return String(text ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

async function readHiddenQuotes(store) {
  try {
    const data = JSON.parse(await fs.readFile(store.p('语录', '隐藏.json'), 'utf8'))
    return Array.isArray(data.ids) ? data.ids : []
  } catch { return [] }
}

async function writeHiddenQuotes(store, ids) {
  await fs.mkdir(store.p('语录'), { recursive: true })
  await fs.writeFile(store.p('语录', '隐藏.json'), `${JSON.stringify({ ids }, null, 2)}\n`, 'utf8')
}

export function createRoutes({ ctx, store, reminders, config }) {
  const api = config.apiPrefix || '/api/zhixing'
  const dataDir = store.root

  async function loadCollect(date) {
    return (await store.readCollect(date)) ?? emptyCollect(date)
  }

  async function readReportMeta() {
    const data = await store.readJson('reportMeta', { version: 1, items: {} })
    return data?.items && typeof data.items === 'object' ? data : { version: 1, items: {} }
  }

  async function reportTagIds(date) {
    const meta = await readReportMeta()
    return Array.isArray(meta.items[date]?.goalIds) ? meta.items[date].goalIds : []
  }

  async function writeReportTagIds(date, goalIds) {
    await store.update('reportMeta', { version: 1, items: {} }, (current) => {
      current.items = current.items ?? {}
      current.items[date] = { ...(current.items[date] ?? {}), goalIds, updatedAt: nowStamp() }
      return current
    })
  }

  /** 日报 / 汇总的来源与最后修改时间（与 goalIds 共用 reportMeta.items[key]）。 */
  async function patchReportMeta(key, patch) {
    await store.update('reportMeta', { version: 1, items: {} }, (current) => {
      current.items = current.items ?? {}
      current.items[key] = { ...(current.items[key] ?? {}), ...patch }
      return current
    })
  }

  async function reportMetaOf(key) {
    const meta = await readReportMeta()
    return meta.items?.[key] ?? {}
  }

  function reportSourceInfo(meta) {
    return {
      source: meta?.source === 'AI' ? 'AI' : meta?.source === '人工' ? '人工' : null,
      model: meta?.model ? String(meta.model) : null,
      updatedAt: meta?.updatedAt ? String(meta.updatedAt) : null,
    }
  }

  function tagsOf(goalIds, goals) {
    return goalIds
      .map((id) => goals.find((goal) => goal.id === id))
      .filter(Boolean)
      .map((goal) => ({ id: goal.id, title: goal.title, cycle: goal.cycle }))
  }

  async function loadSuggestions() {
    const data = await store.readJson('suggestions', emptySuggestions())
    return Array.isArray(data.items) ? data.items.filter((item) => item.status === 'pending') : []
  }

  async function tailLog(lines) {
    try {
      const raw = await fs.readFile(store.p('log.md'), 'utf8')
      return raw.trim().split('\n').slice(-lines)
    } catch { return [] }
  }

  function syntheticNow(body, fallbackAt) {
    const date = String(body.date || dateKey())
    const at = String(body.at || fallbackAt)
    const [y, m, d] = date.split('-').map(Number)
    const [hh, mm] = at.split(':').map(Number)
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return new Date()
    return new Date(y, m - 1, d, Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0)
  }

  async function overrideOf() {
    const settings = await store.getSettings()
    return settings.modelOverride ?? undefined
  }

  async function collectFromSessions(date) {
    return collectSessionDigest(ctx, { date })
  }

  async function analyzeAfterSave(date, markdown) {
    const settings = await store.getSettings()
    const goals = await store.listGoalItems()
    if (!goals.length) return
    await recordAiUsage(store)
    try {
      const result = await analyzeReportForGoals(ctx, { markdown, goals, override: settings.modelOverride })
      if (!result.suggestions.length) {
        await store.appendLog('AI 进度分析', `没有可建议的推进（${date}）`)
        return
      }
      await store.update('suggestions', emptySuggestions(), (current) => {
        current.items = [...(current.items ?? []).filter((item) => item.status === 'pending'), ...result.suggestions]
        return current
      })
      await store.appendLog('AI 进度建议', `${result.suggestions.length} 条（${date}）`)
    } catch (error) {
      await store.appendLog('AI 进度分析', `失败：${error.message}`)
    }
  }

  async function buildState(query) {
    const date = String(query.get('date') || dateKey())
    const settings = await store.getSettings()
    const [items, collect, report, state, goals, suggestions, meta] = await Promise.all([
      store.listTodoItems(), loadCollect(date), store.readReport(date), store.getState(), store.listGoalItems(), loadSuggestions(), readReportMeta(),
    ])
    const today = dateKey()
    const overdue = items.filter((todo) => todo.status !== '完成' && todo.date < today)
    const todays = items.filter((todo) => todo.date === today)
    const upcoming = items
      .filter((todo) => todo.status !== '完成' && todo.date > today)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .slice(0, 50)
    const todos = [...overdue, ...todays]
    const unfinished = items.filter((todo) => todo.date < today && todo.status === '未做')
    const sent = state.reminders?.[date] ?? {}
    const quotaUsed = Number(state.aiUsage?.[date] ?? 0)
    let model = null
    try { model = selectionLabel(resolveSelection(ctx, settings.modelOverride)) } catch { model = null }
    return {
      ok: true,
      date,
      today: dateKey(),
      tomorrow: addDays(date, 1),
      todos,
      upcoming,
      unfinished,
      reportExists: report !== null,
      reportTags: tagsOf(Array.isArray(meta.items?.[date]?.goalIds) ? meta.items[date].goalIds : [], goals),
      reportPreview: report ? report.slice(0, 20_000) : null,
      collect: {
        session: collect.session ? {
          supported: collect.session.supported,
          scanned: collect.session.scanned,
          sessions: collect.session.sessions?.length ?? 0,
          workspaces: collect.session.workspaces ?? [],
          note: collect.session.note,
          updatedAt: collect.updatedAt,
        } : null,
        manual: collect.manual,
        files: (collect.files ?? []).map((file) => ({ name: file.name, via: file.via, chars: file.text?.length ?? 0 })),
        materialText: collect.materialText ?? null,
      },
      settings,
      quota: { used: quotaUsed },
      reminders: { morning: Boolean(sent.morning), evening: Boolean(sent.evening) },
      model,
      ai: await (async () => {
        try {
          const selection = resolveSelection(ctx, settings.modelOverride)
          return { available: Boolean(selection?.provider && selection?.model), model: selectionLabel(selection), reason: null }
        } catch (error) {
          return { available: false, model: null, reason: error instanceof Error ? error.message : String(error) }
        }
      })(),
      modelOverride: settings.modelOverride ?? null,
      goals: {
        total: goals.length,
        byCycle: {
          周: goals.filter((goal) => goal.cycle === '周').length,
          月: goals.filter((goal) => goal.cycle === '月').length,
          年: goals.filter((goal) => goal.cycle === '年').length,
        },
      },
      suggestions: suggestions.length,
      goalAlerts: state.goalAlerts?.[dateKey()] ?? {},
      logTail: await tailLog(30),
    }
  }

  async function handle(req, res, suffix, url) {
    await store.init()
    const method = req.method ?? 'GET'

    if (method === 'GET' && (suffix === '/' || suffix === '/health')) {
      json(res, 200, { ok: true, name: '知行', dataDir, date: dateKey(), time: nowStamp() })
      return
    }

    if (method === 'GET' && suffix === '/state') {
      json(res, 200, await buildState(url.searchParams))
      return
    }

    if (method === 'GET' && suffix === '/models') {
      const settings = await store.getSettings()
      let models = []
      let current = null
      try { current = resolveSelection(ctx, settings.modelOverride) } catch { current = null }
      try { models = await listAvailableModels(ctx) } catch (error) { models = [] }
      json(res, 200, {
        ok: true,
        models,
        override: settings.modelOverride ?? null,
        current: current ? { label: selectionLabel(current), ...current } : null,
      })
      return
    }

    if (method === 'GET' && suffix === '/todos') {
      const date = String(url.searchParams.get('date') || dateKey())
      // 可选：from/to 按日期范围取（日历月/周视图用），不传时保持原按单日取的行为。
      const from = String(url.searchParams.get('from') ?? '')
      const to = String(url.searchParams.get('to') ?? '')
      const ranged = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)
      const items = (await store.listTodoItems()).filter((todo) => ranged
        ? todo.date >= from && todo.date <= to
        : todo.date === date)
      json(res, 200, { ok: true, date, ...(ranged ? { from, to } : {}), todos: items })
      return
    }

    if (method === 'POST' && suffix === '/todos/quick-add') {
      const body = await readBody(req)
      const title = todoTitleFrom(body.text)
      if (!title) { json(res, 400, { ok: false, error: '选中的内容里没有可用的待办标题' }); return }
      const today = dateKey()
      let created = null
      await store.update('todos', { version: 1, items: [] }, (todos) => {
        todos.items = Array.isArray(todos.items) ? todos.items : []
        const names = new Set(todos.items.map((todo) => todo.content))
        let content = title
        let index = 2
        while (names.has(content)) { content = `${title}-${index}`; index += 1 }
        created = {
          id: `t-${today.replace(/-/g, '')}-${Date.now().toString(36).slice(-4)}${String(index).padStart(2, '0')}`,
          content,
          date: today,
          startDate: today,
          dueDate: today,
          source: String(body.source ?? '快捷添加'),
          status: '未做',
          goalId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        todos.items.push(created)
        return todos
      })
      await store.refreshOverview()
      await store.appendLog('加入搭子待办', `${created.content}（${created.source}）`)
      json(res, 200, { ok: true, todo: created })
      return
    }

    if (method === 'GET' && suffix === '/report') {
      const date = String(url.searchParams.get('date') || dateKey())
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { json(res, 400, { ok: false, error: `日期格式不对（应为 YYYY-MM-DD，收到「${date}」）` }); return }
      const markdown = await store.readReport(date)
      const goals = await store.listGoalItems()
      const tags = tagsOf(await reportTagIds(date), goals)
      let mtime = 0
      try { mtime = (await fs.stat(store.reportPath(date))).mtimeMs } catch { mtime = 0 }
      json(res, 200, {
        ok: true, date, exists: markdown !== null, markdown, tags, goalIds: tags.map((tag) => tag.id),
        ...reportSourceInfo(await reportMetaOf(date)), mtime,
      })
      return
    }

    if (method === 'POST' && suffix === '/report/tags') {
      const body = await readBody(req)
      const date = String(body.date || dateKey())
      const goals = await store.listGoalItems()
      const ids = Array.isArray(body.goalIds) ? [...new Set(body.goalIds.map(String))] : []
      const valid = ids.filter((id) => goals.some((goal) => goal.id === id))
      await writeReportTagIds(date, valid)
      await store.appendLog('更新日报关联目标', `${date} → ${valid.length} 个`)
      json(res, 200, { ok: true, date, tags: tagsOf(valid, goals), goalIds: valid })
      return
    }

    // 可选：按日报正文给出「建议关联」的目标（本地匹配，不调模型、不写数据）。
    if (method === 'POST' && suffix === '/report/goal-suggestions') {
      const body = await readBody(req)
      const markdown = String(body.markdown ?? '')
      if (!markdown.trim()) { json(res, 200, { ok: true, suggestions: [], model: null }); return }
      const goals = await store.listGoalItems()
      json(res, 200, { ok: true, suggestions: goalSuggestions(markdown, goals), model: null })
      return
    }

    if (method === 'POST' && suffix === '/report/delete') {
      const body = await readBody(req)
      const date = String(body.date || dateKey())
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { json(res, 400, { ok: false, error: '日期格式不对' }); return }
      let removed = false
      try { await fs.unlink(store.reportPath(date)); removed = true } catch { removed = false }
      await store.update('reportMeta', { version: 1, items: {} }, (current) => {
        current.items = current.items ?? {}
        delete current.items[date]
        return current
      })
      if (removed) await store.appendLog('删除日报', `${date}.md`)
      json(res, 200, { ok: true, date, removed })
      return
    }

    if (method === 'GET' && suffix === '/reports') {
      let entries = []
      try { entries = await fs.readdir(store.p('日报')) } catch { entries = [] }
      const reports = []
      const goals = await store.listGoalItems()
      const meta = await readReportMeta()
      for (const name of entries) {
        const match = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(name)
        if (!match) continue
        let stat = null
        let content = ''
        try {
          stat = await fs.stat(store.p('日报', name))
          content = await fs.readFile(store.p('日报', name), 'utf8')
        } catch { /* 忽略 */ }
        const parsed = parseReport(content)
        const done = parsed.done.map(stripSource).filter(Boolean)
        const tagIds = Array.isArray(meta.items?.[match[1]]?.goalIds) ? meta.items[match[1]].goalIds : []
        reports.push({
          kind: '日报',
          date: match[1],
          name: match[1],
          dateLabel: match[1],
          size: stat?.size ?? 0,
          mtime: stat?.mtimeMs ?? 0,
          title: (done[0] ?? `${match[1]} 日报`).slice(0, 70),
          summary: done.slice(1, 3).join('；').slice(0, 120),
          done: done.length,
          plan: parsed.plan.length,
          goalIds: tagIds,
          goalTags: tagsOf(tagIds, goals),
          goalTitles: tagsOf(tagIds, goals).map((tag) => tag.title),
          ...reportSourceInfo(meta.items?.[match[1]]),
        })
      }
      let summaries = []
      try { summaries = await fs.readdir(store.p('汇总')) } catch { summaries = [] }
      for (const file of summaries) {
        if (!file.endsWith('.md')) continue
        const name = file.replace(/\.md$/, '')
        const kind = /^\d{4}-W\d{2}$/.test(name) ? '周报' : /^\d{4}-\d{2}$/.test(name) ? '月报' : '汇总'
        let stat = null
        let content = ''
        try {
          stat = await fs.stat(store.summaryPath(file))
          content = await fs.readFile(store.summaryPath(file), 'utf8')
        } catch { /* 忽略 */ }
        const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        const titleLine = lines.find((line) => !line.startsWith('#') && !line.startsWith('-')) ?? lines[0] ?? name
        const info = reportSourceInfo(meta.items?.[name])
        const customMatch = /^custom-(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(name)
        const range = parseSummaryRange(name) ?? (customMatch ? { from: customMatch[1], to: customMatch[2] } : null)
        const dateLabel = range ? `${range.from.slice(5)} ~ ${range.to.slice(5)}` : name
        reports.push({
          kind, date: name, name, dateLabel, summaryKind: kind,
          size: stat?.size ?? 0, mtime: stat?.mtimeMs ?? 0,
          title: titleLine.replace(/^[-#*\s]+/, '').slice(0, 70),
          summary: '', done: 0, plan: 0,
          goalIds: [], goalTags: [], goalTitles: [],
          ...info, source: info.source ?? 'AI',
        })
      }
      reports.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0))
      json(res, 200, { ok: true, reports })
      return
    }

    if (method === 'GET' && suffix === '/reports/summary') {
      const period = url.searchParams.get('period') === 'month' ? 'month' : 'week'
      const date = String(url.searchParams.get('date') || dateKey())
      const range = summaryRange(period, date)
      const reports = []
      for (let cursor = range.from; cursor <= range.to; cursor = addDays(cursor, 1)) {
        const markdown = await store.readReport(cursor)
        if (markdown) reports.push({ date: cursor, markdown })
      }
      const text = reports.map((item) => `### ${item.date}\n${item.markdown}`).join('\n\n').slice(0, 24_000)
      json(res, 200, { ok: true, period, range, reports, text })
      return
    }

    if (method === 'POST' && suffix === '/reports/summary/generate') {
      const body = await readBody(req)
      const period = body.period === 'month' ? 'month' : 'week'
      const date = String(body.date || dateKey())
      const audience = cleanAudience(body.audience)
      const custom = body.custom === true && /^\d{4}-\d{2}-\d{2}$/.test(String(body.from ?? '')) && /^\d{4}-\d{2}-\d{2}$/.test(String(body.to ?? ''))
      if (custom && String(body.from) > String(body.to)) { json(res, 400, { ok: false, error: '开始日期不能晚于结束日期' }); return }
      const range = custom
        ? { from: String(body.from), to: String(body.to), name: `custom-${body.from}_${body.to}`, label: `${body.from} ~ ${body.to} 汇总` }
        : summaryRange(period, date)
      const settings = await store.getSettings()
      const chunks = []
      for (let cursor = range.from; cursor <= range.to; cursor = addDays(cursor, 1)) {
        const markdown = await store.readReport(cursor)
        if (markdown) chunks.push(`### ${cursor}\n${markdown}`)
      }
      if (!chunks.length) { json(res, 400, { ok: false, error: `${range.from} ~ ${range.to} 之间没有日报` }); return }
      await recordAiUsage(store)
      const title = period === 'month' ? '月报' : '周报'
      const system = summarySystemPrompt({ title, period, audience })
      let goalBlock = ''
      if (/^团队/.test(audience)) {
        const goals = await store.listGoalItems()
        if (goals.length) {
          goalBlock = `\n\n目标列表（只用于分组，不要逐条复述）：\n${goals.slice(0, 40).map((goal) => `- ${goal.title}（${goal.cycle}）`).join('\n')}`
        }
      }
      try {
        const user = `周期：${range.from} ~ ${range.to}${audience ? `\n读者：${audience}` : ''}\n\n${chunks.join('\n\n').slice(0, 24_000)}${goalBlock}`
        const result = await callModel(ctx, { system, user, maxTokens: 3000, override: settings.modelOverride })
        await store.appendLog('AI 汇总', `${title} ${range.name}${audience ? ` · ${audience}` : ''}（${selectionLabel(result.selection)}）`)
        json(res, 200, { ok: true, period, range, ...(audience ? { audience } : {}), markdown: result.text, model: selectionLabel(result.selection) })
      } catch (error) {
        await store.appendLog('AI 汇总', `失败：${error.message}`)
        json(res, 502, { ok: false, error: error.message })
      }
      return
    }

    if (method === 'GET' && suffix === '/reports/summaries') {
      let files = []
      try { files = await fs.readdir(store.p('汇总')) } catch { files = [] }
      const items = []
      for (const name of files) {
        if (!name.endsWith('.md')) continue
        let stat = null
        try { stat = await fs.stat(store.summaryPath(name)) } catch { /* 忽略 */ }
        items.push({ name: name.replace(/\.md$/, ''), mtime: stat?.mtimeMs ?? 0, size: stat?.size ?? 0 })
      }
      items.sort((a, b) => b.mtime - a.mtime)
      json(res, 200, { ok: true, summaries: items })
      return
    }

    if (method === 'GET' && suffix === '/reports/summary/read') {
      const raw = path.basename(String(url.searchParams.get('name') || '')).replace(/\.md$/, '')
      if (!raw) { json(res, 400, { ok: false, error: '缺少名称' }); return }
      let markdown = ''
      try { markdown = await fs.readFile(store.summaryPath(`${raw}.md`), 'utf8') }
      catch { json(res, 404, { ok: false, error: '汇总不存在' }); return }
      const goals = await store.listGoalItems()
      const range = parseSummaryRange(raw)
      const tags = []
      if (range) {
        const meta = await readReportMeta()
        const ids = new Set()
        for (let cursor = range.from; cursor <= range.to; cursor = addDays(cursor, 1)) {
          for (const id of meta.items?.[cursor]?.goalIds ?? []) ids.add(id)
        }
        tags.push(...tagsOf([...ids], goals))
      }
      const meta = await reportMetaOf(raw)
      const info = reportSourceInfo(meta)
      const versions = Array.isArray(meta.versions) && meta.versions.length ? meta.versions : null
      let mtime = 0
      try { mtime = (await fs.stat(store.summaryPath(`${raw}.md`))).mtimeMs } catch { mtime = 0 }
      json(res, 200, { ok: true, name: raw, markdown, tags, kind: range?.kind ?? '汇总', range, ...info, source: info.source ?? 'AI', ...(versions ? { versions } : {}), mtime })
      return
    }

    if (method === 'POST' && suffix === '/reports/summary/update') {
      const body = await readBody(req)
      const name = path.basename(String(body.name || '')).replace(/\.md$/, '')
      const markdown = String(body.markdown ?? '').trim()
      if (!name) { json(res, 400, { ok: false, error: '缺少名称' }); return }
      if (!markdown) { json(res, 400, { ok: false, error: '内容为空' }); return }
      await fs.mkdir(store.p('汇总'), { recursive: true })
      await fs.writeFile(store.summaryPath(`${name}.md`), `${markdown}\n`, 'utf8')
      const existing = await reportMetaOf(name)
      const source = body.source === 'AI' ? 'AI' : body.source === '人工' ? '人工' : existing.source ?? null
      const model = body.source === 'AI' ? String(body.model ?? existing.model ?? '') : existing.model ?? null
      await patchReportMeta(name, { source, model, updatedAt: nowStamp() })
      await store.appendLog('保存汇总', `${name}.md`)
      json(res, 200, { ok: true, name, markdown, ...reportSourceInfo({ source, model }) })
      return
    }

    if (method === 'POST' && suffix === '/reports/summary/delete') {
      const body = await readBody(req)
      const name = path.basename(String(body.name || '')).replace(/\.md$/, '')
      let removed = false
      try { await fs.unlink(store.summaryPath(`${name}.md`)); removed = true } catch { removed = false }
      if (removed) {
        await store.update('reportMeta', { version: 1, items: {} }, (current) => {
          if (current.items) delete current.items[name]
          return current
        })
        await store.appendLog('删除汇总', `${name}.md`)
      }
      json(res, 200, { ok: true, name, removed })
      return
    }

    if (method === 'GET' && suffix === '/reports/summary/html') {
      const raw = path.basename(String(url.searchParams.get('name') || '')).replace(/\.md$/, '')
      let markdown = ''
      try { markdown = await fs.readFile(store.summaryPath(`${raw}.md`), 'utf8') }
      catch { json(res, 404, { ok: false, error: '汇总不存在' }); return }
      // 可选版本：多版本汇总复制 / 导出 / HTML 预览时指定第几个版本。
      const versionRaw = url.searchParams.get('version')
      if (versionRaw !== null && versionRaw !== '') {
        const index = Number(versionRaw)
        const meta = await reportMetaOf(raw)
        const versions = Array.isArray(meta.versions) ? meta.versions : []
        if (Number.isInteger(index) && index >= 0 && versions[index]?.content) markdown = versions[index].content
      }
      const template = await store.readTemplate()
      const goals = await store.listGoalItems()
      const range = parseSummaryRange(raw)
      const ids = new Set()
      if (range) {
        const meta = await readReportMeta()
        for (let cursor = range.from; cursor <= range.to; cursor = addDays(cursor, 1)) {
          for (const id of meta.items?.[cursor]?.goalIds ?? []) ids.add(id)
        }
      }
      const tags = tagsOf([...ids], goals)
      const html = fillTemplate(template, {
        markdown, date: raw, title: `${raw} ${range?.kind ?? '汇总'}`,
        tags: tags.map((tag) => tag.title),
      })
      json(res, 200, { ok: true, name: raw, html, tags })
      return
    }

    if (method === 'POST' && suffix === '/reports/summary/save') {
      const body = await readBody(req)
      const markdown = String(body.markdown ?? '').trim()
      const versions = normalizeVersions(body.versions)
      const primary = versions?.length ? versions[0].content : markdown
      const custom = body.custom === true && /^\d{4}-\d{2}-\d{2}$/.test(String(body.from ?? '')) && /^\d{4}-\d{2}-\d{2}$/.test(String(body.to ?? ''))
      if (custom && String(body.from) > String(body.to)) { json(res, 400, { ok: false, error: '开始日期不能晚于结束日期' }); return }
      const name = path.basename(String(body.name || (custom ? `custom-${body.from}_${body.to}` : summaryRange(body.period === 'month' ? 'month' : 'week', String(body.date || dateKey())).name)))
      if (!primary) { json(res, 400, { ok: false, error: '汇总内容为空' }); return }
      const file = store.summaryPath(`${name}.md`)
      await fs.mkdir(store.p('汇总'), { recursive: true })
      // 文件始终保存默认（第一个）版本，旧代码 / 导出 / HTML 预览不受影响。
      await fs.writeFile(file, `${primary}\n`, 'utf8')
      const existing = await reportMetaOf(name)
      const source = body.source === 'AI' ? 'AI' : body.source === '人工' ? '人工' : existing.source ?? null
      const model = body.source === 'AI' ? String(body.model ?? existing.model ?? '') : existing.model ?? null
      await store.update('reportMeta', { version: 1, items: {} }, (current) => {
        current.items = current.items ?? {}
        const entry = { ...(current.items[name] ?? {}), source, model, updatedAt: nowStamp() }
        if (versions !== null) {
          if (versions.length) entry.versions = versions
          else delete entry.versions
        }
        current.items[name] = entry
        return current
      })
      await store.appendLog('保存汇总', `${name}.md${versions?.length ? `，${versions.length} 个版本` : ''}`)
      json(res, 200, { ok: true, name, file, ...reportSourceInfo({ source, model }) })
      return
    }

    if (method === 'GET' && suffix === '/report/html') {
      const date = String(url.searchParams.get('date') || dateKey())
      const markdown = await store.readReport(date)
      if (markdown === null) { json(res, 404, { ok: false, error: '这一天还没有日报' }); return }
      const template = await store.readTemplate()
      const goals = await store.listGoalItems()
      const tags = tagsOf(await reportTagIds(date), goals)
      const html = fillTemplate(template, {
        markdown, date, title: url.searchParams.get('title') || `${date} 工作日报`,
        tags: tags.map((tag) => tag.title),
      })
      json(res, 200, { ok: true, date, html, tags })
      return
    }

    if (method === 'GET' && suffix === '/report/template') {
      const template = await store.readTemplate()
      json(res, 200, { ok: true, template, isDefault: template.trim() === DEFAULT_TEMPLATE.trim(), placeholder: '{{content}}' })
      return
    }

    if (method === 'POST' && suffix === '/report/template') {
      const body = await readBody(req)
      const text = validateTemplate(body.template)
      await store.writeTemplate(text)
      await store.appendLog('更新日报模板', `长度 ${text.length}`)
      json(res, 200, { ok: true, template: text, isDefault: false })
      return
    }

    if (method === 'POST' && suffix === '/report/template/reset') {
      try {
        const { text, backup } = await store.resetTemplate()
        await store.appendLog('更新日报模板', `恢复默认模板${backup ? `（已备份为 ${backup}）` : ''}`)
        json(res, 200, { ok: true, template: text, isDefault: true, backup })
      } catch (error) {
        if (error?.code === 'TEMPLATE_BACKUP_FAILED') {
          await store.appendLog('更新日报模板', '恢复默认失败：备份失败，未重置')
          json(res, 500, { ok: false, error: '备份失败，未重置' })
          return
        }
        throw error
      }
      return
    }

    if (method === 'POST' && suffix === '/report/template/upload') {
      const body = await readBody(req)
      const buffer = Buffer.from(String(body.dataBase64 ?? ''), 'base64')
      if (!buffer.length) { json(res, 400, { ok: false, error: '文件为空' }); return }
      const text = validateTemplate(buffer.toString('utf8'))
      json(res, 200, { ok: true, template: text, name: String(body.name ?? 'template.html') })
      return
    }

    if (method === 'POST' && suffix === '/report/template/ai') {
      const body = await readBody(req)
      const prompt = String(body.prompt ?? '').trim()
      if (!prompt) { json(res, 400, { ok: false, error: '请填写修改要求' }); return }
      const settings = await store.getSettings()
      await recordAiUsage(store)
      const current = String(body.template ?? (await store.readTemplate()))
      try {
        const result = await callModel(ctx, {
          system: '你是 HTML 模板设计器。只输出完整的 HTML 文档，不要代码围栏，不要解释。必须保留占位符 {{content}}，可另外使用 {{title}}、{{date}}、{{generatedAt}}。样式内联在 <style> 中，不使用外部资源、脚本或远程字体，适合 A4 打印与截图。',
          user: `当前模板：\n${current.slice(0, 12_000)}\n\n修改要求：${prompt}`,
          maxTokens: 4000,
          override: settings.modelOverride,
        })
        const text = result.text.replace(/^```(?:html)?/i, '').replace(/```$/, '').trim()
        validateTemplate(text)
        await store.appendLog('AI 修改模板', `${prompt.slice(0, 40)}（${selectionLabel(result.selection)}）`)
        json(res, 200, { ok: true, template: text, model: selectionLabel(result.selection) })
      } catch (error) {
        await store.appendLog('AI 修改模板', `失败：${error.message}`)
        json(res, 502, { ok: false, error: error.message })
      }
      return
    }

    if (method === 'GET' && suffix === '/collect') {
      const date = String(url.searchParams.get('date') || dateKey())
      json(res, 200, { ok: true, ...(await loadCollect(date)) })
      return
    }

    if (method === 'POST' && suffix === '/collect') {
      const body = await readBody(req)
      const date = String(body.date || dateKey())
      const collect = await loadCollect(date)
      const added = { manual: 0, files: [] }
      if (Array.isArray(body.manual)) {
        for (const text of body.manual) {
          const value = String(text ?? '').trim()
          if (!value) continue
          collect.manual.push({ text: value, at: new Date().toISOString() })
          added.manual += 1
        }
      }
      if (body.text) {
        const value = String(body.text).trim()
        if (value) { collect.manual.push({ text: value, at: new Date().toISOString() }); added.manual += 1 }
      }
      if (Array.isArray(body.files)) {
        const todayDir = store.p('导入', date)
        await fs.mkdir(todayDir, { recursive: true })
        for (const file of body.files) {
          const name = path.basename(String(file?.name ?? 'import.bin'))
          try {
            const buffer = Buffer.from(String(file?.dataBase64 ?? ''), 'base64')
            if (!buffer.length) throw new Error('文件内容为空')
            await fs.writeFile(path.join(todayDir, name), buffer)
            const extracted = await extractText({ name, buffer, officeKit: ctx.get('officeKit') })
            collect.files.push({ name, via: extracted.via, size: buffer.length, text: extracted.text, importedAt: new Date().toISOString() })
            added.files.push({ name, via: extracted.via, chars: extracted.text.length })
          } catch (error) {
            added.files.push({ name, error: error instanceof Error ? error.message : String(error) })
          }
        }
      }
      if (body.includeSessions) collect.session = await collectFromSessions(date)
      if (typeof body.materialText === 'string') collect.materialText = body.materialText
      collect.updatedAt = new Date().toISOString()
      await store.writeCollect(date, collect)
      if (added.manual > 0 || added.files.length > 0) {
        await store.appendLog('采集工作内容', `人工 +${added.manual} 条、导入 +${added.files.length} 个文件`)
      }
      json(res, 200, {
        ok: true, date, added,
        collect: {
          manual: collect.manual.length,
          files: collect.files.map((file) => ({ name: file.name, via: file.via, chars: file.text?.length ?? 0 })),
          session: collect.session ? { sessions: collect.session.sessions?.length ?? 0, note: collect.session.note } : null,
        },
      })
      return
    }

    if (method === 'POST' && suffix === '/collect/sessions') {
      const body = await readBody(req).catch(() => ({}))
      const date = String(body.date || dateKey())
      const collect = await loadCollect(date)
      collect.session = await collectFromSessions(date)
      const draft = materialDraft(collect.session, date)
      if (!collect.materialText || body.overwrite) collect.materialText = draft
      collect.updatedAt = new Date().toISOString()
      await store.writeCollect(date, collect)
      await store.appendLog('采集 Harness 会话', collect.session.note ?? '完成')
      json(res, 200, { ok: true, date, session: collect.session, draft, materialText: collect.materialText })
      return
    }

    if (method === 'POST' && suffix === '/generate') {
      const body = await readBody(req)
      const date = String(body.date || dateKey())
      const settings = await store.getSettings()
      const collect = await loadCollect(date)
      if (typeof body.materialText === 'string') collect.materialText = body.materialText
      if (body.includeSessions !== false && !collect.session && !collect.materialText) {
        collect.session = await collectFromSessions(date)
        if (!collect.materialText) collect.materialText = materialDraft(collect.session, date)
        collect.updatedAt = new Date().toISOString()
        await store.writeCollect(date, collect)
      }
      if (!collect.manual.length && !collect.files.length && !(collect.materialText?.trim()) && !(collect.session?.sessions?.length)) {
        json(res, 400, { ok: false, error: '今天还没有可整理的内容：先在 Harness 里干活、或手工录入/导入文件' })
        return
      }
      await recordAiUsage(store)
      const prompt = buildReportPrompt({
        date,
        digestBlock: sessionPromptBlock(collect.session),
        manual: collect.manual.map((item) => item.text),
        files: collect.files,
        material: collect.materialText ?? '',
      })
      try {
        const result = await callModel(ctx, { system: REPORT_SYSTEM_PROMPT, user: prompt, maxTokens: 3000, override: settings.modelOverride })
        const label = selectionLabel(result.selection)
        await store.appendLog('AI 生成日报', `模型 ${label}（${result.selection.source}），来源：会话 ${collect.session?.sessions?.length ?? 0} / 人工 ${collect.manual.length} / 文件 ${collect.files.length}`)
        json(res, 200, {
          ok: true, date, markdown: result.text, model: label, selection: result.selection,
          sources: { sessions: collect.session?.sessions?.length ?? 0, manual: collect.manual.length, files: collect.files.length },
        })
      } catch (error) {
        await store.appendLog('AI 生成日报', `失败：${error.message}`)
        json(res, 502, { ok: false, error: error.message })
      }
      return
    }

    if (method === 'POST' && suffix === '/save-report') {
      const body = await readBody(req)
      const date = String(body.date || dateKey())
      const markdown = String(body.markdown ?? '').trim()
      if (!markdown) { json(res, 400, { ok: false, error: '日报内容为空' }); return }
      const parsed = parseReport(markdown)
      if (!parsed.done.length && !parsed.plan.length) {
        json(res, 400, { ok: false, error: '日报缺少「今天干了什么」或「明天准备干什么」内容' })
        return
      }
      const file = await store.writeReport(date, `${markdown}\n`)
      const { targetDate, created } = await applyPlanToTodos(store, { date, markdown })
      const goals = await store.listGoalItems()
      const provided = Array.isArray(body.goalIds) ? body.goalIds.map(String) : null
      const tagIds = provided
        ? [...new Set(provided.filter((id) => goals.some((goal) => goal.id === id)))]
        : matchGoals(markdown, goals)
      await writeReportTagIds(date, tagIds)
      const existingMeta = await reportMetaOf(date)
      const source = body.source === 'AI' ? 'AI' : body.source === '人工' ? '人工' : existingMeta.source ?? null
      const model = body.source === 'AI' ? String(body.model ?? existingMeta.model ?? '') : existingMeta.model ?? null
      await patchReportMeta(date, { source, model, updatedAt: nowStamp() })
      const tags = tagsOf(tagIds, goals)
      await store.appendLog('保存日报', `${path.relative(dataDir, file)}，生成 ${created.length} 条 ${targetDate} 待办，关联目标 ${tags.length} 个`)
      // 后台分析：不阻塞保存响应。
      setTimeout(() => { void analyzeAfterSave(date, markdown) }, 50)
      json(res, 200, {
        ok: true, date, file, targetDate, todos: created, tags, analyzing: true,
        ...reportSourceInfo({ source, model }),
      })
      return
    }

    if (method === 'POST' && suffix === '/todos/status') {
      const body = await readBody(req)
      const item = await setTodoStatus(store, { id: String(body.id), status: String(body.status) })
      await store.appendLog('更新待办', `${item.content} → ${item.status}`)
      json(res, 200, { ok: true, todo: item })
      return
    }

    if (method === 'POST' && suffix === '/todos/update') {
      const body = await readBody(req)
      const id = String(body.id ?? '')
      if (!id) { json(res, 400, { ok: false, error: '需要 id' }); return }
      let updated = null
      await store.update('todos', { version: 1, items: [] }, (todos) => {
        const item = (todos.items ?? []).find((todo) => todo.id === id)
        if (!item) { const e = new Error('待办不存在'); e.status = 404; throw e }
        if (body.content !== undefined) {
          const content = stripSource(String(body.content))
          if (!content) throw new Error('待办内容不能为空')
          item.content = content
        }
        if (body.description !== undefined) item.description = String(body.description)
        if (body.goalId !== undefined) item.goalId = body.goalId ? String(body.goalId) : null
        if (body.startDate !== undefined) item.startDate = body.startDate ? String(body.startDate) : null
        if (body.dueDate !== undefined) {
          item.dueDate = body.dueDate ? String(body.dueDate) : null
          if (item.dueDate) item.date = item.dueDate.slice(0, 10)
        }
        item.editedAt = nowStamp()
        item.updatedAt = new Date().toISOString()
        updated = item
        return todos
      })
      await store.refreshOverview()
      await store.appendLog('编辑待办', updated.content)
      json(res, 200, { ok: true, todo: updated })
      return
    }

    if (method === 'POST' && suffix === '/todos/delete') {
      const body = await readBody(req)
      const id = String(body.id ?? '')
      let removed = null
      await store.update('todos', { version: 1, items: [] }, (todos) => {
        const item = (todos.items ?? []).find((todo) => todo.id === id)
        if (!item) { const e = new Error('待办不存在'); e.status = 404; throw e }
        todos.items = todos.items.filter((todo) => todo.id !== id)
        removed = item
        return todos
      })
      await store.refreshOverview()
      await store.appendLog('删除待办', removed.content)
      json(res, 200, { ok: true, removed })
      return
    }

    if (method === 'POST' && suffix === '/todos/delete-batch') {
      const body = await readBody(req)
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : []
      if (!ids.length) { json(res, 400, { ok: false, error: '没有选中待办' }); return }
      let removed = 0
      await store.update('todos', { version: 1, items: [] }, (todos) => {
        const before = todos.items?.length ?? 0
        todos.items = (todos.items ?? []).filter((todo) => !ids.includes(todo.id))
        removed = before - todos.items.length
        return todos
      })
      await store.refreshOverview()
      await store.appendLog('批量删除待办', `${removed} 条`)
      json(res, 200, { ok: true, removed })
      return
    }

    if (method === 'POST' && suffix === '/todos/ai-split') {
      const body = await readBody(req)
      const text = String(body.text ?? '').trim()
      if (!text) { json(res, 400, { ok: false, error: '先输入一段话' }); return }
      const today = String(body.date || dateKey())
      const settings = await store.getSettings()
      await recordAiUsage(store)
      try {
        const result = await callModel(ctx, {
          system: `你是待办拆解器。把用户的一段话拆成可以独立执行的待办，只输出 JSON 数组，不要代码围栏：[{"content":"待办内容","date":"YYYY-MM-DD"}]。今天是 ${today}，date 按语义换算（今天/明天/后天等），未提到日期就用今天。每条动词开头、结果可验证、不超过 40 字，最多 10 条。`,
          user: text,
          maxTokens: 800,
          override: settings.modelOverride,
        })
        const parsed = parseJsonLoosely(result.text)
        const entries = (Array.isArray(parsed) ? parsed : [])
          .map((item) => ({
            content: String(item?.content ?? item ?? '').trim(),
            date: /^\d{4}-\d{2}-\d{2}$/.test(String(item?.date ?? '')) ? String(item.date) : today,
          }))
          .filter((item) => item.content)
          .slice(0, 10)
        const items = entries.map((item) => item.content)
        await store.appendLog('AI 拆解待办', `${items.length} 条（${selectionLabel(result.selection)}）`)
        json(res, 200, { ok: true, items, entries, model: selectionLabel(result.selection) })
      } catch (error) {
        await store.appendLog('AI 拆解待办', `失败：${error.message}`)
        json(res, 502, { ok: false, error: error.message })
      }
      return
    }

    if (method === 'POST' && suffix === '/todos/postpone') {
      const body = await readBody(req)
      const moved = await postponeTodos(store, { ids: (body.ids ?? []).map(String), toDate: String(body.date || dateKey()) })
      await store.appendLog('顺延待办', `${moved.length} 条 → ${body.date || dateKey()}`)
      json(res, 200, { ok: true, moved })
      return
    }

    if (method === 'POST' && suffix === '/todos/add') {
      const body = await readBody(req)
      // 可选：restore 用于删除后的「撤销」。原样写回同一条待办（保留 id、来源、关联目标、完成状态）。
      const restore = body.restore && typeof body.restore === 'object' ? body.restore : null
      if (restore) {
        const id = String(restore.id ?? '')
        const content = String(restore.content ?? '').trim()
        if (!id || !content) { json(res, 400, { ok: false, error: '撤销的数据不完整' }); return }
        let restored = null
        await store.update('todos', { version: 1, items: [] }, (todos) => {
          todos.items = Array.isArray(todos.items) ? todos.items : []
          if (todos.items.some((todo) => todo.id === id)) return todos
          restored = {
            ...restore,
            id,
            content,
            date: String(restore.date ?? dateKey()),
            updatedAt: new Date().toISOString(),
          }
          todos.items.push(restored)
          return todos
        })
        await store.refreshOverview()
        if (restored) await store.appendLog('撤销删除待办', restored.content)
        json(res, 200, { ok: true, restored: Boolean(restored), todo: restored })
        return
      }
      const date = String(body.date || dateKey())
      const texts = (body.texts ?? []).map((text) => stripSource(text)).filter(Boolean)
      if (!texts.length) { json(res, 400, { ok: false, error: '待办内容为空' }); return }
      const created = await applyManualTodos(store, {
        date,
        texts,
        startDate: body.startDate ? String(body.startDate) : undefined,
        dueDate: body.dueDate ? String(body.dueDate) : undefined,
        source: body.source === 'AI 助手' ? 'AI 助手' : '人工输入',
        aiModel: body.source === 'AI 助手' && body.aiModel ? String(body.aiModel).slice(0, 120) : undefined,
      })
      await store.appendLog('新增待办', `${created.length} 条（${date}）`)
      json(res, 200, { ok: true, created })
      return
    }

    if (method === 'GET' && suffix === '/settings') {
      json(res, 200, { ok: true, settings: await store.getSettings() })
      return
    }

    if (method === 'POST' && suffix === '/settings') {
      const body = await readBody(req)
      let settings = null
      try {
        settings = await store.saveSettings(body.settings ?? body ?? {})
      } catch (error) {
        if (error?.code === 'INVALID_TIME') { json(res, 400, { ok: false, error: error.message }); return }
        throw error
      }
      await store.appendLog('更新设置', JSON.stringify(settings).slice(0, 200))
      json(res, 200, { ok: true, settings })
      return
    }

    if (method === 'POST' && suffix === '/heartbeat') {
      const body = await readBody(req).catch(() => ({}))
      await store.update('state', { heartbeat: null }, (current) => {
        current.heartbeat = { ts: Date.now(), visible: body.visible !== false, tab: body.tab ?? null }
        return current
      })
      const state = await store.getState()
      json(res, 200, { ok: true, notices: state.notices ?? [], serverTime: nowStamp() })
      return
    }

    if (method === 'POST' && suffix === '/notice-ack') {
      const body = await readBody(req).catch(() => ({}))
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [String(body.id ?? '')]
      await store.update('state', { notices: [] }, (current) => {
        current.notices = (current.notices ?? []).filter((notice) => !ids.includes(notice.id))
        current.lastNotify = { ...(current.lastNotify ?? {}), ackedBy: 'web', ackedAt: Date.now() }
        return current
      })
      json(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && suffix === '/log') {
      const limit = Number(url.searchParams.get('lines') ?? 50) || 50
      json(res, 200, { ok: true, lines: await tailLog(limit) })
      return
    }

    if (method === 'POST' && suffix === '/assistant/analyze') {
      const body = await readBody(req)
      const parts = []
      const notes = []
      const text = String(body.text ?? '').trim()
      if (text) parts.push(`用户描述：\n${text}`)
      const link = String(body.url ?? '').trim()
      if (link) {
        if (!/^https?:\/\//i.test(link)) { json(res, 400, { ok: false, error: '链接必须是 http/https' }); return }
        try {
          const response = await fetch(link, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; WorkBuddy/1.0)' }, signal: AbortSignal.timeout(10_000) })
          const html = await response.text()
          const cleaned = stripHtml(html).slice(0, 8000)
          if (!cleaned) throw new Error('页面没有可读文本')
          parts.push(`链接内容（${link}）：\n${cleaned}`)
          notes.push(`已读取链接：${link}`)
        } catch (error) {
          json(res, 502, { ok: false, error: `链接抓取失败：${error instanceof Error ? error.message : String(error)}` })
          return
        }
      }
      if (Array.isArray(body.files)) {
        for (const file of body.files) {
          const name = path.basename(String(file?.name ?? 'file'))
          const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase()
          const buffer = Buffer.from(String(file?.dataBase64 ?? ''), 'base64')
          if (!buffer.length) { notes.push(`${name}：空文件，已跳过`); continue }
          if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'].includes(ext)) { notes.push(`${name}：已接收图片，暂不做图像识别`); continue }
          if (['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'].includes(ext)) { notes.push(`${name}：已接收视频，暂不做视频解析`); continue }
          try {
            const extracted = await extractText({ name, buffer, officeKit: ctx.get('officeKit') })
            if (extracted.text.trim()) {
              parts.push(`附件 ${name}（${extracted.via}）：\n${extracted.text.slice(0, 6000)}`)
              notes.push(`已解析附件：${name}`)
            }
          } catch (error) {
            notes.push(`${name}：解析失败（${error instanceof Error ? error.message : String(error)}）`)
          }
        }
      }
      if (!parts.length) { json(res, 400, { ok: false, error: '没有可分析的内容' }); return }
      const settings = await store.getSettings()
      await recordAiUsage(store)
      try {
        const today = dateKey()
        const weekday = new Date(`${today}T00:00:00`).toLocaleDateString('zh-CN', { weekday: 'long' })
        const result = await callModel(ctx, {
          system: `你是待办拆解助手。根据用户描述、附件或链接内容，拆出可以直接执行的待办。今天是 ${today}（${weekday}）。只输出 JSON 数组，不要代码围栏：[{"content":"待办内容","date":"YYYY-MM-DD"}]。date 按语义换算（今天/明天/后天等），未提到日期就用今天。每条动词开头、结果可验证、不超过 40 字，最多 8 条；一句话最多拆 3 条，不要补充用户没提到的步骤。`,
          user: parts.join('\n\n').slice(0, 16_000),
          maxTokens: 1200,
          override: settings.modelOverride,
        })
        const parsed = parseJsonLoosely(result.text)
        const relative = (text, base) => {
          const parsedDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text ?? ''))
          if (parsedDate) return text
          const label = String(text ?? '')
          const shift = /后天/.test(label) ? 2 : /明天/.test(label) ? 1 : 0
          if (!shift) return base
          const date = new Date(`${base}T00:00:00`)
          date.setDate(date.getDate() + shift)
          return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        }
        const items = (Array.isArray(parsed) ? parsed : []).map((item) => ({
          content: String(item?.content ?? item ?? '').trim(),
          date: relative(item?.date ?? '', today),
        })).filter((item) => item.content).slice(0, 8)
        await store.appendLog('AI 助手拆解', `${items.length} 条（${selectionLabel(result.selection)}）`)
        json(res, 200, { ok: true, items, notes, model: selectionLabel(result.selection) })
      } catch (error) {
        await store.appendLog('AI 助手拆解', `失败：${error.message}`)
        json(res, 502, { ok: false, error: error.message })
      }
      return
    }

    if (method === 'POST' && suffix === '/goals/ai-progress') {
      const body = await readBody(req)
      const previewOnly = body.preview === true
      const goalId = String(body.goalId ?? '')
      const goals = await store.listGoalItems()
      const goal = goals.find((item) => item.id === goalId)
      if (!goal) { json(res, 404, { ok: false, error: '目标不存在' }); return }
      const family = new Set([goal.id])
      let grew = true
      while (grew) {
        grew = false
        for (const item of goals) {
          if (item.parentId && family.has(item.parentId) && !family.has(item.id)) { family.add(item.id); grew = true }
        }
      }
      const leaves = goals.filter((item) => family.has(item.id) && !goals.some((child) => child.parentId === item.id))
      const sections = []
      let entries = []
      try { entries = await fs.readdir(store.p('日报')) } catch { entries = [] }
      for (const name of entries.slice(-60)) {
        const match = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(name)
        if (!match) continue
        try { sections.push(`### 日报 ${match[1]}\n${(await fs.readFile(store.reportPath(match[1]), 'utf8')).slice(0, 2000)}`) } catch { /* 忽略 */ }
      }
      let summaries = []
      try { summaries = await fs.readdir(store.p('汇总')) } catch { summaries = [] }
      for (const file of summaries.slice(-10)) {
        if (!file.endsWith('.md')) continue
        try { sections.push(`### 汇总 ${file}\n${(await fs.readFile(store.summaryPath(file), 'utf8')).slice(0, 2000)}`) } catch { /* 忽略 */ }
      }
      if (!sections.length) { json(res, 400, { ok: false, error: '还没有日报或汇总可供分析' }); return }
      const settings = await store.getSettings()
      await recordAiUsage(store)
      try {
        const result = await callModel(ctx, {
          system: '你是目标进度分析器。根据日报和周报，给出每个叶子目标的新进度。只输出 JSON 数组：[{"goalId":"...","progress":60,"reason":"一句话理由"}]。progress 为 0-100 整数，只能基于材料里的事实，最多调整 +30。',
          user: `目标：\n${leaves.map((item) => `- ${item.id}｜${item.title}｜当前 ${item.progress}%｜衡量：${item.measure}`).join('\n')}\n\n材料：\n${sections.join('\n\n').slice(0, 18_000)}`,
          maxTokens: 1200,
          override: settings.modelOverride,
        })
        const parsed = parseJsonLoosely(result.text)
        const list = Array.isArray(parsed) ? parsed : []
        const updated = []
        for (const item of list) {
          const target = leaves.find((leaf) => leaf.id === String(item?.goalId))
          if (!target) continue
          const value = Math.max(0, Math.min(100, Math.round(Number(item?.progress))))
          if (!Number.isFinite(value) || value === target.progress) continue
          if (!previewOnly) await updateGoal(store, target.id, { progress: value, reason: `AI 更新：${String(item?.reason ?? '').slice(0, 80)}` })
          updated.push({ id: target.id, title: target.title, from: target.progress, to: value, reason: String(item?.reason ?? '').slice(0, 200) })
        }
        await store.appendLog(previewOnly ? 'AI 评估目标进度' : 'AI 更新目标进度', `${updated.length} 个（${selectionLabel(result.selection)}）`)
        json(res, 200, { ok: true, updated, suggestions: updated, preview: previewOnly, model: selectionLabel(result.selection), goals: await store.listGoalItems() })
      } catch (error) {
        await store.appendLog('AI 更新目标进度', `失败：${error.message}`)
        json(res, 502, { ok: false, error: error.message })
      }
      return
    }

    if (method === 'POST' && suffix === '/quotes/update') {
      const body = await readBody(req)
      const id = String(body.id ?? '')
      const custom = await readCustomQuotes(store)
      const item = custom.find((quote) => quote.id === id)
      if (!item) { json(res, 404, { ok: false, error: '自定义名句不存在' }); return }
      if (body.text !== undefined) item.text = String(body.text).trim()
      if (body.author !== undefined) item.author = String(body.author).trim()
      if (body.source !== undefined) item.source = String(body.source).trim()
      if (!item.text) { json(res, 400, { ok: false, error: '内容不能为空' }); return }
      await writeCustomQuotes(store, custom)
      json(res, 200, { ok: true, custom })
      return
    }

    // ---------------- 每日一句 / 天气 ----------------

    if (method === 'GET' && suffix === '/quote/today') {
      const date = String(url.searchParams.get('date') || dateKey())
      const [custom, hidden] = await Promise.all([readCustomQuotes(store), readHiddenQuotes(store)])
      const builtin = defaultsAsItems().filter((item) => !hidden.includes(item.id))
      const all = [...builtin, ...custom]
      if (!all.length) { json(res, 200, { ok: true, date, quote: null, customCount: custom.length, total: 0 }); return }
      const picked = await store.update('state', { version: 1 }, (state) => {
        if (state.quote && state.quote.date === date && state.quote.id) {
          const found = all.find((item) => item.id === state.quote.id)
          if (found) return { ...found, total: all.length }
        }
        const next = quoteOfDay(date, all)
        if (next) state.quote = { date, id: next.id }
        return next
      })
      json(res, 200, { ok: true, date, quote: picked, customCount: custom.length, total: all.length })
      return
    }

    if (method === 'GET' && suffix === '/quotes') {
      const [custom, hidden] = await Promise.all([readCustomQuotes(store), readHiddenQuotes(store)])
      const builtin = defaultsAsItems().filter((item) => !hidden.includes(item.id))
      const all = [...builtin, ...custom]
      json(res, 200, { ok: true, builtin, custom, hiddenCount: hidden.length, hiddenIds: hidden, today: all.length ? quoteOfDay(dateKey(), all) : null })
      return
    }

    if (method === 'POST' && suffix === '/quotes/delete-batch') {
      const body = await readBody(req)
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : []
      const [custom, hidden] = await Promise.all([readCustomQuotes(store), readHiddenQuotes(store)])
      const builtinIds = ids.filter((id) => id.startsWith('d-'))
      const customIds = ids.filter((id) => !id.startsWith('d-'))
      const nextHidden = [...new Set([...hidden, ...builtinIds])]
      const nextCustom = custom.filter((item) => !customIds.includes(item.id))
      await writeHiddenQuotes(store, nextHidden)
      await writeCustomQuotes(store, nextCustom)
      const remaining = defaultsAsItems().filter((item) => !nextHidden.includes(item.id)).length + nextCustom.length
      // BUG-04：内置名句是「隐藏」而非删除，单独统计，不计入 removed。
      const hiddenNow = builtinIds.filter((id) => !hidden.includes(id))
      const removedCount = customIds.filter((id) => custom.some((item) => item.id === id)).length
      await store.appendLog('批量删除名句', `删除自定义 ${removedCount} 条，隐藏内置 ${hiddenNow.length} 条，剩余 ${remaining} 条`)
      json(res, 200, {
        ok: true, removed: removedCount, hidden: hiddenNow, remaining, custom: nextCustom, hiddenIds: nextHidden,
      })
      return
    }

    if (method === 'POST' && suffix === '/quotes/unhide') {
      const body = await readBody(req)
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : []
      if (!ids.length) { json(res, 400, { ok: false, error: '请提供要恢复的内置名句 id（ids 数组）' }); return }
      if (ids.some((id) => !id.startsWith('d-'))) { json(res, 400, { ok: false, error: '只能恢复内置名句（id 必须以 d- 开头）' }); return }
      const hidden = await readHiddenQuotes(store)
      const restoring = ids.filter((id) => hidden.includes(id))
      const nextHidden = hidden.filter((id) => !restoring.includes(id))
      await writeHiddenQuotes(store, nextHidden)
      await store.appendLog('恢复内置名句', `${restoring.length} 条`)
      json(res, 200, { ok: true, restored: restoring.length, hidden: nextHidden })
      return
    }

    if (method === 'POST' && suffix === '/quotes/add') {
      const body = await readBody(req)
      const incoming = Array.isArray(body.items) ? body.items : []
      const clean = incoming
        .map((item, index) => ({
          id: `q-${Date.now().toString(36)}-${index}`,
          text: String(item?.text ?? '').trim(),
          author: String(item?.author ?? '').trim(),
          source: String(item?.source ?? '').trim(),
        }))
        .filter((item) => item.text)
      if (!clean.length) { json(res, 400, { ok: false, error: '没有可添加的名句：请用 items 数组传入，例如 {"items":[{"text":"…","author":"…","source":"…"}]}' }); return }
      const custom = [...(await readCustomQuotes(store)), ...clean]
      await writeCustomQuotes(store, custom)
      await store.appendLog('新增名句', `${clean.length} 条`)
      json(res, 200, { ok: true, added: clean, custom })
      return
    }

    if (method === 'POST' && suffix === '/quotes/delete') {
      const body = await readBody(req)
      const id = String(body.id ?? '')
      const custom = (await readCustomQuotes(store)).filter((item) => item.id !== id)
      await writeCustomQuotes(store, custom)
      await store.appendLog('删除名句', id)
      json(res, 200, { ok: true, custom })
      return
    }

    if (method === 'POST' && suffix === '/quotes/import') {
      const body = await readBody(req)
      let text = String(body.text ?? '').trim()
      if (!text && body.dataBase64) {
        text = Buffer.from(String(body.dataBase64), 'base64').toString('utf8')
      }
      if (!text) { json(res, 400, { ok: false, error: '没有可导入的内容' }); return }
      const items = []
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        let content = line
        let author = ''
        let source = ''
        const split = /^(.*?)(?:——|--|—)\s*(.*)$/.exec(line)
        if (split) {
          content = split[1].trim()
          const tail = split[2].trim()
          const book = /《([^》]+)》/.exec(tail)
          if (book) source = book[1]
          author = tail.replace(/《[^》]*》/g, '').trim()
        }
        if (content) items.push({ text: content, author, source })
      }
      if (!items.length) { json(res, 400, { ok: false, error: '没有解析到名句，每行一条即可' }); return }
      const parsed = items.map((item, index) => ({ ...item, id: `q-${Date.now().toString(36)}-${index}` }))
      const custom = [...(await readCustomQuotes(store)), ...parsed]
      await writeCustomQuotes(store, custom)
      await store.appendLog('导入名句', `${parsed.length} 条`)
      json(res, 200, { ok: true, added: parsed, custom })
      return
    }

    if (method === 'POST' && suffix === '/quotes/ai') {
      const body = await readBody(req)
      const settings = await store.getSettings()
      const prompt = String(body.prompt ?? '').trim()
      const count = Math.max(1, Math.min(20, Number(body.count) || 5))
      if (!prompt) { json(res, 400, { ok: false, error: '先写一句你喜欢的风格' }); return }
      await recordAiUsage(store)
      try {
        const result = await callModel(ctx, {
          system: `你是名句编辑。根据用户描述的偏好，返回 ${count} 条中文名句，只输出 JSON 数组，不要代码围栏：
[{"text":"名句原文","author":"作者","source":"出处"}]
要求：来自文学名著、历史典籍、诗词歌赋或真实名人言论；不要编造；每条不超过 40 字。`,
          user: `偏好：${prompt}`,
          maxTokens: 1200,
          override: settings.modelOverride,
        })
        const parsed = parseJsonLoosely(result.text)
        const list = (Array.isArray(parsed) ? parsed : []).map((item) => ({
          text: String(item?.text ?? '').trim(),
          author: String(item?.author ?? '').trim(),
          source: String(item?.source ?? '').trim(),
        })).filter((item) => item.text)
        await store.appendLog('AI 推荐名句', `${list.length} 条（${selectionLabel(result.selection)}）`)
        json(res, 200, { ok: true, quotes: list, model: selectionLabel(result.selection) })
      } catch (error) {
        await store.appendLog('AI 推荐名句', `失败：${error.message}`)
        json(res, 502, { ok: false, error: error.message })
      }
      return
    }

    if (method === 'GET' && suffix === '/weather') {
      const settings = await store.getSettings()
      if (settings.weatherEnabled === false) { json(res, 200, { ok: true, weather: { ok: false, disabled: true } }); return }
      const weather = await currentWeather(settings.region || settings.weatherCity, url.searchParams.get('tz') || '')
      json(res, 200, { ok: true, weather })
      return
    }

    // ---------------- 目标 ----------------

    if (method === 'GET' && suffix === '/goals') {
      const items = await store.listGoalItems()
      const state = await store.getState()
      json(res, 200, {
        ok: true,
        goals: items,
        alerts: state.goalAlerts?.[dateKey()] ?? {},
        suggestions: await loadSuggestions(),
      })
      return
    }

    if (method === 'POST' && suffix === '/goals') {
      const body = await readBody(req)
      // 可选：restore 用来撤销删除目标，原样写回并重新挂上原来的子目标。
      if (body.restore && typeof body.restore === 'object' && body.restore.id) {
        const restore = body.restore
        const childIds = Array.isArray(body.childIds) ? body.childIds.map(String) : []
        let restored = null
        await store.update('goals', { version: 1, items: [] }, (goals) => {
          goals.items = Array.isArray(goals.items) ? goals.items : []
          if (goals.items.some((item) => item.id === restore.id)) return goals
          restored = { ...restore, updatedAt: new Date().toISOString() }
          goals.items.push(restored)
          for (const item of goals.items) {
            if (childIds.includes(item.id)) item.parentId = restore.id
          }
          recomputeParents(goals.items)
          return goals
        })
        await store.refreshOverview()
        if (restored) await store.appendLog('撤销删除目标', restored.title)
        json(res, 200, { ok: true, goal: restored, restored: Boolean(restored), goals: await store.listGoalItems() })
        return
      }
      const created = await createGoal(store, body)
      await store.appendLog('新建目标', `${created.cycle}｜${created.title}`)
      json(res, 200, { ok: true, goal: created, goals: await store.listGoalItems() })
      return
    }

    if (method === 'POST' && suffix === '/goals/update') {
      const body = await readBody(req)
      const id = String(body.id ?? '')
      const updated = await updateGoal(store, id, body.patch ?? body)
      await store.appendLog('更新目标', `${updated.title}｜${updated.progress}%`)
      json(res, 200, { ok: true, goal: updated, goals: await store.listGoalItems() })
      return
    }

    if (method === 'POST' && suffix === '/goals/progress') {
      const body = await readBody(req)
      const id = String(body.id ?? '')
      let updated = null
      try {
        updated = await updateGoal(store, id, { progress: Number(body.progress), reason: String(body.reason ?? '手动更新') })
      } catch (error) {
        if (error?.code === 'PROGRESS_LOCKED') { json(res, 409, { ok: false, error: error.message }); return }
        throw error
      }
      await store.appendLog('更新目标进度', `${updated.title} → ${updated.progress}%`)
      json(res, 200, { ok: true, goal: updated, goals: await store.listGoalItems() })
      return
    }

    if (method === 'GET' && suffix === '/goals/related') {
      try {
      const goalId = String(url.searchParams.get('goalId') || '')
      const goals = await store.listGoalItems()
      const goal = goals.find((item) => item.id === goalId)
      if (!goal) { json(res, 404, { ok: false, error: '目标不存在' }); return }
      const family = new Set([goal.id])
      let grew = true
      while (grew) {
        grew = false
        for (const item of goals) {
          if (item.parentId && family.has(item.parentId) && !family.has(item.id)) { family.add(item.id); grew = true }
        }
      }
      const tokens = new Set()
      for (const item of goals) {
        if (!family.has(item.id)) continue
        for (const token of goalTokens(item)) tokens.add(token)
      }
      const meta = await readReportMeta()
      const items = []
      let entries = []
      try { entries = await fs.readdir(store.p('日报')) } catch { entries = [] }
      for (const name of entries) {
        const match = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(name)
        if (!match) continue
        const date = match[1]
        let content = ''
        let stat = null
        try {
          content = await fs.readFile(store.reportPath(date), 'utf8')
          stat = await fs.stat(store.reportPath(date))
        } catch { continue }
        const tagged = Array.isArray(meta.items?.[date]?.goalIds) && meta.items[date].goalIds.some((id) => family.has(id))
        const lower = content.toLowerCase()
        const matched = []
        for (const line of content.split(/\r?\n/)) {
          const textLine = line.replace(/^\s*[-*+]\s*/, '').trim()
          if (!textLine || textLine.startsWith('#')) continue
          if ([...tokens].some((token) => lower.includes(token))) {
            if ([...tokens].some((token) => textLine.toLowerCase().includes(token))) matched.push(textLine.slice(0, 140))
          }
          if (matched.length >= 4) break
        }
        if (!tagged && !matched.length) continue
        items.push({ kind: '日报', date, dateLabel: date, mtime: stat?.mtimeMs ?? 0, matched, tagged })
      }
      let summaries = []
      try { summaries = await fs.readdir(store.p('汇总')) } catch { summaries = [] }
      for (const file of summaries) {
        if (!file.endsWith('.md')) continue
        const name = file.replace(/\.md$/, '')
        const kind = /^\d{4}-W\d{2}$/.test(name) ? '周报' : /^\d{4}-\d{2}$/.test(name) ? '月报' : '汇总'
        let content = ''
        let stat = null
        try {
          content = await fs.readFile(store.summaryPath(file), 'utf8')
          stat = await fs.stat(store.summaryPath(file))
        } catch { continue }
        const lower = content.toLowerCase()
        const matched = []
        for (const line of content.split(/\r?\n/)) {
          const textLine = line.replace(/^\s*[-*+]\s*/, '').trim()
          if (!textLine || textLine.startsWith('#')) continue
          if ([...tokens].some((token) => textLine.toLowerCase().includes(token))) matched.push(textLine.slice(0, 140))
          if (matched.length >= 4) break
        }
        if (!matched.length) continue
        items.push({ kind, date: name, dateLabel: name, mtime: stat?.mtimeMs ?? 0, matched, tagged: false, summaryName: name })
      }
      items.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0))
      json(res, 200, { ok: true, goal: { id: goal.id, title: goal.title, cycle: goal.cycle }, items })
      return
      } catch (error) {
        await fs.writeFile('/tmp/wb-related-error.txt', String(error?.stack ?? error))
        throw error
      }
    }

    if (method === 'POST' && suffix === '/goals/delete') {
      const body = await readBody(req)
      const { removed, unlinked } = await deleteGoal(store, String(body.id ?? ''))
      await store.appendLog('删除目标', `${removed.title}（解除 ${unlinked} 个子目标关联）`)
      json(res, 200, { ok: true, removed, unlinked, goals: await store.listGoalItems() })
      return
    }

    if (method === 'POST' && suffix === '/goals/import/parse') {
      const body = await readBody(req)
      const settings = await store.getSettings()
      let text = String(body.text ?? '').trim()
      let via = '人工粘贴'
      if (Array.isArray(body.files) && body.files.length) {
        const parts = []
        for (const file of body.files) {
          const name = path.basename(String(file?.name ?? 'import.bin'))
          const buffer = Buffer.from(String(file?.dataBase64 ?? ''), 'base64')
          try {
            const extracted = await extractText({ name, buffer, officeKit: ctx.get('officeKit') })
            parts.push(`【文件 ${name}】\n${extracted.text}`)
            via = `文件导入（${extracted.via}）`
          } catch (error) {
            throw new Error(`文件「${name}」解析失败：${error instanceof Error ? error.message : String(error)}`)
          }
        }
        text = `${text}\n\n${parts.join('\n\n')}`.trim()
      }
      if (!text) { json(res, 400, { ok: false, error: '没有可拆解的内容' }); return }
      await recordAiUsage(store)
      try {
        const result = await decomposeGoals(ctx, text, { override: settings.modelOverride })
        await store.appendLog('AI 拆解目标', `${result.goals.length} 条（${via}）`)
        json(res, 200, { ok: true, goals: result.goals, truncated: result.truncated, totalChunks: result.total, via })
      } catch (error) {
        await store.appendLog('AI 拆解目标', `失败：${error.message}`)
        json(res, 502, { ok: false, error: error.message })
      }
      return
    }

    if (method === 'POST' && suffix === '/goals/import/save') {
      const body = await readBody(req)
      const preview = Array.isArray(body.goals) ? body.goals : []
      if (!preview.length) { json(res, 400, { ok: false, error: '没有可保存的目标' }); return }
      const created = []
      await store.update('goals', { version: 1, items: [] }, (goals) => {
        goals.items = Array.isArray(goals.items) ? goals.items : []
        const idByIndex = new Map()
        preview.forEach((raw, index) => {
          const fields = validateGoal(raw, goals.items)
          const goal = {
            id: `g-${fields.cycle}-${Date.now().toString(36).slice(-5)}${String(index).padStart(3, '0')}`,
            ...fields,
            progress: 0,
            createdAt: nowStamp(),
            updatedAt: nowStamp(),
            records: [],
          }
          const parentIndex = Number.isInteger(raw.parentIndex) ? raw.parentIndex : null
          if (parentIndex !== null && parentIndex < index && idByIndex.has(parentIndex)) goal.parentId = idByIndex.get(parentIndex)
          idByIndex.set(index, goal.id)
          goals.items.push(goal)
          created.push(goal)
        })
        recomputeParents(goals.items)
        return goals
      })
      await store.refreshOverview()
      await store.appendLog('导入目标', `${created.length} 条`)
      json(res, 200, { ok: true, created, goals: await store.listGoalItems() })
      return
    }

    if (method === 'GET' && suffix === '/suggestions') {
      json(res, 200, { ok: true, suggestions: await loadSuggestions() })
      return
    }

    if (method === 'POST' && suffix === '/suggestions/apply') {
      const body = await readBody(req)
      const id = String(body.id ?? '')
      let suggestion = null
      await store.update('suggestions', emptySuggestions(), (current) => {
        suggestion = (current.items ?? []).find((item) => item.id === id && item.status === 'pending')
        if (!suggestion) throw new Error('建议不存在或已处理')
        suggestion.status = 'accepted'
        suggestion.decidedAt = nowStamp()
        return current
      })
      const updated = await updateGoal(store, suggestion.goalId, {
        progress: suggestion.to,
        reason: `采纳日报建议：${suggestion.reason}`,
      })
      await store.appendLog('采纳进度建议', `${updated.title} ${suggestion.from}% → ${suggestion.to}%`)
      json(res, 200, { ok: true, goal: updated, goals: await store.listGoalItems(), suggestions: await loadSuggestions() })
      return
    }

    if (method === 'POST' && suffix === '/suggestions/dismiss') {
      const body = await readBody(req)
      const id = String(body.id ?? '')
      await store.update('suggestions', emptySuggestions(), (current) => {
        const item = (current.items ?? []).find((entry) => entry.id === id)
        if (item) { item.status = 'dismissed'; item.decidedAt = nowStamp() }
        return current
      })
      await store.appendLog('忽略进度建议', id)
      json(res, 200, { ok: true, suggestions: await loadSuggestions() })
      return
    }

    // ---------------- 测试触发（不改系统时间）----------------

    if (method === 'POST' && (suffix === '/debug/morning' || suffix === '/debug/evening')) {
      const body = await readBody(req).catch(() => ({}))
      const channel = ['web', 'desktop', 'auto'].includes(body.channel) ? body.channel : 'auto'
      const now = syntheticNow(body, suffix === '/debug/morning' ? '09:00' : '18:00')
      const result = suffix === '/debug/morning'
        ? await reminders.morning({ now, force: Boolean(body.force), forceWorkday: body.forceWorkday !== false, channel })
        : await reminders.evening({ now, force: Boolean(body.force), forceWorkday: body.forceWorkday !== false, channel })
      json(res, 200, { ok: true, simulatedAt: nowStamp(now), ...result })
      return
    }

    if (method === 'POST' && suffix === '/debug/tick') {
      const body = await readBody(req).catch(() => ({}))
      const channel = ['web', 'desktop', 'auto'].includes(body.channel) ? body.channel : 'auto'
      json(res, 200, { ok: true, ...(await reminders.tick({ force: Boolean(body.force), channel, which: body.which ?? 'auto' })) })
      return
    }

    if (method === 'POST' && suffix === '/debug/convert') {
      const body = await readBody(req)
      const officeKit = ctx.get('officeKit')
      if (!officeKit?.convertTo) { json(res, 400, { ok: false, error: '宿主没有 officeKit' }); return }
      const name = path.basename(String(body.name ?? 'input.docx'))
      const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase()
      const format = String(body.format ?? 'doc')
      const buffer = Buffer.from(String(body.dataBase64 ?? ''), 'base64')
      if (!buffer.length) { json(res, 400, { ok: false, error: '文件为空' }); return }
      const version = `${buffer.length}-${Date.now()}`
      try {
        const result = await officeKit.convertTo({
          extension: ext,
          format,
          source: {
            key: `zhixing-debug:${name}:${version}`,
            version,
            bytes: buffer.length,
            read: async () => ({ bytes: buffer, version }),
          },
          output: { owner: 'zhixing-debug', name: `converted-${Date.now()}.${format}` },
        })
        const converted = await fs.readFile(result.path)
        json(res, 200, { ok: true, name: `${name}.${format}`, base64: converted.toString('base64'), bytes: converted.length })
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (method === 'POST' && suffix === '/debug/goal-check') {
      const body = await readBody(req).catch(() => ({}))
      const settings = await store.getSettings()
      const date = dateKey()
      if (body.force) {
        await store.update('state', { goalAlerts: {} }, (current) => {
          if (current.goalAlerts) delete current.goalAlerts[date]
          return current
        })
      }
      const channel = ['web', 'desktop', 'auto'].includes(body.channel) ? body.channel : 'auto'
      const result = await checkGoalAlerts(store, settings, {
        deliver: (alert) => deliver(store, { kind: `goal-${alert.kind}`, title: alert.title, body: alert.body, channel }),
      })
      json(res, 200, { ok: true, ...result })
      return
    }

    if (method === 'POST' && suffix === '/debug/goal-age') {
      const body = await readBody(req)
      const days = Number(body.days ?? 3)
      let target = null
      await store.update('goals', { version: 1, items: [] }, (goals) => {
        const list = goals.items ?? []
        target = body.id ? list.find((item) => item.id === body.id) : list[0]
        if (!target) throw new Error('没有可修改的目标')
        const stamp = new Date(Date.now() - days * 86_400_000)
        const pad = (n) => String(n).padStart(2, '0')
        target.updatedAt = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}:${pad(stamp.getSeconds())}`
        return goals
      })
      await store.appendLog('[测试] 调整目标更新时间', `${target.title} → ${days} 天前`)
      json(res, 200, { ok: true, goal: target })
      return
    }

    if (method === 'POST' && suffix === '/debug/seed') {
      const body = await readBody(req).catch(() => ({}))
      const goalCount = Math.min(200, Number(body.goals ?? 50))
      const todoCount = Math.min(1000, Number(body.todos ?? 200))
      const reportCount = Math.min(300, Number(body.reports ?? 100))
      const started = Date.now()
      const ids = []
      await store.update('goals', { version: 1, items: [] }, (goals) => {
        goals.items = (goals.items ?? []).filter((goal) => !goal.seed)
        const parents = []
        for (let i = 0; i < goalCount; i += 1) {
          const cycle = i < 5 ? '年' : i < 20 ? '月' : '周'
          const range = { 年: ['2026-01-01', '2026-12-31'], 月: ['2026-11-01', '2026-11-30'], 周: ['2026-11-09', '2026-11-15'] }[cycle]
          const id = `seed-g-${i}`
          ids.push(id)
          goals.items.push({
            id, title: `测试目标 ${i + 1}`, cycle, startDate: range[0], endDate: range[1],
            parentId: cycle === '年' ? null : cycle === '月' ? `seed-g-${i % 5}` : `seed-g-${5 + (i % 15)}`,
            measure: `完成 ${i % 7 + 1} 项可验证结果`, progress: (i * 7) % 101,
            createdAt: nowStamp(), updatedAt: nowStamp(), records: [], seed: true,
          })
          if (cycle !== '周') parents.push(id)
        }
        recomputeParents(goals.items)
        return goals
      })
      await store.update('todos', { version: 1, items: [] }, (todos) => {
        todos.items = (todos.items ?? []).filter((todo) => !todo.seed)
        for (let i = 0; i < todoCount; i += 1) {
          todos.items.push({
            id: `seed-t-${i}`, content: `测试待办 ${i + 1}：完成第 ${i % 9 + 1} 项工作`,
            date: addDays(dateKey(), -(i % 10)), source: i % 3 === 0 ? '人工输入' : '日报:测试',
            status: i % 5 === 0 ? '完成' : '未做', goalId: null,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), seed: true,
          })
        }
        return todos
      })
      for (let i = 0; i < reportCount; i += 1) {
        const date = addDays('2025-12-31', -i)
        const markdown = `<!-- zhixing-seed -->\n## 今天干了什么\n- 测试日报第 ${i + 1} 份（来源：人工输入）\n\n## 明天准备干什么\n- 继续测试第 ${i + 2} 份\n`
        await store.writeReport(date, markdown)
      }
      await store.refreshOverview()
      await store.appendLog('[测试] 生成测试数据', `目标 ${goalCount}、待办 ${todoCount}、日报 ${reportCount}，${Date.now() - started}ms`)
      json(res, 200, { ok: true, goals: goalCount, todos: todoCount, reports: reportCount, ms: Date.now() - started })
      return
    }

    if (method === 'POST' && suffix === '/debug/seed/clear') {
      await store.update('goals', { version: 1, items: [] }, (goals) => {
        goals.items = (goals.items ?? []).filter((goal) => !goal.seed)
        recomputeParents(goals.items)
        return goals
      })
      await store.update('todos', { version: 1, items: [] }, (todos) => {
        todos.items = (todos.items ?? []).filter((todo) => !todo.seed)
        return todos
      })
      let removed = 0
      try {
        for (const name of await fs.readdir(store.p('日报'))) {
          if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) continue
          const file = store.p('日报', name)
          const content = await fs.readFile(file, 'utf8')
          if (!content.includes('zhixing-seed')) continue
          await fs.unlink(file)
          removed += 1
        }
      } catch { /* 没有日报目录 */ }
      await store.refreshOverview()
      await store.appendLog('[测试] 清理测试数据', `日报 ${removed} 份`)
      json(res, 200, { ok: true, removedReports: removed })
      return
    }

    if (method === 'POST' && suffix === '/debug/client-error') {
      const body = await readBody(req).catch(() => ({}))
      const message = String(body.message ?? '').slice(0, 500)
      const stack = String(body.stack ?? '').slice(0, 2000)
      await store.appendLog('[前端错误]', `${message}${stack ? ` | ${stack.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`)
      json(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && suffix === '/debug/state') {
      const state = await store.getState()
      const settings = await store.getSettings()
      json(res, 200, {
        ok: true,
        dataDir,
        date: dateKey(),
        heartbeat: state.heartbeat,
        reminders: state.reminders?.[dateKey()] ?? {},
        aiUsage: state.aiUsage?.[dateKey()] ?? 0,
        lastNotify: state.lastNotify,
        pendingNotices: (state.notices ?? []).length,
        goalAlerts: state.goalAlerts?.[dateKey()] ?? {},
        time: nowStamp(),
      })
      return
    }

    if (method === 'POST' && suffix === '/debug/reset-reminders') {
      await store.update('state', { reminders: {} }, (current) => {
        current.reminders = {}
        current.goalAlerts = {}
        return current
      })
      await store.appendLog('[测试] 重置提醒状态', '清空 reminders / goalAlerts')
      json(res, 200, { ok: true })
      return
    }

    if (method === 'POST' && suffix === '/debug/model') {
      const body = await readBody(req)
      const next = {
        provider: String(body.provider ?? ''),
        model: String(body.model ?? ''),
        ...(body.reasoningEffort ? { reasoningEffort: String(body.reasoningEffort) } : {}),
      }
      if (!next.provider || !next.model) { json(res, 400, { ok: false, error: '需要 provider 与 model' }); return }
      if (body.scope === 'default') {
        await ctx.get('agentDefaultModel').saveSelection(next)
        json(res, 200, { ok: true, scope: 'default', selection: ctx.get('agentDefaultModel').currentSelection() })
        return
      }
      if (body.scope === 'plugin') {
        const settings = await store.saveSettings({ modelOverride: next })
        await store.appendLog('[测试] 插件模型', selectionLabel(next))
        json(res, 200, { ok: true, scope: 'plugin', override: settings.modelOverride })
        return
      }
      const sessions = ctx.get('sessions')
      const agents = (ctx.get('agents')?.list?.() ?? []).map((agent) => {
        const events = sessions?.get?.(agent.id)?.events
        return { agent, time: Array.isArray(events) && events.length ? events[events.length - 1]?.time ?? 0 : 0 }
      }).sort((a, b) => b.time - a.time)
      const target = agents[0]?.agent
      if (!target) { json(res, 400, { ok: false, error: '没有活跃会话可切换模型' }); return }
      target.model.select(next)
      await store.appendLog('[测试] 切换会话模型', selectionLabel({ ...next }))
      json(res, 200, { ok: true, scope: 'agent', sessionId: target.id, selection: target.model.current() })
      return
    }

    if (method === 'POST' && suffix === '/debug/llm') {
      const body = await readBody(req).catch(() => ({}))
      const llm = ctx.get('llm')
      if (!llm?.stream) { json(res, 400, { ok: false, error: '宿主没有 llm 服务' }); return }
      const settings = await store.getSettings()
      const model = resolveSelection(ctx, settings.modelOverride)
      const types = []
      const texts = []
      let finish = null
      const signal = AbortSignal.timeout(60_000)
      const stream = llm.stream({
        provider: model.provider,
        model: model.model,
        ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: model.reasoningEffort }),
        system: '你是一个测试助手，只回答 OK。',
        messages: [{ role: 'user', content: [{ type: 'text', text: String(body.prompt ?? '回复 OK') }] }],
        maxTokens: Number(body.maxTokens ?? 40),
        ...(model.sessionId ? { sessionId: model.sessionId } : {}),
        signal,
      })
      try {
        for await (const chunk of stream) {
          const type = String(chunk?.type ?? 'unknown')
          if (!types.includes(type)) types.push(type)
          if (typeof chunk?.text === 'string' && chunk.text) texts.push({ type, text: chunk.text.slice(0, 200) })
          if (type === 'finish') finish = chunk.reason ?? null
        }
      } catch (error) {
        json(res, 502, { ok: false, error: error instanceof Error ? error.message : String(error), types, texts, model, finish })
        return
      }
      json(res, 200, { ok: true, model, types, texts, finish })
      return
    }

    json(res, 404, { ok: false, error: `未知接口：${method} ${suffix}` })
  }

  return ctx.webServer.register({
    kind: 'prefix',
    path: api,
    handler(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const suffix = url.pathname.slice(api.length) || '/'
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { allow: 'GET,POST,OPTIONS' })
        res.end()
        return
      }
      Promise.resolve()
        .then(() => handle(req, res, suffix, url))
        .catch((error) => {
          console.error('[zhixing]', error)
          if (!res.headersSent) {
            // 业务错误统一 4xx（BUG-07）：优先用错误自带的 status（404 资源不存在），否则 400。
            const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 ? error.status : 400
            json(res, status, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        })
    },
  })
}
