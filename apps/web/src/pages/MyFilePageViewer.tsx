/**
 * Pronista §My Files — เปิดเอกสาร (kind='page') เป็นแท็บเต็มหน้าเสมอ แทน modal เดิม
 * เหมือนแพตเทิร์น "หน้าใหม่" ในเมนูเอกสาร (Docs.tsx → DocViewer.tsx) — สร้าง/กดเปิดแล้ว window.open แท็บใหม่
 */
import { ArrowLeft, Share2, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useDialog } from '../components/Dialog'
import { ShareModal } from '../components/MyFilesTab'
import { RichTextEditor } from '../components/RichTextEditor'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'

interface FileDetail {
  id: string
  ownerId: string
  kind: 'file' | 'page' | 'folder'
  name: string
  contentMarkdown: string | null
  updatedAt: number
  myAccess: 'owner' | 'editor' | 'viewer'
}

export function MyFilePageViewerPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { confirmDialog } = useDialog()
  const { data: file, reload } = useLoad<FileDetail | null>(() => (id ? api.get(`/api/my-files/${id}`) : Promise.resolve(null)), [id])
  const [title, setTitle] = useState('')
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved')
  const [sharing, setSharing] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { if (file) setTitle(file.name) }, [file?.id, file?.name])

  if (!file) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>

  const canEdit = file.myAccess === 'owner' || file.myAccess === 'editor'
  const canManage = file.myAccess === 'owner'

  const saveTitle = async () => {
    if (canEdit && title.trim() && title !== file.name) {
      await api.patch(`/api/my-files/${file.id}`, { name: title.trim() })
      await reload()
    }
  }

  const onContentChange = (markdown: string) => {
    if (!canEdit) return
    setSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void api.patch(`/api/my-files/${file.id}`, { contentMarkdown: markdown }).then(() => setSaveState('saved'))
    }, 800)
  }

  const removeFile = async () => {
    const yes = await confirmDialog({ title: `ลบ "${file.name}"?`, confirmLabel: 'ลบ', danger: true })
    if (!yes) return
    await api.delete(`/api/my-files/${file.id}`)
    navigate('/my-tasks/files')
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-1 mb-3">
        <Link to="/my-tasks/files" className="flex items-center gap-1.5 text-sm text-dim hover:text-strong">
          <ArrowLeft className="w-4 h-4" /> กลับไปไฟล์ของฉัน
        </Link>
        <div className="ml-auto flex items-center gap-1">
          {canManage && <button onClick={() => setSharing(true)} className="p-1.5 rounded-lg text-dim hover:bg-divider" title="แชร์"><Share2 className="w-4 h-4" /></button>}
          {canEdit && <button onClick={() => void removeFile()} className="p-1.5 rounded-lg text-border hover:text-danger-600" title="ลบเอกสารนี้"><Trash2 className="w-4 h-4" /></button>}
        </div>
      </div>

      <div className="flex flex-col bg-white rounded-lg shadow-xs overflow-hidden min-h-[calc(100dvh-160px)]">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-5 sm:px-10 py-8">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              readOnly={!canEdit}
              className="w-full text-3xl font-bold text-ink leading-snug focus:outline-hidden"
              aria-label="ชื่อเอกสาร"
            />
            <div className="text-xs text-muted mt-2 mb-5">
              {canEdit ? (saveState === 'saving' ? 'กำลังบันทึก…' : <><span className="text-success-500">✓</span> บันทึกแล้ว</>) : 'ดูอย่างเดียว'}
              {' · '}แก้ล่าสุด {new Date(file.updatedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </div>
            <RichTextEditor
              key={file.id}
              content={file.contentMarkdown ?? ''}
              onChange={canEdit ? onContentChange : undefined}
              editable={canEdit}
              minHeight="min-h-64"
              bare
            />
          </div>
        </div>
      </div>

      {sharing && <ShareModal file={file} onClose={() => setSharing(false)} />}
    </div>
  )
}
