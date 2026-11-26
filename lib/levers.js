/**
 * 知行 · 今日杠杆
 *
 * 每天 2–4 个能推动目标的待办。AI 只给候选，写不写由用户确认；
 * 候选 / 确认 / 跳过状态存 .internal/levers.json，待办本身不改字段。
 */
import { callModel, recordAiUsage, selectionLabel } from './ai.js'
import { parseJsonLoosely } from './goal-ai.js'
import { computeWeekEvidence, weekKeyOf } from './drift.js'
import { track } from './metrics.js'
import { readNorthStar } from './northstar.js'
import { addDays, assertDateKey, dateKey, nowStamp, ValidationError } from './store.js'

export const LEVER_MIN = 2
export const LEVER_MAX = 4
export const LEVERS_KEY = '.internal/levers.json'
const MAX_LEVER_REASON = 60

export function emptyLevers() {
  return { version: 1, days: {} }
}

async function readLevers(store) {
  const data = await store.readJson(LEVERS_KEY, emptyLevers())
  if (!data || typeof data !== 'object' || Array.isArray(data)) return emptyLevers()
  if (!data.days || typeof data.days !== 'object' || Array.isArray(data.days)) data.days = {}
  return data
}

function emptyDay() {
  return { items: [], candidates: [], candidateStatus: null, confirmedAt: null, skipped: false, topTodoId: null }
}

function dayOf(data, key) {
  const day = data.days?.[key]
  if (!day || typeof day !== 'object') return emptyDay()
  return {
    ...emptyDay(),
    ...day,
    items: Array.isArray(day.items) ? day.items : [],
    candidates: Array.isArray(day.candidates) ? day.candidates : [],
    // 2.2：当天唯一的第一重点；旧数据没有这个字段，按 null 处理。
    topTodoId: typeof day.topTodoId === 'string' && day.topTodoId ? day.topTodoId : null,
  }
}

async function saveLevers(store, data) {
  // 只保留最近 400 天，避免文件无限增长。
  const keys = Object.keys(data.days ?? {}).sort()
  for (const key of keys.slice(0, Math.max(0, keys.length - 400))) delete data.days[key]
  await store.writeJson(LEVERS_KEY, data)
}

/** 候选池：目标日期的待办 + 目标日期之前未完成的待办；排除已暂停目标的待办。 */
export function candidateTodos(todos, goals, date) {
  const paused = new Set((goals ?? []).filter((goal) => goal?.paused === true).map((goal) => goal.id))
  return (todos ?? []).filter((todo) => {
    if (!todo || todo.status === '完成') return false
    const isTarget = todo.date === date
    const isOverdue = String(todo.date ?? '') < date && todo.status === '未做'
    if (!isTarget && !isOverdue) return false
    if (todo.goalId && paused.has(todo.goalId)) return false
    return true
  })
}

/** 当前有效的叶子目标（AI 推荐只看叶子）。 */
export function activeLeafGoals(goals, date) {
  const list = (goals ?? []).filter((goal) => goal && goal.paused !== true && (Number(goal.progress) || 0) < 100
    && String(goal.startDate ?? '') <= date && String(goal.endDate ?? '') >= date)
  return list.filter((goal) => !list.some((child) => child.parentId === goal.id))
}

/** 当前有效、未暂停的目标（手动挂载与下拉用）。 */
export function activeGoals(goals, date) {
  return (goals ?? []).filter((goal) => goal && goal.paused !== true && (Number(goal.progress) || 0) < 100
    && String(goal.startDate ?? '') <= date && String(goal.endDate ?? '') >= date)
}

function enrichItem(item, todoById, goalById) {
  const todo = todoById.get(String(item?.todoId ?? ''))
  const goal = goalById.get(String(item?.goalId ?? ''))
  return {
    ...item,
    content: todo?.content ?? '（待办已删除）',
    status: todo?.status ?? '不存在',
    todoDate: todo?.date ?? null,
    goalTitle: goal?.title ?? null,
  }
}

