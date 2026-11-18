/**
 * 知行 · 周工具与证据统计
 *
 * 偏航报告、今日 Boss、杠杆推荐共用同一套证据口径：
 * a. 采纳的进度建议（suggestions.json，accepted，decidedAt 在本周）
 * b. 本周日报的目标标签（report-meta.goalIds，每篇算 1 条）
 * c. 本周完成、且挂在该目标下的杠杆待办（levers.json + 待办.doneAt）
 * d. 本周人工进度更新记录（目标.json.records；AI 产生的记录不计）
 *
 * 所有日期与周键都按插件设置时区下的「日期键」计算，不依赖进程本地时区。
 */
import { addDays, assertDateKey, dateKey, nowStamp, ValidationError } from './store.js'
import fs from 'node:fs/promises'
import { dateKeyInZone, zoneParts } from './clock.js'
import { callModel, recordAiUsage, selectionLabel } from './ai.js'
import { parseJsonLoosely } from './goal-ai.js'
import { elapsedRatio, updateGoal } from './goals.js'
import { applyManualTodos } from './report.js'
import { appendIdentityEvidence, readNorthStar } from './northstar.js'
import { track } from './metrics.js'

const WEEK_RE = /^(\d{4})-W(\d{2})$/
const MAX_STREAK_WEEKS = 8
const AI_RECORD_PREFIXES = ['AI 更新', 'AI 批量更新', '采纳日报建议', '偏航报告建议']

/** 日期键 → ISO 周键（周一为一周开始）。 */
export function weekKeyOf(dateKeyValue) {
  const key = assertDateKey(dateKeyValue)
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const weekday = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - weekday + 3)
  const firstThursday = new Date(date.getFullYear(), 0, 4)
  const firstDay = (firstThursday.getDay() + 6) % 7
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3)
  const week = 1 + Math.round((date - firstThursday) / (7 * 86_400_000))
  return `${date.getFullYear()}-W${String(week).padStart(2, '0')}`
}

/** ISO 周键 → 周一到周日日期键；非法周键抛 400。 */
export function weekRange(weekKey) {
  const match = WEEK_RE.exec(String(weekKey ?? '').trim())
  if (!match) throw new ValidationError(`周键格式不对（应为 YYYY-Www，收到「${weekKey}」）`)
  const year = Number(match[1])
  const week = Number(match[2])
  if (!(week >= 1 && week <= 53)) throw new ValidationError(`周数不存在（收到「${weekKey}」）`)
  const jan4 = new Date(year, 0, 4)
  const monday = new Date(year, 0, 4 - ((jan4.getDay() + 6) % 7) + (week - 1) * 7)
  const from = dateKey(monday)
  if (weekKeyOf(from) !== `${year}-W${String(week).padStart(2, '0')}`) {
    throw new ValidationError(`周不存在（收到「${weekKey}」）`)
  }
  return { from, to: addDays(from, 6), week: `${year}-W${String(week).padStart(2, '0')}` }
}

/** 校验并规范化周键。 */
export function assertWeekKey(value) {
  return weekRange(value).week
}

export function currentWeekKey(now = new Date()) {
  return weekKeyOf(dateKeyInZone(now))
}

export function shiftWeek(weekKey, delta) {
  const { from } = weekRange(weekKey)
  return weekKeyOf(addDays(from, delta * 7))
}

/** 本地时间戳 / ISO 时间 → 日期键（按设置时区）。 */
export function stampDate(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return ''
  return dateKeyInZone(parsed)
}

function eachDay(from, to) {
  const days = []
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) days.push(cursor)
  return days
}

/** 工作日判定：与 lib/reminders.js 的 isWorkday 同口径；复制一份避免模块循环依赖。 */
function isWorkdayFor(settings, date) {
  const holidays = Array.isArray(settings?.holidays) ? settings.holidays : []
  const extraWorkdays = Array.isArray(settings?.extraWorkdays) ? settings.extraWorkdays : []
  if (extraWorkdays.includes(date)) return true
  if (holidays.includes(date)) return false
  if (settings?.skipWeekends === false) return true
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(year, month - 1, day).getDay()
  return weekday !== 0 && weekday !== 6
}

function isAiRecord(record) {
  const reason = String(record?.reason ?? '')
  return AI_RECORD_PREFIXES.some((prefix) => reason.startsWith(prefix))
}

