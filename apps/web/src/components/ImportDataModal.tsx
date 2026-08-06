import { AlertTriangle, CheckCircle2, Download, FileText, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'

interface ImportItemPreview {
  rowNumber: number
  status: 'ok' | 'duplicate' | 'error'
  errors: string[]
  kind: 'task' | 'defect' | 'cr' | 'backlog' | null
  originCode: string | null
  parentCode: string | null
  parentRowNumber: number | null
  parentExistingTaskId: string | null
  title: string
  description: string | null
  assigneeEmail: string | null
  assigneeId: string | null
  taskStatus: string
  defectStatus: string | null
  priority: 'low' | 'normal' | 'high'
  estimateMinutes: number | null
  startDate: string | null
  dueDate: string | null
  reporterType: 'customer' | 'self' | null
  duplicateOfTaskId: string | null
  duplicateOfTitle: string | null
  resolution: 'create' | 'skip' | 'overwrite'
}
interface DocMeta {
  path: string
  filename: string
  suggestedDocType: string | null
}
interface ParseResponse {
  pendingFileKey: string
  items: ImportItemPreview[]
  documents: DocMeta[]
  summary: { ready: number; duplicate: number; error: number; documents: number }
}
interface ConfirmResponse {
  createdTaskIds: string[]
  updatedTaskIds: string[]
  skippedRowNumbers: number[]
  createdDocIds: string[]
  warnings: string[]
}

const KIND_LABEL: Record<string, string> = { task: 'Task', defect: 'Defect', cr: 'CR', backlog: 'ทั่วไป' }
const DOC_TYPE_OPTIONS = ['MOM', 'BRD', 'SOW', 'SRS', 'PEP', 'UIR', 'CR', 'API']

/**
 * Pronista §Import Data — อัปงานเข้าระบบทีเดียวจาก Excel (+ เอกสารแนบใน ZIP)
 * flow: โหลด Template → เลือกไฟล์ → พรีวิว (ตรวจ/แก้ resolution ต่อแถวที่ซ้ำ + เลือกประเภทเอกสาร) → ยืนยัน
 * ยังไม่เขียนอะไรลง DB จนกว่าจะกด "ยืนยัน" รอบสอง (เหมือน SowUploadBreakoutModal)
 */
export function ImportDataModal({ project, onClose, onImported }: { project: { id: string; code: string | null; name: string }; onClose: () => void; onImported: () => void }) {
  const [stage, setStage] = useState<'upload' | 'preview' | 'result'>('upload')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParseResponse | null>(null)
  const [items, setItems] = useState<ImportItemPreview[]>([])
  const [docTypes, setDocTypes] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ConfirmResponse | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/projects/${project.id}/import/parse`, { method: 'POST', body: fd })
      const body = (await res.json()) as ParseResponse & { message?: string }
      if (!res.ok) {
        setError(body.message ?? 'อ่านไฟล์ไม่สำเร็จ')
        return
      }
      setParsed(body)
      setItems(body.items)
      const initialDocTypes: Record<string, string> = {}
      for (const d of body.documents) if (d.suggestedDocType) initialDocTypes[d.path] = d.suggestedDocType
      setDocTypes(initialDocTypes)
      setStage('preview')
    } catch {
      setError('อัปโหลดไม่สำเร็จ — ลองใหม่อีกครั้ง')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!parsed) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${project.id}/import/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pendingFileKey: parsed.pendingFileKey, items, documentTypeOverrides: docTypes }),
      })
      const body = (await res.json()) as ConfirmResponse & { message?: string }
      if (!res.ok) {
        setError(body.message ?? 'สร้างข้อมูลไม่สำเร็จ')
        return
      }
      setResult(body)
      setStage('result')
      onImported()
    } catch {
      setError('ยืนยันไม่สำเร็จ — ลองใหม่อีกครั้ง')
    } finally {
      setBusy(false)
    }
  }

  const setResolution = (rowNumber: number, resolution: ImportItemPreview['resolution']) => {
    setItems((arr) => arr.map((it) => (it.rowNumber === rowNumber ? { ...it, resolution } : it)))
  }

  const readyCount = items.filter((i) => i.status === 'ok' || (i.status === 'duplicate' && (items.find((x) => x.rowNumber === i.rowNumber)?.resolution ?? 'skip') !== 'skip')).length
  const errorCount = items.filter((i) => i.status === 'error').length

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={busy ? undefined : onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-8 mx-auto w-full max-w-3xl px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-semibold text-ink">Import Data — {project.name}</div>
              <div className="text-xs text-muted mt-0.5">อัปงานเข้าระบบทีเดียวจากไฟล์ Excel (+ เอกสารแนบ)</div>
            </div>
            <button onClick={onClose} disabled={busy} className="text-muted hover:text-soft shrink-0 disabled:opacity-40"><X className="w-5 h-5" /></button>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 text-sm text-danger-700 bg-danger-50 border border-danger-100 rounded-lg px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {stage === 'upload' && (
            <div className="space-y-4">
              <a
                href={`/api/projects/${project.id}/import/template`}
                className="flex items-center gap-2 text-sm bg-brand-50 text-brand-700 border border-brand-200 rounded-lg px-3.5 py-2.5 hover:bg-brand-100 w-fit"
              >
                <Download className="w-4 h-4" /> โหลด Template (.xlsx) — มีรายชื่อทีมพร้อมใช้
              </a>
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void upload(f) }}
                className="border-2 border-dashed border-border-subtle rounded-lg p-8 text-center cursor-pointer hover:bg-hover hover:border-brand-300"
              >
                <Upload className="w-8 h-8 text-muted mx-auto mb-2" />
                <div className="text-sm text-body">{busy ? 'กำลังอ่านไฟล์…' : 'คลิกหรือลากไฟล์มาวาง'}</div>
                <div className="text-xs text-muted mt-1">รับ .xlsx (ไม่มีเอกสารแนบ) หรือ .zip (tasks.xlsx + documents/)</div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.zip,application/zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }}
                />
              </div>
            </div>
          )}

          {stage === 'preview' && parsed && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2.5 py-1 rounded-full bg-success-50 text-success-700">พร้อมสร้าง {parsed.summary.ready}</span>
                {parsed.summary.duplicate > 0 && <span className="px-2.5 py-1 rounded-full bg-warning-50 text-warning-700">รหัสซ้ำ {parsed.summary.duplicate}</span>}
                {parsed.summary.error > 0 && <span className="px-2.5 py-1 rounded-full bg-danger-50 text-danger-700">กรอกผิด {parsed.summary.error}</span>}
                {parsed.summary.documents > 0 && <span className="px-2.5 py-1 rounded-full bg-info-50 text-info-700">เอกสาร {parsed.summary.documents}</span>}
              </div>

              <div className="border border-border-subtle rounded-lg divide-y divide-divider">
                {items.map((it) => (
                  <div key={it.rowNumber} className="p-2.5 text-sm flex items-start gap-2.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${it.status === 'error' ? 'bg-danger-50 text-danger-600' : it.status === 'duplicate' ? 'bg-warning-50 text-warning-700' : 'bg-success-50 text-success-600'}`}>
                      แถว {it.rowNumber}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {it.kind && <span className="text-[10px] px-1.5 py-0.5 rounded bg-divider text-dim shrink-0">{KIND_LABEL[it.kind]}</span>}
                        <span className="text-body truncate">{it.title || '(ไม่มีชื่อ)'}</span>
                        {it.parentRowNumber != null && <span className="text-[11px] text-muted shrink-0">↳ ใต้แถว {it.parentRowNumber}</span>}
                      </div>
                      {it.status === 'error' && <div className="text-[11px] text-danger-600 mt-1">{it.errors.join(' · ')}</div>}
                      {it.status === 'duplicate' && (
                        <div className="text-[11px] text-warning-700 mt-1">รหัส "{it.originCode}" ซ้ำกับงานที่มีอยู่แล้ว: "{it.duplicateOfTitle}"</div>
                      )}
                    </div>
                    {it.status === 'duplicate' && (
                      <select
                        value={it.resolution}
                        onChange={(e) => setResolution(it.rowNumber, e.target.value as ImportItemPreview['resolution'])}
                        className="text-xs bg-white border border-border rounded-lg px-2 py-1 shrink-0"
                      >
                        <option value="skip">ข้าม</option>
                        <option value="overwrite">แทนที่ของเดิม</option>
                        <option value="create">สร้างใหม่แยกต่างหาก</option>
                      </select>
                    )}
                  </div>
                ))}
              </div>

              {parsed.documents.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted mb-1.5">เอกสารที่เจอในไฟล์ — เลือกประเภท (ไม่เลือก = ข้ามไม่อัป)</div>
                  <div className="border border-border-subtle rounded-lg divide-y divide-divider">
                    {parsed.documents.map((d) => (
                      <div key={d.path} className="p-2.5 text-sm flex items-center gap-2.5">
                        <FileText className="w-4 h-4 text-muted shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-body" title={d.path}>{d.filename}</span>
                        <select
                          value={docTypes[d.path] ?? ''}
                          onChange={(e) => setDocTypes((m) => ({ ...m, [d.path]: e.target.value }))}
                          className="text-xs bg-white border border-border rounded-lg px-2 py-1 shrink-0"
                        >
                          <option value="">— ไม่อัป —</option>
                          {DOC_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
                <div className="text-xs text-muted">
                  {errorCount > 0 && <span className="text-danger-600">{errorCount} แถวกรอกผิดจะถูกข้าม (แก้ไฟล์แล้วอัปใหม่ถ้าต้องการ)</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setStage('upload')} disabled={busy} className="text-sm px-3 py-2 rounded-lg hover:bg-hover disabled:opacity-40">อัปโหลดไฟล์อื่น</button>
                  <button onClick={() => void confirm()} disabled={busy || readyCount === 0} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
                    {busy ? 'กำลังสร้าง…' : `ยืนยันสร้าง ${readyCount} รายการ`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {stage === 'result' && result && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-success-700 bg-success-50 border border-success-100 rounded-lg px-3.5 py-3">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <div className="text-sm">
                  สร้างงานใหม่ {result.createdTaskIds.length} รายการ
                  {result.updatedTaskIds.length > 0 && <> · แทนที่ของเดิม {result.updatedTaskIds.length} รายการ</>}
                  {result.createdDocIds.length > 0 && <> · อัปโหลดเอกสาร {result.createdDocIds.length} ไฟล์</>}
                  {result.skippedRowNumbers.length > 0 && <> · ข้าม {result.skippedRowNumbers.length} แถว</>}
                </div>
              </div>
              {result.warnings.length > 0 && (
                <div className="text-xs text-warning-700 bg-warning-50 border border-warning-100 rounded-lg px-3.5 py-2.5 space-y-1">
                  {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              )}
              <div className="flex justify-end">
                <button onClick={onClose} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700">เสร็จสิ้น</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
