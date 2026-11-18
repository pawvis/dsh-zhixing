import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { metricsSummary, track } from '../lib/metrics.js'
import { Store } from '../lib/store.js'

async function tempStore(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-metrics-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()
  return store
}

test('统计按天累计、只存数字，汇总最近 4 周', async (t) => {
  const store = await tempStore(t)
  const day1 = new Date(2026, 10, 17, 10, 0)
  const day2 = new Date(2026, 10, 18, 10, 0)
  await track(store, 'report', 1, { now: day1 })
  await track(store, 'leverSet', 1, { now: day2 })
  await track(store, 'leverItems', 3, { now: day2 })
  await track(store, 'adviceAccept', 1, { now: day2 })
  await track(store, 'adviceDismiss', 1, { now: day2 })
  const summary = await metricsSummary(store, { weeks: 4, now: new Date(2026, 10, 18, 12, 0) })
  assert.equal(summary.activeDays, 2)
  assert.equal(summary.totals.report, 1)
  assert.equal(summary.totals.leverItems, 3)
  assert.equal(summary.adviceAcceptRate, 50)
  const raw = await store.readJson('.internal/metrics.json', { days: {} })
  const text = JSON.stringify(raw)
  assert.doesNotMatch(text, /日报|内容|标题/, '统计文件不应有内容')
})
