/** 预检：client.js 里被 h(...) 引用的组件是否都有定义。 */
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const defined = new Set([
  ...[...source.matchAll(/function\s+([A-Z]\w*)\s*\(/g)].map((match) => match[1]),
  ...[...source.matchAll(/const\s+([A-Z]\w*)\s*=/g)].map((match) => match[1]),
  ...[...source.matchAll(/class\s+([A-Z]\w*)\s+extends/g)].map((match) => match[1]),
])
const globals = new Set(['React', 'Math', 'Date', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Set', 'Map', 'JSON', 'URL', 'AbortSignal', 'ClipboardItem', 'Notification', 'Image', 'XMLSerializer', 'Intl', 'Promise', 'Error'])
const used = new Set([...source.matchAll(/h\(([A-Z]\w*)/g)].map((match) => match[1]))
const missing = [...used].filter((name) => !defined.has(name) && !globals.has(name))
if (missing.length) {
  console.error('缺少组件定义:', missing.join(', '))
  process.exit(1)
}
console.log(`组件引用完整（${used.size} 个引用，${defined.size} 个定义）`)
