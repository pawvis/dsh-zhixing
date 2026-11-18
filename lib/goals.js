/**
 * 知行 · 目标
 *
 * 层级：年度 → 季度 → 月度 → 周（也允许任意深度）。有子目标时进度默认由子目标平均值自动重算；
 * 手动设置后写入 manual，父级重算会跳过它。删除上级时解除子目标关联。
 */
import { dateKeyInZone, dayStartInZone, nowInZone, parseZonedStamp } from './clock.js'
import { addDays, dateKey, nowStamp, parseDateKey } from './store.js'

export const CYCLES = ['周', '月', '季度', '年']
export const CYCLE_RANK = { 周: 1, 月: 2, 季度: 3, 年: 4 }

/** 有子目标时禁止手动改进度（BUG-01）。 */
export class ProgressLockedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProgressLockedError'
    this.code = 'PROGRESS_LOCKED'
  }
}

let seq = 0
export function goalId(cycle = '周') {
  seq = (seq + 1) % 1000
  return `g-${cycle}-${Date.now().toString(36).slice(-5)}${String(seq).padStart(3, '0')}`
}

export function normalizeCycle(value) {
  const text = String(value ?? '').trim()
  if (/季|quarter|^q[1-4]$/i.test(text)) return '季度'
  if (/年|year/i.test(text)) return '年'
  if (/月|month/i.test(text)) return '月'
  if (/周|week/i.test(text)) return '周'
  return '周'
}

/** 按周期给出默认起止日期。 */
export function defaultRange(cycle, base = nowInZone()) {
  const cycleName = normalizeCycle(cycle)
  if (cycleName === '年') {
    return { startDate: `${base.getFullYear()}-01-01`, endDate: `${base.getFullYear()}-12-31` }
  }
  if (cycleName === '季度') {
    const y = base.getFullYear()
    const q = Math.floor(base.getMonth() / 3)
    return { startDate: dateKey(new Date(y, q * 3, 1)), endDate: dateKey(new Date(y, q * 3 + 3, 0)) }
  }
  if (cycleName === '月') {
    const y = base.getFullYear()
    const m = base.getMonth()
    const first = new Date(y, m, 1)
    const last = new Date(y, m + 1, 0)
    return { startDate: dateKey(first), endDate: dateKey(last) }
  }
  const day = base.getDay()
  const offset = day === 0 ? -6 : 1 - day
  const monday = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset)
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  return { startDate: dateKey(monday), endDate: dateKey(sunday) }
}

export function hasChildren(items, id) {
  return items.some((item) => item.parentId === id)
}

/** 子目标平均进度向上重算；叶子保持原值。 */
export function recomputeParents(items) {
  const childrenOf = new Map()
  for (const item of items) {
    if (!item.parentId) continue
    const list = childrenOf.get(item.parentId) ?? []
    list.push(item)
    childrenOf.set(item.parentId, list)
  }
  const depth = new Map()
  const visiting = new Set()
  const visitingNode = (id) => {
    if (depth.has(id)) return depth.get(id)
    if (visiting.has(id)) return 0
    visiting.add(id)
    const kids = childrenOf.get(id) ?? []
    const value = kids.length ? 1 + Math.max(...kids.map((kid) => visitingNode(kid.id))) : 0
    visiting.delete(id)
    depth.set(id, value)
    return value
  }
  for (const item of items) visitingNode(item.id)
  const ordered = [...items].sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0))
  for (const item of ordered) {
    if (item.manual === true) continue
    const kids = childrenOf.get(item.id) ?? []
    if (!kids.length) continue
    const avg = kids.reduce((sum, kid) => sum + (Number(kid.progress) || 0), 0) / kids.length
    item.progress = Math.round(avg)
    item.updatedAt = item.updatedAt ?? nowStamp()
  }
  return items
}

