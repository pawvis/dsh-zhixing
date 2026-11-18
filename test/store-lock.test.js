import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Store } from '../lib/store.js'

async function tempStore(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-test-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()
  return store
}

test('mtime 超过 30 秒的残留锁会被清理，写入能成功', async (t) => {
  const store = await tempStore(t)
  const lockFile = store.p('待办.json.lock')
  await fs.writeFile(lockFile, '{"pid":123,"note":"crash"}\n', 'utf8')
  const old = new Date(Date.now() - 31_000)
  await fs.utimes(lockFile, old, old)

  const result = await store.update('todos', { version: 1, items: [] }, (todos) => {
    todos.items.push({ id: 't1', content: '过期锁之后的写入' })
    return todos
  })
  assert.equal(result.items.length, 1)
  await assert.rejects(fs.access(lockFile), /ENOENT/)
})

test('锁文件写入 pid 与时间戳，释放后删除', async (t) => {
  const store = await tempStore(t)
  const lockFile = store.p('待办.json.lock')
  let content = ''
  await store.update('todos', { version: 1, items: [] }, async (todos) => {
    content = await fs.readFile(lockFile, 'utf8')
    return todos
  })
  const meta = JSON.parse(content)
  assert.equal(meta.pid, process.pid)
  assert.ok(meta.at && !Number.isNaN(Date.parse(meta.at)))
  await assert.rejects(fs.access(lockFile), /ENOENT/)
})
