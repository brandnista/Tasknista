import type { DocTemplateDef } from '@seedoffice/core'
import { unzipSync } from 'fflate'

/**
 * Tasknista §SRS import — แกะไฟล์ .docx (zip+XML) หาโครงสร้าง "หัวข้อความต้องการ" มาเป็นรายการ candidate สำหรับสร้าง Task
 * ไม่ใช้ XML/DOM library เต็มรูปแบบ — document.xml ของ Word มีโครงสร้างที่คาดเดาได้ (paragraph = <w:p>, style = <w:pStyle>, ข้อความ = <w:t> หลายอันต่อ paragraph)
 * ใช้ regex scan แทน (bounded, ไม่ต้องสร้าง XML tree) — เพียงพอสำหรับงานนี้และเสี่ยงน้อยกว่าบน Cloudflare Worker
 */

export interface Paragraph {
  style: string // pStyle id ดิบ — อาจเป็น 'Heading1'..'Heading6' (Word ปกติ) หรือ id ตัวเลข เช่น '1'/'2'/'3' (เอกสารที่ export จาก Google Docs/LibreOffice) หรือ '' (body)
  text: string
}

export interface SrsCandidate {
  tempId: string
  headingStyle: string
  sourceCode: string | null // "MKD-01" — null ถ้าเพิ่มด้วยมือ
  title: string
  priorityRaw: string | null // "P1" ตามที่เจอในเอกสาร
  priority: 'low' | 'normal' | 'high' | null // แปลงแล้ว (P0→high, P1→normal, P2→low)
  description: string
  selected: boolean
}

export interface SrsDetectedGroup {
  prefix: string // ตัวอย่าง prefix ที่เจอในกลุ่มนี้ (คั่นด้วย comma ถ้ามีหลายแบบ — เช่นเอกสารแบ่งเป็นหลาย module MKU-X/MKU-L/MKU-H)
  headingStyle: string
  isDominant: boolean
  candidates: SrsCandidate[]
}

export interface SrsParseResult {
  detectedGroups: SrsDetectedGroup[]
  detectionFailed: boolean
  suggestedDocNumber: string | null
  suggestedVersion: string | null
}

// รูปแบบทั่วไป "CODE-NN: ชื่อ" — ไม่ผูกกับ prefix ใดโดยเฉพาะ (เจออะไรจับอันนั้น)
// prefix เองอนุญาตให้มี "-" ภายในได้ (เช่น "MKU-X-01" = module ย่อย MKU-X + เลข 01) — ตัวเลขท้ายสุดหลัง "-" คือ running number ของ item
const ITEM_HEADING_RE = /^([A-Z][A-Z0-9-]{1,15})-(\d{1,4})\s*:\s*(.+)$/

const FIELD_LABELS: Record<string, string> = {
  'รหัส (ID)': 'sourceId',
  ชื่อความต้องการ: 'reqTitle',
  Priority: 'priority',
  'User Story': 'userStory',
  'เกณฑ์การยอมรับ (Acceptance Criteria)': 'acceptanceCriteria',
  'นอกขอบเขต (Out of Scope)': 'outOfScope',
  'อ้างอิง Codebase': 'codebaseRef',
  'หน้าจออ้างอิง (SCR)': 'screenRef',
}
const DOC_META_LABELS: Record<string, string> = {
  'รหัสเอกสาร (Document No.)': 'docNumber',
  เวอร์ชันเอกสาร: 'version',
}

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

/** ดึงไฟล์ใดๆ จาก .docx (zip) แล้วคืนเป็น string — ใช้กับทั้ง document.xml และ styles.xml */
function extractZipEntryAsText(docxBytes: Uint8Array, entryName: string): string | null {
  const files = unzipSync(docxBytes, { filter: (file) => file.name === entryName })
  const bytes = files[entryName]
  return bytes ? new TextDecoder('utf-8').decode(bytes) : null
}