export function validateGoal(input, items, excludeId) {
  const title = String(input.title ?? '').trim()
  if (!title) throw new Error('目标标题不能为空')
  // BUG-03：cycle 必须是 年 / 季度 / 月 / 周，非法值直接报错，不静默降级为「周」。
  const rawCycle = String(input.cycle ?? '').trim()
  if (!CYCLES.includes(rawCycle)) throw new Error(`周期必须是「年」「季度」「月」「周」之一，收到「${rawCycle || '空'}」`)
  const cycle = normalizeCycle(rawCycle)
  const range = defaultRange(cycle)
  const startDate = String(input.startDate || range.startDate)
  const endDate = String(input.endDate || range.endDate)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('起止日期格式必须是 YYYY-MM-DD')
  if (parseDateKey(endDate) < parseDateKey(startDate)) throw new Error('结束日期不能早于开始日期')
  const parentId = input.parentId ? String(input.parentId) : null
  if (parentId && !items.some((item) => item.id === parentId)) throw new Error('上级目标不存在')
  if (parentId && excludeId && parentId === excludeId) throw new Error('上级目标不能是自己')
  if (parentId) {
    const parent = items.find((item) => item.id === parentId)
    if (parent && CYCLE_RANK[parent.cycle] <= CYCLE_RANK[cycle]) {
      throw new Error(`上级目标必须比当前目标层级更高（年 > 季度 > 月 > 周），不能把「${cycle}」目标挂到「${parent.cycle}」目标下`)
    }
  }
  if (parentId && excludeId) {
    // 防止把目标挂到自己的后代下面形成环。
    let cursor = parentId
    const seen = new Set()
    while (cursor) {
      if (cursor === excludeId) throw new Error('不能把目标挂到自己的子目标下面')
      if (seen.has(cursor)) break
      seen.add(cursor)
      cursor = items.find((item) => item.id === cursor)?.parentId ?? null
    }
  }
  const measure = String(input.measure ?? '').trim()
  if (!measure) throw new Error('请填写衡量方式，例如「完成 3 份标准文档」')
  // 详细说明：标题只放简短目标，具体内容 / 背景 / 交付物放这里。老数据没有就是空串。
  const detail = String(input.detail ?? '').trim().slice(0, 500)
  // 暂停是可选字段：暂停目标不推提醒、不进杠杆候选 / 偏航统计 / Boss。
  const paused = input.paused === true
  return { title, detail, cycle, startDate, endDate, parentId, measure, paused }
}

export async function createGoal(store, input) {
  let created = null
  await store.update('goals', { version: 1, items: [] }, (goals) => {
    goals.items = Array.isArray(goals.items) ? goals.items : []
    const fields = validateGoal(input, goals.items)
    created = {
      id: goalId(fields.cycle),
      ...fields,
      progress: Math.max(0, Math.min(100, Number(input.progress) || 0)),
      createdAt: nowStamp(),
      updatedAt: nowStamp(),
      records: [],
    }
    goals.items.push(created)
    recomputeParents(goals.items)
    return goals
  })
  await store.refreshOverview()
  return created
}

export async function updateGoal(store, id, patch) {
  let updated = null
  await store.update('goals', { version: 1, items: [] }, (goals) => {
    goals.items = Array.isArray(goals.items) ? goals.items : []
    const target = goals.items.find((item) => item.id === id)
    if (!target) { const e = new Error('目标不存在'); e.status = 404; throw e }
    // 手动进度优先：有子目标也允许手动设置，写入 manual 后父级重算会跳过它。
    const fields = validateGoal({ ...target, ...patch }, goals.items, id)
    // 改周期会改变自身层级：如果下面还挂着同级或更高的子目标，会写出非法树，直接拦住。
    if (target.cycle !== fields.cycle) {
      const conflicts = goals.items.filter((item) => item.parentId === id && (CYCLE_RANK[item.cycle] ?? 0) >= (CYCLE_RANK[fields.cycle] ?? 0))
      if (conflicts.length) {
        throw new Error(`「${target.title}」下面还有 ${conflicts.length} 个「${conflicts[0].cycle}」子目标，不能把周期改成「${fields.cycle}」；请先把这些子目标改到更低层级。`)
      }
    }
    Object.assign(target, fields)
    if (patch.progress !== undefined) {
      target.progress = Math.max(0, Math.min(100, Number(patch.progress) || 0))
      target.manual = true
      target.records = Array.isArray(target.records) ? target.records : []
      target.records.push({ at: nowStamp(), to: target.progress, reason: String(patch.reason ?? '手动更新') })
    }
    target.updatedAt = nowStamp()
    recomputeParents(goals.items)
    updated = target
    return goals
  })
  await store.refreshOverview()
  return updated
}

