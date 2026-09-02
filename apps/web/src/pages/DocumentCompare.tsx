import { getDocTemplate, type TemplateData } from '@seedoffice/core'
import { diffArrays, diffWords } from 'diff'
import { ChevronDown, ChevronUp, Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '../components/PageHeader'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'

interface DocDetail {
  id: string
  title: string
  kind: string
  docType: string | null
  docVersion: string | null
  templateType: string | null
  createdAt: string
  templateData: TemplateData | null
}

type CellKind = 'same' | 'added' | 'removed' | 'modified'
/** หน่วยเนื้อหาที่เล็กที่สุดของการ diff — ย่อหน้าเดียว, field เดียว, cell เดียวในตาราง, หรือ list item เดียว */
interface DiffCell {
  key: string
  kind: CellKind
  oldText: string | null
  newText: string | null
}

const parseVersionParts = (v: string | null) => (v ?? '0').replace(/^v/i, '').split('.').map((n) => Number(n) || 0)
/** true ถ้า b ใหม่กว่า a (เทียบ docVersion แบบ semver ง่ายๆ ก่อน แล้ว fallback ไปวันที่สร้าง) */
function isNewer(a: DocDetail, b: DocDetail): boolean {
  const pa = parseVersionParts(a.docVersion)
  const pb = parseVersionParts(b.docVersion)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return new Date(b.createdAt).getTime() > new Date(a.createdAt).getTime()
}

const cellKindOf = (a: string, b: string): CellKind => (a === b ? 'same' : !a ? 'added' : !b ? 'removed' : 'modified')

// ---------- โหมดเอกสารมีโครงสร้าง (template: MOM/BRD/SOW/...) ----------
interface FieldsFlowSection { kind: 'fields'; id: string; title: string; rows: DiffCell[] }
interface TableFlowSection { kind: 'table'; id: string; title: string; columns: { key: string; label: string }[]; rows: DiffCell[][] }
interface ListFlowSection { kind: 'list'; id: string; title: string; items: DiffCell[] }
type TemplateFlowSection = FieldsFlowSection | TableFlowSection | ListFlowSection

/** สร้างโครงเอกสารเต็มทุกหัวข้อ/ทุกฟิลด์ (ไม่ใช่แค่จุดที่ต่าง) พร้อม kind ต่อจุด — ใช้ render เป็นเอกสารไหลเดียวทับของเดิมได้เลย */
function buildTemplateFlow(older: TemplateData, newer: TemplateData, templateType: string | null): TemplateFlowSection[] {
  const def = templateType ? getDocTemplate(templateType) : undefined
  if (!def) return []
  return def.sections.map((section): TemplateFlowSection => {
    if (section.kind === 'fields') {
      return {
        kind: 'fields',
        id: section.id,
        title: section.title,
        rows: section.fields.map((f) => {
          const a = older.fields[section.id]?.[f.key] ?? ''
          const b = newer.fields[section.id]?.[f.key] ?? ''
          return { key: `${section.id}.${f.key}`, kind: cellKindOf(a, b), oldText: a || null, newText: b || null }
        }),
      }
    }
    if (section.kind === 'table') {
      const rowsA = older.tables[section.id] ?? []
      const rowsB = newer.tables[section.id] ?? []
      const max = Math.max(rowsA.length, rowsB.length)
      const rows: DiffCell[][] = []
      for (let i = 0; i < max; i++) {
        const ra = rowsA[i]
        const rb = rowsB[i]
        rows.push(
          section.columns.map((col) => {
            const a = ra?.[col.key] ?? ''
            const b = rb?.[col.key] ?? ''
            const kind: CellKind = !ra ? 'added' : !rb ? 'removed' : cellKindOf(a, b)
            return { key: `${section.id}.${i}.${col.key}`, kind, oldText: ra ? a || null : null, newText: rb ? b || null : null }
          }),
        )
      }
      return { kind: 'table', id: section.id, title: section.title, columns: section.columns.map((c) => ({ key: c.key, label: c.label })), rows }
    }
    const itemsA = older.lists[section.id] ?? []
    const itemsB = newer.lists[section.id] ?? []
    const parts = diffArrays(itemsA, itemsB)
    const items: DiffCell[] = []
    let n = 0
    for (const part of parts) {
      if (!part.added && !part.removed) { for (const v of part.value) items.push({ key: `${section.id}.${n++}`, kind: 'same', oldText: v, newText: v }); continue }
      for (const v of part.value) items.push({ key: `${section.id}.${n++}`, kind: part.added ? 'added' : 'removed', oldText: part.removed ? v : null, newText: part.added ? v : null })
    }
    return { kind: 'list', id: section.id, title: section.title, items }
  })
}

// ---------- โหมดเอกสารอัปโหลด (paragraph array ไม่มีโครงสร้าง) ----------
/** เทียบ paragraph array ทั้งเอกสาร — คืน "ทุกย่อหน้า" เรียงตามลำดับเดิม (same ก็มี) ไม่ใช่แค่จุดที่ต่าง เพื่อ render เป็นเอกสารไหลเดียวได้ */
function buildParagraphFlow(older: string[], newer: string[]): DiffCell[] {
  const parts = diffArrays(older, newer)
  const flow: DiffCell[] = []
  let n = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (!part.added && !part.removed) {
      for (const v of part.value) flow.push({ key: `p${n++}`, kind: 'same', oldText: v, newText: v })
      continue
    }
    if (part.removed && parts[i + 1]?.added) {
      const added = parts[i + 1]!.value
      const removed = part.value
      const pairs = Math.min(removed.length, added.length)
      for (let j = 0; j < pairs; j++) flow.push({ key: `p${n++}`, kind: 'modified', oldText: removed[j]!, newText: added[j]! })
      for (let j = pairs; j < removed.length; j++) flow.push({ key: `p${n++}`, kind: 'removed', oldText: removed[j]!, newText: null })
      for (let j = pairs; j < added.length; j++) flow.push({ key: `p${n++}`, kind: 'added', oldText: null, newText: added[j]! })
      i++ // ข้าม part ที่จับคู่ไปแล้ว
      continue
    }
    for (const v of part.value) flow.push({ key: `p${n++}`, kind: part.added ? 'added' : 'removed', oldText: part.removed ? v : null, newText: part.added ? v : null })
  }
  return flow
}

