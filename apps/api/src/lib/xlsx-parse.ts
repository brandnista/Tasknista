import { unzipSync, strFromU8 } from 'fflate'

/**
 * Pronista §Import Data — อ่านไฟล์ .xlsx ทั่วไป (ไม่ผูกกับ template ไหนโดยเฉพาะ) คู่กับ xlsx-write.ts ที่เขียนไฟล์
 * .xlsx คือ ZIP ข้างในเป็น XML (เหมือน .docx) — ใช้ fflate ตัวเดียวกับที่ docx-parse.ts ใช้อ่าน Word
 * ต้องรองรับทั้ง shared strings (t="s", มาตรฐานที่ Excel ใช้เวลา resave ไฟล์) และ inline strings (t="inlineStr", ที่เราเขียนเองตอน generate template)
 */

export interface XlsxSheet {
  /** แถวเป็น 1-indexed ตามที่ Excel แสดง (แถว 1 = หัวตาราง) → cells key เป็นตัวอักษรคอลัมน์ ("A","B",...) */
  rows: Map<number, Record<string, string | number>>
  maxRow: number
}

function colLetterOf(cellRef: string): string {
  return cellRef.replace(/\d+/g, '')
}

/** อ่าน xl/sharedStrings.xml — แต่ละ <si> อาจมี <t> ตรงๆ หรือมีหลาย <r><t>...</t></r> (rich text run) ต่อกัน */
function parseSharedStrings(files: Record<string, Uint8Array>): string[] {
  const raw = files['xl/sharedStrings.xml']
  if (!raw) return []
  const xml = strFromU8(raw)
  const out: string[] = []
  for (const [, siBody] of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const body = siBody ?? ''
    const runs = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1] ?? '')
    out.push(decodeXmlEntities(runs.join('')))
  }
  return out
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** หา path ของชีตจากชื่อ (workbook.xml → sheet name→r:id → workbook.xml.rels → r:id→target path) — ไม่เดาว่าเป็น sheet1.xml เสมอ เพราะลำดับชีตในไฟล์จริงไม่แน่นอน */
function findSheetPath(files: Record<string, Uint8Array>, sheetName: string): string | null {
  const workbookXml = files['xl/workbook.xml']
  const relsXml = files['xl/_rels/workbook.xml.rels']
  if (!workbookXml || !relsXml) return null
  const wb = strFromU8(workbookXml)
  const rels = strFromU8(relsXml)
  const sheetMatch = [...wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="(rId\d+)"[^>]*\/>/g)].find(
    (m) => decodeXmlEntities(m[1]!) === sheetName,
  )
  if (!sheetMatch) return null
  const rId = sheetMatch[2]!
  const relMatch = rels.match(new RegExp(`<Relationship Id="${rId}"[^>]*Target="([^"]*)"`))
  if (!relMatch) return null
  const target = relMatch[1]!
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`
}

/** parse ชีตเดียวจากไฟล์ .xlsx (bytes) ตามชื่อชีต — คืน null ถ้าไม่มีชีตชื่อนี้ในไฟล์ */
export function parseXlsxSheet(xlsxBytes: Uint8Array, sheetName: string): XlsxSheet | null {
  const files = unzipSync(xlsxBytes)
  const sheetPath = findSheetPath(files, sheetName)
  if (!sheetPath || !files[sheetPath]) return null
  const sharedStrings = parseSharedStrings(files)
  const sheetXml = strFromU8(files[sheetPath])

  const rows = new Map<number, Record<string, string | number>>()
  let maxRow = 0
  for (const [, rowNumRaw, rowBodyRaw] of sheetXml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowNum = Number(rowNumRaw)
    if (rowNum > maxRow) maxRow = rowNum
    const rowBody = rowBodyRaw ?? ''
    const cells: Record<string, string | number> = {}
    // Pronista §Import Data bugfix — attrs ต้อง non-greedy ([^>]*?) ไม่งั้น cell self-closing (ช่องว่าง เช่น "อยู่ใต้รหัส" ที่ไม่กรอก)
    // จะกลืน "/" ของ "/>" เข้าไปเป็นส่วนหนึ่งของ attrs ทำให้ regex ไปจับ ">...</c>" ของ cell ถัดไปแทน (cell ถัดไปทั้งก้อนหายไปเงียบๆ)
    for (const cellMatch of rowBody.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = cellMatch[1]!
      const attrs = cellMatch[2] ?? ''
      const inner = cellMatch[3] ?? ''
      const col = colLetterOf(ref)
      const typeMatch = attrs.match(/t="([^"]+)"/)
      const type = typeMatch?.[1]
      if (type === 'inlineStr') {
        const t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)
        cells[col] = t ? decodeXmlEntities(t[1]!) : ''
      } else if (type === 's') {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)
        const idx = v ? Number(v[1]) : NaN
        cells[col] = Number.isFinite(idx) ? (sharedStrings[idx] ?? '') : ''
      } else if (type === 'str' || type === 'b') {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)
        cells[col] = v ? decodeXmlEntities(v[1]!) : ''
      } else {
        // ไม่มี t = ตัวเลขดิบ (รวมถึงกรณี Excel แปลงวันที่ที่พิมพ์เป็น text ให้กลายเป็น date serial number อัตโนมัติ)
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)
        const num = v ? Number(v[1]) : NaN
        cells[col] = Number.isFinite(num) ? num : ''
      }
    }
    if (Object.keys(cells).length > 0) rows.set(rowNum, cells)
  }
  return { rows, maxRow }
}

/** Excel เก็บวันที่เป็นเลขวันนับจาก 1899-12-30 — ใช้แปลงกรณี cell ถูก Excel auto-detect เป็นวันที่ทั้งที่เราตั้งใจให้เป็น text (ความเสี่ยงที่รู้อยู่แล้วของ Excel) */
export function xlsxSerialToIsoDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000)
  return new Date(ms).toISOString().slice(0, 10)
}

/** ค่าจาก cell อาจเป็น text ปกติ, ตัวเลข, หรือ (เฉพาะคอลัมน์วันที่) เลข serial ของ Excel — คืน ISO date string เสมอถ้า parse ได้ */
export function cellToIsoDateOrNull(v: string | number | undefined): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return xlsxSerialToIsoDate(v)
  const s = String(v).trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

export function cellToText(v: string | number | undefined): string {
  if (v == null) return ''
  return String(v).trim()
}

export function cellToNumberOrNull(v: string | number | undefined): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) ? n : null
}
