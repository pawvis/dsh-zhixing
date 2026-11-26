import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { weekKeyOf } from '../lib/drift.js'
import { start as startFocus } from '../lib/focus.js'
import { setLevers, setTop } from '../lib/levers.js'
import { createReminders } from '../lib/reminders.js'
import { Store } from '../lib/store.js'

const WORKDAY = '2026-11-27' // 周五
const SATURDAY = '2026-11-28'
const WEEK = weekKeyOf('2026-11-22')

function at(date, hhmm) {
  return new Date(`${date}T${hhmm}:00+08:00`)
}

function total(metrics, name) {
  return Object.values(metrics.days ?? {}).reduce((sum, day) => sum + Number(day[name] ?? 0), 0)
}

async function metricsOf(store) {
  return store.readJson('.internal/metrics.json', { days: {} })
}

async function goldenNotices(store) {
  return (await store.getState()).notices.filter((notice) => notice.kind === 'golden')
}

async function tempStore(t, { goldenTime = '', withTop = false, withLever = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-golden-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()
  await store.saveSettings({ region: '上海', holidays: [], extraWorkdays: [], goldenTime })
  // 预置节假日缓存（两年都新鲜），避免 tick 里的自动补数据真去联网。
  const fetchedAt = new Date().toISOString()
  await store.writeJson('.internal/holidays.json', {
    version: 1,
    years: {
      2026: { year: 2026, holidays: [], workdays: [], fetchedAt, source: 'test' },
      2027: { year: 2027, holidays: [], workdays: [], fetchedAt, source: 'test' },
    },
  })
  await store.writeJson('.internal/drift.json', { version: 1, weeks: { [WEEK]: { builtAt: '2026-11-22 20:00:00' } } })
  await store.writeJson('todos', {
    version: 1,
    items: [{ id: 't1', content: '写专注测试', date: WORKDAY, status: '未做', goalId: 'g1' }],
  })
  await store.writeJson('goals', {
    version: 1,
    items: [{ id: 'g1', title: '上线专注块', cycle: '月', measure: '可用', startDate: '2026-11-01', endDate: '2026-11-30', progress: 20, parentId: null, records: [] }],
  })
  if (withLever || withTop) {
    await setLevers(store, { date: WORKDAY, items: ['t1'] })
    if (withTop) await setTop(store, WORKDAY, 't1')
  }
  return store
}

function remindersOf(store) {
  return createReminders({ ctx: { get: () => undefined }, store })
}

test('黄金时段：goldenTime 为空时 0 条提醒（2-8）', async (t) => {
  const store = await tempStore(t, { goldenTime: '' })
  const result = await remindersOf(store).tick({ now: at(WORKDAY, '06:31') })

  assert.equal(result.skipped, '还没到提醒时间，或今天已提醒过')
  assert.deepEqual(await goldenNotices(store), [])
  assert.equal(total(await metricsOf(store), 'goldenRemind'), 0)
})

test('黄金时段：工作日到点推 1 条，没设第一重点用通用文案，每天最多 1 条（2-8）', async (t) => {
  const store = await tempStore(t, { goldenTime: '06:30', withLever: true })
  const reminders = remindersOf(store)

  // 还没到点
  await reminders.tick({ now: at(WORKDAY, '06:29') })
  assert.equal((await goldenNotices(store)).length, 0)

  const pushed = await reminders.tick({ now: at(WORKDAY, '06:31') })
  assert.equal(pushed.action, 'golden')
  const notices = await goldenNotices(store)
  assert.equal(notices.length, 1)
  assert.equal(notices[0].title, '知行 · 专注')
  assert.equal(notices[0].body, '黄金时段到了，开 1 小时专注吧。')
  assert.deepEqual(notices[0].action, { open: 'today', focus: 'top', date: WORKDAY, todoId: null })

  // 同一天再 tick 不重复推
  await reminders.tick({ now: at(WORKDAY, '06:32') })
  assert.equal((await goldenNotices(store)).length, 1)
  assert.equal(total(await metricsOf(store), 'goldenRemind'), 1)
})

test('黄金时段：设了第一重点时文案逐字带内容，并带 S6 预约参数（文案断言）', async (t) => {
  const store = await tempStore(t, { goldenTime: '06:30', withTop: true })
  const result = await remindersOf(store).tick({ now: at(WORKDAY, '06:31') })

  assert.equal(result.action, 'golden')
  const [notice] = await goldenNotices(store)
  assert.equal(notice.body, '黄金时段到了，给「写专注测试」开 1 小时？')
  assert.deepEqual(notice.action, { open: 'today', focus: 'top', date: WORKDAY, todoId: 't1' })
})

test('黄金时段：非工作日不推（2-8）', async (t) => {
  const store = await tempStore(t, { goldenTime: '06:30', withLever: true })
  const result = await remindersOf(store).tick({ now: at(SATURDAY, '06:31') })

  assert.equal(result.skipped, '非工作日')
  assert.deepEqual(await goldenNotices(store), [])
  assert.equal(total(await metricsOf(store), 'goldenRemind'), 0)
})

test('黄金时段：force 与现有提醒一致，可绕过工作日与当日去重（仅测试入口）', async (t) => {
  const store = await tempStore(t, { goldenTime: '06:30', withLever: true })
  const reminders = remindersOf(store)

  await reminders.tick({ now: at(SATURDAY, '06:31'), force: true })
  assert.equal((await goldenNotices(store)).length, 1)
  await reminders.tick({ now: at(SATURDAY, '06:32'), force: true })
  assert.equal((await goldenNotices(store)).length, 2, 'force 和 morning / evening 一样绕过去重')
})

test('黄金时段：tick 每次都会补记超时的专注块（2-5 tick 路径）', async (t) => {
  const store = await tempStore(t, { goldenTime: '' })
  await startFocus(store, { plannedMinutes: 25 }, at(WORKDAY, '06:30'))

  const result = await remindersOf(store).tick({ now: at(WORKDAY, '07:00') })
  assert.equal(result.focus?.endedBy, 'timeout')
  assert.equal(result.focus?.actualMinutes, 25)

  const data = await store.readJson('.internal/focus.json', { version: 1, running: null, records: [] })
  assert.equal(data.records.length, 1)
  assert.equal(data.running, null)

  const metrics = await metricsOf(store)
  assert.equal(total(metrics, 'focusTimeout'), 1)
  assert.equal(total(metrics, 'focusMinutes'), 25)
})

test('黄金时段设置校验：空串通过，非法 HH:mm 拒绝（S0 发现的空串放行）', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-golden-setting-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()

  assert.equal((await store.saveSettings({ goldenTime: '' })).goldenTime, '')
  assert.equal((await store.saveSettings({ goldenTime: '07:30' })).goldenTime, '07:30')
  assert.equal((await store.getSettings()).goldenTime, '07:30')

  for (const bad of ['7:5', '25:00', '07:60', '0730']) {
    await assert.rejects(
      store.saveSettings({ goldenTime: bad }),
      (error) => error.code === 'INVALID_TIME',
    )
  }
  assert.equal((await store.getSettings()).goldenTime, '07:30', '非法值不能覆盖旧值')
  assert.equal((await store.saveSettings({ goldenTime: '' })).goldenTime, '', '还能清空')
})
