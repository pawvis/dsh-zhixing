/**
 * 知行 · 中国法定节假日自动获取
 *
 * 数据源：NateScarlet/holiday-cn（按国务院公告整理），两个镜像；
 * 拉取后落 .internal/holidays.json，30 天内复用，失败保留旧缓存。
 * 手动 settings.holidays / extraWorkdays 只作为补充：手动节假日优先于自动调休。
 */
import fs from 'node:fs/promises'
import { dateKeyInZone } from './clock.js'

export const HOLIDAY_CACHE = '.internal/holidays.json'

/**
 * 固定可信数据源用普通 HTTPS 抓取（不走用户链接的 SSRF 私网拦截：
 * 代理 / VPN 的 fake-IP 常落在 198.18.0.0/15，会误伤）。
 */
async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'dsh-zhixing/holiday-cn', accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await response.text()
  if (text.length > 300_000) throw new Error('节假日数据过大')
  return text
}
const FRESH_MS = 30 * 86_400_000
const RETRY_MS = 6 * 3_600_000
const SOURCES = [
  (year) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
  (year) => `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`,
]

const inflight = new Map()
const lastAttempt = new Map()

export function emptyHolidayCache() {
  return { version: 1, years: {} }
}

async function readCache(store) {
  const data = await store.readJson(HOLIDAY_CACHE, emptyHolidayCache())
  if (!data || typeof data !== 'object' || Array.isArray(data)) return emptyHolidayCache()
  if (!data.years || typeof data.years !== 'object' || Array.isArray(data.years)) data.years = {}
  return data
}

async function writeCache(store, data) {
  await store.writeJson(HOLIDAY_CACHE, data)
}

/** holiday-cn JSON → {holidays, workdays, papers}。 */
export function parseHolidayCn(text) {
  let data = null
  try { data = JSON.parse(String(text ?? '')) } catch { throw new Error('节假日数据不是合法 JSON') }
  const days = Array.isArray(data?.days) ? data.days : []
  const holidays = new Set()
  const workdays = new Set()
  for (const day of days) {
    const date = String(day?.date ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    if (day?.isOffDay === true) holidays.add(date)
    else if (day?.isOffDay === false) workdays.add(date)
  }
  return {
    holidays: [...holidays].sort(),
    workdays: [...workdays].sort(),
    papers: Array.isArray(data?.papers) ? data.papers.map(String) : [],
  }
}

function yearOf(date = new Date()) {
  return Number(dateKeyInZone(date).slice(0, 4))
}

function fresh(entry, now = Date.now()) {
  if (!entry?.fetchedAt) return false
  const at = Date.parse(entry.fetchedAt)
  if (!Number.isFinite(at)) return false
  return now - at < (entry.holidays?.length ? FRESH_MS : RETRY_MS)
}

/**
 * 确保某年数据；优先缓存，过期后拉取；拉取失败保留旧数据。
 * @param {object} opts - fetchText 可注入（测试用）；force 强制刷新。
 */
export async function ensureHolidayYear(store, year, { force = false, fetchText: fetchImpl = fetchText, now = Date.now() } = {}) {
  const key = String(year)
  const cache = await readCache(store)
  const entry = cache.years[key]
  if (!force && fresh(entry, now)) return entry

  const attemptKey = `${store.root}:${key}`
  if (!force && !entry) {
    const last = lastAttempt.get(attemptKey) ?? 0
    if (now - last < RETRY_MS) throw new Error(`${year} 年节假日暂未获取到，稍后自动重试`)
  }
  if (!force && inflight.has(attemptKey)) return inflight.get(attemptKey)

  lastAttempt.set(attemptKey, now)
  const job = (async () => {
    let lastError = null
    for (const url of SOURCES.map((make) => make(year))) {
      try {
        const text = await fetchImpl(url)
        const parsed = parseHolidayCn(text)
        if (!parsed.holidays.length && !parsed.workdays.length) throw new Error('节假日数据为空')
        const next = {
          ...cache,
          years: {
            ...cache.years,
            [key]: { year, ...parsed, fetchedAt: new Date(now).toISOString(), source: url },
          },
        }
        await writeCache(store, next)
        return next.years[key]
      } catch (error) {
        lastError = error
      }
    }
    if (entry) return entry
    throw new Error(`节假日自动获取失败：${lastError instanceof Error ? lastError.message : String(lastError)}`)
  })()
  inflight.set(attemptKey, job)
  try { return await job } finally { inflight.delete(attemptKey) }
}

/** 一次确保多年（当前年 + 下一年）；失败的年份跳过。 */
export async function ensureHolidayYears(store, years, opts = {}) {
  const results = await Promise.allSettled((years ?? []).map((year) => ensureHolidayYear(store, year, opts)))
  return results.map((result, index) => ({ year: years[index], ok: result.status === 'fulfilled', entry: result.status === 'fulfilled' ? result.value : null, error: result.status === 'rejected' ? result.reason?.message : null }))
}

/** 读取缓存里的所有年份（不发起网络）。 */
export async function holidayCache(store) {
  return readCache(store)
}

/**
 * 把自动节假日合并进设置（不写盘）：
 * - 自动节假日 ∪ 手动节假日
 * - 自动调休 ∪ 手动调休，手动节假日优先
 */
export async function effectiveSettings(store, settings) {
  const cache = await readCache(store)
  const autoHolidays = new Set()
  const autoWorkdays = new Set()
  for (const entry of Object.values(cache.years ?? {})) {
    for (const date of entry?.holidays ?? []) autoHolidays.add(date)
    for (const date of entry?.workdays ?? []) autoWorkdays.add(date)
  }
  const manualHolidays = Array.isArray(settings?.holidays) ? settings.holidays : []
  const manualWorkdays = Array.isArray(settings?.extraWorkdays) ? settings.extraWorkdays : []
  const holidays = new Set([...autoHolidays, ...manualHolidays])
  const extraWorkdays = [...new Set([...autoWorkdays, ...manualWorkdays])].filter((date) => !holidays.has(date))
  return {
    ...settings,
    holidays: [...holidays].sort(),
    extraWorkdays: extraWorkdays.sort(),
  }
}

/** 设置页 / 接口用的状态；默认当前年 + 下一年。 */
export async function holidayStatus(store, { years, now = new Date() } = {}) {
  const cache = await readCache(store)
  const current = yearOf(now)
  const wanted = Array.isArray(years) && years.length ? years.map(Number).filter(Number.isInteger) : [current, current + 1]
  return {
    years: wanted.map((year) => {
      const entry = cache.years?.[String(year)]
      if (!entry) return { year, missing: true }
      return {
        year,
        holidays: entry.holidays ?? [],
        workdays: entry.workdays ?? [],
        fetchedAt: entry.fetchedAt,
        source: entry.source,
        papers: entry.papers ?? [],
        missing: false,
      }
    }),
  }
}

/** 手动刷新（设置页按钮 / 接口）。 */
export async function refreshHolidays(store, { years, now = new Date() } = {}) {
  const current = yearOf(now)
  const wanted = Array.isArray(years) && years.length ? years.map(Number).filter(Number.isInteger) : [current, current + 1]
  const results = await ensureHolidayYears(store, wanted, { force: true, now: Date.now() })
  return { ...(await holidayStatus(store, { years: wanted, now })), results }
}
