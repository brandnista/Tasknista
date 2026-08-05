import { unzipSync } from 'fflate'
import { buildHeadingStyleMap } from './docx-parse'

/**
 * Pronista §Document Management MVP — แปลง .docx เป็น HTML (อ่านอย่างเดียว) หรือ Markdown (นำไปแก้ไขต่อใน DocEditor/TipTap ได้)
 * เบราว์เซอร์ไม่มีตัวแสดงผล .docx ในตัว (ต่างจาก PDF) — วิธีเดียวที่ "เปิดแล้วเห็น/แก้เนื้อหาได้เลย" คือแปลงเป็น HTML/Markdown เอง
 * ใช้ zip/regex scan แบบเดียวกับ docx-parse.ts (ไม่ใช้ DOM parser เต็มรูปแบบ) — parse ครั้งเดียวเป็นโครงสร้างกลาง (Block[]) แล้วค่อย render 2 แบบจากโครงสร้างเดียวกัน
 */

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&') // ต้องทำเป็นอันสุดท้าย
}

// เนื้อหาในเอกสารเป็นข้อมูลผู้ใช้อัปโหลด — ต้อง escape ก่อนแทรกลง HTML เสมอ กัน stored XSS (เช่น ไฟล์มีข้อความ "<script>")
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

interface Run {
  text: string
  bold: boolean
  italic: boolean
}

// เซลล์ตาราง 1 ช่อง = หลาย paragraph ได้ (ปกติมี 1 อัน) แต่ละ paragraph = runs
type TableCell = Run[][]

type Block =
  | { type: 'heading'; level: number; runs: Run[] }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'table'; header: TableCell[]; rows: TableCell[][] }

function extractRuns(block: string): Run[] {
  const runBlocks = block.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g) ?? []
  return runBlocks.map((r) => {
    const rPrMatch = r.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)
    const rPr = rPrMatch ? rPrMatch[0] : ''
    const bold = /<w:b\/>|<w:b\s+(?!w:val="(?:false|0)")[^>]*\/>/.test(rPr)
    const italic = /<w:i\/>|<w:i\s+(?!w:val="(?:false|0)")[^>]*\/>/.test(rPr)
    const withBreaks = r.replace(/<w:(?:br|tab)\b[^>]*\/?>/g, '<w:t xml:space="preserve"> </w:t>')
    const text = [...withBreaks.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => decodeXmlEntities(m[1] ?? '')).join('')
    return { text, bold, italic }
  })
}

function paragraphStyleId(block: string): string {
  const m = block.match(/<w:pStyle w:val="([^"]+)"/)
  return m ? m[1]! : ''
}

function headingLevelOf(styleId: string, styleMap: Map<string, number>): number | null {
  if (!styleId) return null
  const literal = styleId.match(/^Heading([1-6])$/)
  if (literal) return Number(literal[1])
  return styleMap.get(styleId) ?? null
}

function parseCellParagraphs(cell: string): TableCell {
  const paras = cell.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []
  return paras.map((p) => extractRuns(p)).filter((runs) => runs.some((r) => r.text.trim()))
}

function parseTable(block: string): { header: TableCell[]; rows: TableCell[][] } {
  const rowBlocks = block.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []
  const allRows = rowBlocks.map((row) => {
    const cells = row.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) ?? []
    return cells.map((cell) => parseCellParagraphs(cell))
  })
  const [header, ...rows] = allRows
  return { header: header ?? [], rows }
}

/** ดึงไฟล์ word/document.xml + word/styles.xml จาก .docx แล้ว parse เป็นรายการ Block เรียงตามลำดับเดิมในเอกสาร */
function parseDocxBlocks(docxBytes: Uint8Array): Block[] {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(docxBytes, { filter: (f) => f.name === 'word/document.xml' || f.name === 'word/styles.xml' })
  } catch {
    throw new Error('unsupported_format') // ไฟล์ .doc รุ่นเก่า (binary OLE) หรือไฟล์เสียหาย ไม่ใช่ zip
  }
  const docBytes = files['word/document.xml']
  if (!docBytes) throw new Error('unsupported_format')
  const xml = new TextDecoder('utf-8').decode(docBytes)
  const stylesBytes = files['word/styles.xml']
  const styleMap = buildHeadingStyleMap(stylesBytes ? new TextDecoder('utf-8').decode(stylesBytes) : null)

  const rawBlocks = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g) ?? []
  const blocks: Block[] = []
  for (const b of rawBlocks) {
    if (b.startsWith('<w:tbl')) {
      const { header, rows } = parseTable(b)
      if (header.length > 0 || rows.length > 0) blocks.push({ type: 'table', header, rows })
      continue
    }
    const runs = extractRuns(b)
    if (!runs.some((r) => r.text.trim())) continue
    const level = headingLevelOf(paragraphStyleId(b), styleMap)
    blocks.push(level ? { type: 'heading', level, runs } : { type: 'paragraph', runs })
  }
  return blocks
}

