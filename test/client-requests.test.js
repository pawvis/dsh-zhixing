/**
 * client.js 的 request(path) 不传第二个参数时按 GET 发；不传 payload 调 POST 专用接口会得到
 * 「未知接口：GET /xxx」。这里用静态检查把这类回退挡在提交前（BUG-1：专注结束发成了 GET）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

const CLIENT = new URL('../client.js', import.meta.url)

// routes-v2.js 里只注册了 POST /focus/start、POST /focus/stop、POST /levers/top、
// POST /levers/set、POST /levers/skip、POST /levers/suggest；没有对应的 GET。
const POST_ONLY = ['/focus/start', '/focus/stop', '/levers/top', '/levers/set', '/levers/skip', '/levers/suggest']

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 找出所有 request('endpoint' …) 调用，记录引号后紧跟的是 `)`（没 payload）还是 `,`（有 payload）。 */
function callSites(source, endpoint) {
  const pattern = new RegExp(`\\brequest\\(\\s*(['"])${escapeRegExp(endpoint)}\\1\\s*([,)])`, 'g')
  const sites = []
  let match
  while ((match = pattern.exec(source)) !== null) sites.push({ index: match.index, next: match[2] })
  return sites
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

test('client.js 调 POST 专用接口必须带 payload，不能退化成 GET（BUG-1 回归）', async () => {
  const source = await fs.readFile(CLIENT, 'utf8')
  const problems = []
  for (const endpoint of POST_ONLY) {
    const sites = callSites(source, endpoint)
    if (!sites.length) {
      problems.push(`${endpoint}：没找到调用（接口名可能改了，要同步检查 client.js）`)
      continue
    }
    for (const site of sites) {
      if (site.next === ')') problems.push(`${endpoint}：client.js 第 ${lineOf(source, site.index)} 行没传 payload，会被发成 GET`)
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'))
})

test('client.js 的 /focus 仍区分 GET 读状态与 POST 聚焦窗口（别把两者混用）', async () => {
  const source = await fs.readFile(CLIENT, 'utf8')
  const sites = callSites(source, '/focus')
  assert.ok(sites.some((site) => site.next === ')'), '应保留 request(\'/focus\') 作为 GET 读取专注状态')
  assert.ok(sites.some((site) => site.next === ','), '应保留 request(\'/focus\', {}) 作为旧 POST 聚焦 DSH 窗口')
})
