import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { zonedTimeToUtc } from '../lib/clock.js'
import {
  buildDrift,
  decideDriftAdvice,
  getDrift,
  maybeGenerateWeekly,
  pickBoss,
  saveDriftReport,
} from '../lib/drift.js'
import { Store } from '../lib/store.js'

const WEEK = '2026-W47'

async function tempStore(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-drift-report-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()
  await store.saveSettings({ region: '上海', holidays: [], extraWorkdays: [] })
  return store
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

const goal = (fields) => ({
  cycle: '月', measure: '完成 1 件事', startDate: '2026-11-01', endDate: '2026-11-30',
  parentId: null, progress: 10, records: [], createdAt: '2026-11-01 00:00:00', updatedAt: '2026-11-01 00:00:00', ...fields,
})

async function seedGoal(store, fields = {}) {
  await store.writeJson('goals', { version: 1, items: [goal({ id: 'g1', title: '上线偏航报告', ...fields })] })
}

test('buildDrift：自动起草建议，非法 type / 伪造 quote 丢弃', async (t) => {
  const store = await tempStore(t)
  await seedGoal(store)
  const reply = JSON.stringify({
    advice: [
      { type: 'add_levers', goalId: 'g1', count: 2, text: '下周给它 2 个杠杆', basis: '连续 0 证据' },
      { type: 'bad', goalId: 'g1', text: '非法类型' },
      { type: 'extend', goalId: 'g1', newEndDate: '2026-12-15', text: '延期', quote: '日报里没有这句话' },
      { type: 'extend', goalId: 'g1', newEndDate: '2026-12-15', text: '把截止推到 12-15', basis: '截止近' },
    ],
  })
  const ctx = fakeCtx(reply)
  const result = await buildDrift(store, ctx, WEEK)
  assert.equal(ctx.calls.length, 1, '有红色目标时应自动调用一次')
  assert.equal(result.advice.length, 2)
  assert.deepEqual(result.advice.map((item) => item.type), ['add_levers', 'extend'])
  assert.equal((await getDrift(store, WEEK)).built, true)
})

test('buildDrift：没有红色目标时不调用模型', async (t) => {
  const store = await tempStore(t)
  await seedGoal(store, { progress: 100 })
  const ctx = fakeCtx('[]')
  const result = await buildDrift(store, ctx, WEEK)
  assert.equal(ctx.calls.length, 0)
  assert.equal(result.advice.length, 0)
})

test('采纳建议：add_levers 建下周一待办并进候选，extend / pause / shrink / keep 生效，dismiss 记录', async (t) => {
  // 这条用例断言 targetDate 会滚到 2026-11-23 之后的最近周一（快照周之后的下周一）。
  // 不冻结时钟的话，真实日期过了 2026-11-23 就会滚到下一个周一，用例随日历变红。
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-20T12:00:00+08:00') })
  t.after(() => t.mock.timers.reset())
  const store = await tempStore(t)
  await seedGoal(store)
  const ctx = fakeCtx(JSON.stringify({
    advice: [
      { type: 'add_levers', goalId: 'g1', count: 2, text: '下周给它 2 个杠杆', basis: '连续 0 证据' },
      { type: 'extend', goalId: 'g1', newEndDate: '2026-12-15', text: '延期到 12-15', basis: '截止近' },
    ],
  }))
  const built = await buildDrift(store, ctx, WEEK)
  const add = built.advice.find((item) => item.type === 'add_levers')
  const extend = built.advice.find((item) => item.type === 'extend')

  const added = await decideDriftAdvice(store, WEEK, add.id, 'accept')
  assert.equal(added.decided, 'accepted')
  assert.equal(added.advice.targetDate, '2026-11-23')
  const todos = await store.listTodoItems()
  assert.equal(todos.filter((todo) => todo.source === `偏航:${WEEK}`).length, 2)
  const levers = await store.readJson('.internal/levers.json', { days: {} })
  assert.equal(levers.days['2026-11-23'].candidates.length, 2)

  await decideDriftAdvice(store, WEEK, extend.id, 'accept')
  const afterExtend = (await store.listGoalItems())[0]
  assert.equal(afterExtend.endDate, '2026-12-15')
  assert.ok((afterExtend.records ?? []).some((record) => record.reason.includes('偏航报告建议延期')))

  const dismissed = await decideDriftAdvice(store, WEEK, add.id, 'dismiss')
  assert.equal(dismissed.advice.status, 'dismissed')

  // 手动放一条 pause / shrink / keep 验证动作
  await store.update('.internal/drift.json', { version: 1, weeks: {} }, (data) => {
    data.weeks[WEEK].advice.push(
      { id: 'a-pause', type: 'pause', goalId: 'g1', text: '暂停', status: 'pending' },
      { id: 'a-shrink', type: 'shrink', goalId: 'g1', newMeasure: '改成 1 次', text: '缩小', status: 'pending' },
      { id: 'a-keep', type: 'keep', goalId: 'g1', text: '只记录', status: 'pending' },
    )
    return data
  })
  await decideDriftAdvice(store, WEEK, 'a-pause', 'accept')
  assert.equal((await store.listGoalItems())[0].paused, true)
  const shrink = await decideDriftAdvice(store, WEEK, 'a-shrink', 'accept')
  assert.equal(shrink.clientAction.type, 'shrink')
  const keep = await decideDriftAdvice(store, WEEK, 'a-keep', 'accept')
  assert.equal(keep.advice.status, 'accepted')
})

test('保存偏航报告：Markdown 落盘，包含证据与建议', async (t) => {
  const store = await tempStore(t)
  await seedGoal(store)
  const ctx = fakeCtx(JSON.stringify({ advice: [{ type: 'keep', goalId: 'g1', text: '先观察', basis: '证据 0' }] }))
  await buildDrift(store, ctx, WEEK)
  const saved = await saveDriftReport(store, WEEK, '下周先做两件小事')
  const markdown = await fs.readFile(saved.file, 'utf8')
  assert.match(markdown, /# 偏航报告 2026-W47/)
  assert.match(markdown, /## 一、目标证据/)
  assert.match(markdown, /🔴 上线偏航报告/)
  assert.match(markdown, /先观察/)
  assert.match(markdown, /下周先做两件小事/)
})

test('周日 20:00 按设置时区生成，节假日照常，错过补生成且只一次', async (t) => {
  const store = await tempStore(t)
  await seedGoal(store)
  const ctx = { get: () => undefined } // AI 不可用时报告照常生成
  const deliveries = []
  const deliver = async (_store, payload) => { deliveries.push(payload) }

  const before = zonedTimeToUtc(2026, 11, 22, 19, 59, 0, 'Asia/Shanghai')
  await maybeGenerateWeekly(store, ctx, { now: before, deliver })
  assert.equal((await getDrift(store, WEEK)).built, false, '19:59 不应生成本周')

  const at = zonedTimeToUtc(2026, 11, 22, 20, 0, 0, 'Asia/Shanghai')
  deliveries.length = 0 // 19:59 可能补生成了上一周，这里只看本周
  const first = await maybeGenerateWeekly(store, ctx, { now: at, deliver })
  assert.equal(first.generated, true)
  assert.equal((await getDrift(store, WEEK)).built, true)
  assert.equal(deliveries.length, 1)
  assert.doesNotMatch(deliveries[0].body, /上线偏航报告/, '通知不写目标名')

  const again = await maybeGenerateWeekly(store, ctx, { now: at, deliver })
  assert.equal(again.skipped, '已生成')
  assert.equal(deliveries.length, 1, '同一周只通知一次')

  // 节假日不阻止周报
  const holidayStore = await tempStore(t)
  await holidayStore.saveSettings({ region: '上海', holidays: ['2026-11-22'] })
  await seedGoal(holidayStore)
  const holiday = await maybeGenerateWeekly(holidayStore, ctx, { now: at, deliver: async () => {} })
  assert.equal(holiday.generated, true)

  // 周一 09:00 补生成上周
  const mondayStore = await tempStore(t)
  await seedGoal(mondayStore)
  const monday = await maybeGenerateWeekly(mondayStore, ctx, { now: zonedTimeToUtc(2026, 11, 23, 9, 0, 0, 'Asia/Shanghai'), deliver: async () => {} })
  assert.equal(monday.week, WEEK)
  assert.equal(monday.generated, true)
})

test('今日 Boss：优先本周 0 证据的月目标，血量 = 100 - 进度', async (t) => {
  const store = await tempStore(t)
  await store.writeJson('goals', {
    version: 1,
    items: [
      goal({ id: 'g1', title: '免费用户', progress: 20 }),
      goal({ id: 'g2', title: '运营标准化', progress: 60 }),
      goal({ id: 'g3', title: '年度目标', cycle: '年', progress: 10 }),
    ],
  })
  await store.writeJson('.internal/suggestions.json', {
    version: 1,
    items: [{ id: 's1', goalId: 'g2', status: 'accepted', decidedAt: '2026-11-18 09:00:00', quote: '完成标准化' }],
  })
  const result = await pickBoss(store, { now: zonedTimeToUtc(2026, 11, 18, 10, 0, 0, 'Asia/Shanghai') })
  assert.equal(result.empty, false)
  assert.equal(result.boss.goalId, 'g1')
  assert.equal(result.boss.blood, 80)
  assert.equal(result.boss.evidence, 0)
  assert.ok(result.boss.daysLeft > 0)

  const empty = await pickBoss(await tempStore(t), { now: zonedTimeToUtc(2026, 11, 18, 10, 0, 0, 'Asia/Shanghai') })
  assert.equal(empty.empty, true)
})
