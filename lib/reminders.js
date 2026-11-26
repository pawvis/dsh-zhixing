/**
 * 知行 · 提醒
 *
 * 定时器只在 dsh 进程存活期间运行；错过的提醒由启动补发覆盖
 * （当天已过时间且未发过 → 补发一次，同日去重）。
 * 渠道：Host 只把提醒写进 state.notices，由页面决定怎么显示——
 * 窗口在前台 → 右上角提醒卡；窗口在后台/最小化 → 页面自己的系统通知
 * （Web Notification，点一下回到知行面板）。
 *
 * 不要在 Host 里用 osascript 发通知：macOS 会把通知归到「脚本编辑器」，
 * 点击也只会打开脚本编辑器，回不到 DSH。
 */
import { dateKeyInZone, zoneParts } from './clock.js'
import { minutesOfDay, weekdayOf } from './store.js'
import { morningLeverContext } from './levers.js'
import { maybeGenerateWeekly } from './drift.js'
import { effectiveSettings, ensureHolidayYears, holidayCache } from './holidays.js'

export function isWorkday(settings, date) {
  const holidays = Array.isArray(settings.holidays) ? settings.holidays : []
  const extraWorkdays = Array.isArray(settings.extraWorkdays) ? settings.extraWorkdays : []
  if (extraWorkdays.includes(date)) return true
  if (holidays.includes(date)) return false
  if (settings.skipWeekends === false) return true
  const weekday = weekdayOf(date)
  return weekday !== 0 && weekday !== 6
}

/**
 * 把提醒写进待显示队列。显示方式交给页面：
 * 页面可见 → 提醒卡；页面在后台 → Notification（点击回到知行）。
 */
export async function deliver(store, { kind, title, body }) {
  const notice = { id: `${kind}-${Date.now()}`, kind, title, body, ts: Date.now() }
  await store.update('state', { notices: [] }, (current) => {
    current.notices = [...(current.notices ?? []), notice].slice(-20)
    return current
  })
  return { channel: 'client', queued: true, notice }
}

export function morningMessage({ date, todos, unfinished, levers = [], topTodoId = null, leverMorningOnly = true }) {
  const list = todos.map((todo, index) => `${index + 1}) ${todo.content}`).join('；')
  const head = todos.length
    ? `今天的待办有 ${todos.length} 项：${list}，请及时完成哦。`
    : '今天没有待办，先给自己定一件小事吧。'
  const tail = unfinished.length
    ? `\n另有 ${unfinished.length} 项此前未完成：${unfinished.map((todo) => `${todo.content}（${todo.date}）`).join('；')}，请在「今日」里选择顺延或关闭。`
    : ''
  if (Array.isArray(levers) && levers.length) {
    const leverLine = `今天的重点：${levers.map((item, index) => `${index + 1}) ${item.content}${item.done ? '（已完成）' : ''}`).join('；')}。`
    // 2.2 三种文案：已设第一重点 / 已设重点没设第一重点，后面都接原有的重点列表行。
    const top = topTodoId ? levers.find((item) => String(item.todoId) === String(topTodoId)) : null
    const opening = top
      ? `今天的第一重点：${top.content}。如果今天只做一件事，就先做它。`
      : '如果今天只做一件事，哪件最能推进你的目标？去重点卡里点 ★ 选一个。'
    if (leverMorningOnly) {
      const leverIds = new Set(levers.map((item) => item.todoId))
      const chores = todos.filter((todo) => !leverIds.has(todo.id)).length + unfinished.length
      return { title: '知行 · 早安', body: `${opening}${leverLine}${chores ? `另有 ${chores} 项杂务。` : ''}`, count: levers.length }
    }
    return { title: '知行 · 早安', body: `${head}${tail}\n${opening}${leverLine}`, count: levers.length }
  }
  const preview = todos.slice(0, 4).map((todo, index) => `${index + 1}) ${todo.content}`).join('；')
  const noLeverHead = todos.length
    ? `今天的待办有 ${todos.length} 项：${preview}${todos.length > 4 ? ' 等' : ''}，请及时完成哦。`
    : '今天没有待办，先给自己定一件小事吧。'
  return { title: '知行 · 早安', body: `${noLeverHead}${tail}\n先选今天的 2–4 个重点，再挑出最重要的那一个吧。`, count: todos.length }
}

export function eveningMessage() {
  return { title: '知行 · 日报', body: '今天的日报还没写，花 3 分钟记录一下今天做了什么？' }
}

