import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createGoal, updateGoal, validateGoal } from '../lib/goals.js'
import { Store } from '../lib/store.js'

test('validateGoal 保留详细说明并限制长度，老数据缺字段时为空串', () => {
  const fields = validateGoal({ title: '短标题', detail: ' 具体内容 ', cycle: '月', measure: '完成 1 件事' }, [])
  assert.equal(fields.detail, '具体内容')

  const capped = validateGoal({ title: '短标题', detail: 'a'.repeat(800), cycle: '月', measure: '完成 1 件事' }, [])
  assert.equal(capped.detail.length, 500)

  const legacy = validateGoal({ title: '旧目标', cycle: '月', measure: '完成 1 件事' }, [])
  assert.equal(legacy.detail, '')
})

test('新建 / 更新目标都会保留详细说明', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixing-goal-detail-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const store = new Store(dir)
  await store.init()

  const created = await createGoal(store, {
    title: '华东客户回访',
    detail: '覆盖华东区 20 家重点客户，输出改进报告',
    cycle: '月',
    measure: '回访 20 家',
  })
  assert.equal(created.detail, '覆盖华东区 20 家重点客户，输出改进报告')

  const updated = await updateGoal(store, created.id, { progress: 40, reason: '完成一半' })
  assert.equal(updated.detail, '覆盖华东区 20 家重点客户，输出改进报告')

  const [stored] = await store.listGoalItems()
  assert.equal(stored.detail, '覆盖华东区 20 家重点客户，输出改进报告')
})
