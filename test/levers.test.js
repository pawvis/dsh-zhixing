import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { candidateTodos, leversState, onTodoDone, setLevers, setTop, skipLevers, suggestLevers } from '../lib/levers.js'
import { morningMessage } from '../lib/reminders.js'
import { Store, ValidationError } from '../lib/store.js'

const DATE = '2026-11-18'

async function tempStore(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-levers-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()
  return store
}

async function seed(store) {
  await store.writeJson('goals', {
    version: 1,
    items: [
      { id: 'g1', title: '上线偏航报告', cycle: '月', measure: '报告可用', startDate: '2026-11-01', endDate: '2026-11-30', progress: 20, parentId: null, records: [] },
      { id: 'g2', title: '暂停的目标', cycle: '月', measure: 'x', startDate: '2026-11-01', endDate: '2026-11-30', progress: 10, paused: true, parentId: null, records: [] },
    ],
  })
  await store.writeJson('todos', {
    version: 1,
    items: [
      { id: 't1', content: '写偏航报告测试', date: DATE, status: '未做', goalId: 'g1' },
      { id: 't2', content: '回复供应商邮件', date: DATE, status: '未做', goalId: null },
      { id: 't3', content: '整理桌面', date: DATE, status: '未做', goalId: 'g2' },
      { id: 't4', content: '昨天的遗留', date: '2026-11-17', status: '未做', goalId: 'g1' },
      { id: 't5', content: '已完成的', date: DATE, status: '完成', goalId: null },
      { id: 't6', content: '明天的', date: '2026-11-19', status: '未做', goalId: null },
    ],
  })
}

function fakeCtx(reply) {
  const calls = []
  return {
    calls,
    get(name) {
      if (name === 'llm') {
        return {
          stream(payload) {
            calls.push(payload)
            return (async function* () { yield { type: 'text-delta', text: typeof reply === 'function' ? reply(calls.length) : reply } })()
          },
        }
      }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test', model: 'test-model' }) }
      if (name === 'sessions') return { list: () => [] }
      if (name === 'agents') return { list: () => [] }
      return undefined
    },
  }
}

const matchGoals = (text) => (String(text).includes('偏航') ? ['g1'] : [])

test('候选池：今日 + 此前未完成，排除已完成、未来和暂停目标', async (t) => {
  const store = await tempStore(t)
  await seed(store)
  const [todos, goals] = await Promise.all([store.listTodoItems(), store.listGoalItems()])
  assert.deepEqual(candidateTodos(todos, goals, DATE).map((todo) => todo.id), ['t1', 't2', 't4'])
})

test('确认杠杆：2/3/4 个成功，5 个 400，1 个带提示，0 个等于不设', async (t) => {
  const store = await tempStore(t)
  await seed(store)
  // 补两条，凑够 5 条可选的
  await store.update('todos', { version: 1, items: [] }, (data) => {
    data.items.push(
      { id: 't7', content: 'A', date: DATE, status: '未做', goalId: null },
      { id: 't8', content: 'B', date: DATE, status: '未做', goalId: null },
    )
    return data
  })

  await assert.rejects(
    setLevers(store, { date: DATE, items: ['t1', 't2', 't4', 't7', 't8'] }),
    (error) => error instanceof ValidationError && /最多 4 个/.test(error.message),
  )

  const two = await setLevers(store, { date: DATE, items: [{ todoId: 't1', goalId: 'g1' }, { todoId: 't2' }] })
  assert.equal(two.items.length, 2)
  assert.equal(two.hint, null)
  assert.deepEqual(two.items.map((item) => item.rank), [1, 2])
  assert.equal(two.items[0].by, 'user')

  const one = await setLevers(store, { date: DATE, items: ['t1'] })
  assert.equal(one.hint, 'below_min')
  assert.equal(one.belowMin, true)

  const skipped = await setLevers(store, { date: DATE, items: [] })
  assert.equal(skipped.skipped, true)
  assert.equal((await store.readJson('.internal/levers.json', { days: {} })).days[DATE].candidateStatus, 'skipped')

  await assert.rejects(setLevers(store, { date: DATE, items: ['nope'] }), (error) => error instanceof ValidationError)
  await assert.rejects(setLevers(store, { date: '2026-13-01', items: ['t1'] }), (error) => error instanceof ValidationError)
})