// ---------- render: Side-by-Side split view (Pronista §Document Diff side-by-side 2026-09-02 — กลับไปใช้ 2 คอลัมน์ซ้าย-ขวาแบบ GitHub ตามสเปกใหม่
// เดิม (2026-09-01) เคยตัดสินใจใช้ "เอกสารไหลเดียว" (Word Track Changes style) แทน side-by-side เพราะรู้ตำแหน่ง/บรรทัดตรงกว่า
// ตอนนี้พี่ขอ split view ตาม reference GitHub ชัดเจน — คง data model เดิม (DiffCell/TemplateFlowSection) ไว้ทั้งหมด เปลี่ยนแค่ชั้น render เป็น 2 คอลัมน์
// ใช้ <table> จริง (ไม่ใช่ flex/grid) ให้ browser จัดความสูงแถวซ้าย-ขวาเท่ากันเองต่อแถว กันปัญหาคอลัมน์เบี้ยว (เหมือน DocumentHistoryTable) ----------
const AddMark = ({ children }: { children: React.ReactNode }) => <mark className="bg-success-100 text-success-800 rounded px-0.5 underline decoration-success-600 decoration-2 font-medium">{children}</mark>
const DelMark = ({ children }: { children: React.ReactNode }) => <mark className="bg-danger-100 text-danger-700 rounded px-0.5 line-through decoration-danger-600">{children}</mark>

/** เนื้อหาฝั่งเดียว (old=คอลัมน์ซ้าย, new=คอลัมน์ขวา) ของ cell หนึ่ง
 * same=ข้อความปกติทั้งคู่ · added=โชว์เฉพาะฝั่งใหม่ (เขียว) ฝั่งเก่าว่าง · removed=โชว์เฉพาะฝั่งเก่า (แดง) ฝั่งใหม่ว่าง · modified=word-diff แยกฝั่ง (ลบสีแดงอยู่ฝั่งเก่า, เพิ่มสีเขียวอยู่ฝั่งใหม่) */