/**
 * 计算某一周的四类证据。
 * @returns {{week:string, range:{from,to}, goals:Array, byGoal:Map<string,number>}}
 */
export async function computeWeekEvidence(store, weekKey, { withStreak = false } = {}) {
  const range = weekRange(weekKey)
  const week = range.week
  const days = eachDay(range.from, range.to)

  const [goals, todos, suggestionsFile, reportMeta, leversFile] = await Promise.all([
    store.listGoalItems(),
    store.listTodoItems(),
    store.readJson('.internal/suggestions.json', { version: 1, items: [] }),
    store.readJson('.internal/report-meta.json', { version: 1, items: {} }),
    store.readJson('.internal/levers.json', { version: 1, days: {} }),
  ])

  const goalById = new Map(goals.map((goal) => [goal.id, goal]))
  const todoById = new Map(todos.map((todo) => [todo.id, todo]))
  const isEffective = (goal) => goal
    && goal.paused !== true
    && (Number(goal.progress) || 0) < 100
    && String(goal.startDate ?? '') <= range.to
    && String(goal.endDate ?? '') >= range.from
  const effective = new Map(goals.filter((isEffective)).map((goal) => [goal.id, goal]))
  const raw = new Map([...effective.keys()].map((id) => [id, { suggestions: 0, reports: 0, levers: 0, records: 0 }]))

  // a. 采纳的进度建议
  for (const item of Array.isArray(suggestionsFile?.items) ? suggestionsFile.items : []) {
    if (item?.status !== 'accepted') continue
    const goalId = String(item.goalId ?? '')
    if (!raw.has(goalId)) continue
    const decided = stampDate(item.decidedAt ?? item.at)
    if (decided >= range.from && decided <= range.to) raw.get(goalId).suggestions += 1
  }

  // b. 本周日报的目标标签：每篇日报每个目标算 1 条
  for (const date of days) {
    const tagged = Array.isArray(reportMeta?.items?.[date]?.goalIds) ? reportMeta.items[date].goalIds : []
    if (!tagged.length) continue
    if (!(await store.hasReport(date))) continue
    for (const goalId of new Set(tagged.map(String))) {
      if (raw.has(goalId)) raw.get(goalId).reports += 1
    }
  }

  // c. 本周完成、且挂在目标下的杠杆待办（同一待办只算一次）
  const leverDone = new Set()
  for (const date of days) {
    const items = Array.isArray(leversFile?.days?.[date]?.items) ? leversFile.days[date].items : []
    for (const item of items) {
      const todo = todoById.get(String(item?.todoId ?? ''))
      if (!todo || todo.status !== '完成') continue
      const goalId = String(item?.goalId ?? '')
      if (!raw.has(goalId)) continue
      const doneDate = stampDate(todo.doneAt ?? todo.updatedAt)
      if (doneDate < range.from || doneDate > range.to) continue
      const key = `${goalId}:${todo.id}`
      if (leverDone.has(key)) continue
      leverDone.add(key)
      raw.get(goalId).levers += 1
    }
  }

  // d. 本周人工进度记录（AI 产生的 records 不计）
  for (const goal of effective.values()) {
    for (const record of Array.isArray(goal.records) ? goal.records : []) {
      if (isAiRecord(record)) continue
      const at = stampDate(record?.at)
      if (at >= range.from && at <= range.to) raw.get(goal.id).records += 1
    }
  }

  // 父目标证据 = 有效子目标证据之和（与 recomputeParents 的树结构一致）
  const childrenOf = new Map()
  for (const goal of goals) {
    if (!goal.parentId) continue
    const list = childrenOf.get(goal.parentId) ?? []
    list.push(goal)
    childrenOf.set(goal.parentId, list)
  }
  const totals = new Map()
  const totalOf = (goalId) => {
    if (totals.has(goalId)) return totals.get(goalId)
    const own = raw.get(goalId) ?? { suggestions: 0, reports: 0, levers: 0, records: 0 }
    let sum = own.suggestions + own.reports + own.levers + own.records
    for (const child of childrenOf.get(goalId) ?? []) {
      if (effective.has(child.id)) sum += totalOf(child.id)
    }
    totals.set(goalId, sum)
    return sum
  }

  const rows = [...effective.values()].map((goal) => {
    const own = raw.get(goal.id)
    const evidence = totalOf(goal.id)
    const sources = {
      suggestions: own.suggestions,
      reports: own.reports,
      levers: own.levers,
      records: own.records,
    }
    const signal = evidence >= 2 ? 'green' : evidence === 1 ? 'yellow' : 'red'
    return {
      goalId: goal.id,
      title: goal.title,
      cycle: goal.cycle,
      measure: goal.measure,
      endDate: goal.endDate,
      progress: Number(goal.progress) || 0,
      evidence,
      sources,
      signal,
      redStreak: signal === 'red' ? 1 : 0,
    }
  })

  if (withStreak) {
    const redRows = rows.filter((row) => row.signal === 'red')
    if (redRows.length) {
      // 先一次性回算前几周，避免每个目标重复读一遍数据。
      const history = new Map()
      let cursor = week
      for (let i = 1; i < MAX_STREAK_WEEKS; i += 1) {
        cursor = shiftWeek(cursor, -1)
        const previous = await computeWeekEvidence(store, cursor, { withStreak: false })
        history.set(cursor, previous.goals)
      }
      for (const row of redRows) {
        let streak = 1
        let walk = week
        for (let i = 1; i < MAX_STREAK_WEEKS; i += 1) {
          walk = shiftWeek(walk, -1)
          const found = (history.get(walk) ?? []).find((goal) => goal.goalId === row.goalId)
          if (found && found.evidence === 0) streak += 1
          else break
        }
        row.redStreak = streak
      }
    }
  }

  return { week, range: { from: range.from, to: range.to }, goals: rows, byGoal: totals }
}

