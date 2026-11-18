import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createRoutes } from '../lib/routes.js'
import { Store } from '../lib/store.js'

const NOW = '2026-11-17 20:00:00'

async function setup(t, { reply = '[]' } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-batch-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()
  const ctx = {
    get(name) {
      if (name === 'llm') {
        return {
          stream() {
            return (async function* () { yield { type: 'text-delta', text: reply } })()
          },
        }
      }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test', model: 'test-model' }) }
      if (name === 'sessions') return { list: () => [] }
      if (name === 'agents') return { list: () => [] }
      return undefined
    },
    webServer: { register: (definition) => definition.handler && definition },
  }
  let registered = null
  ctx.webServer.register = (definition) => { registered = definition; return () => {} }
  createRoutes({ ctx, store, reminders: {}, config: { apiPrefix: '/api/zhixing' } })
  assert.ok(registered, '应该注册 webServer handler')
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

const goal = (fields) => ({
  cycle: '月', measure: '完成 1 件事', startDate: '2026-11-01', endDate: '2026-11-30',
  parentId: null, records: [], createdAt: NOW, updatedAt: NOW, ...fields,
})

test('批量进度：只评估叶子目标，+30 截断，并忽略父目标', async (t) => {
  const reply = JSON.stringify([
    { goalId: 'g1', progress: 50, reason: '完成一半' },
    { goalId: 'g2', progress: 100, reason: '接近完成' },
    { goalId: 'c1', progress: 10, reason: '回退' },
    { goalId: 'p1', progress: 80, reason: '父目标' },
  ])
  const { handler, store } = await setup(t, { reply })
  await store.writeReport('2026-11-17', '## 今天干了什么\n- 推进了目标一')
  await store.writeJson('goals', {
    version: 1,
    items: [
      goal({ id: 'g1', title: '目标一', progress: 10 }),
      goal({ id: 'g2', title: '目标二', progress: 90 }),
      goal({ id: 'p1', title: '父目标', cycle: '季度', progress: 50, manual: true }),
      goal({ id: 'c1', title: '子目标', progress: 20, parentId: 'p1' }),
    ],
  })

  const analyzed = await call(handler, { method: 'POST', url: '/api/zhixing/goals/ai-progress-batch', body: {} })
  assert.equal(analyzed.status, 200)
  const data = JSON.parse(analyzed.payload)
  assert.equal(data.total, 3, '叶子目标：g1 / g2 / c1')
  assert.deepEqual(data.suggestions.map((item) => [item.id, item.from, item.to]), [['g1', 10, 40], ['g2', 90, 100]])

  const applied = await call(handler, {
    method: 'POST',
    url: '/api/zhixing/goals/ai-progress-batch/apply',
    body: { items: [
      { goalId: 'g1', progress: 50, reason: '完成一半' },
      { goalId: 'g2', progress: 100, reason: '接近完成' },
      { goalId: 'p1', progress: 80, reason: '父目标不能直接改' },
    ] },
  })
  assert.equal(applied.status, 200)
  const appliedData = JSON.parse(applied.payload)
  assert.equal(appliedData.updated.length, 2)

  const list = await call(handler, { method: 'GET', url: '/api/zhixing/goals' })
  const goals = JSON.parse(list.payload).goals
  const byId = new Map(goals.map((item) => [item.id, item]))
  assert.equal(byId.get('g1').progress, 40)
  assert.equal(byId.get('g2').progress, 100)
  assert.equal(byId.get('p1').progress, 50)
})

test('批量进度：有目标但没有日报或汇总时返回 400', async (t) => {
  const { handler, store } = await setup(t)
  await store.writeJson('goals', { version: 1, items: [goal({ id: 'g1', title: '目标一', progress: 10 })] })
  const res = await call(handler, { method: 'POST', url: '/api/zhixing/goals/ai-progress-batch', body: {} })
  assert.equal(res.status, 400)
})
