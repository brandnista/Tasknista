/**
 * Pronista §My Note — บันทึกอิสระในเมนู "งานของฉัน" ต่อจาก Daily Report
 * รองรับโหมดข้อความอิสระ + checklist และปุ่ม "Convert" แปลงเป็นงานจริง (Epic/Story/Task/Subtask/Defect)
 * Convert ไม่มี endpoint เฉพาะ — เรียกต่อ endpoint สร้างงานที่มีอยู่แล้ว (epics / backlog / patch parentId) ตามชนิดที่เลือก
 * แล้ว PATCH ลิงก์กลับมาไว้ที่ตัว note (linkedKind/linkedTaskId/...) ให้ Post-it โชว์ badge ได้โดยไม่ต้อง join
 * ฝั่งซ้าย = ฟอร์มเขียน + รายการเดิม, ฝั่งขวา = "บอร์ด" — บันทึกเดียวกันแปะเป็น Post-it ให้ดูสนุกขึ้น (ดีไซน์: hallmark)
 */
import { Check, Link2, ListTodo, Pin, Plus, Repeat, Trash2, Type } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { useDialog } from './Dialog'
import { RichTextEditor } from './RichTextEditor'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'

type NoteBody = { mode: 'text'; text: string } | { mode: 'checklist'; items: { id: string; text: string; done: boolean }[] }
type ConvertKind = 'epic' | 'story' | 'task' | 'subtask' | 'defect'
interface Note {
  id: string
  title: string | null
  body: string
  linkedKind: ConvertKind | null
  linkedTaskId: string | null
  linkedCode: string | null
  linkedProjectId: string | null
  linkedProjectName: string | null
  createdAt: number
  updatedAt: number
}
interface ProjectOpt { id: string; code: string | null; name: string }
interface TaskOpt { id: string; code: string | null; title: string; kind: string }

const CONVERT_LABEL: Record<ConvertKind, string> = { epic: 'Epic', story: 'Story', task: 'Task', subtask: 'Subtask', defect: 'Defect' }