/**
 * 本周杠杆统计（供偏航报告与 Boss 使用）。
 */
export async function computeWeekLevers(store, weekKey) {
  const range = weekRange(weekKey)
  const days = eachDay(range.from, range.to)
  const [settings, leversFile, todos] = await Promise.all([
    store.getSettings(),
    store.readJson('.internal/levers.json', { version: 1, days: {} }),
    store.listTodoItems(),
  ])
  const todoById = new Map(todos.map((todo) => [todo.id, todo]))
  let daysSet = 0
  let daysBelowMin = 0
  let daysAtMax = 0
  let total = 0
  let done = 0
  let mostPostponed = null
  for (const date of days) {
    if (!isWorkdayFor(settings, date)) continue
    const day = leversFile?.days?.[date]
    const items = Array.isArray(day?.items) ? day.items : []
    if (day?.candidateStatus === 'confirmed' && items.length) daysSet += 1
    if (items.length > 0 && items.length < 2) daysBelowMin += 1
    if (items.length >= 4) daysAtMax += 1
    for (const item of items) {
      total += 1
      const todo = todoById.get(String(item?.todoId ?? ''))
      if (todo?.status === '完成') done += 1
      const times = Array.isArray(todo?.postponedFrom) ? todo.postponedFrom.length : 0
      if (!mostPostponed || times > mostPostponed.times) mostPostponed = { todoId: item.todoId, title: todo?.content ?? '', times }
    }
  }
  const workdays = days.filter((date) => isWorkdayFor(settings, date)).length
  return { daysSet, workdays, daysBelowMin, daysAtMax, total, done, mostPostponed }
}


// ---------------------------------------------------------------------------
// 偏航报告（P0-3）
// ---------------------------------------------------------------------------

export const DRIFT_KEY = '.internal/drift.json'
export const DRIFT_DIR = '偏航'
const ADVICE_TYPES = new Set(['add_levers', 'extend', 'shrink', 'pause', 'keep'])
const AI_RECORD_PREFIX = /^(AI 更新|AI 批量更新|采纳日报建议)/
const MAX_ADVICE = 3

export function emptyDrift() {
  return { version: 1, weeks: {} }
}

async function readDrift(store) {
  const data = await store.readJson(DRIFT_KEY, emptyDrift())
  if (!data || typeof data !== 'object' || Array.isArray(data)) return emptyDrift()
  if (!data.weeks || typeof data.weeks !== 'object' || Array.isArray(data.weeks)) data.weeks = {}
  return data
}

async function saveDrift(store, data) {
  const keys = Object.keys(data.weeks ?? {}).sort()
  for (const key of keys.slice(0, Math.max(0, keys.length - 100))) delete data.weeks[key]
  await store.writeJson(DRIFT_KEY, data)
}

