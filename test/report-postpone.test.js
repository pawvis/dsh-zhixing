import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { postponeTodos } from '../lib/report.js'
import { Store } from '../lib/store.js'

async function tempStore(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-postpone-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()
  return store
}

test('顺延两次后 postponedFrom 记录两个原日期', async (t) => {
  const store = await tempStore(t)
  await store.writeJson('todos', {
    version: 1,
    items: [
      { id: 'a', content: '写周报', date: '2026-11-17', status: '未做', source: '人工输入' },
      { id: 'b', content: '不改', date: '2026-11-17', status: '未做', source: '人工输入' },
    ],
  })

  const first = await postponeTodos(store, { ids: ['a'], toDate: '2026-11-18' })
  assert.equal(first.length, 1)
  assert.deepEqual(first[0].postponedFrom, ['2026-11-17'])

  const second = await postponeTodos(store, { ids: ['a'], toDate: '2026-11-19' })
  assert.deepEqual(second[0].postponedFrom, ['2026-11-17', '2026-11-18'])
  assert.equal(second[0].date, '2026-11-19')
  assert.equal(second[0].status, '顺延')

  const todos = await store.listTodoItems()
  assert.deepEqual(todos.find((item) => item.id === 'a').postponedFrom, ['2026-11-17', '2026-11-18'])
  assert.deepEqual(todos.find((item) => item.id === 'b').postponedFrom, undefined)
})

test('老数据没有 postponedFrom 字段也能顺延', async (t) => {
  const store = await tempStore(t)
  await store.writeJson('todos', {
    version: 1,
    items: [{ id: 'old', content: '老待办', date: '2026-11-01', status: '未做', postponedFrom: null }],
  })
  const moved = await postponeTodos(store, { ids: ['old'], toDate: '2026-11-02' })
  assert.deepEqual(moved[0].postponedFrom, ['2026-11-01'])
})
