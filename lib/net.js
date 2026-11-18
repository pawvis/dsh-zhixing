/**
 * 知行 · 外链抓取
 *
 * 只允许 http/https，并在每一跳（含重定向）校验目标地址：
 * 禁止 loopback、私网、链路本地、组播等地址；限制响应大小与超时。
 * 零第三方依赖，只用 node:http(s) 之上的全局 fetch。
 */
import dns from 'node:dns/promises'
import net from 'node:net'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

export const VERSION = String(pkg?.version ?? '1.1.1')

const MAX_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 5
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

function unsafe(message) {
  const error = new Error(message)
  error.code = 'UNSAFE_URL'
  return error
}

function badUrl(message) {
  const error = new Error(message)
  error.code = 'BAD_URL'
  return error
}

/** IPv4 是否属于本机 / 私网 / 链路本地 / 保留地址。 */
export function isBlockedIPv4(address) {
  const parts = String(address).split('.').map(Number)
  if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true
  const [a, b] = parts
  return a === 0 // 0.0.0.0/8
    || a === 10 // 10/8
    || a === 127 // loopback
    || (a === 100 && b >= 64 && b <= 127) // 100.64/10 运营商级 NAT
    || (a === 169 && b === 254) // 链路本地
    || (a === 172 && b >= 16 && b <= 31) // 172.16/12
    || (a === 192 && b === 168) // 192.168/16
    || (a === 198 && (b === 18 || b === 19)) // 基准测试网段
    || a >= 224 // 组播与保留
}

/** IPv6 是否属于本机 / 私网 / 链路本地，含 IPv4-mapped。 */
export function isBlockedIPv6(address) {
  const text = String(address).toLowerCase().split('%')[0]
  if (!text) return true
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(text)
  if (dotted) return isBlockedIPv4(dotted[1])
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(text)
  if (hex) {
    const hi = parseInt(hex[1], 16)
    const lo = parseInt(hex[2], 16)
    return isBlockedIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }
  if (text === '::1' || text === '::') return true
  if (/^f[cd]/.test(text)) return true // fc00::/7 唯一本地地址
  if (/^fe[89ab]/.test(text)) return true // fe80::/10 链路本地
  return false
}

/** 地址是否不允许抓取（无法识别的地址按不安全处理）。 */
export function isBlockedAddress(address) {
  const family = net.isIP(String(address).replace(/^\[|\]$/g, ''))
  if (family === 4) return isBlockedIPv4(address)
  if (family === 6) return isBlockedIPv6(address)
  return true
}

/** 只接受 http/https URL；返回 URL 对象。 */
export function assertHttpUrl(rawUrl) {
  let url = null
  try { url = new URL(String(rawUrl ?? '').trim()) } catch { throw badUrl('链接格式不对') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw badUrl('链接必须是 http/https')
  if (!url.hostname) throw badUrl('链接缺少域名')
  return url
}

/** 校验一个 URL 的目标地址：域名解析出的每个 IP 都必须可用。 */
export async function assertPublicUrl(rawUrl) {
  const url = rawUrl instanceof URL ? rawUrl : assertHttpUrl(rawUrl)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!host) throw badUrl('链接缺少域名')
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw unsafe(`链接指向内网或本机地址（${host}），已拒绝`)
    return url
  }
  let addresses = []
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true })
  } catch (error) {
    throw badUrl(`域名解析失败：${host}（${error instanceof Error ? error.message : String(error)}）`)
  }
  if (!addresses.length) throw badUrl(`域名解析失败：${host}`)
  for (const entry of addresses) {
    if (isBlockedAddress(entry.address)) throw unsafe(`链接指向内网或本机地址（${entry.address}），已拒绝`)
  }
  return url
}

/** 抓取一个 http/https 页面：逐跳校验、限制 2MB、10 秒超时。 */
export async function fetchTextSafe(rawUrl) {
  let url = assertHttpUrl(rawUrl)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(url)
    const response = await fetch(url, {
      redirect: 'manual',
      headers: {
        'user-agent': `dsh-zhixing/${VERSION}`,
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (REDIRECT_STATUS.has(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new Error(`重定向缺少 Location（HTTP ${response.status}）`)
      const next = new URL(location, url)
      if (next.protocol !== 'http:' && next.protocol !== 'https:') throw unsafe('重定向到了非 http/https 地址，已拒绝')
      url = next
      continue
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const chunks = []
    let size = 0
    let truncated = false
    if (response.body) {
      for await (const chunk of response.body) {
        const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        if (size + piece.length > MAX_BYTES) {
          chunks.push(piece.subarray(0, MAX_BYTES - size))
          size = MAX_BYTES
          truncated = true
          break
        }
        chunks.push(piece)
        size += piece.length
      }
    }
    return { text: Buffer.concat(chunks).toString('utf8'), url: url.toString(), truncated }
  }
  throw new Error('重定向次数过多，已停止抓取')
}
