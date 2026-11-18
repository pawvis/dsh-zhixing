import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createRoutes } from '../lib/routes.js'
import { Store } from '../lib/store.js'

async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-v2-routes-'))
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
  await store.writeJson('goals', {
    version: 1,
    items: [{ id: 'g1', title: '上线偏航报告', cycle: '月', measure: '报告可用', startDate: '2026-11-01', endDate: '2026-11-30', progress: 20, parentId: null, records: [] }],
  })
  await store.writeJson('todos', {
    version: 1,
    items: [
      { id: 't1', content: '写偏航报告测试', date: '2026-11-18', status: '未做', goalId: 'g1' },
      { id: 't2', content: '回复邮件', date: '2026-11-18', status: '未做', goalId: null },
      { id: 't3', content: 'A', date: '2026-11-18', status: '未做', goalId: null },
      { id: 't4', content: 'B', date: '2026-11-18', status: '未做', goalId: null },
      { id: 't5', content: 'C', date: '2026-11-18', status: '未做', goalId: null },
    ],
  })
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

test('GET /levers 返回候选池与目标下拉；/state 带 levers', async (t) => {
  const { handler } = await setup(t)
  const res = await call(handler, { url: '/api/zhixing/levers?date=2026-11-18' })
  assert.equal(res.status, 200)
  const data = JSON.parse(res.payload)
  assert.equal(data.date, '2026-11-18')
  assert.ok(data.pool.some((todo) => todo.id === 't1'))
  assert.ok(data.goals.some((goal) => goal.id === 'g1'))

  const state = await call(handler, { url: '/api/zhixing/state?date=2026-11-18' })
  assert.equal(state.status, 200)
  const stateData = JSON.parse(state.payload)
  assert.equal(stateData.levers.date, '2026-11-18')
  assert.equal(stateData.levers.total, 0)
})

test('POST /levers/set：2 个成功、5 个 400、非法日期 400、skip 生效', async (t) => {
  const { handler } = await setup(t)
  const two = await call(handler, {
    method: 'POST', url: '/api/zhixing/levers/set',
    body: { date: '2026-11-18', items: [{ todoId: 't1', goalId: 'g1' }, { todoId: 't2' }] },
  })
  assert.equal(two.status, 200)
  assert.equal(JSON.parse(two.payload).items.length, 2)

  const five = await call(handler, {
    method: 'POST', url: '/api/zhixing/levers/set',
    body: { date: '2026-11-18', items: ['t1', 't2', 't3', 't4', 't5'] },
  })
  assert.equal(five.status, 400)

  const badDate = await call(handler, {
    method: 'POST', url: '/api/zhixing/levers/set',
    body: { date: '../../x', items: ['t1'] },
  })
  assert.equal(badDate.status, 400)

  const skipped = await call(handler, { method: 'POST', url: '/api/zhixing/levers/skip', body: { date: '2026-11-18' } })
  assert.equal(skipped.status, 200)
  assert.equal(JSON.parse(skipped.payload).skipped, true)
})

test('POST /levers/suggest：AI 不可用时返回本地候选', async (t) => {
  const { handler } = await setup(t)
  const res = await call(handler, { method: 'POST', url: '/api/zhixing/levers/suggest', body: { date: '2026-11-18', force: true } })
  assert.equal(res.status, 200)
  const data = JSON.parse(res.payload)
  assert.equal(data.by, 'local')
  assert.ok(data.candidates.length >= 2)
})

test('待办完成写 doneAt，重新打开时清掉', async (t) => {
  const { handler, store } = await setup(t)
  await call(handler, {
    method: 'POST', url: '/api/zhixing/levers/set',
    body: { date: '2026-11-18', items: ['t1', 't2'] },
  })
  await call(handler, { method: 'POST', url: '/api/zhixing/todos/status', body: { id: 't1', status: '完成' } })
  let todos = await store.listTodoItems()
  assert.ok(todos.find((todo) => todo.id === 't1').doneAt)

  const res = await call(handler, { url: '/api/zhixing/levers?date=2026-11-18' })
  assert.equal(JSON.parse(res.payload).done, 1)

  await call(handler, { method: 'POST', url: '/api/zhixing/todos/status', body: { id: 't1', status: '未做' } })
  todos = await store.listTodoItems()
  assert.equal(todos.find((todo) => todo.id === 't1').doneAt, undefined)
})