/** ดึงไฟล์ word/document.xml จาก .docx */
export function extractDocumentXml(docxBytes: Uint8Array): string {
  const xml = extractZipEntryAsText(docxBytes, 'word/document.xml')
  if (!xml) throw new Error('invalid_docx')
  return xml
}

/** ดึงไฟล์ word/styles.xml จาก .docx — ใช้เพื่อรู้ว่า pStyle id ไหนคือ heading ระดับใด (เอกสารบางไฟล์ export มาแล้ว pStyle เป็นเลข เช่น "1"/"2"/"3" ไม่ใช่ "Heading1" ตรงๆ) */
export function extractStylesXml(docxBytes: Uint8Array): string | null {
  return extractZipEntryAsText(docxBytes, 'word/styles.xml')
}

/**
 * สร้าง map "pStyle id" → ระดับ heading (1-6) จาก styles.xml — เช็ค 2 สัญญาณ:
 * 1) <w:name w:val="heading N"/> (Word ปกติใช้ id="HeadingN" ตรงชื่ออยู่แล้ว แต่บางเอกสาร (Google Docs/LibreOffice export) ใช้ id เป็นเลข "1"/"2"/"3" แทน)
 * 2) <w:outlineLvl w:val="N"/> (0-indexed) เป็น fallback ถ้าไม่มีชื่อ "heading N" ตรงๆ (เช่น custom style name แต่ยังตั้ง outline level ไว้)
 */
export function buildHeadingStyleMap(stylesXml: string | null): Map<string, number> {
  const map = new Map<string, number>()
  if (!stylesXml) return map
  const styleBlocks = stylesXml.match(/<w:style [^>]*w:styleId="[^"]*"[^>]*>[\s\S]*?<\/w:style>/g) ?? []
  for (const block of styleBlocks) {
    const idMatch = block.match(/w:styleId="([^"]+)"/)
    if (!idMatch) continue
    const id = idMatch[1]!
    const nameMatch = block.match(/<w:name w:val="([^"]+)"/)
    const outlineMatch = block.match(/<w:outlineLvl w:val="(\d+)"/)
    let level: number | null = null
    if (nameMatch) {
      const hm = nameMatch[1]!.trim().toLowerCase().match(/^heading\s*([1-6])$/)
      if (hm) level = Number(hm[1])
    }
    if (level === null && outlineMatch) {
      const lvl = Number(outlineMatch[1]) + 1
      if (lvl >= 1 && lvl <= 6) level = lvl
    }
    if (level !== null) map.set(id, level)
  }
  return map
}

/** ระดับ heading ของ pStyle นี้ (1-6) หรือ null ถ้าไม่ใช่ heading — เช็คชื่อ "HeadingN" ตรงๆ ก่อน แล้วค่อย fallback ไปที่ styleMap (สำหรับเอกสารที่ pStyle เป็นเลข) */
function headingLevelOf(styleId: string, styleMap: Map<string, number>): number | null {
  if (!styleId) return null
  const literal = styleId.match(/^Heading([1-6])$/)
  if (literal) return Number(literal[1])
  return styleMap.get(styleId) ?? null
}

/** แตก document.xml เป็นรายการ paragraph (style + ข้อความรวมทุก run) */
export function extractParagraphs(xml: string): Paragraph[] {
  const blocks = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []
  return blocks.map((block) => {
    const styleMatch = block.match(/<w:pStyle w:val="([^"]+)"/)
    const style = styleMatch ? styleMatch[1]! : ''
    // <w:br/>/<w:tab/> ไม่มี <w:t> ของตัวเอง — แทรกช่องว่างแทนกันข้อความ 2 บรรทัดใน cell เดียวติดกัน
    const withBreaks = block.replace(/<w:(?:br|tab)\b[^>]*\/?>/g, '<w:t xml:space="preserve"> </w:t>')
    const text = [...withBreaks.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map((m) => decodeXmlEntities(m[1] ?? ''))
      .join('')
    return { style, text }
  })
}