function parseBody(raw: string): NoteBody {
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

function NoteEditor({ onSaved }: { onSaved: () => void }) {
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<'text' | 'checklist'>('text')
  const [text, setText] = useState('')
  const [resetKey, setResetKey] = useState(0)
  const [items, setItems] = useState<{ id: string; text: string; done: boolean }[]>([])
  const [itemDraft, setItemDraft] = useState('')

  const addItem = () => {
    if (!itemDraft.trim()) return
    setItems([...items, { id: crypto.randomUUID(), text: itemDraft.trim(), done: false }])
    setItemDraft('')
  }
  const save = async () => {
    const body: NoteBody = mode === 'text' ? { mode: 'text', text } : { mode: 'checklist', items }
    if (mode === 'text' ? !text.trim() : items.length === 0) return
    await api.post('/api/my-notes', { title: title.trim() || null, body })
    setTitle('')
    setText('')
    setResetKey((k) => k + 1)
    setItems([])
    onSaved()
  }

  return (
    <div className="bg-white rounded-lg shadow-xs p-4 space-y-3">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="หัวข้อ (ไม่บังคับ)" className="w-full text-sm font-medium bg-hover rounded-lg px-3 py-2 outline-hidden" />
      <div className="flex bg-divider rounded-lg p-0.5 text-xs font-medium w-fit">
        <button onClick={() => setMode('text')} className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 ${mode === 'text' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>
          <Type className="w-3.5 h-3.5" /> ข้อความ
        </button>
        <button onClick={() => setMode('checklist')} className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 ${mode === 'checklist' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>
          <ListTodo className="w-3.5 h-3.5" /> Checklist
        </button>
      </div>
      {mode === 'text' ? (
        <RichTextEditor key={resetKey} content="" onChange={setText} placeholder="พิมพ์บันทึก..." minHeight="min-h-20" />
      ) : (
        <div className="space-y-1.5">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={it.done} onChange={() => setItems(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))} />
              <span className={`flex-1 ${it.done ? 'line-through text-muted' : 'text-body'}`}>{it.text}</span>
              <button onClick={() => setItems(items.filter((x) => x.id !== it.id))} className="text-border hover:text-danger-600"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
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
        </div>
      )}
      <div className="flex justify-end">
        <button onClick={() => void save()} className="text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg">บันทึก</button>
      </div>
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

function PostIt({ note, isNew, onOpenConvert, onDelete }: { note: Note; isNew: boolean; onOpenConvert: () => void; onDelete: () => void }) {
  const body = parseBody(note.body)
  const palette = POSTIT_PALETTE[hashOf(note.id) % POSTIT_PALETTE.length]!
  const rotation = POSTIT_ROTATIONS[hashOf(`${note.id}r`) % POSTIT_ROTATIONS.length]!
  const preview = notePreview(body)
  return (
    <div
      style={{ '--postit-rot': `${rotation}deg` } as CSSProperties}
      className={`postit-note group relative w-56 shrink-0 rounded-sm ${palette.bg} shadow-md p-4 pt-5 ${isNew ? 'so-postit-drop' : ''}`}
    >
      <span className={`absolute -top-2 left-1/2 -translate-x-1/2 w-10 h-4 rounded-xs rotate-1 ${palette.tape}`} />
      {/* ปุ่ม Convert/ลบ — โชว์ตลอดบนมือถือ (ไม่มี hover) ซ่อนไว้จนโฮเวอร์เฉพาะจอที่มีเมาส์จริง (sm ขึ้นไป) */}
      <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        <button onClick={onOpenConvert} title="Convert เป็นงาน" className="text-ink/35 hover:text-brand-700 p-0.5"><Repeat className="w-3.5 h-3.5" /></button>
        <button onClick={onDelete} title="ลบ" className="text-ink/35 hover:text-danger-600 p-0.5"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
      {note.title && <div className="text-sm font-semibold text-ink/90 mb-1 pr-9 line-clamp-2">{note.title}</div>}
      <div className="text-[13px] leading-snug text-ink/80 line-clamp-6 whitespace-pre-wrap min-h-10">{preview || 'ไม่มีเนื้อหา'}</div>
      <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-ink/10">
        <span className="text-[10px] text-ink/50">{new Date(note.updatedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</span>
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
  )
}

function NoteBoard({ notes, onOpenConvert, onDelete }: { notes: Note[]; onOpenConvert: (n: Note) => void; onDelete: (n: Note) => void }) {
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
        <Pin className="w-3.5 h-3.5" /> บอร์ดบันทึกของฉัน
      </div>
      {notes.length === 0 ? (
        <div className="grid place-items-center h-64 text-sm text-muted">บันทึกแรกของคุณจะแปะที่นี่ ✨</div>
      ) : (
        <div className="flex flex-wrap gap-6 sm:gap-7 pb-2">
          {notes.map((n) => (
            <PostIt key={n.id} note={n} isNew={newIds.has(n.id)} onOpenConvert={() => onOpenConvert(n)} onDelete={() => onDelete(n)} />
          ))}
        </div>
      )}
    </div>
  )
}

export function MyNoteTab() {
  const { confirmDialog } = useDialog()
  const { data: notesList, reload } = useLoad<Note[]>(() => api.get('/api/my-notes'))
  const [convertingNote, setConvertingNote] = useState<Note | null>(null)

  const remove = async (n: Note) => {
    const ok = await confirmDialog({ title: 'ลบบันทึกนี้?', message: n.title || notePreview(parseBody(n.body)), confirmLabel: 'ลบ', danger: true })
    if (!ok) return
    await api.delete(`/api/my-notes/${n.id}`)
    await reload()
  }

  return (
    <div className="flex flex-col lg:flex-row gap-5 lg:gap-6 items-start">
      <div className="w-full lg:w-[420px] shrink-0 space-y-4">
        <NoteEditor onSaved={() => void reload()} />

        {!notesList ? (
          <div className="text-center text-sm text-muted py-8">กำลังโหลด…</div>
        ) : notesList.length === 0 ? (
          <div className="bg-white rounded-lg shadow-xs text-center text-sm text-muted py-10">ยังไม่มีบันทึก — เริ่มเขียนด้านบนได้เลย</div>
        ) : (
          <div className="space-y-2">
            {notesList.map((n) => {
              const body = parseBody(n.body)
              return (
                <div key={n.id} className="bg-white rounded-lg shadow-xs px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {n.title && <div className="text-sm font-medium text-strong mb-0.5">{n.title}</div>}
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
                      <button onClick={() => setConvertingNote(n)} className="inline-flex items-center gap-1 text-[11px] text-brand-700 hover:underline">
                        <Repeat className="w-3 h-3" /> Convert
                      </button>
                      <button onClick={() => void remove(n)} className="text-border hover:text-danger-600"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <NoteBoard notes={notesList ?? []} onOpenConvert={setConvertingNote} onDelete={(n) => void remove(n)} />

      {convertingNote && (
        <ConvertModal
          note={convertingNote}
          onClose={() => setConvertingNote(null)}
          onDone={() => { setConvertingNote(null); void reload() }}
        />
      )}
    </div>
  )
}
