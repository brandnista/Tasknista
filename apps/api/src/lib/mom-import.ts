import { emptyTemplateData, MOM_TEMPLATE, type TableSectionDef, type TemplateData, type TemplateTableRow } from '@seedoffice/core'
import { extractDocumentXml, extractParagraphs, extractTables } from './docx-parse'

/**
 * Pronista §Project Documents (2026-09-30) — อ่านไฟล์ MOM (.docx) แล้วกรอก Template "MOM" ให้อัตโนมัติ
 *
 * ไฟล์ MOM ของบริษัทมีโครงเดียวกัน: หัวข้อ (ข้อมูลการประชุม / ผู้เข้าร่วม / วาระ / มติ / รายการติดตาม / ครั้งถัดไป / การรับรอง)
 * ตามด้วยตารางหรือรายการใต้หัวข้อ — อ่านตามลำดับในเอกสารแล้วจับคู่ตาม "ชื่อหัวข้อ" (ยอมให้มีเลขนำหน้า/ชื่ออังกฤษต่อท้าย)
 * ไม่ผูกกับตำแหน่งตารางตายตัว เพื่อให้ไฟล์เก่าที่เรียงต่างกันเล็กน้อยยังอ่านได้ · ส่วนที่อ่านไม่เจอจะเว้นว่างไว้ + แจ้ง warning ให้ผู้ใช้ตรวจก่อนบันทึก
 * pure function (ไม่แตะ DB) — ทดสอบได้ตรงๆ
 */

export interface MomParseResult {
  data: TemplateData
  /** รหัสเอกสารที่อ่านได้จากไฟล์ (เช่น TLD-MOM-20260918-002) — null ถ้าไม่เจอ */
  docNumber: string | null
  /** หัวข้อการประชุมที่อ่านได้ — ใช้เป็นชื่อเอกสารเริ่มต้น */
  subject: string | null
  warnings: string[]
  /** จำนวนแถวที่อ่านได้ต่อตาราง/รายการ — โชว์ในหน้าตรวจก่อนบันทึก */
  counts: { attendees: number; agenda: number; decisions: number; actionItems: number; approvals: number }
}

type SectionId = 'meeting_info' | 'attendees' | 'agenda' | 'decisions' | 'action_items' | 'next_meeting' | 'approval' | 'remarks'

// หัวข้อแต่ละส่วน — ต้องอยู่ต้นบรรทัด (หลังเลขนำหน้า) และสั้น เพื่อไม่ไปจับประโยคในเนื้อหา เช่น "วาระสำคัญ: ..."
const HEADING_RULES: { id: SectionId; re: RegExp }[] = [
  { id: 'meeting_info', re: /^(ข้อมูลการประชุม|meeting\s*information)/i },
  { id: 'attendees', re: /^(ผู้เข้าร่วม|attendees)/i },
  { id: 'agenda', re: /^(วาระการประชุม|agenda\b)/i },
  { id: 'decisions', re: /^(สรุปประเด็น|มติที่ประชุม|discussion)/i },
  { id: 'action_items', re: /^(รายการติดตาม|action\s*items)/i },
  { id: 'next_meeting', re: /^(กำหนดการประชุมครั้งถัดไป|การประชุมครั้งถัดไป|next\s*meeting)/i },
  { id: 'approval', re: /^(การรับรอง|approval)/i },
  { id: 'remarks', re: /^(หมายเหตุ|remarks?)/i },
]

const SECTION_LABEL: Record<SectionId, string> = {
  meeting_info: 'ข้อมูลการประชุม',
  attendees: 'ผู้เข้าร่วมประชุม',
  agenda: 'วาระการประชุม',
  decisions: 'สรุปประเด็นและมติที่ประชุม',
  action_items: 'รายการติดตาม (Action Items)',
  next_meeting: 'กำหนดการประชุมครั้งถัดไป',
  approval: 'การรับรองรายงานการประชุม',
  remarks: 'หมายเหตุ',
}

const stripNumbering = (s: string) => s.replace(/^\s*\d+\s*[.)]\s*/, '').trim()

