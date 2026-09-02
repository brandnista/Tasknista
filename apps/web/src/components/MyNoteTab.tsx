/**
 * Pronista §My Note — บันทึกอิสระในเมนู "งานของฉัน" ต่อจาก Daily Report
 * รองรับโหมดข้อความอิสระ + checklist และปุ่ม "Convert" แปลงเป็นงานจริง (Epic/Story/Task/Subtask/Defect)
 * Convert ไม่มี endpoint เฉพาะ — เรียกต่อ endpoint สร้างงานที่มีอยู่แล้ว (epics / backlog / patch parentId) ตามชนิดที่เลือก
 * แล้ว PATCH ลิงก์กลับมาไว้ที่ตัว note (linkedKind/linkedTaskId/...) ให้ Post-it โชว์ badge ได้โดยไม่ต้อง join
 * ฝั่งซ้าย = ฟอร์มเขียน + รายการเดิม, ฝั่งขวา = "บอร์ด" — บันทึกเดียวกันแปะเป็น Post-it ให้ดูสนุกขึ้น (ดีไซน์: hallmark)
 */
import { Check, Download, Link2, ListTodo, Paperclip, Pencil, Pin, Plus, Repeat, Share2, Trash2, Type, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { useDialog } from './Dialog'
import { NotificationBell } from './NotificationBell'
import { RichTextEditor } from './RichTextEditor'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useNotifications } from '../lib/notifications-context'
import { useLoad } from '../lib/useLoad'

export type NoteBody = { mode: 'text'; text: string } | { mode: 'checklist'; items: { id: string; text: string; done: boolean }[] }
type ConvertKind = 'epic' | 'story' | 'task' | 'subtask' | 'defect'
export interface Note {
  id: string
  userId: string
  title: string | null
  body: string
  linkedKind: ConvertKind | null
  linkedTaskId: string | null
  linkedCode: string | null
  linkedProjectId: string | null
  linkedProjectName: string | null
  createdAt: number
  updatedAt: number
  // Pronista §My Note sharing (2026-08-28) — ownerName ไม่ว่างเฉพาะบันทึกที่คนอื่นแชร์มา (ของตัวเอง = null) · myRole ว่าง = เจ้าของ
  ownerName: string | null
  myRole?: 'viewer' | 'editor'
}
interface ProjectOpt { id: string; code: string | null; name: string }
interface TaskOpt { id: string; code: string | null; title: string; kind: string }
interface MemberRow { id: string; name: string; role: 'viewer' | 'editor' }
interface UserOpt { id: string; name: string }
interface AttachmentRow { id: string; kind: 'file' | 'link'; name: string; mime: string | null; sizeBytes: number | null; externalUrl: string | null; createdAt: number }

