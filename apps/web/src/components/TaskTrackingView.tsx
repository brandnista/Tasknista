/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 · genre: modern-minimal · macrostructure: Workbench · theme: existing Pronista tokens · enrichment: none · designed-as-app */
import { Columns3, List, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { checklistLabel, dueUrgency, URGENCY_CARD_CLASS } from '../lib/due-urgency'
import { TASK_STATUS_BADGE, TASK_STATUS_DOT, TASK_STATUS_LABEL, TASK_STATUS_ORDER, type TaskStatus } from '../lib/task-status'
import type { KanbanTask } from './StatusKanban'

type ViewMode = 'list' | 'kanban'
const ALL = 'all'

export interface TrackingTask extends KanbanTask {
  projectId?: string | null
}

interface TaskTrackingViewProps<T extends TrackingTask> {
  tasks: T[]
  loading: boolean
  error: unknown
  onOpenTask: (id: string) => void
  soonDays?: number
  storageKey: string
  dateColumnLabel: string
  dateOf: (task: T) => string | number | null | undefined
  emptyLabel: string
}

const projectLabel = (task: TrackingTask) => task.projectName || 'ไม่ระบุโปรเจกต์'
const assigneeLabel = (task: TrackingTask) => task.assigneeName || 'ยังไม่ระบุผู้รับผิดชอบ'

function formatDate(value: string | number | null | undefined) {
  if (!value) return '—'
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+07:00`) : new Date(value)
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Bangkok' })
}

/** โครงติดตามงานร่วมของ "งานที่จ่ายให้คนอื่น" และ "งานรอตรวจ" เพื่อให้ filter, table และ Kanban ทำงานแบบเดียวกัน */
export function TaskTrackingView<T extends TrackingTask>({
  tasks,
  loading,
  error,
  onOpenTask,
  soonDays,
  storageKey,
  dateColumnLabel,
  dateOf,
  emptyLabel,
}: TaskTrackingViewProps<T>) {
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem(storageKey) === 'kanban' ? 'kanban' : 'list'))
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<TaskStatus | typeof ALL>(ALL)
  const [assigneeFilter, setAssigneeFilter] = useState(ALL)
  const [projectFilter, setProjectFilter] = useState(ALL)

  useEffect(() => localStorage.setItem(storageKey, viewMode), [storageKey, viewMode])

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
    <div className="space-y-4">
      <section className="rounded-xl border border-border-subtle bg-white p-3 shadow-xs sm:p-4" aria-label="ค้นหาและกรองงาน">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <label className="relative min-w-0 xl:flex-1">
            <span className="sr-only">ค้นหางาน</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ค้นหารหัส ชื่องาน โปรเจกต์ หรือผู้รับผิดชอบ"
              className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm text-body placeholder:text-muted focus:border-brand-500 focus:outline-hidden focus:ring-2 focus:ring-brand-500/25"
            />
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:flex xl:items-center">
            <select aria-label="กรองตามสถานะ" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as TaskStatus | typeof ALL)} className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-body focus:outline-hidden focus:ring-2 focus:ring-brand-500/25">
              <option value={ALL}>ทุกสถานะ</option>
              {TASK_STATUS_ORDER.map((status) => <option key={status} value={status}>{TASK_STATUS_LABEL[status]}</option>)}
            </select>
            <select aria-label="กรองตามผู้รับผิดชอบ" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-body focus:outline-hidden focus:ring-2 focus:ring-brand-500/25 xl:max-w-52">
              <option value={ALL}>ผู้รับผิดชอบทั้งหมด</option>
              {assignees.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <select aria-label="กรองตามโปรเจกต์หรือ Workspace" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-body focus:outline-hidden focus:ring-2 focus:ring-brand-500/25 xl:max-w-56">
              <option value={ALL}>ทุกโปรเจกต์ / Workspace</option>
              {projects.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between gap-2 xl:justify-end">
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium text-dim hover:bg-hover hover:text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
                <X className="h-3.5 w-3.5" /> ล้างฟิลเตอร์
              </button>
            )}
            <div className="inline-flex rounded-lg bg-hover p-1" role="group" aria-label="รูปแบบการแสดงผล">
              <button type="button" onClick={() => setViewMode('list')} aria-pressed={viewMode === 'list'} className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${viewMode === 'list' ? 'bg-white text-brand-700 shadow-xs' : 'text-dim hover:text-body'}`}><List className="h-3.5 w-3.5" /> List</button>
              <button type="button" onClick={() => setViewMode('kanban')} aria-pressed={viewMode === 'kanban'} className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${viewMode === 'kanban' ? 'bg-white text-brand-700 shadow-xs' : 'text-dim hover:text-body'}`}><Columns3 className="h-3.5 w-3.5" /> Kanban</button>
            </div>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <span>แสดง {filteredTasks.length} จาก {tasks.length} งาน</span>
        {viewMode === 'kanban' && <span>Kanban นี้ใช้ติดตามสถานะเท่านั้น</span>}
      </div>

      {loading ? (
        <div className="rounded-xl border border-border-subtle bg-white py-12 text-center text-sm text-muted">กำลังโหลดงาน…</div>
      ) : error ? (
        <div className="rounded-xl border border-danger-100 bg-danger-50 py-12 text-center text-sm text-danger-700">โหลดงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</div>
      ) : filteredTasks.length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-white py-12 text-center text-sm text-muted">{filtersActive ? 'ไม่พบงานตามตัวกรองนี้' : emptyLabel}</div>
      ) : viewMode === 'list' ? (
        <TrackingList tasks={filteredTasks} onOpenTask={onOpenTask} soonDays={soonDays} dateColumnLabel={dateColumnLabel} dateOf={dateOf} />
      ) : (
        <TrackingKanban tasks={filteredTasks} onOpenTask={onOpenTask} soonDays={soonDays} statusFilter={statusFilter} />
      )}
    </div>
  )
}

function TrackingList<T extends TrackingTask>({ tasks, onOpenTask, soonDays, dateColumnLabel, dateOf }: { tasks: T[]; onOpenTask: (id: string) => void; soonDays?: number; dateColumnLabel: string; dateOf: (task: T) => string | number | null | undefined }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-white shadow-xs">
      <div className="overflow-x-auto">
        <table className="hidden w-full min-w-[980px] text-sm md:table">
          <thead><tr className="border-b border-divider bg-hover text-[11px] uppercase tracking-wide text-muted">
            <th className="w-28 px-4 py-3 text-left font-semibold">{dateColumnLabel}</th><th className="w-24 px-3 py-3 text-left font-semibold">รหัส</th><th className="min-w-64 px-3 py-3 text-left font-semibold">งาน</th><th className="w-44 px-3 py-3 text-left font-semibold">โปรเจกต์ / Workspace</th><th className="w-40 px-3 py-3 text-left font-semibold">ผู้รับผิดชอบ</th><th className="w-28 px-3 py-3 text-left font-semibold">กำหนดส่ง</th><th className="w-40 px-3 py-3 text-left font-semibold">สถานะ</th>
          </tr></thead>
          <tbody className="divide-y divide-divider">{tasks.map((task) => (
            <tr key={task.id} tabIndex={0} role="button" onClick={() => onOpenTask(task.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onOpenTask(task.id) }} className={`cursor-pointer hover:brightness-[0.98] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-brand-500 ${URGENCY_CARD_CLASS[dueUrgency(task.dueDate, task.status === 'done', soonDays)]}`}>
              <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">{formatDate(dateOf(task))}</td><td className="truncate px-3 py-3 font-mono text-xs text-muted">{task.code || '—'}</td><td className="min-w-0 px-3 py-3"><div className="line-clamp-2 font-medium text-body">{task.title}</div>{checklistLabel(task.checklistDone, task.checklistTotal) && <div className="mt-0.5 text-[11px] text-dim">{checklistLabel(task.checklistDone, task.checklistTotal)}</div>}</td><td className="truncate px-3 py-3 text-xs text-soft">{projectLabel(task)}</td><td className="truncate px-3 py-3 text-xs text-soft">{assigneeLabel(task)}</td><td className="whitespace-nowrap px-3 py-3 text-xs text-soft">{formatDate(task.dueDate)}</td><td className="px-3 py-3"><span className={`inline-flex whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium ${TASK_STATUS_BADGE[task.status]}`}>{TASK_STATUS_LABEL[task.status]}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="divide-y divide-divider md:hidden">{tasks.map((task) => (
        <button key={task.id} type="button" onClick={() => onOpenTask(task.id)} className={`w-full p-4 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-brand-500 ${URGENCY_CARD_CLASS[dueUrgency(task.dueDate, task.status === 'done', soonDays)]}`}>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-[11px] text-muted">{task.code || 'ไม่มีรหัส'} · {dateColumnLabel} {formatDate(dateOf(task))}</div><div className="mt-1 line-clamp-2 text-sm font-medium text-body">{task.title}</div></div><span className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-medium ${TASK_STATUS_BADGE[task.status]}`}>{TASK_STATUS_LABEL[task.status]}</span></div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]"><div className="min-w-0"><dt className="text-muted">โปรเจกต์ / Workspace</dt><dd className="truncate text-soft">{projectLabel(task)}</dd></div><div className="min-w-0"><dt className="text-muted">ผู้รับผิดชอบ</dt><dd className="truncate text-soft">{assigneeLabel(task)}</dd></div><div><dt className="text-muted">กำหนดส่ง</dt><dd className="text-soft">{formatDate(task.dueDate)}</dd></div>{checklistLabel(task.checklistDone, task.checklistTotal) && <div><dt className="text-muted">Checklist</dt><dd className="text-soft">{checklistLabel(task.checklistDone, task.checklistTotal)}</dd></div>}</dl>
        </button>
      ))}</div>
    </div>
  )
}