function headingOf(text: string): SectionId | null {
  const t = stripNumbering(text)
  if (!t || t.length > 90) return null
  return HEADING_RULES.find((r) => r.re.test(t))?.id ?? null
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/[()（）:：]/g, '')

/** หัวคอลัมน์ในไฟล์ตรงกับคอลัมน์ของ template ไหม — เทียบแบบ contains สองทาง (ยอมมีคำอังกฤษ/วงเล็บต่อท้าย) */
function headerMatches(col: { label: string; matchLabels?: string[] }, header: string): boolean {
  const h = norm(header)
  if (!h) return false
  return [col.label, ...(col.matchLabels ?? [])].some((l) => {
    const c = norm(l)
    return !!c && (c.includes(h) || h.includes(c))
  })
}

const MONTHS_TH: Record<string, number> = {
  มกราคม: 1, กุมภาพันธ์: 2, มีนาคม: 3, เมษายน: 4, พฤษภาคม: 5, มิถุนายน: 6, กรกฎาคม: 7, สิงหาคม: 8, กันยายน: 9, ตุลาคม: 10, พฤศจิกายน: 11, ธันวาคม: 12,
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6, 'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
}

/** แปลงวันที่ที่เจอในเอกสาร (ISO / d/m/yyyy / "18 กันยายน 2569") เป็น YYYY-MM-DD สำหรับช่องวันที่ — อ่านไม่ออกคืน '' (ไม่เดา) */
export function normalizeThaiDate(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const toIso = (y: number, m: number, d: number) => {
    const year = y > 2400 ? y - 543 : y
    if (m < 1 || m > 12 || d < 1 || d > 31 || year < 1990 || year > 2100) return ''
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (slash) return toIso(Number(slash[3]), Number(slash[2]), Number(slash[1]))
  const word = s.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})/)
  if (word) {
    const m = MONTHS_TH[word[2]!]
    if (m) return toIso(Number(word[3]), m, Number(word[1]))
  }
  return ''
}

interface Block {
  kind: 'p' | 'tbl'
  text?: string
  table?: string[][]
}

function readBlocks(docxBytes: Uint8Array): Block[] {
  const xml = extractDocumentXml(docxBytes)
  const body = xml.slice(Math.max(0, xml.indexOf('<w:body')))
  const raw = body.match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g) ?? []
  const blocks: Block[] = []
  for (const r of raw) {
    if (r.startsWith('<w:tbl>')) {
      const table = extractTables(r)[0]
      if (table && table.length > 0) blocks.push({ kind: 'tbl', table })
    } else {
      const text = (extractParagraphs(r)[0]?.text ?? '').replace(/\s+/g, ' ').trim()
      if (text) blocks.push({ kind: 'p', text })
    }
  }
  return blocks
}

const isEmptyRow = (row: string[]) => row.every((c) => !c.trim())

/** ตาราง 2 คอลัมน์ "หัวข้อ | รายละเอียด" → คู่ label/value (ข้ามแถวหัวตาราง) */
function labelValuePairs(table: string[][]): [string, string][] {
  const pairs: [string, string][] = []
  for (const row of table) {
    if (row.length < 2) continue
    const label = (row[0] ?? '').trim()
    const value = row.slice(1).join(' ').trim()
    if (!label) continue
    if (norm(label) === 'หัวข้อ' && norm(value) === 'รายละเอียด') continue
    pairs.push([label, value])
  }
  return pairs
}