function DiffCellSide({ cell, side }: { cell: DiffCell; side: 'old' | 'new' }) {
  if (cell.kind === 'same') return <>{side === 'old' ? cell.oldText : cell.newText}</>
  if (cell.kind === 'added') return side === 'new' ? <AddMark>{cell.newText}</AddMark> : null
  if (cell.kind === 'removed') return side === 'old' ? <DelMark>{cell.oldText}</DelMark> : null
  // modified — diffWords ตัดคำด้วยช่องว่าง ภาษาไทยไม่มีช่องว่างระหว่างคำ พอข้อความเปลี่ยนไปเยอะจะไปจับตัวอักษรที่บังเอิญซ้ำกันแล้วสลับสีมั่วอ่านไม่ออก
  // ถ้าส่วนที่เหมือนกันจริงน้อยกว่าเกณฑ์ ให้ตัดทั้งท่อนแทน (ฝั่งเก่าแดงทั้งท่อน/ฝั่งใหม่เขียวทั้งท่อน) ดีกว่า
  const oldText = cell.oldText ?? ''
  const newText = cell.newText ?? ''
  const parts = diffWords(oldText, newText)
  const unchangedLen = parts.filter((p) => !p.added && !p.removed).reduce((s, p) => s + p.value.length, 0)
  const totalLen = oldText.length + newText.length
  if (totalLen > 0 && (unchangedLen * 2) / totalLen < 0.35) return side === 'old' ? <DelMark>{oldText}</DelMark> : <AddMark>{newText}</AddMark>
  if (side === 'old') return <>{parts.filter((p) => !p.added).map((p, i) => (p.removed ? <DelMark key={i}>{p.value}</DelMark> : <span key={i}>{p.value}</span>))}</>
  return <>{parts.filter((p) => !p.removed).map((p, i) => (p.added ? <AddMark key={i}>{p.value}</AddMark> : <span key={i}>{p.value}</span>))}</>
}

/** สีพื้นหลังกล่องต่อฝั่ง — ฝั่งที่ "ไม่มีเนื้อหา" (เช่น added → ฝั่งเก่า, removed → ฝั่งใหม่) ทาสีเทาอ่อนเป็น gutter ว่างให้เห็นชัดว่าไม่มีบรรทัดนี้ */
function sideBgCls(cell: DiffCell, side: 'old' | 'new'): string {
  if (cell.kind === 'same') return ''
  if (cell.kind === 'added') return side === 'new' ? 'bg-success-50' : 'bg-hover/60'
  if (cell.kind === 'removed') return side === 'old' ? 'bg-danger-50' : 'bg-hover/60'
  return side === 'old' ? 'bg-danger-50/50' : 'bg-success-50/50' // modified
}

const changeRingCls = (active: boolean) => (active ? 'outline outline-2 outline-brand-400 outline-offset-4 rounded' : '')

/** หัวคอลัมน์ "เวอร์ชันเก่า/เวอร์ชันใหม่" ใช้ซ้ำได้ทั้ง paragraph/fields/list mode (ตารางแบบ 2 คอลัมน์) */
function SplitColHeader({ leftLabel = 'เวอร์ชันเก่า', rightLabel = 'เวอร์ชันใหม่' }: { leftLabel?: string; rightLabel?: string }) {
  return (
    <thead>
      <tr>
        <th className="border border-border-subtle px-3 py-1.5 bg-hover text-left text-[11px] font-medium text-muted w-1/2">{leftLabel}</th>
        <th className="border border-border-subtle px-3 py-1.5 bg-hover text-left text-[11px] font-medium text-muted w-1/2">{rightLabel}</th>
      </tr>
    </thead>
  )
}