export async function deleteGoal(store, id, { withDescendants = false } = {}) {
  let removed = null
  let removedGoals = []
  let unlinked = 0
  await store.update('goals', { version: 1, items: [] }, (goals) => {
    goals.items = Array.isArray(goals.items) ? goals.items : []
    const target = goals.items.find((item) => item.id === id)
    if (!target) { const e = new Error('目标不存在'); e.status = 404; throw e }
    const doomed = new Set([id])
    if (withDescendants) {
      let grew = true
      while (grew) {
        grew = false
        for (const item of goals.items) {
          if (item.parentId && doomed.has(item.parentId) && !doomed.has(item.id)) {
            doomed.add(item.id)
            grew = true
          }
        }
      }
    }
    for (const item of goals.items) {
      if (!doomed.has(item.id) && item.parentId === id) { item.parentId = null; unlinked += 1 }
    }
    removedGoals = goals.items.filter((item) => doomed.has(item.id))
    goals.items = goals.items.filter((item) => !doomed.has(item.id))
    removed = target
    recomputeParents(goals.items)
    return goals
  })
  await store.refreshOverview()
  return { removed, removedGoals, unlinked }
}

/** 距离截止时间已过的比例（0~1+），超出 1 表示已过期。 */
export function elapsedRatio(goal, now = new Date()) {
  const start = dayStartInZone(goal.startDate)
  const end = dayStartInZone(addDays(goal.endDate, 1))
  const t = now.getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1
  return (t - start) / (end - start)
}

export function staleDaysOf(goal, now = new Date()) {
  const last = goal.updatedAt ? parseZonedStamp(goal.updatedAt) : NaN
  if (!Number.isFinite(last) || !last) return Infinity
  return (now.getTime() - last) / 86_400_000
}

export function staleMessage(goal, days) {
  return {
    title: '知行 · 目标提醒',
    body: `目标「${goal.title}」已经 ${days} 天没有更新了，这个进度你要关注一下。`,
  }
}

export function riskMessage(goal) {
  const percent = Math.round(Math.max(0, Math.min(1, elapsedRatio(goal))) * 100)
  return {
    title: '知行 · 目标风险',
    body: `目标「${goal.title}」有风险：时间已经过了 ${percent}%，进度只有 ${goal.progress}%。`,
  }
}

/**
 * 目标提醒检查：停滞（默认 3 天）与风险（时间过 80% 且进度 < 60%）。
 * 同一目标同一类提醒每天最多 1 次。
 */
export async function checkGoalAlerts(store, settings, { now = new Date(), deliver } = {}) {
  const goals = await store.listGoalItems()
  if (!goals.length) return { checked: 0, alerts: [] }
  const date = dateKeyInZone(now)
  const days = Number(settings.goalStaleDays) > 0 ? Number(settings.goalStaleDays) : 3
  const state = await store.getState()
  const sentToday = state.goalAlerts?.[date] ?? {}
  const alerts = []
  for (const goal of goals) {
    if (goal.paused === true) continue
    const ids = []
    const stale = staleDaysOf(goal, now)
    if (stale >= days && !(sentToday[goal.id] ?? []).includes('stale')) {
      ids.push('stale')
      alerts.push({ id: goal.id, kind: 'stale', ...staleMessage(goal, Math.floor(stale)) })
    }
    const ratio = elapsedRatio(goal, now)
    if (ratio >= 0.8 && (Number(goal.progress) || 0) < 60 && !(sentToday[goal.id] ?? []).includes('risk')) {
      ids.push('risk')
      alerts.push({ id: goal.id, kind: 'risk', ...riskMessage(goal) })
    }
    if (ids.length && deliver) {
      for (const alert of alerts.filter((item) => item.id === goal.id)) {
        await deliver(alert)
      }
      await store.update('state', { goalAlerts: {} }, (current) => {
        current.goalAlerts = current.goalAlerts ?? {}
        current.goalAlerts[date] = current.goalAlerts[date] ?? {}
        current.goalAlerts[date][goal.id] = [...(current.goalAlerts[date][goal.id] ?? []), ...ids]
        return current
      })
      await store.appendLog('目标提醒', `${goal.title} → ${ids.join('/')}`)
    }
  }
  return { checked: goals.length, alerts }
}
