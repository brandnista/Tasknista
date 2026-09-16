/* Hallmark · pre-emit critique: P4 H5 E4 S5 R5 V4 */
/** Pronista §Menu Restructure (2026-08-28) — แยกจากแท็บเดิมใน MyTasks.tsx ออกมาเป็น sub-menu ของ "งานของฉัน" (ดู Layout.tsx NAV) */
import { Columns3, List, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import type { KanbanTask } from '../components/StatusKanban'
import { PageHeader } from '../components/PageHeader'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { checklistLabel, dueUrgency, URGENCY_CARD_CLASS } from '../lib/due-urgency'
import { TASK_STATUS_BADGE, TASK_STATUS_DOT, TASK_STATUS_LABEL, TASK_STATUS_ORDER, type TaskStatus } from '../lib/task-status'
import { useLoad } from '../lib/useLoad'

// Pronista §My Tasks dispatcher view fix (2026-09-16) — projectName สืบมาจาก KanbanTask (string | undefined) พอแล้ว
// backend อาจส่ง null มาได้ (งานคีย์ตรงใน Workspace ไม่ผูกโปรเจกต์ — fallback เป็นชื่อ Workspace room แทน) แต่ .filter(Boolean) ตอน render กัน null/undefined เหมือนกันอยู่แล้วไม่ต้องเข้มงวดกับ type ตรงนี้
interface DispatchedRow extends KanbanTask {
  projectId: string | null
}

type ViewMode = 'list' | 'kanban'
const ALL = 'all'

const projectLabel = (task: DispatchedRow) => task.projectName || 'ไม่ระบุโปรเจกต์'
const assigneeLabel = (task: DispatchedRow) => task.assigneeName || 'ยังไม่ระบุผู้รับผิดชอบ'

function formatDate(value: string | number | null | undefined) {
  if (!value) return '—'
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+07:00`) : new Date(value)
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' })
}

/** Pronista §My Tasks dispatcher view — งานที่ฉัน assign ให้คนอื่น ดูสถานะรวมว่าแต่ละงานไปถึงไหนแล้ว */
export function MyTasksDispatchedPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const openTask = (id: string) => navigate(`/tasks/${id}`)
  const { data, loading, error } = useLoad<DispatchedRow[]>(() => api.get('/api/tasks/dispatched-by-me'))
  const { data: cfg } = useLoad<{ dueSoonDays: number }>(() => api.get('/api/config'))
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('dispatched-tasks-view') === 'kanban' ? 'kanban' : 'list'))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<TaskStatus | typeof ALL>(ALL)
  const [assigneeFilter, setAssigneeFilter] = useState(ALL)
  const [projectFilter, setProjectFilter] = useState(ALL)
  // ชื่อเมนูระบุว่า "ให้คนอื่น" — งานที่ผู้ใช้จ่ายให้ตัวเองยังคงอยู่ใน endpoint กลางเพื่อให้ Daily Report ใช้ได้ แต่ไม่ควรแสดงในหน้านี้
  const tasks = useMemo(() => (data ?? []).filter((task) => !!user?.id && task.assigneeId !== user.id), [data, user?.id])

  useEffect(() => localStorage.setItem('dispatched-tasks-view', viewMode), [viewMode])

  const assignees = useMemo(() => [...new Set(tasks.map(assigneeLabel))].sort((a, b) => a.localeCompare(b, 'th')), [tasks])
  const projects = useMemo(() => [...new Set(tasks.map(projectLabel))].sort((a, b) => a.localeCompare(b, 'th')), [tasks])
  const filteredTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('th')
    return tasks.filter((task) => {
      if (statusFilter !== ALL && task.status !== statusFilter) return false
      if (assigneeFilter !== ALL && assigneeLabel(task) !== assigneeFilter) return false
      if (projectFilter !== ALL && projectLabel(task) !== projectFilter) return false
      if (!query) return true
      return [task.code, task.title, task.projectName, task.assigneeName].some((value) => value?.toLocaleLowerCase('th').includes(query))
    })
  }, [assigneeFilter, projectFilter, search, statusFilter, tasks])

  const filtersActive = search.trim() !== '' || statusFilter !== ALL || assigneeFilter !== ALL || projectFilter !== ALL
  const clearFilters = () => {
    setSearch('')
    setStatusFilter(ALL)
    setAssigneeFilter(ALL)
    setProjectFilter(ALL)
  }

  return (
    <>
      <PageHeader title="งานที่จ่ายให้คนอื่น" />
      <div className="p-4 sm:p-6 space-y-4">
        <section className="bg-white rounded-xl border border-border-subtle shadow-xs p-3 sm:p-4" aria-label="ค้นหาและกรองงาน">
          <div className="flex flex-col xl:flex-row xl:items-center gap-3">
            <label className="relative min-w-0 xl:flex-1">
              <span className="sr-only">ค้นหางาน</span>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ค้นหารหัส ชื่องาน โปรเจกต์ หรือผู้รับผิดชอบ"
                className="w-full h-10 rounded-lg border border-border bg-white pl-9 pr-3 text-sm text-body placeholder:text-muted focus:outline-hidden focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500"
              />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 xl:flex xl:items-center">
              <select aria-label="กรองตามสถานะ" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as TaskStatus | typeof ALL)} className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-body focus:outline-hidden focus:ring-2 focus:ring-brand-500/25">
                <option value={ALL}>ทุกสถานะ</option>
                {TASK_STATUS_ORDER.map((status) => <option key={status} value={status}>{TASK_STATUS_LABEL[status]}</option>)}
              </select>
              <select aria-label="กรองตามผู้รับผิดชอบ" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} className="h-10 xl:max-w-52 rounded-lg border border-border bg-white px-3 text-sm text-body focus:outline-hidden focus:ring-2 focus:ring-brand-500/25">
                <option value={ALL}>ผู้รับผิดชอบทั้งหมด</option>
                {assignees.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <select aria-label="กรองตามโปรเจกต์หรือ Workspace" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="h-10 xl:max-w-56 rounded-lg border border-border bg-white px-3 text-sm text-body focus:outline-hidden focus:ring-2 focus:ring-brand-500/25">
                <option value={ALL}>ทุกโปรเจกต์ / Workspace</option>
                {projects.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
            <div className="flex items-center justify-between xl:justify-end gap-2">
              {filtersActive && (
                <button type="button" onClick={clearFilters} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-dim hover:bg-hover hover:text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
                  <X className="w-3.5 h-3.5" /> ล้างฟิลเตอร์
                </button>
              )}
              <div className="inline-flex rounded-lg bg-hover p-1" role="group" aria-label="รูปแบบการแสดงผล">
                <button type="button" onClick={() => setViewMode('list')} aria-pressed={viewMode === 'list'} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${viewMode === 'list' ? 'bg-white text-brand-700 shadow-xs' : 'text-dim hover:text-body'}`}><List className="w-3.5 h-3.5" /> List</button>
                <button type="button" onClick={() => setViewMode('kanban')} aria-pressed={viewMode === 'kanban'} className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${viewMode === 'kanban' ? 'bg-white text-brand-700 shadow-xs' : 'text-dim hover:text-body'}`}><Columns3 className="w-3.5 h-3.5" /> Kanban</button>
              </div>
            </div>
          </div>
        </section>

        <div className="flex items-center justify-between gap-3 text-xs text-muted">
          <span>แสดง {filteredTasks.length} จาก {tasks.length} งาน</span>
          {viewMode === 'kanban' && <span>Kanban นี้ใช้ติดตามสถานะเท่านั้น</span>}
        </div>

        {loading ? (
          <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">กำลังโหลดงาน…</div>
        ) : error ? (
          <div className="bg-danger-50 rounded-xl border border-danger-100 py-12 text-center text-sm text-danger-700">โหลดงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</div>
        ) : filteredTasks.length === 0 ? (
          <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">{filtersActive ? 'ไม่พบงานตามตัวกรองนี้' : 'ยังไม่มีงานที่จ่ายให้คนอื่น'}</div>
        ) : viewMode === 'list' ? (
          <DispatchedList tasks={filteredTasks} onOpenTask={openTask} soonDays={cfg?.dueSoonDays} />
        ) : (
          <DispatchedKanban tasks={filteredTasks} onOpenTask={openTask} soonDays={cfg?.dueSoonDays} statusFilter={statusFilter} />
        )}
      </div>
    </>
  )
}

function DispatchedList({ tasks, onOpenTask, soonDays }: { tasks: DispatchedRow[]; onOpenTask: (id: string) => void; soonDays?: number }) {
  return (
    <div className="bg-white rounded-xl border border-border-subtle shadow-xs overflow-hidden">
      <div className="overflow-x-auto">
        <table className="hidden md:table w-full min-w-[980px] text-sm">
          <thead>
            <tr className="bg-hover text-[11px] text-muted uppercase tracking-wide border-b border-divider">
              <th className="text-left font-semibold px-4 py-3 w-28">วันที่จ่ายงาน</th>
              <th className="text-left font-semibold px-3 py-3 w-24">รหัส</th>
              <th className="text-left font-semibold px-3 py-3 min-w-64">งาน</th>
              <th className="text-left font-semibold px-3 py-3 w-44">โปรเจกต์ / Workspace</th>
              <th className="text-left font-semibold px-3 py-3 w-40">ผู้รับผิดชอบ</th>
              <th className="text-left font-semibold px-3 py-3 w-28">กำหนดส่ง</th>
              <th className="text-left font-semibold px-3 py-3 w-40">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {tasks.map((task) => (
              <tr key={task.id} tabIndex={0} role="button" onClick={() => onOpenTask(task.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onOpenTask(task.id) }} className={`cursor-pointer hover:brightness-[0.98] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-brand-500 ${URGENCY_CARD_CLASS[dueUrgency(task.dueDate, task.status === 'done', soonDays)]}`}>
                <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">{formatDate(task.dispatchedAt)}</td>
                <td className="px-3 py-3 text-xs font-mono text-muted truncate">{task.code || '—'}</td>
                <td className="px-3 py-3 min-w-0">
                  <div className="font-medium text-body line-clamp-2">{task.title}</div>
                  {checklistLabel(task.checklistDone, task.checklistTotal) && <div className="mt-0.5 text-[11px] text-dim">{checklistLabel(task.checklistDone, task.checklistTotal)}</div>}
                </td>
                <td className="px-3 py-3 text-xs text-soft truncate">{projectLabel(task)}</td>
                <td className="px-3 py-3 text-xs text-soft truncate">{assigneeLabel(task)}</td>
                <td className="px-3 py-3 text-xs text-soft whitespace-nowrap">{formatDate(task.dueDate)}</td>
                <td className="px-3 py-3"><span className={`inline-flex whitespace-nowrap text-[11px] font-medium px-2 py-1 rounded-md ${TASK_STATUS_BADGE[task.status]}`}>{TASK_STATUS_LABEL[task.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden divide-y divide-divider">
        {tasks.map((task) => (
          <button key={task.id} type="button" onClick={() => onOpenTask(task.id)} className={`w-full p-4 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-brand-500 ${URGENCY_CARD_CLASS[dueUrgency(task.dueDate, task.status === 'done', soonDays)]}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] text-muted">{task.code || 'ไม่มีรหัส'} · จ่ายงาน {formatDate(task.dispatchedAt)}</div>
                <div className="mt-1 text-sm font-medium text-body line-clamp-2">{task.title}</div>
              </div>
              <span className={`shrink-0 text-[10px] font-medium px-2 py-1 rounded-md ${TASK_STATUS_BADGE[task.status]}`}>{TASK_STATUS_LABEL[task.status]}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
              <div className="min-w-0"><dt className="text-muted">โปรเจกต์ / Workspace</dt><dd className="text-soft truncate">{projectLabel(task)}</dd></div>
              <div className="min-w-0"><dt className="text-muted">ผู้รับผิดชอบ</dt><dd className="text-soft truncate">{assigneeLabel(task)}</dd></div>
              <div><dt className="text-muted">กำหนดส่ง</dt><dd className="text-soft">{formatDate(task.dueDate)}</dd></div>
              {checklistLabel(task.checklistDone, task.checklistTotal) && <div><dt className="text-muted">Checklist</dt><dd className="text-soft">{checklistLabel(task.checklistDone, task.checklistTotal)}</dd></div>}
            </dl>
          </button>
        ))}
      </div>
    </div>
  )
}

