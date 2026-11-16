/**
 * 知行 · 时区时钟
 *
 * 全插件以设置里的城市时区为准：电脑可以不在该国，但「今天」、时钟、提醒、
 * 吃什么、日报日期等都按该城市当地时间计算。城市未识别时退回系统时区。
 */

export const CITY_TZ = {
  北京: 'Asia/Shanghai', 上海: 'Asia/Shanghai', 广州: 'Asia/Shanghai', 深圳: 'Asia/Shanghai',
  成都: 'Asia/Shanghai', 杭州: 'Asia/Shanghai', 南京: 'Asia/Shanghai', 武汉: 'Asia/Shanghai',
  西安: 'Asia/Shanghai', 重庆: 'Asia/Shanghai', 天津: 'Asia/Shanghai', 苏州: 'Asia/Shanghai',
  长沙: 'Asia/Shanghai', 郑州: 'Asia/Shanghai', 青岛: 'Asia/Shanghai', 沈阳: 'Asia/Shanghai',
  大连: 'Asia/Shanghai', 厦门: 'Asia/Shanghai', 福州: 'Asia/Shanghai', 济南: 'Asia/Shanghai',
  合肥: 'Asia/Shanghai', 昆明: 'Asia/Shanghai', 南宁: 'Asia/Shanghai', 贵阳: 'Asia/Shanghai',
  太原: 'Asia/Shanghai', 石家庄: 'Asia/Shanghai', 哈尔滨: 'Asia/Shanghai', 长春: 'Asia/Shanghai',
  南昌: 'Asia/Shanghai', 海口: 'Asia/Shanghai', 兰州: 'Asia/Shanghai', 西宁: 'Asia/Shanghai',
  银川: 'Asia/Shanghai', 乌鲁木齐: 'Asia/Shanghai', 拉萨: 'Asia/Shanghai', 呼和浩特: 'Asia/Shanghai',
  香港: 'Asia/Hong_Kong', 澳门: 'Asia/Macau', 台北: 'Asia/Taipei',
  东京: 'Asia/Tokyo', 大阪: 'Asia/Tokyo', 首尔: 'Asia/Seoul', 新加坡: 'Asia/Singapore',
  曼谷: 'Asia/Bangkok', 雅加达: 'Asia/Jakarta', 马尼拉: 'Asia/Manila', 吉隆坡: 'Asia/Kuala_Lumpur',
  新德里: 'Asia/Kolkata', 孟买: 'Asia/Kolkata', 迪拜: 'Asia/Dubai', 莫斯科: 'Europe/Moscow',
  伦敦: 'Europe/London', 巴黎: 'Europe/Paris', 柏林: 'Europe/Berlin', 罗马: 'Europe/Rome',
  马德里: 'Europe/Madrid', 阿姆斯特丹: 'Europe/Amsterdam', 苏黎世: 'Europe/Zurich',
  纽约: 'America/New_York', 华盛顿: 'America/New_York', 波士顿: 'America/New_York',
  洛杉矶: 'America/Los_Angeles', 旧金山: 'America/Los_Angeles', 西雅图: 'America/Los_Angeles',
  芝加哥: 'America/Chicago', 多伦多: 'America/Toronto', 温哥华: 'America/Vancouver',
  墨西哥城: 'America/Mexico_City', 圣保罗: 'America/Sao_Paulo',
  悉尼: 'Australia/Sydney', 墨尔本: 'Australia/Melbourne', 珀斯: 'Australia/Perth',
  奥克兰: 'Pacific/Auckland',
}

let activeTimezone = ''

export function pad(n) { return String(n).padStart(2, '0') }

export function systemTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

export function isValidTimezone(tz) {
  if (!tz) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: String(tz) }); return true } catch { return false }
}

/** 城市名 → IANA 时区；支持「成都市」这种带后缀的输入。 */
export function tzForCity(city) {
  const text = String(city ?? '').trim()
  if (!text) return ''
  if (CITY_TZ[text]) return CITY_TZ[text]
  const found = Object.keys(CITY_TZ)
    .filter((name) => text.includes(name))
    .sort((a, b) => b.length - a.length)[0]
  return found ? CITY_TZ[found] : ''
}

/** 设置里的显式时区优先，其次按地区/城市推导，最后跟随系统。 */
export function resolveTimezone(settings = {}) {
  const city = String(settings.region || settings.weatherCity || '').trim()
  const mapped = tzForCity(city)
  if (mapped) return mapped
  const explicit = String(settings.timezone ?? '').trim()
  if (isValidTimezone(explicit)) return explicit
  return systemTimezone()
}

export function setActiveTimezone(tz) {
  activeTimezone = isValidTimezone(tz) ? String(tz) : ''
  return effectiveTimezone()
}

export function effectiveTimezone() {
  return activeTimezone || systemTimezone()
}

/** 把某个瞬间拆成目标时区的年月日时分秒。 */
export function zoneParts(date = new Date(), tz = effectiveTimezone()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const out = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') out[part.type] = part.value
  }
  return {
    year: Number(out.year), month: Number(out.month), day: Number(out.day),
    hour: Number(out.hour), minute: Number(out.minute), second: Number(out.second),
  }
}

export function dateKeyInZone(date = new Date(), tz = effectiveTimezone()) {
  const parts = zoneParts(date, tz)
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

/** 目标时区的「现在」，用本地 Date 承载，直接 getHours/getDate 即可得到当地时间。 */
export function nowInZone(tz = effectiveTimezone()) {
  const parts = zoneParts(new Date(), tz)
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
}

export function nowStampInZone(date = new Date(), tz = effectiveTimezone()) {
  const parts = zoneParts(date, tz)
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`
}

export function todayKey(tz = effectiveTimezone()) {
  return dateKeyInZone(new Date(), tz)
}

/** 目标时区某天 00:00 对应的 UTC 毫秒（迭代求偏移，兼容夏令时）。 */
export function zonedTimeToUtc(year, month, day, hour = 0, minute = 0, second = 0, tz = effectiveTimezone()) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, second)
  let guess = desired
  for (let i = 0; i < 4; i += 1) {
    const parts = zoneParts(new Date(guess), tz)
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    const offset = asUtc - guess
    const next = desired - offset
    if (next === guess) break
    guess = next
  }
  return guess
}

export function dayStartInZone(key, tz = effectiveTimezone()) {
  const [year, month, day] = String(key ?? '').split('-').map(Number)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return NaN
  return zonedTimeToUtc(year, month, day, 0, 0, 0, tz)
}

/** 解析「YYYY-MM-DD HH:mm:ss」这种按目标时区记录的时间戳。 */
export function parseZonedStamp(value, tz = effectiveTimezone()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value ?? ''))
  if (!match) return NaN
  return zonedTimeToUtc(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0), tz)
}

export function timeZoneName(tz = effectiveTimezone()) {
  try {
    const part = new Intl.DateTimeFormat('zh-CN', { timeZone: tz, timeZoneName: 'long' })
      .formatToParts(new Date()).find((item) => item.type === 'timeZoneName')
    return part?.value ?? tz
  } catch { return tz }
}
