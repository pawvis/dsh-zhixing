import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getState, start, stop, summarize, sweep, todayMinutes } from '../lib/focus.js'
import { setLevers, setTop } from '../lib/levers.js'
import { Store } from '../lib/store.js'

const DAY = '2026-11-27'
const T0 = new Date('2026-11-27T06:30:00+08:00')
const MIN = 60_000

async function tempStore(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-focus-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()
  await store.saveSettings({ region: '上海', holidays: [], extraWorkdays: [] })
  return store
}

async function seedDay(store, date = DAY) {
  await store.writeJson('todos', {
    version: 1,
    items: [
      { id: 't1', content: '写专注测试', date, status: '未做', goalId: 'g1' },
      { id: 't2', content: '回邮件', date, status: '未做', goalId: null },
    ],
  })
  await store.writeJson('goals', {
    version: 1,
    items: [{ id: 'g1', title: '上线专注块', cycle: '月', measure: '可用', startDate: '2026-11-01', endDate: '2026-11-30', progress: 20, parentId: null, records: [] }],
  })
  await setLevers(store, { date, items: ['t1', 't2'] })
}

async function focusData(store) {
  return store.readJson('.internal/focus.json', { version: 1, running: null, records: [] })
}

function total(metrics, name) {
  return Object.values(metrics.days ?? {}).reduce((sum, day) => sum + Number(day[name] ?? 0), 0)
}

async function counts(store) {
  const metrics = await store.readJson('.internal/metrics.json', { days: {} })
  return {
    start: total(metrics, 'focusStart'),
    timeout: total(metrics, 'focusTimeout'),
    manual: total(metrics, 'focusManual'),
    abandon: total(metrics, 'focusAbandon'),
    minutes: total(metrics, 'focusMinutes'),
  }
}

test('专注：已有计时时再开始返回 409，running 不变且不能换 todoId（2-2、2-3）', async (t) => {
  const store = await tempStore(t)
  await seedDay(store)
  const running = await start(store, { plannedMinutes: 60, todoId: 't1' }, T0)
  assert.equal(running.todoId, 't1')
  assert.equal(running.goalId, 'g1')
  assert.equal(running.isTop, false)

  await assert.rejects(
    start(store, { plannedMinutes: 25, todoId: 't2' }, new Date(T0.getTime() + MIN)),
    (error) => error.status === 409 && error.code === 'focus_running',
  )
  const state = await getState(store, new Date(T0.getTime() + MIN))
  assert.equal(state.running.id, running.id)
  assert.equal(state.running.todoId, 't1')
  assert.equal(state.running.plannedMinutes, 60)
  assert.equal((await focusData(store)).records.length, 0)
})

test('专注：没有计时时结束返回 409（2-2 补充）', async (t) => {
  const store = await tempStore(t)
  await assert.rejects(stop(store, T0), (error) => error.status === 409 && error.code === 'focus_idle')
})

test('专注：手动结束 4.9 分钟记 abandon、5.0 分钟记 manual，abandon 不计今日分钟（2-4）', async (t) => {
  const store = await tempStore(t)
  await seedDay(store)

  await start(store, { plannedMinutes: 60 }, T0)
  const abandon = await stop(store, new Date(T0.getTime() + 4.9 * MIN))
  assert.equal(abandon.endedBy, 'abandon')
  assert.equal(abandon.actualMinutes, 4.9)
  assert.equal((await getState(store, new Date(T0.getTime() + 4.9 * MIN))).todayMinutes, 0)

  const secondStart = new Date(T0.getTime() + 5 * MIN)
  await start(store, { plannedMinutes: 60 }, secondStart)
  const manual = await stop(store, new Date(secondStart.getTime() + 5 * MIN))
  assert.equal(manual.endedBy, 'manual')
  assert.equal(manual.actualMinutes, 5)
  assert.equal((await getState(store, new Date(secondStart.getTime() + 5 * MIN))).todayMinutes, 5)
})

test('专注：超时补记 timeout，actualMinutes = plannedMinutes，sweep 幂等（2-5）', async (t) => {
  const store = await tempStore(t)
  await seedDay(store)
  await start(store, { plannedMinutes: 25 }, T0)

  const later = new Date(T0.getTime() + 30 * MIN)
  const record = await sweep(store, later)
  assert.equal(record.endedBy, 'timeout')
  assert.equal(record.actualMinutes, 25)
  assert.equal(record.end, new Date(T0.getTime() + 25 * MIN).toISOString())

  assert.equal(await sweep(store, later), null, '第二次 sweep 不能再写记录')
  const data = await focusData(store)
  assert.equal(data.records.length, 1)
  assert.ok(data.running === null)

  const state = await getState(store, later)
  assert.equal(state.running, null)
  assert.equal(state.todayMinutes, 25)
  assert.equal((await focusData(store)).records.length, 1, 'GET 时的补记同样幂等')
})

test('专注：23:40 开始的 60 分钟块，date 记开始那天（2-6）', async (t) => {
  const store = await tempStore(t)
  await seedDay(store)

  const late = new Date('2026-11-27T23:40:00+08:00')
  const running = await start(store, { plannedMinutes: 60 }, late)
  assert.equal(running.date, '2026-11-27')

  const record = await stop(store, new Date('2026-11-28T00:10:00+08:00'))
  assert.equal(record.date, '2026-11-27', '跨午夜记到开始那天')
  assert.equal(record.endedBy, 'manual')
  assert.equal(record.actualMinutes, 30)
  assert.equal(todayMinutes([record], '2026-11-27'), 30)
  assert.equal(todayMinutes([record], '2026-11-28'), 0)
})

