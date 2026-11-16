/**
 * 知行 · AI 调用
 *
 * 不自带 key、不写模型配置：每次调用都读 Harness 当前选择
 * （最近活跃 Agent 的 model.current()，否则 agentDefaultModel.currentSelection()），
 * 因此用户在 Harness 里换模型/思考强度后，下一次调用立即生效。
 * 每日上限与失败重试也在这里处理。
 */
import { dateKey } from './store.js'

export function selectionLabel(selection) {
  if (!selection?.provider) return '未知模型'
  const effort = selection.reasoningEffort ? ` / ${selection.reasoningEffort}` : ''
  return `${selection.provider}/${selection.model}${effort}`
}

function lastEventTime(ctx, agent) {
  try {
    const sessions = ctx.get('sessions')
    const session = sessions?.get?.(agent?.id) ?? agent?.session
    const events = session?.events
    if (Array.isArray(events) && events.length) return events[events.length - 1]?.time ?? 0
  } catch { /* 拿不到时间就按 0 处理 */ }
  return 0
}

function recentSessionId(ctx) {
  try {
    const sessions = ctx.get('sessions')?.list?.() ?? []
    const sorted = sessions
      .map((session) => ({ session, time: session?.events?.length ? session.events[session.events.length - 1]?.time ?? 0 : 0 }))
      .sort((a, b) => b.time - a.time)
    return sorted[0]?.session?.id
  } catch { return undefined }
}

/**
 * 当前模型：
 * 1. 插件设置里显式选的模型（右上角切换）
 * 2. 最近活跃 Agent 的选择（用户在 Harness 里换的模型）
 * 3. Harness 默认模型
 */
export function resolveSelection(ctx, override) {
  const sessionId = recentSessionId(ctx)
  if (override?.provider && override?.model) {
    return {
      provider: String(override.provider),
      model: String(override.model),
      ...(override.reasoningEffort ? { reasoningEffort: String(override.reasoningEffort) } : {}),
      source: '插件指定模型',
      sessionId,
    }
  }
  const candidates = []
  try {
    const agents = ctx.get('agents')
    for (const agent of agents?.list?.() ?? []) {
      const selection = agent?.model?.current?.()
      if (selection?.provider && selection?.model) {
        candidates.push({ selection, time: lastEventTime(ctx, agent), sessionId: agent.id })
      }
    }
  } catch { /* 忽略，继续用默认模型 */ }
  if (candidates.length) {
    candidates.sort((a, b) => b.time - a.time)
    return { ...candidates[0].selection, source: '会话当前模型', sessionId: candidates[0].sessionId }
  }
  try {
    const fallback = ctx.get('agentDefaultModel')?.currentSelection?.()
    if (fallback?.provider && fallback?.model) return { ...fallback, source: 'Harness 默认模型', sessionId }
  } catch { /* 无默认模型 */ }
  throw new Error('找不到当前模型：Harness 里还没有可用模型选择')
}

