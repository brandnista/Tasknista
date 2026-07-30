import { FileText, Image as ImageIcon, Link2, Plus, Trash2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { useLoad } from '../../lib/useLoad'

interface DocAttachment {
  id: string
  docId: string
  kind: 'link' | 'file'
  label: string
  url: string | null
  filename: string | null
  mime: string | null
  sizeBytes: number | null
  createdAt: number
}

const isImage = (mime: string | null) => !!mime && /^image\/(png|jpeg|gif|webp|avif)$/.test(mime)

/**
 * Tasknista §Document Attachments — ส่วนแนบท้ายเอกสาร template ทุกประเภท: ลิงก์ภายนอก (เช่น ลิงก์บันทึกประชุม Google Meet), ไฟล์เอกสาร, หรือรูปภาพ
 * เรียก endpoint docAttachments (apps/api/src/routes/doc-attachments.ts) — คนละตารางกับ task attachments เดิม
 */
export function DocAttachmentsSection({ docId, canEdit }: { docId: string; canEdit: boolean }) {
  const { data, reload } = useLoad<DocAttachment[]>(() => api.get(`/api/docs/${docId}/attachments`), [docId])
  const fileRef = useRef<HTMLInputElement>(null)
  const [addingLink, setAddingLink] = useState(false)
  const [linkLabel, setLinkLabel] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const rows = data ?? []

  const addLink = async () => {
    if (!linkLabel.trim() || !linkUrl.trim()) return
    setBusy(true)
    setError('')
    try {
      await api.post(`/api/docs/${docId}/attachments/link`, { label: linkLabel.trim(), url: linkUrl.trim() })
      setLinkLabel('')
      setLinkUrl('')
      setAddingLink(false)
      void reload()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'เพิ่มลิงก์ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const uploadFile = async (file: File) => {
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/docs/${docId}/attachments/file`, { method: 'POST', body: fd })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string }
        setError(j.message ?? 'อัปโหลดไม่สำเร็จ')
        return
      }
      void reload()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('ลบไฟล์แนบนี้? กู้คืนไม่ได้')) return
    await api.delete(`/api/doc-attachments/${id}`)
    void reload()
  }

  if (rows.length === 0 && !canEdit) return null

  return (
    <div className="mt-8 pt-6 border-t border-divider">
      <h3 className="text-sm font-semibold text-ink mb-2">ส่วนแนบท้ายเอกสาร (Link / เอกสาร / รูปภาพ)</h3>
      {rows.length === 0 ? (
        <div className="text-xs text-muted mb-2">ยังไม่มีรายการแนบ</div>
      ) : (
        <div className="space-y-2 mb-3">
          {rows.map((a) => (
            <div key={a.id} className="flex items-center gap-2 border border-border-subtle rounded-lg px-3 py-2">
              {a.kind === 'link' ? (
                <Link2 className="w-3.5 h-3.5 text-info-500 shrink-0" />
              ) : isImage(a.mime) ? (
                <ImageIcon className="w-3.5 h-3.5 text-brand-500 shrink-0" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-brand-500 shrink-0" />
              )}
              {a.kind === 'link' ? (
                <a href={a.url ?? '#'} target="_blank" rel="noreferrer" className="flex-1 text-sm text-brand-700 hover:underline truncate">{a.label}</a>
              ) : isImage(a.mime) ? (
                <a href={`/api/doc-attachments/${a.id}`} target="_blank" rel="noreferrer" className="flex-1 flex items-center gap-2 min-w-0">
                  <img src={`/api/doc-attachments/${a.id}`} alt={a.label} className="h-10 w-10 object-cover rounded shrink-0" />
                  <span className="text-sm text-body truncate">{a.label}</span>
                </a>
              ) : (
                <a href={`/api/doc-attachments/${a.id}`} target="_blank" rel="noreferrer" className="flex-1 text-sm text-brand-700 hover:underline truncate">{a.label}</a>
              )}
              {canEdit && (
                <button onClick={() => void remove(a.id)} className="text-muted hover:text-danger-600 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="space-y-2">
          {error && <div className="text-xs text-danger-600">{error}</div>}
          {addingLink ? (
            <div className="flex items-center gap-2 border border-border-subtle rounded-lg p-2">
              <input
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
                placeholder="ชื่อลิงก์ เช่น บันทึกประชุม Google Meet"
                className="flex-1 text-sm bg-white border border-border rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:border-brand-400"
              />
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://…"
                className="flex-1 text-sm bg-white border border-border rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:border-brand-400"
              />
              <button onClick={() => void addLink()} disabled={busy} className="text-xs bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 disabled:opacity-40 whitespace-nowrap">เพิ่ม</button>
              <button onClick={() => setAddingLink(false)} className="text-muted hover:text-soft shrink-0"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button onClick={() => setAddingLink(true)} className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800">
                <Plus className="w-4 h-4" /> แนบลิงก์
              </button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f) }}
              />
              <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800 disabled:opacity-40">
                <Upload className="w-4 h-4" /> {busy ? 'กำลังอัปโหลด…' : 'แนบไฟล์/รูปภาพ'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
