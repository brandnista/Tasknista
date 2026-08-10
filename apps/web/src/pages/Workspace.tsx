/**
 * Pronista §Workspace — Sprint/Backlog รวมทุกโปรเจกต์ที่ถูกดึงเข้าห้องนี้ (คล้าย Jira 1 Board ต่อทีม ไม่แยกตามโปรเจกต์)
 * อ่านข้อมูลจาก /api/workspace/* (aggregate อ่านอย่างเดียว, แคบด้วย ?workspaceId=) แต่ mutation ทั้งหมดยิง endpoint เดิมของ sprints/tasks
 * (สร้าง/เริ่ม/ปิด Sprint, ลากงานเข้า Sprint, สร้าง backlog task, เปลี่ยน status) — ดูแผน "Workspace" ประกอบ
 * §รอบ 2 — Backlog Grid เป็นตารางแบนรวมทุก work item (Epic/Story/Task/Subtask) ข้ามโปรเจกต์ ไม่แยก section ต่อโปรเจกต์ ฟิลเตอร์เอาแทน
 * §รอบ 3 (ต่อยอด) — Sprint ผูกห้อง Workspace โดยตรง (ไม่ผูกโปรเจกต์เดียวอีกต่อไป) งานในนั้นมาจากหลายโปรเจกต์ในห้องเดียวกันได้ · ห้องใหม่เริ่มว่างเปล่าจนกว่าจะดึงโปรเจกต์เข้าห้อง (แก้ไขชื่อ/ลบห้อง/จัดการโปรเจกต์ในห้องได้ที่นี่)
 */
import type { Label } from '@seedoffice/core'
import { AlertTriangle, ArrowLeft, CheckCircle2, Layers, Pencil, Play, Plus, Trash2, X } from 'lucide-react'
import { type DragEvent, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
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
  projectId: string
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
  projectId: string | null
  workspaceId: string | null
  name: string | null
  status: 'planned' | 'active' | 'completed'
  startDate: string
  endDate: string
  goal: string | null
  doneCount: number | null
  notDoneCount: number | null
}
interface WsSprintItem { sprint: WsSprint; tasks: WsTask[] }
interface RoomDetail { id: string; name: string; canManage: boolean; projects: AccessibleProject[] }

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

