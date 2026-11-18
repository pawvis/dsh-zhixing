import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createRoutes } from '../lib/routes.js'
import {
  appendIdentityEvidence,
  historyList,
  identityEvidence,
  parseNorthStar,
  readHistory,
  readNorthStar,
  saveNorthStar,
  serializeNorthStar,
} from '../lib/northstar.js'
import { assertNoPersonal, canSendToModel } from '../lib/privacy.js'
import { Store } from '../lib/store.js'

async function tempStore(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-northstar-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()
  return store
}

function fakeCtx(replies = []) {
  const calls = []
  let index = 0
  return {
    calls,
    get(name) {
      if (name === 'llm') {
        return {
          stream(payload) {
            calls.push(payload)
            const text = Array.isArray(replies) ? (replies[index++ % replies.length] ?? '{}') : String(replies)
            return (async function* () { yield { type: 'text-delta', text } })()
          },
        }
      }
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test', model: 'test-model' }) }
      if (name === 'sessions') return { list: () => [] }
      if (name === 'agents') return { list: () => [] }
      return undefined
    },
  }
}

async function setupRoutes(t) {
  const store = await tempStore(t)
  let registered = null
  const ctx = fakeCtx([JSON.stringify({ goals: [{ title: '测试目标', cycle: '月', startDate: '2026-11-01', endDate: '2026-11-30', measure: '完成 1 件', parentIndex: null }] })])
  ctx.webServer = { register: (definition) => { registered = definition; return () => {} } }
  createRoutes({ ctx, store, reminders: {}, config: { apiPrefix: '/api/zhixing' } })
  return { store, ctx, handler: registered.handler }
}

