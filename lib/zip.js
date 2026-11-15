/** 极小 ZIP 读取器：只依赖 node:zlib，用于 OOXML（docx/xlsx/pptx）。 */
import zlib from 'node:zlib'

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50

export function readZip(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)
  let eocd = -1
  const floor = Math.max(0, buf.length - 65557)
  for (let i = buf.length - 22; i >= floor; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP/OOXML 文件（找不到目录尾）')
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let i = 0; i < count; i += 1) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CENTRAL) throw new Error('ZIP 中央目录损坏')
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    entries.set(name.replace(/\\/g, '/'), { method, compSize, localOff })
    off += 46 + nameLen + extraLen + commentLen
  }
  return {
    names: [...entries.keys()],
    has: (name) => entries.has(name),
    read(name) {
      const entry = entries.get(name)
      if (!entry) throw new Error(`压缩包内缺少 ${name}`)
      if (entry.localOff + 30 > buf.length || buf.readUInt32LE(entry.localOff) !== LOCAL) throw new Error(`条目头损坏：${name}`)
      const nameLen = buf.readUInt16LE(entry.localOff + 26)
      const extraLen = buf.readUInt16LE(entry.localOff + 28)
      const start = entry.localOff + 30 + nameLen + extraLen
      const data = buf.subarray(start, start + entry.compSize)
      if (entry.method === 0) return data
      if (entry.method === 8) {
        try { return zlib.inflateRawSync(data) } catch (error) { throw new Error(`解压失败：${name}（${error.message}）`) }
      }
      throw new Error(`不支持的压缩方式 ${entry.method}：${name}`)
    },
  }
}