test('专注：每条记录字段与类型完整（2-7）', async (t) => {
  const store = await tempStore(t)
  await seedDay(store)
  await setTop(store, DAY, 't1')

  await start(store, { plannedMinutes: 45, todoId: 't1' }, T0)
  const record = await stop(store, new Date(T0.getTime() + 20 * MIN))

  assert.equal(typeof record.id, 'string')
  assert.match(record.id, /^f_\d{8}_\d{4}_/)
  assert.equal(typeof record.date, 'string')
  assert.match(record.date, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(typeof record.start, 'string')
  assert.ok(!Number.isNaN(Date.parse(record.start)))
  assert.equal(typeof record.end, 'string')
  assert.ok(!Number.isNaN(Date.parse(record.end)))
  assert.equal(typeof record.plannedMinutes, 'number')
  assert.equal(record.plannedMinutes, 45)
  assert.equal(typeof record.actualMinutes, 'number')
  assert.equal(record.actualMinutes, 20)
  assert.ok(['timeout', 'manual', 'abandon'].includes(record.endedBy))
  assert.equal(record.todoId, 't1')
  assert.equal(record.goalId, 'g1')
  assert.equal(record.isTop, true)

  const saved = (await focusData(store)).records[0]
  assert.deepEqual(
    Object.keys(saved).sort(),
    ['actualMinutes', 'date', 'end', 'endedBy', 'goalId', 'id', 'isTop', 'plannedMinutes', 'start', 'todoId'].sort(),
  )
  assert.equal(saved.actualMinutes, Math.round(saved.actualMinutes * 10) / 10, '实际时长保留 1 位小数')
})

test('专注：今日专注分钟 = 当天 timeout + manual 之和（2-9）', () => {
  const records = [
    { date: DAY, endedBy: 'timeout', actualMinutes: 60 },
    { date: DAY, endedBy: 'manual', actualMinutes: 25 },
    { date: DAY, endedBy: 'abandon', actualMinutes: 3 },
    { date: '2026-11-26', endedBy: 'manual', actualMinutes: 10 },
  ]
  assert.equal(todayMinutes(records, DAY), 85)
  assert.equal(todayMinutes([], DAY), 0)
})

test('专注：6 个计数在正确时机 +1（M-1）', async (t) => {
  const store = await tempStore(t)
  await seedDay(store)

  // abandon：只加 focusAbandon
  await start(store, { plannedMinutes: 25 }, T0)
  await stop(store, new Date(T0.getTime() + 3 * MIN))

  // manual：加 focusManual + focusMinutes
  const manualStart = new Date(T0.getTime() + 10 * MIN)
  await start(store, { plannedMinutes: 25 }, manualStart)
  await stop(store, new Date(manualStart.getTime() + 8 * MIN))

  // timeout：加 focusTimeout + focusMinutes
  const timeoutStart = new Date(T0.getTime() + 20 * MIN)
  await start(store, { plannedMinutes: 25 }, timeoutStart)
  await sweep(store, new Date(timeoutStart.getTime() + 30 * MIN))

  assert.deepEqual(await counts(store), { start: 3, timeout: 1, manual: 1, abandon: 1, minutes: 33 })
})

test('专注：sweep 与 stop 同时发生只写一条记录、计数不重复（并发幂等）', async (t) => {
  const store = await tempStore(t)
  await seedDay(store)
  await start(store, { plannedMinutes: 25 }, T0)

  const later = new Date(T0.getTime() + 26 * MIN)
  const results = await Promise.allSettled([sweep(store, later), stop(store, later)])
  const written = results.filter((item) => item.status === 'fulfilled' && item.value).map((item) => item.value)
  assert.equal(written.length, 1, '两个入口只能有一个写出记录')

  const data = await focusData(store)
  assert.equal(data.records.length, 1)
  assert.deepEqual(await counts(store), { start: 1, timeout: 1, manual: 0, abandon: 0, minutes: 25 })
})

test('专注：剩余秒数按服务端 start 计算，刷新/晚开都不漂（2-1 单测部分）', async (t) => {
  const store = await tempStore(t)
  await seedDay(store)
  await start(store, { plannedMinutes: 60 }, T0)

  const state = await getState(store, new Date(T0.getTime() + 10 * MIN))
  assert.equal(state.running.start, T0.toISOString())
  assert.equal(state.remainingSec, 50 * 60)
  assert.equal(state.todayMinutes, 0)
})

test('专注：计划时长非法或 todoId 不是当天重点都返回 400（2-2 补充）', async (t) => {
  const store = await tempStore(t)
  await seedDay(store)

  await assert.rejects(
    start(store, { plannedMinutes: 30 }, T0),
    (error) => error.status === 400 && error.code === 'focus_planned',
  )
  await assert.rejects(
    start(store, { plannedMinutes: 60, todoId: 'nope' }, T0),
    (error) => error.status === 400 && error.code === 'focus_not_lever',
  )
  assert.equal((await focusData(store)).running, null, '失败的开始不能留下 running')
})

test('专注：summarize 预留给 P1-1，只算 timeout + manual，小时保留 1 位（3-1 预留）', () => {
  const summary = summarize([
    { date: '2026-11-02', endedBy: 'manual', actualMinutes: 30 },
    { date: '2026-11-03', endedBy: 'timeout', actualMinutes: 60 },
    { date: '2026-11-04', endedBy: 'abandon', actualMinutes: 4 },
    { date: '2026-12-01', endedBy: 'manual', actualMinutes: 15 },
  ], { from: '2026-11-01', to: '2026-11-30' })
  assert.deepEqual(summary, { minutes: 90, hours: 1.5, count: 2 })
})