test('AI 推荐：无效 todoId / goalId 丢弃，超过 4 条截断', async (t) => {
  const store = await tempStore(t)
  await seed(store)
  await store.update('todos', { version: 1, items: [] }, (data) => {
    data.items.push({ id: 't9', content: 'C', date: DATE, status: '未做', goalId: null })
    return data
  })
  const reply = JSON.stringify({
    levers: [
      { todoId: 't1', goalId: 'g1', reason: '本周 0 证据' },
      { todoId: 't2', goalId: 'g1', reason: '补位' },
      { todoId: 'bad', goalId: 'g1', reason: '不存在' },
      { todoId: 't4', goalId: 'bad', reason: '目标不存在' },
      { todoId: 't9', goalId: 'g1', reason: '补位' },
    ],
  })
  const ctx = fakeCtx(reply)
  const result = await suggestLevers(store, ctx, { date: DATE, matchGoals })
  assert.equal(result.by, 'ai')
  assert.equal(result.candidates.length, 3)
  assert.ok(result.candidates.every((item) => ['t1', 't2', 't9'].includes(item.todoId)))
  assert.ok(result.candidates.every((item) => item.by === 'ai'))
  // 已确认后不再被后台推荐覆盖
  await setLevers(store, { date: DATE, items: ['t1', 't2'] })
  const again = await suggestLevers(store, ctx, { date: DATE, matchGoals })
  assert.equal(again.skipped, 'already-decided')
})

test('AI 不可用时本地匹配兜底，by=local', async (t) => {
  const store = await tempStore(t)
  await seed(store)
  const result = await suggestLevers(store, { get: () => undefined }, { date: DATE, matchGoals })
  assert.equal(result.by, 'local')
  assert.ok(result.candidates.length >= 2)
  const first = result.candidates.find((item) => item.todoId === 't1')
  assert.equal(first.goalId, 'g1')
  assert.equal(first.by, 'local')
})

test('leversState 带出待办内容、完成数与候选池', async (t) => {
  const store = await tempStore(t)
  await seed(store)
  await setLevers(store, { date: DATE, items: ['t1', 't2'] })
  await store.update('todos', { version: 1, items: [] }, (data) => {
    data.items.find((item) => item.id === 't1').status = '完成'
    return data
  })
  const state = await leversState(store, DATE)
  assert.equal(state.total, 2)
  assert.equal(state.done, 1)
  assert.equal(state.items[0].content, '写偏航报告测试')
  assert.equal(state.items[0].status, '完成')
  assert.ok(state.pool.some((todo) => todo.id === 't2'))
  assert.ok(state.goals.some((goal) => goal.id === 'g1'))
  assert.ok(!state.goals.some((goal) => goal.id === 'g2'))
})

test('早安文案：有重点只推重点 + 杂务数；没重点提示先选并只列前 4 条', () => {
  const todos = [
    { id: 't1', content: '重点一', date: DATE },
    { id: 't2', content: '杂务一', date: DATE },
    { id: 't3', content: '杂务二', date: DATE },
    { id: 't4', content: '杂务三', date: DATE },
    { id: 't5', content: '杂务四', date: DATE },
  ]
  const levers = [{ todoId: 't1', content: '重点一', done: false }]
  const only = morningMessage({ date: DATE, todos, unfinished: [{ id: 'u1', content: '遗留', date: '2026-11-17' }], levers, topTodoId: 't1', leverMorningOnly: true })
  assert.match(only.body, /今天的第一重点：重点一。如果今天只做一件事，就先做它。今天的重点：1\) 重点一/)
  assert.match(only.body, /另有 5 项杂务/)
  assert.doesNotMatch(only.body, /今天的待办有/)

  const both = morningMessage({ date: DATE, todos, unfinished: [], levers, topTodoId: 't1', leverMorningOnly: false })
  assert.match(both.body, /今天的待办有 5 项/)
  assert.match(both.body, /今天的第一重点：重点一/)
  assert.match(both.body, /今天的重点：1\) 重点一/)

  const none = morningMessage({ date: DATE, todos, unfinished: [], levers: [], leverMorningOnly: true })
  assert.match(none.body, /先选今天的 2–4 个重点，再挑出最重要的那一个吧。/)
  assert.match(none.body, /1\) 重点一/)
  assert.match(none.body, /4\) 杂务三/)
  assert.doesNotMatch(none.body, /5\) 杂务四/)
})

