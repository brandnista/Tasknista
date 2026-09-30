import { ChevronDown, ChevronRight, FileText, FileUp, Link2, Pencil, Plus, Search, Trash2, Unlink, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/useLoad'
import { useDialog } from './Dialog'
import { TemplatePickerModal } from './doc-templates/TemplatePickerModal'
import { useToast } from './Toast'

// Pronista §Project Documents (2026-09-17) — แท็บ "เอกสาร" ของโปรเจกต์ ยกเครื่องจาก list อ่านอย่างเดียวเดิม (ProjectDocsSection)
// สิทธิ์มาจากเพดานโปรเจกต์ (actions.doc.*) ส่งเป็น props จาก ProjectDetail.tsx — ไม่ใช่ doc-acl.ts (คนละระบบกับ /docs/:id เดิม จึงไม่ navigate ไปหน้านั้น)
const DOC_TYPES = ['MOM', 'BRD', 'SOW', 'SRS', 'PEP', 'UIR', 'CR', 'API'] as const
type DocType = (typeof DOC_TYPES)[number]

interface DocVersion {
  id: string
  title: string
  kind: 'file' | 'link' | 'template' | 'page'
  templateType: string | null
  templateDocNumber: string | null
  docType: DocType | null
  docNumber: string | null
  docVersion: string | null
  externalUrl: string | null
  filename: string | null
  mime: string | null
  sizeBytes: number | null
  source: 'upload' | 'gdrive' | 'task_attachment' | null // null = มาจากเมนู "เอกสาร" (ส่วนกลาง)
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

// (2026-09-30) ตัวกรอง "ชนิดไฟล์" แบบเดียวกับเมนู "เอกสาร" (Google Drive style)
type FileKindFilter = 'all' | 'page' | 'template' | 'link' | 'pdf' | 'word' | 'other'
const FILE_KIND_LABEL: Record<FileKindFilter, string> = {
  all: 'ทุกชนิดไฟล์', page: 'เอกสาร', template: 'Template', link: 'ลิงก์ Google Docs', pdf: 'PDF', word: 'Word', other: 'อื่นๆ (Excel / PowerPoint / รูป)',
}
const fileKindOf = (v: Pick<DocVersion, 'kind' | 'mime'>): FileKindFilter => {
  if (v.kind === 'page' || v.kind === 'template' || v.kind === 'link') return v.kind
  if (v.mime === 'application/pdf') return 'pdf'
  if (v.mime === 'application/msword' || v.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'word'
  return 'other'
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
    // Template/หน้าเอกสารจากเมนู "เอกสาร" ไม่มีเลขเวอร์ชัน — ไม่บังคับ (ไฟล์/ลิงก์ที่เพิ่มในโปรเจกต์ยังบังคับเหมือนเดิม)
    const versionRequired = doc.kind === 'file' || doc.kind === 'link'
    if (versionRequired && !docVersion.trim()) return setError('ต้องระบุเวอร์ชัน')
    setSaving(true)
    setError('')
    try {
      await api.patch(`/api/projects/${projectId}/documents/${doc.id}`, { title: title.trim(), docType: docType || null, ...(docVersion.trim() ? { docVersion: docVersion.trim() } : {}) })
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

// (2026-09-30) ไอคอนตามชนิดไฟล์แบบเดียวกับเมนู "เอกสาร" — Word = W น้ำเงิน · PDF แดง · Template ม่วง · ลิงก์ฟ้า
function DocTile({ v }: { v: DocVersion }) {
  const base = 'w-6 h-6 rounded grid place-items-center text-[10px] font-bold text-white shrink-0'
  const kind = fileKindOf(v)
  if (kind === 'word') return <span className={`${base} bg-info-600`}>W</span>
  if (kind === 'pdf') return <span className={`${base} bg-danger-600 text-[8px]`}>PDF</span>
  if (kind === 'template') return <span className={`${base} bg-violet-500`}><FileText className="w-3.5 h-3.5" /></span>
  if (kind === 'page') return <span className={`${base} bg-brand-500`}><FileText className="w-3.5 h-3.5" /></span>
  if (kind === 'link') return <span className={`${base} bg-info-500`}><Link2 className="w-3.5 h-3.5" /></span>
  return <span className={`${base} bg-dim`}><FileText className="w-3.5 h-3.5" /></span>
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
  // Template/หน้าเอกสาร เปิดเป็นหน้าเอกสารของระบบในแท็บใหม่ (ไม่ดาวน์โหลดไฟล์) · ลิงก์ Google → เปิดลิงก์ · ไฟล์ PDF/Word/อื่นๆ → ไฟล์จริง
  const isCentral = v.source === null // เอกสารที่มาจากเมนู "เอกสาร" (ส่วนกลาง) — ลบจากที่นี่ = เอาออกจากโปรเจกต์เท่านั้น
  const openHref =
    v.kind === 'template' || v.kind === 'page' ? `/docs/${v.id}` : v.kind === 'link' ? (v.externalUrl ?? '#') : `/api/projects/${projectId}/documents/${v.id}/raw`

  const remove = async () => {
    const ok = isCentral
      ? await confirmDialog({ title: `เอา "${v.title}" ออกจากโปรเจกต์นี้?`, message: 'ตัวเอกสารยังอยู่ในเมนู "เอกสาร" และโปรเจกต์อื่นที่ผูกไว้ — แค่ไม่แสดงในแท็บนี้', confirmLabel: 'เอาออก', danger: true })
      : await confirmDialog({ title: `ลบ "${v.title}"?`, danger: true })
    if (!ok) return
    await api.delete(`/api/projects/${projectId}/documents/${v.id}`)
    toast(isCentral ? 'เอาเอกสารออกจากโปรเจกต์แล้ว' : 'ลบเอกสารแล้ว')
    onDeleted()
  }

  return (
    <div className="flex items-center gap-2.5 text-sm px-3 py-2 rounded-lg border border-border-subtle hover:bg-hover">
      <DocTile v={v} />
      <a href={openHref} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate hover:text-brand-700" title={v.title}>
        {v.title}
      </a>
      {v.docType && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 shrink-0">{v.docType}</span>}
      {v.templateDocNumber && <span className="text-[10px] font-mono text-dim shrink-0 hidden sm:inline">{v.templateDocNumber}</span>}
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
      {canEdit && (v.kind === 'file' || v.kind === 'link') && (
        <button onClick={onAddVersion} title="เพิ่มเวอร์ชันใหม่" className="p-1 rounded hover:bg-white shrink-0">
          <Plus className="w-3.5 h-3.5 text-muted" />
        </button>
      )}
      {canDelete && (
        <button onClick={remove} title={isCentral ? 'เอาออกจากโปรเจกต์' : 'ลบ'} className="p-1 rounded hover:bg-white shrink-0">
          {isCentral ? <Unlink className="w-3.5 h-3.5 text-danger-500" /> : <Trash2 className="w-3.5 h-3.5 text-danger-500" />}
        </button>
      )}
    </div>
  )
}

interface MomPreview {
  filename: string
  suggestedTitle: string
  docNumber: string | null
  data: { fields: Record<string, Record<string, string>>; tables: Record<string, Record<string, string>[]>; lists: Record<string, string[]> }
  counts: { attendees: number; agenda: number; decisions: number; actionItems: number; approvals: number }
  warnings: string[]
}

/** (2026-09-30) อัปโหลดไฟล์ MOM (.docx) → ระบบอ่านแล้วกรอก Template MOM ให้ → หน้านี้ให้ตรวจก่อนสร้างเอกสารจริง (ไม่เก็บไฟล์ Word ต้นฉบับ) */
function MomImportModal({ projectId, file, onClose, onCreated }: { projectId: string; file: File; onClose: () => void; onCreated: (docId: string) => void }) {
  const [preview, setPreview] = useState<MomPreview | null>(null)
  const [loadError, setLoadError] = useState('')
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const fd = new FormData()
    fd.append('file', file)
    api
      .post<MomPreview>(`/api/projects/${projectId}/documents/import-mom/preview`, fd)
      .then((r) => {
        if (!alive) return
        setPreview(r)
        setTitle(r.suggestedTitle)
      })
      .catch((e) => alive && setLoadError(e instanceof ApiError ? e.message : 'อ่านไฟล์ไม่สำเร็จ'))
    return () => { alive = false }
  }, [projectId, file])

  const create = async () => {
    if (!preview || saving) return
    if (!title.trim()) return setError('ต้องระบุชื่อเอกสาร')
    setSaving(true)
    setError('')
    try {
      const doc = await api.post<{ id: string }>(`/api/projects/${projectId}/documents/import-mom`, { title: title.trim(), data: preview.data })
      onCreated(doc.id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'สร้างเอกสารไม่สำเร็จ')
      setSaving(false)
    }
  }

  const info = preview?.data.fields.meeting_info ?? {}
  const row = (label: string, value: string | undefined) =>
    value ? (
      <div className="flex gap-2 text-xs">
        <span className="text-muted w-24 shrink-0">{label}</span>
        <span className="text-body min-w-0 break-words">{value}</span>
      </div>
    ) : null

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={saving ? undefined : onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-12 mx-auto w-full max-w-lg px-4 max-h-[calc(100vh-4rem)] overflow-y-auto">
        <div className="bg-white rounded-lg shadow-2xl p-5">
          <div className="font-semibold text-ink text-sm mb-1">นำเข้า MOM จากไฟล์ Word</div>
          <p className="text-xs text-muted mb-3 truncate">{file.name}</p>

          {!preview && !loadError && <div className="py-8 text-center text-sm text-muted">กำลังอ่านไฟล์…</div>}
          {loadError && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2 mb-2">{loadError}</div>}

          {preview && (
            <>
              <label className="text-xs font-medium text-muted mb-1 block">ชื่อเอกสาร</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${input} mb-3`} />
              <div className="bg-hover rounded-lg p-3 space-y-1.5 mb-3">
                {row('เลขที่เอกสาร', info.document_no)}
                {row('โครงการ', info.project_code)}
                {row('วันที่ / เวลา', info.datetime)}
                {row('สถานที่', info.venue)}
                {row('วาระสำคัญ', info.key_agenda)}
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {[
                  ['ผู้เข้าร่วม', preview.counts.attendees],
                  ['วาระ', preview.counts.agenda],
                  ['มติที่ประชุม', preview.counts.decisions],
                  ['Action Items', preview.counts.actionItems],
                  ['ผู้รับรอง', preview.counts.approvals],
                ].map(([label, n]) => (
                  <span key={label as string} className={`text-[11px] px-2 py-1 rounded-full ${Number(n) > 0 ? 'bg-success-50 text-success-700' : 'bg-warning-50 text-warning-700'}`}>
                    {label} {n} รายการ
                  </span>
                ))}
              </div>
              {preview.warnings.length > 0 && (
                <ul className="text-xs text-warning-700 bg-warning-50 rounded-lg px-3 py-2 mb-3 space-y-0.5 list-disc pl-6">
                  {preview.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              )}
              <p className="text-[11px] text-muted mb-1">กดสร้างแล้วระบบจะเปิดหน้าเอกสารในแท็บใหม่ ตรวจและแก้ไขต่อได้ทุกช่อง (ไม่เก็บไฟล์ Word ต้นฉบับไว้ในระบบ)</p>
            </>
          )}
          {error && <p className="text-xs text-danger-600 mt-2">{error}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} disabled={saving} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
            <button disabled={!preview || saving} onClick={() => void create()} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'กำลังสร้าง…' : 'สร้างเอกสาร MOM'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface LinkableDoc {
  id: string
  title: string
  kind: 'file' | 'link' | 'template' | 'page'
  docType: DocType | null
  docVersion: string | null
  templateDocNumber: string | null
  filename: string | null
}

/** (2026-09-30) เลือกเอกสารที่มีอยู่แล้วในเมนู "เอกสาร" มาผูกเข้าโปรเจกต์ — ผูกได้เฉพาะเอกสารที่เราเป็นเจ้าของ/editor */
function LinkExistingModal({ projectId, onClose, onLinked }: { projectId: string; onClose: () => void; onLinked: () => void }) {
  const toast = useToast()
  const { data, loading } = useLoad<{ items: LinkableDoc[] }>(() => api.get(`/api/projects/${projectId}/documents/linkable`), [projectId])
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  const items = (data?.items ?? []).filter((d) => !done.has(d.id) && (!q.trim() || (d.templateDocNumber ?? d.title).toLowerCase().includes(q.trim().toLowerCase()) || d.title.toLowerCase().includes(q.trim().toLowerCase())))

  const link = async (d: LinkableDoc) => {
    if (busyId) return
    setBusyId(d.id)
    try {
      await api.post(`/api/projects/${projectId}/documents/link-existing`, { docId: d.id })
      setDone((s) => new Set(s).add(d.id))
      toast('ผูกเอกสารเข้าโปรเจกต์แล้ว')
      onLinked()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'ผูกเอกสารไม่สำเร็จ')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-16 mx-auto w-full max-w-md px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5">
          <div className="font-semibold text-ink text-sm mb-1">ผูกเอกสารที่มีอยู่แล้ว</div>
          <p className="text-xs text-muted mb-3">เอกสารจากเมนู &quot;เอกสาร&quot; ที่คุณเป็นเจ้าของหรือ editor — สมาชิกโปรเจกต์ที่เปิดแท็บนี้ได้จะเห็นไฟล์เหล่านี้ด้วย</p>
          <div className="relative mb-2">
            <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อเอกสาร / เลขที่เอกสาร…" className={`${input} pl-8`} />
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {loading && <div className="py-6 text-center text-sm text-muted">กำลังโหลด…</div>}
            {!loading && items.length === 0 && <div className="py-6 text-center text-sm text-muted">ไม่มีเอกสารที่ผูกได้</div>}
            {items.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg hover:bg-hover">
                <DocTile v={{ ...d, externalUrl: null, mime: null, sizeBytes: null, source: null, templateType: null, updatedByName: null, updatedAt: null } as DocVersion} />
                <span className="flex-1 min-w-0 truncate" title={d.title}>{d.title}</span>
                {d.docType && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 shrink-0">{d.docType}</span>}
                <button disabled={busyId === d.id} onClick={() => void link(d)} className="text-xs font-medium text-brand-700 hover:underline shrink-0 disabled:opacity-40">
                  ผูก
                </button>
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-3">
            <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">เสร็จสิ้น</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ProjectDocumentsTab({ projectId, canCreate, canEdit, canDelete }: { projectId: string; canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const { user } = useAuth()
  const { data, reload } = useLoad<{ series: DocSeries[] }>(() => api.get(`/api/projects/${projectId}/documents`), [projectId])
  const series = data?.series ?? []
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [momFile, setMomFile] = useState<File | null>(null)
  const momInputRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<DocVersion | null>(null)
  const [addingVersionTo, setAddingVersionTo] = useState<(DocVersion & { heading: string }) | null>(null)
  // ตัวกรองแบบเดียวกับเมนู "เอกสาร": ค้นหา + ชนิดไฟล์ + ประเภทเอกสาร (เลือกหลายอันได้)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<FileKindFilter>('all')
  const [typeFilters, setTypeFilters] = useState<Set<DocType>>(new Set())

  const isTeam = user?.role === 'owner' || user?.role === 'member' // Template/ผูกเอกสารส่วนกลางใช้ได้เฉพาะทีมภายใน (เหมือนเมนู "เอกสาร")

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const toggleType = (t: DocType) =>
    setTypeFilters((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })

  const q = search.trim().toLowerCase()
  const visibleSeries = series.filter((s) => {
    const latest = s.versions[0]
    if (!latest) return false
    if (q && !s.versions.some((v) => v.title.toLowerCase().includes(q) || (v.templateDocNumber ?? '').toLowerCase().includes(q) || (v.filename ?? '').toLowerCase().includes(q))) return false
    if (typeFilters.size > 0 && !(latest.docType && typeFilters.has(latest.docType))) return false
    if (kindFilter !== 'all' && fileKindOf(latest) !== kindFilter) return false
    return true
  })
  const filtersActive = q !== '' || kindFilter !== 'all' || typeFilters.size > 0

  const openDoc = (id: string) => window.open(`/docs/${id}`, '_blank', 'noopener')

  return (
    <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="text-sm font-semibold text-strong">เอกสารโปรเจกต์ ({filtersActive ? `${visibleSeries.length}/${series.length}` : series.length})</div>
        {canCreate && (
          <div className="relative">
            <button onClick={() => setAddMenuOpen((v) => !v)} className="text-xs font-medium bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> เพิ่ม <ChevronDown className="w-3 h-3" />
            </button>
            {addMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAddMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-72 bg-white rounded-lg shadow-2xl border border-border-subtle p-1.5 z-20">
                  {(() => {
                    const item = 'w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-hover flex items-center gap-2'
                    return (
                      <>
                        <button className={item} onClick={() => { setAddMenuOpen(false); setAddOpen(true) }}><Upload className="w-4 h-4 text-muted shrink-0" /> อัปโหลดไฟล์ / ลิงก์ Google Drive</button>
                        {isTeam && <button className={item} onClick={() => { setAddMenuOpen(false); setTemplateOpen(true) }}><FileText className="w-4 h-4 text-muted shrink-0" /> สร้างเอกสารจาก Template</button>}
                        {isTeam && <button className={item} onClick={() => { setAddMenuOpen(false); momInputRef.current?.click() }}><FileUp className="w-4 h-4 text-muted shrink-0" /> อัปโหลด MOM (Word) → กรอก Template ให้</button>}
                        {isTeam && <button className={item} onClick={() => { setAddMenuOpen(false); setLinkOpen(true) }}><Link2 className="w-4 h-4 text-muted shrink-0" /> ผูกเอกสารที่มีอยู่แล้ว</button>}
                      </>
                    )
                  })()}
                </div>
              </>
            )}
            <input
              ref={momInputRef}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) setMomFile(f); e.target.value = '' }}
            />
          </div>
        )}
      </div>

      <div className="relative mb-2">
        <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อเอกสาร / เลขที่เอกสาร…" className={`${input} pl-9`} />
      </div>
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted">ชนิดไฟล์:</span>
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as FileKindFilter)} className="text-sm bg-white border border-border rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:border-brand-400">
            {(Object.keys(FILE_KIND_LABEL) as FileKindFilter[]).map((k) => <option key={k} value={k}>{FILE_KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted mr-1">ประเภทเอกสาร:</span>
          {DOC_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={`text-xs font-medium px-2.5 py-1 rounded-full border ${typeFilters.has(t) ? 'bg-brand-600 border-brand-600 text-white' : 'border-border-subtle text-dim hover:bg-hover'}`}
            >
              {t}
            </button>
          ))}
        </div>
        {filtersActive && (
          <button onClick={() => { setSearch(''); setKindFilter('all'); setTypeFilters(new Set()) }} className="text-xs text-brand-700 hover:underline">ล้างตัวกรอง</button>
        )}
      </div>

      {series.length === 0 && <div className="text-sm text-muted py-6 text-center">ยังไม่มีเอกสารในโปรเจกต์นี้</div>}
      {series.length > 0 && visibleSeries.length === 0 && <div className="text-sm text-muted py-6 text-center">ไม่พบเอกสารตามตัวกรองที่เลือก</div>}

      <div className="space-y-1.5">
        {visibleSeries.map((s) => {
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
      {templateOpen && (
        <TemplatePickerModal
          parentId={null}
          fixedProjectId={projectId}
          onClose={() => setTemplateOpen(false)}
          onCreated={(docId) => { setTemplateOpen(false); reload(); openDoc(docId) }}
        />
      )}
      {linkOpen && <LinkExistingModal projectId={projectId} onClose={() => setLinkOpen(false)} onLinked={reload} />}
      {momFile && (
        <MomImportModal
          projectId={projectId}
          file={momFile}
          onClose={() => setMomFile(null)}
          onCreated={(docId) => { setMomFile(null); reload(); openDoc(docId) }}
        />
      )}
    </div>
  )
}
