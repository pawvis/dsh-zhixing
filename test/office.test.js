import assert from 'node:assert/strict'
import test from 'node:test'
import { xlsxText } from '../lib/office.js'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
    table[i] = value >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xFFFFFFFF
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/**
 * @param {{name: string, data: string|Buffer}[]} files
 * @returns {Buffer}
 */
export function buildZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(String(file.name), 'utf8')
    const body = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8')
    const crc = crc32(body)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 文件名
    local.writeUInt16LE(0, 8) // 存储，不压缩
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12) // 任意合法 DOS 日期
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(body.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + body.length
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, ...centrals, eocd])
}


function xlsxFixture() {
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>行内字符串</t></is></c>
      <c r="B2"><v>42</v></c>
    </row>
  </sheetData>
</worksheet>`
  const shared = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
  <si><t>共享字符串</t></si>
  <si><r><t>富</t></r><r><t>文本</t></r></si>
</sst>`
  return buildZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: 'xl/sharedStrings.xml', data: shared },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ])
}

test('xlsx 共享字符串（含富文本）与 inlineStr 都能读出文字', () => {
  const text = xlsxText(xlsxFixture())
  assert.match(text, /共享字符串/)
  assert.match(text, /富文本/)
  assert.match(text, /行内字符串/)
  assert.match(text, /42/)
})

test('xlsx 富文本共享字符串不会被拆开或丢失', () => {
  const text = xlsxText(xlsxFixture())
  const line = text.split('\n').find((item) => item.includes('共享字符串'))
  assert.ok(line, '应能定位到第一行')
  assert.match(line, /^共享字符串 \| 富文本$/)
})
