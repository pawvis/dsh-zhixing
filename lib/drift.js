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
import { addDays, assertDateKey, dateKey, ValidationError } from './store.js'
import { dateKeyInZone } from './clock.js'

const WEEK_RE = /^(\d{4})-W(\d{2})$/
const MAX_STREAK_WEEKS = 8
const AI_RECORD_PREFIXES = ['AI 更新', 'AI 批量更新', '采纳日报建议']

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
function stampDate(value) {
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
