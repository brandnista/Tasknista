/**
 * Pronista §Second Brain (2026-09-08) — ตารางความรู้ที่ดักจับจาก LINE group อัตโนมัติ + คีย์เองได้ (Phase 1: เก็บอย่างเดียว ไม่มี AI สรุป)
 * §Second Brain Manual/Table (2026-09-08) — 2 ประเภท: 'article' (ลิงก์+note แก้ไขได้) กับ 'solution' (ปัญหาที่พบ+วิธีแก้ไข)
 */
import { BrainCircuit, ExternalLink, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useDialog } from '../components/Dialog'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'

type Kind = 'article' | 'solution'

interface SecondBrainLinkRow {
  id: string
  kind: Kind
  source: 'line' | 'manual'
  url: string | null
  note: string | null
  problem: string | null
  solutionText: string | null
  senderDisplayName: string | null
  creatorName: string | null
  capturedAt: number
}

const KIND_LABEL: Record<Kind, string> = { article: 'บทความ', solution: 'Solution' }
const shortDate = (ms: number) => new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
const sharerOf = (r: SecondBrainLinkRow) => (r.source === 'manual' ? (r.creatorName ?? '—') : (r.senderDisplayName ?? 'ไม่ทราบชื่อผู้ส่ง'))

/** เซลล์แก้ไขได้อินไลน์ — คลิกเพื่อพิมพ์ทับ, Enter/blur = บันทึก, Escape = ยกเลิก */
function EditableCell({ value, placeholder, onSave }: { value: string; placeholder: string; onSave: (v: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const commit = async () => {
    if (draft === value) return setEditing(false)
    setBusy(true)
    try {
      await onSave(draft)
    } finally {
      setBusy(false)
      setEditing(false)
    }
  }

  if (!editing) {
    return (
      <div
        onClick={() => setEditing(true)}
        className="cursor-text text-sm text-body whitespace-pre-wrap hover:bg-hover rounded px-1.5 py-1 -mx-1.5 min-h-7"
      >
        {value || <span className="text-muted italic">{placeholder}</span>}
      </div>
    )
  }
  return (
    <textarea
      autoFocus
      rows={2}
      value={draft}
      disabled={busy}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setDraft(value)
          setEditing(false)
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          void commit()
        }
      }}
      className="w-full text-sm bg-white shadow-xs rounded px-1.5 py-1 -mx-1.5 focus:outline-hidden focus:ring-2 focus:ring-brand-200 resize-none"
    />
  )
}

/** เนื้อหาของแถว ปรับตาม kind — article: ลิงก์+note / solution: ปัญหาที่พบ+วิธีแก้ไข (ใช้ร่วมกันทั้งตาราง desktop และการ์ด mobile) */
function RowContent({ row, onPatch }: { row: SecondBrainLinkRow; onPatch: (patch: Record<string, string>) => Promise<void> }) {
  if (row.kind === 'solution') {
    return (
      <div className="space-y-1.5">
        <div>
          <label className="text-[11px] text-muted">ปัญหาที่พบ</label>
          <EditableCell value={row.problem ?? ''} placeholder="— คลิกเพื่อกรอกปัญหาที่พบ —" onSave={(v) => onPatch({ problem: v })} />
        </div>
        <div>
          <label className="text-[11px] text-muted">วิธีแก้ไข</label>
          <EditableCell value={row.solutionText ?? ''} placeholder="— คลิกเพื่อกรอกวิธีแก้ไข —" onSave={(v) => onPatch({ solutionText: v })} />
        </div>
      </div>
    )
  }
  return (
    <div>
      {row.url && (
        <a href={row.url} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:underline break-all inline-flex items-center gap-1.5">
          {row.url}
          <ExternalLink className="w-3 h-3 shrink-0" />
        </a>
      )}
      <EditableCell value={row.note ?? ''} placeholder="— คลิกเพื่อเพิ่มโน้ต —" onSave={(v) => onPatch({ note: v })} />
    </div>
  )
}

function AddItemModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [kind, setKind] = useState<Kind>('article')
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState('')
  const [solutionText, setSolutionText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    if (kind === 'article' && !url.trim()) return setError('ใส่ลิงก์')
    if (kind === 'solution' && (!problem.trim() || !solutionText.trim())) return setError('ใส่ปัญหาที่พบและวิธีแก้ไขให้ครบ')
    setBusy(true)
    try {
      const payload =
        kind === 'article'
          ? { kind, url: url.trim(), ...(note.trim() ? { note: note.trim() } : {}) }
          : { kind, problem: problem.trim(), solutionText: solutionText.trim() }
      await api.post('/api/second-brain/links', payload)
      toast('เพิ่มรายการแล้ว')
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full text-sm bg-hover rounded-lg px-3 py-2 focus:outline-hidden'
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
          <span className="font-semibold text-ink text-sm">เพิ่มรายการ</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-hover text-dim">✕</button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-[11px] text-muted block mb-0.5">ประเภท</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={input}>
              <option value="article">บทความ (ลิงก์)</option>
              <option value="solution">Solution (ปัญหา/วิธีแก้)</option>
            </select>
          </div>
          {kind === 'article' ? (
            <>
              <div>
                <label className="text-[11px] text-muted block mb-0.5">ลิงก์</label>
                <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className={input} />
              </div>
              <div>
                <label className="text-[11px] text-muted block mb-0.5">โน้ต (ถ้ามี)</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={input} />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-[11px] text-muted block mb-0.5">ปัญหาที่พบ</label>
                <textarea autoFocus value={problem} onChange={(e) => setProblem(e.target.value)} rows={2} className={input} />
              </div>
              <div>
                <label className="text-[11px] text-muted block mb-0.5">วิธีแก้ไข</label>
                <textarea value={solutionText} onChange={(e) => setSolutionText(e.target.value)} rows={2} className={input} />
              </div>
            </>
          )}
          {error && <div className="text-xs text-danger-600">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-subtle shrink-0">
          <button onClick={onClose} className="text-sm px-3.5 py-2 rounded-lg text-soft hover:bg-hover">ยกเลิก</button>
          <button onClick={() => void submit()} disabled={busy} className="text-sm font-medium text-white px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40">
            เพิ่มรายการ
          </button>
        </div>
      </div>
    </div>
  )
}

export function SecondBrainPage() {
  const { confirmDialog, alertDialog } = useDialog()
  const { data, reload } = useLoad<SecondBrainLinkRow[]>(() => api.get('/api/second-brain/links'))
  const [addOpen, setAddOpen] = useState(false)
  const [kindFilter, setKindFilter] = useState<'all' | Kind>('all')
  const rows = data ?? []
  const filtered = useMemo(() => (kindFilter === 'all' ? rows : rows.filter((r) => r.kind === kindFilter)), [rows, kindFilter])

  const patch = async (id: string, body: Record<string, string>) => {
    try {
      await api.patch(`/api/second-brain/links/${id}`, body)
      void reload()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ' })
    }
  }

  const remove = async (row: SecondBrainLinkRow) => {
    if (!(await confirmDialog({ title: 'ลบรายการนี้?', message: row.url ?? row.problem ?? '', danger: true, confirmLabel: 'ลบ' }))) return
    try {
      await api.delete(`/api/second-brain/links/${row.id}`)
      void reload()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'ลบไม่สำเร็จ' })
    }
  }

  return (
    <>
      <PageHeader
        title="Second Brain"
        action={
          <button onClick={() => setAddOpen(true)} className="text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> เพิ่มรายการ
          </button>
        }
      />
      <div className="p-4 sm:p-6">
        {!data ? (
          <div className="text-center text-sm text-muted py-10">กำลังโหลด…</div>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-lg shadow-xs text-center text-sm text-muted py-14">
            <BrainCircuit className="w-8 h-8 mx-auto mb-2 text-border" />
            ยังไม่มีรายการ — แชร์ลิงก์ในห้องแชท LINE ที่ตั้งค่าไว้ให้ระบบดึงมาเก็บอัตโนมัติ หรือกด "เพิ่มรายการ" เพื่อคีย์เอง
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-4">
              <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as 'all' | Kind)} className="text-sm bg-white shadow-xs rounded-lg px-3 py-2 focus:outline-hidden">
                <option value="all">ทุกประเภท</option>
                <option value="article">{KIND_LABEL.article}</option>
                <option value="solution">{KIND_LABEL.solution}</option>
              </select>
              <span className="text-xs text-muted">{filtered.length} รายการ</span>
            </div>
            {filtered.length === 0 ? (
              <div className="bg-white rounded-lg shadow-xs text-center text-sm text-muted py-14">ไม่มีรายการตรงตัวกรองที่เลือก</div>
            ) : (
          <div className="bg-white rounded-lg shadow-xs overflow-hidden">
            {/* Pronista §Mobile responsive — ตารางคงเดิมบน sm+ ขึ้นไป, มือถือใช้การ์ดแทน */}
            <table className="hidden sm:table w-full text-sm" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '12%' }} />
                <col style={{ width: '58%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '8%' }} />
              </colgroup>
              <thead>
                <tr className="bg-hover text-[11px] text-muted uppercase tracking-wide">
                  <th className="text-left font-semibold px-3 py-2">วันที่แชร์</th>
                  <th className="text-left font-semibold px-3 py-2">เนื้อหา</th>
                  <th className="text-left font-semibold px-3 py-2">คนที่แชร่</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2.5 text-[11px] text-muted align-top">{shortDate(r.capturedAt)}</td>
                    <td className="px-3 py-2.5 align-top">
                      <RowContent row={r} onPatch={(p) => patch(r.id, p)} />
                    </td>
                    <td className="px-3 py-2.5 text-muted align-top">{sharerOf(r)}</td>
                    <td className="px-3 py-2.5 align-top text-right">
                      <button onClick={() => void remove(r)} className="text-muted hover:text-danger-600 p-1" title="ลบ">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sm:hidden divide-y divide-divider">
              {filtered.map((r) => (
                <div key={r.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="text-[11px] text-muted">
                      {shortDate(r.capturedAt)} · {sharerOf(r)}
                    </div>
                    <button onClick={() => void remove(r)} className="text-muted hover:text-danger-600 shrink-0 p-1" title="ลบ">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <RowContent row={r} onPatch={(p) => patch(r.id, p)} />
                </div>
              ))}
            </div>
          </div>
            )}
          </>
        )}
      </div>
      {addOpen && <AddItemModal onClose={() => setAddOpen(false)} onDone={() => { setAddOpen(false); void reload() }} />}
    </>
  )
}