/** เดินคู่ label→value ใน paragraph ช่วงที่กำหนด — คืน map ตาม labelMap ที่เจอ (ไม่บังคับเจอครบ) */
function pairLabelValues(paras: Paragraph[], start: number, end: number, labelMap: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  let i = start
  while (i < end) {
    const key = labelMap[paras[i]!.text.trim()]
    if (key && i + 1 < end) {
      out[key] = paras[i + 1]!.text.trim()
      i += 2
    } else {
      i += 1
    }
  }
  return out
}

export function mapSrsPriority(raw: string | null): 'low' | 'normal' | 'high' | null {
  if (!raw) return null
  const t = raw.trim().toUpperCase()
  if (t === 'P0') return 'high'
  if (t === 'P1') return 'normal'
  if (t === 'P2') return 'low'
  return null
}

function composeDescription(fields: Record<string, string>, rawBody: string[]): string {
  const lines: string[] = []
  if (fields.userStory) lines.push(`User Story:\n${fields.userStory}`)
  if (fields.acceptanceCriteria) lines.push(`เกณฑ์การยอมรับ (Acceptance Criteria):\n${fields.acceptanceCriteria}`)
  if (fields.outOfScope) lines.push(`นอกขอบเขต (Out of Scope):\n${fields.outOfScope}`)
  if (fields.codebaseRef) lines.push(`อ้างอิง Codebase: ${fields.codebaseRef}`)
  if (fields.screenRef) lines.push(`หน้าจออ้างอิง (SCR): ${fields.screenRef}`)
  if (lines.length > 0) return lines.join('\n\n')
  return rawBody.filter((t) => t.trim()).join('\n')
}

/**
 * วิเคราะห์ paragraph ทั้งเอกสาร หา candidate ความต้องการ (heading รูปแบบ CODE-NN: ชื่อ) + ข้อมูล doc number/version ต้นเอกสาร
 * stylesXml เป็น optional — ถ้าไม่ส่งมา จะรู้จักเฉพาะ pStyle ชื่อ "HeadingN" ตรงๆ (เอกสาร Word ปกติ) ไม่รู้จักเอกสารที่ pStyle เป็นเลข (ควรส่งมาเสมอถ้ามี)
 */