/** ตารางข้อมูล: ใช้แถวแรกเป็นหัวคอลัมน์จับคู่กับ template — ถ้าจับคู่ได้น้อยกว่า 2 คอลัมน์ ให้ใช้ตำแหน่งแทน (เมื่อจำนวนคอลัมน์เท่ากัน) */
function readDataTable(table: string[][], def: TableSectionDef): TemplateTableRow[] {
  if (table.length === 0) return []
  const header = table[0]!
  const colIndex = new Map<string, number>()
  header.forEach((h, i) => {
    const col = def.columns.find((c) => !colIndex.has(c.key) && headerMatches(c, h))
    if (col) colIndex.set(col.key, i)
  })
  let dataRows = table.slice(1)
  if (colIndex.size < 2) {
    // หัวตารางจับคู่ไม่ได้ (ไม่มีหัว/ใช้ชื่ออื่น) — ถ้าจำนวนคอลัมน์เท่ากับ template ใช้ตำแหน่งแทน และถือทุกแถวเป็นข้อมูล ไม่งั้นข้ามตารางนี้
    if (header.length !== def.columns.length) return []
    colIndex.clear()
    def.columns.forEach((c, i) => colIndex.set(c.key, i))
    dataRows = table
  }
  const rows: TemplateTableRow[] = []
  for (const r of dataRows) {
    if (isEmptyRow(r)) continue
    const row: TemplateTableRow = {}
    for (const c of def.columns) {
      const idx = colIndex.get(c.key)
      const v = idx === undefined ? '' : (r[idx] ?? '').trim()
      row[c.key] = c.type === 'date' ? normalizeThaiDate(v) || v : v
    }
    rows.push(row)
  }
  return rows
}

const tableDef = (id: string): TableSectionDef => {
  const s = MOM_TEMPLATE.sections.find((x) => x.id === id && x.kind === 'table')
  if (!s || s.kind !== 'table') throw new Error(`mom template missing table ${id}`)
  return s
}

const MEETING_INFO_LABELS: [RegExp, string][] = [
  [/รหัสเอกสาร|mom\s*no/i, 'document_no'],
  [/โครงการ|project/i, 'project_code'],
  [/หัวข้อการประชุม|หัวข้อ/i, 'subject'],
  [/วันที่|เวลา|date/i, 'datetime'],
  [/สถานที่|ช่องทาง|venue|location/i, 'venue'],
  [/วาระ|agenda/i, 'key_agenda'],
]
const NEXT_MEETING_LABELS: [RegExp, string][] = [
  [/วันที่|เวลา|date/i, 'datetime'],
  [/สถานที่|ช่องทาง|venue|location/i, 'venue'],
  [/วาระ|agenda/i, 'agenda'],
]

function applyLabelPairs(pairs: [string, string][], rules: [RegExp, string][], into: Record<string, string>) {
  for (const [label, value] of pairs) {
    const hit = rules.find(([re]) => re.test(label))
    if (hit && !into[hit[1]] && value) into[hit[1]] = value
  }
}

