/**
 * 知行 · 人生面隐私护栏
 *
 * 规则：
 * - 北极星正文、草稿、身份证据、偏航报告只在本机；
 * - 团队 / 上级 / 自定义读者的汇总永远不读人生面（没有开关）；
 * - 北极星只有用户打开 northStar.shareWithAI 后，才允许把「一句话愿景 + 规则」发给模型；
 *   反愿景与身份宣言永不发模型。
 */
export const PERSONAL_SOURCES = ['北极星/', '偏航/', '.internal/drift.json', '.internal/levers.json']

const AUDIENCE_BLOCKLIST = ['团队', '上级']

/** 某类内容是否可以发给模型；audience 只用于汇总读者。 */
export function canSendToModel(kind, { audience = '', settings = {} } = {}) {
  if (kind === 'northstar') {
    if (AUDIENCE_BLOCKLIST.some((word) => String(audience).includes(word))) return false
    if (audience && !String(audience).includes('自己')) return false
    return settings?.northStar?.shareWithAI === true
  }
  if (kind === 'summary') {
    if (AUDIENCE_BLOCKLIST.some((word) => String(audience).includes(word))) return false
    if (audience && !String(audience).includes('自己')) return false
    return true
  }
  return true
}

/** 测试 / 开发模式用：发现个人内容片段就抛错（生产环境调用方只记 log）。 */
export function assertNoPersonal(text, snippets = []) {
  const body = String(text ?? '')
  const hits = (snippets ?? []).map((snippet) => String(snippet ?? '').trim()).filter((snippet) => snippet && body.includes(snippet))
  if (hits.length) {
    const error = new Error('个人内容泄漏到模型输入')
    error.code = 'PERSONAL_LEAK'
    error.hits = hits.slice(0, 3)
    throw error
  }
  return true
}