test('早安三种文案逐字：已设第一重点 / 没设第一重点 / 当天没有重点（1-4）', () => {
  const todos = [
    { id: 't1', content: '写偏航报告测试', date: DATE },
    { id: 't2', content: '回邮件', date: DATE },
  ]
  const levers = [
    { todoId: 't1', content: '写偏航报告测试', done: false },
    { todoId: 't2', content: '回邮件', done: false },
  ]

  const withTop = morningMessage({ date: DATE, todos, unfinished: [], levers, topTodoId: 't1' })
  assert.equal(withTop.body, '今天的第一重点：写偏航报告测试。如果今天只做一件事，就先做它。今天的重点：1) 写偏航报告测试；2) 回邮件。')

  const noTop = morningMessage({ date: DATE, todos, unfinished: [], levers, topTodoId: null })
  assert.equal(noTop.body, '如果今天只做一件事，哪件最能推进你的目标？去重点卡里点 ★ 选一个。今天的重点：1) 写偏航报告测试；2) 回邮件。')

  const none = morningMessage({ date: DATE, todos, unfinished: [], levers: [] })
  assert.equal(none.body, '今天的待办有 2 项：1) 写偏航报告测试；2) 回邮件，请及时完成哦。\n先选今天的 2–4 个重点，再挑出最重要的那一个吧。')

  // N-1：提醒输出不出现「杠杆」，也不读北极星任何字段。
  for (const message of [withTop, noTop, none]) assert.doesNotMatch(message.body, /杠杆|北极星|愿景/)
  assert.doesNotMatch(noTop.body, /北极星|反愿景|身份宣言/)
})

test('调整杠杆时保留已完成的项，并计入 4 个上限', async (t) => {
  const store = await tempStore(t)
  await seed(store)
  await store.update('todos', { version: 1, items: [] }, (data) => {
    data.items.push(
      { id: 't7', content: 'A', date: DATE, status: '未做', goalId: null },
      { id: 't8', content: 'B', date: DATE, status: '未做', goalId: null },
    )
    return data
  })
  await setLevers(store, { date: DATE, items: ['t1', 't2'] })
  await store.update('todos', { version: 1, items: [] }, (data) => {
    data.items.find((item) => item.id === 't1').status = '完成'
    return data
  })
  const adjusted = await setLevers(store, { date: DATE, items: ['t2', 't4'] })
  assert.equal(adjusted.items.length, 3, '已完成的 t1 应保留')
  assert.ok(adjusted.items.some((item) => item.todoId === 't1'))
  assert.ok(adjusted.items.some((item) => item.todoId === 't4'))

  await assert.rejects(
    setLevers(store, { date: DATE, items: ['t2', 't4', 't7', 't8'] }),
    (error) => error instanceof ValidationError && /最多 4 个/.test(error.message),
  )
})

function topLeverSetTotal(metrics) {
  return Object.values(metrics.days ?? {}).reduce((sum, day) => sum + Number(day.topLeverSet ?? 0), 0)
}

test('第一重点：同日最多 1 条，新的覆盖旧的，rank 不变（1-1、1-3）', async (t) => {
  const store = await tempStore(t)
  await seed(store)
  await setLevers(store, { date: DATE, items: ['t1', 't2'] })
  const itemsBefore = (await store.readJson('.internal/levers.json', { days: {} })).days[DATE].items
  assert.equal((await leversState(store, DATE)).topTodoId, null)

  const first = await setTop(store, DATE, 't1')
  assert.deepEqual(first, { date: DATE, topTodoId: 't1' })
  const second = await setTop(store, DATE, 't2')
  assert.equal(second.topTodoId, 't2')

  const day = (await store.readJson('.internal/levers.json', { days: {} })).days[DATE]
  assert.equal(day.topTodoId, 't2', '同一天只留 1 个第一重点')
  assert.deepEqual(day.items, itemsBefore, '设第一重点不能改任何一条的 rank')
  assert.equal((await leversState(store, DATE)).topTodoId, 't2')
})

test('第一重点：只能是当天已确认重点，否则 400（1-2）', async (t) => {
  const store = await tempStore(t)
  await seed(store)
  await setLevers(store, { date: DATE, items: ['t1', 't2'] })

  // t3 挂的是暂停目标、t4 是前一天的遗留，都不在当天已确认重点里。
  for (const bad of ['t3', 't4', 'nope']) {
    await assert.rejects(
      setTop(store, DATE, bad),
      (error) => error instanceof ValidationError && error.status === 400 && /已确认的重点/.test(error.message),
    )
  }
  await assert.rejects(
    setTop(store, '2026-11-19', 't1'),
    (error) => error instanceof ValidationError && error.status === 400,
  )
  await assert.rejects(
    setTop(store, '2026-13-01', 't1'),
    (error) => error instanceof ValidationError && error.status === 400,
  )
  assert.equal((await leversState(store, DATE)).topTodoId, null, '校验失败不能留下第一重点')
})

