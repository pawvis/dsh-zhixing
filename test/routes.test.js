import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createRoutes } from '../lib/routes.js'
import { Store } from '../lib/store.js'

async function setup(t, { debug = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-routes-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()
  let registered = null
  const ctx = {
    get: () => undefined,
    webServer: { register: (definition) => { registered = definition; return () => {} } },
  }
  const previous = process.env.ZHIXING_DEBUG
  if (debug) process.env.ZHIXING_DEBUG = '1'
  else delete process.env.ZHIXING_DEBUG
  t.after(() => {
    if (previous === undefined) delete process.env.ZHIXING_DEBUG
    else process.env.ZHIXING_DEBUG = previous
  })
  const reminders = { morning: async () => ({}), evening: async () => ({}), tick: async () => ({}) }
  createRoutes({ ctx, store, reminders, config: { apiPrefix: '/api/zhixing' } })
  assert.ok(registered, '应该注册 webServer handler')
  return registered.handler
}

function request(handler, { method = 'GET', url, body, contentType = 'application/json' }) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.url = url
  req.headers = contentType === null ? {} : { 'content-type': contentType }
  return new Promise((resolve) => {
    const res = {
      status: 0,
      headers: {},
      payload: '',
      writeHead(status, headers) { this.status = status; this.headers = headers ?? {} },
      end(chunk) { this.payload = String(chunk ?? ''); resolve(this) },
    }
    handler(req, res)
  })
}

test('写接口要求 Content-Type: application/json，text/plain 返回 415', async (t) => {
  const handler = await setup(t)
  const res = await request(handler, { method: 'POST', url: '/api/zhixing/collect', contentType: 'text/plain', body: { date: '2026-11-17' } })
  assert.equal(res.status, 415)
})

test('日期参数路径穿越被拒绝（POST /collect）', async (t) => {
  const handler = await setup(t)
  const res = await request(handler, { method: 'POST', url: '/api/zhixing/collect', body: { date: '../../etc' } })
  assert.equal(res.status, 400)
  assert.match(JSON.parse(res.payload).error, /日期/)
})

test('日期参数路径穿越被拒绝（GET /state）', async (t) => {
  const handler = await setup(t)
  const res = await request(handler, { method: 'GET', url: '/api/zhixing/state?date=../../etc' })
  assert.equal(res.status, 400)
})

test('不存在的日期被拒绝（GET /report?date=2026-13-01）', async (t) => {
  const handler = await setup(t)
  const res = await request(handler, { method: 'GET', url: '/api/zhixing/report?date=2026-13-01' })
  assert.equal(res.status, 400)
})

test('/debug/* 默认关闭：返回 404', async (t) => {
  const handler = await setup(t, { debug: false })
  const res = await request(handler, { method: 'GET', url: '/api/zhixing/debug/state' })
  assert.equal(res.status, 404)
})

test('/debug/* 在 ZHIXING_DEBUG=1 时可用', async (t) => {
  const handler = await setup(t, { debug: true })
  const res = await request(handler, { method: 'GET', url: '/api/zhixing/debug/state' })
  assert.equal(res.status, 200)
})

test('目标导入保存会带上详细说明，读回来也还在', async (t) => {
  const handler = await setup(t)
  const saved = await request(handler, {
    method: 'POST',
    url: '/api/zhixing/goals/import/save',
    body: { goals: [{ title: '华东客户回访', detail: '覆盖华东区 20 家重点客户，输出改进报告', cycle: '月', startDate: '2026-11-01', endDate: '2026-11-30', measure: '回访 20 家', parentIndex: null }] },
  })
  assert.equal(saved.status, 200)
  const created = JSON.parse(saved.payload).created[0]
  assert.equal(created.detail, '覆盖华东区 20 家重点客户，输出改进报告')

  const list = await request(handler, { method: 'GET', url: '/api/zhixing/goals' })
  assert.equal(JSON.parse(list.payload).goals[0].detail, '覆盖华东区 20 家重点客户，输出改进报告')
})