export function createReminders({ ctx, store, goalCheck }) {
  let disposed = false
  let lastHolidayCheck = 0

  async function settingsWithHolidays() {
    return effectiveSettings(store, await store.getSettings())
  }

  /** 自动节假日缓存：每小时最多检查一次，缺当年数据时同步补一次。 */
  async function refreshHolidayCache(date) {
    const year = Number(String(date).slice(0, 4))
    const cache = await holidayCache(store)
    const hasYear = Boolean(cache.years?.[String(year)]?.holidays?.length)
    if (hasYear && Date.now() - lastHolidayCheck < 3_600_000) return
    lastHolidayCheck = Date.now()
    try {
      await ensureHolidayYears(store, [year, year + 1])
    } catch (error) {
      await store.appendLog('节假日', `自动获取失败：${error.message}`)
    }
  }

  async function morning({ now = new Date(), force = false, forceWorkday = false, channel = 'auto' } = {}) {
    const date = dateKeyInZone(now)
    const settings = await settingsWithHolidays()
    if (!force && !forceWorkday && !isWorkday(settings, date)) return { action: 'morning', skipped: '非工作日' }
    const state = await store.getState()
    if (!force && state.reminders?.[date]?.morning) return { action: 'morning', skipped: '今天已经提醒过' }
    const items = await store.listTodoItems()
    const todos = items.filter((todo) => todo.date === date && todo.status !== '完成')
    const unfinished = items.filter((todo) => todo.date < date && todo.status === '未做')
    const leverContext = await morningLeverContext(store, date)
    const message = morningMessage({
      date,
      todos,
      unfinished,
      levers: leverContext.items,
      topTodoId: leverContext.topTodoId,
      leverMorningOnly: settings.leverMorningOnly !== false,
    })
    const result = await deliver(store, { kind: 'morning', title: message.title, body: message.body, channel })
    await store.update('state', { reminders: {} }, (current) => {
      current.reminders = current.reminders ?? {}
      current.reminders[date] = { ...(current.reminders[date] ?? {}), morning: true }
      current.lastNotify = { kind: 'morning', date, ts: Date.now(), channel: result.channel, count: message.count }
      return current
    })
    await store.appendLog(force ? '[测试] 早安提醒' : '早安提醒', `${message.count} 项待办，渠道 页面通知${result.error ? `，失败：${result.error}` : ''}`)
    return { action: 'morning', date, ...message, ...result }
  }

  async function evening({ now = new Date(), force = false, forceWorkday = false, channel = 'auto' } = {}) {
    const date = dateKeyInZone(now)
    const settings = await settingsWithHolidays()
    if (!force && !forceWorkday && !isWorkday(settings, date)) return { action: 'evening', skipped: '非工作日' }
    const state = await store.getState()
    if (!force && state.reminders?.[date]?.evening) return { action: 'evening', skipped: '今天已经提醒过' }
    const exists = await store.hasReport(date)
    if (exists && !force) {
      await store.update('state', { reminders: {} }, (current) => {
        current.reminders = current.reminders ?? {}
        current.reminders[date] = { ...(current.reminders[date] ?? {}), evening: true }
        return current
      })
      await store.appendLog('晚报提醒', '今天已写日报，跳过')
      return { action: 'evening', date, skipped: '今天已写日报，不再提醒' }
    }
    const message = eveningMessage()
    const result = await deliver(store, { kind: 'evening', title: message.title, body: message.body, channel })
    await store.update('state', { reminders: {} }, (current) => {
      current.reminders = current.reminders ?? {}
      current.reminders[date] = { ...(current.reminders[date] ?? {}), evening: true }
      current.lastNotify = { kind: 'evening', date, ts: Date.now(), channel: result.channel }
      return current
    })
    await store.appendLog(force ? '[测试] 晚报提醒' : '晚报提醒', `渠道 页面通知${result.error ? `，失败：${result.error}` : ''}`)
    return { action: 'evening', date, ...message, ...result }
  }

  async function tick({ now = new Date(), force = false, channel = 'auto', which = 'auto' } = {}) {
    if (disposed) return { skipped: '已卸载' }
    const date = dateKeyInZone(now)
    await refreshHolidayCache(date)
    const settings = await settingsWithHolidays()
    // 偏航周检查：不受工作日限制（周日 20:00 生成，错过则下次 tick 补生成）。
    let weekly = null
    try { weekly = await maybeGenerateWeekly(store, ctx, { now, deliver }) } catch (error) { await store.appendLog('偏航报告', `检查失败：${error.message}`) }
    if (!isWorkday(settings, date) && !force) return { skipped: '非工作日', weekly }
    const parts = zoneParts(now)
    const minutes = parts.hour * 60 + parts.minute
    const morningAt = minutesOfDay(settings.morningTime) ?? 540
    const eveningAt = minutesOfDay(settings.eveningTime) ?? 1080
    const state = await store.getState()
    const sent = state.reminders?.[date] ?? {}
    const out = []
    if ((which === 'auto' || which === 'morning') && (force || (minutes >= morningAt && !sent.morning))) {
      out.push(await morning({ now, force, channel }))
    }
    if ((which === 'auto' || which === 'evening') && (force || (minutes >= eveningAt && !sent.evening))) {
      out.push(await evening({ now, force, channel }))
    }
    let goals = null
    if (goalCheck) {
      try { goals = await goalCheck({ now }) } catch (error) { await store.appendLog('目标提醒', `检查失败：${error.message}`) }
    }
    if (!out.length) return { skipped: '还没到提醒时间，或今天已提醒过', goals, weekly }
    return out.length === 1 ? { ...out[0], goals } : { results: out, goals }
  }

  function start() {
    const timer = ctx.timer.interval(() => { void tick().catch((error) => store.appendLog('提醒检查', `失败：${error.message}`)) }, 60_000)
    // 启动补发：稍等宿主服务就绪，再走一次同样的 tick（已过时间且未发过就补发）。
    const boot = setTimeout(() => { void tick().catch(() => {}) }, 5000)
    return () => { disposed = true; clearTimeout(boot); timer() }
  }

  return { tick, morning, evening, start }
}
