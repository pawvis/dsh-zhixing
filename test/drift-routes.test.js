import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createRoutes } from '../lib/routes.js'
import { Store } from '../lib/store.js'

async function setup(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-drift-routes-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()
  await store.saveSettings({ region: '上海' })
  await store.writeJson('goals', {
    version: 1,
    items: [{ id: 'g1', title: '免费用户', cycle: '月', measure: '10 个用户', startDate: '2026-11-01', endDate: '2026-12-31', progress: 20, parentId: null, records: [] }],
  })
  let registered = null
  const ctx = {
    get(name) {
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test', model: 'test-model' }) }
      if (name === 'sessions') return { list: () => [] }
      if (name === 'agents') return { list: () => [] }
      return undefined
    },
    webServer: { register: (definition) => { registered = definition; return () => {} } },
  }
  createRoutes({ ctx, store, reminders: {}, config: { apiPrefix: '/api/zhixing' } })
  return { handler: registered.handler, store }
}

function call(handler, { method = 'GET', url, body } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.url = url
  req.headers = body === undefined ? {} : { 'content-type': 'application/json' }
  return new Promise((resolve) => {
    const res = { status: 0, payload: '', writeHead(status) { this.status = status }, end(chunk) { this.payload = String(chunk ?? ''); resolve(this) } }
    handler(req, res)
  })
}

test('偏航 / Boss / 统计路由可用', async (t) => {
  const { handler, store } = await setup(t)

  const live = await call(handler, { url: '/api/zhixing/drift?week=2026-W47' })
  assert.equal(live.status, 200)
  assert.equal(JSON.parse(live.payload).built, false)

  const built = await call(handler, { method: 'POST', url: '/api/zhixing/drift/build', body: { week: '2026-W47' } })
  assert.equal(built.status, 200)
  assert.equal(JSON.parse(built.payload).week, '2026-W47')

  const saved = await call(handler, { method: 'POST', url: '/api/zhixing/drift/save', body: { week: '2026-W47', note: '下周先做两件小事' } })
  assert.equal(saved.status, 200)
  assert.ok(JSON.parse(saved.payload).file.endsWith('2026-W47.md'))

  const list = await call(handler, { url: '/api/zhixing/drift/list' })
  assert.equal(list.status, 200)
  assert.equal(JSON.parse(list.payload).items.length, 1)

  const boss = await call(handler, { url: '/api/zhixing/boss/today' })
  assert.equal(boss.status, 200)
  assert.equal(JSON.parse(boss.payload).empty, false)

  const metrics = await call(handler, { url: '/api/zhixing/metrics?weeks=4' })
  assert.equal(metrics.status, 200)
  assert.equal(typeof JSON.parse(metrics.payload).activeDays, 'number')

  const badWeek = await call(handler, { url: '/api/zhixing/drift?week=2026-47' })
  assert.equal(badWeek.status, 400)
  await store.readJson('goals', {})
})