/** Pronista §Workspace Rooms (ต่อยอด) — แก้ชื่อห้อง + ดึง/เอาโปรเจกต์เข้า-ออกห้อง + ลบห้อง (เฉพาะผู้สร้างห้องหรือ owner บริษัท — เช็คซ้ำที่ server เสมอ) */
function RoomEditModal({ workspaceId, currentName, linkedProjects, onClose, onChanged, onDeleted }: {
  workspaceId: string
  currentName: string
  linkedProjects: AccessibleProject[]
  onClose: () => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const { confirmDialog } = useDialog()
  const { data: allProjects } = useLoad<{ id: string; code: string | null; name: string }[]>(() => api.get('/api/projects'))
  const [name, setName] = useState(currentName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const linkedIds = new Set(linkedProjects.map((p) => p.id))

  const saveName = async () => {
    if (!name.trim() || name.trim() === currentName) return
    setSaving(true)
    setError('')
    try {
      await api.patch(`/api/workspaces/${workspaceId}`, { name: name.trim() })
      onChanged()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'แก้ไขชื่อไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const toggleProject = async (projectId: string, linked: boolean) => {
    setError('')
    try {
      if (linked) await api.delete(`/api/workspaces/${workspaceId}/projects/${projectId}`)
      else await api.post(`/api/workspaces/${workspaceId}/projects`, { projectId })
      onChanged()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'แก้ไขโปรเจกต์ในห้องไม่สำเร็จ')
    }
  }

  const deleteRoom = async () => {
    const ok = await confirmDialog({ title: `ลบ Workspace "${currentName}"?`, message: 'สมาชิก/โปรเจกต์ที่ผูกไว้ในห้องนี้จะถูกเลิกผูก (โปรเจกต์/งานจริงไม่หาย)', confirmLabel: 'ลบห้อง', danger: true })
    if (!ok) return
    try {
      await api.delete(`/api/workspaces/${workspaceId}`)
      onDeleted()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'ลบห้องไม่สำเร็จ')
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-14 mx-auto w-full max-w-md px-4">
        <div className="bg-white rounded-lg shadow-2xl p-5 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="font-semibold text-ink text-sm">แก้ไข Workspace</div>
            <button onClick={onClose} className="text-muted hover:text-soft shrink-0"><X className="w-5 h-5" /></button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">ชื่อ Workspace</label>
              <div className="flex gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400" />
                <button onClick={() => void saveName()} disabled={saving || !name.trim() || name.trim() === currentName} className="text-sm bg-brand-600 text-white px-3 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">บันทึก</button>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">โปรเจกต์ในห้องนี้ ({linkedProjects.length})</label>
              <div className="border border-border-subtle rounded-lg max-h-56 overflow-y-auto divide-y divide-divider">
                {(allProjects ?? []).length === 0 && <div className="text-xs text-muted px-3 py-4 text-center">ยังไม่มีโปรเจกต์ในระบบ</div>}
                {(allProjects ?? []).map((p) => (
                  <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-hover">
                    <input type="checkbox" checked={linkedIds.has(p.id)} onChange={() => void toggleProject(p.id, linkedIds.has(p.id))} />
                    <span className="text-body truncate">{p.name}</span>
                    {p.code && <span className="text-[10px] font-mono text-muted ml-auto shrink-0">{p.code}</span>}
                  </label>
                ))}
              </div>
              <div className="text-[11px] text-muted mt-1">ห้องใหม่เริ่มว่างเปล่า — ติ๊กโปรเจกต์ที่อยากให้ Backlog/Sprint ของห้องนี้ดึงงานเข้ามา</div>
            </div>
            {error && <div className="text-xs text-danger-600">{error}</div>}
            <div className="pt-2 border-t border-divider">
              <button onClick={() => void deleteRoom()} className="flex items-center gap-1.5 text-sm text-danger-600 hover:text-danger-700">
                <Trash2 className="w-4 h-4" /> ลบ Workspace นี้
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function WorkspacePage() {
  const navigate = useNavigate()
  const { confirmDialog } = useDialog()
  const { workspaceId } = useParams<{ workspaceId: string }>()

  // Pronista §Workspace Rooms — เข้าห้องได้เฉพาะสมาชิก (เช็คซ้ำที่ server เสมอ) — โหลดชื่อห้อง/โปรเจกต์ในห้องมาโชว์เป็น breadcrumb
  const { data: room, loading: roomLoading, error: roomError, reload: reloadRoom } = useLoad<RoomDetail>(
    () => api.get(`/api/workspaces/${workspaceId}`),
    [workspaceId],
  )

  const { data: projects } = useLoad<AccessibleProject[]>(() => api.get(`/api/workspace/accessible-projects?workspaceId=${workspaceId}`), [workspaceId])
  const { data: cfg } = useLoad<{ labels: Label[] }>(() => api.get('/api/config'))
  const [projectFilter, setProjectFilter] = useState('all')
  const queryIds = projectFilter === 'all' ? '' : projectFilter

  const { data: backlogData, reload: reloadBacklog } = useLoad<{ items: WsBacklogItem[] }>(
    () => api.get(`/api/workspace/backlog-items?workspaceId=${workspaceId}${queryIds ? `&projectIds=${queryIds}` : ''}`),
    [workspaceId, queryIds],
  )
  const { data: boardData, reload: reloadBoard } = useLoad<{ sprints: WsSprintItem[] }>(
    () => api.get(`/api/workspaces/${workspaceId}/sprints/current`),
    [workspaceId],
  )
  const reloadAll = () => { void reloadBacklog(); void reloadBoard() }

  const [dispatcherFilter, setDispatcherFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all')
  const [workTypeFilter, setWorkTypeFilter] = useState<'all' | WorkType>('all')

  const [addTitle, setAddTitle] = useState('')
  const [addProjectId, setAddProjectId] = useState('')

  const [error, setError] = useState('')
  const [editingRoom, setEditingRoom] = useState(false)

  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [dropHoverSprintId, setDropHoverSprintId] = useState<string | null>(null)

  const [starting, setStarting] = useState<{ id: string; startDate: string; endDate: string } | null>(null)

  const projectName = (id: string) => projects?.find((p) => p.id === id)
  const effectiveAddProjectId = addProjectId || projects?.[0]?.id || ''

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
    if (!title || !effectiveAddProjectId) return
    setError('')
    try {
      await api.post(`/api/projects/${effectiveAddProjectId}/backlog`, { title, kind: 'backlog' })
      setAddTitle('')
      void reloadBacklog()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'สร้างงานไม่สำเร็จ')
    }
  }

  // Pronista §Workspace Sprint (ต่อยอด) — กด "+ Sprint" สร้าง container ว่างทันทีที่ผูกห้องนี้เลย ไม่ต้องเลือกโปรเจกต์ (งานในนั้นมาจากหลายโปรเจกต์ในห้องได้)
  const createSprint = async () => {
    setError('')
    try {
      await api.post(`/api/workspaces/${workspaceId}/sprints`)
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
    if (!taskId) return
    setError('')
    try {
      await api.post(`/api/sprints/${sprintId}/tasks`, { taskId })
      reloadAll()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'ลากเข้า Sprint ไม่สำเร็จ')
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

  // Pronista §Workspace Rooms — ต้องอยู่หลัง hook ตัวสุดท้ายเสมอ กัน "Rendered more hooks" (โหลด/error สลับกันข้าม render ได้)
  if (roomLoading) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>
  if (roomError || !room) {
    return (
      <div className="p-6">
        <div className="bg-danger-50 text-danger-700 text-sm rounded-lg px-4 py-3 mb-3">ไม่พบ Workspace นี้ หรือคุณไม่ใช่สมาชิก</div>
        <Link to="/workspace" className="text-sm text-brand-700 hover:underline inline-flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> กลับไปหน้า Workspace</Link>
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title={room.name}
        action={
          <div className="flex items-center gap-2">
            {room.canManage && (
              <button onClick={() => setEditingRoom(true)} className="inline-flex items-center gap-1.5 text-sm border border-border-subtle rounded-lg px-3 py-1.5 text-dim hover:bg-hover">
                <Pencil className="w-3.5 h-3.5" /> แก้ไขห้อง
              </button>
            )}
            <button
              onClick={() => void createSprint()}
              className="inline-flex items-center gap-1.5 text-sm bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 font-medium"
            >
              <Plus className="w-4 h-4" /> Sprint
            </button>
          </div>
        }
      />

      <div className="p-3 sm:p-6 space-y-4">
        <Link to="/workspace" className="text-xs text-muted hover:text-brand-700 inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> ทุก Workspace</Link>
        {error && <div className="bg-danger-50 text-danger-700 text-sm rounded-lg px-3 py-2">{error}</div>}

        {room.projects.length === 0 ? (
          <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-muted">
            ห้องนี้ยังว่างเปล่า — ยังไม่มีโปรเจกต์ถูกดึงเข้าห้อง
            {room.canManage && (
              <div className="mt-2">
                <button onClick={() => setEditingRoom(true)} className="text-brand-700 hover:underline font-medium">กด "แก้ไขห้อง" เพื่อเพิ่มโปรเจกต์</button>
              </div>
            )}
          </div>
        ) : (
          <>
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
              {/* Backlog Grid — ตารางแบนรวมทุก work item ข้ามโปรเจกต์ในห้อง */}
              <div className="space-y-3">
                <div className="text-sm font-semibold text-ink">📥 Backlog ({filteredItems.length})</div>
                <div className="bg-white rounded-lg shadow-xs overflow-hidden">
                  {filteredItems.length === 0 && <div className="p-6 text-center text-sm text-muted">ไม่มีงาน — ลองปรับตัวกรองดู</div>}
                  <div className="divide-y divide-divider">
                    {filteredItems.map((it) => (
                      <div
                        key={it.id}
                        draggable={it.kind !== 'epic'}
                        onDragStart={(e: DragEvent) => { if (it.kind === 'epic') return; e.dataTransfer.setData('text/plain', it.id); setDragTaskId(it.id) }}
                        onDragEnd={() => setDragTaskId(null)}
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
                    <select value={effectiveAddProjectId} onChange={(e) => setAddProjectId(e.target.value)} className={selectCls}>
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

              {/* Sprint — การ์ดต่อ sprint ผูกห้องนี้ (ข้ามโปรเจกต์ในห้องได้) */}
              <div className="space-y-3">
                <div className="text-sm font-semibold text-ink">🏃 Sprint</div>
                {sprintItems.length === 0 && (
                  <div className="bg-white rounded-lg shadow-xs p-6 text-center text-sm text-muted">ยังไม่มี Sprint ที่เปิดอยู่ — กดปุ่ม "+ Sprint" มุมขวาบน</div>
                )}
                {sprintItems.map((item) => {
                  const { sprint } = item
                  const isDropHovering = dropHoverSprintId === sprint.id
                  const canDrop = sprint.status !== 'completed' && !!dragTaskId
                  const counts: Record<TaskStatus, number> = { non_start: 0, on_processing: 0, waiting_for_test: 0, done: 0 }
                  for (const t of item.tasks) counts[t.status] = (counts[t.status] ?? 0) + 1
                  return (
                    <div key={sprint.id} className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
                      <div className="flex flex-wrap items-center gap-2 mb-3">
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
                          {sprint.status === 'planned' && (
                            <button onClick={() => setStarting({ id: sprint.id, startDate: sprint.startDate, endDate: sprint.endDate })} className="inline-flex items-center gap-1.5 text-sm bg-brand-600 text-white px-3 py-1.5 rounded-lg hover:bg-brand-700 font-medium">
                              <Play className="w-4 h-4" /> เริ่ม Sprint
                            </button>
                          )}
                          <button onClick={() => void completeSprint(sprint.id)} className="inline-flex items-center gap-1.5 text-sm border border-border-subtle rounded-lg px-3 py-1.5 text-dim hover:bg-hover">
                            <CheckCircle2 className="w-4 h-4" /> ปิด Sprint
                          </button>
                        </div>
                      </div>

                      {sprint.status !== 'completed' && (
                        <div className="text-[11px] text-muted mb-2">ลากงานจาก Backlog ด้านซ้ายมาวางด้านล่างนี้ — ข้ามโปรเจกต์ในห้องเดียวกันได้</div>
                      )}
                      <div
                        onDragOver={canDrop ? (e: DragEvent) => { e.preventDefault(); setDropHoverSprintId(sprint.id) } : undefined}
                        onDragLeave={() => setDropHoverSprintId(null)}
                        onDrop={canDrop ? (e: DragEvent) => { e.preventDefault(); void dropOnSprint(sprint.id) } : undefined}
                        className={`bg-hover rounded-lg p-3 min-h-24 border-2 border-dashed ${isDropHovering ? 'border-brand-400 bg-brand-50' : 'border-transparent'}`}
                      >
                        <div className="text-xs font-semibold text-body mb-2">ในนี้ ({item.tasks.length})</div>
                        {item.tasks.length === 0 ? (
                          <div className="text-center text-xs text-muted py-4">ยังไม่มีงานใน Sprint — ลาก Backlog มาใส่</div>
                        ) : (
                          <div className="space-y-1.5">
                            {item.tasks.map((t) => {
                              const proj = projectName(t.projectId)
                              return (
                                <div key={t.id} className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-2 text-sm border border-border-subtle flex-wrap">
                                  {proj && <ProjectChip code={proj.code} name={proj.name} />}
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
                                  {sprint.status !== 'completed' && (
                                    <button onClick={() => void removeFromSprint(sprint.id, t.id)} className="text-muted hover:text-danger-600 shrink-0"><X className="w-3.5 h-3.5" /></button>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {starting && (
        <SprintStartModal
          sprintId={starting.id}
          defaultStartDate={starting.startDate}
          defaultEndDate={starting.endDate}
          onClose={() => setStarting(null)}
          onStarted={() => {
            setStarting(null)
            reloadAll()
          }}
        />
      )}

      {editingRoom && room && (
        <RoomEditModal
          workspaceId={room.id}
          currentName={room.name}
          linkedProjects={room.projects}
          onClose={() => setEditingRoom(false)}
          onChanged={() => { void reloadRoom(); reloadAll() }}
          onDeleted={() => navigate('/workspace')}
        />
      )}
    </>
  )
}
