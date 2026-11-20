import test from 'node:test'
import assert from 'node:assert/strict'
import { deliver } from '../lib/reminders.js'

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
