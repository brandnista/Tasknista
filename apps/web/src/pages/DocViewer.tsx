import { EditorContent, useEditor } from '@tiptap/react'
import type { TemplateData } from '@seedoffice/core'
import { ArrowLeft, Copy, ExternalLink, FileText, Link2, Lock, Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useDialog } from '../components/Dialog'
import { richTextExtensions, RichTextToolbar } from '../components/RichTextEditor'
import { TemplateFillForm } from '../components/doc-templates/TemplateFillForm'
import { SrsLinkedTasksSection } from '../components/SrsLinkedTasksSection'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'

const DOC_TYPES = ['MOM', 'BRD', 'SOW', 'SRS', 'PEP', 'UIR', 'CR'] as const
type DocType = (typeof DOC_TYPES)[number]

interface DocNode {
  id: string
  parentId: string | null
  sortOrder: number
  icon: string | null
  title: string
  kind: 'page' | 'link' | 'file' | 'template' | 'folder'
  externalUrl: string | null
  filename: string | null
  mime: string | null
  isTemplate: boolean
  templateDocNumber: string | null
  ownerId: string | null
  visibility: 'private' | 'team'
  myAccess: 'owner' | 'editor' | 'viewer'
  // Pronista §Document Traceability fix (2026-09-01) — ตอนอัปโหลดยังไม่แท็ก/ยังไม่ผูกโปรเจกต์ = ไม่โผล่ "ประวัติเอกสาร" เลย (เปรียบเทียบเอกสารไม่ได้ตลอดไป) แก้ทีหลังตรงนี้ได้แล้ว
  docType: DocType | null
  // Pronista §Document Versioning fix (2026-09-01) — เลขที่เอกสาร (ระบุ "เล่ม") + เวอร์ชัน แก้ทีหลังได้แล้ว (เดิมตั้งได้แค่ตอนระบบ gen เอง) เอกสารเลขที่เดียวกัน = เล่มเดียวกัน หลายเวอร์ชัน เปรียบเทียบกันได้
  docNumber: string | null
  docVersion: string | null
}
interface DocFull extends DocNode {
  contentMarkdown: string
  updatedAt: number
  srsDocNumber: string | null
  srsVersion: string | null
  templateType: string | null
  templateData: TemplateData | null
}
interface UserOpt {
  id: string
  name: string
}
interface ProjectOpt {
  id: string
  name: string
}
interface BoardTaskOpt {
  id: string
  title: string
  code: string | null
}
interface DocMemberRow {
  id: string
  name: string
  role: 'viewer' | 'editor'
}

const canEditAccess = (a: DocNode['myAccess']) => a === 'owner' || a === 'editor'

/** อัปรูปขึ้น R2 แล้วคืน url (ใช้ทั้งปุ่ม toolbar และ paste/drop) */
async function uploadImage(file: File, docId: string): Promise<string | null> {
  if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type)) return null
  const fd = new FormData()
  fd.append('file', file)
  fd.append('docId', docId)
  const res = await fetch('/api/docs/images', { method: 'POST', body: fd })
  if (!res.ok) return null
  return ((await res.json()) as { url: string }).url
}

/** เปิดลิงก์/ไฟล์ (link → external URL แท็บใหม่ · file → raw endpoint, PDF inline/Word ดาวน์โหลด) */
function openDocNode(n: DocNode) {
  if (n.kind === 'link' && n.externalUrl) window.open(n.externalUrl, '_blank', 'noopener')
  else if (n.kind === 'file') window.open(`/api/docs/${n.id}/raw`, '_blank', 'noopener')
}

