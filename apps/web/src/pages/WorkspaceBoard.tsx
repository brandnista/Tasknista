/**
 * Pronista §System Requirements Update — Sprint Kanban ของห้อง Workspace (Developer) — เหมือน Board.tsx แต่ข้ามโปรเจกต์ได้
 * ใช้ endpoint เดิม GET /api/sprints/:id/board (project-agnostic อยู่แล้ว) ต่างจาก Board.tsx แค่: back-link ไปห้อง + แสดง ProjectChip ต่อการ์ด (เพราะงานมาจากหลายโปรเจกต์ในห้องเดียวกัน)
 */
import { CheckCircle2, ChevronLeft, X } from 'lucide-react'
import { type DragEvent, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { Label } from '@seedoffice/core'
import { Avatar } from '../components/Avatar'
import { useDialog } from '../components/Dialog'
import { LabelChips } from '../components/LabelChips'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { statusChip } from '../lib/project-ui'
import { useLoad } from '../lib/useLoad'
import { avatarColor } from './ProjectDetail'

interface BoardColumn { id: string; name: string; color: string; sortOrder: number }
interface BoardPreset { id: string; name: string; columns: BoardColumn[] }
interface BoardSprint { id: string; workspaceId: string | null; name: string | null; startDate: string; endDate: string; status: 'planned' | 'active' | 'completed' }
interface BoardTask {
  id: string
  code: string | null
  title: string
  priority: 'low' | 'normal' | 'high'
  sprintStatus: string | null
  assigneeName: string | null
  assigneeAvatarUrl: string | null
  projectId: string
  labelIds: string[] | null
}
interface BoardData { sprint: BoardSprint | null; preset?: BoardPreset | null; tasks?: BoardTask[] }
interface RoomProject { id: string; code: string | null; name: string }
interface RoomDetail { id: string; name: string; projects: RoomProject[] }

const PRIORITY_DOT = { low: 'bg-border', normal: 'bg-warning-400', high: 'bg-danger-500' } as const

function ProjectChip({ code, name }: { code: string | null; name: string }) {
  return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 shrink-0">{code || name}</span>
}

/** Pronista §System Requirements Update — Board ของห้อง Workspace (คนละอันกับ Board.tsx ของโปรเจกต์เดียว) = กระดานของ sprint ที่ผูกห้องนี้ งานในนั้นมาจากหลายโปรเจกต์ในห้องได้ */
export function WorkspaceBoardPage() {
  const { workspaceId, sprintId } = useParams<{ workspaceId: string; sprintId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { confirmDialog } = useDialog()
  const { data: room } = useLoad<RoomDetail>(() => api.get(`/api/workspaces/${workspaceId}`), [workspaceId])
  const { data, reload } = useLoad<BoardData>(() => api.get(`/api/sprints/${sprintId}/board`), [sprintId])
  const { data: cfg } = useLoad<{ labels: Label[] }>(() => api.get('/api/config'))
  const [dragId, setDragId] = useState<string | null>(null)
  const openTask = (id: string) => navigate(`/tasks/${id}`)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const sprint = data?.sprint
  const preset = data?.preset
  const tasks = data?.tasks ?? []
  const columns = preset ? [...preset.columns].sort((a, b) => a.sortOrder - b.sortOrder) : []
  const canEdit = user?.role !== 'vendor' && user?.role !== 'guest'
  const projectOf = (id: string) => room?.projects.find((p) => p.id === id)

  const changeStatus = async (taskId: string, sprintStatus: string) => {
    await api.patch(`/api/tasks/${taskId}`, { sprintStatus })
    await reload()
  }
  const removeFromSprint = async (taskId: string, code: string | null) => {
    if (!sprint) return
    await api.delete(`/api/sprints/${sprint.id}/tasks/${taskId}`)
    await reload()
    setNotice(`เอา ${code ?? 'งาน'} ออกจาก Sprint แล้ว — กลับไปที่ Backlog ของห้อง Workspace เพื่อดู`)
  }
  const completeSprint = async () => {
    if (!sprint) return
    const ok = await confirmDialog({ title: 'ปิด Sprint นี้เลยไหม?', message: 'งานที่ยังไม่ Done จะเด้งกลับ Backlog', confirmLabel: 'ปิด Sprint', danger: true })
    if (!ok) return
    setBusy(true)
    try {
      await api.post(`/api/sprints/${sprint.id}/complete`)
      navigate(`/workspace/${workspaceId}`)
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>
  if (!sprint || !preset)
    return (
      <div className="p-6 text-center text-sm text-muted">
        ไม่พบ Sprint นี้ หรือยังไม่ได้ Start
        <div className="mt-3">
          <Link to={`/workspace/${workspaceId}`} className="text-brand-600 hover:underline">← กลับไปห้อง Workspace</Link>
        </div>
      </div>
    )

  const over = (e: DragEvent) => e.preventDefault()

  const renderCard = (t: BoardTask) => {
    const proj = projectOf(t.projectId)
    return (
      <div
        key={t.id}
        draggable={canEdit}
        onDragStart={() => setDragId(t.id)}
        onClick={() => openTask(t.id)}
        className="group bg-white rounded-lg shadow-xs p-3 cursor-pointer hover:shadow-sm"
      >
        <div className="flex items-start gap-1.5 flex-wrap">
          {proj && <ProjectChip code={proj.code} name={proj.name} />}
          {t.code && <span className="text-[11px] font-mono text-muted shrink-0">{t.code}</span>}
          <span className="text-sm text-body flex-1">{t.title}</span>
          {canEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); void removeFromSprint(t.id, t.code) }}
              title="เอาออกจาก Sprint กลับ Backlog"
              className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger-600 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[t.priority]}`} />
          <LabelChips catalog={cfg?.labels} ids={t.labelIds} />
          {t.assigneeName && (
            <Avatar name={t.assigneeName} avatarUrl={t.assigneeAvatarUrl} className="w-5 h-5 text-[9px] ml-auto" colorClass={avatarColor(t.assigneeName)} />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 sm:p-6">
      <Link to={`/workspace/${workspaceId}`} className="text-sm text-muted hover:text-soft flex items-center gap-1 mb-4">
        <ChevronLeft className="w-4 h-4" /> กลับไปห้อง {room?.name ?? 'Workspace'}
      </Link>

      {notice && (
        <div className="mb-4 flex items-start justify-between gap-2 text-sm text-info-700 bg-info-50 border border-info-100 rounded-lg px-3.5 py-2.5">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-info-600 hover:text-info-800 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-xs p-4 mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-ink">{sprint.name || 'Sprint'}</h2>
        <span className="text-xs px-2 py-0.5 rounded-full bg-info-50 text-info-700 ml-2">{preset.name}</span>
        {canEdit && (
          <button
            onClick={() => void completeSprint()}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1.5 text-sm border border-border-subtle rounded-lg px-3 py-1.5 text-dim hover:bg-hover disabled:opacity-40"
          >
            <CheckCircle2 className="w-4 h-4" /> ปิด Sprint
          </button>
        )}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const colTasks = tasks.filter((t) => t.sprintStatus === col.id)
          return (
            <div key={col.id} onDragOver={over} onDrop={() => { if (dragId) void changeStatus(dragId, col.id); setDragId(null) }} className="bg-hover/60 rounded-lg p-2 min-h-32 w-64 shrink-0">
              <div className="flex items-center gap-1.5 px-1.5 py-1 mb-1.5">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusChip(col.color)}`}>{col.name}</span>
                <span className="text-xs text-muted">{colTasks.length}</span>
              </div>
              <div className="space-y-2">
                {colTasks.map((t) => renderCard(t))}
                {colTasks.length === 0 && <div className="text-center text-[11px] text-border py-3">ไม่มีงาน</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
