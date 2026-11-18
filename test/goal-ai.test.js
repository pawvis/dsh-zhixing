import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeReportForGoals, decomposeGoals } from '../lib/goal-ai.js'

/**
 * 假的 ctx：llm.stream 按 replies 顺序返回文本，同时记录每次请求的 prompt。
 * resolveSelection 会读 agents / sessions / agentDefaultModel，这里都给最小实现。
 */
function fakeCtx(replies) {
  const calls = []
  let index = 0
  return {
    calls,
    get(name) {
      if (name === 'llm') {
        return {
          stream(payload) {
            calls.push({ system: payload.system, user: payload.messages?.[0]?.content?.[0]?.text ?? '' })
            const text = typeof replies === 'function' ? replies(calls.length, payload) : replies[index++ % replies.length]
            return (async function* () {
              yield { type: 'text-delta', text }
            })()
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

test('进度建议：+50 截到 +30，伪造 quote 丢弃，已完成 / 过期目标不进 prompt', async () => {
  const markdown = `## 今天干了什么
- 完成了数据库迁移的灰度方案（来源：人工输入）
- 打通了登录链路（来源：Harness 会话）

## 明天准备干什么
- 继续压测`
  const goals = [
    { id: 'g1', title: '进行中的目标', cycle: '月', measure: '完成迁移', progress: 10, endDate: '2099-12-31' },
    { id: 'g2', title: '已完成目标', cycle: '月', measure: '完成登录', progress: 100, endDate: '2099-12-31' },
    { id: 'g3', title: '过期目标', cycle: '周', measure: '完成压测', progress: 10, endDate: '2020-01-01' },
    { id: 'g4', title: '另一个目标', cycle: '月', measure: '完成灰度', progress: 40, endDate: '2099-12-31' },
  ]
  const reply = JSON.stringify({
    suggestions: [
      { goalId: 'g1', suggestedProgress: 60, reason: '完成迁移', quote: '完成了数据库迁移的灰度方案' },
      { goalId: 'g4', suggestedProgress: 90, reason: '推进', quote: '打通了登录链路' },
      { goalId: 'g2', suggestedProgress: 100, reason: '已完成', quote: '完成了数据库迁移的灰度方案' },
      { goalId: 'g4', suggestedProgress: 80, reason: '编造', quote: '日报里根本没有这句话' },
    ],
  })
  const ctx = fakeCtx([reply])
  const result = await analyzeReportForGoals(ctx, { markdown, goals })

  const prompt = ctx.calls[0].user
  assert.match(prompt, /进行中的目标/)
  assert.match(prompt, /另一个目标/)
  assert.doesNotMatch(prompt, /已完成目标/)
  assert.doesNotMatch(prompt, /过期目标/)

  assert.equal(result.suggestions.length, 2)
  const g1 = result.suggestions.find((item) => item.goalId === 'g1')
  assert.deepEqual({ from: g1.from, to: g1.to }, { from: 10, to: 40 })
  const g4 = result.suggestions.find((item) => item.goalId === 'g4')
  assert.deepEqual({ from: g4.from, to: g4.to }, { from: 40, to: 70 })
  assert.ok(result.suggestions.every((item) => item.quote && markdown.includes(item.quote)))
  assert.ok(result.suggestions.every((item) => item.to - item.from <= 30))
})

test('进度建议：没有 quote 或 quote 不在日报里的建议全部丢弃', async () => {
  const markdown = '## 今天干了什么\n- 完成了数据库迁移'
  const goals = [{ id: 'g1', title: '迁移', cycle: '月', measure: '完成迁移', progress: 0, endDate: '2099-12-31' }]
  const reply = JSON.stringify({
    suggestions: [
      { goalId: 'g1', suggestedProgress: 50, quote: '' },
      { goalId: 'g1', suggestedProgress: 50, quote: '这句话是编的' },
    ],
  })
  const result = await analyzeReportForGoals(fakeCtx([reply]), { markdown, goals })
  assert.deepEqual(result.suggestions, [])
})

test('长文档拆目标：后一段可以用全局序号挂到前一段的目标下面', async () => {
  const text = `${'甲'.repeat(3500)}\n\n${'乙'.repeat(3500)}`
  const reply = (call) => (call === 1
    ? JSON.stringify({ goals: [{ title: '年度增长', cycle: '年', startDate: '2026-01-01', endDate: '2026-12-31', measure: '营收增长 20%', parentIndex: null }] })
    : JSON.stringify({ goals: [{ title: 'Q1 增长', cycle: '季度', startDate: '2026-01-01', endDate: '2026-03-31', measure: '完成 3 个活动', parentIndex: 0 }] }))
  const ctx = fakeCtx(reply)
  const result = await decomposeGoals(ctx, text, { date: '2026-01-15' })

  assert.equal(result.goals.length, 2)
  const year = result.goals.find((goal) => goal.title === '年度增长')
  const quarter = result.goals.find((goal) => goal.title === 'Q1 增长')
  assert.ok(year && quarter, '两条目标都要保留')
  assert.equal(quarter.parentIndex, result.goals.indexOf(year))
  assert.equal(ctx.calls.length, 2, '两段各调用一次模型')

  const secondPrompt = ctx.calls[1].user
  assert.match(secondPrompt, /本段第一条目标的全局序号是 1/)
  assert.match(secondPrompt, /年度增长/)
})

test('长文档拆目标：引用不存在的全局序号时保持顶层，目标不丢', async () => {
  const text = `${'甲'.repeat(3500)}\n\n${'乙'.repeat(3500)}`
  const reply = (call) => (call === 1
    ? JSON.stringify({ goals: [{ title: '年度增长', cycle: '年', startDate: '2026-01-01', endDate: '2026-12-31', measure: '营收增长 20%', parentIndex: null }] })
    : JSON.stringify({ goals: [{ title: 'Q1 增长', cycle: '季度', startDate: '2026-01-01', endDate: '2026-03-31', measure: '完成 3 个活动', parentIndex: 99 }] }))
  const result = await decomposeGoals(fakeCtx(reply), text, { date: '2026-01-15' })
  assert.equal(result.goals.length, 2)
  const quarter = result.goals.find((goal) => goal.title === 'Q1 增长')
  assert.equal(quarter.parentIndex, null)
})

test('AI 拆解：短标题 + 详细说明原样进结果，不额外调用缩写', async () => {
  const reply = JSON.stringify({
    goals: [{ title: '华东客户回访', detail: '覆盖华东区 20 家重点客户，输出改进报告', cycle: '月', startDate: '2026-11-01', endDate: '2026-11-30', measure: '回访 20 家', parentIndex: null }],
  })
  const ctx = fakeCtx([reply])
  const result = await decomposeGoals(ctx, '访问华东客户', { date: '2026-11-17' })
  assert.equal(ctx.calls.length, 1)
  assert.equal(result.goals[0].title, '华东客户回访')
  assert.equal(result.goals[0].detail, '覆盖华东区 20 家重点客户，输出改进报告')
})

test('AI 自动缩写过长标题，把细节转进详细说明', async () => {
  const longTitle = '完成2026年第一季度华东区重点客户回访并输出改进报告'
  const reply = (call) => (call === 1
    ? JSON.stringify({ goals: [{ title: longTitle, detail: '', cycle: '季度', startDate: '2026-01-01', endDate: '2026-03-31', measure: '回访 20 家', parentIndex: null }] })
    : JSON.stringify({ items: [{ index: 0, title: '华东客户回访', detail: '2026 年 Q1 覆盖华东区重点客户 20 家，输出改进报告' }] }))
  const ctx = fakeCtx(reply)
  const result = await decomposeGoals(ctx, '第一季度回访华东客户', { date: '2026-01-02' })
  assert.equal(ctx.calls.length, 2, '长标题应该触发一次缩写调用')
  assert.match(ctx.calls[1].user, /华东客户回访|完成2026年/)
  assert.equal(result.goals[0].title, '华东客户回访')
  assert.match(result.goals[0].detail, /华东区重点客户/)
  assert.ok(Array.from(result.goals[0].title).length <= 20)
})

test('AI 缩写失败或返回更长标题时保持原标题，目标不丢', async () => {
  const longTitle = '把公司所有产品的线上事故数量在明年下降一半并建立监控告警体系'
  const reply = (call) => (call === 1
    ? JSON.stringify({ goals: [{ title: longTitle, detail: '', cycle: '年', startDate: '2026-01-01', endDate: '2026-12-31', measure: '事故下降 50%', parentIndex: null }] })
    : JSON.stringify({ items: [{ index: 0, title: longTitle, detail: '' }] }))
  const result = await decomposeGoals(fakeCtx(reply), '明年事故减半', { date: '2026-01-02' })
  assert.equal(result.goals.length, 1)
  assert.equal(result.goals[0].title, longTitle)
})
