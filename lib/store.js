/**
 * 知行 · 数据层
 *
 * 所有工作区共用 ${DSH_HOME}/data/知行/。写入采用「临时文件 + rename」，
 * 并对同一文件加写锁，避免页面与定时任务同时改 待办.json / 目标.json。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { dateKeyInZone, nowStampInZone, resolveTimezone, setActiveTimezone, todayKey } from './clock.js'
import { DEFAULT_TEMPLATE, validateTemplate } from './report-html.js'

export const TODO_STATUS = ['未做', '完成', '顺延']

/** 锁文件超过这个时间没更新，视为持锁进程已崩溃留下的残留锁。 */
const LOCK_STALE_MS = 30_000

export function pad(n) { return String(n).padStart(2, '0') }

/** 日期 YYYY-MM-DD：不传参数时是插件时区的「今天」，传 Date 时按本地日历格式化。 */
export function dateKey(d) {
  if (d === undefined) return todayKey()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number)
  return dateKey(new Date(y, m - 1, d + n))
}

export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 日期参数统一校验：必须是 YYYY-MM-DD 且是真实存在的日期，否则抛 400。 */
export function assertDateKey(value) {
  const text = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ValidationError(`日期格式不对（应为 YYYY-MM-DD，收到「${text}」）`)
  }
  const [year, month, day] = text.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    throw new ValidationError(`日期不存在（收到「${text}」）`)
  }
  return text
}

