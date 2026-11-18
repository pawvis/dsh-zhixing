import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { computeWeekEvidence, computeWeekLevers, assertWeekKey, weekKeyOf, weekRange } from '../lib/drift.js'
import { Store, ValidationError } from '../lib/store.js'

async function tempStore(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-drift-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()
  return store
}

const goal = (fields) => ({
  cycle: '月', measure: '完成 1 件事', startDate: '2026-01-01', endDate: '2026-12-31',
  parentId: null, progress: 10, records: [], createdAt: '2026-01-01 00:00:00', updatedAt: '2026-01-01 00:00:00', ...fields,
})

test('周键：2026-11-16 是 W47，周范围周一到周日', () => {
  assert.equal(weekKeyOf('2026-11-16'), '2026-W47')
  assert.equal(weekKeyOf('2026-11-22'), '2026-W47')
  assert.deepEqual(weekRange('2026-W47'), { from: '2026-11-16', to: '2026-11-22', week: '2026-W47' })
  assert.equal(assertWeekKey('2026-W47'), '2026-W47')
  assert.throws(() => assertWeekKey('2026-47'), (error) => error instanceof ValidationError)
  assert.throws(() => assertWeekKey('2026-W54'), (error) => error instanceof ValidationError)
})

test('证据统计：四类来源 + 父目标汇总 + AI 记录不计 + 暂停/完成目标排除', async (t) => {
  const store = await tempStore(t)
  await store.writeJson('goals', {
    version: 1,
    items: [
      goal({ id: 'g1', title: '子目标', progress: 40 }),
      goal({ id: 'p1', title: '父目标', cycle: '年', progress: 50 }),
      goal({ id: 'g3', title: '暂停目标', paused: true }),
      goal({ id: 'g4', title: '已完成目标', progress: 100 }),
      goal({ id: 'g5', title: '零证据目标', endDate: '2026-12-31' }),
    ],
  })
  // p1 -> g1 父子关系
  await store.update('goals', { version: 1, items: [] }, (data) => {
    data.items.find((item) => item.id === 'g1').parentId = 'p1'
    return data
  })
  await store.writeJson('todos', {
    version: 1,
    items: [
      { id: 't1', content: '完成子目标的一部分', date: '2026-11-18', status: '完成', goalId: 'g1', doneAt: '2026-11-18T12:00:00.000Z', postponedFrom: [] },
    ],
  })
  await store.writeJson('.internal/suggestions.json', {
    version: 1,
    items: [
      { id: 's1', goalId: 'g1', status: 'accepted', decidedAt: '2026-11-17 10:00:00' },
      { id: 's2', goalId: 'g3', status: 'accepted', decidedAt: '2026-11-17 10:00:00' },
      { id: 's3', goalId: 'g1', status: 'accepted', decidedAt: '2026-11-23 10:00:00' },
      { id: 's4', goalId: 'g1', status: 'dismissed', decidedAt: '2026-11-18 10:00:00' },
    ],
  })
  await store.writeJson('.internal/report-meta.json', {
    version: 1,
    items: { '2026-11-16': { goalIds: ['g1'] }, '2026-11-23': { goalIds: ['g1'] } },
  })
  await store.writeReport('2026-11-16', '## 今天干了什么\n- 推进子目标')
  await store.writeReport('2026-11-23', '## 今天干了什么\n- 下周的日报')
  await store.update('goals', { version: 1, items: [] }, (data) => {
    const target = data.items.find((item) => item.id === 'g1')
    target.records = [
      { at: '2026-11-19 09:00:00', reason: '手动更新' },
      { at: '2026-11-19 10:00:00', reason: 'AI 更新：根据日报' },
      { at: '2026-11-20 10:00:00', reason: '采纳日报建议：有推进' },
      { at: '2026-11-24 10:00:00', reason: '手动更新' },
    ]
    return data
  })
  await store.writeJson('.internal/levers.json', {
    version: 1,
    days: { '2026-11-18': { items: [{ todoId: 't1', goalId: 'g1', rank: 1, by: 'ai' }], candidateStatus: 'confirmed' } },
  })

  const result = await computeWeekEvidence(store, '2026-W47')
  const byId = new Map(result.goals.map((row) => [row.goalId, row]))
  // g1: 建议 1 + 日报 1 + 杠杆 1 + 人工记录 1 = 4
  assert.equal(byId.get('g1').evidence, 4)
  assert.deepEqual(byId.get('g1').sources, { suggestions: 1, reports: 1, levers: 1, records: 1 })
  assert.equal(byId.get('g1').signal, 'green')
  assert.equal(byId.get('p1').evidence, 4, '父目标 = 子目标证据之和')
  assert.equal(byId.has('g3'), false, '暂停目标不统计')
  assert.equal(byId.has('g4'), false, '已完成目标不统计')
  assert.equal(byId.get('g5').evidence, 0)
  assert.equal(byId.get('g5').signal, 'red')
})

test('redStreak：连续多周 0 证据按需回算', async (t) => {
  const store = await tempStore(t)
  await store.writeJson('goals', {
    version: 1,
    items: [goal({ id: 'g1', title: '长期目标', cycle: '年', progress: 10 })],
  })
  const result = await computeWeekEvidence(store, '2026-W47', { withStreak: true })
  assert.equal(result.goals[0].evidence, 0)
  assert.ok(result.goals[0].redStreak >= 2, `期望连续周数 >=2，实际 ${result.goals[0].redStreak}`)
})

test('杠杆统计：设置天数、少于 2 个、完成数、顺延最多', async (t) => {
  const store = await tempStore(t)
  await store.writeJson('todos', {
    version: 1,
    items: [
      { id: 't1', content: 'A', date: '2026-11-16', status: '完成', postponedFrom: [] },
      { id: 't2', content: 'B', date: '2026-11-17', status: '未做', postponedFrom: ['2026-11-10', '2026-11-11'] },
      { id: 't3', content: 'C', date: '2026-11-18', status: '完成', postponedFrom: [] },
    ],
  })
  await store.writeJson('.internal/levers.json', {
    version: 1,
    days: {
      '2026-11-16': { items: [{ todoId: 't1' }], candidateStatus: 'confirmed' },
      '2026-11-17': { items: [{ todoId: 't2' }], candidateStatus: 'confirmed' },
      '2026-11-18': { items: [{ todoId: 't1' }, { todoId: 't3' }], candidateStatus: 'confirmed' },
    },
  })
  const stats = await computeWeekLevers(store, '2026-W47')
  assert.equal(stats.workdays, 5)
  assert.equal(stats.daysSet, 3)
  assert.equal(stats.daysBelowMin, 2)
  assert.equal(stats.total, 4)
  assert.equal(stats.done, 3)
  assert.equal(stats.mostPostponed.times, 2)
})