function call(handler, { method = 'GET', url, body } = {}) {
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

test('北极星 Markdown 解析 / 回写往返不丢未知段落', () => {
  const markdown = `<!-- zhixing:northstar version=2 updatedAt=2026-11-18T00:00:00.000Z -->
# 北极星

## 反愿景
不想变成只会开会的人

## 一句话愿景
每周交付一个小产品

## 身份宣言
- 我是每周交付一个小产品的独立开发者

## 规则
- 不牺牲睡眠

## 我的额外段落
手写内容要保留`
  const parsed = parseNorthStar(markdown)
  assert.equal(parsed.version, 2)
  assert.equal(parsed.antiVision, '不想变成只会开会的人')
  assert.equal(parsed.vision, '每周交付一个小产品')
  assert.equal(parsed.identity.length, 1)
  assert.equal(parsed.rules[0], '不牺牲睡眠')
  assert.equal(parsed.extra[0].title, '我的额外段落')
  const round = serializeNorthStar({ ...parsed, version: 3, updatedAt: '2026-11-19T00:00:00.000Z' })
  assert.match(round, /## 我的额外段落/)
  assert.match(round, /手写内容要保留/)
  const again = parseNorthStar(round)
  assert.equal(again.version, 3)
  assert.equal(again.vision, '每周交付一个小产品')
})

test('保存北极星：首次 v1；小修改不改版本；新版本进历史', async (t) => {
  const store = await tempStore(t)
  const first = await saveNorthStar(store, { fields: { antiVision: 'A', vision: 'V1', identity: ['我是 A'], rules: ['不熬夜'] } })
  assert.equal(first.version, 1)
  assert.equal((await readNorthStar(store)).vision, 'V1')

  const minor = await saveNorthStar(store, { fields: { antiVision: 'A', vision: 'V1.1', identity: ['我是 A'], rules: [] } })
  assert.equal(minor.version, 1)
  assert.deepEqual(await historyList(store), [])

  const versioned = await saveNorthStar(store, { fields: { antiVision: 'A', vision: 'V2', identity: ['我是 A'], rules: [] }, mode: 'version' })
  assert.equal(versioned.version, 2)
  const history = await historyList(store)
  assert.equal(history.length, 1)
  assert.equal(history[0].version, 1)
  const old = await readHistory(store, 1)
  assert.match(old.markdown, /V1\.1/)
  assert.equal((await readNorthStar(store)).vision, 'V2')
})

test('身份证据：按身份宣言统计本月条数，追加去重', async (t) => {
  const store = await tempStore(t)
  await saveNorthStar(store, { fields: { vision: 'V', identity: ['我是交付者', '我是运营'] } })
  const data = await readNorthStar(store)
  const first = data.identity[0]
  const month = '2026-11'
  await appendIdentityEvidence(store, [
    { identityId: first.id, date: `${month}-16`, text: '发布知行 1.1.1', source: '日报 2026-11-16' },
    { identityId: first.id, date: `${month}-16`, text: '发布知行 1.1.1', source: '日报 2026-11-16' },
  ])
  const counts = await identityEvidence(store, data.identity, new Date(2026, 10, 20))
  assert.equal(counts[0].evidenceCount, 1)
  assert.equal(counts[0].evidence[0].text, '发布知行 1.1.1（来源：日报 2026-11-16）')
})

test('northstar.js 不引用 AI；隐私开关规则正确', async () => {
  const source = await fs.readFile(new URL('../lib/northstar.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /callModel|from '\.\/ai\.js'/)
  assert.equal(canSendToModel('northstar', { audience: '团队', settings: { northStar: { shareWithAI: true } } }), false)
  assert.equal(canSendToModel('northstar', { audience: '上级', settings: { northStar: { shareWithAI: true } } }), false)
  assert.equal(canSendToModel('northstar', { audience: '', settings: { northStar: { shareWithAI: true } } }), true)
  assert.equal(canSendToModel('northstar', { audience: '', settings: { northStar: { shareWithAI: false } } }), false)
  assert.throws(() => assertNoPersonal('包含秘密方向', ['秘密方向']), (error) => error.code === 'PERSONAL_LEAK')
  assert.equal(assertNoPersonal('普通周报', ['秘密方向']), true)
})

test('GET /northstar 返回正文与身份证据；/state 不返回正文', async (t) => {
  const { store, handler } = await setupRoutes(t)
  await saveNorthStar(store, { fields: { antiVision: '不想开会', vision: '每周交付', identity: ['我是交付者'], rules: ['不熬夜'] } })
  const secret = '不想开会'
  const data = await call(handler, { url: '/api/zhixing/northstar' })
  assert.equal(data.status, 200)
  const payload = JSON.parse(data.payload)
  assert.equal(payload.exists, true)
  assert.equal(payload.antiVision, secret)

  const state = await call(handler, { url: '/api/zhixing/state' })
  assert.equal(state.status, 200)
  assert.equal(state.payload.includes(secret), false, '/state 不能出现北极星正文')
  const stateData = JSON.parse(state.payload)
  assert.equal(stateData.northStar.exists, true)
  assert.equal(stateData.northStar.version, 1)
})

test('saveWithAI=false 时目标拆解 prompt 不含北极星；打开后才带一句话愿景', async (t) => {
  const { store, ctx, handler } = await setupRoutes(t)
  const secret = '秘密方向XYZ'
  await saveNorthStar(store, { fields: { vision: secret, identity: ['我是交付者'] } })

  await call(handler, { method: 'POST', url: '/api/zhixing/goals/import/parse', body: { text: '做一些事' } })
  assert.equal(ctx.calls.length, 1)
  assert.equal(String(ctx.calls[0].messages[0].content[0].text).includes(secret), false)

  await store.saveSettings({ northStar: { shareWithAI: true } })
  await call(handler, { method: 'POST', url: '/api/zhixing/goals/import/parse', body: { text: '做一些事' } })
  assert.equal(ctx.calls.length, 2)
  assert.equal(String(ctx.calls[1].messages[0].content[0].text).includes(secret), true)
})

test('北极星历史接口：列表与按版本读取', async (t) => {
  const { store, handler } = await setupRoutes(t)
  await saveNorthStar(store, { fields: { vision: 'V1' } })
  await saveNorthStar(store, { fields: { vision: 'V2' }, mode: 'version' })

  const list = await call(handler, { url: '/api/zhixing/northstar/history' })
  assert.equal(list.status, 200)
  assert.equal(JSON.parse(list.payload).items.length, 1)

  const old = await call(handler, { url: '/api/zhixing/northstar/history/read?v=1' })
  assert.equal(old.status, 200)
  assert.match(JSON.parse(old.payload).markdown, /V1/)

  const missing = await call(handler, { url: '/api/zhixing/northstar/history/read?v=99' })
  assert.equal(missing.status, 404)
  const bad = await call(handler, { url: '/api/zhixing/northstar/history/read?v=../x' })
  assert.equal(bad.status, 400)
})
