/**
 * 知行 · 2.0 新路由
 *
 * routes.js 的 handle() 开头委托到这里；未命中的请求返回 false，继续走旧分支。
 * 这样新功能不再往 routes.js 里堆业务代码。
 */
import { assertDateKey, dateKey } from './store.js'
import { leversState, setLevers, skipLevers, suggestLevers } from './levers.js'
import {
  appendIdentityEvidence,
  historyList,
  identityEvidence,
  readDraft,
  readHistory,
  readNorthStar,
  saveNorthStar,
  writeDraft,
} from './northstar.js'

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

    // ---------------- 北极星 ----------------
    if (method === 'GET' && suffix === '/northstar') {
      const [data, draft] = await Promise.all([readNorthStar(store), readDraft(store)])
      if (!data) {
        json(res, 200, { ok: true, exists: false, version: 0, updatedAt: '', identity: [], rules: [], draft })
        return true
      }
      const identity = await identityEvidence(store, data.identity)
      json(res, 200, {
        ok: true,
        exists: true,
        version: data.version,
        updatedAt: data.updatedAt,
        antiVision: data.antiVision,
        vision: data.vision,
        identity,
        rules: data.rules,
        raw: data.raw,
        draft,
      })
      return true
    }

    if (method === 'POST' && suffix === '/northstar/save') {
      const body = await readBody(req)
      const result = await saveNorthStar(store, { markdown: body.markdown, fields: body.fields, mode: body.mode === 'version' ? 'version' : 'minor' })
      await store.appendLog('保存北极星', `v${result.version}`)
      json(res, 200, { ok: true, ...result })
      return true
    }

    if (method === 'GET' && suffix === '/northstar/history') {
      json(res, 200, { ok: true, items: await historyList(store) })
      return true
    }

    if (method === 'GET' && suffix === '/northstar/history/read') {
      const history = await readHistory(store, url.searchParams.get('v'))
      if (!history) { json(res, 404, { ok: false, error: '历史版本不存在' }); return true }
      json(res, 200, { ok: true, ...history })
      return true
    }

    if (method === 'POST' && suffix === '/northstar/draft') {
      const body = await readBody(req)
      await writeDraft(store, body.text)
      json(res, 200, { ok: true, saved: true })
      return true
    }

    if (method === 'POST' && suffix === '/northstar/identity') {
      const body = await readBody(req)
      const result = await appendIdentityEvidence(store, body.picks)
      await store.appendLog('身份证据', `+${result.added} 条`)
      json(res, 200, { ok: true, ...result })
      return true
    }

    return false
  }

  return { handle }
}
