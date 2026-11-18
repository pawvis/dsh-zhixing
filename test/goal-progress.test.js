import assert from 'node:assert/strict'
import test from 'node:test'
import { refineProgressSuggestions } from '../lib/goal-ai.js'

const leaves = [
  { id: 'g1', title: '目标一', cycle: '月', progress: 10 },
  { id: 'g2', title: '目标二', cycle: '月', progress: 90 },
]

test('进度建议：单次最多 +30，只前进，按 id 匹配', () => {
  const items = [
    { goalId: 'g1', progress: 50, reason: '完成一半' },
    { goalId: 'g2', progress: 100, reason: '接近完成' },
    { goalId: 'g1', progress: 5, reason: '想回退' },
    { goalId: 'g3', progress: 70, reason: '不存在的目标' },
    { goalId: 'g2', progress: 'abc' },
  ]
  const out = refineProgressSuggestions(leaves, items)
  assert.equal(out.length, 2)
  assert.deepEqual(out.map((item) => [item.id, item.from, item.to]), [['g1', 10, 40], ['g2', 90, 100]])
  assert.ok(out.every((item) => item.to <= item.from + 30))
  assert.equal(out[0].reason, '完成一半')
  assert.equal(out[0].cycle, '月')
})

test('进度建议：没有推进 / 空输入时返回空数组', () => {
  assert.deepEqual(refineProgressSuggestions(leaves, [{ goalId: 'g1', progress: 10 }]), [])
  assert.deepEqual(refineProgressSuggestions(leaves, []), [])
  assert.deepEqual(refineProgressSuggestions([], [{ goalId: 'g1', progress: 50 }]), [])
})
