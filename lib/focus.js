/**
 * 知行 · 专注块
 *
 * 计时以服务端存的 start 时间为准，页面只负责显示倒计时；刷新 / 关页面都不会丢。
 * 到点没结束的块由 sweep 补记（reminders tick 每 60 秒 + 每次 GET /focus），
 * sweep 幂等，且与 stop 共用同一把文件锁，不会重复写记录或重复计数。
 *
 * 数据：.internal/focus.json = { version: 1, running, records }
 * 记录口径：timeout / manual 计入专注分钟与 365 小时；abandon（手动结束且实际 <5 分钟）写记录但不计入。
 */
import { dateKeyInZone, zoneParts } from './clock.js'
import { leversState } from './levers.js'
import { track } from './metrics.js'

export const FOCUS_KEY = '.internal/focus.json'
export const PLANNED_MINUTES = [25, 45, 60, 90]
export const MIN_MANUAL_MINUTES = 5

const PLANNED_SET = new Set(PLANNED_MINUTES)
const MIN_RUNNING_MS = MIN_MANUAL_MINUTES * 60_000

function emptyFocus() {
  return { version: 1, running: null, records: [] }
}

function badRequest(message, code = 'focus_bad_request') {
  const error = new Error(message)
  error.status = 400
  error.code = code
  return error
}

function conflict(code, message) {
  const error = new Error(message)
  error.status = 409
  error.code = code
  return error
}

async function readFocus(store) {
  const data = await store.readJson(FOCUS_KEY, emptyFocus())
  if (!data || typeof data !== 'object' || Array.isArray(data)) return emptyFocus()
  return {
    version: 1,
    running: data.running && typeof data.running === 'object' && !Array.isArray(data.running) ? data.running : null,
    records: Array.isArray(data.records) ? data.records : [],
  }
}

async function saveFocus(store, data) {
  await store.writeJson(FOCUS_KEY, { version: 1, running: data.running ?? null, records: data.records ?? [] })
}

/** 记录实际时长：保留 1 位小数。 */
function roundMinutes(ms) {
  return Math.round(ms / 6000) / 10
}

function startMsOf(running) {
  return new Date(running.start).getTime()
}

function plannedMsOf(running) {
  return Number(running.plannedMinutes) * 60_000
}

/** 把 running 转成一条结束记录；endedBy 由实际耗时决定，never 传入 timeout 时强制超时。 */
function buildRecord(running, now, forceTimeout = false) {
  const startMs = startMsOf(running)
  const plannedMs = plannedMsOf(running)
  const elapsedMs = Math.max(0, now.getTime() - startMs)
  const timedOut = forceTimeout || elapsedMs >= plannedMs
  let endedBy
  let actualMs
  let endMs
  if (timedOut) {
    endedBy = 'timeout'
    actualMs = plannedMs
    endMs = startMs + plannedMs
  } else if (elapsedMs < MIN_RUNNING_MS) {
    endedBy = 'abandon'
    actualMs = elapsedMs
    endMs = now.getTime()
  } else {
    endedBy = 'manual'
    actualMs = elapsedMs
    endMs = now.getTime()
  }
  return {
    endedBy,
    record: {
      id: String(running.id),
      date: String(running.date),
      start: String(running.start),
      end: new Date(endMs).toISOString(),
      plannedMinutes: Number(running.plannedMinutes),
      actualMinutes: roundMinutes(actualMs),
      endedBy,
      todoId: running.todoId ?? null,
      goalId: running.goalId ?? null,
      isTop: running.isTop === true,
    },
  }
}

/** 落记录 + 计数；调用方必须已经持有 focus 文件锁。 */
async function commitRecord(store, data, record) {
  data.running = null
  data.records = [...(data.records ?? []), record]
  await saveFocus(store, data)
  const event = record.endedBy === 'timeout' ? 'focusTimeout' : record.endedBy === 'manual' ? 'focusManual' : 'focusAbandon'
  await track(store, event).catch(() => {})
  // abandon 照样写记录，但不计入专注分钟（验收 2-4 / 2-9）。
  if (record.endedBy !== 'abandon') await track(store, 'focusMinutes', record.actualMinutes).catch(() => {})
}

/** 已持有锁时的超时补记；幂等：running 为空直接返回 null。 */
async function sweepLocked(store, data, now) {
  const running = data.running
  if (!running) return null
  if (now.getTime() < startMsOf(running) + plannedMsOf(running)) return null
  const { record } = buildRecord(running, now, true)
  await commitRecord(store, data, record)
  return record
}

/**
 * 读取专注状态：先 sweep 补记超时，再算剩余秒数与今日专注分钟。
 * @returns {{ running: object|null, remainingSec: number|null, todayMinutes: number }}
 */