/** Harness 里已配置的模型清单（右上角下拉用）。 */
export async function listAvailableModels(ctx) {
  const llm = ctx.get('llm')
  if (!llm?.listProviders) return []
  const providers = []
  try {
    for (const provider of await llm.listProviders()) {
      const id = String(provider?.id ?? provider?.provider ?? '')
      if (id) providers.push({ id, name: String(provider?.name ?? id) })
    }
  } catch { /* 没有 provider 列表 */ }
  if (!providers.length) {
    try {
      for (const entry of (await llm.listConfigurableProviders?.()) ?? []) {
        const id = String(entry?.provider ?? entry?.id ?? entry?.namespace ?? '')
        if (id) providers.push({ id, name: String(entry?.name ?? id) })
      }
    } catch { /* 忽略 */ }
  }
  const seen = new Set()
  const models = []
  for (const provider of providers) {
    let list = []
    try { list = await llm.listModels(provider.id) } catch { list = [] }
    if (!Array.isArray(list) || !list.length) {
      try {
        const entries = (await llm.listConfigurableProviders?.()) ?? []
        for (const entry of entries) {
          if (String(entry?.provider ?? entry?.id ?? '') !== provider.id) continue
          for (const model of entry?.models ?? []) {
            const id = String(model?.id ?? model?.model ?? model?.name ?? '')
            if (id) list.push({ id, name: String(model?.name ?? id) })
          }
        }
      } catch { /* 忽略 */ }
    }
    for (const model of list) {
      const id = String(model?.id ?? '')
      if (!id) continue
      const key = `${provider.id}/${id}`
      if (seen.has(key)) continue
      seen.add(key)
      models.push({ provider: provider.id, providerName: provider.name, model: id, name: String(model?.name ?? id) })
    }
  }
  return models
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

export async function callModel(ctx, { system, user, maxTokens = 3000, sessionId, override, reasoningEffort, timeoutMs = 90_000 }) {
  const llm = ctx.get('llm')
  if (!llm?.stream) throw new Error('宿主没有提供 llm 服务，无法调用模型')
  const selection = resolveSelection(ctx, override)
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      let text = ''
      const stream = llm.stream({
        provider: selection.provider,
        model: selection.model,
        ...((reasoningEffort ?? selection.reasoningEffort) === undefined ? {} : { reasoningEffort: reasoningEffort ?? selection.reasoningEffort }),
        system,
        messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
        maxTokens,
        ...(sessionId || selection.sessionId ? { sessionId: sessionId || selection.sessionId } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      })
      for await (const chunk of stream) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      }
      if (!text.trim()) throw new Error('模型返回了空内容')
      return { text: text.trim(), selection, attempts: attempt }
    } catch (error) {
      lastError = error
      if (attempt < 3) await delay(attempt === 1 ? 800 : 1500)
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(`AI 调用失败（已重试 2 次）：${reason}`)
}

/** 记录当天 AI 调用次数（只统计，不设上限）。 */
export async function recordAiUsage(store) {
  const today = dateKey()
  let used = 0
  await store.update('state', { aiUsage: {} }, (current) => {
    current.aiUsage = current.aiUsage ?? {}
    current.aiUsage[today] = Number(current.aiUsage[today] ?? 0) + 1
    used = current.aiUsage[today]
    return current
  })
  return { used }
}

export const REPORT_SYSTEM_PROMPT = `你是「知行」的日报整理器。把当天收集到的材料整理成一份中文工作日报。
只输出 Markdown，不要代码围栏，不要额外解释。格式严格如下：

## 今天干了什么
- 一条事项写一行，写结果不写过程，每条结尾必须用（来源：X）标出来源

## 明天准备干什么
- 每条是一个可以直接执行的下一步任务，不带来源标记

## 问题与风险
- 只写真实存在的问题或风险；没有就整节省略

规则：
1. 「今天干了什么」里的每一条都必须能追溯到材料，不得编造。
2. 来源只能是：Harness 会话、人工输入、导入文件《文件名》。
3. 合并重复事项，按重要性排序，最多 12 条。
4. 「明天准备干什么」最多 8 条，动词开头，结果可验证。
5. 不要输出「今天完成了…」这类空话。`

export function buildReportPrompt({ date, digestBlock, manual = [], files = [], material = '' }) {
  const manualBlock = manual.length ? manual.map((item, i) => `${i + 1}. ${item}`).join('\n') : '（无）'
  const fileBlock = files.length
    ? files.map((file, i) => `${i + 1}. 文件：${file.name}（${file.via}）\n节选：\n${String(file.text ?? '').slice(0, 2500)}`).join('\n\n')
    : '（无）'
  if (material && material.trim()) {
    return `日期：${date}

【来源 A：采集草稿（用户在界面上编辑过，作为主要事实来源）】
${String(material).slice(0, 12_000)}

【来源 B：导入文件】
${fileBlock}

请按固定格式生成这一天的日报。每条都要能追溯到上面的材料，来源写「采集草稿」「人工输入」或「导入文件《文件名》」。`
  }
  return `日期：${date}

【来源 A：Harness 会话摘要】
${digestBlock}

【来源 B：人工输入】
${manualBlock}

【来源 C：导入文件】
${fileBlock}

请按固定格式生成这一天的日报。`
}
