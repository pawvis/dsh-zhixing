/**
 * 知行 · 2.0 新路由
 *
 * routes.js 的 handle() 开头委托到这里；未命中的请求返回 false，继续走旧分支。
 * 这样新功能不再往 routes.js 里堆业务代码。
 */
import { assertDateKey, dateKey } from './store.js'
import { metricsSummary, track } from './metrics.js'
import { holidayStatus, refreshHolidays } from './holidays.js'
import { leversState, setLevers, setTop, skipLevers, suggestLevers } from './levers.js'
import {
  assertWeekKey,
  buildDrift,
  currentWeekKey,
  decideDriftAdvice,
  draftDriftAdvice,
  getDrift,
  listDriftReports,
  pickBoss,
  saveDriftIdentity,
  saveDriftReport,
} from './drift.js'
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
    // ---------------- 今日重点 ----------------
    if (method === 'GET' && suffix === '/levers') {
      const date = assertDateKey(url.searchParams.get('date') || dateKey())
      json(res, 200, { ok: true, ...(await leversState(store, date)) })
      return true
    }

    if (method === 'POST' && suffix === '/levers/set') {
      const body = await readBody(req)
      const result = await setLevers(store, { date: body.date || dateKey(), items: body.items })
      await store.appendLog('设置今日重点', `${result.items?.length ?? 0} 个${result.hint === 'below_min' ? '（少于 2 个）' : ''}｜${result.date}`)
      await track(store, 'leverSet').catch(() => {})
      await track(store, 'leverItems', result.items?.length ?? 0).catch(() => {})
      json(res, 200, { ok: true, ...result })
      return true
    }

    if (method === 'POST' && suffix === '/levers/skip') {
      const body = await readBody(req)
      const result = await skipLevers(store, body.date || dateKey())
      await store.appendLog('今天不设重点', result.date)
      json(res, 200, { ok: true, ...result })
      return true
    }

    // 2.2 第一重点：精确匹配 /levers/top，不影响旧的 POST /focus。
    if (method === 'POST' && suffix === '/levers/top') {
      const body = await readBody(req)
      const result = await setTop(store, body.date || dateKey(), body.todoId)
      await store.appendLog('第一重点', result.topTodoId ? `★ ${result.topTodoId}｜${result.date}` : `取消｜${result.date}`)
      json(res, 200, { ok: true, ...result })
      return true
    }

    if (method === 'POST' && suffix === '/levers/suggest') {
      const body = await readBody(req)
      const date = assertDateKey(body.date || dateKey())
      const result = await suggestLevers(store, ctx, { date, matchGoals, force: body.force === true })
      if (result.skipped !== 'already-decided') {
        const label = result.by === 'ai' ? 'AI 推荐重点' : result.by === 'local' ? '本地推荐重点' : '推荐重点'
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
      await track(store, 'northstarSave').catch(() => {})
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

    // ---------------- 偏航报告 ----------------
    if (method === 'GET' && suffix === '/drift') {
      const week = url.searchParams.get('week') ? assertWeekKey(url.searchParams.get('week')) : currentWeekKey()
      const result = await getDrift(store, week)
      await track(store, 'driftOpen').catch(() => {})
      json(res, 200, { ok: true, ...result.snapshot, built: result.built })
      return true
    }

    if (method === 'POST' && suffix === '/drift/build') {
      const body = await readBody(req)
      const week = assertWeekKey(body.week || currentWeekKey())
      const result = await buildDrift(store, ctx, week, { autoAdvice: body.advice !== false })
      await store.appendLog('偏航报告', `${week} 统计完成`)
      await track(store, 'driftBuild').catch(() => {})
      json(res, 200, { ok: true, ...result.snapshot, advice: result.advice ?? [], built: true })
      return true
    }

    if (method === 'POST' && suffix === '/drift/advice') {
      const body = await readBody(req)
      const week = assertWeekKey(body.week || currentWeekKey())
      const result = await draftDriftAdvice(store, ctx, week)
      await store.appendLog('偏航建议', `${week} 生成 ${result.advice?.length ?? 0} 条`)
      json(res, 200, { ok: true, week, ...result })
      return true
    }

    if (method === 'POST' && suffix === '/drift/decide') {
      const body = await readBody(req)
      const week = assertWeekKey(body.week || currentWeekKey())
      const result = await decideDriftAdvice(store, week, String(body.id ?? ''), String(body.action ?? ''), body.payload ?? {})
      await store.appendLog('偏航建议', result.decided)
      await track(store, result.decided === 'accepted' ? 'adviceAccept' : 'adviceDismiss').catch(() => {})
      json(res, 200, { ok: true, week, ...result })
      return true
    }

    if (method === 'POST' && suffix === '/drift/identity') {
      const body = await readBody(req)
      const week = assertWeekKey(body.week || currentWeekKey())
      const result = await saveDriftIdentity(store, week, body.picks)
      await store.appendLog('身份证据', `${week} +${result.appended ?? 0} 条`)
      json(res, 200, { ok: true, week, ...result })
      return true
    }

    if (method === 'POST' && suffix === '/drift/save') {
      const body = await readBody(req)
      const week = assertWeekKey(body.week || currentWeekKey())
      const result = await saveDriftReport(store, week, body.note)
      await store.appendLog('保存偏航报告', week)
      json(res, 200, { ok: true, week, ...result })
      return true
    }

    if (method === 'GET' && suffix === '/drift/list') {
      json(res, 200, { ok: true, items: await listDriftReports(store) })
      return true
    }

    // ---------------- 中国法定节假日 ----------------
    if (method === 'GET' && suffix === '/holidays') {
      const rawYear = url.searchParams.get('year')
      const years = rawYear ? [Number(rawYear)] : undefined
      if (rawYear && (!Number.isInteger(years[0]) || years[0] < 2000 || years[0] > 2100)) {
        json(res, 400, { ok: false, error: '年份不对' })
        return true
      }
      json(res, 200, { ok: true, ...(await holidayStatus(store, { years })) })
      return true
    }

    if (method === 'POST' && suffix === '/holidays/refresh') {
      const body = await readBody(req)
      const year = body.year === undefined ? undefined : Number(body.year)
      if (year !== undefined && (!Number.isInteger(year) || year < 2000 || year > 2100)) {
        json(res, 400, { ok: false, error: '年份不对' })
        return true
      }
      const result = await refreshHolidays(store, { years: year ? [year] : undefined })
      await store.appendLog('节假日', `手动刷新 ${result.years.map((item) => item.year).join('、')}`)
      json(res, 200, { ok: true, ...result })
      return true
    }

    // ---------------- 本地统计 ----------------
    if (method === 'GET' && suffix === '/metrics') {
      const weeks = Math.max(1, Math.min(12, Number(url.searchParams.get('weeks')) || 4))
      json(res, 200, { ok: true, ...(await metricsSummary(store, { weeks })) })
      return true
    }

    // ---------------- 今日 Boss ----------------
    if (method === 'GET' && suffix === '/boss/today') {
      json(res, 200, { ok: true, ...(await pickBoss(store)) })
      return true
    }

    return false
  }

  return { handle }
}