const isNoteOwner = (n: Note, meId: string) => n.userId === meId
const canEditNoteRow = (n: Note, meId: string) => isNoteOwner(n, meId) || n.myRole === 'editor'
const fmtAttSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`)

const CONVERT_LABEL: Record<ConvertKind, string> = { epic: 'Epic', story: 'Story', task: 'Task', subtask: 'Subtask', defect: 'Defect' }

export function parseBody(raw: string): NoteBody {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && (parsed.mode === 'text' || parsed.mode === 'checklist')) return parsed
  } catch {
    // ข้อมูลเก่า/พัง — fallback เป็นข้อความล้วน
  }
  return { mode: 'text', text: raw }
}
const notePreview = (body: NoteBody) =>
  body.mode === 'text' ? body.text.slice(0, 140) : body.items.map((i) => `${i.done ? '☑' : '☐'} ${i.text}`).join(' · ').slice(0, 140)

function ConvertModal({ note, onClose, onDone }: { note: Note; onClose: () => void; onDone: () => void }) {
  const body = parseBody(note.body)
  const defaultTitle = note.title || (body.mode === 'text' ? body.text.slice(0, 80) : body.items[0]?.text.slice(0, 80) || 'งานจาก My Note')
  const { data: projects } = useLoad<ProjectOpt[]>(() => api.get('/api/projects'))
  const [kind, setKind] = useState<ConvertKind>('task')
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState(defaultTitle)
  const [parentId, setParentId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { data: projectTasks } = useLoad<TaskOpt[]>(() => (projectId ? api.get(`/api/projects/${projectId}/tasks/all`) : Promise.resolve([])), [projectId])

  const submit = async () => {
    if (!projectId || !title.trim()) return
    setBusy(true)
    setError('')
    try {
      let created: { id: string; code: string | null }
      if (kind === 'epic') {
        created = await api.post<{ id: string; code: string | null }>(`/api/projects/${projectId}/epics`, { title: title.trim() })
      } else if (kind === 'subtask') {
        if (!parentId) { setError('เลือกงานแม่ก่อน'); setBusy(false); return }
        created = await api.post<{ id: string; code: string | null }>(`/api/projects/${projectId}/backlog`, { title: title.trim(), kind: 'task' })
        await api.patch(`/api/tasks/${created.id}`, { parentId })
      } else {
        created = await api.post<{ id: string; code: string | null }>(`/api/projects/${projectId}/backlog`, {
          title: title.trim(),
          kind: kind === 'defect' ? 'defect' : 'task',
          standalone: kind === 'task',
        })
      }
      const projectName = (projects ?? []).find((p) => p.id === projectId)?.name ?? ''
      await api.patch(`/api/my-notes/${note.id}`, {
        link: { kind, taskId: created.id, code: created.code, projectId, projectName },
      })
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'แปลงงานไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full text-sm bg-white shadow-xs rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
  return (
    <div className="fixed inset-0 bg-ink/40 z-50 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="font-semibold text-strong mb-3">แปลง Note เป็นงาน</div>
        <label className="block text-xs font-medium text-dim mb-1">ชนิดงาน</label>
        <select value={kind} onChange={(e) => setKind(e.target.value as ConvertKind)} className={`${input} mb-3`}>
          {(Object.keys(CONVERT_LABEL) as ConvertKind[]).map((k) => <option key={k} value={k}>{CONVERT_LABEL[k]}</option>)}
        </select>
        <label className="block text-xs font-medium text-dim mb-1">ชื่องาน</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${input} mb-3`} />
        <label className="block text-xs font-medium text-dim mb-1">โปรเจกต์</label>
        <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setParentId('') }} className={`${input} mb-3`}>
          <option value="" disabled>เลือกโปรเจกต์...</option>
          {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {kind === 'subtask' && projectId && (
          <>
            <label className="block text-xs font-medium text-dim mb-1">งานแม่</label>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={`${input} mb-3`}>
              <option value="" disabled>เลือกงานแม่...</option>
              {(projectTasks ?? []).map((t) => <option key={t.id} value={t.id}>{t.code ?? t.title}</option>)}
            </select>
          </>
        )}
        {error && <div className="text-xs text-danger-600 mb-3">{error}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg border border-border text-body hover:bg-hover">ยกเลิก</button>
          <button onClick={() => void submit()} disabled={!projectId || !title.trim() || busy} className="text-sm px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white font-medium">
            แปลงเป็น {CONVERT_LABEL[kind]}
          </button>
        </div>
      </div>
    </div>
  )
}