/** 只算统计，不调用 AI、不写报告。 */
export async function computeDriftSnapshot(store, week) {
  const range = weekRange(week)
  const [evidence, levers, todos] = await Promise.all([
    computeWeekEvidence(store, range.week, { withStreak: true }),
    computeWeekLevers(store, range.week),
    store.listTodoItems(),
  ])
  const completedTodos = todos
    .filter((todo) => todo.status === '完成')
    .map((todo) => ({ todoId: todo.id, content: todo.content, date: stampDate(todo.doneAt ?? todo.updatedAt), goalId: todo.goalId ?? null }))
    .filter((todo) => todo.date >= range.from && todo.date <= range.to)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
  return {
    week: range.week,
    range: { from: range.from, to: range.to },
    builtAt: null,
    goals: evidence.goals,
    levers,
    completedTodos,
    advice: [],
    identityPicks: [],
    note: '',
    savedAt: null,
  }
}

async function readWeekReports(store, range, { onlyRisks = false } = {}) {
  const parts = []
  for (let cursor = range.from; cursor <= range.to; cursor = addDays(cursor, 1)) {
    let markdown = ''
    try { markdown = await store.readReport(cursor) } catch { markdown = '' }
    if (!markdown) continue
    if (onlyRisks) {
      const match = /(^|\n)##\s*问题与风险\s*\n([\s\S]*?)(?=\n##\s|$)/.exec(markdown)
      if (match) parts.push(`### ${cursor}\n${match[2].trim()}`)
    } else {
      parts.push(`### ${cursor}\n${markdown}`)
    }
  }
  return parts.join('\n\n')
}

function needsAdvice(goals) {
  return (goals ?? []).some((goal) => goal.signal === 'red' || (Number(goal.redStreak) || 0) >= 2)
}

/** AI 起草修正建议（点「重新生成」或周日自动）。 */
export async function draftDriftAdvice(store, ctx, week) {
  const data = await readDrift(store)
  const snapshot = data.weeks[week]
  if (!snapshot) throw new ValidationError('这一周还没有统计快照，先点「重新统计」')
  if (!needsAdvice(snapshot.goals)) {
    snapshot.advice = Array.isArray(snapshot.advice) ? snapshot.advice.filter((item) => item.status !== 'pending') : []
    await saveDrift(store, data)
    return { advice: [], skipped: 'no-red-goals' }
  }
  const settings = await store.getSettings()
  const risks = await readWeekReports(store, snapshot.range, { onlyRisks: true })
  let direction = ''
  if (settings.northStar?.shareWithAI === true) {
    try {
      const northstar = await readNorthStar(store)
      direction = [northstar?.vision, ...(northstar?.rules ?? [])].filter(Boolean).join('；')
    } catch { direction = '' }
  }
  const goalLines = snapshot.goals.map((goal) => `- ${goal.goalId}｜${goal.title}｜${goal.cycle}｜证据 ${goal.evidence}｜连续 ${goal.redStreak} 周｜进度 ${goal.progress}%｜截止 ${goal.endDate}｜衡量：${goal.measure}`).join('\n')
  await recordAiUsage(store)
  const result = await callModel(ctx, {
    system: `你是「知行」的偏航报告教练。根据本周统计，给出最多 ${MAX_ADVICE} 条具体、可执行的修正建议。
只输出 JSON，不要代码围栏：{"advice":[{"type":"add_levers|extend|shrink|pause|keep","goalId":"…","count":2,"newEndDate":"YYYY-MM-DD","newMeasure":"…","text":"≤40 字","basis":"引用统计数字或日报原句","quote":"可选：日报原句"}]}
规则：
1. 只针对 🔴 或连续 🟡 的目标；最多 ${MAX_ADVICE} 条。
2. 语气平实，不评价人、不鼓励加班、不出现「失败」「懒」；不建议删除目标。
3. basis 必须引用统计里的数字或日报原句；quote 非空时必须是本周日报里的原句。`,
    user: `本周：${snapshot.range.from} ~ ${snapshot.range.to}${direction ? `\n方向参考（用户允许）：${direction}` : ''}\n\n目标统计：\n${goalLines}\n\n杠杆统计：\n- 设了 ${snapshot.levers.daysSet}/${snapshot.levers.workdays} 个工作日，完成 ${snapshot.levers.done}/${snapshot.levers.total}\n\n日报「问题与风险」：\n${risks.slice(0, 4000) || '（本周没有记录）'}`,
    maxTokens: 1500,
    override: settings.modelOverride,
  })
  const allReports = await readWeekReports(store, snapshot.range)
  const parsed = parseJsonLoosely(result.text)
  const list = Array.isArray(parsed) ? parsed : parsed?.advice
  const goalIds = new Set(snapshot.goals.map((goal) => goal.goalId))
  const kept = []
  for (const item of Array.isArray(list) ? list : []) {
    if (!goalIds.has(String(item?.goalId ?? ''))) continue
    const type = String(item?.type ?? '')
    if (!ADVICE_TYPES.has(type)) continue
    const quote = String(item?.quote ?? '').trim()
    if (quote && !allReports.includes(quote)) continue
    const text = String(item?.text ?? '').trim().slice(0, 60)
    if (!text) continue
    const advice = {
      id: `a-${Date.now().toString(36)}${kept.length}`,
      type,
      goalId: String(item.goalId),
      count: type === 'add_levers' ? Math.max(1, Math.min(4, Number(item?.count) || 2)) : undefined,
      newEndDate: type === 'extend' ? String(item?.newEndDate ?? '') : undefined,
      newMeasure: type === 'shrink' ? String(item?.newMeasure ?? '').trim().slice(0, 200) : undefined,
      text,
      basis: String(item?.basis ?? '').trim().slice(0, 200),
      quote,
      status: 'pending',
      decidedAt: null,
      model: selectionLabel(result.selection),
    }
    if (type === 'extend') {
      try { assertDateKey(advice.newEndDate) } catch { continue }
    }
    kept.push(advice)
    if (kept.length >= MAX_ADVICE) break
  }
  // 重新生成时清掉上一轮 pending，保留已采纳 / 已忽略。
  snapshot.advice = [...(snapshot.advice ?? []).filter((item) => item.status !== 'pending'), ...kept]
  await saveDrift(store, data)
  return { advice: kept, model: selectionLabel(result.selection) }
}

