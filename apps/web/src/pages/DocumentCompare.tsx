import { getDocTemplate, type TemplateData } from '@seedoffice/core'
import { diffArrays, diffWords } from 'diff'
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

type ChangeKind = 'added' | 'removed' | 'modified'
interface ChangeRow {
  key: string
  label: string
  kind: ChangeKind
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

/** เทียบ TemplateData ทีละ field/แถวตาราง/รายการ — คืนเฉพาะรายการที่ต่างกัน (added/removed/modified) */
function diffTemplateData(older: TemplateData, newer: TemplateData, templateType: string | null): ChangeRow[] {
  const def = templateType ? getDocTemplate(templateType) : undefined
  const rows: ChangeRow[] = []
  if (!def) return rows
  for (const section of def.sections) {
    if (section.kind === 'fields') {
      for (const f of section.fields) {
        const a = older.fields[section.id]?.[f.key] ?? ''
        const b = newer.fields[section.id]?.[f.key] ?? ''
        if (a === b) continue
        rows.push({
          key: `${section.id}.${f.key}`,
          label: `${section.title} › ${f.label}`,
          kind: !a ? 'added' : !b ? 'removed' : 'modified',
          oldText: a || null,
          newText: b || null,
        })
      }
    } else if (section.kind === 'table') {
      const rowsA = older.tables[section.id] ?? []
      const rowsB = newer.tables[section.id] ?? []
      const max = Math.max(rowsA.length, rowsB.length)
      for (let i = 0; i < max; i++) {
        const ra = rowsA[i]
        const rb = rowsB[i]
        for (const col of section.columns) {
          const a = ra?.[col.key] ?? ''
          const b = rb?.[col.key] ?? ''
          if (a === b) continue
          rows.push({
            key: `${section.id}.${i}.${col.key}`,
            label: `${section.title} › แถว ${i + 1} · ${col.label}`,
            kind: !ra ? 'added' : !rb ? 'removed' : !a ? 'added' : !b ? 'removed' : 'modified',
            oldText: ra ? a || null : null,
            newText: rb ? b || null : null,
          })
        }
      }
    } else {
      const itemsA = older.lists[section.id] ?? []
      const itemsB = newer.lists[section.id] ?? []
      const parts = diffArrays(itemsA, itemsB)
      let idx = 0
      for (const part of parts) {
        if (!part.added && !part.removed) { idx += part.value.length; continue }
        for (const v of part.value) {
          rows.push({ key: `${section.id}.${idx}`, label: `${section.title} › รายการ`, kind: part.added ? 'added' : 'removed', oldText: part.removed ? v : null, newText: part.added ? v : null })
          idx++
        }
      }
    }
  }
  return rows
}

/** เทียบ paragraph array (เอกสารที่อัปโหลด ไม่มีโครงสร้าง TemplateData) — จับคู่ removed+added ติดกัน 1:1 เป็น "modified" ที่เหลือเป็น added/removed ล้วน */
function diffParagraphs(older: string[], newer: string[]): ChangeRow[] {
  const parts = diffArrays(older, newer)
  const rows: ChangeRow[] = []
  let n = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (!part.added && !part.removed) continue
    if (part.removed && parts[i + 1]?.added) {
      const added = parts[i + 1]!.value
      const removed = part.value
      const pairs = Math.min(removed.length, added.length)
      for (let j = 0; j < pairs; j++) rows.push({ key: `p${n++}`, label: 'ย่อหน้า', kind: 'modified', oldText: removed[j]!, newText: added[j]! })
      for (let j = pairs; j < removed.length; j++) rows.push({ key: `p${n++}`, label: 'ย่อหน้า', kind: 'removed', oldText: removed[j]!, newText: null })
      for (let j = pairs; j < added.length; j++) rows.push({ key: `p${n++}`, label: 'ย่อหน้า', kind: 'added', oldText: null, newText: added[j]! })
      i++ // ข้าม part ที่จับคู่ไปแล้ว
      continue
    }
    for (const v of part.value) rows.push({ key: `p${n++}`, label: 'ย่อหน้า', kind: part.added ? 'added' : 'removed', oldText: part.removed ? v : null, newText: part.added ? v : null })
  }
  return rows
}

/** ไฮไลต์คำที่ต่าง (เหลือง=แก้, แดงขีดทับ=ลบ เฉพาะฝั่ง old, เขียว=เพิ่ม เฉพาะฝั่ง new) */
function InlineDiff({ oldText, newText, side }: { oldText: string; newText: string; side: 'old' | 'new' }) {
  const parts = diffWords(oldText, newText)
  return (
    <>
      {parts
        .filter((p) => (side === 'old' ? !p.added : !p.removed))
        .map((p, i) => (
          <span key={i} className={p.added ? 'bg-success-100 text-success-800' : p.removed ? 'bg-danger-100 text-danger-700 line-through' : ''}>
            {p.value}
          </span>
        ))}
    </>
  )
}