/** 时间戳：不传参数时用插件时区；传 Date 时保留本地日历语义。 */
export function nowStamp(d) {
  if (d === undefined) return nowStampInZone()
  return `${dateKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export { todayKey }

export function weekdayOf(key) {
  return parseDateKey(key).getDay() // 0=周日
}

/** 资源不存在：统一 HTTP 404（BUG-07）。 */
export class NotFoundError extends Error {
  constructor(message) {
    super(message)
    this.name = 'NotFoundError'
    this.status = 404
  }
}

/** 参数非法：统一 HTTP 400（BUG-07）。 */
export class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ValidationError'
    this.status = 400
  }
}

/** 合法 HH:mm：小时 00–23，分钟 00–59（BUG-02）。 */
export function isValidHHmm(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function minutesOfDay(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

export const DEFAULT_SETTINGS = {
  morningTime: '09:00',
  eveningTime: '18:00',
  skipWeekends: true,
  holidays: [],
  extraWorkdays: [],
  aiEnabled: true,
  modelOverride: null,
  goalStaleDays: 3,
  weatherCity: '',
  region: '',
  timezone: '',
  weatherEnabled: true,
  clockFormat: '24',
  clockSeconds: false,
  themeMode: 'host',
  themeManual: 'light',
  themeLightStart: '07:00',
  themeLightEnd: '19:00',
  collectMaxItems: 60,
  collectMaxChars: 4000,
}

export const DEFAULT_STATE = {
  reminders: {},
  aiUsage: {},
  lastNotify: null,
  heartbeat: null,
  notices: [],
}

const OWNED_KEYS = {
  todos: '待办.json',
  goals: '目标.json',
  settings: 'settings.json',
  state: 'state.json',
  suggestions: '.internal/suggestions.json',
  reportMeta: '.internal/report-meta.json',
}

export class Store {
  constructor(dataDir) {
    this.root = dataDir
    this.locks = new Map()
    this.queue = Promise.resolve()
  }

  p(...parts) { return path.join(this.root, ...parts) }

  async init() {
    if (!this._ready) this._ready = this._init()
    return this._ready
  }

  async _init() {
    for (const dir of [this.root, this.p('日报'), this.p('汇总'), this.p('导入'), this.p('模板'), this.p('.internal'), this.p('.internal', 'collect')]) {
      await fs.mkdir(dir, { recursive: true })
    }
    // 兼容 0.1.0 早期的英文文件名，迁移到规范中文名。
    for (const [from, to] of [['todos.json', '待办.json'], ['goals.json', '目标.json']]) {
      try {
        await fs.access(this.p(from))
        try { await fs.access(this.p(to)) } catch { await fs.rename(this.p(from), this.p(to)) }
      } catch { /* 没有旧文件 */ }
    }
    for (const [key, file] of Object.entries(OWNED_KEYS)) {
      try { await fs.access(this.p(file)) } catch {
        const seed = key === 'settings' ? DEFAULT_SETTINGS : key === 'state' ? DEFAULT_STATE : key === 'reportMeta' ? { version: 1, items: {} } : { version: 1, items: [] }
        await this.writeJson(key, seed)
      }
    }
    try { await fs.access(this.p('log.md')) } catch { await fs.writeFile(this.p('log.md'), '# 知行日志\n\n', 'utf8') }
    try { await fs.access(this.p('待办与目标总览.md')) } catch { await this.writeOverview([], []) }
    try { await fs.access(this.templatePath()) } catch { await fs.writeFile(this.templatePath(), DEFAULT_TEMPLATE, 'utf8') }
    // 初始化时就把设置里的地区时区装进进程时钟。
    await this.getSettings()
  }

  async readJson(key, fallback = null) {
    const file = this.p(OWNED_KEYS[key] ?? key)
    try {
      const raw = await fs.readFile(file, 'utf8')
      return JSON.parse(raw)
    } catch (error) {
      if (fallback !== null) return structuredClone(fallback)
      throw error
    }
  }

  /** 原子写：同目录 tmp + rename。 */
  async writeJson(key, value) {
    const file = this.p(OWNED_KEYS[key] ?? key)
    await fs.mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await fs.rename(tmp, file)
    return file
  }

  /** 进程内串行 + 文件锁（'wx'），避免页面与定时任务并发覆盖。 */
  async withLock(key, fn) {
    const prev = this.locks.get(key) ?? Promise.resolve()
    let release
    const next = new Promise((resolve) => { release = resolve })
    this.locks.set(key, prev.then(() => next))
    await prev
    let handle
    const lockFile = this.p(`${OWNED_KEYS[key] ?? key}.lock`)
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    try {
      for (let i = 0; i < 50; i += 1) {
        try {
          handle = await fs.open(lockFile, 'wx')
          break
        } catch (error) {
          if (error.code !== 'EEXIST') throw error
          // 持锁进程崩溃时不会删锁：mtime 超过 30 秒视为残留，删掉后立即重试。
          let stat = null
          try { stat = await fs.stat(lockFile) } catch { continue }
          if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
            await fs.unlink(lockFile).catch(() => {})
            continue
          }
          await new Promise((r) => setTimeout(r, 20))
        }
      }
      if (!handle) throw new Error(`写入繁忙，请稍后重试：${key}`)
      // 锁文件里写明 pid 与获取时间，便于排查是谁一直持锁。
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token })}\n`, 'utf8').catch(() => {})
      return await fn()
    } finally {
      if (handle) {
        await handle.close().catch(() => {})
        // 只删自己拿到的锁：残留锁被其他进程清理并重新创建后，不能误删别人的。
        try {
          const raw = await fs.readFile(lockFile, 'utf8')
          if (raw.includes(token)) await fs.unlink(lockFile)
        } catch { /* 锁已被清理 */ }
      }
      release()
    }
  }

  async update(key, fallback, mutate) {
    return this.withLock(key, async () => {
      const current = await this.readJson(key, fallback)
      const result = await mutate(current)
      await this.writeJson(key, current)
      return result
    })
  }

  async getSettings() {
    const saved = await this.readJson('settings', DEFAULT_SETTINGS)
    const merged = { ...DEFAULT_SETTINGS, ...saved }
    // 每次读取设置都同步全进程时钟；地区改了之后不用重启插件就生效。
    setActiveTimezone(resolveTimezone(merged))
    return merged
  }

  async saveSettings(patch) {
    // BUG-02：提醒时间必须是合法 HH:mm（00–23 : 00–59），非法值在写入前拒绝。
    for (const key of ['morningTime', 'eveningTime']) {
      if (patch[key] === undefined) continue
      if (!isValidHHmm(patch[key])) {
        const error = new Error(`${key === 'morningTime' ? '早安提醒' : '日报提醒'}时间必须是 HH:mm 格式（00:00–23:59），收到「${patch[key]}」`)
        error.code = 'INVALID_TIME'
        throw error
      }
    }
    const merged = await this.update('settings', DEFAULT_SETTINGS, (current) => {
      for (const [k, v] of Object.entries(patch)) {
        if (k in DEFAULT_SETTINGS) current[k] = v
      }
      return { ...DEFAULT_SETTINGS, ...current }
    })
    setActiveTimezone(resolveTimezone(merged))
    return merged
  }

  async getState() {
    const saved = await this.readJson('state', DEFAULT_STATE)
    return {
      ...structuredClone(DEFAULT_STATE),
      ...saved,
      reminders: saved.reminders ?? {},
      aiUsage: saved.aiUsage ?? {},
      notices: saved.notices ?? [],
    }
  }

  async patchState(patch) {
    return this.update('state', DEFAULT_STATE, (current) => {
      Object.assign(current, patch)
      return current
    })
  }

  async appendLog(action, result) {
    const line = `${nowStamp()} | ${action} | ${String(result).replace(/\s*\n\s*/g, ' ')}\n`
    await this.withLock('log', async () => {
      await fs.appendFile(this.p('log.md'), line, 'utf8')
    })
  }

  reportPath(date) { return this.p('日报', `${date}.md`) }

  async readReport(date) {
    try { return await fs.readFile(this.reportPath(date), 'utf8') } catch { return null }
  }

  async writeReport(date, markdown) {
    const file = this.reportPath(date)
    const tmp = `${file}.${process.pid}.tmp`
    await fs.writeFile(tmp, markdown, 'utf8')
    await fs.rename(tmp, file)
    return file
  }

  async hasReport(date) {
    try { await fs.access(this.reportPath(date)); return true } catch { return false }
  }

  collectPath(date) { return this.p('.internal', 'collect', `${date}.json`) }

  async readCollect(date) {
    try { return JSON.parse(await fs.readFile(this.collectPath(date), 'utf8')) } catch { return null }
  }

  async writeCollect(date, data) {
    const file = this.collectPath(date)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    return file
  }

  templatePath() { return this.p('模板', '日报.html') }

  summaryPath(name) { return this.p('汇总', name) }

  async readTemplate() {
    try { return await fs.readFile(this.templatePath(), 'utf8') } catch { return DEFAULT_TEMPLATE }
  }

  async writeTemplate(text) {
    const value = validateTemplate(text)
    const file = this.templatePath()
    const tmp = `${file}.${process.pid}.tmp`
    await fs.writeFile(tmp, value, 'utf8')
    await fs.rename(tmp, file)
    return file
  }

  /**
   * 重置为默认模板。若当前模板与默认模板不同，先备份为 `日报.html.bak-<时间戳>`；
   * 备份失败则抛错且不修改模板文件（BUG-05）。
   * 返回 { text, backup }：backup 为备份文件名，无备份时为 null。
   */
  async resetTemplate() {
    const file = this.templatePath()
    let current = null
    try { current = await fs.readFile(file, 'utf8') } catch { current = null }
    let backup = null
    if (current !== null && current !== DEFAULT_TEMPLATE) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      backup = `日报.html.bak-${stamp}`
      try {
        await fs.writeFile(this.p('模板', backup), current, { encoding: 'utf8', flag: 'wx' })
      } catch (error) {
        const wrapped = new Error('备份失败，未重置')
        wrapped.code = 'TEMPLATE_BACKUP_FAILED'
        wrapped.cause = error
        throw wrapped
      }
    }
    await fs.writeFile(file, DEFAULT_TEMPLATE, 'utf8')
    return { text: DEFAULT_TEMPLATE, backup }
  }

  async listTodoItems() {
    const todos = await this.readJson('todos', { version: 1, items: [] })
    return Array.isArray(todos.items) ? todos.items : []
  }

  async listGoalItems() {
    const goals = await this.readJson('goals', { version: 1, items: [] })
    return Array.isArray(goals.items) ? goals.items : []
  }

  async writeOverview(todos, goals) {
    const lines = ['# 待办与目标总览', '', `> 由「知行」自动生成，只读镜像；修改请回到插件页面。最后更新：${nowStamp()}`, '']
    lines.push('## 待办', '')
    if (!todos.length) lines.push('（暂无）')
    const byDate = new Map()
    for (const todo of todos) {
      const list = byDate.get(todo.date) ?? []
      list.push(todo)
      byDate.set(todo.date, list)
    }
    for (const date of [...byDate.keys()].sort()) {
      lines.push(`### ${date}`, '')
      for (const todo of byDate.get(date)) {
        const mark = todo.status === '完成' ? 'x' : ' '
        const goal = todo.goalId ? `（关联目标 ${todo.goalId}）` : ''
        lines.push(`- [${mark}] ${todo.content}${goal} — ${todo.status}`)
      }
      lines.push('')
    }
    lines.push('## 目标', '')
    if (!goals.length) lines.push('（暂无）')
    for (const goal of goals) {
      lines.push(`- ${goal.title}｜${goal.cycle}｜${goal.startDate} ~ ${goal.endDate}｜进度 ${goal.progress}%｜${goal.measure}`)
    }
    lines.push('')
    const file = this.p('待办与目标总览.md')
    await fs.writeFile(file, `${lines.join('\n')}\n`, 'utf8')
    return file
  }

  async refreshOverview() {
    const [todos, goals] = await Promise.all([this.listTodoItems(), this.listGoalItems()])
    await this.writeOverview(todos, goals)
  }
}
