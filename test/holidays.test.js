import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parseHolidayCn, ensureHolidayYear, effectiveSettings, holidayStatus } from '../lib/holidays.js'
import { isWorkday } from '../lib/reminders.js'
import { Store } from '../lib/store.js'

const FIXTURE = JSON.stringify({
  year: 2026,
  papers: ['https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm'],
  days: [
    { name: '国庆节', date: '2026-10-01', isOffDay: true },
    { name: '国庆节', date: '2026-10-02', isOffDay: true },
    { name: '国庆节', date: '2026-10-10', isOffDay: false },
  ],
})

async function tempStore(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-holidays-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()
  return store
}

test('解析 holiday-cn：休息日 / 调休上班日分开', () => {
  const parsed = parseHolidayCn(FIXTURE)
  assert.deepEqual(parsed.holidays, ['2026-10-01', '2026-10-02'])
  assert.deepEqual(parsed.workdays, ['2026-10-10'])
  assert.equal(parsed.papers.length, 1)
  assert.throws(() => parseHolidayCn('not json'), /不是合法 JSON/)
})

test('自动获取：缓存 30 天、force 强制刷新', async (t) => {
  const store = await tempStore(t)
  let calls = 0
  const fetchText = async () => { calls += 1; return FIXTURE }
  const at = Date.parse('2026-11-01T00:00:00Z')
  const first = await ensureHolidayYear(store, 2026, { fetchText, now: at })
  assert.equal(calls, 1)
  assert.deepEqual(first.holidays, ['2026-10-01', '2026-10-02'])

  const cached = await ensureHolidayYear(store, 2026, { fetchText: async () => { throw new Error('不该请求') }, now: at + 86_400_000 })
  assert.equal(cached.workdays[0], '2026-10-10')

  await ensureHolidayYear(store, 2026, { fetchText, now: at + 31 * 86_400_000 })
  assert.equal(calls, 2)

  await ensureHolidayYear(store, 2026, { fetchText, force: true, now: at + 31 * 86_400_000 })
  assert.equal(calls, 3)

  const status = await holidayStatus(store, { years: [2026], now: new Date(2026, 10, 18) })
  assert.equal(status.years[0].holidays.length, 2)
  assert.equal(status.years[0].missing, false)
})

test('主数据源失败时自动换镜像；全部失败保留旧缓存', async (t) => {
  const store = await tempStore(t)
  let calls = 0
  const fetchText = async () => { calls += 1; throw new Error('镜像不可用') }
  await assert.rejects(ensureHolidayYear(store, 2027, { fetchText, now: Date.parse('2026-11-01T00:00:00Z') }), /节假日自动获取失败/)
  assert.equal(calls, 2, '应依次尝试两个镜像')
  // 6 小时内不再重复尝试，避免每分钟打网络
  await assert.rejects(ensureHolidayYear(store, 2027, { fetchText, now: Date.parse('2026-11-01T01:00:00Z') }), /稍后自动重试/)
  assert.equal(calls, 2)
})

test('自动节假日合并手动项：手动节假日覆盖自动调休', async (t) => {
  const store = await tempStore(t)
  await ensureHolidayYear(store, 2026, { fetchText: async () => FIXTURE, now: Date.parse('2026-11-01T00:00:00Z') })
  const settings = {
    skipWeekends: true,
    holidays: ['2026-10-10'],
    extraWorkdays: ['2026-10-11'],
  }
  const merged = await effectiveSettings(store, settings)
  assert.ok(merged.holidays.includes('2026-10-01'))
  assert.ok(merged.holidays.includes('2026-10-10'))
  assert.ok(merged.extraWorkdays.includes('2026-10-11'))
  assert.equal(merged.extraWorkdays.includes('2026-10-10'), false, '手动节假日应覆盖自动调休')
  assert.equal(isWorkday(merged, '2026-10-01'), false)
  assert.equal(isWorkday(merged, '2026-10-10'), false)
  assert.equal(isWorkday(merged, '2026-10-11'), true)
  assert.equal(isWorkday(merged, '2026-10-12'), true)
  assert.equal(isWorkday(merged, '2026-10-17'), false)
})
