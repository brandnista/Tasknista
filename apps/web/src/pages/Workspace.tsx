/**
 * Pronista §Workspace — Sprint/Backlog รวมทุกโปรเจกต์ที่มีสิทธิ์เห็น (คล้าย Jira 1 Board ต่อทีม ไม่แยกตามโปรเจกต์)
 * อ่านข้อมูลจาก /api/workspace/* (aggregate อ่านอย่างเดียว) แต่ mutation ทั้งหมดยิง endpoint เดิมของ sprints/tasks
 * (สร้าง/เริ่ม/ปิด Sprint, ลากงานเข้า Sprint, สร้าง backlog task, เปลี่ยน status) — ดูแผน "Workspace" ประกอบ
 * §รอบ 2 — Backlog Grid เป็นตารางแบนรวมทุก work item (Epic/Story/Task/Subtask) ข้ามโปรเจกต์ ไม่แยก section ต่อโปรเจกต์ ฟิลเตอร์เอาแทน
 */
import type { Label } from '@seedoffice/core'
import { AlertTriangle, CheckCircle2, Layers, Play, Plus, X } from 'lucide-react'
import { type DragEvent, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useDialog } from '../components/Dialog'
import { LabelChips } from '../components/LabelChips'
import { PageHeader } from '../components/PageHeader'
import { api, ApiError } from '../lib/api'
import { fmtThaiDate } from '../lib/project-ui'
import { TASK_STATUS_BADGE, TASK_STATUS_LABEL, TASK_STATUS_ORDER, type TaskStatus } from '../lib/task-status'
import { useLoad } from '../lib/useLoad'
import { avatarColor, SprintStartModal } from './ProjectDetail'
import { Avatar } from '../components/Avatar'

const bkkToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)

interface AccessibleProject { id: string; code: string | null; name: string }
interface WsTask {
  id: string
  code: string | null
  title: string
  priority: 'low' | 'normal' | 'high'
  status: TaskStatus
  dueDate: string | null
  assigneeName: string | null
  labelIds: string[] | null
  kind?: string
}
type WorkType = 'epic' | 'story' | 'task' | 'subtask'
interface WsBacklogItem {
  id: string
  code: string | null
  title: string
  kind: 'epic' | 'task' | 'backlog'
  workType: WorkType
  status: TaskStatus | null
  dueDate: string | null
  priority: 'low' | 'normal' | 'high' | null
  assigneeId: string | null
  assigneeName: string | null
  assignedBy: string | null
  dispatcherName: string | null
  labelIds: string[] | null
  projectId: string
  projectCode: string | null
  projectName: string
}
interface WsSprint {
  id: string
  projectId: string
  name: string | null
  status: 'planned' | 'active' | 'completed'
  startDate: string
  endDate: string
  goal: string | null
  doneCount: number | null
  notDoneCount: number | null
}
interface WsSprintItem { sprint: WsSprint; tasks: WsTask[]; projectId: string; projectCode: string | null; projectName: string }

const WORKTYPE_ORDER: Record<WorkType, number> = { epic: 0, story: 1, task: 2, subtask: 3 }
const WORKTYPE_LABEL: Record<WorkType, string> = { epic: 'Epic', story: 'Story', task: 'Task', subtask: 'Subtask' }
const WORKTYPE_BADGE: Record<WorkType, string> = {
  epic: 'bg-teal-50 text-teal-700',
  story: 'bg-violet-50 text-violet-700',
  task: 'bg-info-50 text-info-700',
  subtask: 'bg-divider text-soft',
}
const selectCls = 'text-sm bg-white border border-border rounded-lg px-2.5 py-1.5'
const isOverdue = (dueDate: string | null, status: TaskStatus | null) => !!dueDate && dueDate < bkkToday() && status !== 'done'

function ProjectChip({ code, name }: { code: string | null; name: string }) {
  return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 shrink-0">{code || name}</span>
}