export async function getState(store, now = new Date()) {
  return store.withLock(FOCUS_KEY, async () => {
    const data = await readFocus(store)
    await sweepLocked(store, data, now)
    let remainingSec = null
    if (data.running) {
      const endMs = startMsOf(data.running) + plannedMsOf(data.running)
      remainingSec = Math.max(0, Math.ceil((endMs - now.getTime()) / 1000))
    }
    return {
      running: data.running,
      remainingSec,
      todayMinutes: todayMinutes(data.records, dateKeyInZone(now)),
    }
  })
}

/**
 * 开始一个专注块。同一时间只能有 1 个；已有则 409。
 * todoId 若给出必须是当天已确认重点，goalId / isTop 由服务端从 levers.json 填。
 */
export async function start(store, { todoId = null, plannedMinutes = 60 } = {}, now = new Date()) {
  const planned = Number(plannedMinutes)
  if (!PLANNED_SET.has(planned)) {
    throw badRequest(`计划时长只能是 ${PLANNED_MINUTES.join(' / ')} 分钟`, 'focus_planned')
  }
  const requestedTodoId = todoId === null || todoId === undefined || String(todoId).trim() === '' ? null : String(todoId).trim()

  return store.withLock(FOCUS_KEY, async () => {
    const data = await readFocus(store)
    // 先补记已经超时的旧块，避免它把新块卡在 409。
    await sweepLocked(store, data, now)
    if (data.running) throw conflict('focus_running', '已有专注进行中，先结束当前这个')

    const date = dateKeyInZone(now)
    let goalId = null
    let isTop = false
    if (requestedTodoId) {
      const day = await leversState(store, date)
      const item = day.items.find((entry) => String(entry.todoId) === requestedTodoId)
      if (!item) throw badRequest('只能给当天已确认的重点开专注', 'focus_not_lever')
      goalId = item.goalId ?? null
      isTop = String(day.topTodoId ?? '') === requestedTodoId
    }

    const running = {
      id: makeId(now),
      date,
      start: now.toISOString(),
      plannedMinutes: planned,
      todoId: requestedTodoId,
      goalId,
      isTop,
    }
    data.running = running
    await saveFocus(store, data)
    await track(store, 'focusStart').catch(() => {})
    return running
  })
}

/**
 * 结束当前专注块。没有进行中的块返回 409。
 * 实际 <5 分钟记 abandon；≥5 分钟记 manual；超过计划结束时间记 timeout（实际时长按计划时长）。
 */
export async function stop(store, now = new Date()) {
  return store.withLock(FOCUS_KEY, async () => {
    const data = await readFocus(store)
    if (!data.running) throw conflict('focus_idle', '现在没有进行中的专注')
    const { record } = buildRecord(data.running, now, false)
    await commitRecord(store, data, record)
    return record
  })
}

/**
 * 超时补记：running 已过计划结束时间就写 timeout。幂等。
 * 由 reminders tick（每 60 秒）和每次 GET /focus 调用。
 */
export async function sweep(store, now = new Date()) {
  return store.withLock(FOCUS_KEY, async () => {
    const data = await readFocus(store)
    return sweepLocked(store, data, now)
  })
}

/** 某天的专注分钟 = 当天 timeout + manual 记录的 actualMinutes 之和（abandon 不计）。 */
export function todayMinutes(records, date) {
  const key = String(date ?? '')
  const sum = (records ?? [])
    .filter((record) => record && record.date === key && (record.endedBy === 'timeout' || record.endedBy === 'manual'))
    .reduce((total, record) => total + (Number(record.actualMinutes) || 0), 0)
  return Math.round(sum * 10) / 10
}

/**
 * 汇总（预留给 P1-1 的 365 小时视图，本期不接 UI）。
 * 小时 = timeout + manual 记录分钟和 ÷ 60，保留 1 位小数。
 */
export function summarize(records, { from = '', to = '' } = {}) {
  const rows = (records ?? []).filter((record) => record
    && (record.endedBy === 'timeout' || record.endedBy === 'manual')
    && (!from || String(record.date) >= String(from))
    && (!to || String(record.date) <= String(to)))
  const minutes = rows.reduce((total, record) => total + (Number(record.actualMinutes) || 0), 0)
  return {
    minutes: Math.round(minutes * 10) / 10,
    hours: Math.round((minutes / 60) * 10) / 10,
    count: rows.length,
  }
}

function makeId(now) {
  const parts = zoneParts(now)
  const stamp = `${parts.year}${String(parts.month).padStart(2, '0')}${String(parts.day).padStart(2, '0')}_${String(parts.hour).padStart(2, '0')}${String(parts.minute).padStart(2, '0')}`
  return `f_${stamp}_${Math.random().toString(36).slice(2, 6)}`
}