test('第一重点：null 取消；重新确认或跳过时清掉失效的第一重点（2.1 数据规则）', async (t) => {
  const store = await tempStore(t)
  await seed(store)
  await setLevers(store, { date: DATE, items: ['t1', 't2'] })

  await setTop(store, DATE, 't1')
  assert.deepEqual(await setTop(store, DATE, null), { date: DATE, topTodoId: null })
  assert.equal((await leversState(store, DATE)).topTodoId, null)

  await setTop(store, DATE, 't1')
  await setLevers(store, { date: DATE, items: ['t1', 't2'] })
  assert.equal((await leversState(store, DATE)).topTodoId, 't1', '重新确认仍含它时要保留')

  await setLevers(store, { date: DATE, items: ['t2'] })
  assert.equal((await leversState(store, DATE)).topTodoId, null, '重新确认不含它时要清空')

  await setTop(store, DATE, 't2')
  await skipLevers(store, DATE)
  assert.equal((await leversState(store, DATE)).topTodoId, null, '跳过（0 个重点）也要清空')
})

test('第一重点：topLeverSet 每天只计一次，取消后重设也不重复计（M-1）', async (t) => {
  const store = await tempStore(t)
  await seed(store)
  await setLevers(store, { date: DATE, items: ['t1', 't2'] })
  const read = async () => topLeverSetTotal(await store.readJson('.internal/metrics.json', { days: {} }))

  assert.equal(await read(), 0)
  await setTop(store, DATE, 't1')
  assert.equal(await read(), 1, '当天第一次设定 +1')
  await setTop(store, DATE, 't2')
  assert.equal(await read(), 1, '改选另一条不重复计')
  await setTop(store, DATE, null)
  assert.equal(await read(), 1, '取消不计')
  await setTop(store, DATE, 't1')
  assert.equal(await read(), 1, '取消后重设也不重复计')

  const day = (await store.readJson('.internal/levers.json', { days: {} })).days[DATE]
  assert.equal(day.topCounted, true, '当天记录里用 topCounted 去重')
  assert.equal(day.topTodoId, 't1')

  // 换一天再设：新的一天重新计 1 次
  await setLevers(store, { date: '2026-11-19', items: ['t6'] })
  await setTop(store, '2026-11-19', 't6')
  assert.equal(await read(), 2, '换一天再设 +1')
})

test('第一重点：AI 推荐在任何阶段都不自动写 topTodoId（1-6）', async (t) => {
  const store = await tempStore(t)
  await seed(store)
  const ctx = fakeCtx(JSON.stringify({ levers: [{ todoId: 't1', goalId: 'g1', reason: '本周 0 证据' }] }))

  const suggested = await suggestLevers(store, ctx, { date: DATE, matchGoals })
  assert.ok(suggested.topCandidate?.todoId, '推荐时给出第一重点候选')
  assert.equal((await leversState(store, DATE)).topTodoId, null, '确认前推荐只写候选，不写第一重点')

  await setLevers(store, { date: DATE, items: ['t1', 't2'] })
  await setTop(store, DATE, 't1')
  await suggestLevers(store, ctx, { date: DATE, matchGoals, force: true })
  assert.equal((await leversState(store, DATE)).topTodoId, 't1', '强制重推也不能改已设的第一重点')
  const day = (await store.readJson('.internal/levers.json', { days: {} })).days[DATE]
  assert.equal(day.topTodoId, 't1')
})

test('第一重点候选：AI 的 top 不在本次候选里就丢弃，改用 rank 最小那条（1-5）', async (t) => {
  const store = await tempStore(t)
  await seed(store)
  const ctx = fakeCtx(JSON.stringify({
    levers: [
      { todoId: 't1', goalId: 'g1', reason: '本周 0 证据' },
      { todoId: 't2', goalId: 'g1', reason: '补位' },
    ],
    top: { todoId: 't9', reason: '模型给了个没选中的' },
  }))
  const result = await suggestLevers(store, ctx, { date: DATE, matchGoals })
  assert.equal(result.by, 'ai')
  assert.deepEqual(result.candidates.map((item) => item.todoId), ['t1', 't2'])
  assert.equal(result.topCandidate.todoId, 't1', '弃用越界候选，改用 rank 最小（第一条）')
  assert.equal(result.topCandidate.by, 'local')
  assert.equal(result.topCandidate.reason, '本周 0 证据')
  assert.ok(result.topCandidate.reason.length <= 60)
})

