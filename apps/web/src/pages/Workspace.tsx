/**
 * Pronista §Workspace — Sprint/Backlog รวมทุกโปรเจกต์ที่มีสิทธิ์เห็น (คล้าย Jira 1 Board ต่อทีม ไม่แยกตามโปรเจกต์)
 * อ่านข้อมูลจาก /api/workspace/* (aggregate อ่านอย่างเดียว) แต่ mutation ทั้งหมดยิง endpoint เดิมของ sprints/tasks
 * (สร้าง/เริ่ม/ปิด Sprint, ลากงานเข้า Sprint, สร้าง backlog task) — ดูแผน "Workspace" ประกอบ
 */
import type { Label } from '@seedoffice/core'
import { CheckCircle2, ChevronRight, Layers, Play, Plus, X } from 'lucide-react'
import { type DragEvent, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useDialog } from '../components/Dialog'
import { LabelChips } from '../components/LabelChips'
import { PageHeader } from '../components/PageHeader'
import { api, ApiError } from '../lib/api'
import { fmtThaiDate } from '../lib/project-ui'
import { useLoad } from '../lib/useLoad'
import { avatarColor, SprintStartModal } from './ProjectDetail'
import { Avatar } from '../components/Avatar'

interface AccessibleProject { id: string; code: string | null; name: string }
interface WsTask {
  id: string
  code: string | null
  title: string
  priority: 'low' | 'normal' | 'high'
  assigneeName: string | null
  labelIds: string[] | null
  kind?: string
}
interface BacklogGroup { projectId: string; projectCode: string | null; projectName: string; tasks: WsTask[] }
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

function ProjectChip({ code, name }: { code: string | null; name: string }) {
  return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 shrink-0">{code || name}</span>
}

