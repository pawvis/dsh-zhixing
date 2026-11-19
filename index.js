/**
 * 知行 Host 入口
 *
 * 数据目录：${DSH_HOME:-~/.dsh}/data/知行/（所有工作区共用）
 * 不修改 dsh 宿主源码；由本包的 cordis.patch.yml 插入一行插件。
 */
import os from 'node:os'
import path from 'node:path'
import { checkGoalAlerts } from './lib/goals.js'
import { createReminders, deliver } from './lib/reminders.js'
import { dateKeyInZone, resolveTimezone } from './lib/clock.js'
import { ensureHolidayYears } from './lib/holidays.js'
import { createRoutes } from './lib/routes.js'
import { Store } from './lib/store.js'

export const name = 'zhixing'
export const inject = ['webServer', 'timer']

export function apply(ctx, config = {}) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const dataDir = path.resolve(config.dataDir || path.join(home, 'data', '知行'))
  const store = new Store(dataDir)
  const ready = store.init()

  const goalCheck = async ({ now } = {}) => {
    const settings = await store.getSettings()
    return checkGoalAlerts(store, settings, {
      now,
      deliver: (alert) => deliver(store, { kind: `goal-${alert.kind}`, title: alert.title, body: alert.body }),
    })
  }
  const reminders = createReminders({ ctx, store, goalCheck })
  const routes = createRoutes({ ctx, store, reminders, config: { apiPrefix: config.apiPrefix || '/api/zhixing' } })

  let stopTimers = null
  ready
    .then(async () => {
      // 先把设置里的地区时区装进进程时钟，再启动提醒，避免刚启动时按电脑时区算日期。
      const settings = await store.getSettings()
      const year = Number(dateKeyInZone(new Date()).slice(0, 4))
      void ensureHolidayYears(store, [year, year + 1]).catch((error) => {
        store.appendLog('节假日', `启动自动获取失败：${error.message}`).catch(() => {})
      })
      stopTimers = reminders.start()
      return store.appendLog('插件启动', `数据目录 ${dataDir}，时区 ${resolveTimezone(settings)}`)
    })
    .catch((error) => {
      console.error('[zhixing] 初始化失败', error)
    })

  ctx.effect(() => () => {
    if (stopTimers) stopTimers()
    store.appendLog('插件卸载', '定时器已清理').catch(() => {})
  }, 'zhixing: lifetime')

  ctx.effect(() => () => routes(), 'zhixing: routes')
}