function ParagraphDocView({ flow, activeId }: { flow: DiffCell[]; activeId: string | null }) {
  return (
    <div className="bg-white rounded-xl shadow-xs overflow-hidden">
      <table className="w-full border-collapse table-fixed text-sm leading-[1.9] text-body">
        <SplitColHeader />
        <tbody>
          {flow.map((cell) => (
            <tr key={cell.key} id={cell.kind !== 'same' ? `diff-${cell.key}` : undefined} className={cell.kind !== 'same' ? changeRingCls(activeId === cell.key) : ''}>
              <td className={`border border-border-subtle px-4 sm:px-6 py-2.5 align-top whitespace-pre-line ${sideBgCls(cell, 'old')}`}><DiffCellSide cell={cell} side="old" /></td>
              <td className={`border border-border-subtle px-4 sm:px-6 py-2.5 align-top whitespace-pre-line ${sideBgCls(cell, 'new')}`}><DiffCellSide cell={cell} side="new" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TemplateDocView({ sections, activeId }: { sections: TemplateFlowSection[]; activeId: string | null }) {
  const cellTd = 'border border-border-subtle px-3 py-2 align-top text-sm'
  return (
    <div className="bg-white rounded-xl shadow-xs px-4 sm:px-8 py-8 text-sm text-body">
      {sections.map((section) => (
        <div key={section.id} className="mb-8">
          <h3 className="text-sm font-semibold text-ink pb-2 mb-3 border-b-2 border-brand-200">{section.title}</h3>
          {section.kind === 'fields' && (
            <table className="w-full border-collapse table-fixed">
              <thead>
                <tr>
                  <th className={`${cellTd} bg-hover text-left text-[11px] font-medium text-muted w-1/4`}>ฟิลด์</th>
                  <th className={`${cellTd} bg-hover text-left text-[11px] font-medium text-muted w-[37.5%]`}>เวอร์ชันเก่า</th>
                  <th className={`${cellTd} bg-hover text-left text-[11px] font-medium text-muted w-[37.5%]`}>เวอร์ชันใหม่</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((r) => (
                  <tr key={r.key} id={r.kind !== 'same' ? `diff-${r.key}` : undefined} className={r.kind !== 'same' ? changeRingCls(activeId === r.key) : ''}>
                    <td className={`${cellTd} bg-hover font-medium text-strong`}>{r.key.split('.').slice(1).join('.')}</td>
                    <td className={`${cellTd} whitespace-pre-line ${sideBgCls(r, 'old')}`}><DiffCellSide cell={r} side="old" /></td>
                    <td className={`${cellTd} whitespace-pre-line ${sideBgCls(r, 'new')}`}><DiffCellSide cell={r} side="new" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {section.kind === 'table' &&
            (() => {
              // ตารางมีหลายคอลัมน์ของตัวเองอยู่แล้ว (เช่น No/Item/Qty/Price) — วางเป็น 2 ตารางเต็มรูปแบบซ้าย-ขวาแทนการยัดคอลัมน์ซ้อนในแถวเดียว
              // แถวที่ "ถูกเพิ่มทั้งแถว" (ทุก cell kind=added) ไม่โชว์ในตารางฝั่งเก่า, แถวที่ "ถูกลบทั้งแถว" ไม่โชว์ในตารางฝั่งใหม่
              const oldRows = section.rows.filter((row) => !row.every((c) => c.kind === 'added'))
              const newRows = section.rows.filter((row) => !row.every((c) => c.kind === 'removed'))
              const sideTable = (rows: DiffCell[][], side: 'old' | 'new', label: string) => (
                <div>
                  <div className="text-[11px] text-muted font-medium mb-1.5">{label}</div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>{section.columns.map((c) => <th key={c.key} className={`${cellTd} bg-hover text-left text-[11px] font-medium text-muted`}>{c.label}</th>)}</tr>
                      </thead>
                      <tbody>
                        {rows.map((row, i) => (
                          <tr key={i}>
                            {row.map((cell) => (
                              <td key={cell.key} id={cell.kind !== 'same' ? `diff-${cell.key}` : undefined} className={`${cellTd} whitespace-pre-line ${cell.kind !== 'same' ? changeRingCls(activeId === cell.key) : ''} ${sideBgCls(cell, side)}`}>
                                <DiffCellSide cell={cell} side={side} />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
              return (
                <div className="grid lg:grid-cols-2 gap-4">
                  {sideTable(oldRows, 'old', 'เวอร์ชันเก่า')}
                  {sideTable(newRows, 'new', 'เวอร์ชันใหม่')}
                </div>
              )
            })()}
          {section.kind === 'list' && (
            <table className="w-full border-collapse table-fixed">
              <SplitColHeader />
              <tbody>
                {section.items.map((item) => (
                  <tr key={item.key} id={item.kind !== 'same' ? `diff-${item.key}` : undefined} className={item.kind !== 'same' ? changeRingCls(activeId === item.key) : ''}>
                    <td className={`${cellTd} whitespace-pre-line ${sideBgCls(item, 'old')}`}><DiffCellSide cell={item} side="old" /></td>
                    <td className={`${cellTd} whitespace-pre-line ${sideBgCls(item, 'new')}`}><DiffCellSide cell={item} side="new" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  )
}

/** ป้ายเอกสารเก่า/ใหม่ + legend สี — ใช้ทั้งจอปกติและมุมมองพิมพ์ */
function CompareHeaderInfo({ older, newer }: { older: DocDetail; newer: DocDetail }) {
  return (
    <div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] text-muted mb-0.5">เวอร์ชันเก่า</div>
          <div className="text-sm font-medium text-body">{older.title} <span className="text-muted font-mono">· v{(older.docVersion ?? '—').replace(/^v/i, '')}</span></div>
        </div>
        <div>
          <div className="text-[11px] text-muted mb-0.5">เวอร์ชันใหม่</div>
          <div className="text-sm font-medium text-body">{newer.title} <span className="text-muted font-mono">· v{(newer.docVersion ?? '—').replace(/^v/i, '')}</span></div>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs text-dim mt-3 pt-3 border-t border-divider">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-danger-100 border border-danger-300 inline-block" /> ข้อความที่ถูกลบ</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-success-100 border border-success-300 inline-block" /> ข้อความที่เพิ่ม/แก้ไข</span>
      </div>
    </div>
  )
}

/** Pronista §Document Diff side-by-side (2026-09-02) — เปลี่ยนกลับมาเป็น split view 2 คอลัมน์ซ้าย(เก่า)-ขวา(ใหม่) แบบ GitHub ตามสเปกใหม่
 * (เดิม 2026-09-01 เคยเปลี่ยนเป็น "เอกสารไหลเดียว" Word Track Changes style — พี่ขอกลับมาเป็น side-by-side อีกครั้ง) */
export function DocumentComparePage() {
  const [params] = useSearchParams()
  const idA = params.get('a')
  const idB = params.get('b')
  const [currentIndex, setCurrentIndex] = useState(0)

  const { data, loading, error } = useLoad(async () => {
    if (!idA || !idB) throw new Error('missing_ids')
    const [docA, docB] = await Promise.all([api.get<DocDetail>(`/api/docs/${idA}`), api.get<DocDetail>(`/api/docs/${idB}`)])
    const older = isNewer(docA, docB) ? docA : docB
    const newer = older.id === docA.id ? docB : docA
    if (older.kind === 'template' && newer.kind === 'template' && older.templateData && newer.templateData) {
      const sections = buildTemplateFlow(older.templateData, newer.templateData, older.templateType ?? newer.templateType)
      const changeIds = sections.flatMap((s) => (s.kind === 'table' ? s.rows.flat() : s.kind === 'fields' ? s.rows : s.items).filter((c) => c.kind !== 'same').map((c) => c.key))
      return { older, newer, mode: 'template' as const, sections, paragraphs: null, changeIds }
    }
    const [pa, pb] = await Promise.all([
      api.get<{ paragraphs: string[] }>(`/api/docs/${older.id}/text-content`),
      api.get<{ paragraphs: string[] }>(`/api/docs/${newer.id}/text-content`),
    ])
    const paragraphs = buildParagraphFlow(pa.paragraphs, pb.paragraphs)
    const changeIds = paragraphs.filter((c) => c.kind !== 'same').map((c) => c.key)
    return { older, newer, mode: 'paragraph' as const, sections: null, paragraphs, changeIds }
  }, [idA, idB])

  useEffect(() => setCurrentIndex(0), [data])

  const jumpTo = (i: number) => {
    if (!data || data.changeIds.length === 0) return
    const next = ((i % data.changeIds.length) + data.changeIds.length) % data.changeIds.length
    setCurrentIndex(next)
    document.getElementById(`diff-${data.changeIds[next]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const activeId = data && data.changeIds.length > 0 ? (data.changeIds[currentIndex] ?? null) : null

  return (
    <>
      <PageHeader
        title="เปรียบเทียบเอกสาร"
        action={
          data && (
            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 text-sm text-body border border-border-subtle hover:bg-hover px-3 py-1.5 rounded-lg" title="เปิดหน้าต่าง Print ของเบราว์เซอร์ — เลือก 'Save as PDF' เพื่อได้ไฟล์ PDF">
              <Printer className="w-3.5 h-3.5" /> ดาวน์โหลด PDF
            </button>
          )
        }
      />
      <div className="p-3 sm:p-6">
        {!idA || !idB ? (
          <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-danger-600">ต้องระบุเอกสาร 2 ฉบับที่จะเปรียบเทียบ</div>
        ) : loading ? (
          <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-muted">กำลังโหลด…</div>
        ) : error || !data ? (
          <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-danger-600">โหลดเอกสารไม่สำเร็จ</div>
        ) : (
          // Pronista §Document Diff side-by-side (2026-09-02) — กว้างขึ้นจาก max-w-4xl เดิม (single-flow) เพราะ 2 คอลัมน์ต้องการที่มากกว่า
          <div className="max-w-7xl mx-auto">
            <div className="bg-white rounded-lg shadow-xs p-4 mb-4 print:hidden">
              <CompareHeaderInfo older={data.older} newer={data.newer} />
            </div>

            {data.changeIds.length === 0 ? (
              <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-muted print:hidden">ไม่พบความแตกต่างระหว่าง 2 เวอร์ชันนี้</div>
            ) : (
              <>
                <div className="print:hidden pb-16">
                  {data.mode === 'paragraph' ? <ParagraphDocView flow={data.paragraphs!} activeId={activeId} /> : <TemplateDocView sections={data.sections!} activeId={activeId} />}
                </div>
                <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 bg-white shadow-2xl border border-border-subtle rounded-full px-2 py-1.5 print:hidden">
                  <button onClick={() => jumpTo(currentIndex - 1)} title="จุดก่อนหน้า" className="w-8 h-8 grid place-items-center rounded-full text-dim hover:bg-hover hover:text-brand-700"><ChevronUp className="w-4 h-4" /></button>
                  <span className="text-xs text-muted tabular-nums px-1 w-16 text-center">จุดที่ {currentIndex + 1}/{data.changeIds.length}</span>
                  <button onClick={() => jumpTo(currentIndex + 1)} title="จุดถัดไป" className="w-8 h-8 grid place-items-center rounded-full text-dim hover:bg-hover hover:text-brand-700"><ChevronDown className="w-4 h-4" /></button>
                </div>

                {/* มุมมองพิมพ์ — เอกสารเดียวกันเป๊ะ ไม่มีปุ่ม/ไฮไลต์กรอบฟ้า (ดู @media print ใน index.css) */}
                <div className="doc-compare-print-view hidden print:block p-8 text-black text-sm">
                  <h1 className="text-xl font-bold mb-3">เปรียบเทียบเอกสาร</h1>
                  <div className="mb-6"><CompareHeaderInfo older={data.older} newer={data.newer} /></div>
                  {data.mode === 'paragraph' ? <ParagraphDocView flow={data.paragraphs!} activeId={null} /> : <TemplateDocView sections={data.sections!} activeId={null} />}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}