/** 生成统计快照，并按需自动起草建议。 */
export async function buildDrift(store, ctx, week, { autoAdvice = true } = {}) {
  const data = await readDrift(store)
  const snapshot = await computeDriftSnapshot(store, week)
  snapshot.builtAt = new Date().toISOString()
  snapshot.advice = []
  data.weeks[week] = snapshot
  await saveDrift(store, data)
  let advice = []
  if (autoAdvice && needsAdvice(snapshot.goals)) {
    try {
      const result = await draftDriftAdvice(store, ctx, week)
      advice = result.advice ?? []
    } catch (error) {
      await store.appendLog('偏航建议', `自动起草失败：${error.message}`)
    }
  }
  return { snapshot: (await readDrift(store)).weeks[week], advice }
}

/** 读取某周快照；没有生成过就返回即时计算的空快照（不写盘）。 */
export async function getDrift(store, week) {
  const data = await readDrift(store)
  const existing = data.weeks[week]
  if (existing) return { snapshot: existing, built: true }
  const snapshot = await computeDriftSnapshot(store, week)
  return { snapshot, built: false }
}

export async function listDriftReports(store) {
  let names = []
  try { names = await fs.readdir(store.p(DRIFT_DIR)) } catch { return [] }
  const items = []
  for (const name of names) {
    const match = /^(\d{4}-W\d{2})\.md$/.exec(name)
    if (!match) continue
    let stat = null
    try { stat = await fs.stat(store.p(DRIFT_DIR, name)) } catch { /* 忽略 */ }
    items.push({ week: match[1], name, mtime: stat?.mtimeMs ?? 0 })
  }
  return items.sort((a, b) => (a.week < b.week ? 1 : -1))
}