function DueDateChip({ dueDate, status }: { dueDate: string | null; status: TaskStatus | null }) {
  if (!dueDate) return null
  const overdue = isOverdue(dueDate, status)
  return (
    <span className={`text-[11px] px-1.5 py-0.5 rounded shrink-0 flex items-center gap-1 ${overdue ? 'bg-danger-50 text-danger-600 border border-danger-200' : 'text-muted'}`}>
      {overdue && <AlertTriangle className="w-3 h-3" />} {fmtThaiDate(dueDate)}
    </span>
  )
}

export function WorkspacePage() {
  const navigate = useNavigate()
  const { confirmDialog } = useDialog()
  const [searchParams] = useSearchParams()
  const preselect = searchParams.get('project')

  const { data: projects } = useLoad<AccessibleProject[]>(() => api.get('/api/workspace/accessible-projects'))
  const { data: cfg } = useLoad<{ labels: Label[] }>(() => api.get('/api/config'))
  const [projectFilter, setProjectFilter] = useState(preselect ?? 'all')
  const queryIds = projectFilter === 'all' ? '' : projectFilter

  const { data: backlogData, reload: reloadBacklog } = useLoad<{ items: WsBacklogItem[] }>(
    () => api.get(`/api/workspace/backlog-items${queryIds ? `?projectIds=${queryIds}` : ''}`),
    [queryIds],
  )
  const { data: boardData, reload: reloadBoard } = useLoad<{ sprints: WsSprintItem[] }>(
    () => api.get(`/api/workspace/board${queryIds ? `?projectIds=${queryIds}` : ''}`),
    [queryIds],
  )
  const reloadAll = () => { void reloadBacklog(); void reloadBoard() }

  const [dispatcherFilter, setDispatcherFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all')
  const [workTypeFilter, setWorkTypeFilter] = useState<'all' | WorkType>('all')

  const [addTitle, setAddTitle] = useState('')
  const [addProjectId, setAddProjectId] = useState('')
  useEffect(() => { if (!addProjectId && projects && projects[0]) setAddProjectId(projects[0].id) }, [projects, addProjectId])

  const [error, setError] = useState('')

  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [dragTaskProjectId, setDragTaskProjectId] = useState<string | null>(null)
  const [dropHoverSprintId, setDropHoverSprintId] = useState<string | null>(null)

  const [newSprintPicker, setNewSprintPicker] = useState(false)
  const [starting, setStarting] = useState<{ id: string; projectId: string; startDate: string; endDate: string } | null>(null)

  const changeStatus = async (taskId: string, status: TaskStatus) => {
    setError('')
    try {
      await api.patch(`/api/tasks/${taskId}`, { status })
      reloadAll()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'เปลี่ยนสถานะไม่สำเร็จ')
    }
  }

  const addItem = async () => {
    const title = addTitle.trim()
    if (!title || !addProjectId) return
    setError('')
    try {
      await api.post(`/api/projects/${addProjectId}/backlog`, { title, kind: 'backlog' })
      setAddTitle('')
      void reloadBacklog()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'สร้างงานไม่สำเร็จ')
    }
  }

  const createSprintFor = async (projectId: string) => {
    setNewSprintPicker(false)
    setError('')
    try {
      await api.post(`/api/projects/${projectId}/sprints`)
      void reloadBoard()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'สร้าง Sprint ไม่สำเร็จ')
    }
  }

  const completeSprint = async (sprintId: string) => {
    const ok = await confirmDialog({ title: 'ปิด Sprint นี้เลยไหม?', message: 'งานที่ยังไม่ Done จะเด้งกลับ Backlog', confirmLabel: 'ปิด Sprint', danger: true })
    if (!ok) return
    setError('')
    try {
      await api.post(`/api/sprints/${sprintId}/complete`)
      reloadAll()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'ปิด Sprint ไม่สำเร็จ')
    }
  }

  const removeFromSprint = async (sprintId: string, taskId: string) => {
    setError('')
    try {
      await api.delete(`/api/sprints/${sprintId}/tasks/${taskId}`)
      reloadAll()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'เอาออกจาก Sprint ไม่สำเร็จ')
    }
  }

  const dropOnSprint = async (sprintId: string) => {
    setDropHoverSprintId(null)
    const taskId = dragTaskId
    setDragTaskId(null)
    setDragTaskProjectId(null)
    if (!taskId) return
    setError('')
    try {
      await api.post(`/api/sprints/${sprintId}/tasks`, { taskId })
      reloadAll()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'ลากเข้า Sprint ไม่สำเร็จ — ต้องเป็นงานในโปรเจกต์เดียวกับ Sprint เท่านั้น')
    }
  }

  const allItems = backlogData?.items ?? []
  const dispatcherOptions = [...new Set(allItems.map((i) => i.dispatcherName).filter((n): n is string => !!n))].sort()
  const assigneeOptions = [...new Set(allItems.map((i) => i.assigneeName).filter((n): n is string => !!n))].sort()
  const filteredItems = allItems
    .filter((i) => dispatcherFilter === 'all' || i.dispatcherName === dispatcherFilter)
    .filter((i) => assigneeFilter === 'all' || i.assigneeName === assigneeFilter)
    .filter((i) => statusFilter === 'all' || i.status === statusFilter)
    .filter((i) => workTypeFilter === 'all' || i.workType === workTypeFilter)
    .sort((a, b) => WORKTYPE_ORDER[a.workType] - WORKTYPE_ORDER[b.workType] || a.title.localeCompare(b.title))

  const sprintItems = boardData?.sprints ?? []

  return (
    <>
      <PageHeader
        title="Workspace"
        action={
          <div className="relative">
            <button
              onClick={() => setNewSprintPicker((v) => !v)}
              className="inline-flex items-center gap-1.5 text-sm bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 font-medium"
            >
              <Plus className="w-4 h-4" /> Sprint
            </button>
            {newSprintPicker && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setNewSprintPicker(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-white rounded-lg shadow-2xl border border-border-subtle p-1 max-h-72 overflow-y-auto">
                  <div className="text-[11px] text-muted px-2 py-1.5">สร้าง Sprint ในโปรเจกต์ไหน</div>
                  {(projects ?? []).map((p) => (
                    <button key={p.id} onClick={() => void createSprintFor(p.id)} className="w-full text-left text-sm px-2 py-1.5 rounded-lg hover:bg-hover truncate">
                      {p.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        }
      />

      <div className="p-3 sm:p-6 space-y-4">
        {error && <div className="bg-danger-50 text-danger-700 text-sm rounded-lg px-3 py-2">{error}</div>}

        {/* ฟิลเตอร์ */}
        <div className="flex items-center gap-2 flex-wrap">
          <Layers className="w-4 h-4 text-muted shrink-0" />
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className={selectCls}>
            <option value="all">ทุกโปรเจกต์</option>
            {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={dispatcherFilter} onChange={(e) => setDispatcherFilter(e.target.value)} className={selectCls}>
            <option value="all">ผู้จ่ายงานทั้งหมด</option>
            {dispatcherOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className={selectCls}>
            <option value="all">ผู้รับงานทั้งหมด</option>
            {assigneeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | TaskStatus)} className={selectCls}>
            <option value="all">ทุกสถานะ</option>
            {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
          </select>
          <select value={workTypeFilter} onChange={(e) => setWorkTypeFilter(e.target.value as 'all' | WorkType)} className={selectCls}>
            <option value="all">ทุกประเภทงาน</option>
            {(['epic', 'story', 'task', 'subtask'] as WorkType[]).map((w) => <option key={w} value={w}>{WORKTYPE_LABEL[w]}</option>)}
          </select>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {/* Backlog Grid — ตารางแบนรวมทุก work item ข้ามโปรเจกต์ */}
          <div className="space-y-3">
            <div className="text-sm font-semibold text-ink">📥 Backlog ({filteredItems.length})</div>
            <div className="bg-white rounded-lg shadow-xs overflow-hidden">
              {filteredItems.length === 0 && <div className="p-6 text-center text-sm text-muted">ไม่มีงาน — ลองปรับตัวกรองดู</div>}
              <div className="divide-y divide-divider">
                {filteredItems.map((it) => (
                  <div
                    key={it.id}
                    draggable={it.kind !== 'epic'}
                    onDragStart={(e: DragEvent) => { if (it.kind === 'epic') return; e.dataTransfer.setData('text/plain', it.id); setDragTaskId(it.id); setDragTaskProjectId(it.projectId) }}
                    onDragEnd={() => { setDragTaskId(null); setDragTaskProjectId(null) }}
                    className={`flex items-center gap-2 px-3 py-2 flex-wrap ${it.kind !== 'epic' ? 'cursor-grab' : ''} ${dragTaskId === it.id ? 'opacity-50' : ''}`}
                  >
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${WORKTYPE_BADGE[it.workType]}`}>{WORKTYPE_LABEL[it.workType]}</span>
                    <ProjectChip code={it.projectCode} name={it.projectName} />
                    {it.code && <span className="text-[11px] font-mono text-muted shrink-0">{it.code}</span>}
                    {it.kind === 'epic' ? (
                      <span className="flex-1 text-sm font-medium text-ink truncate min-w-32">{it.title}</span>
                    ) : (
                      <button onClick={() => navigate(`/tasks/${it.id}`)} className="flex-1 text-sm text-body truncate text-left hover:underline min-w-32">{it.title}</button>
                    )}
                    {it.priority === 'high' && <span className="text-[10px] text-danger-600 bg-danger-50 px-1.5 py-0.5 rounded shrink-0">สูง</span>}
                    <LabelChips catalog={cfg?.labels} ids={it.labelIds} />
                    {it.status && (
                      <select
                        value={it.status}
                        onChange={(e) => void changeStatus(it.id, e.target.value as TaskStatus)}
                        className={`text-[11px] rounded px-1.5 py-1 border-0 shrink-0 ${TASK_STATUS_BADGE[it.status]}`}
                      >
                        {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
                      </select>
                    )}
                    <DueDateChip dueDate={it.dueDate} status={it.status} />
                    {it.assigneeName && <Avatar name={it.assigneeName} avatarUrl={null} className="w-5 h-5 text-[9px] shrink-0" colorClass={avatarColor(it.assigneeName)} />}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 p-3 border-t border-divider">
                <select value={addProjectId} onChange={(e) => setAddProjectId(e.target.value)} className={selectCls}>
                  {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input
                  value={addTitle}
                  onChange={(e) => setAddTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void addItem() }}
                  placeholder="พิมพ์ชื่องานแล้วกด Enter…"
                  className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-1.5 focus:outline-hidden focus:border-brand-400"
                />
              </div>
            </div>
          </div>

          {/* Sprint — การ์ดต่อ sprint ข้ามโปรเจกต์ */}
          <div className="space-y-3">
            <div className="text-sm font-semibold text-ink">🏃 Sprint</div>
            {sprintItems.length === 0 && (
              <div className="bg-white rounded-lg shadow-xs p-6 text-center text-sm text-muted">ยังไม่มี Sprint ที่เปิดอยู่ — กดปุ่ม "+ Sprint" มุมขวาบน</div>
            )}
            {sprintItems.map((item) => {
              const { sprint } = item
              const isDropValid = dragTaskProjectId === sprint.projectId
              const isDropHovering = dropHoverSprintId === sprint.id
              const counts: Record<TaskStatus, number> = { non_start: 0, on_processing: 0, waiting_for_test: 0, done: 0 }
              for (const t of item.tasks) counts[t.status] = (counts[t.status] ?? 0) + 1
              return (
                <div key={sprint.id} className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <ProjectChip code={item.projectCode} name={item.projectName} />
                    <span className="font-semibold text-ink">{sprint.name || `${fmtThaiDate(sprint.startDate)} – ${fmtThaiDate(sprint.endDate)}`}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${sprint.status === 'active' ? 'bg-success-50 text-success-700' : 'bg-warning-50 text-warning-700'}`}>
                      {sprint.status === 'active' ? 'กำลังทำ' : 'วางแผน'}
                    </span>
                    {sprint.goal && <span className="text-xs text-body basis-full sm:basis-auto">🎯 {sprint.goal}</span>}
                    <div className="ml-auto flex items-center gap-2">
                      {item.tasks.length > 0 && (
                        <div className="flex items-center gap-1 shrink-0">
                          {TASK_STATUS_ORDER.map((s) => (
                            <span key={s} title={TASK_STATUS_LABEL[s]} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${TASK_STATUS_BADGE[s]}`}>{counts[s]}</span>
                          ))}
                        </div>
                      )}
                      {sprint.status === 'active' && (
                        <button onClick={() => navigate(`/projects/${sprint.projectId}/sprints/${sprint.id}/board`)} className="text-sm border border-border-subtle rounded-lg px-3 py-1.5 text-dim hover:bg-hover">
                          ไปที่ Board →
                        </button>
                      )}
                      {sprint.status === 'planned' && (
                        <button onClick={() => setStarting({ id: sprint.id, projectId: sprint.projectId, startDate: sprint.startDate, endDate: sprint.endDate })} className="inline-flex items-center gap-1.5 text-sm bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 font-medium">
                          <Play className="w-4 h-4" /> เริ่ม Sprint
                        </button>
                      )}
                      <button onClick={() => void completeSprint(sprint.id)} className="inline-flex items-center gap-1.5 text-sm border border-border-subtle rounded-lg px-3 py-1.5 text-dim hover:bg-hover">
                        <CheckCircle2 className="w-4 h-4" /> ปิด Sprint
                      </button>
                    </div>
                  </div>

                  {sprint.status === 'planned' && (
                    <div className="text-[11px] text-muted mb-2">
                      ลากงานจาก Backlog ของ <span className="font-medium">{item.projectName}</span> มาวางด้านล่างนี้ — ลากข้ามโปรเจกต์ไม่ได้
                    </div>
                  )}
                  <div
                    onDragOver={sprint.status === 'planned' && isDropValid ? (e: DragEvent) => { e.preventDefault(); setDropHoverSprintId(sprint.id) } : undefined}
                    onDragLeave={() => setDropHoverSprintId(null)}
                    onDrop={sprint.status === 'planned' && isDropValid ? (e: DragEvent) => { e.preventDefault(); void dropOnSprint(sprint.id) } : undefined}
                    className={`bg-hover rounded-lg p-3 min-h-24 border-2 border-dashed ${isDropHovering ? 'border-brand-400 bg-brand-50' : 'border-transparent'}`}
                  >
                    <div className="text-xs font-semibold text-body mb-2">ในนี้ ({item.tasks.length})</div>
                    {item.tasks.length === 0 ? (
                      <div className="text-center text-xs text-muted py-4">ยังไม่มีงานใน Sprint — ลาก Backlog มาใส่</div>
                    ) : (
                      <div className="space-y-1.5">
                        {item.tasks.map((t) => (
                          <div key={t.id} className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-2 text-sm border border-border-subtle flex-wrap">
                            {t.code && <span className="text-[11px] font-mono text-muted shrink-0">{t.code}</span>}
                            <button onClick={() => navigate(`/tasks/${t.id}`)} className="flex-1 truncate text-left hover:underline min-w-24">{t.title}</button>
                            <LabelChips catalog={cfg?.labels} ids={t.labelIds} />
                            <select
                              value={t.status}
                              onChange={(e) => void changeStatus(t.id, e.target.value as TaskStatus)}
                              className={`text-[11px] rounded px-1.5 py-1 border-0 shrink-0 ${TASK_STATUS_BADGE[t.status]}`}
                            >
                              {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
                            </select>
                            <DueDateChip dueDate={t.dueDate} status={t.status} />
                            {t.assigneeName && (
                              <Avatar name={t.assigneeName} avatarUrl={null} className="w-5 h-5 text-[9px] shrink-0" colorClass={avatarColor(t.assigneeName)} />
                            )}
                            {sprint.status === 'planned' && (
                              <button onClick={() => void removeFromSprint(sprint.id, t.id)} className="text-muted hover:text-danger-600 shrink-0"><X className="w-3.5 h-3.5" /></button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {starting && (
        <SprintStartModal
          sprintId={starting.id}
          defaultStartDate={starting.startDate}
          defaultEndDate={starting.endDate}
          onClose={() => setStarting(null)}
          onStarted={() => {
            const startedId = starting.id
            const projectId = starting.projectId
            setStarting(null)
            reloadAll()
            navigate(`/projects/${projectId}/sprints/${startedId}/board`)
          }}
        />
      )}
    </>
  )
}
