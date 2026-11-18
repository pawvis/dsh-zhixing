import assert from 'node:assert/strict'
import test from 'node:test'
import { assertDateKey, ValidationError } from '../lib/store.js'

test('assertDateKey 接受合法日期并原样返回', () => {
  assert.equal(assertDateKey('2026-11-17'), '2026-11-17')
  assert.equal(assertDateKey('2024-02-29'), '2024-02-29')
})

test('assertDateKey 拒绝路径穿越与非法日期', () => {
  for (const bad of ['../../x', '../2026-11-17', '2026-13-01', '2026-02-30', '', null, undefined, '2026-1-1', '2026-11-17/../../x', 'abc']) {
    assert.throws(() => assertDateKey(bad), (error) => error instanceof ValidationError && error.status === 400, String(bad))
  }
})