/** อ่านไฟล์ MOM (.docx) → ข้อมูลตาม Template "MOM" ของระบบ */
export function parseMomDocx(docxBytes: Uint8Array): MomParseResult {
  const blocks = readBlocks(docxBytes)
  const data = emptyTemplateData(MOM_TEMPLATE)
  const warnings: string[] = []
  const seen = new Set<SectionId>()
  const parsedTables: Partial<Record<'attendees' | 'decisions' | 'action_items' | 'approval', TemplateTableRow[]>> = {}
  const agenda: string[] = []
  const remarks: string[] = []
  const info = { ...data.fields.meeting_info! }
  const next = { ...data.fields.next_meeting! }
  let docNumberFromText: string | null = null

  let current: SectionId | null = null
  for (const b of blocks) {
    if (b.kind === 'p') {
      const h = headingOf(b.text!)
      if (h) {
        current = h
        seen.add(h)
        if (h === 'remarks') {
          const inline = b.text!.replace(/^\s*(?:\d+\s*[.)]\s*)?(?:หมายเหตุ|remarks?)[^:：]*[:：]?\s*/i, '').trim()
          if (inline) remarks.push(inline)
        }
        continue
      }
      const m = b.text!.match(/^รหัสเอกสาร\s*[:：]\s*(.+)$/)
      if (m && !docNumberFromText) docNumberFromText = m[1]!.trim()
      if (current === 'agenda') agenda.push(stripNumbering(b.text!))
      else if (current === 'remarks') remarks.push(b.text!)
      continue
    }

    const table = b.table!
    const section: SectionId | null = current
    if (section === 'meeting_info' || (section === null && table.every((r) => r.length === 2))) {
      applyLabelPairs(labelValuePairs(table), MEETING_INFO_LABELS, info)
      if (section === null) seen.add('meeting_info')
    } else if (section === 'next_meeting') {
      applyLabelPairs(labelValuePairs(table), NEXT_MEETING_LABELS, next)
    } else if (section === 'attendees' || section === 'decisions' || section === 'action_items' || section === 'approval') {
      const rows = readDataTable(table, tableDef(section))
      if (rows.length > 0) parsedTables[section] = [...(parsedTables[section] ?? []), ...rows]
    } else if (section === 'agenda') {
      // ไฟล์บางแบบใส่วาระเป็นตาราง (คอลัมน์ ลำดับ | วาระ) — เก็บทุกเซลล์ข้อความยาวสุดของแถวเป็น 1 รายการ
      for (const r of table.slice(1)) {
        const cell = [...r].sort((x, y) => y.length - x.length)[0]?.trim()
        if (cell) agenda.push(stripNumbering(cell))
      }
    }
  }

  data.fields.meeting_info = info
  data.fields.next_meeting = next
  if (agenda.length > 0) data.lists.agenda = agenda
  if (remarks.length > 0) data.fields.remarks = { remarks: remarks.join('\n\n') }
  for (const key of ['attendees', 'decisions', 'action_items', 'approval'] as const) {
    if (parsedTables[key]?.length) data.tables[key] = parsedTables[key]!
  }
  if (!info.document_no && docNumberFromText) info.document_no = docNumberFromText

  const missing: SectionId[] = (['meeting_info', 'attendees', 'agenda', 'decisions', 'action_items'] as SectionId[]).filter((id) => !seen.has(id))
  for (const id of missing) warnings.push(`ไม่พบหัวข้อ "${SECTION_LABEL[id]}" ในไฟล์ — ส่วนนี้จะเว้นว่างไว้ให้กรอกเอง`)
  if (!info.subject) warnings.push('อ่านหัวข้อการประชุมไม่ได้ — กรุณาตั้งชื่อเอกสารเอง')

  return {
    data,
    docNumber: info.document_no || null,
    subject: info.subject || null,
    warnings,
    counts: {
      attendees: parsedTables.attendees?.length ?? 0,
      agenda: agenda.length,
      decisions: parsedTables.decisions?.length ?? 0,
      actionItems: parsedTables.action_items?.length ?? 0,
      approvals: parsedTables.approval?.length ?? 0,
    },
  }
}

const NAME_PREFIX_RE = /^(คุณ|พี่|น้อง|นาย|นางสาว|นาง|นส\.?|ดร\.?)\s*/

/** จับคู่ชื่อผู้รับผิดชอบในไฟล์ ("คุณอาร์ม") กับชื่อผู้ใช้จริงในระบบ ("อาร์ม") — จับไม่ได้คงข้อความเดิมไว้ (ไม่เดา) */
export function matchMemberNames(data: TemplateData, userNames: string[]): TemplateData {
  const byKey = new Map(userNames.map((n) => [n.replace(NAME_PREFIX_RE, '').trim().toLowerCase(), n]))
  const out: TemplateData = { fields: data.fields, lists: data.lists, tables: {} }
  for (const [sectionId, rows] of Object.entries(data.tables)) {
    const def = MOM_TEMPLATE.sections.find((s) => s.id === sectionId && s.kind === 'table')
    const memberKeys = def && def.kind === 'table' ? def.columns.filter((c) => c.type === 'member').map((c) => c.key) : []
    out.tables[sectionId] = rows.map((row) => {
      if (memberKeys.length === 0) return row
      const next = { ...row }
      for (const k of memberKeys) {
        const raw = (row[k] ?? '').trim()
        if (!raw) continue
        const key = raw.replace(NAME_PREFIX_RE, '').trim().toLowerCase()
        next[k] = byKey.get(key) ?? raw
      }
      return next
    })
  }
  return out
}