function DispatchedKanban({ tasks, onOpenTask, soonDays, statusFilter }: { tasks: DispatchedRow[]; onOpenTask: (id: string) => void; soonDays?: number; statusFilter: TaskStatus | typeof ALL }) {
  const statuses = statusFilter === ALL ? TASK_STATUS_ORDER : [statusFilter]
  return (
    <div className="grid grid-flow-col auto-cols-[minmax(260px,1fr)] gap-3 overflow-x-auto pb-2">
      {statuses.map((status) => {
        const columnTasks = tasks.filter((task) => task.status === status)
        return (
          <section key={status} className="rounded-xl bg-hover/70 border border-border-subtle min-h-40 p-2.5" aria-labelledby={`dispatched-column-${status}`}>
            <div className="flex items-center gap-2 px-1 py-1 mb-2">
              <span className={`w-2 h-2 rounded-full ${TASK_STATUS_DOT[status]}`} />
              <h2 id={`dispatched-column-${status}`} className="text-xs font-semibold text-body">{TASK_STATUS_LABEL[status]}</h2>
              <span className="ml-auto text-[11px] text-muted tabular-nums">{columnTasks.length}</span>
            </div>
            <div className="space-y-2">
              {columnTasks.map((task) => (
                <button key={task.id} type="button" onClick={() => onOpenTask(task.id)} className={`w-full rounded-lg border border-border-subtle p-3 text-left shadow-xs hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${URGENCY_CARD_CLASS[dueUrgency(task.dueDate, task.status === 'done', soonDays)]}`}>
                  <div className="flex items-center justify-between gap-2 text-[10px] text-muted"><span className="font-mono truncate">{task.code || 'ไม่มีรหัส'}</span><span className="shrink-0">{formatDate(task.dueDate)}</span></div>
                  <div className="mt-1.5 text-sm font-medium text-body line-clamp-2">{task.title}</div>
                  <div className="mt-2 text-[11px] text-muted truncate">{projectLabel(task)}</div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-soft">
                    <span className="truncate">{assigneeLabel(task)}</span>
                    {checklistLabel(task.checklistDone, task.checklistTotal) && <span className="shrink-0 text-dim">{checklistLabel(task.checklistDone, task.checklistTotal)}</span>}
                  </div>
                </button>
              ))}
              {columnTasks.length === 0 && <div className="py-8 text-center text-[11px] text-muted">ไม่มีงาน</div>}
            </div>
          </section>
        )
      })}
    </div>
  )
}