/** 采纳 / 忽略一条建议；动作由代码执行，不是 AI。 */
export async function decideDriftAdvice(store, week, id, action, payload = {}) {
  const data = await readDrift(store)
  const snapshot = data.weeks[week]
  if (!snapshot) throw new ValidationError('这一周还没有统计快照')
  const advice = (snapshot.advice ?? []).find((item) => item.id === id)
  if (!advice) throw new ValidationError('建议不存在')
  if (action === 'dismiss') {
    advice.status = 'dismissed'
    advice.decidedAt = nowStamp()
    await saveDrift(store, data)
    return { advice, decided: 'dismissed' }
  }
  if (action !== 'accept') throw new ValidationError('不支持的决定')
  const goal = (await store.listGoalItems()).find((item) => item.id === advice.goalId)
  if (!goal) throw new ValidationError('目标不存在')
  let clientAction = null

  if (advice.type === 'add_levers') {
    const count = Math.max(1, Math.min(4, Number(advice.count) || 2))
    let target = addDays(snapshot.range.to, 1)
    const today = dateKeyInZone(new Date())
    if (target < today) target = addDays(target, 7)
    while (new Date(`${target}T12:00:00`).getDay() !== 1) target = addDays(target, 1)
    const texts = Array.isArray(payload.texts) && payload.texts.length
      ? payload.texts.map((text) => String(text).trim()).filter(Boolean).slice(0, count)
      : Array.from({ length: count }, (_, index) => `推进「${goal.title}」${count > 1 ? `（${index + 1}）` : ''}`)
    const created = await applyManualTodos(store, { date: target, texts, source: `偏航:${week}` })
    const leversData = await store.readJson('.internal/levers.json', { version: 1, days: {} })
    leversData.days = leversData.days ?? {}
    const day = leversData.days[target] ?? { items: [], candidates: [], candidateStatus: null, confirmedAt: null, skipped: false }
    const existing = new Set((day.candidates ?? []).map((item) => String(item.todoId)))
    day.candidates = [...(day.candidates ?? []), ...created.filter((todo) => !existing.has(todo.id)).map((todo) => ({
      todoId: todo.id, goalId: goal.id, reason: '偏航报告建议', by: 'local', model: null,
    }))]
    if (day.candidateStatus !== 'confirmed' && day.candidateStatus !== 'skipped') day.candidateStatus = 'pending'
    leversData.days[target] = day
    await store.writeJson('.internal/levers.json', leversData)
    advice.status = 'accepted'
    advice.decidedAt = nowStamp()
    advice.createdTodos = created.map((todo) => todo.id)
    advice.targetDate = target
  } else if (advice.type === 'extend') {
    const newEndDate = assertDateKey(payload.newEndDate || advice.newEndDate)
    if (newEndDate < String(goal.startDate ?? '')) throw new ValidationError('结束日期不能早于开始日期')
    await updateGoal(store, goal.id, { endDate: newEndDate, reason: '偏航报告建议延期' })
    advice.status = 'accepted'
    advice.decidedAt = nowStamp()
    advice.appliedEndDate = newEndDate
  } else if (advice.type === 'pause') {
    await updateGoal(store, goal.id, { paused: true, reason: '偏航报告建议暂停' })
    advice.status = 'accepted'
    advice.decidedAt = nowStamp()
  } else if (advice.type === 'shrink') {
    advice.status = 'accepted'
    advice.decidedAt = nowStamp()
    clientAction = { type: 'shrink', goal, newMeasure: advice.newMeasure || goal.measure }
  } else {
    advice.status = 'accepted'
    advice.decidedAt = nowStamp()
  }
  await saveDrift(store, data)
  return { advice, decided: 'accepted', clientAction }
}