export function parseSrsDocx(xml: string, stylesXml: string | null = null): SrsParseResult {
  const paras = extractParagraphs(xml)
  const styleMap = buildHeadingStyleMap(stylesXml)
  const levelOf = (styleId: string) => headingLevelOf(styleId, styleMap)

  // หัวข้อ heading ก่อนตัวแรกที่เป็น heading ระดับ 1 = ส่วนควบคุมเอกสาร (Document No./เวอร์ชัน)
  const firstH1 = paras.findIndex((p) => levelOf(p.style) === 1)
  const metaFields = pairLabelValues(paras, 0, firstH1 === -1 ? paras.length : firstH1, DOC_META_LABELS)

  // หา heading ทุกอันที่ match รูปแบบ CODE-NN: ชื่อ
  const headingIdx: { index: number; style: string; prefix: string; title: string }[] = []
  paras.forEach((p, i) => {
    if (levelOf(p.style) === null) return
    const m = p.text.trim().match(ITEM_HEADING_RE)
    if (m) headingIdx.push({ index: i, style: p.style, prefix: m[1]!, title: `${m[1]}-${m[2]}: ${m[3]!.trim()}` })
  })

  if (headingIdx.length === 0) {
    return { detectedGroups: [], detectionFailed: true, suggestedDocNumber: metaFields.docNumber ?? null, suggestedVersion: metaFields.version ?? null }
  }

  // จุดจบของแต่ละ candidate = heading (ระดับใดก็ได้) ตัวถัดไป หรือจบเอกสาร
  const anyHeadingIdx = new Set(paras.map((p, i) => (levelOf(p.style) !== null ? i : -1)).filter((i) => i >= 0))
  const nextHeadingAfter = (from: number): number => {
    for (let i = from + 1; i < paras.length; i++) if (anyHeadingIdx.has(i)) return i
    return paras.length
  }

  // จัดกลุ่มตาม "ระดับ heading style" เท่านั้น (ไม่แยกตาม prefix) — เอกสารจริงมักแบ่ง FR เป็นหลาย module
  // ที่ prefix ต่างกัน (เช่น MKU-X-01/MKU-L-01/MKU-H-01 ทั้งหมดอยู่ Heading3 เดียวกัน) ควรรวมเป็นกลุ่มเดียวให้เลือกทีเดียวจบ
  // ส่วน prefix ที่ต่างกันจริงๆ คนละความหมาย (เช่น FR ที่ Heading3 กับ SCR ที่ Heading2) จะถูกแยกกลุ่มโดยธรรมชาติเพราะ style คนละระดับอยู่แล้ว
  const styleCounts = new Map<string, number>()
  for (const h of headingIdx) styleCounts.set(h.style, (styleCounts.get(h.style) ?? 0) + 1)
  let dominantStyle = ''
  let dominantCount = 0
  for (const [s, c] of styleCounts) if (c > dominantCount) { dominantStyle = s; dominantCount = c }

  const groupsMap = new Map<string, SrsDetectedGroup>()
  headingIdx.forEach((h, order) => {
    const key = h.style
    const bodyEnd = nextHeadingAfter(h.index)
    const bodyStart = h.index + 1
    const fields = pairLabelValues(paras, bodyStart, bodyEnd, FIELD_LABELS)
    const rawBody = paras.slice(bodyStart, bodyEnd).map((p) => p.text)
    const m = h.title.match(ITEM_HEADING_RE)!
    const candidate: SrsCandidate = {
      tempId: `srs_${h.index}_${order}`,
      headingStyle: h.style,
      sourceCode: `${m[1]}-${m[2]}`,
      title: (fields.reqTitle || m[3]!).trim(),
      priorityRaw: fields.priority ?? null,
      priority: mapSrsPriority(fields.priority ?? null),
      description: composeDescription(fields, rawBody),
      selected: key === dominantStyle,
    }
    if (!groupsMap.has(key)) groupsMap.set(key, { prefix: h.prefix, headingStyle: h.style, isDominant: key === dominantStyle, candidates: [] })
    else {
      const g = groupsMap.get(key)!
      const existingPrefixes = g.prefix.split(', ')
      if (!existingPrefixes.includes(h.prefix)) g.prefix = [...existingPrefixes, h.prefix].join(', ')
    }
    groupsMap.get(key)!.candidates.push(candidate)
  })

  return {
    detectedGroups: [...groupsMap.values()],
    detectionFailed: false,
    suggestedDocNumber: metaFields.docNumber ?? null,
    suggestedVersion: metaFields.version ?? null,
  }
}

/**
 * Tasknista §Document Traceability — parser ตารางแบบ generic สำหรับ MOM/BRD/SOW (โครงสร้างเป็นตาราง Word ล้วน ต่างจาก SRS ต้นแบบเดิมที่เป็น heading+label:value)
 * ใช้ template def จาก registry (packages/core) เป็น config เดียว ไม่ต้องเขียน parser แยกต่อประเภทเอกสาร — จับคู่ label หัวคอลัมน์กับ section.columns[].label ตรงๆ (fuzzy ทั้ง 2 ทาง กัน label ที่เราใส่คำอธิบายเพิ่มไม่ตรงกับ header ดิบเป๊ะๆ)
 */
export function extractTables(xml: string): string[][][] {
  const tableBlocks = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? []
  return tableBlocks.map((tbl) => {
    const rows = tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []
    return rows.map((row) => {
      const cells = row.match(/<w:tc[ >][\s\S]*?<\/w:tc>/g) ?? []
      return cells.map((cell) => {
        const withBreaks = cell.replace(/<w:(?:br|tab)\b[^>]*\/?>/g, '<w:t xml:space="preserve"> </w:t>')
        return [...withBreaks.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => decodeXmlEntities(m[1] ?? '')).join('')
      })
    })
  })
}

function normalizeHeaderLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '')
}

function columnMatchesHeader(label: string, header: string): boolean {
  const a = normalizeHeaderLabel(label)
  const b = normalizeHeaderLabel(header)
  if (!a || !b) return false
  return a.includes(b) || b.includes(a)
}

// คอลัมน์ def หนึ่งตัวจับคู่กับ header ดิบได้ไหม — เทียบทั้ง label หลักและ matchLabels (alias หัวตารางเอกสารจริงที่เขียนคำสั้นกว่า label ในฟอร์ม)
function columnDefMatchesHeader(col: { label: string; matchLabels?: string[] }, header: string): boolean {
  if (columnMatchesHeader(col.label, header)) return true
  return (col.matchLabels ?? []).some((alias) => columnMatchesHeader(alias, header))
}

function splitReferenceCodes(raw: string): string[] {
  return raw
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** เดินทุกตาราง หา 2 คอลัมน์ "หัวข้อ/รายละเอียด" (meta เอกสารต้นเล่ม) — เจอ label ที่ตรงกับ labelMap ก็เก็บค่าไว้ (ไม่บังคับเจอครบ) */
function pairLabelValuesFromTables(tables: string[][][], labelMap: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const table of tables) {
    for (const row of table) {
      if (row.length < 2) continue
      const key = labelMap[(row[0] ?? '').trim()]
      if (key && !out[key]) out[key] = (row[1] ?? '').trim()
    }
  }
  return out
}

const TEMPLATE_DOC_META_LABELS: Record<string, string> = {
  'รหัสเอกสาร (Document No.)': 'docNumber',
  เวอร์ชันเอกสาร: 'version',
}

/** เดา priority จากคำที่พบในตาราง (P0-P2 แบบ SRS, Must/Should/Could Have แบบ BRD MoSCoW, หรือคำไทยสูง/กลาง/ต่ำ) */
export function mapGenericPriority(raw: string | null): 'low' | 'normal' | 'high' | null {
  if (!raw) return null
  const t = raw.trim().toUpperCase()
  if (t === 'P0' || t === 'HIGH' || t === 'MUST HAVE' || t === 'MUST') return 'high'
  if (t === 'P1' || t === 'NORMAL' || t === 'SHOULD HAVE' || t === 'SHOULD') return 'normal'
  if (t === 'P2' || t === 'LOW' || t === 'COULD HAVE' || t === 'COULD') return 'low'
  const raw2 = raw.trim()
  if (raw2 === 'สูง') return 'high'
  if (raw2 === 'กลาง') return 'normal'
  if (raw2 === 'ต่ำ') return 'low'
  return null
}

export interface TemplateBreakoutCandidate {
  tempId: string
  sourceCode: string | null
  title: string
  priorityRaw: string | null
  priority: 'low' | 'normal' | 'high' | null
  description: string
  // Tasknista §SOW Task/Subtask — ค่าดิบต่อคอลัมน์ (key ตาม descriptionKeys) คู่ขนานกับ description ที่ compose ไว้แล้ว
  // ให้ route ที่ต้องการแยกฟิลด์ใดฟิลด์หนึ่งออกมาโดยเฉพาะ (เช่น "ประเภท" ของ SOW) ดึงไปใช้ได้โดยไม่ต้อง parse description string เอง
  descriptionFields: Record<string, string>
  referenceCodes: string[]
  selected: boolean
}

export interface TemplateTableParseResult {
  items: TemplateBreakoutCandidate[]
  detectionFailed: boolean
  suggestedDocNumber: string | null
  suggestedVersion: string | null
}

export interface UirItemDetail {
  userFlowSteps: string[]
  uiElementsValidation: string[]
}

