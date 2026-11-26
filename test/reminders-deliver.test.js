import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createReminders, deliver } from '../lib/reminders.js'
import { setLevers, setTop } from '../lib/levers.js'
import { Store } from '../lib/store.js'

/** 最小 store：只实现 deliver 用到的 getState/update。 */
function memoryStore(initial = {}) {
  const state = { notices: [], ...initial }
  return {
    async getState() { return structuredClone(state) },
    async update(_key, _fallback, mutate) {
      const result = await mutate(state)
      return result ?? state
    },
    snapshot() { return structuredClone(state) },
  }
}

test('deliver 只写待显示队列，不再调用 osascript', async () => {
  const store = memoryStore()
  const result = await deliver(store, { kind: 'morning', title: '知行 · 早安', body: '今天有 2 项待办' })

  assert.equal(result.queued, true)
  assert.equal(result.channel, 'client')
  assert.match(result.notice.id, /^morning-\d+$/)

  const { notices } = store.snapshot()
  assert.equal(notices.length, 1)
  assert.equal(notices[0].title, '知行 · 早安')
  assert.equal(notices[0].body, '今天有 2 项待办')
})

test('窗口在后台或没有页面心跳时也进队列，显示方式由页面决定', async () => {
  const stale = memoryStore({ heartbeat: { ts: 0, visible: false } })
  const hidden = memoryStore({ heartbeat: { ts: Date.now(), visible: false } })

  // 旧实现会因心跳过期/不可见改走 desktop（osascript）；现在一律排队。
  assert.equal((await deliver(stale, { kind: 'evening', title: 't', body: 'b', channel: 'auto' })).channel, 'client')
  assert.equal((await deliver(hidden, { kind: 'evening', title: 't', body: 'b', channel: 'desktop' })).channel, 'client')
  assert.equal(stale.snapshot().notices.length, 1)
  assert.equal(hidden.snapshot().notices.length, 1)
})

test('队列最多保留 20 条', async () => {
  const store = memoryStore()
  for (let index = 0; index < 25; index += 1) {
    await deliver(store, { kind: `k${index}`, title: `t${index}`, body: 'b' })
  }
  assert.equal(store.snapshot().notices.length, 20)
  assert.equal(store.snapshot().notices.at(-1).title, 't24')
})

test('morning() 把第一重点带进早安文案；取消第一重点后回到「去重点卡里选」（1-4 集成）', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-reminders-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()
  await store.saveSettings({ region: '上海', holidays: [], extraWorkdays: [] })
  await store.writeJson('todos', {
    version: 1,
    items: [
      { id: 't1', content: '写偏航报告测试', date: '2026-11-18', status: '未做', goalId: null },
      { id: 't2', content: '回邮件', date: '2026-11-18', status: '未做', goalId: null },
    ],
  })
  await setLevers(store, { date: '2026-11-18', items: ['t1', 't2'] })
  await setTop(store, '2026-11-18', 't1')

  const reminders = createReminders({ ctx: { get: () => undefined }, store })
  const now = new Date('2026-11-18T08:00:00+08:00')

  const withTop = await reminders.morning({ now, force: true })
  assert.equal(withTop.body, '今天的第一重点：写偏航报告测试。如果今天只做一件事，就先做它。今天的重点：1) 写偏航报告测试；2) 回邮件。')
  assert.doesNotMatch(withTop.body, /杠杆|北极星/)

  await setTop(store, '2026-11-18', null)
  const noTop = await reminders.morning({ now, force: true })
  assert.equal(noTop.body, '如果今天只做一件事，哪件最能推进你的目标？去重点卡里点 ★ 选一个。今天的重点：1) 写偏航报告测试；2) 回邮件。')
})