/** 某天的杠杆状态（/state、/levers、杠杆卡共用）。 */
export async function leversState(store, date) {
  const key = assertDateKey(date)
  const [data, todos, goals] = await Promise.all([
    readLevers(store),
    store.listTodoItems(),
    store.listGoalItems(),
  ])
  const day = dayOf(data, key)
  const todoById = new Map(todos.map((todo) => [todo.id, todo]))
  const goalById = new Map(goals.map((goal) => [goal.id, goal]))
  const items = day.items.map((item) => enrichItem(item, todoById, goalById))
  const candidates = day.candidates.map((item) => enrichItem(item, todoById, goalById))
  const pool = candidateTodos(todos, goals, key).map((todo) => ({
    id: todo.id,
    content: todo.content,
    date: todo.date,
    status: todo.status,
    goalId: todo.goalId ?? null,
    postponed: Array.isArray(todo.postponedFrom) ? todo.postponedFrom.length : 0,
  }))
  const goalOptions = activeGoals(goals, key).map((goal) => ({ id: goal.id, title: goal.title, cycle: goal.cycle }))
  const done = items.filter((item) => item.status === '完成').length
  return {
    date: key,
    topTodoId: day.topTodoId,
    items,
    candidates,
    candidateStatus: day.candidateStatus,
    confirmedAt: day.confirmedAt,
    skipped: day.skipped === true,
    done,
    total: items.length,
    pool,
    goals: goalOptions,
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return []
  const seen = new Set()
  const out = []
  for (const raw of items) {
    const todoId = String(raw?.todoId ?? raw?.id ?? raw ?? '').trim()
    if (!todoId || seen.has(todoId)) continue
    seen.add(todoId)
    out.push({ todoId, goalId: raw?.goalId ? String(raw.goalId) : null })
  }
  return out
}

/** 确认今天的杠杆。0 条 = 今天不设；>4 条返回 400；1 条成功但带 below_min 提示。 */
export async function setLevers(store, { date, items }) {
  const key = assertDateKey(date)
  const normalized = normalizeItems(items)

  const [todos, goals, data] = await Promise.all([
    store.listTodoItems(),
    store.listGoalItems(),
    readLevers(store),
  ])
  const todoById = new Map(todos.map((todo) => [todo.id, todo]))
  const goalById = new Map(goals.map((goal) => [goal.id, goal]))
  const day = dayOf(data, key)
  // 已完成的杠杆不能取消（否则会丢当天的完成记录）；调整时保留，并计入 4 个上限。
  const preserved = day.items.filter((item) => todoById.get(String(item.todoId))?.status === '完成')
  const preservedIds = new Set(preserved.map((item) => String(item.todoId)))
  const fresh = normalized.filter((item) => !preservedIds.has(item.todoId))
  if (preserved.length + fresh.length > LEVER_MAX) {
    throw new ValidationError(`杠杆最多 ${LEVER_MAX} 个，先放下一个`)
  }
  if (!preserved.length && !fresh.length) return skipLevers(store, key)
  const candidateByTodo = new Map(day.candidates.map((item) => [String(item.todoId), item]))

  const itemsToSave = [...preserved]
  fresh.forEach((item, index) => {
    const todo = todoById.get(item.todoId)
    if (!todo) throw new ValidationError(`待办不存在：${item.todoId}`)
    if (todo.status === '完成') throw new ValidationError(`待办已完成，不能设为杠杆：${todo.content}`)
    let goalId = item.goalId
    if (goalId) {
      const goal = goalById.get(goalId)
      if (!goal) throw new ValidationError(`目标不存在：${goalId}`)
      if (goal.paused === true) throw new ValidationError(`目标已暂停，不能设为杠杆：${goal.title}`)
      if ((Number(goal.progress) || 0) >= 100) throw new ValidationError(`目标已完成，不能设为杠杆：${goal.title}`)
    } else if (todo.goalId && goalById.has(todo.goalId)) {
      goalId = todo.goalId
    }
    const candidate = candidateByTodo.get(item.todoId)
    itemsToSave.push({
      todoId: item.todoId,
      goalId,
      rank: preserved.length + index + 1,
      by: candidate?.by === 'ai' ? 'ai' : 'user',
    })
  })

  // 重新确认重点后，原第一重点如果不在新列表里就清空（不再代表当天重点）。
  const topTodoId = day.topTodoId && itemsToSave.some((item) => String(item.todoId) === String(day.topTodoId))
    ? day.topTodoId
    : null
  data.days[key] = {
    ...day,
    items: itemsToSave,
    candidateStatus: 'confirmed',
    confirmedAt: nowStamp(),
    skipped: false,
    topTodoId,
  }
  await saveLevers(store, data)
  await store.refreshOverview()
  return { date: key, items: itemsToSave, belowMin: itemsToSave.length < LEVER_MIN, hint: itemsToSave.length < LEVER_MIN ? 'below_min' : null }
}

/** 今天不设杠杆（0 条）。 */
export async function skipLevers(store, date) {
  const key = assertDateKey(date)
  const data = await readLevers(store)
  const day = dayOf(data, key)
  data.days[key] = {
    ...day,
    items: [],
    candidateStatus: 'skipped',
    confirmedAt: nowStamp(),
    skipped: true,
    // 没有重点就没有第一重点。
    topTodoId: null,
  }
  await saveLevers(store, data)
  await store.refreshOverview()
  return { date: key, items: [], skipped: true }
}

/**
 * 指定 / 取消当天的第一重点（2.2）。
 *
 * - todoId 必须是当天已确认的重点之一，否则 400；传 null 取消。
 * - 同一天只存 1 个，设新的自动覆盖旧的；不改任何一条的 rank。
 * - 当天第一次「从空设为非空」时计数 topLeverSet（改选另一条不重复计）。
 * - 读写与计数都放在同一个 levers 文件锁区间里，避免与页面其它写操作交错。
 */
export async function setTop(store, date, todoId) {
  const key = assertDateKey(date)
  if (todoId === undefined) throw new ValidationError('缺少 todoId（传 null 表示取消第一重点）')
  const target = todoId === null ? null : String(todoId).trim()
  if (target === '') throw new ValidationError('todoId 不能是空字符串（传 null 表示取消第一重点）')

  return store.withLock(LEVERS_KEY, async () => {
    const data = await readLevers(store)
    const day = dayOf(data, key)
    if (target !== null && !day.items.some((item) => String(item.todoId) === target)) {
      throw new ValidationError(`只能把当天已确认的重点设为第一重点：${target}`)
    }
    const previous = day.topTodoId
    if (previous === target) return { date: key, topTodoId: target }
    data.days[key] = { ...day, topTodoId: target }
    await saveLevers(store, data)
    if (!previous && target !== null) await track(store, 'topLeverSet').catch(() => {})
    return { date: key, topTodoId: target }
  })
}

/** AI（失败时本地）挑候选。只写 candidates，不写 items。 */
export async function suggestLevers(store, ctx, { date, matchGoals, force = false } = {}) {
  const key = assertDateKey(date)
  const [todos, goals, settings, data] = await Promise.all([
    store.listTodoItems(),
    store.listGoalItems(),
    store.getSettings(),
    readLevers(store),
  ])
  const day = dayOf(data, key)
  if (!force && (day.candidateStatus === 'confirmed' || day.candidateStatus === 'skipped')) {
    return { date: key, candidates: day.candidates, skipped: 'already-decided', by: null, model: null }
  }
  const pool = candidateTodos(todos, goals, key)
  const leaves = activeLeafGoals(goals, key)
  if (!pool.length) {
    data.days[key] = { ...day, candidates: [], candidateStatus: 'pending' }
    await saveLevers(store, data)
    return { date: key, candidates: [], by: 'empty', model: null }
  }

  let evidenceByGoal = new Map()
  try {
    const evidence = await computeWeekEvidence(store, weekKeyOf(key))
    evidenceByGoal = new Map(evidence.goals.map((row) => [row.goalId, row.evidence]))
  } catch { /* 证据统计失败不影响推荐 */ }

  const todoById = new Map(todos.map((todo) => [todo.id, todo]))
  const goalById = new Map(goals.map((goal) => [goal.id, goal]))
  const candidateLines = pool.map((todo) => {
    const target = goalById.get(todo.goalId)
    const postponed = Array.isArray(todo.postponedFrom) ? todo.postponedFrom.length : 0
    return `- ${todo.id}｜${todo.content}｜日期 ${todo.date}${postponed ? `｜已顺延 ${postponed} 次` : ''}${target ? `｜当前挂：${target.title}` : ''}`
  }).join('\n')
  const goalLines = leaves.map((goal) => {
    const evidence = evidenceByGoal.get(goal.id) ?? 0
    return `- ${goal.id}｜${goal.title}｜${goal.cycle}｜衡量：${goal.measure}｜进度 ${goal.progress}%｜截止 ${goal.endDate}｜本周证据 ${evidence}`
  }).join('\n')

  let direction = ''
  if (settings.northStar?.shareWithAI === true) {
    try { direction = (await readNorthStar(store))?.vision ?? '' } catch { direction = '' }
  }

  let candidates = null
  let by = 'local'
  let model = null
  try {
    await recordAiUsage(store)
    const result = await callModel(ctx, {
      system: `你是「知行」的今日杠杆推荐器。从候选待办里挑出 2-${LEVER_MAX} 个最能推动目标的杠杆。
只输出 JSON，不要代码围栏：{"levers":[{"todoId":"…","goalId":"…","reason":"≤20 字"}]}
规则：
1. 优先「截止近 + 本周 0 证据」的目标；给每个候选挂一个最相关的叶子目标。
2. 不要选纯事务性杂活（回邮件、报销、整理桌面），除非没有更合适的。
3. reason 要具体（引用目标或证据数），不要空话。`,
      user: `今天：${key}${direction ? `\n方向参考（用户允许）：${direction}` : ''}\n\n候选待办：\n${candidateLines}\n\n叶子目标：\n${goalLines || '（暂无有效叶子目标）'}`,
      maxTokens: 1200,
      override: settings.modelOverride,
    })
    model = selectionLabel(result.selection)
    const parsed = parseJsonLoosely(result.text)
    const list = Array.isArray(parsed) ? parsed : parsed?.levers
    if (Array.isArray(list)) {
      const poolIds = new Set(pool.map((todo) => todo.id))
      const goalIds = new Set(leaves.map((goal) => goal.id))
      const seen = new Set()
      const picked = []
      for (const item of list) {
        const todoId = String(item?.todoId ?? '')
        if (!poolIds.has(todoId) || seen.has(todoId)) continue
        const goalId = String(item?.goalId ?? '')
        if (!goalIds.has(goalId)) continue
        seen.add(todoId)
        picked.push({ todoId, goalId, reason: String(item?.reason ?? '').trim().slice(0, MAX_LEVER_REASON) || '推动目标', by: 'ai', model })
      }
      if (picked.length) {
        candidates = picked.slice(0, LEVER_MAX)
        by = 'ai'
      }
    }
  } catch { /* 落回本地匹配 */ }

  if (!candidates) {
    const picked = []
    const matched = []
    const rest = []
    for (const todo of pool) {
      const ids = typeof matchGoals === 'function' ? matchGoals(todo.content, leaves) : []
      const goalId = ids[0] ?? null
      const entry = { todoId: todo.id, goalId, reason: goalId ? '本地匹配到目标' : '今日待办', by: 'local', model: null }
      if (goalId) matched.push(entry)
      else rest.push(entry)
    }
    for (const entry of [...matched, ...rest]) {
      if (picked.length >= LEVER_MAX) break
      picked.push(entry)
    }
    candidates = picked
    by = 'local'
  }

  data.days[key] = { ...day, candidates, candidateStatus: 'pending' }
  await saveLevers(store, data)
  return { date: key, candidates, by, model }
}

/** 早安心语用的杠杆上下文（含待办状态）。 */
export async function morningLeverContext(store, date) {
  const key = assertDateKey(date)
  const [data, todos] = await Promise.all([readLevers(store), store.listTodoItems()])
  const day = dayOf(data, key)
  const todoById = new Map(todos.map((todo) => [todo.id, todo]))
  return day.items.map((item) => {
    const todo = todoById.get(String(item.todoId ?? ''))
    return {
      todoId: item.todoId,
      goalId: item.goalId ?? null,
      content: todo?.content ?? '（待办已删除）',
      status: todo?.status ?? '不存在',
      done: todo?.status === '完成',
    }
  }).filter((item) => item.status !== '不存在')
}
