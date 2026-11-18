/**
 * 知行 · 2.0 新路由
 *
 * routes.js 的 handle() 开头委托到这里；未命中的请求返回 false，继续走旧分支。
 * 这样新功能不再往 routes.js 里堆业务代码。
 */
import { assertDateKey, dateKey } from './store.js'
import { leversState, setLevers, skipLevers, suggestLevers } from './levers.js'

export function createV2Routes({ ctx, store, readBody, json, matchGoals }) {
  async function handle(req, res, suffix, url, method) {
    // ---------------- 今日杠杆 ----------------
    if (method === 'GET' && suffix === '/levers') {
      const date = assertDateKey(url.searchParams.get('date') || dateKey())
      json(res, 200, { ok: true, ...(await leversState(store, date)) })
      return true
    }

    if (method === 'POST' && suffix === '/levers/set') {
      const body = await readBody(req)
      const result = await setLevers(store, { date: body.date || dateKey(), items: body.items })
      await store.appendLog('设置今日杠杆', `${result.items?.length ?? 0} 个${result.hint === 'below_min' ? '（少于 2 个）' : ''}｜${result.date}`)
      json(res, 200, { ok: true, ...result })
      return true
    }

    if (method === 'POST' && suffix === '/levers/skip') {
      const body = await readBody(req)
      const result = await skipLevers(store, body.date || dateKey())
      await store.appendLog('今天不设杠杆', result.date)
      json(res, 200, { ok: true, ...result })
      return true
    }

    if (method === 'POST' && suffix === '/levers/suggest') {
      const body = await readBody(req)
      const date = assertDateKey(body.date || dateKey())
      const result = await suggestLevers(store, ctx, { date, matchGoals, force: body.force === true })
      if (result.skipped !== 'already-decided') {
        const label = result.by === 'ai' ? 'AI 推荐杠杆' : result.by === 'local' ? '本地推荐杠杆' : '推荐杠杆'
        await store.appendLog(label, `${result.candidates?.length ?? 0} 个候选｜${date}${result.model ? `（${result.model}）` : ''}`)
      }
      json(res, 200, { ok: true, ...result })
      return true
    }

    return false
  }

  return { handle }
}