/** 保存本周报告（Markdown，人生面）。 */
export async function saveDriftReport(store, week, note = '') {
  const data = await readDrift(store)
  const snapshot = data.weeks[week]
  if (!snapshot) throw new ValidationError('这一周还没有统计快照，先点「重新统计」')
  snapshot.note = String(note ?? '').slice(0, 2000)
  snapshot.savedAt = new Date().toISOString()
  const lines = [`# 偏航报告 ${week}`, '', `> ${snapshot.range.from} ~ ${snapshot.range.to} · 生成于 ${snapshot.builtAt ?? ''}`, '', '## 一、目标证据', '']
  for (const goal of snapshot.goals) {
    const mark = goal.signal === 'green' ? '🟢' : goal.signal === 'yellow' ? '🟡' : '🔴'
    const streak = goal.signal === 'red' && goal.redStreak > 1 ? ` · 连续 ${goal.redStreak} 周 0 证据` : ''
    lines.push(`- ${mark} ${goal.title}（${goal.cycle}）证据 ${goal.evidence} · 进度 ${goal.progress}%${streak}`)
  }
  lines.push('', '## 二、杠杆', '', `- 设了 ${snapshot.levers.daysSet}/${snapshot.levers.workdays} 个工作日 · 完成 ${snapshot.levers.done}/${snapshot.levers.total}`)
  lines.push('', '## 三、修正建议', '')
  const advice = snapshot.advice ?? []
  if (!advice.length) lines.push('（本周没有修正建议）')
  for (const item of advice) {
    const status = item.status === 'accepted' ? '已采纳' : item.status === 'dismissed' ? '已忽略' : '待定'
    lines.push(`- [${status}] ${item.text}${item.basis ? `（依据：${item.basis}）` : ''}`)
  }
  lines.push('', '## 四、身份证据', '')
  if (!snapshot.identityPicks?.length) lines.push('（本周还没有勾选）')
  for (const pick of snapshot.identityPicks ?? []) lines.push(`- ${pick.date} ${pick.text}`)
  lines.push('', '## 五、我的一句话', '', snapshot.note || '（还没写）', '')
  await fs.mkdir(store.p(DRIFT_DIR), { recursive: true })
  const file = store.p(DRIFT_DIR, `${week}.md`)
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, lines.join('\n'), 'utf8')
  await fs.rename(tmp, file)
  await saveDrift(store, data)
  return { week, file, note: snapshot.note, savedAt: snapshot.savedAt }
}

/** 保存身份证据勾选：写快照 + 追加到 北极星/身份证据.md。 */
export async function saveDriftIdentity(store, week, picks = []) {
  const data = await readDrift(store)
  const snapshot = data.weeks[week]
  if (!snapshot) throw new ValidationError('这一周还没有统计快照')
  const normalized = (Array.isArray(picks) ? picks : []).map((pick) => ({
    ref: String(pick?.ref ?? ''),
    identityId: String(pick?.identityId ?? ''),
    text: String(pick?.text ?? '').slice(0, 120),
    date: assertDateKey(pick?.date || snapshot.range.to),
  })).filter((pick) => pick.ref && pick.identityId && pick.text)
  const result = await appendIdentityEvidence(store, normalized.map((pick) => ({
    identityId: pick.identityId,
    date: pick.date,
    text: pick.text,
    source: `偏航 ${week}`,
  })))
  snapshot.identityPicks = normalized
  await saveDrift(store, data)
  return { picks: normalized, appended: result.added }
}

/** 周日 20:00 生成（错过则下一次 tick 补生成一次）。 */
export async function maybeGenerateWeekly(store, ctx, { now = new Date(), deliver } = {}) {
  const settings = await store.getSettings()
  const at = now instanceof Date ? now : new Date(Number(now))
  const localDate = dateKeyInZone(at)
  const parts = new Date(`${localDate}T12:00:00`)
  const weekday = parts.getDay() // 0=周日
  const hour = Number(zoneParts(at).hour ?? 0)
  let lastSunday = localDate
  if (weekday === 0) {
    if (hour < 20) lastSunday = addDays(localDate, -7)
  } else {
    lastSunday = addDays(localDate, -weekday)
  }
  const week = weekKeyOf(lastSunday)
  const data = await readDrift(store)
  if (data.weeks[week]?.builtAt) return { week, skipped: '已生成' }
  const result = await buildDrift(store, ctx, week, { autoAdvice: true })
  const attention = (result.snapshot?.goals ?? []).filter((goal) => goal.signal === 'red').length
  if (typeof deliver === 'function') {
    await deliver(store, {
      kind: 'drift',
      title: '知行 · 偏航报告',
      body: `本周偏航报告已生成，${attention} 个目标需要看一眼。`,
    })
  }
  await store.appendLog('偏航报告', `${week} 生成，${attention} 个红色目标`)
  await track(store, 'driftBuild').catch(() => {})
  return { week, generated: true, attention }
}


// ---------------------------------------------------------------------------
// 今日 Boss（P0 小件）
// ---------------------------------------------------------------------------

