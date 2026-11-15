/**
 * 知行 · 提醒
 *
 * 定时器只在 dsh 进程存活期间运行；错过的提醒由启动补发覆盖
 * （当天已过时间且未发过 → 补发一次，同日去重）。
 * 渠道：页面可见 → Web Notification；页面隐藏/未打开 → macOS 系统通知（osascript）。
 */
import { execFile } from 'node:child_process'
import { dateKey, minutesOfDay, weekdayOf } from './store.js'

export function isWorkday(settings, date) {
  const holidays = Array.isArray(settings.holidays) ? settings.holidays : []
  const extraWorkdays = Array.isArray(settings.extraWorkdays) ? settings.extraWorkdays : []
  if (extraWorkdays.includes(date)) return true
  if (holidays.includes(date)) return false
  if (settings.skipWeekends === false) return true
  const weekday = weekdayOf(date)
  return weekday !== 0 && weekday !== 6
}

export function quoteForAppleScript(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function osascriptNotify(title, body) {
  const script = `display notification "${quoteForAppleScript(body)}" with title "${quoteForAppleScript(title)}" subtitle "知行"`
  return new Promise((resolve) => {
    execFile('/usr/bin/osascript', ['-e', script], { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) resolve({ ok: false, error: (stderr || error.message || '').trim() || 'osascript 执行失败' })
      else resolve({ ok: true, via: 'osascript' })
    })
  })
}

/** 渠道判定：90 秒内有可见的页面心跳就走 Web，否则走系统通知。 */
export async function pickChannel(store) {
  const state = await store.getState()
  const heartbeat = state.heartbeat
  const fresh = heartbeat && Date.now() - Number(heartbeat.ts ?? 0) < 90_000
  return fresh && heartbeat.visible === true ? 'web' : 'desktop'
}

export async function deliver(store, { kind, title, body, channel = 'auto' }) {
  const resolved = channel === 'auto' ? await pickChannel(store) : channel
  const notice = { id: `${kind}-${Date.now()}`, kind, title, body, ts: Date.now() }
  if (resolved === 'web') {
    await store.update('state', { notices: [] }, (current) => {
      current.notices = [...(current.notices ?? []), notice].slice(-20)
      return current
    })
    return { channel: 'web', queued: true, notice }
  }
  const result = await osascriptNotify(title, body)
  return { channel: 'desktop', queued: false, notice, ...result }
}

export function morningMessage({ date, todos, unfinished }) {
  const list = todos.map((todo, index) => `${index + 1}) ${todo.content}`).join('；')
  const head = todos.length
    ? `今天的待办有 ${todos.length} 项：${list}，请及时完成哦。`
    : '今天没有待办，先给自己定一件小事吧。'
  const tail = unfinished.length
    ? `\n另有 ${unfinished.length} 项此前未完成：${unfinished.map((todo) => `${todo.content}（${todo.date}）`).join('；')}，请在「今日」里选择顺延或关闭。`
    : ''
  return { title: '知行 · 早安', body: `${head}${tail}`, count: todos.length }
}

export function eveningMessage() {
  return { title: '知行 · 日报', body: '今天的日报还没写，花 3 分钟记录一下今天做了什么？' }
}

export function createReminders({ ctx, store, goalCheck }) {
  let disposed = false

  async function morning({ now = new Date(), force = false, forceWorkday = false, channel = 'auto' } = {}) {
    const date = dateKey(now)
    const settings = await store.getSettings()
    if (!force && !forceWorkday && !isWorkday(settings, date)) return { action: 'morning', skipped: '非工作日' }
    const state = await store.getState()
    if (!force && state.reminders?.[date]?.morning) return { action: 'morning', skipped: '今天已经提醒过' }
    const items = await store.listTodoItems()
    const todos = items.filter((todo) => todo.date === date && todo.status !== '完成')
    const unfinished = items.filter((todo) => todo.date < date && todo.status === '未做')
    const message = morningMessage({ date, todos, unfinished })
    const result = await deliver(store, { kind: 'morning', title: message.title, body: message.body, channel })
    await store.update('state', { reminders: {} }, (current) => {
      current.reminders = current.reminders ?? {}
      current.reminders[date] = { ...(current.reminders[date] ?? {}), morning: true }
      current.lastNotify = { kind: 'morning', date, ts: Date.now(), channel: result.channel, count: message.count }
      return current
    })
    await store.appendLog(force ? '[测试] 早安提醒' : '早安提醒', `${message.count} 项待办，渠道 ${result.channel}${result.error ? `，失败：${result.error}` : ''}`)
    return { action: 'morning', date, ...message, ...result }
  }

  async function evening({ now = new Date(), force = false, forceWorkday = false, channel = 'auto' } = {}) {
    const date = dateKey(now)
    const settings = await store.getSettings()
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
    await store.appendLog(force ? '[测试] 晚报提醒' : '晚报提醒', `渠道 ${result.channel}${result.error ? `，失败：${result.error}` : ''}`)
    return { action: 'evening', date, ...message, ...result }
  }

  async function tick({ now = new Date(), force = false, channel = 'auto', which = 'auto' } = {}) {
    if (disposed) return { skipped: '已卸载' }
    const date = dateKey(now)
    const settings = await store.getSettings()
    if (!isWorkday(settings, date) && !force) return { skipped: '非工作日' }
    const minutes = now.getHours() * 60 + now.getMinutes()
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
    if (!out.length) return { skipped: '还没到提醒时间，或今天已提醒过', goals }
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
