/**
 * 知行 · 文件导入解析
 *
 * 新版格式（.docx/.xlsx/.pptx）用内置 ZIP+XML 解析，零第三方依赖；
 * 旧版格式（.doc/.xls/.ppt）调用宿主 ctx.officeKit（随 Desktop 打包的 LibreOffice kit）
 * 先转成新版格式再解析；.doc 额外有 macOS textutil 兜底。
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readZip } from './zip.js'

const MAX_TEXT = 200_000
const LEGACY = new Set(['doc', 'xls', 'ppt'])
const KIND = { doc: 'docx', xls: 'xlsx', ppt: 'pptx' }

export function extOf(name) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(String(name ?? ''))
  return m ? m[1].toLowerCase() : ''
}

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function clip(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return normalized.length > MAX_TEXT ? `${normalized.slice(0, MAX_TEXT)}\n\n…（已截断，原文过长）` : normalized
}

export function docxText(buffer) {
  const zip = readZip(buffer)
  const xml = zip.read('word/document.xml').toString('utf8')
  const paragraphs = []
  for (const para of xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []) {
    const parts = []
    for (const token of para.match(/<w:t[^>]*>[\s\S]*?<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g) ?? []) {
      if (token.startsWith('<w:tab')) parts.push('\t')
      else if (token.startsWith('<w:br')) parts.push('\n')
      else parts.push(decodeEntities(token.replace(/^<w:t[^>]*>/, '').replace(/<\/w:t>$/, '')))
    }
    const line = parts.join('').trim()
    if (line) paragraphs.push(line)
  }
  return clip(paragraphs.join('\n'))
}

/** 一个 <si> / <is> 里的文字：富文本会有多个 <r><t>，按顺序拼接；跳过拼音注音 <rPh>。 */
function richTextOf(xml) {
  const withoutPhonetic = String(xml ?? '').replace(/<rPh[\s>][\s\S]*?<\/rPh>/g, '')
  return [...withoutPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1])).join('')
}

export function xlsxText(buffer) {
  const zip = readZip(buffer)
  const shared = []
  if (zip.has('xl/sharedStrings.xml')) {
    const xml = zip.read('xl/sharedStrings.xml').toString('utf8')
    for (const si of xml.match(/<si(?:\s[^>]*)?>[\s\S]*?<\/si>/g) ?? []) {
      shared.push(richTextOf(si))
    }
  }
  const sheets = zip.names
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]))
  const out = []
  for (const name of sheets) {
    const xml = zip.read(name).toString('utf8')
    out.push(`### ${name.replace('xl/worksheets/', '').replace('.xml', '')}`)
    for (const row of xml.match(/<row[\s>][\s\S]*?<\/row>/g) ?? []) {
      const cells = []
      for (const cell of row.match(/<c\b[^>]*>[\s\S]*?<\/c>|<c\b[^>]*\/>/g) ?? []) {
        const type = /\bt="([^"]+)"/.exec(cell)?.[1]
        let value = ''
        if (type === 's') {
          // 共享字符串：索引在 <v>0</v> 里，不能拿属性去匹配。
          const idx = /<v>\s*(\d+)\s*<\/v>/.exec(cell)?.[1]
          value = idx === undefined ? '' : shared[Number(idx)] ?? ''
        } else if (type === 'inlineStr') {
          value = richTextOf(/<is(?:\s[^>]*)?>[\s\S]*?<\/is>/.exec(cell)?.[0] ?? cell)
        } else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1]
          value = v === undefined ? '' : decodeEntities(v)
        }
        if (value !== '') cells.push(value)
      }
      if (cells.length) out.push(cells.join(' | '))
    }
    out.push('')
  }
  return clip(out.join('\n'))
}

export function pptxText(buffer) {
  const zip = readZip(buffer)
  const slides = zip.names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]))
  const out = []
  slides.forEach((name, index) => {
    const xml = zip.read(name).toString('utf8')
    const paragraphs = []
    for (const para of xml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? []) {
      const line = [...para.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => decodeEntities(m[1])).join('').trim()
      if (line) paragraphs.push(line)
    }
    out.push(`### 第 ${index + 1} 页`, ...paragraphs, '')
  })
  return clip(out.join('\n'))
}

function textutil(buffer, ext) {
  return new Promise((resolve, reject) => {
    const dir = path.join(os.tmpdir(), `zhixing-${process.pid}-${Date.now()}`)
    fs.mkdir(dir, { recursive: true })
      .then(() => fs.writeFile(path.join(dir, `input.${ext}`), buffer))
      .then(() => new Promise((res, rej) => {
        execFile('/usr/bin/textutil', ['-convert', 'txt', '-stdout', path.join(dir, `input.${ext}`)], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout) => {
          if (error) rej(error); else res(stdout)
        })
      }))
      .then((stdout) => resolve(clip(String(stdout))))
      .catch(reject)
      .finally(() => fs.rm(dir, { recursive: true, force: true }).catch(() => {}))
  })
}

/**
 * 用宿主 officeKit 把旧格式转成新格式，返回转换后的 Buffer。
 * 没有 officeKit（或 kit 缺失）时抛错，由调用方写明原因。
 */
async function convertLegacy(officeKit, name, buffer) {
  if (!officeKit?.convertTo) throw new Error('缺少 LibreOffice 转换器（officeKit 未挂载），无法解析旧版 Office 文件')
  const ext = extOf(name)
  const target = KIND[ext]
  const tempName = `zhixing.${target ?? 'docx'}`
  const version = `${buffer.length}-${Date.now()}`
  const result = await officeKit.convertTo({
    extension: ext,
    format: target,
    source: {
      key: `zhixing:${name}:${version}`,
      version,
      bytes: buffer.length,
      read: async () => ({ bytes: buffer, version }),
    },
    output: { owner: 'zhixing', name: tempName },
  })
  return fs.readFile(result.path)
}

/**
 * 解析一个导入文件。
 * @returns {{text: string, via: string}}
 */
export async function extractText({ name, buffer, officeKit, onProgress }) {
  const ext = extOf(name)
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  if (!buf.length) throw new Error('文件是空的')
  if (ext === 'md' || ext === 'txt' || ext === 'markdown' || ext === 'csv') {
    return { text: clip(buf.toString('utf8').replace(/^\uFEFF/, '')), via: '直接读取' }
  }
  if (ext === 'docx') return { text: docxText(buf), via: '内置 OOXML 解析' }
  if (ext === 'xlsx') return { text: xlsxText(buf), via: '内置 OOXML 解析' }
  if (ext === 'pptx') return { text: pptxText(buf), via: '内置 OOXML 解析' }
  if (LEGACY.has(ext)) {
    onProgress?.(`正在用 LibreOffice 转换 .${ext} …`)
    try {
      const converted = await convertLegacy(officeKit, name, buf)
      const text = ext === 'doc' ? docxText(converted) : ext === 'xls' ? xlsxText(converted) : pptxText(converted)
      return { text, via: `LibreOffice 转换为 .${KIND[ext]} 后解析` }
    } catch (error) {
      if (ext === 'doc' && process.platform === 'darwin') {
        onProgress?.('LibreOffice 不可用，改用 textutil …')
        return { text: await textutil(buf, ext), via: 'macOS textutil' }
      }
      throw new Error(`.${ext} 解析失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`不支持的文件类型 .${ext || '(无扩展名)'}；支持 md / txt / docx / doc / xlsx / xls / pptx / ppt`)
}
