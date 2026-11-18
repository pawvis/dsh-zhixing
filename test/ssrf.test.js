import assert from 'node:assert/strict'
import test from 'node:test'
import { assertHttpUrl, assertPublicUrl, isBlockedAddress, isBlockedIPv4, isBlockedIPv6 } from '../lib/net.js'

test('只允许 http/https', () => {
  assert.equal(assertHttpUrl('http://example.com/a').protocol, 'http:')
  assert.equal(assertHttpUrl('https://example.com/a').protocol, 'https:')
  assert.throws(() => assertHttpUrl('ftp://example.com/'), (error) => error.code === 'BAD_URL')
  assert.throws(() => assertHttpUrl('file:///etc/passwd'), (error) => error.code === 'BAD_URL')
  assert.throws(() => assertHttpUrl('not a url'), (error) => error.code === 'BAD_URL')
})

test('本机与内网地址被拒绝', async () => {
  for (const url of ['http://127.0.0.1/', 'http://192.168.1.1/', 'http://[::1]/', 'http://10.0.0.1/', 'http://172.16.0.1/', 'http://169.254.169.254/']) {
    await assert.rejects(assertPublicUrl(url), (error) => error.code === 'UNSAFE_URL', url)
  }
})

test('localhost 解析到本机也会被拒绝', async () => {
  await assert.rejects(assertPublicUrl('http://localhost/'), (error) => error.code === 'UNSAFE_URL')
})

test('公网地址可以通过校验', async () => {
  await assert.doesNotReject(assertPublicUrl('http://1.1.1.1/'))
})

test('地址分类函数覆盖私网 / 链路本地 / IPv4-mapped', () => {
  assert.equal(isBlockedIPv4('10.1.2.3'), true)
  assert.equal(isBlockedIPv4('172.31.0.1'), true)
  assert.equal(isBlockedIPv4('192.168.0.1'), true)
  assert.equal(isBlockedIPv4('169.254.1.1'), true)
  assert.equal(isBlockedIPv4('127.0.0.1'), true)
  assert.equal(isBlockedIPv4('1.1.1.1'), false)
  assert.equal(isBlockedIPv6('::1'), true)
  assert.equal(isBlockedIPv6('fc00::1'), true)
  assert.equal(isBlockedIPv6('fd12:3456::1'), true)
  assert.equal(isBlockedIPv6('fe80::1'), true)
  assert.equal(isBlockedIPv6('::ffff:127.0.0.1'), true)
  assert.equal(isBlockedIPv6('::ffff:1.1.1.1'), false)
  assert.equal(isBlockedIPv6('2606:4700:4700::1111'), false)
  assert.equal(isBlockedAddress('1.1.1.1'), false)
  assert.equal(isBlockedAddress('127.0.0.1'), true)
})
