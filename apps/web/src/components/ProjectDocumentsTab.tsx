import { ChevronDown, ChevronRight, FileText, Link2, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { useDialog } from './Dialog'
import { useToast } from './Toast'

// Pronista §Project Documents (2026-09-17) — แท็บ "เอกสาร" ของโปรเจกต์ ยกเครื่องจาก list อ่านอย่างเดียวเดิม (ProjectDocsSection)
// สิทธิ์มาจากเพดานโปรเจกต์ (actions.doc.*) ส่งเป็น props จาก ProjectDetail.tsx — ไม่ใช่ doc-acl.ts (คนละระบบกับ /docs/:id เดิม จึงไม่ navigate ไปหน้านั้น)
const DOC_TYPES = ['MOM', 'BRD', 'SOW', 'SRS', 'PEP', 'UIR', 'CR', 'API'] as const
type DocType = (typeof DOC_TYPES)[number]

interface DocVersion {
  id: string
  title: string
  kind: 'file' | 'link'
  docType: DocType | null
  docNumber: string | null
  docVersion: string | null
  externalUrl: string | null
  filename: string | null
  mime: string | null
  sizeBytes: number | null
  source: 'upload' | 'gdrive' | 'task_attachment' | null
  updatedByName: string | null
  updatedAt: number | null
}
interface DocSeries {
  key: string
  docType: DocType | null
  docNumber: string | null
  heading: string
  versions: DocVersion[]
  latestAt: number
}

const SOURCE_LABEL: Record<string, string> = { upload: 'อัปโหลด', gdrive: 'Google Drive', task_attachment: 'โปรโมทจาก Task' }
const fmtSize = (b: number | null) => (b == null ? '' : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`)
const fmtUpdatedAt = (t: number | null) =>
  t ? new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const input = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'

function AddDocumentModal({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [mode, setMode] = useState<'upload' | 'link'>('upload')
  const [title, setTitle] = useState('')
  const [docType, setDocType] = useState<DocType | ''>('')
  const [docVersion, setDocVersion] = useState('1.0')
  const [externalUrl, setExternalUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (!docType) return setError('ต้องเลือกประเภทเอกสาร')
    if (!docVersion.trim()) return setError('ต้องระบุเวอร์ชันเอกสาร')
    if (mode === 'upload' && !file) return setError('ต้องเลือกไฟล์')
    if (mode === 'link' && !externalUrl.trim()) return setError('ต้องระบุลิงก์ Google Drive')
    setSaving(true)
    setError('')
    try {
      if (mode === 'upload' && file) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('title', title.trim() || file.name)
        fd.append('docType', docType)
        fd.append('docVersion', docVersion.trim())
        await api.post(`/api/projects/${projectId}/documents/upload`, fd)
      } else {
        await api.post(`/api/projects/${projectId}/documents/link`, {
          title: title.trim() || externalUrl.trim(),
          externalUrl: externalUrl.trim(),
          docType,
          docVersion: docVersion.trim(),
        })
      }
      toast('เพิ่มเอกสารแล้ว')
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'เพิ่มเอกสารไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-20 mx-auto w-full max-w-sm px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5">
          <div className="font-semibold text-ink text-sm mb-3">เพิ่มเอกสารโปรเจกต์</div>
          <div className="flex gap-1.5 mb-3">
            <button onClick={() => setMode('upload')} className={`flex-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border ${mode === 'upload' ? 'bg-brand-600 border-brand-600 text-white' : 'border-border-subtle text-dim hover:bg-hover'}`}>
              <Upload className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> อัปโหลดไฟล์
            </button>
            <button onClick={() => setMode('link')} className={`flex-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border ${mode === 'link' ? 'bg-brand-600 border-brand-600 text-white' : 'border-border-subtle text-dim hover:bg-hover'}`}>
              <Link2 className="w-3.5 h-3.5 inline -mt-0.5 mr-1" /> ลิงก์ Google Drive
            </button>
          </div>

          {mode === 'upload' ? (
            <button onClick={() => fileRef.current?.click()} className="w-full text-sm border border-dashed border-border rounded-lg px-3 py-3 mb-3 text-center hover:bg-hover text-dim">
              {file ? file.name : 'เลือกไฟล์…'}
              <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </button>
          ) : (
            <input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://drive.google.com/..." className={`${input} mb-3`} />
          )}

          <label className="text-xs font-medium text-muted mb-1 block">ชื่อเอกสาร (ไม่ระบุ = ใช้ชื่อไฟล์/ลิงก์)</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${input} mb-3`} />

          <div className="flex gap-2 mb-1">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted mb-1 block">ประเภทเอกสาร *</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value as DocType | '')} className={input}>
                <option value="">— เลือก —</option>
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="w-28">
              <label className="text-xs font-medium text-muted mb-1 block">เวอร์ชัน *</label>
              <input value={docVersion} onChange={(e) => setDocVersion(e.target.value)} placeholder="1.0" className={input} />
            </div>
          </div>
          {error && <p className="text-xs text-danger-600 mt-2">{error}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
            <button disabled={saving} onClick={submit} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'กำลังบันทึก…' : 'เพิ่มเอกสาร'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AddVersionModal({ projectId, base, onClose, onSaved }: { projectId: string; base: DocVersion & { heading: string }; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [docVersion, setDocVersion] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (!docVersion.trim()) return setError('ต้องระบุเวอร์ชันใหม่')
    if (!file) return setError('ต้องเลือกไฟล์')
    setSaving(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('docVersion', docVersion.trim())
      await api.post(`/api/projects/${projectId}/documents/${base.id}/versions/upload`, fd)
      toast('เพิ่มเวอร์ชันใหม่แล้ว')
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'เพิ่มเวอร์ชันไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-24 mx-auto w-full max-w-sm px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5">
          <div className="font-semibold text-ink text-sm mb-1">เพิ่มเวอร์ชันใหม่</div>
          <p className="text-xs text-muted mb-3">{base.heading ?? base.title} · เวอร์ชันล่าสุดตอนนี้ {base.docVersion ? `v${base.docVersion}` : '—'}</p>
          <button onClick={() => fileRef.current?.click()} className="w-full text-sm border border-dashed border-border rounded-lg px-3 py-3 mb-3 text-center hover:bg-hover text-dim">
            {file ? file.name : 'เลือกไฟล์…'}
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </button>
          <label className="text-xs font-medium text-muted mb-1 block">เวอร์ชันใหม่ *</label>
          <input value={docVersion} onChange={(e) => setDocVersion(e.target.value)} placeholder="เช่น 2.0" className={input} />
          {error && <p className="text-xs text-danger-600 mt-2">{error}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
            <button disabled={saving} onClick={submit} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'กำลังบันทึก…' : 'เพิ่มเวอร์ชัน'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EditMetaModal({ projectId, doc, onClose, onSaved }: { projectId: string; doc: DocVersion; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [title, setTitle] = useState(doc.title)
  const [docType, setDocType] = useState<DocType | ''>(doc.docType ?? '')
  const [docVersion, setDocVersion] = useState(doc.docVersion ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!title.trim()) return setError('ต้องระบุชื่อเอกสาร')
    if (!docVersion.trim()) return setError('ต้องระบุเวอร์ชัน')
    setSaving(true)
    setError('')
    try {
      await api.patch(`/api/projects/${projectId}/documents/${doc.id}`, { title: title.trim(), docType: docType || null, docVersion: docVersion.trim() })
      toast('บันทึกแล้ว')
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-24 mx-auto w-full max-w-sm px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5">
          <div className="font-semibold text-ink text-sm mb-3">แก้ไขข้อมูลเอกสาร</div>
          <label className="text-xs font-medium text-muted mb-1 block">ชื่อเอกสาร</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${input} mb-3`} />
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted mb-1 block">ประเภทเอกสาร</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value as DocType | '')} className={input}>
                <option value="">— ไม่ระบุ —</option>
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="w-28">
              <label className="text-xs font-medium text-muted mb-1 block">เวอร์ชัน</label>
              <input value={docVersion} onChange={(e) => setDocVersion(e.target.value)} className={input} />
            </div>
          </div>
          {error && <p className="text-xs text-danger-600 mt-2">{error}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
            <button disabled={saving} onClick={submit} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function VersionRow({ projectId, v, canEdit, canDelete, onEdit, onAddVersion, onDeleted }: {
  projectId: string
  v: DocVersion
  canEdit: boolean
  canDelete: boolean
  onEdit: () => void
  onAddVersion: () => void
  onDeleted: () => void
}) {
  const { confirmDialog } = useDialog()
  const toast = useToast()
  const openHref = v.kind === 'link' ? (v.externalUrl ?? '#') : `/api/projects/${projectId}/documents/${v.id}/raw`

  const remove = async () => {
    if (!(await confirmDialog({ title: `ลบ "${v.title}"?`, danger: true }))) return
    await api.delete(`/api/projects/${projectId}/documents/${v.id}`)
    toast('ลบเอกสารแล้ว')
    onDeleted()
  }

  return (
    <div className="flex items-center gap-2.5 text-sm px-3 py-2 rounded-lg border border-border-subtle hover:bg-hover">
      {v.kind === 'link' ? <Link2 className="w-4 h-4 text-info-500 shrink-0" /> : <FileText className="w-4 h-4 text-brand-500 shrink-0" />}
      <a href={openHref} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate hover:text-brand-700">
        {v.title}
      </a>
      {v.docVersion && <span className="text-[10px] font-mono text-dim shrink-0">v{v.docVersion}</span>}
      {v.sizeBytes != null && <span className="text-[10px] text-muted shrink-0 hidden sm:inline">{fmtSize(v.sizeBytes)}</span>}
      {v.source && v.source !== 'upload' && (
        <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0 bg-info-50 text-info-700 hidden sm:inline">{SOURCE_LABEL[v.source]}</span>
      )}
      <span className="text-[10px] text-muted shrink-0 hidden md:inline">{v.updatedByName ?? '—'} · {fmtUpdatedAt(v.updatedAt)}</span>
      {canEdit && (
        <button onClick={onEdit} title="แก้ไขข้อมูล" className="p-1 rounded hover:bg-white shrink-0">
          <Pencil className="w-3.5 h-3.5 text-muted" />
        </button>
      )}
      {canEdit && (
        <button onClick={onAddVersion} title="เพิ่มเวอร์ชันใหม่" className="p-1 rounded hover:bg-white shrink-0">
          <Plus className="w-3.5 h-3.5 text-muted" />
        </button>
      )}
      {canDelete && (
        <button onClick={remove} title="ลบ" className="p-1 rounded hover:bg-white shrink-0">
          <Trash2 className="w-3.5 h-3.5 text-danger-500" />
        </button>
      )}
    </div>
  )
}

export function ProjectDocumentsTab({ projectId, canCreate, canEdit, canDelete }: { projectId: string; canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const { data, reload } = useLoad<{ series: DocSeries[] }>(() => api.get(`/api/projects/${projectId}/documents`), [projectId])
  const series = data?.series ?? []
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<DocVersion | null>(null)
  const [addingVersionTo, setAddingVersionTo] = useState<(DocVersion & { heading: string }) | null>(null)

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-strong">เอกสารโปรเจกต์ ({series.length})</div>
        {canCreate && (
          <button onClick={() => setAddOpen(true)} className="text-xs font-medium bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> เพิ่มเอกสาร
          </button>
        )}
      </div>

      {series.length === 0 && <div className="text-sm text-muted py-6 text-center">ยังไม่มีเอกสารในโปรเจกต์นี้</div>}

      <div className="space-y-1.5">
        {series.map((s) => {
          const [latest, ...older] = s.versions
          if (!latest) return null
          const isOpen = expanded.has(s.key)
          return (
            <div key={s.key}>
              <div className="flex items-start gap-1.5">
                {older.length > 0 ? (
                  <button onClick={() => toggle(s.key)} className="p-1 mt-1.5 shrink-0 hover:bg-hover rounded">
                    {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-muted" />}
                  </button>
                ) : (
                  <span className="w-5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <VersionRow
                    projectId={projectId}
                    v={latest}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    onEdit={() => setEditing(latest)}
                    onAddVersion={() => setAddingVersionTo({ ...latest, heading: s.heading })}
                    onDeleted={reload}
                  />
                  {older.length > 0 && !isOpen && <div className="text-[10px] text-muted pl-3 mt-0.5">มีอีก {older.length} เวอร์ชันก่อนหน้า</div>}
                  {isOpen && (
                    <div className="pl-3 mt-1 space-y-1.5">
                      {older.map((v) => (
                        <VersionRow
                          key={v.id}
                          projectId={projectId}
                          v={v}
                          canEdit={canEdit}
                          canDelete={canDelete}
                          onEdit={() => setEditing(v)}
                          onAddVersion={() => setAddingVersionTo({ ...v, heading: s.heading })}
                          onDeleted={reload}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {addOpen && <AddDocumentModal projectId={projectId} onClose={() => setAddOpen(false)} onSaved={reload} />}
      {editing && <EditMetaModal projectId={projectId} doc={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {addingVersionTo && <AddVersionModal projectId={projectId} base={addingVersionTo} onClose={() => setAddingVersionTo(null)} onSaved={reload} />}
    </div>
  )
}