function DocEditor({ doc, canEdit, onMetaChanged }: { doc: DocFull; canEdit: boolean; onMetaChanged: () => void }) {
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [title, setTitle] = useState(doc.title)
  const fileRef = useRef<HTMLInputElement>(null)

  const editor = useEditor(
    {
      extensions: richTextExtensions('เริ่มพิมพ์ได้เลย — ระบบบันทึกเป็น Markdown ให้อัตโนมัติ'),
      content: doc.contentMarkdown,
      contentType: 'markdown',
      editable: canEdit,
      editorProps: {
        attributes: { class: 'doc-editor focus:outline-hidden min-h-64' },
        handlePaste: (_view, event) => {
          if (!canEdit) return false
          const file = [...(event.clipboardData?.files ?? [])][0]
          if (file && file.type.startsWith('image/')) {
            void uploadImage(file, doc.id).then((url) => url && editor?.chain().focus().setImage({ src: url }).run())
            return true
          }
          return false
        },
        handleDrop: (_view, event) => {
          if (!canEdit) return false
          const file = [...(event.dataTransfer?.files ?? [])][0]
          if (file && file.type.startsWith('image/')) {
            event.preventDefault()
            void uploadImage(file, doc.id).then((url) => url && editor?.chain().focus().setImage({ src: url }).run())
            return true
          }
          return false
        },
      },
      onUpdate: ({ editor: ed }) => {
        if (!canEdit) return
        setSaveState('saving')
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
          void api
            .patch(`/api/docs/${doc.id}`, { contentMarkdown: ed.getMarkdown() })
            .then(() => setSaveState('saved'))
        }, 800)
      },
    },
    [doc.id, canEdit],
  )

  // flush ก่อนสลับหน้า/ปิด (กัน autosave ค้าง)
  useEffect(() => {
    return () => {
      if (canEdit && saveTimer.current && editor) {
        clearTimeout(saveTimer.current)
        void api.patch(`/api/docs/${doc.id}`, { contentMarkdown: editor.getMarkdown() })
      }
    }
  }, [doc.id, editor, canEdit])

  useEffect(() => setTitle(doc.title), [doc.id, doc.title])
  const saveTitle = async () => {
    if (canEdit && title.trim() && title !== doc.title) {
      await api.patch(`/api/docs/${doc.id}`, { title: title.trim() })
      onMetaChanged()
    }
  }
  const onFile = async (f: File) => {
    const url = await uploadImage(f, doc.id)
    if (url) editor?.chain().focus().setImage({ src: url }).run()
  }

  if (!editor) return null
  return (
    <>
      {canEdit && (
        <RichTextToolbar
          editor={editor}
          onPickImage={() => fileRef.current?.click()}
          rightSlot={saveState === 'saving' ? 'กำลังบันทึก…' : <><span className="text-success-500">✓</span> บันทึกแล้ว</>}
        />
      )}
      {canEdit && (
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }}
        />
      )}
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
            บันทึกเป็น Markdown · แก้ล่าสุด {new Date(doc.updatedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {doc.kind === 'file' && (
              <>
                {' · '}
                <a href={`/api/docs/${doc.id}/raw`} className="text-brand-600 hover:underline">ดาวน์โหลดไฟล์ต้นฉบับ</a>
              </>
            )}
          </div>
          <EditorContent editor={editor} />
        </div>
      </div>
    </>
  )
}

const WORD_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
])

/**
 * Pronista §Document Management MVP — ไฟล์ .docx/.doc เปิดแล้วแสดงเนื้อหาเป็น HTML ในแอปทันที (เบราว์เซอร์ไม่มีตัวแสดงผล .docx ในตัว ต่างจาก PDF) แทนการดาวน์โหลดอัตโนมัติ
 * กด "แก้ไขเอกสาร" ครั้งแรก = แปลงเนื้อหาเป็น Markdown เก็บลง contentMarkdown แล้วสลับไปใช้ DocEditor ตัวเดียวกับหน้าวิกิ (แก้ข้อความ+ตารางได้ พร้อม autosave) — ไฟล์ต้นฉบับยังดาวน์โหลดได้เหมือนเดิม
 */