test('第一重点候选：AI 的 top 有效就用它，reason 截到 60 字（1-5 补充）', async (t) => {
  const store = await tempStore(t)
  await seed(store)
  const longReason = '理'.repeat(80)
  const ctx = fakeCtx(JSON.stringify({
    levers: [
      { todoId: 't1', goalId: 'g1', reason: '本周 0 证据' },
      { todoId: 't2', goalId: 'g1', reason: '补位' },
    ],
    top: { todoId: 't2', reason: longReason },
  }))
  const result = await suggestLevers(store, ctx, { date: DATE, matchGoals })
  assert.equal(result.by, 'ai')
  assert.equal(result.topCandidate.todoId, 't2')
  assert.equal(result.topCandidate.by, 'ai')
  assert.equal(result.topCandidate.reason.length, 60, 'reason 截到 MAX_LEVER_REASON')
  assert.equal(result.topCandidate.reason, '理'.repeat(60))
})

test('第一重点候选：没有模型时用候选里 rank 最小的那条（本地兜底，1-5 补充）', async (t) => {
  const store = await tempStore(t)
  await seed(store)
  const result = await suggestLevers(store, { get: () => undefined }, { date: DATE, matchGoals })
  assert.equal(result.by, 'local')
  assert.equal(result.topCandidate.todoId, result.candidates[0].todoId)
  assert.equal(result.topCandidate.by, 'local')
  assert.ok(result.topCandidate.reason.length <= 60)
})

function metricTotal(metrics, name) {
  return Object.values(metrics.days ?? {}).reduce((sum, day) => sum + Number(day[name] ?? 0), 0)
}

test('完成计数：只算当天重点，第一重点再加 topLeverDone，重复切换只计 1 次（M-2）', async (t) => {
  const store = await tempStore(t)
  await seed(store)
  await setLevers(store, { date: DATE, items: ['t1', 't2'] })
  await setTop(store, DATE, 't1')
  const totals = async () => {
    const metrics = await store.readJson('.internal/metrics.json', { days: {} })
    return { leverDone: metricTotal(metrics, 'leverDone'), topLeverDone: metricTotal(metrics, 'topLeverDone') }
  }

  assert.deepEqual(await totals(), { leverDone: 0, topLeverDone: 0 })

  // 普通重点完成：只加 leverDone
  await onTodoDone(store, 't2', DATE)
  assert.deepEqual(await totals(), { leverDone: 1, topLeverDone: 0 })

  // 第一重点完成：leverDone +1，topLeverDone +1
  await onTodoDone(store, 't1', DATE)
  assert.deepEqual(await totals(), { leverDone: 2, topLeverDone: 1 })

  // 同一待办反复切换（完成→未完成→完成）只计 1 次
  await onTodoDone(store, 't1', DATE)
  await onTodoDone(store, 't1', DATE)
  assert.deepEqual(await totals(), { leverDone: 2, topLeverDone: 1 })

  // 非当天重点（t5 已完成但不在 items、t4 前一天遗留、未知 id）都不计
  await onTodoDone(store, 't5', DATE)
  await onTodoDone(store, 't4', DATE)
  await onTodoDone(store, 'nope', DATE)
  assert.deepEqual(await totals(), { leverDone: 2, topLeverDone: 1 })

  const day = (await store.readJson('.internal/levers.json', { days: {} })).days[DATE]
  assert.deepEqual(day.doneCounted, ['t2', 't1'], '当天记录里用 doneCounted 去重')
})

test('完成计数：不是第一重点时只加 leverDone，换第一重点后旧待办不再加 topLeverDone（M-2 补充）', async (t) => {
  const store = await tempStore(t)
  await seed(store)
  await setLevers(store, { date: DATE, items: ['t1', 't2'] })
  await setTop(store, DATE, 't2')
  const totals = async () => {
    const metrics = await store.readJson('.internal/metrics.json', { days: {} })
    return { leverDone: metricTotal(metrics, 'leverDone'), topLeverDone: metricTotal(metrics, 'topLeverDone') }
  }

  await onTodoDone(store, 't1', DATE) // 不是第一重点
  assert.deepEqual(await totals(), { leverDone: 1, topLeverDone: 0 })

  await setTop(store, DATE, 't1') // 换成 t1，但 t1 当天已经计过完成，不补计
  await onTodoDone(store, 't1', DATE)
  assert.deepEqual(await totals(), { leverDone: 1, topLeverDone: 0 })
})
