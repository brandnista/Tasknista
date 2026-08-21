/**
 * Pronista §System Requirements Update — Sprint Kanban ของห้อง Workspace (Developer) — เหมือน Board.tsx แต่ข้ามโปรเจกต์ได้
 * ใช้ endpoint เดิม GET /api/sprints/:id/board (project-agnostic อยู่แล้ว) ต่างจาก Board.tsx แค่: back-link ไปห้อง + แสดง ProjectChip ต่อการ์ด (เพราะงานมาจากหลายโปรเจกต์ในห้องเดียวกัน)
 */
import { CheckCircle2, ChevronLeft, X } from 'lucide-react'
import { type DragEvent, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { Label } from '@seedoffice/core'
import { Avatar } from '../components/Avatar'
import { useDialog } from '../components/Dialog'
import { LabelChips } from '../components/LabelChips'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { checklistLabel, dueUrgency, URGENCY_CARD_CLASS } from '../lib/due-urgency'
import { fmtThaiDate, statusChip } from '../lib/project-ui'
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
  // Pronista §System Requirements Update — สิทธิ์แก้ไขจริงต่อการ์ด (เช็คจาก backend canEditTask — แม่นกว่าเช็คแค่ role กว้างๆ)
  canEdit: boolean
  // Pronista §Card glance-at-a-glance — วันครบกำหนด + ความคืบหน้าเช็กลิสต์ โชว์บนการ์ดโดยไม่ต้องเปิด
  dueDate: string | null
  checklistDone: number | null
  checklistTotal: number | null
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
  // Pronista §System Requirements Update — "ปิด Sprint" เป็นแอ็กชันระดับ Sprint (ไม่ใช่ต่อการ์ด) ยังเช็คแค่ role กว้างๆ ได้ · การ์ดแต่ละใบใช้ t.canEdit จาก backend แทน (ตรงกับ canEditTask จริง)
  const canEditSprint = user?.role !== 'vendor' && user?.role !== 'guest'
  const projectOf = (id: string) => room?.projects.find((p) => p.id === id)

  // Pronista §Board Presence + Live Update + Live Cursor — เหมือน Board.tsx ทุกอย่าง (DO ตัวเดียวกัน คีย์ด้วย sprintId เหมือนกัน)
  const [viewers, setViewers] = useState<{ userId: string; name: string }[]>([])
  const [cursors, setCursors] = useState<Record<string, { name: string; x: number; y: number; updatedAt: number }>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const boardAreaRef = useRef<HTMLDivElement>(null)
  const lastCursorSentRef = useRef(0)
  useEffect(() => {
    if (!sprintId) return
    let stopped = false
    let retry: number | null = null
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/api/sprints/${sprintId}/board/ws`)
      wsRef.current = ws
      ws.onmessage = (e) => {
        if (e.data === 'pong') return
        try {
          const msg = JSON.parse(String(e.data)) as { type?: string; viewers?: typeof viewers; userId?: string; name?: string; x?: number; y?: number }
          if (msg.type === 'roster' && msg.viewers) setViewers(msg.viewers)
          if (msg.type === 'board_changed') void reload()
          if (msg.type === 'cursor' && msg.userId && msg.name && typeof msg.x === 'number' && typeof msg.y === 'number') {
            setCursors((prev) => ({ ...prev, [msg.userId!]: { name: msg.name!, x: msg.x!, y: msg.y!, updatedAt: Date.now() } }))
          }
        } catch {
          // ข้อความนอกรูปแบบ
        }
      }
      ws.onclose = () => {
        if (!stopped) retry = window.setTimeout(connect, 2000)
      }
    }
    connect()
    const ping = window.setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send('ping')
    }, 30_000)
    const sweep = window.setInterval(() => {
      const cutoff = Date.now() - 4000
      setCursors((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([, v]) => v.updatedAt > cutoff))
        return Object.keys(next).length === Object.keys(prev).length ? prev : next
      })
    }, 2000)
    return () => {
      stopped = true
      if (retry) window.clearTimeout(retry)
      window.clearInterval(ping)
      window.clearInterval(sweep)
      wsRef.current?.close()
    }
  }, [sprintId])

  const onBoardMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    const now = Date.now()
    if (now - lastCursorSentRef.current < 60) return
    lastCursorSentRef.current = now
    const rect = boardAreaRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'cursor', x, y }))
  }

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

  // Pronista §Card glance-at-a-glance — "เสร็จแล้ว" อิงคอลัมน์สุดท้ายของ preset (เหมือน Board.tsx)
  const isDoneColumn = (t: BoardTask) => !!columns.length && t.sprintStatus === columns[columns.length - 1]!.id

  const renderCard = (t: BoardTask) => {
    const proj = projectOf(t.projectId)
    const urgency = dueUrgency(t.dueDate, isDoneColumn(t))
    const checklist = checklistLabel(t.checklistDone, t.checklistTotal)
    return (
      <div
        key={t.id}
        draggable={t.canEdit}
        onDragStart={() => setDragId(t.id)}
        onClick={() => openTask(t.id)}
        className={`group rounded-lg shadow-xs p-3 cursor-pointer hover:shadow-sm ${URGENCY_CARD_CLASS[urgency]}`}
      >
        <div className="flex items-start gap-1.5 flex-wrap">
          {proj && <ProjectChip code={proj.code} name={proj.name} />}
          {t.code && <span className="text-[11px] font-mono text-muted shrink-0">{t.code}</span>}
          <span className="text-sm text-body flex-1">{t.title}</span>
          {t.canEdit && (
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
          {t.dueDate && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${urgency === 'overdue' ? 'bg-danger-100 text-danger-700' : urgency === 'soon' ? 'bg-warning-100 text-warning-700' : 'bg-divider text-dim'}`}>
              {fmtThaiDate(t.dueDate)}
            </span>
          )}
          {checklist && <span className="text-[11px] text-dim">{checklist}</span>}
          <LabelChips catalog={cfg?.labels} ids={t.labelIds} />
          {t.assigneeName && (
            <Avatar name={t.assigneeName} avatarUrl={t.assigneeAvatarUrl} className="w-5 h-5 text-[9px] ml-auto" colorClass={avatarColor(t.assigneeName)} />
          )}
        </div>
      </div>
    )
  }

  return (
    <div ref={boardAreaRef} onMouseMove={onBoardMouseMove} className="relative p-3 sm:p-6">
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
        {viewers.length > 0 && (
          <div className="flex items-center -space-x-1.5 ml-2" title={`${viewers.length} คนกำลังดูบอร์ดนี้: ${viewers.map((v) => v.name).join(', ')}`}>
            {viewers.slice(0, 5).map((v) => (
              <Avatar key={v.userId} name={v.name} avatarUrl={null} className="w-6 h-6 text-[10px] ring-2 ring-white" colorClass={avatarColor(v.name)} />
            ))}
            {viewers.length > 5 && (
              <span className="w-6 h-6 rounded-full bg-divider text-[10px] text-dim flex items-center justify-center ring-2 ring-white">+{viewers.length - 5}</span>
            )}
          </div>
        )}
        {canEditSprint && (
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

      {/* Pronista §Live Cursor — เมาส์คนอื่นที่เปิดบอร์ดเดียวกันอยู่ ลอยทับเนื้อหา ไม่รับ pointer event เอง */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-30">
        {Object.entries(cursors).map(([userId, c]) => {
          const parts = (avatarColor(c.name) ?? '').split(' ')
          const bgClass = parts[0] ?? ''
          const textClass = parts[1] ?? ''
          return (
            <div
              key={userId}
              className="absolute transition-[left,top] duration-100 ease-linear"
              style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" className={`drop-shadow-sm ${textClass}`}>
                <path d="M1 1l6.5 15.5 2.2-6.3L16 8 1 1z" fill="currentColor" stroke="white" strokeWidth="1" strokeLinejoin="round" />
              </svg>
              <span className={`ml-3 -mt-1 inline-block text-[11px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap ${bgClass} ${textClass}`}>
                {c.name}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