const normalizeUirCode = (s: string) => s.replace(/\s+/g, '').toUpperCase()
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Tasknista §Document Traceability — เฉพาะ UIR: ดึง "User Flow & Interaction Steps" + "UI Elements Validation (ระดับ Top-level)"
 * ต่อหน้าจอ จากข้อ 3 "Detailed UI & Interaction Review" ของเอกสาร (คนละส่วนกับตาราง Client Sign-off Matrix ที่ parseTemplateTableDocx อ่าน)
 * หาจุดเริ่มเนื้อหาแต่ละหน้าจอด้วยการค้นหา paragraph รูปแบบหัวข้อ "<รหัส UIR>: <ชื่อ>" (โคลอนตามหลังรหัสทันที) — ไม่ใช่แค่มีรหัสอยู่ในเนื้อความ
 * เพราะรหัสเดียวกันโผล่ซ้ำในตารางอื่นของเอกสารด้วย (ตาราง Mapping ข้อ 1, ตาราง Client Sign-off Matrix ข้อ 4) ซึ่งไม่มีโคลอนตามหลัง จึงกันการจับผิดจุด
 * ไม่พึ่ง heading style เพราะบางไฟล์ pStyle ของบรรทัดพวกนี้ไม่ได้ตั้งเป็น Heading จริง (ทนกว่าการเช็ค pStyle)
 */
export function extractUirItemDetails(xml: string, sourceCodes: (string | null)[]): Map<string, UirItemDetail> {
  const paras = extractParagraphs(xml)
  const codes = [...new Set(sourceCodes.filter((c): c is string => !!c))]
  const result = new Map<string, UirItemDetail>()
  if (codes.length === 0) return result

  // codeRe: ยอมให้ whitespace ภายในรหัสต่างจากต้นฉบับได้ (เช่น "MAK002- UIR-001" ในตารางเทียบกับ "MAK002-UIR-001" ในหัวข้อ) แต่ต้องตามด้วย ":" ทันที (ยอมมี whitespace คั่นได้)
  const starts: { index: number; norm: string }[] = []
  const seen = new Set<string>()
  for (const code of codes) {
    const norm = normalizeUirCode(code)
    if (seen.has(norm)) continue
    const codeRe = new RegExp(code.trim().split(/\s+/).map(escapeRegex).join('\\s*') + '\\s*:')
    const idx = paras.findIndex((p) => codeRe.test(p.text))
    if (idx !== -1) { starts.push({ index: idx, norm }); seen.add(norm) }
  }
  starts.sort((a, b) => a.index - b.index)

  const isBullet = (t: string) => /^[-•]\s*/.test(t.trim())
  const stripBullet = (t: string) => t.trim().replace(/^[-•]\s*/, '')

  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1]!.index : paras.length
    const userFlowSteps: string[] = []
    const uiElementsValidation: string[] = []
    let mode: 'none' | 'flow' | 'ui' = 'none'
    for (let j = s.index + 1; j < end; j++) {
      const text = paras[j]!.text.trim()
      if (!text) continue
      if (/^User Flow\s*&?\s*Interaction Steps\s*:?/i.test(text)) { mode = 'flow'; continue }
      if (/^UI Elements Validation/i.test(text)) { mode = 'ui'; continue }
      if (/^Backend\s*\(CMS\)/i.test(text) || /^Client Review Status/i.test(text)) { mode = 'none'; continue }
      if (mode === 'flow' && isBullet(text)) userFlowSteps.push(stripBullet(text))
      else if (mode === 'ui' && isBullet(text)) uiElementsValidation.push(stripBullet(text))
      else if (mode !== 'none' && !isBullet(text)) mode = 'none' // เจอย่อหน้าอื่นแทรกกลางบล็อก bullet ถือว่าจบช่วงนั้น
    }
    if (userFlowSteps.length > 0 || uiElementsValidation.length > 0) result.set(s.norm, { userFlowSteps, uiElementsValidation })
  })
  return result
}