function ChangeRowView({ row }: { row: ChangeRow }) {
  const badgeCls = row.kind === 'added' ? 'bg-success-100 text-success-700' : row.kind === 'removed' ? 'bg-danger-100 text-danger-700' : 'bg-warning-100 text-warning-800'
  const badgeLabel = row.kind === 'added' ? 'เพิ่ม' : row.kind === 'removed' ? 'ลบ' : 'แก้ไข'
  return (
    <div className="border border-border-subtle rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-hover/60 border-b border-border-subtle">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badgeCls}`}>{badgeLabel}</span>
        <span className="text-xs text-muted truncate">{row.label}</span>
      </div>
      <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border-subtle">
        <div className="px-3 py-2 text-sm whitespace-pre-line bg-danger-50/30 min-h-10">
          {row.oldText == null ? <span className="text-muted italic">— ไม่มี —</span> : row.kind === 'modified' && row.newText != null ? <InlineDiff oldText={row.oldText} newText={row.newText} side="old" /> : <span className="line-through text-danger-700">{row.oldText}</span>}
        </div>
        <div className="px-3 py-2 text-sm whitespace-pre-line bg-success-50/30 min-h-10">
          {row.newText == null ? <span className="text-muted italic">— ไม่มี —</span> : row.kind === 'modified' && row.oldText != null ? <InlineDiff oldText={row.oldText} newText={row.newText} side="new" /> : <span className="text-success-800">{row.newText}</span>}
        </div>
      </div>
    </div>
  )
}

/** Tasknista §Document Diff — หน้าเปรียบเทียบ 2 เวอร์ชันของเอกสารประเภทเดียวกัน (GitHub-style) — เก่าซ้าย/ใหม่ขวา แสดงเฉพาะจุดที่ต่างกัน */
export function DocumentComparePage() {
  const [params] = useSearchParams()
  const idA = params.get('a')
  const idB = params.get('b')

  const { data, loading, error } = useLoad(async () => {
    if (!idA || !idB) throw new Error('missing_ids')
    const [docA, docB] = await Promise.all([api.get<DocDetail>(`/api/docs/${idA}`), api.get<DocDetail>(`/api/docs/${idB}`)])
    const older = isNewer(docA, docB) ? docA : docB
    const newer = older.id === docA.id ? docB : docA
    let changes: ChangeRow[]
    if (older.kind === 'template' && newer.kind === 'template' && older.templateData && newer.templateData) {
      changes = diffTemplateData(older.templateData, newer.templateData, older.templateType ?? newer.templateType)
    } else {
      const [pa, pb] = await Promise.all([
        api.get<{ paragraphs: string[] }>(`/api/docs/${older.id}/text-content`),
        api.get<{ paragraphs: string[] }>(`/api/docs/${newer.id}/text-content`),
      ])
      changes = diffParagraphs(pa.paragraphs, pb.paragraphs)
    }
    return { older, newer, changes }
  }, [idA, idB])

  return (
    <>
      <PageHeader title="เปรียบเทียบเอกสาร" />
      <div className="p-3 sm:p-6">
        {!idA || !idB ? (
          <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-danger-600">ต้องระบุเอกสาร 2 ฉบับที่จะเปรียบเทียบ</div>
        ) : loading ? (
          <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-muted">กำลังโหลด…</div>
        ) : error || !data ? (
          <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-danger-600">โหลดเอกสารไม่สำเร็จ</div>
        ) : (
          <>
            <div className="bg-white rounded-lg shadow-xs p-4 mb-4 grid sm:grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] text-muted mb-0.5">เวอร์ชันเก่า (ซ้าย)</div>
                <div className="text-sm font-medium text-body">{data.older.title} <span className="text-muted font-mono">· v{(data.older.docVersion ?? '—').replace(/^v/i, '')}</span></div>
              </div>
              <div>
                <div className="text-[11px] text-muted mb-0.5">เวอร์ชันใหม่ (ขวา)</div>
                <div className="text-sm font-medium text-body">{data.newer.title} <span className="text-muted font-mono">· v{(data.newer.docVersion ?? '—').replace(/^v/i, '')}</span></div>
              </div>
            </div>

            {data.changes.length === 0 ? (
              <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-muted">ไม่พบความแตกต่างระหว่าง 2 เวอร์ชันนี้</div>
            ) : (
              <div className="space-y-2">
                {data.changes.map((row) => <ChangeRowView key={row.key} row={row} />)}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
