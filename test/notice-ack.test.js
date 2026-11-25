import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createRoutes } from '../lib/routes.js'
import { Store } from '../lib/store.js'

async function setup(t, notices = []) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-notice-ack-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()
  let registered = null
  const ctx = {
    get: () => undefined,
    webServer: { register: (definition) => { registered = definition; return () => {} } },
  }
  createRoutes({ ctx, store, reminders: {}, config: { apiPrefix: '/api/zhixing' } })
  assert.ok(registered, '应该注册 webServer handler')
  await store.writeJson('state', { notices, heartbeat: null })
  return { handler: registered.handler, store }
}

function call(handler, { method = 'GET', url, body }) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.url = url
  req.headers = body === undefined ? {} : { 'content-type': 'application/json' }
  return new Promise((resolve) => {
    const res = {
      status: 0,
      payload: '',
      writeHead(status) { this.status = status },
      end(chunk) { this.payload = String(chunk ?? ''); resolve(this) },
    }
    handler(req, res)
  })
}

const notices = [
  { id: 'goal-1', kind: 'goal', title: '目标提醒 1', body: 'b1', ts: 1 },
  { id: 'goal-2', kind: 'goal', title: '目标提醒 2', body: 'b2', ts: 2 },
  { id: 'drift-3', kind: 'drift', title: '复盘提醒', body: 'b3', ts: 3 },
]

test('POST /notice-ack 只删掉指定 id，其余提醒保留', async (t) => {
  const { handler, store } = await setup(t, notices)
  const res = await call(handler, { method: 'POST', url: '/api/zhixing/notice-ack', body: { ids: ['goal-1'] } })
  assert.equal(res.status, 200)
  const { notices: left } = await store.getState()
  assert.deepEqual(left.map((notice) => notice.id), ['goal-2', 'drift-3'])
})

test('POST /notice-ack 带 all 时一次清空所有待看提醒', async (t) => {
  const { handler, store } = await setup(t, notices)
  // 前端会同时带上队列里的 ids：即使 ids 不全，all 也要把剩下的清掉。
  const res = await call(handler, { method: 'POST', url: '/api/zhixing/notice-ack', body: { all: true, ids: ['goal-1'] } })
  assert.equal(res.status, 200)
  const state = await store.getState()
  assert.deepEqual(state.notices, [])
  assert.equal(state.lastNotify?.ackedAll, true)
})