export interface SowModuleSubtaskCandidate {
  tempId: string
  text: string
}

export interface SowModuleGroup {
  refIdBase: string // รหัสในวงเล็บท้าย heading เช่น "MAK002-SOW-006" — ใช้จับคู่กับแถวตาราง 4.4
  headingText: string
  subtasks: SowModuleSubtaskCandidate[]
}

// heading หัวข้อโมดูล SOW เช่น "4.1 Food Ordering & Dine-in Mode (MAK002-SOW-006)" — ต้องลงท้ายด้วยรหัสในวงเล็บ (ตัวอักษร/ตัวเลข คั่นด้วย "-" อย่างน้อย 1 ครั้ง)
const SOW_MODULE_HEADING_RE = /\(([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\)\s*$/

/**
 * Tasknista §SOW Task/Subtask — ดึงรายการ "งานย่อย" จากย่อหน้าใต้หัวข้อโมดูลในข้อ 4 (High-level System Scope) ของเอกสาร SOW จริง
 * เอกสารจริงไม่ได้เขียนเป็น bullet list แยกบรรทัดต่อ subtask (ต่างจากตัวอย่างในสเปก) — แต่ละโมดูลมีย่อหน้าเดียวบรรยายรวมฟีเจอร์คั่นด้วยจุลภาค/"และ"
 * แล้วปิดท้ายด้วยส่วน metadata ("- อ้างอิง BR-Dxx...- รวม N Ticket...MH") ซึ่งไม่ใช่รายการงาน — ตัดทิ้งที่ " - " แรกก่อน split
 */
export function parseSowModuleSubtasks(xml: string, stylesXml: string | null = null): SowModuleGroup[] {
  const styleMap = buildHeadingStyleMap(stylesXml)
  // ตัดตารางออกก่อนสแกน — <w:p> ในเซลตารางก็ถูก extractParagraphs จับด้วย ถ้าไม่ตัดออก เอกสารที่ heading ตารางสรุป (เช่น "4.4 ตารางรวมทุกรายการ") ไม่ได้ตั้งเป็น heading style จะทำให้ขอบเขตย่อหน้าโมดูลสุดท้ายไหลเลยเข้าไปในเนื้อหาตาราง
  const xmlWithoutTables = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '')
  const paras = extractParagraphs(xmlWithoutTables)

  // แยก 2 เซ็ต: heading ทุกระดับ (ใช้กันขอบเขตเนื้อหาโมดูล ไม่ให้ไหลข้ามหัวข้ออื่น เช่น "5. User Roles") กับ heading ที่เป็นโมดูล SOW จริง (มีรหัสในวงเล็บ)
  const allHeadingIdx: number[] = []
  const moduleHeadingIdx: number[] = []
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i]!
    if (headingLevelOf(p.style, styleMap) === null) continue
    allHeadingIdx.push(i)
    if (SOW_MODULE_HEADING_RE.test(p.text.trim())) moduleHeadingIdx.push(i)
  }

  const groups: SowModuleGroup[] = []
  moduleHeadingIdx.forEach((idx) => {
    const headingText = paras[idx]!.text.trim()
    const codeMatch = headingText.match(SOW_MODULE_HEADING_RE)
    if (!codeMatch) return
    const refIdBase = codeMatch[1]!
    const nextHeading = allHeadingIdx.find((h) => h > idx)
    const end = nextHeading ?? paras.length
    const body = paras
      .slice(idx + 1, end)
      .map((p) => p.text.trim())
      .filter(Boolean)
      .join(' ')
    const metaCut = body.indexOf(' - ')
    const featureText = (metaCut === -1 ? body : body.slice(0, metaCut)).trim()
    // "และ" มักไม่มีเว้นวรรคตามหลังก่อนคำไทยคำถัดไป (แต่มีเว้นวรรคนำหน้าเสมอในฐานะคำเชื่อม) — เว้นวรรคหลังจึงทำเป็น optional
    const subtasks = featureText
      .split(/\s*,\s*|\s*、\s*|\s+และ\s*/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text, j) => ({ tempId: `${refIdBase}-sub-${j}`, text }))
    groups.push({ refIdBase, headingText, subtasks })
  })
  return groups
}

