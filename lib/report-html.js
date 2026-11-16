/** 知行 · 日报 HTML 渲染与模板 */
import { nowStampInZone } from './clock.js'

export const TEMPLATE_PLACEHOLDER = '{{content}}'

export const DEFAULT_TEMPLATE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>{{title}}</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{margin:0;padding:40px 20px;background:#F7F7F5;color:#1F1F1F;font:14px/1.75 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:760px;margin:0 auto;background:#fff;border-radius:16px;padding:36px 40px;border:1px solid rgba(15,23,42,.08);box-shadow:0 1px 2px rgba(15,23,42,.06),0 12px 32px rgba(15,23,42,.08)}
  header{border-bottom:1px solid rgba(15,23,42,.08);padding-bottom:16px;margin-bottom:20px}
  h1{font-size:22px;margin:0 0 6px;letter-spacing:.01em}
  .meta{font-size:12px;color:#6B7280}
  .content h2{font-size:16px;margin:24px 0 10px;padding-bottom:6px;border-bottom:1px solid rgba(15,23,42,.08);color:#111827}
  .content h2:first-child{margin-top:0}
  .content ul{margin:0;padding-left:22px}
  .content li{margin:6px 0}
  .content p{margin:8px 0}
  .wb-tags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
  .wb-tags span{font-size:11px;line-height:1.6;padding:2px 9px;border-radius:999px;background:rgba(59,130,246,.10);color:#2563EB;border:1px solid rgba(59,130,246,.25)}
  footer{margin-top:28px;padding-top:12px;border-top:1px solid rgba(15,23,42,.06);font-size:11px;color:#9CA3AF}
  @media print{body{background:#fff;padding:0}.wrap{border:0;box-shadow:none;border-radius:0;padding:0 8px}}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>{{title}}</h1>
    <div class="meta">{{date}} · 由「知行」生成</div>
  </header>
  <main class="content">
{{tags}}
{{content}}
  </main>
  <footer>生成于 {{generatedAt}}</footer>
</div>
</body>
</html>`

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

/** 轻量 Markdown → HTML：标题、列表、段落、粗体、行内代码。 */
export function markdownToHtml(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/)
  const out = []
  let list = null
  const flush = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null } }
  for (const line of lines) {
    const heading = /^(#{1,4})\s+(.+?)\s*$/.exec(line)
    if (heading) { flush(); const level = Math.min(4, heading[1].length); out.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue }
    const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line)
    if (bullet) { list = list ?? []; list.push(`<li>${inline(bullet[1])}</li>`); continue }
    flush()
    if (line.trim()) out.push(`<p>${inline(line)}</p>`)
  }
  flush()
  return out.join('\n')
}

export function fillTemplate(template, { markdown, date, title = '工作日报', generatedAt = '', tags = [] }) {
  const safeTemplate = typeof template === 'string' && template.includes(TEMPLATE_PLACEHOLDER) ? template : DEFAULT_TEMPLATE
  const tagsHtml = Array.isArray(tags) && tags.length
    ? `<div class="wb-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>`
    : ''
  const rawContent = markdownToHtml(markdown)
  const content = safeTemplate.includes('{{tags}}') ? rawContent : `${tagsHtml}${rawContent}`
  return safeTemplate
    .split(TEMPLATE_PLACEHOLDER).join(content)
    .split('{{tags}}').join(tagsHtml)
    .split('{{title}}').join(escapeHtml(title))
    .split('{{date}}').join(escapeHtml(date))
    .split('{{generatedAt}}').join(escapeHtml(generatedAt || nowStampInZone()))
}

export function validateTemplate(template) {
  const text = String(template ?? '')
  if (!text.trim()) throw new Error('模板不能为空')
  if (!text.includes(TEMPLATE_PLACEHOLDER)) throw new Error(`模板缺少占位符 ${TEMPLATE_PLACEHOLDER}，${TEMPLATE_PLACEHOLDER} 必填（日报正文会填入此处）`)
  if (text.length > 200_000) throw new Error('模板太大（上限 200KB）')
  return text
}