// Pronista §My Note sharing (2026-08-28) — adapt จาก ShareModal ของ MyFilesTab.tsx (โครงเดียวกัน คนละ endpoint)
// Pronista §My Note share-before-save fix (2026-09-01) — type คลายจาก Note เต็มเป็นแค่ที่ใช้จริง เพื่อให้ note ที่ยังไม่บันทึก (แค่มี id จาก ensureNoteId) เปิดแชร์ได้ด้วย
function NoteShareModal({ note, onClose }: { note: { id: string; title: string | null; userId: string }; onClose: () => void }) {
  const { alertDialog } = useDialog()
  const { data: members, reload } = useLoad<MemberRow[]>(() => api.get(`/api/my-notes/${note.id}/members`), [note.id])
  const { data: users } = useLoad<UserOpt[]>(() => api.get('/api/users'))
  const [pickUserId, setPickUserId] = useState('')
  const [pickRole, setPickRole] = useState<'viewer' | 'editor'>('viewer')
  const memberIds = new Set((members ?? []).map((m) => m.id))
  const options = (users ?? []).filter((u) => !memberIds.has(u.id) && u.id !== note.userId)

  const add = async () => {
    if (!pickUserId) return
    try {
      await api.post(`/api/my-notes/${note.id}/members`, { userId: pickUserId, role: pickRole })
      setPickUserId('')
      await reload()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'แชร์ไม่สำเร็จ' })
    }
  }
  const remove = async (userId: string) => {
    await api.delete(`/api/my-notes/${note.id}/members/${userId}`)
    await reload()
  }
  const changeRole = async (userId: string, role: 'viewer' | 'editor') => {
    await api.post(`/api/my-notes/${note.id}/members`, { userId, role })
    await reload()
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-ink text-sm">แชร์ "{note.title || 'บันทึกไม่มีหัวข้อ'}"</div>
          <button onClick={onClose} className="p-1 rounded hover:bg-hover text-dim"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex gap-2">
          <select value={pickUserId} onChange={(e) => setPickUserId(e.target.value)} className="flex-1 text-sm bg-hover rounded-lg px-2 py-2 focus:outline-hidden">
            <option value="">— เลือกคน —</option>
            {options.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={pickRole} onChange={(e) => setPickRole(e.target.value as 'viewer' | 'editor')} className="text-sm bg-hover rounded-lg px-2 py-2 focus:outline-hidden">
            <option value="viewer">ดูอย่างเดียว</option>
            <option value="editor">แก้ไขได้</option>
          </select>
          <button onClick={() => void add()} disabled={!pickUserId} className="text-sm text-white bg-brand-600 hover:bg-brand-700 px-3 py-2 rounded-lg disabled:opacity-40">เพิ่ม</button>
        </div>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {(members ?? []).length === 0 && <div className="text-xs text-muted text-center py-4">ยังไม่ได้แชร์ให้ใคร</div>}
          {(members ?? []).map((m) => (
            <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-hover">
              <span className="text-sm text-body flex-1 truncate">{m.name}</span>
              <select value={m.role} onChange={(e) => void changeRole(m.id, e.target.value as 'viewer' | 'editor')} className="text-xs bg-hover rounded-lg px-1.5 py-1 focus:outline-hidden">
                <option value="viewer">ดูอย่างเดียว</option>
                <option value="editor">แก้ไขได้</option>
              </select>
              <button onClick={() => void remove(m.id)} className="text-border hover:text-danger-600"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Pronista §My Note attachments (2026-08-31) — แนบไฟล์ได้ตั้งแต่ตอนกำลังเขียนบันทึกใหม่ (ยังไม่กด "บันทึก")
// noteId = null ตอนกำลังสร้างใหม่ → เรียก ensureNoteId() สร้างบันทึก (silent draft) ก่อน แล้วค่อยอัปโหลดแนบเข้าไป
function NoteAttachments({ noteId, canEdit, ensureNoteId }: { noteId: string | null; canEdit: boolean; ensureNoteId?: () => Promise<string> }) {
  const { alertDialog, confirmDialog, promptDialog } = useDialog()
  const [resolvedId, setResolvedId] = useState<string | null>(noteId)
  useEffect(() => { if (noteId) setResolvedId(noteId) }, [noteId])
  const { data: attachments, reload } = useLoad<AttachmentRow[]>(() => (resolvedId ? api.get(`/api/my-notes/${resolvedId}/attachments`) : Promise.resolve([])), [resolvedId])
  const [uploading, setUploading] = useState(false)

  const uploadFiles = async (fileList: FileList) => {
    // สแนปช็อตไฟล์ไว้ก่อน await ใดๆ — caller เคลียร์ input.value ทันทีหลังเรียกฟังก์ชันนี้ (fire-and-forget)
    // ซึ่งเป็น live FileList เดียวกัน ถ้ามี await (เช่น ensureNoteId ตอนสร้างบันทึกใหม่) มาคั่นก่อน Array.from ไฟล์จะหายไปเงียบๆ
    const files = Array.from(fileList)
    setUploading(true)
    const failed: string[] = []
    try {
      let id = resolvedId
      if (!id && ensureNoteId) {
        id = await ensureNoteId()
        setResolvedId(id)
      }
      if (!id) return
      for (const file of files) {
        try {
          const form = new FormData()
          form.set('file', file)
          await api.post(`/api/my-notes/${id}/attachments`, form)
        } catch {
          failed.push(file.name)
        }
      }
      await reload()
      if (failed.length > 0) await alertDialog({ title: `แนบไฟล์ไม่สำเร็จ ${failed.length} ไฟล์: ${failed.join(', ')}` })
    } finally {
      setUploading(false)
    }
  }
  // แนบลิงก์ Google Docs/Drive — mirror addLink ของ Docs.tsx/MyFilesTab.tsx (สร้าง draft ให้ก่อนถ้ายังไม่มี noteId เหมือน uploadFiles)
  const addLink = async () => {
    const name = await promptDialog({ title: 'ลิงก์ Google Docs / Drive', placeholder: 'ชื่อไฟล์…', confirmLabel: 'ถัดไป' })
    if (!name?.trim()) return
    const url = await promptDialog({ title: 'วางลิงก์', placeholder: 'https://docs.google.com/...', confirmLabel: 'แนบ' })
    if (!url?.trim()) return
    try {
      let id = resolvedId
      if (!id && ensureNoteId) {
        id = await ensureNoteId()
        setResolvedId(id)
      }
      if (!id) return
      await api.post(`/api/my-notes/${id}/attachments/link`, { name: name.trim(), externalUrl: url.trim() })
      await reload()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'แนบลิงก์ไม่สำเร็จ' })
    }
  }
  const removeAttachment = async (a: AttachmentRow) => {
    const ok = await confirmDialog({ title: `ลบไฟล์แนบ "${a.name}"?`, confirmLabel: 'ลบ', danger: true })
    if (!ok) return
    await api.delete(`/api/my-notes/attachments/${a.id}`)
    await reload()
  }

  return (
    <div className="border-t border-border-subtle pt-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-dim flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" /> ไฟล์แนบ</span>
        {canEdit && (
          <div className="flex items-center gap-2.5">
            <label className="inline-flex items-center gap-1 text-[11px] text-brand-600 hover:text-brand-700 font-medium cursor-pointer">
              <Upload className="w-3 h-3" /> {uploading ? 'กำลังแนบ...' : 'แนบไฟล์'}
              <input type="file" multiple className="hidden" disabled={uploading} onChange={(e) => { const files = e.target.files; if (files && files.length > 0) void uploadFiles(files); e.target.value = '' }} />
            </label>
            <button onClick={() => void addLink()} className="inline-flex items-center gap-1 text-[11px] text-brand-600 hover:text-brand-700 font-medium">
              <Link2 className="w-3 h-3" /> แนบลิงก์
            </button>
          </div>
        )}
      </div>
      {(attachments ?? []).length === 0 ? (
        <div className="text-[11px] text-muted">ยังไม่มีไฟล์แนบ</div>
      ) : (
        <div className="space-y-1">
          {(attachments ?? []).map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-xs bg-hover rounded-lg px-2.5 py-1.5">
              {a.kind === 'link' ? (
                <a href={a.externalUrl ?? '#'} target="_blank" rel="noreferrer" className="flex-1 min-w-0 flex items-center gap-1.5 text-body hover:text-brand-700 truncate">
                  <Link2 className="w-3 h-3 shrink-0 text-info-500" /> <span className="truncate">{a.name}</span>
                </a>
              ) : (
                <a href={`/api/my-notes/attachments/${a.id}/download`} target="_blank" rel="noreferrer" className="flex-1 min-w-0 flex items-center gap-1.5 text-body hover:text-brand-700 truncate">
                  <Download className="w-3 h-3 shrink-0" /> <span className="truncate">{a.name}</span>
                </a>
              )}
              <span className="text-[10px] text-muted shrink-0 w-12 text-right">{a.kind === 'file' && a.sizeBytes != null ? fmtAttSize(a.sizeBytes) : ''}</span>
              {canEdit && <button onClick={() => void removeAttachment(a)} className="text-border hover:text-danger-600 shrink-0"><Trash2 className="w-3 h-3" /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Pronista §My Note Edit (2026-08-27) — ฟอร์มเดียวใช้ทั้งสร้างใหม่และแก้ไขของเดิม
 * ตัดสินใจ POST/PATCH จาก `editing` — parent ใส่ key={editing?.id ?? 'new'} กำกับไว้ให้ remount สดใหม่ทุกครั้งที่สลับเป้าหมาย (เหมือน resetKey เดิมของ RichTextEditor)
 */
function NoteEditor({ editing, meId, onSaved, onCancel, onDraftCreated }: { editing?: Note | null; meId: string; onSaved: () => void; onCancel?: () => void; onDraftCreated?: () => void }) {
  const initialBody = editing ? parseBody(editing.body) : null
  const readOnly = !!editing && !canEditNoteRow(editing, meId)
  const [shareOpen, setShareOpen] = useState(false)
  const [title, setTitle] = useState(editing?.title ?? '')
  const [mode, setMode] = useState<'text' | 'checklist'>(initialBody?.mode ?? 'text')
  const [text, setText] = useState(initialBody?.mode === 'text' ? initialBody.text : '')
  const [resetKey, setResetKey] = useState(0)
  const [items, setItems] = useState<{ id: string; text: string; done: boolean }[]>(initialBody?.mode === 'checklist' ? initialBody.items : [])
  const [itemDraft, setItemDraft] = useState('')
  // Pronista §My Note attachments (2026-08-31) — บันทึกใหม่ที่ยังไม่กด "บันทึก" แต่แนบไฟล์แล้ว → สร้างเป็น draft เงียบๆ ไว้ก่อน (ดู ensureNoteId ด้านล่าง) กัน POST ซ้ำตอนกด "บันทึก" จริง
  const [draftId, setDraftId] = useState<string | null>(null)
  const activeNoteId = editing?.id ?? draftId

  const addItem = () => {
    if (!itemDraft.trim()) return
    setItems([...items, { id: crypto.randomUUID(), text: itemDraft.trim(), done: false }])
    setItemDraft('')
  }
  const ensureNoteId = async (): Promise<string> => {
    if (activeNoteId) return activeNoteId
    const body: NoteBody = mode === 'text' ? { mode: 'text', text } : { mode: 'checklist', items }
    const created = await api.post<Note>('/api/my-notes', { title: title.trim() || null, body })
    setDraftId(created.id)
    onDraftCreated?.()
    return created.id
  }
  // Pronista §My Note share-before-save fix (2026-09-01) — เดิมแชร์ได้แค่บันทึกที่บันทึกไปแล้ว (editing เท่านั้น) — สร้าง draft เงียบๆ ก่อนเปิดแชร์ เหมือน pattern การแนบไฟล์/ลิงก์
  const openShare = async () => {
    await ensureNoteId()
    setShareOpen(true)
  }
  const save = async () => {
    const body: NoteBody = mode === 'text' ? { mode: 'text', text } : { mode: 'checklist', items }
    if (mode === 'text' ? !text.trim() : items.length === 0) return
    if (activeNoteId) {
      await api.patch(`/api/my-notes/${activeNoteId}`, { title: title.trim() || null, body })
    } else {
      await api.post('/api/my-notes', { title: title.trim() || null, body })
    }
    if (!editing) {
      // เคลียร์ฟอร์มไว้เขียนบันทึกใหม่ต่อได้เลย (เฉพาะโหมดสร้างใหม่ — โหมดแก้ไข parent จะปิดฟอร์มนี้ทิ้งหลัง onSaved)
      setTitle('')
      setText('')
      setItems([])
      setResetKey((k) => k + 1)
      setDraftId(null)
    }
    onSaved()
  }

  return (
    <div className="bg-white rounded-lg shadow-xs p-4 space-y-3">
      {editing && (
        <div className="flex items-center justify-between text-xs font-medium text-brand-700 bg-brand-50 -mx-4 -mt-4 px-4 py-2 rounded-t-lg">
          <span className="flex items-center gap-1.5"><Pencil className="w-3 h-3" /> {readOnly ? 'กำลังดูบันทึก' : 'กำลังแก้ไขบันทึก'}{editing.ownerName ? ` — ของ ${editing.ownerName}` : ''}</span>
          <div className="flex items-center gap-2">
            {isNoteOwner(editing, meId) && (
              <button onClick={() => setShareOpen(true)} title="แชร์" className="text-brand-700/70 hover:text-brand-800 flex items-center gap-1"><Share2 className="w-3.5 h-3.5" /></button>
            )}
            <button onClick={onCancel} className="text-dim hover:text-body"><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}
      <input readOnly={readOnly} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="หัวข้อ (ไม่บังคับ)" className="w-full text-sm font-medium bg-hover rounded-lg px-3 py-2 outline-hidden disabled:opacity-70" />
      {!readOnly && (
        <div className="flex items-center justify-between">
          <div className="flex bg-divider rounded-lg p-0.5 text-xs font-medium w-fit">
            <button onClick={() => setMode('text')} className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 ${mode === 'text' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>
              <Type className="w-3.5 h-3.5" /> ข้อความ
            </button>
            <button onClick={() => setMode('checklist')} className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 ${mode === 'checklist' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>
              <ListTodo className="w-3.5 h-3.5" /> Checklist
            </button>
          </div>
          {/* Pronista §My Note share-before-save fix (2026-09-01) — แถบ "กำลังแก้ไขบันทึก" มีปุ่มแชร์ของตัวเองอยู่แล้วสำหรับบันทึกเดิม ปุ่มนี้ครอบเฉพาะตอนกำลังแต่งบันทึกใหม่ */}
          {!editing && (
            <button onClick={() => void openShare()} title="แชร์" className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
              <Share2 className="w-3.5 h-3.5" /> แชร์
            </button>
          )}
        </div>
      )}
      {mode === 'text' ? (
        <RichTextEditor key={resetKey} content={initialBody?.mode === 'text' ? initialBody.text : ''} onChange={readOnly ? undefined : setText} editable={!readOnly} placeholder="พิมพ์บันทึก..." minHeight="min-h-20" />
      ) : (
        <div className="space-y-1.5">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={readOnly} checked={it.done} onChange={() => setItems(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))} />
              <span className={`flex-1 ${it.done ? 'line-through text-muted' : 'text-body'}`}>{it.text}</span>
              {!readOnly && <button onClick={() => setItems(items.filter((x) => x.id !== it.id))} className="text-border hover:text-danger-600"><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
          ))}
          {!readOnly && (
            <div className="flex gap-2">
              <input
                value={itemDraft}
                onChange={(e) => setItemDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addItem() }}
                placeholder="เพิ่มรายการ..."
                className="flex-1 text-sm bg-hover rounded-lg px-3 py-2 outline-hidden"
              />
              <button onClick={addItem} className="text-xs px-3 py-1.5 rounded-lg border border-border-subtle hover:bg-hover flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> เพิ่ม</button>
            </div>
          )}
        </div>
      )}
      <NoteAttachments noteId={activeNoteId} canEdit={!readOnly} ensureNoteId={readOnly ? undefined : ensureNoteId} />
      <div className="flex justify-end gap-2">
        {readOnly ? (
          <button onClick={onCancel} className="text-sm px-3.5 py-2 rounded-lg text-soft hover:bg-hover">ปิด</button>
        ) : (
          <>
            {editing && <button onClick={onCancel} className="text-sm px-3.5 py-2 rounded-lg text-soft hover:bg-hover">ยกเลิก</button>}
            <button onClick={() => void save()} className="text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg">
              {editing ? 'บันทึกการแก้ไข' : 'บันทึก'}
            </button>
          </>
        )}
      </div>
      {shareOpen && activeNoteId && (
        <NoteShareModal
          note={editing ? { id: editing.id, title: editing.title, userId: editing.userId } : { id: activeNoteId, title: title || null, userId: meId }}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  )
}

// Post-it สีตกแต่งล้วน (ไม่ใช่ semantic token — เหมือน AVATAR_COLORS ใน ProjectDetail.tsx) สุ่มแบบ deterministic ตาม note.id
const POSTIT_PALETTE = [
  { bg: 'bg-amber-100', tape: 'bg-amber-300/70' },
  { bg: 'bg-pink-100', tape: 'bg-pink-300/70' },
  { bg: 'bg-sky-100', tape: 'bg-sky-300/70' },
  { bg: 'bg-emerald-100', tape: 'bg-emerald-300/70' },
  { bg: 'bg-violet-100', tape: 'bg-violet-300/70' },
  { bg: 'bg-orange-100', tape: 'bg-orange-300/70' },
]
const POSTIT_ROTATIONS = [-4, -2.5, -1, 1.5, 2.5, 4]
const hashOf = (key: string) => [...key].reduce((s, ch) => s + ch.charCodeAt(0), 0)

function PostIt({ note, meId, isNew, onOpenConvert, onEdit, onDelete }: { note: Note; meId: string; isNew: boolean; onOpenConvert: () => void; onEdit: () => void; onDelete: () => void }) {
  const body = parseBody(note.body)
  const palette = POSTIT_PALETTE[hashOf(note.id) % POSTIT_PALETTE.length]!
  const rotation = POSTIT_ROTATIONS[hashOf(`${note.id}r`) % POSTIT_ROTATIONS.length]!
  const canEdit = canEditNoteRow(note, meId)
  // Pronista §My Note board fix (2026-09-01) — เดิม checklist ถูกรวมเป็นข้อความเดียวคั่นด้วย "·" อ่านเป็นพรืดไม่ออก แยกเป็นบรรทัดเหมือนลิสต์ฝั่งซ้าย (จำกัด 5 แถวแรก)
  const MAX_CHECKLIST_ROWS = 5
  return (
    <div
      style={{ '--postit-rot': `${rotation}deg` } as CSSProperties}
      onClick={onEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onEdit() }}
      className={`postit-note group relative w-56 shrink-0 rounded-sm ${palette.bg} shadow-md p-4 pt-5 cursor-pointer ${isNew ? 'so-postit-drop' : ''}`}
    >
      <span className={`absolute -top-2 left-1/2 -translate-x-1/2 w-10 h-4 rounded-xs rotate-1 ${palette.tape}`} />
      {/* ปุ่ม Convert/ลบ — โชว์ตลอดบนมือถือ (ไม่มี hover) ซ่อนไว้จนโฮเวอร์เฉพาะจอที่มีเมาส์จริง (sm ขึ้นไป) — บันทึกที่ถูกแชร์มาแบบดูอย่างเดียวเห็นแค่ไอคอนเปิดดู */}
      <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        <button onClick={(e) => { e.stopPropagation(); onEdit() }} title={canEdit ? 'แก้ไข' : 'ดูบันทึก'} className="text-ink/35 hover:text-brand-700 p-0.5"><Pencil className="w-3.5 h-3.5" /></button>
        {canEdit && (
          <>
            <button onClick={(e) => { e.stopPropagation(); onOpenConvert() }} title="Convert เป็นงาน" className="text-ink/35 hover:text-brand-700 p-0.5"><Repeat className="w-3.5 h-3.5" /></button>
            <button onClick={(e) => { e.stopPropagation(); onDelete() }} title="ลบ" className="text-ink/35 hover:text-danger-600 p-0.5"><Trash2 className="w-3.5 h-3.5" /></button>
          </>
        )}
      </div>
      {note.title && <div className="text-sm font-semibold text-ink/90 mb-1 pr-14 line-clamp-2">{note.title}</div>}
      {body.mode === 'text' ? (
        <div className="text-[13px] leading-snug text-ink/80 line-clamp-6 whitespace-pre-wrap min-h-10">{body.text.slice(0, 280) || 'ไม่มีเนื้อหา'}</div>
      ) : (
        <div className="text-[13px] leading-snug text-ink/80 min-h-10 space-y-0.5">
          {body.items.length === 0 && <div className="text-ink/50">ไม่มีเนื้อหา</div>}
          {body.items.slice(0, MAX_CHECKLIST_ROWS).map((it) => (
            <div key={it.id} className={`flex items-start gap-1.5 ${it.done ? 'line-through text-ink/50' : ''}`}>
              <span className="shrink-0">{it.done ? '☑' : '☐'}</span>
              <span className="truncate">{it.text}</span>
            </div>
          ))}
          {body.items.length > MAX_CHECKLIST_ROWS && <div className="text-ink/50">+{body.items.length - MAX_CHECKLIST_ROWS} รายการ</div>}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-ink/10">
        <span className="text-[10px] text-ink/50">{new Date(note.updatedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</span>
        <div className="flex items-center gap-1">
          {note.ownerName && (
            <span title={`แชร์โดย ${note.ownerName}`} className="inline-flex items-center gap-1 text-[10px] font-medium text-ink/70 bg-white/60 rounded-full px-2 py-0.5">
              {note.ownerName}
            </span>
          )}
          {note.linkedTaskId && note.linkedKind && note.linkedProjectId && (
            <Link
              to={note.linkedKind === 'epic' ? `/projects/${note.linkedProjectId}` : `/projects/${note.linkedProjectId}?task=${note.linkedTaskId}`}
              title={note.linkedProjectName ?? ''}
              className="inline-flex items-center gap-1 text-[10px] font-medium text-ink/70 bg-white/60 rounded-full px-2 py-0.5 hover:bg-white"
            >
              <Link2 className="w-2.5 h-2.5" /> {note.linkedCode ?? CONVERT_LABEL[note.linkedKind]}
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

type BoardTab = 'own' | 'shared'

// Pronista §My Note board tabs (2026-09-01) — เดิมย้ายบันทึกที่แชร์มาไปหน้า "แชร์กับฉัน" แยกต่างหาก พี่แจ้งว่าไม่ใช่ที่ที่ควรอยู่
// ย้ายกลับมาที่ My Note เหมือนเดิม แต่แยกเป็นแท็บในบอร์ดฝั่งขวาแทนที่จะปนกับบันทึกของตัวเองบนบอร์ดเดียว
function NoteBoard({
  tab, onTabChange, notes, meId, onOpenConvert, onEdit, onDelete,
}: {
  tab: BoardTab
  onTabChange: (t: BoardTab) => void
  notes: Note[]
  meId: string
  onOpenConvert: (n: Note) => void
  onEdit: (n: Note) => void
  onDelete: (n: Note) => void
}) {
  const prevIds = useRef<Set<string> | null>(null)
  const [newIds, setNewIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const currentIds = new Set(notes.map((n) => n.id))
    if (prevIds.current) {
      const added = notes.filter((n) => !prevIds.current!.has(n.id)).map((n) => n.id)
      if (added.length) {
        setNewIds(new Set(added))
        const t = setTimeout(() => setNewIds(new Set()), 550)
        prevIds.current = currentIds
        return () => clearTimeout(t)
      }
    }
    prevIds.current = currentIds
  }, [notes])

  return (
    <div className="note-board relative flex-1 min-w-0 w-full rounded-2xl border border-border-subtle p-5 sm:p-6 min-h-[420px]">
      <div className="flex items-center gap-1.5 text-xs font-medium text-dim mb-4">
        <Pin className="w-3.5 h-3.5 shrink-0" />
        <div className="flex bg-divider rounded-lg p-0.5 w-fit">
          <button onClick={() => onTabChange('own')} className={`px-3 py-1 rounded-md ${tab === 'own' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>
            บอร์ดบันทึกของฉัน
          </button>
          <button
            onClick={() => onTabChange('shared')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md ${tab === 'shared' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}
          >
            บอร์ดที่แชร์กับฉัน
            {/* Pronista §My Note badge (2026-09-01) — เลขแจ้งเตือนบนแท็บเอง คู่กับ badge ที่เมนูข้าง (my-tasks/notes) */}
            <NotificationBell types={['note_shared']} />
          </button>
        </div>
      </div>
      {notes.length === 0 ? (
        <div className="grid place-items-center h-64 text-sm text-muted">
          {tab === 'own' ? 'บันทึกแรกของคุณจะแปะที่นี่ ✨' : 'ยังไม่มีใครแชร์บันทึกมาให้'}
        </div>
      ) : (
        <div className="flex flex-wrap gap-6 sm:gap-7 pb-2">
          {notes.map((n) => (
            <PostIt key={n.id} note={n} meId={meId} isNew={newIds.has(n.id)} onOpenConvert={() => onOpenConvert(n)} onEdit={() => onEdit(n)} onDelete={() => onDelete(n)} />
          ))}
        </div>
      )}
    </div>
  )
}

export function MyNoteTab() {
  const { user } = useAuth()
  const meId = user?.id ?? ''
  const { confirmDialog } = useDialog()
  const { data: notesList, reload } = useLoad<Note[]>(() => api.get('/api/my-notes'))
  // Pronista §My Note board tabs (2026-09-01) — บอร์ดที่แชร์กับฉัน (บันทึกที่คนอื่นแชร์มาหรือฉันแชร์ออกไป) — ดึงคู่กับของตัวเองเสมอ สลับแค่ว่าจะโชว์อันไหนบนบอร์ด
  const { data: sharedNotesList, reload: reloadShared } = useLoad<Note[]>(() => api.get('/api/my-notes/shared'))
  const { markTypeRead } = useNotifications()
  const [boardTab, setBoardTab] = useState<'own' | 'shared'>('own')
  // Pronista §My Note badge (2026-09-01) — เปิดแท็บ "บอร์ดที่แชร์กับฉัน" แล้ว mark note_shared อ่านทันที กัน badge ค้างหลังกดเข้ามาดูแล้ว
  const changeBoardTab = (t: 'own' | 'shared') => {
    setBoardTab(t)
    if (t === 'shared') void markTypeRead('note_shared')
  }
  const [convertingNote, setConvertingNote] = useState<Note | null>(null)
  // Pronista §My Note Edit (2026-08-27) — note ที่กำลังแก้ไขอยู่ (null = ฟอร์มบนสุดอยู่ในโหมด "สร้างใหม่")
  const [editingNote, setEditingNote] = useState<Note | null>(null)

  const reloadAll = () => { void reload(); void reloadShared() }

  const remove = async (n: Note) => {
    const ok = await confirmDialog({ title: 'ลบบันทึกนี้?', message: n.title || notePreview(parseBody(n.body)), confirmLabel: 'ลบ', danger: true })
    if (!ok) return
    if (editingNote?.id === n.id) setEditingNote(null)
    await api.delete(`/api/my-notes/${n.id}`)
    reloadAll()
  }

  return (
    // Pronista §Menu Restructure (2026-09-02) — สลับฝั่ง: บอร์ดงานย้ายมาซ้าย, ฟอร์มเขียน+รายการเดิมไปขวา (DOM order = ลำดับซ้าย→ขวาใน flex-row)
    <div className="flex flex-col lg:flex-row-reverse gap-5 lg:gap-6 items-start">
      <div className="w-full lg:w-[45%] lg:shrink-0 space-y-4">
        <NoteEditor
          key={editingNote?.id ?? 'new'}
          editing={editingNote}
          meId={meId}
          onCancel={() => setEditingNote(null)}
          onSaved={() => {
            setEditingNote(null)
            reloadAll()
          }}
          onDraftCreated={reloadAll}
        />

        {!notesList ? (
          <div className="text-center text-sm text-muted py-8">กำลังโหลด…</div>
        ) : notesList.length === 0 ? (
          <div className="bg-white rounded-lg shadow-xs text-center text-sm text-muted py-10">ยังไม่มีบันทึก — เริ่มเขียนด้านบนได้เลย</div>
        ) : (
          <div className="space-y-2">
            {notesList.map((n) => {
              const body = parseBody(n.body)
              const canEdit = canEditNoteRow(n, meId)
              return (
                <div
                  key={n.id}
                  onClick={() => setEditingNote(n)}
                  className={`bg-white rounded-lg shadow-xs px-4 py-3 cursor-pointer hover:shadow-sm ${editingNote?.id === n.id ? 'ring-2 ring-brand-400' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        {n.title && <div className="text-sm font-medium text-strong">{n.title}</div>}
                        {n.ownerName && <span className="text-[10px] font-medium text-brand-700 bg-brand-50 rounded-full px-2 py-0.5 shrink-0">แชร์โดย {n.ownerName}</span>}
                      </div>
                      {body.mode === 'text' ? (
                        <RichTextEditor content={body.text} editable={false} bare />
                      ) : (
                        <div className="space-y-0.5">
                          {body.items.map((it) => (
                            <div key={it.id} className="flex items-center gap-1.5 text-sm">
                              <span className={`w-4 h-4 rounded border shrink-0 grid place-items-center ${it.done ? 'bg-brand-600 border-brand-600' : 'border-border'}`}>
                                {it.done && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                              </span>
                              <span className={it.done ? 'line-through text-muted' : 'text-body'}>{it.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="text-[10px] text-muted mt-1">{new Date(n.updatedAt).toLocaleString('th-TH')}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={(e) => { e.stopPropagation(); setEditingNote(n) }} title={canEdit ? 'แก้ไข' : 'ดูบันทึก'} className="text-dim hover:text-brand-700"><Pencil className="w-3.5 h-3.5" /></button>
                      {canEdit && (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); setConvertingNote(n) }} className="inline-flex items-center gap-1 text-[11px] text-brand-700 hover:underline">
                            <Repeat className="w-3 h-3" /> Convert
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); void remove(n) }} className="text-border hover:text-danger-600"><Trash2 className="w-3.5 h-3.5" /></button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <NoteBoard
        tab={boardTab}
        onTabChange={changeBoardTab}
        notes={(boardTab === 'own' ? notesList : sharedNotesList) ?? []}
        meId={meId}
        onOpenConvert={setConvertingNote}
        onEdit={setEditingNote}
        onDelete={(n) => void remove(n)}
      />

      {convertingNote && (
        <ConvertModal
          note={convertingNote}
          onClose={() => setConvertingNote(null)}
          onDone={() => { setConvertingNote(null); reloadAll() }}
        />
      )}
    </div>
  )
}