export function WorkspacePage() {
  const navigate = useNavigate()
  const { confirmDialog } = useDialog()
  const [searchParams] = useSearchParams()
  const preselect = searchParams.get('project')

  const { data: projects } = useLoad<AccessibleProject[]>(() => api.get('/api/workspace/accessible-projects'))
  const { data: cfg } = useLoad<{ labels: Label[] }>(() => api.get('/api/config'))
  // null = ทุกโปรเจกต์ที่เข้าถึงได้ (ค่าเริ่มต้น) · Set = filter เฉพาะที่เลือก
  const [selected, setSelected] = useState<Set<string> | null>(preselect ? new Set([preselect]) : null)
  const queryIds = selected ? [...selected].join(',') : ''

  const { data: backlogData, reload: reloadBacklog } = useLoad<{ tasksByProject: BacklogGroup[] }>(
    () => api.get(`/api/workspace/backlog${queryIds ? `?projectIds=${queryIds}` : ''}`),
    [queryIds],
  )
  const { data: boardData, reload: reloadBoard } = useLoad<{ sprints: WsSprintItem[] }>(
    () => api.get(`/api/workspace/board${queryIds ? `?projectIds=${queryIds}` : ''}`),
    [queryIds],
  )
  const reloadAll = () => { void reloadBacklog(); void reloadBoard() }

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleCollapsed = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const [addTitle, setAddTitle] = useState<Record<string, string>>({})
  const [busyProject, setBusyProject] = useState<string | null>(null)
  const [error, setError] = useState('')

  const [dragTaskId, setDragTaskId] = useState<string | null>(null)
  const [dragTaskProjectId, setDragTaskProjectId] = useState<string | null>(null)
  const [dropHoverSprintId, setDropHoverSprintId] = useState<string | null>(null)

  const [newSprintPicker, setNewSprintPicker] = useState(false)
  const [starting, setStarting] = useState<{ id: string; projectId: string; startDate: string; endDate: string } | null>(null)

  const addTask = async (projectId: string) => {
    const title = (addTitle[projectId] ?? '').trim()
    if (!title) return
    setError('')
    try {
      await api.post(`/api/projects/${projectId}/backlog`, { title, kind: 'backlog' })
      setAddTitle((s) => ({ ...s, [projectId]: '' }))
      void reloadBacklog()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'สร้างงานไม่สำเร็จ')
    }
  }

  const createSprintFor = async (projectId: string) => {
    setNewSprintPicker(false)
    setBusyProject(projectId)
    setError('')
    try {
      await api.post(`/api/projects/${projectId}/sprints`)
      void reloadBoard()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'สร้าง Sprint ไม่สำเร็จ')
    } finally {
      setBusyProject(null)
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

  const toggleProjectFilter = (id: string) => {
    setSelected((s) => {
      const all = new Set((projects ?? []).map((p) => p.id))
      const cur = s ?? all
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      // เลือกครบทุกอันเท่ากับ "ทั้งหมด" (null) — reset กลับเป็น default
      return next.size === all.size ? null : next
    })
  }

  const backlogGroups = backlogData?.tasksByProject ?? []
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
                    <button key={p.id} onClick={() => void createSprintFor(p.id)} disabled={busyProject === p.id} className="w-full text-left text-sm px-2 py-1.5 rounded-lg hover:bg-hover disabled:opacity-40 truncate">
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

        {/* project filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <Layers className="w-4 h-4 text-muted shrink-0" />
          <button onClick={() => setSelected(null)} className={`text-xs px-2.5 py-1 rounded-full ${!selected ? 'bg-brand-600 text-white' : 'bg-white border border-border-subtle text-dim hover:bg-hover'}`}>
            ทั้งหมด
          </button>
          {(projects ?? []).map((p) => {
            const active = !selected || selected.has(p.id)
            return (
              <button key={p.id} onClick={() => toggleProjectFilter(p.id)} className={`text-xs px-2.5 py-1 rounded-full ${active ? 'bg-brand-100 text-brand-700' : 'bg-white border border-border-subtle text-dim hover:bg-hover'}`}>
                {p.name}
              </button>
            )
          })}
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {/* Backlog — group ต่อโปรเจกต์ */}
          <div className="space-y-3">
            <div className="text-sm font-semibold text-ink">📥 Backlog</div>
            {backlogGroups.length === 0 && <div className="bg-white rounded-lg shadow-xs p-6 text-center text-sm text-muted">ไม่มีงานใน Backlog</div>}
            {backlogGroups.map((g) => {
              const isOpen = !collapsed.has(g.projectId)
              return (
                <div key={g.projectId} className="bg-white rounded-lg shadow-xs overflow-hidden">
                  <button onClick={() => toggleCollapsed(g.projectId)} className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-hover">
                    <ChevronRight className={`w-3.5 h-3.5 text-muted shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    <span className="text-sm font-medium text-ink truncate">{g.projectName}</span>
                    <span className="text-xs text-muted shrink-0">({g.tasks.length})</span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-3">
                      <div className="divide-y divide-divider">
                        {g.tasks.map((t) => (
                          <div
                            key={t.id}
                            draggable
                            onDragStart={(e: DragEvent) => { e.dataTransfer.setData('text/plain', t.id); setDragTaskId(t.id); setDragTaskProjectId(g.projectId) }}
                            onDragEnd={() => { setDragTaskId(null); setDragTaskProjectId(null) }}
                            className={`flex items-center gap-2 py-2 cursor-grab ${dragTaskId === t.id ? 'opacity-50' : ''}`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-border shrink-0" />
                            {t.code && <span className="text-[11px] font-mono text-muted shrink-0">{t.code}</span>}
                            <button onClick={() => navigate(`/tasks/${t.id}`)} className="flex-1 text-sm text-body truncate text-left hover:underline">{t.title}</button>
                            {t.priority === 'high' && <span className="text-[10px] text-danger-600 bg-danger-50 px-1.5 py-0.5 rounded shrink-0">สูง</span>}
                            <LabelChips catalog={cfg?.labels} ids={t.labelIds} />
                            {t.assigneeName && <span className="text-[11px] text-muted shrink-0">{t.assigneeName}</span>}
                          </div>
                        ))}
                        {g.tasks.length === 0 && <div className="text-xs text-muted py-3 text-center">ไม่มีงานใน Backlog ของโปรเจกต์นี้</div>}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <input
                          value={addTitle[g.projectId] ?? ''}
                          onChange={(e) => setAddTitle((s) => ({ ...s, [g.projectId]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') void addTask(g.projectId) }}
                          placeholder="พิมพ์ชื่องานแล้วกด Enter…"
                          className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-1.5 focus:outline-hidden focus:border-brand-400"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
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
                          <div key={t.id} className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-2 text-sm border border-border-subtle">
                            {t.code && <span className="text-[11px] font-mono text-muted shrink-0">{t.code}</span>}
                            <button onClick={() => navigate(`/tasks/${t.id}`)} className="flex-1 truncate text-left hover:underline">{t.title}</button>
                            <LabelChips catalog={cfg?.labels} ids={t.labelIds} />
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