/**
 * parse เอกสาร Word ที่โครงสร้างเป็นตารางล้วน (ทุก docType ที่มีตาราง breakout) หาแถวในตาราง breakoutToTasks ของ template นั้น
 * จับคู่คอลัมน์ตาม **label** (ไม่ใช่ตำแหน่ง) — ทนต่อกรณีเอกสารจริงเรียงคอลัมน์คนละลำดับกับฟอร์ม (เช่น SRS Mock v1.1) หรือใช้ชื่อหัวตารางสั้นกว่า label ในฟอร์ม (ใช้ matchLabels)
 */
export function parseTemplateTableDocx(xml: string, def: DocTemplateDef): TemplateTableParseResult {
  const tables = extractTables(xml)
  const metaFields = pairLabelValuesFromTables(tables, TEMPLATE_DOC_META_LABELS)
  const section = def.sections.find((s) => s.kind === 'table' && s.breakoutToTasks)
  if (!section || section.kind !== 'table' || !section.breakoutToTasks) {
    return { items: [], detectionFailed: true, suggestedDocNumber: metaFields.docNumber ?? null, suggestedVersion: metaFields.version ?? null }
  }
  const { columns, breakoutToTasks } = section
  const { sourceCodeKey, titleKey, priorityKey, descriptionKeys, referenceCodeKey } = breakoutToTasks
  const colLabel = (key: string) => columns.find((c) => c.key === key)?.label ?? key

  const items: TemplateBreakoutCandidate[] = []
  let matchedAnyTable = false
  for (const table of tables) {
    if (table.length < 2) continue
    const header = table[0]!

    // header[i] (ดิบจากไฟล์ Word) -> columnKey (ตาม def) — จับคู่ตาม label/matchLabels ไม่ใช่ตำแหน่ง
    const headerToKey = new Map<number, string>()
    for (let i = 0; i < header.length; i++) {
      const raw = header[i] ?? ''
      const col = columns.find((c) => columnDefMatchesHeader(c, raw))
      if (col) headerToKey.set(i, col.key)
    }
    const matchCount = headerToKey.size
    const hasTitle = [...headerToKey.values()].includes(titleKey)
    if (!hasTitle || matchCount < Math.ceil(columns.length / 2)) continue
    matchedAnyTable = true

    const keyToColIndex = new Map<string, number>()
    for (const [idx, key] of headerToKey) keyToColIndex.set(key, idx)

    for (const row of table.slice(1)) {
      const get = (key: string) => {
        const idx = keyToColIndex.get(key)
        return idx === undefined ? '' : (row[idx] ?? '').trim()
      }
      const title = get(titleKey)
      if (!title) continue
      const sourceCode = get(sourceCodeKey) || null
      const description = descriptionKeys
        .map((k) => {
          const v = get(k)
          return v ? `${colLabel(k)}:\n${v}` : null
        })
        .filter((v): v is string => !!v)
        .join('\n\n')
      const priorityRaw = priorityKey ? get(priorityKey) || null : null
      const descriptionFields: Record<string, string> = {}
      for (const k of descriptionKeys) {
        const v = get(k)
        if (v) descriptionFields[k] = v
      }
      items.push({
        tempId: `brk_${items.length}`,
        sourceCode,
        title,
        priorityRaw,
        priority: mapGenericPriority(priorityRaw),
        description,
        descriptionFields,
        referenceCodes: referenceCodeKey ? splitReferenceCodes(get(referenceCodeKey)) : [],
        selected: true,
      })
    }
  }

  return { items, detectionFailed: !matchedAnyTable, suggestedDocNumber: metaFields.docNumber ?? null, suggestedVersion: metaFields.version ?? null }
}

