/**
 * 知行 · 本地使用统计（只有数字，没有内容）
 *
 * 按天累计事件，保留 180 天；设置页「我的使用统计」只读最近 4 周。
 */
import { dateKeyInZone } from './clock.js'

const METRICS_KEY = '.internal/metrics.json'
const RETENTION_DAYS = 180

export function emptyMetrics() {
  return { version: 1, days: {} }
}

async function readMetrics(store) {
  const data = await store.readJson(METRICS_KEY, emptyMetrics())
  if (!data || typeof data !== 'object' || Array.isArray(data)) return emptyMetrics()
  if (!data.days || typeof data.days !== 'object' || Array.isArray(data.days)) data.days = {}
  return data
}

/** 记一个事件；只存数字。 */
export async function track(store, event, amount = 1, { now = new Date() } = {}) {
  const key = dateKeyInZone(now)
  const data = await readMetrics(store)
  const day = { ...(data.days[key] ?? {}) }
  day[event] = Number(day[event] ?? 0) + Number(amount || 0)
  data.days[key] = day
  const keys = Object.keys(data.days).sort()
  for (const old of keys.slice(0, Math.max(0, keys.length - RETENTION_DAYS))) delete data.days[old]
  await store.writeJson(METRICS_KEY, data)
  return { date: key, event }
}

/** 最近 N 周汇总（默认 4 周，含本周）。 */
export async function metricsSummary(store, { weeks = 4, now = new Date() } = {}) {
  const data = await readMetrics(store)
  const today = dateKeyInZone(now)
  const totals = {}
  let activeDays = 0
  for (let offset = weeks * 7 - 1; offset >= 0; offset -= 1) {
    const key = shiftKey(today, -offset)
    const day = data.days[key] ?? {}
    const values = Object.values(day).map(Number).filter((value) => Number.isFinite(value))
    if (values.some((value) => value > 0)) activeDays += 1
    for (const [name, value] of Object.entries(day)) {
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) continue
      totals[name] = (totals[name] ?? 0) + number
    }
  }
  const handled = (totals.adviceAccept ?? 0) + (totals.adviceDismiss ?? 0)
  return {
    weeks,
    from: shiftKey(today, -(weeks * 7 - 1)),
    to: today,
    activeDays,
    totals,
    adviceAcceptRate: handled ? Math.round(((totals.adviceAccept ?? 0) / handled) * 100) : null,
  }
}

function shiftKey(key, delta) {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day + delta)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