// ---------- HTML (อ่านอย่างเดียว — DocWordPreview) ----------

function runsToHtmlInline(runs: Run[]): string {
  return runs
    .map((r) => {
      const t = escapeHtml(r.text)
      if (!t) return ''
      const withItalic = r.italic ? `<em>${t}</em>` : t
      return r.bold ? `<strong>${withItalic}</strong>` : withItalic
    })
    .join('')
}

function cellToHtml(cell: TableCell): string {
  const inner = cell.map((runs) => runsToHtmlInline(runs)).filter(Boolean).join('<br>')
  return inner || '&nbsp;'
}

function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'heading') {
        const tag = `h${Math.min(b.level + 1, 6)}`
        return `<${tag}>${runsToHtmlInline(b.runs)}</${tag}>`
      }
      if (b.type === 'paragraph') return `<p>${runsToHtmlInline(b.runs)}</p>`
      const headerRow = b.header.length > 0 ? `<tr>${b.header.map((c) => `<th>${cellToHtml(c)}</th>`).join('')}</tr>` : ''
      const bodyRows = b.rows.map((row) => `<tr>${row.map((c) => `<td>${cellToHtml(c)}</td>`).join('')}</tr>`).join('')
      return `<table>${headerRow}${bodyRows}</table>`
    })
    .filter(Boolean)
    .join('\n')
}

/** แปลง .docx เป็น HTML สำหรับแสดงผลอ่านอย่างเดียวในแอป (ไม่ต้องดาวน์โหลด) */
export function renderDocxToHtml(docxBytes: Uint8Array): string {
  return blocksToHtml(parseDocxBlocks(docxBytes))
}

// ---------- Markdown (แปลงเป็นเอกสารแก้ไขได้ — ใช้ต่อกับ DocEditor/TipTap TableKit) ----------

// เครื่องหมาย markdown ที่มีความหมายพิเศษ (ตัวหนา/เอียง/หัวข้อ/ลิสต์) ต้อง escape กันตีความผิดโดยไม่ตั้งใจ, "|" ต้อง escape แยกเพราะอยู่ในตาราง
function escapeMarkdownInline(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/([*_`~])/g, '\\$1')
}

function runsToMarkdownInline(runs: Run[], forTableCell = false): string {
  return runs
    .map((r) => {
      let t = escapeMarkdownInline(r.text)
      if (forTableCell) t = t.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
      if (!t.trim()) return t
      if (r.bold && r.italic) return `***${t}***`
      if (r.bold) return `**${t}**`
      if (r.italic) return `*${t}*`
      return t
    })
    .join('')
}

function cellToMarkdown(cell: TableCell): string {
  const inner = cell.map((runs) => runsToMarkdownInline(runs, true)).filter((s) => s.trim()).join('<br>')
  return inner.trim() || ' '
}

function tableToMarkdown(b: Extract<Block, { type: 'table' }>): string {
  const header = b.header.length > 0 ? b.header : (b.rows[0] ?? [])
  const bodyRows = b.header.length > 0 ? b.rows : b.rows.slice(1)
  if (header.length === 0) return ''
  const lines = [
    `| ${header.map(cellToMarkdown).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...bodyRows.map((row) => `| ${row.map(cellToMarkdown).join(' | ')} |`),
  ]
  return lines.join('\n')
}

function blocksToMarkdown(blocks: Block[]): string {
  const parts: string[] = []
  for (const b of blocks) {
    if (b.type === 'heading') parts.push(`${'#'.repeat(Math.min(b.level + 1, 6))} ${runsToMarkdownInline(b.runs)}`)
    else if (b.type === 'paragraph') parts.push(runsToMarkdownInline(b.runs))
    else parts.push(tableToMarkdown(b))
  }
  return parts.filter((s) => s.trim()).join('\n\n')
}

/** แปลง .docx เป็น Markdown (heading/ตัวหนา-เอียง/ตาราง GFM) — บันทึกลง docs.contentMarkdown แล้วเปิดแก้ไขต่อผ่าน DocEditor ได้ทันที */
export function renderDocxToMarkdown(docxBytes: Uint8Array): string {
  return blocksToMarkdown(parseDocxBlocks(docxBytes))
}