function DocWordPreview({ doc, canEdit, onConverted }: { doc: DocFull; canEdit: boolean; onConverted: () => void }) {
  const [html, setHtml] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [converting, setConverting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setHtml(null)
    setFailed(false)
    api
      .get<{ html: string }>(`/api/docs/${doc.id}/preview`)
      .then((r) => { if (!cancelled) setHtml(r.html) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [doc.id])

  const startEditing = async () => {
    setConverting(true)
    try {
      await api.post(`/api/docs/${doc.id}/convert-to-editable`, {})
      onConverted()
    } finally {
      setConverting(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-5 sm:px-10 py-8">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-5 h-5 text-brand-500 shrink-0" />
            <h2 className="text-2xl font-bold text-ink truncate">{doc.title}</h2>
          </div>
          {canEdit && (
            <button
              onClick={() => void startEditing()}
              disabled={converting}
              className="shrink-0 text-sm bg-brand-600 hover:bg-brand-700 text-white font-medium px-3.5 py-2 rounded-lg disabled:opacity-50"
            >
              {converting ? 'กำลังแปลง…' : 'แก้ไขเอกสาร'}
            </button>
          )}
        </div>
        <div className="text-xs text-muted mb-6">
          ไฟล์ {doc.filename ?? ''} · แก้ล่าสุด {new Date(doc.updatedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          {' · '}
          <a href={`/api/docs/${doc.id}/raw`} className="text-brand-600 hover:underline">ดาวน์โหลดไฟล์ต้นฉบับ</a>
        </div>
        {failed ? (
          <div className="text-sm text-muted">
            ไม่สามารถแสดงตัวอย่างเอกสารนี้ได้ (อาจเป็นไฟล์ .doc รุ่นเก่า หรือไฟล์เสียหาย) —{' '}
            <a href={`/api/docs/${doc.id}/raw`} className="text-brand-600 hover:underline">ดาวน์โหลดไฟล์แทน</a>
          </div>
        ) : html === null ? (
          <div className="text-sm text-muted">กำลังโหลดตัวอย่างเอกสาร…</div>
        ) : (
          <div className="doc-editor" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  )
}

function DocDetailPanel({ doc }: { doc: DocFull }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-5 sm:px-10 py-10">
        <div className="flex items-center gap-2 mb-1">
          {doc.kind === 'link' ? <Link2 className="w-5 h-5 text-info-500" /> : <FileText className="w-5 h-5 text-brand-500" />}
          <h2 className="text-2xl font-bold text-ink">{doc.title}</h2>
        </div>
        <div className="text-xs text-muted mb-6">
          {doc.kind === 'link' ? 'ลิงก์ Google Docs / Drive' : `ไฟล์ ${doc.filename ?? ''}`} · แก้ล่าสุด {new Date(doc.updatedAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          {doc.srsVersion && ` · SRS v${doc.srsVersion}${doc.srsDocNumber ? ` (${doc.srsDocNumber})` : ''}`}
        </div>
        <button
          onClick={() => openDocNode(doc)}
          className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg"
        >
          {doc.kind === 'link' ? <><ExternalLink className="w-4 h-4" /> เปิดลิงก์</> : <><ExternalLink className="w-4 h-4" /> เปิด/ดาวน์โหลดไฟล์</>}
        </button>
        {doc.kind === 'link' && doc.externalUrl && (
          <div className="text-xs text-muted mt-2 break-all">{doc.externalUrl}</div>
        )}
        {doc.srsVersion && <SrsLinkedTasksSection docId={doc.id} />}
      </div>
    </div>
  )
}

/** ผูกเอกสารกับโปรเจกต์/Task/Sub-task — mirror ตัวเลือกย้าย Backlog (BacklogMoveModal ใน Projects.tsx) */
function LinkTaskModal({ doc, onClose }: { doc: DocNode; onClose: () => void }) {
  const [mode, setMode] = useState<'menu' | 'project' | 'task'>('menu')
  const { data: projectOpts } = useLoad<ProjectOpt[]>(() => api.get('/api/projects'))
  const [projectId, setProjectId] = useState('')
  const [boardTasks, setBoardTasks] = useState<BoardTaskOpt[]>([])
  const [taskId, setTaskId] = useState('')
  const [error, setError] = useState('')
  const select = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
  const item = 'w-full text-left text-sm px-4 py-3 rounded-lg border border-border-subtle hover:bg-hover flex items-center gap-2.5'

  const loadBoard = async (pid: string) => {
    setProjectId(pid)
    setTaskId('')
    if (!pid) return setBoardTasks([])
    const b = await api.get<{ groups: { tasks: BoardTaskOpt[] }[] }>(`/api/projects/${pid}/board`)
    setBoardTasks(b.groups.flatMap((g) => g.tasks))
  }

  const linkToProject = async () => {
    try {
      await api.post(`/api/docs/${doc.id}/links`, { projectId })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ผิดพลาด')
    }
  }
  const linkToTask = async () => {
    try {
      await api.post(`/api/docs/${doc.id}/links`, { taskId })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ผิดพลาด')
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-24 mx-auto w-full max-w-sm px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-ink text-sm truncate">ผูกเอกสาร — {doc.title}</div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0">✕</button>
          </div>

          {mode === 'menu' && (
            <div className="space-y-2">
              <button className={item} onClick={() => setMode('project')}>📁 <span>ผูกกับโปรเจกต์</span></button>
              <button className={item} onClick={() => setMode('task')}>✅ <span>ผูกกับ Task / Sub-task</span></button>
            </div>
          )}

          {mode === 'project' && (
            <div className="space-y-3">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={select}>
                <option value="">เลือกโปรเจกต์…</option>
                {(projectOpts ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="flex justify-end gap-2">
                <button onClick={() => setMode('menu')} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ย้อนกลับ</button>
                <button onClick={() => void linkToProject()} disabled={!projectId} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">ผูก</button>
              </div>
            </div>
          )}

          {mode === 'task' && (
            <div className="space-y-3">
              <select value={projectId} onChange={(e) => void loadBoard(e.target.value)} className={select}>
                <option value="">เลือกโปรเจกต์…</option>
                {(projectOpts ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={taskId} onChange={(e) => setTaskId(e.target.value)} className={select} disabled={!projectId}>
                <option value="">{projectId && boardTasks.length === 0 ? 'โปรเจกต์นี้ยังไม่มี task' : 'เลือก task…'}</option>
                {boardTasks.map((t) => <option key={t.id} value={t.id}>{t.code ? `${t.code} · ` : ''}{t.title}</option>)}
              </select>
              <div className="flex justify-end gap-2">
                <button onClick={() => setMode('menu')} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ย้อนกลับ</button>
                <button onClick={() => void linkToTask()} disabled={!taskId} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">ผูก</button>
              </div>
            </div>
          )}
          {error && <div className="text-xs text-danger-600 mt-3">{error}</div>}
        </div>
      </div>
    </div>
  )
}

/** จัดการสิทธิ์ (owner เท่านั้น) — private/team toggle + เพิ่ม/แก้/ลบสมาชิก */
function DocPermissionModal({ doc, onClose, onChanged }: { doc: DocNode; onClose: () => void; onChanged: () => void }) {
  const { data: members, reload } = useLoad<DocMemberRow[]>(() => api.get(`/api/docs/${doc.id}/members`), [doc.id])
  const { data: userOpts } = useLoad<UserOpt[]>(() => api.get('/api/users'))
  const [visibility, setVisibility] = useState(doc.visibility)

  const setVis = async (v: 'private' | 'team') => {
    setVisibility(v)
    await api.patch(`/api/docs/${doc.id}`, { visibility: v })
    onChanged()
  }
  const setRole = async (userId: string, role: 'viewer' | 'editor') => {
    await api.post(`/api/docs/${doc.id}/members`, { userId, role })
    void reload()
  }
  const removeMember = async (userId: string) => {
    await api.delete(`/api/docs/${doc.id}/members/${userId}`)
    void reload()
  }
  const roleOf = (userId: string) => (members ?? []).find((m) => m.id === userId)?.role ?? ''

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-20 mx-auto w-full max-w-md px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-ink text-sm">จัดการสิทธิ์ — {doc.title}</div>
            <button onClick={onClose} className="text-muted hover:text-soft">✕</button>
          </div>
          <div className="flex bg-divider rounded-lg p-0.5 text-sm font-medium mb-4 w-fit">
            <button onClick={() => void setVis('private')} className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 ${visibility === 'private' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}><Lock className="w-3.5 h-3.5" /> ส่วนตัว</button>
            <button onClick={() => void setVis('team')} className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 ${visibility === 'team' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}><Users className="w-3.5 h-3.5" /> ทั้งทีม</button>
          </div>
          <p className="text-xs text-muted mb-3">
            {visibility === 'private' ? 'ส่วนตัว — เห็นได้เฉพาะเจ้าของ + คนที่เพิ่มไว้ด้านล่าง' : 'ทั้งทีม — owner/member ทุกคนเห็น (อย่างน้อยดูอย่างเดียว) เพิ่มคนเป็น editor ได้ถ้าอยากให้แก้ไขได้ด้วย'}
          </p>
          <div className="divide-y divide-divider">
            {(userOpts ?? []).filter((u) => u.id !== doc.ownerId).map((u) => (
              <div key={u.id} className="flex items-center gap-3 py-2.5">
                <span className="flex-1 text-sm text-body">{u.name}</span>
                <select value={roleOf(u.id)} onChange={(e) => void setRole(u.id, e.target.value as 'viewer' | 'editor')} className="text-sm bg-white border border-border rounded-lg px-2.5 py-1.5">
                  <option value="" disabled>— ยังไม่ระบุ —</option>
                  <option value="viewer">ดูอย่างเดียว (viewer)</option>
                  <option value="editor">แก้ไขได้ (editor)</option>
                </select>
                {roleOf(u.id) && <button onClick={() => void removeMember(u.id)} className="text-muted hover:text-danger-600">✕</button>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** หน้าเอกสารเดี่ยว (Pronista §Document search/filter) — full-page ไม่มีทรีข้าง เปิดจากลิสต์เอกสาร/ผลค้นหาเป็นแท็บใหม่เสมอ */
export function DocViewerPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { confirmDialog, promptDialog } = useDialog()
  const { data: doc, reload: reloadDoc } = useLoad<DocFull | null>(() => (id ? api.get(`/api/docs/${id}`) : Promise.resolve(null)), [id])
  const [linking, setLinking] = useState(false)
  const [managingPermission, setManagingPermission] = useState(false)

  // Pronista §Document Management MVP — ไฟล์ .docx/.doc แสดงเนื้อหาเป็น HTML ในหน้านี้เลย (DocWordPreview) ไม่ต้องเปิดแยก
  // ไฟล์ประเภทอื่น (PDF/รูปภาพ ฯลฯ) เบราว์เซอร์แสดงผลได้เองอยู่แล้ว — เปิดตรงไปที่ไฟล์ต้นฉบับทันที ไม่ต้องผ่านหน้ารายละเอียด
  const isWordFile = doc?.kind === 'file' && WORD_MIME_TYPES.has(doc.mime ?? '')
  useEffect(() => {
    if (doc?.kind === 'file' && !isWordFile) window.location.replace(`/api/docs/${doc.id}/raw`)
  }, [doc, isWordFile])

  const duplicateNode = useCallback(async () => {
    if (!doc) return
    const created = await api.post<{ id: string }>(`/api/docs/${doc.id}/duplicate`, {})
    navigate(`/docs/${created.id}`)
  }, [doc, navigate])

  const deleteDoc = useCallback(async () => {
    if (!doc) return
    const yes = await confirmDialog({
      title: 'ลบหน้านี้?',
      message: `"${doc.title}" และหน้าย่อยทั้งหมดจะถูกลบ`,
      confirmLabel: 'ลบ',
      danger: true,
    })
    if (!yes) return
    await api.delete(`/api/docs/${doc.id}`)
    navigate('/docs')
  }, [doc, confirmDialog, navigate])

  // Pronista §Document Traceability fix (2026-09-01) — ตั้ง/แก้ "ประเภทเอกสาร" ทีหลังได้ (ตอนอัปโหลดเป็นแค่ตัวเลือกไม่บังคับ พลาดแล้วไม่มีทางแก้เดิม)
  // ต้องมีทั้งอันนี้ + ผูกโปรเจกต์ (ปุ่ม 🔗) ถึงจะโผล่ใน "ประวัติเอกสาร" และเปิดเปรียบเทียบเอกสารได้
  const setDocType = useCallback(
    async (docType: DocType | '') => {
      if (!doc) return
      await api.patch(`/api/docs/${doc.id}`, { docType: docType || null })
      await reloadDoc()
    },
    [doc, reloadDoc],
  )

  // Pronista §Document Versioning fix (2026-09-01) — ตั้ง/แก้เลขที่เอกสาร+เวอร์ชันทีหลังได้ (เดิมตั้งได้แค่ตอนระบบ gen เอง) — 2 ขั้นตอนเหมือน addLink ใน Docs.tsx
  const editDocVersion = useCallback(async () => {
    if (!doc) return
    const docNumber = await promptDialog({ title: 'เลขที่เอกสาร (ระบุ "เล่ม")', message: 'เอกสารเลขที่เดียวกัน = เล่มเดียวกัน หลายเวอร์ชัน เปรียบเทียบกันได้ในหน้าประวัติเอกสาร', initialValue: doc.docNumber ?? '', placeholder: 'เช่น BNT-MOM-2026-014', confirmLabel: 'ถัดไป' })
    if (docNumber === null) return
    const docVersion = await promptDialog({ title: 'เวอร์ชัน', initialValue: doc.docVersion ?? '', placeholder: 'เช่น 1.0', confirmLabel: 'บันทึก' })
    if (docVersion === null) return
    await api.patch(`/api/docs/${doc.id}`, { docNumber: docNumber.trim() || null, docVersion: docVersion.trim() || null })
    await reloadDoc()
  }, [doc, reloadDoc, promptDialog])

  if (!doc) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>
  if (doc.kind === 'file' && !isWordFile) return <div className="p-6 text-sm text-muted">กำลังเปิดไฟล์…</div>

  const canEdit = canEditAccess(doc.myAccess)
  const canManage = doc.myAccess === 'owner'

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-1 mb-3">
        <Link to="/docs" className="flex items-center gap-1.5 text-sm text-dim hover:text-strong">
          <ArrowLeft className="w-4 h-4" /> กลับไปเอกสารทั้งหมด
        </Link>
        <div className="ml-auto flex items-center gap-2">
          {canEdit && doc.kind !== 'folder' && (
            <select
              value={doc.docType ?? ''}
              onChange={(e) => void setDocType(e.target.value as DocType | '')}
              title="ประเภทเอกสาร — ต้องเลือกไว้ (พร้อมผูกโปรเจกต์) ถึงจะโผล่ใน &quot;ประวัติเอกสาร&quot; และเปรียบเทียบเอกสารได้"
              className="text-xs bg-white border border-border rounded-lg px-2 py-1.5 focus:outline-hidden"
            >
              <option value="">ไม่ระบุประเภท</option>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {canEdit && doc.kind !== 'folder' && (
            <button
              onClick={() => void editDocVersion()}
              title='เลขที่เอกสาร/เวอร์ชัน — ตั้งไว้เพื่อจับกลุ่ม "เล่มเดียวกัน หลายเวอร์ชัน" ในหน้าประวัติเอกสาร/เปรียบเทียบเอกสาร'
              className="text-xs bg-white border border-border rounded-lg px-2 py-1.5 hover:bg-hover text-body whitespace-nowrap"
            >
              {doc.docNumber ? `${doc.docNumber}${doc.docVersion ? ` · v${doc.docVersion}` : ''}` : 'เลขที่เอกสาร'}
            </button>
          )}
          <button onClick={() => void duplicateNode()} className="p-1.5 rounded-lg text-dim hover:bg-divider" title="ทำสำเนา"><Copy className="w-4 h-4" /></button>
          <button onClick={() => setLinking(true)} className="p-1.5 rounded-lg text-dim hover:bg-divider" title="ผูกกับโปรเจกต์/Task"><Link2 className="w-4 h-4" /></button>
          {canManage && <button onClick={() => setManagingPermission(true)} className="p-1.5 rounded-lg text-dim hover:bg-divider" title="จัดการสิทธิ์"><Lock className="w-4 h-4" /></button>}
          {canEdit && <button onClick={() => void deleteDoc()} className="p-1.5 rounded-lg text-border hover:text-danger-600" title="ลบหน้านี้ (รวมหน้าย่อย)"><Trash2 className="w-4 h-4" /></button>}
        </div>
      </div>

      <div className="flex flex-col bg-white rounded-lg shadow-xs overflow-hidden min-h-[calc(100dvh-160px)]">
        {doc.kind === 'page' || (isWordFile && doc.contentMarkdown) ? (
          <DocEditor key={doc.id} doc={doc} canEdit={canEdit} onMetaChanged={() => void reloadDoc()} />
        ) : doc.kind === 'template' ? (
          <TemplateFillForm key={doc.id} doc={doc} canEdit={canEdit} onMetaChanged={() => void reloadDoc()} />
        ) : isWordFile ? (
          <DocWordPreview key={doc.id} doc={doc} canEdit={canEdit} onConverted={() => void reloadDoc()} />
        ) : (
          <DocDetailPanel key={doc.id} doc={doc} />
        )}
      </div>

      {linking && <LinkTaskModal doc={doc} onClose={() => setLinking(false)} />}
      {managingPermission && (
        <DocPermissionModal doc={doc} onClose={() => setManagingPermission(false)} onChanged={() => void reloadDoc()} />
      )}
    </div>
  )
}