async function latestGoalEvidence(store, goal, week) {
  const [suggestions, meta, levers, todos] = await Promise.all([
    store.readJson('.internal/suggestions.json', { items: [] }),
    store.readJson('.internal/report-meta.json', { items: {} }),
    store.readJson('.internal/levers.json', { days: {} }),
    store.listTodoItems(),
  ])
  const hits = []
  for (const item of suggestions.items ?? []) {
    if (item.goalId !== goal.id || item.status !== 'accepted') continue
    const date = stampDate(item.decidedAt ?? item.at)
    if (date) hits.push({ date, text: String(item.quote || item.reason || '').trim() })
  }
  for (const [date, entry] of Object.entries(meta.items ?? {})) {
    if (!Array.isArray(entry?.goalIds) || !entry.goalIds.includes(goal.id)) continue
    let markdown = ''
    try { markdown = await store.readReport(date) ?? '' } catch { markdown = '' }
    const line = markdown.split(/\r?\n/).map((item) => item.replace(/^\s*[-*+]\s*/, '').trim())
      .find((item) => item && !item.startsWith('#') && item.includes(goal.title))
      ?? markdown.split(/\r?\n/).map((item) => item.replace(/^\s*[-*+]\s*/, '').trim()).find((item) => item && !item.startsWith('#'))
    if (line) hits.push({ date, text: line.slice(0, 120) })
  }
  const todoById = new Map(todos.map((todo) => [todo.id, todo]))
  for (const [date, day] of Object.entries(levers.days ?? {})) {
    for (const item of day?.items ?? []) {
      if (item.goalId !== goal.id) continue
      const todo = todoById.get(String(item.todoId))
      if (!todo || todo.status !== '完成') continue
      hits.push({ date: stampDate(todo.doneAt ?? todo.updatedAt) || date, text: todo.content })
    }
  }
  for (const record of goal.records ?? []) {
    if (AI_RECORD_PREFIX.test(String(record?.reason ?? ''))) continue
    const date = stampDate(record?.at)
    if (date) hits.push({ date, text: String(record.reason ?? '').trim() })
  }
  return hits.filter((hit) => hit.text).sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null
}

/** 选今日 Boss：月目标、进行中、未暂停；按本周 0 证据 / 连续周数 / 时间过比例排序。 */
export async function pickBoss(store, { now = new Date() } = {}) {
  const at = now instanceof Date ? now : new Date(Number(now))
  const today = dateKeyInZone(at)
  const goals = await store.listGoalItems()
  const candidates = goals.filter((goal) => goal.cycle === '月'
    && goal.paused !== true
    && (Number(goal.progress) || 0) < 100
    && String(goal.startDate ?? '') <= today
    && String(goal.endDate ?? '') >= today)
  if (!candidates.length) return { boss: null, others: [], empty: true }
  let evidence = null
  try { evidence = await computeWeekEvidence(store, weekKeyOf(today), { withStreak: true }) } catch { evidence = null }
  const byId = new Map((evidence?.goals ?? []).map((goal) => [goal.goalId, goal]))
  const rows = []
  for (const goal of candidates) {
    const stat = byId.get(goal.id)
    const evidenceCount = stat?.evidence ?? 0
    const redStreak = stat?.redStreak ?? (evidenceCount === 0 ? 1 : 0)
    const progress = Number(goal.progress) || 0
    const elapsed = elapsedRatio(goal, at)
    const daysLeft = Math.ceil((new Date(`${goal.endDate}T23:59:59`).getTime() - at.getTime()) / 86_400_000)
    rows.push({
      goal,
      evidence: evidenceCount,
      redStreak,
      progress,
      daysLeft,
      score: (evidenceCount === 0 ? 1000 : 0) + redStreak * 10 + elapsed - progress / 100,
    })
  }
  rows.sort((a, b) => b.score - a.score || (a.goal.endDate < b.goal.endDate ? -1 : 1))
  const describe = async (row) => ({
    goalId: row.goal.id,
    title: row.goal.title,
    cycle: row.goal.cycle,
    measure: row.goal.measure,
    progress: row.progress,
    blood: Math.max(0, 100 - row.progress),
    evidence: row.evidence,
    redStreak: row.redStreak,
    daysLeft: row.daysLeft,
    endDate: row.goal.endDate,
    lastHit: await latestGoalEvidence(store, row.goal, weekKeyOf(today)),
  })
  return { boss: await describe(rows[0]), others: await Promise.all(rows.slice(1, 4).map(describe)), empty: false }
}
