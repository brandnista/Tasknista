import { FolderKanban, ListChecks, NotebookText, Search, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../lib/api'
import { ROLE_LABEL } from '../lib/role-label'
import { TASK_STATUS_BADGE, TASK_STATUS_LABEL, type TaskStatus } from '../lib/task-status'
import { useLoad } from '../lib/useLoad'

interface SearchProject { id: string; name: string; code: string | null; status: string; type: string }
interface SearchTask {
  id: string
  title: string
  code: string | null
  projectId: string | null
  projectName: string | null
  status: TaskStatus
  dueDate: string | null
  assigneeId: string | null
  assigneeName: string | null
}
interface SearchDoc { id: string; title: string; docNumber: string | null; docType: string | null; kind: string }
interface SearchPerson { id: string; name: string; role: 'owner' | 'member' | 'vendor' | 'guest'; email: string; phone: string | null; jobTitle: string | null }
interface SearchResult { projects: SearchProject[]; tasks: SearchTask[]; docs: SearchDoc[]; people: SearchPerson[] }
interface UserOpt { id: string; name: string }

const DEBOUNCE_MS = 250
const DUE_LABEL: Record<string, string> = { today: 'วันนี้', week: 'สัปดาห์นี้', overdue: 'เลยกำหนด' }

/**
 * Pronista §Navbar enrichment (2026-08-27) — ค้นหาด่วนข้ามระบบ (โปรเจกต์/งาน/เอกสาร/คน) จาก Topbar
 * ไม่ผูก ⌘K ระดับ global เพราะ Projects.tsx มี ⌘K ของตัวเองอยู่แล้ว (ค้นหาเฉพาะในหน้านั้น) — กันชนกัน เปิดผ่านคลิกปุ่มอย่างเดียว
 * filter (สถานะ/ผู้รับผิดชอบ/กำหนดส่ง) มีผลกับ "งาน" เท่านั้น
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [due, setDue] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { data: userOpts } = useLoad<UserOpt[]>(() => api.get('/api/users'))

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (!open) return
    const query = q.trim()
    if (query.length < 2) { setResult(null); setLoading(false); return }
    setLoading(true)
    const id = setTimeout(() => {
      const params = new URLSearchParams({ q: query })
      if (status) params.set('status', status)
      if (assigneeId) params.set('assigneeId', assigneeId)
      if (due) params.set('due', due)
      api
        .get<SearchResult>(`/api/search?${params.toString()}`)
        .then(setResult)
        .finally(() => setLoading(false))
    }, DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [q, status, assigneeId, due, open])

  const close = () => { setOpen(false); setQ(''); setStatus(''); setAssigneeId(''); setDue(''); setResult(null) }
  const goTo = (path: string) => { close(); navigate(path) }

  const hasQuery = q.trim().length >= 2
  const totalResults = result ? result.projects.length + result.tasks.length + result.docs.length + result.people.length : 0
  const noResults = hasQuery && !loading && result && totalResults === 0
  const selectField = 'text-xs bg-hover rounded-lg px-2 py-1.5 focus:outline-hidden'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="ค้นหางาน/โปรเจกต์/เอกสาร/คน"
        className="w-9 h-9 grid place-items-center rounded-xl text-dim hover:bg-hover hover:text-body transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
      >
        <Search className="w-[18px] h-[18px]" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-start justify-center pt-20 sm:pt-28 bg-ink/40 p-4" onClick={close}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xl bg-white rounded-2xl shadow-2xl so-fade-in flex flex-col max-h-[75vh]">
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-subtle shrink-0">
              <Search className="w-4 h-4 text-muted shrink-0" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ค้นหางาน โปรเจกต์ เอกสาร หรือคน..."
                className="flex-1 min-w-0 text-sm outline-hidden"
              />
              <button onClick={close} className="p-1 rounded hover:bg-hover text-dim shrink-0"><X className="w-4 h-4" /></button>
            </div>

            {/* ตัวกรอง — มีผลกับผลลัพธ์ "งาน" เท่านั้น */}
            <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-border-subtle shrink-0">
              <span className="text-[11px] text-muted mr-0.5">กรองงาน:</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectField} aria-label="สถานะ">
                <option value="">สถานะทั้งหมด</option>
                {Object.entries(TASK_STATUS_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={selectField} aria-label="ผู้รับผิดชอบ">
                <option value="">ผู้รับผิดชอบทั้งหมด</option>
                {(userOpts ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <select value={due} onChange={(e) => setDue(e.target.value)} className={selectField} aria-label="กำหนดส่ง">
                <option value="">กำหนดส่งทั้งหมด</option>
                {Object.entries(DUE_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            </div>

            <div className="flex-1 overflow-y-auto">
              {!hasQuery ? (
                <div className="py-10 text-center text-sm text-muted">พิมพ์อย่างน้อย 2 ตัวอักษร</div>
              ) : loading ? (
                <div className="py-10 text-center text-sm text-muted">กำลังค้นหา...</div>
              ) : noResults ? (
                <div className="py-10 text-center text-sm text-muted">ไม่พบผลลัพธ์สำหรับ "{q}"</div>
              ) : (
                <>
                  {result && result.projects.length > 0 && (
                    <div className="py-2">
                      <div className="px-4 pb-1 text-[11px] font-medium text-muted tracking-wide">โปรเจกต์</div>
                      {result.projects.map((p) => (
                        <button key={p.id} onClick={() => goTo(`/projects/${p.id}`)} className="w-full text-left px-4 py-2 flex items-center gap-2.5 hover:bg-hover">
                          <FolderKanban className="w-4 h-4 text-muted shrink-0" />
                          <span className="min-w-0 flex-1 text-sm text-body truncate">{p.name}</span>
                          <span className="text-[11px] text-muted shrink-0">{p.status}</span>
                          {p.code && <span className="text-[11px] text-muted font-mono shrink-0">{p.code}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {result && result.tasks.length > 0 && (
                    <div className="py-2 border-t border-border-subtle">
                      <div className="px-4 pb-1 text-[11px] font-medium text-muted tracking-wide">งาน</div>
                      {result.tasks.map((t) => (
                        <button key={t.id} onClick={() => goTo(`/tasks/${t.id}`)} className="w-full text-left px-4 py-2 flex items-start gap-2.5 hover:bg-hover">
                          <ListChecks className="w-4 h-4 text-muted shrink-0 mt-0.5" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-body truncate">{t.title}</span>
                            <span className="flex items-center gap-1.5 flex-wrap mt-0.5">
                              {t.projectName && <span className="text-[11px] text-muted truncate">{t.projectName}</span>}
                              {t.assigneeName && <span className="text-[11px] text-muted truncate">· {t.assigneeName}</span>}
                              {t.dueDate && <span className="text-[11px] text-muted shrink-0">· {t.dueDate}</span>}
                            </span>
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${TASK_STATUS_BADGE[t.status]}`}>{TASK_STATUS_LABEL[t.status]}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {result && result.docs.length > 0 && (
                    <div className="py-2 border-t border-border-subtle">
                      <div className="px-4 pb-1 text-[11px] font-medium text-muted tracking-wide">เอกสาร</div>
                      {result.docs.map((d) => (
                        <button key={d.id} onClick={() => goTo(`/docs/${d.id}`)} className="w-full text-left px-4 py-2 flex items-center gap-2.5 hover:bg-hover">
                          <NotebookText className="w-4 h-4 text-muted shrink-0" />
                          <span className="min-w-0 flex-1 text-sm text-body truncate">{d.title}</span>
                          {d.docNumber && <span className="text-[11px] text-muted font-mono shrink-0">{d.docNumber}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {result && result.people.length > 0 && (
                    <div className="py-2 border-t border-border-subtle">
                      <div className="px-4 pb-1 text-[11px] font-medium text-muted tracking-wide">คน</div>
                      {result.people.map((p) => (
                        <button key={p.id} onClick={() => goTo(p.role === 'guest' ? `/customers/${p.id}` : p.role === 'vendor' ? `/partners/${p.id}` : `/employees/${p.id}`)} className="w-full text-left px-4 py-2 flex items-center gap-2.5 hover:bg-hover">
                          <Users className="w-4 h-4 text-muted shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-body truncate">{p.name}</span>
                            <span className="block text-[11px] text-muted truncate">{p.email}</span>
                          </span>
                          <span className="text-[11px] text-muted shrink-0">{ROLE_LABEL[p.role]}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