function TrackingKanban<T extends TrackingTask>({ tasks, onOpenTask, soonDays, statusFilter }: { tasks: T[]; onOpenTask: (id: string) => void; soonDays?: number; statusFilter: TaskStatus | typeof ALL }) {
  const statuses = statusFilter === ALL ? TASK_STATUS_ORDER : [statusFilter]
  return <div className="grid grid-flow-col auto-cols-[minmax(260px,1fr)] gap-3 overflow-x-auto pb-2">{statuses.map((status) => {
    const columnTasks = tasks.filter((task) => task.status === status)
    return <section key={status} className="min-h-40 rounded-xl border border-border-subtle bg-hover/70 p-2.5" aria-labelledby={`tracking-column-${status}`}><div className="mb-2 flex items-center gap-2 px-1 py-1"><span className={`h-2 w-2 rounded-full ${TASK_STATUS_DOT[status]}`} /><h2 id={`tracking-column-${status}`} className="text-xs font-semibold text-body">{TASK_STATUS_LABEL[status]}</h2><span className="ml-auto text-[11px] tabular-nums text-muted">{columnTasks.length}</span></div><div className="space-y-2">{columnTasks.map((task) => <button key={task.id} type="button" onClick={() => onOpenTask(task.id)} className={`w-full rounded-lg border border-border-subtle p-3 text-left shadow-xs hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${URGENCY_CARD_CLASS[dueUrgency(task.dueDate, task.status === 'done', soonDays)]}`}><div className="flex items-center justify-between gap-2 text-[10px] text-muted"><span className="truncate font-mono">{task.code || 'ไม่มีรหัส'}</span><span className="shrink-0">{formatDate(task.dueDate)}</span></div><div className="mt-1.5 line-clamp-2 text-sm font-medium text-body">{task.title}</div><div className="mt-2 truncate text-[11px] text-muted">{projectLabel(task)}</div><div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-soft"><span className="truncate">{assigneeLabel(task)}</span>{checklistLabel(task.checklistDone, task.checklistTotal) && <span className="shrink-0 text-dim">{checklistLabel(task.checklistDone, task.checklistTotal)}</span>}</div></button>)}{columnTasks.length === 0 && <div className="py-8 text-center text-[11px] text-muted">ไม่มีงาน</div>}</div></section>
  })}</div>
}
