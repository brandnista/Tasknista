import { CheckCircle2, ChevronLeft, X } from 'lucide-react'
import { type DragEvent, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Avatar } from '../components/Avatar'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fmtThaiDate, STATUS_SWATCH, statusChip } from '../lib/project-ui'
import { useLoad } from '../lib/useLoad'
import { avatarColor } from './ProjectDetail'

interface BoardColumn { id: string; name: string; color: string; sortOrder: number }
interface BoardPreset { id: string; name: string; columns: BoardColumn[] }
interface BoardSprint {
  id: string
  projectId: string
  name: string | null
  startDate: string
  endDate: string
  status: 'planned' | 'active' | 'completed'
}
interface BoardTask {
  id: string
  code: string | null
  title: string
  priority: 'low' | 'normal' | 'high'
  sprintStatus: string | null
  assigneeName: string | null
  assigneeAvatarUrl: string | null
  // Tasknista §SRS import — chip อ้างอิงเอกสาร SRS ต้นทาง (ไม่มีถ้าไม่ได้มาจาก SRS)
  srsRefCode: string | null
  srsDocId: string | null
  // Tasknista §Sprint & Board fix — subtask ของ SOW มี parentId ติดมา ใช้จัดกลุ่ม/ยุบการ์ดใน Mixed/Task View
  parentId: string | null
  // Tasknista §Sprint & Board fix — ใช้วาด Timeline ของ Sprint (แทน GroupTimeline เดิมที่ตายไปตั้งแต่ลบปุ่ม "ย้ายเข้ากระดาน")
  startDate: string | null
  dueDate: string | null
  // Tasknista §Epic Layer — Epic ที่ task นี้สังกัด (สืบมาจาก parent ตอนสร้าง เหมือน originDocType) ใช้จัดกลุ่ม swimlane บน Timeline
  epicId: string | null
}
interface BoardParent { id: string; code: string | null; title: string }
interface BoardEpic { id: string; title: string; code: string | null }
interface BoardData {
  sprint: BoardSprint | null
  preset?: BoardPreset | null
  tasks?: BoardTask[]
  parents?: BoardParent[]
  epics?: BoardEpic[]
}

const PRIORITY_DOT = { low: 'bg-border', normal: 'bg-warning-400', high: 'bg-danger-500' } as const
// Tasknista §Sprint & Board fix — มุมมอง Sprint 3 แบบ: Sub-task View (เดิม) / Mixed View (จัดกลุ่ม subtask ใต้ parent) / Task View (ยุบเหลือการ์ดเดียวต่อ parent)
type SubView = 'sub' | 'mixed' | 'task'
const SUB_VIEW_OPTIONS: [SubView, string][] = [['sub', 'Sub-task View'], ['task', 'Task View'], ['mixed', 'Mixed View']]

/** จัดกลุ่ม task ในคอลัมน์เดียวกันตาม parentId (คงลำดับที่เจอ parent ครั้งแรก) — ใช้ทั้ง Mixed View (โชว์การ์ดครบ+label) และ Task View (ยุบเหลือใบเดียว) */
function groupColumnTasks(colTasks: BoardTask[]) {
  const order: string[] = []
  const groups = new Map<string, BoardTask[]>()
  const singles: BoardTask[] = []
  for (const t of colTasks) {
    if (!t.parentId) {
      singles.push(t)
      continue
    }
    if (!groups.has(t.parentId)) {
      groups.set(t.parentId, [])
      order.push(t.parentId)
    }
    groups.get(t.parentId)!.push(t)
  }
  return { groups: order.map((parentId) => ({ parentId, items: groups.get(parentId)! })), singles }
}

const TIMELINE_COLORS = ['bg-warning-400', 'bg-brand-500', 'bg-info-500', 'bg-violet-500', 'bg-orange-400', 'bg-danger-500', 'bg-success-500']
interface TimelineRow {
  key: string
  label: string
  code: string | null
  start: string
  end: string
  colorClass: string
  onClick?: () => void
  indent?: boolean
  // Tasknista §Epic Layer — ใช้จัดกลุ่มแถวเป็น swimlane ต่อ Epic (null = ไม่ได้มาจากเอกสารที่มี Epic แสดงแบบเดิมไม่มีแถบครอบ)
  epicId?: string | null
}

/** Tasknista §Sprint & Board fix — Timeline จริงของ Sprint นี้ (แทน GroupTimeline เดิมที่ผูกกับระบบ "กลุ่มงาน" ที่ตายไปแล้วตั้งแต่ลบปุ่ม "ย้ายเข้ากระดาน")
 * วาดจาก startDate/dueDate ของ task ตรงๆ (ฟิลด์เดียวกับที่ GroupTimeline เคยใช้) รองรับ 3 มุมมองเหมือน Kanban — Mixed View ตั้งใจให้เห็นชัดกว่า Kanban เพราะเป็น list แนวตั้ง ใส่ label หัวกลุ่ม + เยื้องบรรทัดใต้ได้ */
function SprintTimeline({ tasks, parents, epics, columns, subView, onOpenTask }: {
  tasks: BoardTask[]
  parents: BoardParent[]
  epics: BoardEpic[]
  columns: BoardColumn[]
  subView: SubView
  onOpenTask: (id: string) => void
}) {
  const parentsMap = new Map(parents.map((p) => [p.id, p]))
  const colorOfColumn = (sprintStatus: string | null) => {
    const col = columns.find((c) => c.id === sprintStatus)
    return (col && STATUS_SWATCH[col.color]) || 'bg-border'
  }
  const dated = (t: BoardTask): t is BoardTask & { startDate: string; dueDate: string } => !!t.startDate && !!t.dueDate

  const rows: TimelineRow[] = []
  if (subView === 'task') {
    const { groups, singles } = groupColumnTasks(tasks)
    groups.forEach(({ parentId, items }, i) => {
      const withDates = items.filter(dated)
      if (withDates.length === 0) return
      const start = withDates.map((t) => t.startDate).sort()[0]!
      const end = withDates.map((t) => t.dueDate).sort().at(-1)!
      const parent = parentsMap.get(parentId)
      rows.push({ key: parentId, label: parent?.title ?? 'Task', code: parent?.code ?? null, start, end, colorClass: TIMELINE_COLORS[i % TIMELINE_COLORS.length]!, onClick: () => onOpenTask(parentId), epicId: items[0]?.epicId ?? null })
    })
    singles.filter(dated).forEach((t) => {
      rows.push({ key: t.id, label: t.title, code: t.code, start: t.startDate, end: t.dueDate, colorClass: colorOfColumn(t.sprintStatus), onClick: () => onOpenTask(t.id), epicId: t.epicId })
    })
  } else if (subView === 'mixed') {
    const { groups, singles } = groupColumnTasks(tasks)
    groups.forEach(({ parentId, items }) => {
      const withDates = items.filter(dated)
      if (withDates.length === 0) return
      const parent = parentsMap.get(parentId)
      const epicId = items[0]?.epicId ?? null
      rows.push({ key: `head-${parentId}`, label: parent?.title ?? 'Task', code: parent?.code ?? null, start: '', end: '', colorClass: '', epicId })
      withDates.forEach((t) => {
        rows.push({ key: t.id, label: t.title, code: t.code, start: t.startDate, end: t.dueDate, colorClass: colorOfColumn(t.sprintStatus), onClick: () => onOpenTask(t.id), indent: true, epicId })
      })
    })
    singles.filter(dated).forEach((t) => {
      rows.push({ key: t.id, label: t.title, code: t.code, start: t.startDate, end: t.dueDate, colorClass: colorOfColumn(t.sprintStatus), onClick: () => onOpenTask(t.id), epicId: t.epicId })
    })
  } else {
    tasks.filter(dated).forEach((t) => {
      rows.push({ key: t.id, label: t.title, code: t.code, start: t.startDate, end: t.dueDate, colorClass: colorOfColumn(t.sprintStatus), onClick: () => onOpenTask(t.id), epicId: t.epicId })
    })
  }

  const barRows = rows.filter((r) => r.start && r.end)
  if (barRows.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-xs p-6 text-center text-sm text-muted mb-4">
        ยังไม่มีงานที่กำหนดวันเริ่ม/วันครบกำหนด — ใส่วันที่ในหน้ารายละเอียดงานก่อนถึงจะเห็น Timeline
      </div>
    )
  }
  const min = barRows.map((r) => r.start).sort()[0]!
  const max = barRows.map((r) => r.end).sort().at(-1)!
  const t0 = Date.parse(`${min}T00:00:00+07:00`)
  const t1 = Math.max(Date.parse(`${max}T00:00:00+07:00`), t0 + 86_400_000)
  const pos = (d: string) => ((Date.parse(`${d}T00:00:00+07:00`) - t0) / (t1 - t0)) * 100
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)
  const todayP = pos(today)

  const renderRow = (r: TimelineRow) =>
    !r.start ? (
      <div key={r.key} className="flex items-center py-1 pt-3 first:pt-1">
        <div className="text-[11px] font-medium text-muted flex items-center gap-1">
          {r.code && <span className="font-mono">{r.code}</span>}
          <span className="truncate">{r.label}</span>
        </div>
      </div>
    ) : (
      <div key={r.key} className={`flex items-center py-1 ${r.indent ? 'pl-3' : ''}`}>
        <button onClick={r.onClick} className="w-44 shrink-0 text-sm pr-3 truncate text-left hover:underline">
          {r.code && <span className="text-[11px] font-mono text-muted mr-1">{r.code}</span>}
          <span className="font-medium text-body">{r.label}</span>
        </button>
        <div className="relative flex-1 h-7 bg-hover rounded-md">
          {todayP >= 0 && todayP <= 100 && (
            <div className="absolute top-0 bottom-0 w-px bg-danger-400 z-10" style={{ left: `${todayP}%` }} />
          )}
          <div
            onClick={r.onClick}
            className={`group absolute inset-y-1 rounded-md cursor-pointer ${r.colorClass}`}
            style={{ left: `${pos(r.start)}%`, width: `${Math.max(2, pos(r.end) - pos(r.start))}%` }}
          >
            <div className="absolute left-1 bottom-full mb-1 whitespace-nowrap bg-ink text-white text-[11px] rounded-lg px-2 py-1 opacity-0 group-hover:opacity-100 pointer-events-none transition shadow-lg z-30">
              {fmtThaiDate(r.start)} – {fmtThaiDate(r.end, true)}
            </div>
          </div>
        </div>
      </div>
    )

  // Tasknista §Epic Layer — จัดแถวเป็น swimlane ต่อ Epic (แถวที่ไม่มี Epic เรียงแบบเดิมไม่มีแถบครอบ) รักษาลำดับการเจอ Epic ครั้งแรก
  const epicMap = new Map(epics.map((e) => [e.id, e]))
  const swimlaneOrder: (string | null)[] = []
  const rowsByLane = new Map<string | null, TimelineRow[]>()
  for (const r of rows) {
    const key = r.epicId ?? null
    if (!rowsByLane.has(key)) { rowsByLane.set(key, []); swimlaneOrder.push(key) }
    rowsByLane.get(key)!.push(r)
  }

  return (
    <div className="bg-white rounded-lg shadow-xs p-4 mb-4">
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-sm font-semibold text-body">ไทม์ไลน์ Sprint</span>
        <span className="text-[11px] text-muted">
          {subView === 'task' ? 'ช่วง = subtask เริ่มเร็วสุด → จบช้าสุด ของแต่ละ Task' : 'สีแท่ง = คอลัมน์ปัจจุบันใน Kanban'}
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[760px] space-y-2">
          {swimlaneOrder.map((key) => {
            const laneRows = rowsByLane.get(key)!
            if (key === null) return <div key="no-epic">{laneRows.map(renderRow)}</div>
            const epic = epicMap.get(key)
            return (
              <div key={key} className="bg-teal-50/60 rounded-md px-2 py-1.5">
                <div className="text-[11px] font-semibold text-teal-700 mb-0.5 flex items-center gap-1.5">
                  <span>Epic · {epic?.title ?? 'ไม่ทราบชื่อ'}</span>
                  {epic?.code && <span className="font-normal text-teal-600">{epic.code}</span>}
                </div>
                {laneRows.map(renderRow)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Tasknista §Sprint & Board — Board ของโปรเจกต์นี้ (คนละอันกับโปรเจกต์อื่น) = กระดานของ sprint ที่เปิดอยู่ตอนนี้ — ลากการ์ดข้ามคอลัมน์ preset ที่เลือกไว้ตอนสร้าง sprint */
export function BoardPage() {
  const { id: projectId, sprintId } = useParams<{ id: string; sprintId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data, reload } = useLoad<BoardData>(() => api.get(`/api/sprints/${sprintId}/board`), [sprintId])
  const [dragId, setDragId] = useState<string | null>(null)
  const openTask = (id: string) => navigate(`/tasks/${id}`)
  const [tab, setTab] = useState<'kanban' | 'timeline'>('kanban')
  const [subView, setSubView] = useState<SubView>('sub')
  const [busy, setBusy] = useState(false)

  const sprint = data?.sprint
  const preset = data?.preset
  const tasks = data?.tasks ?? []
  const parentsMap = new Map((data?.parents ?? []).map((p) => [p.id, p]))
  const columns = preset ? [...preset.columns].sort((a, b) => a.sortOrder - b.sortOrder) : []
  const canEdit = user?.role !== 'vendor'

  const changeStatus = async (taskId: string, sprintStatus: string) => {
    await api.patch(`/api/tasks/${taskId}`, { sprintStatus })
    await reload()
  }
  const removeFromSprint = async (taskId: string, code: string | null) => {
    if (!sprint) return
    // Tasknista §Sprint & Board fix — หน้านี้ไม่มี Backlog ให้ดู (คนละหน้ากับโปรเจกต์) แจ้งเตือนชัดๆ ว่างานกลับ Backlog แล้ว กันสับสนว่างานหายไปเลย
    const removed = await api.delete<{ originDocType: string | null; srsDocId: string | null }>(`/api/sprints/${sprint.id}/tasks/${taskId}`)
    const tabLabel = removed.originDocType ?? (removed.srsDocId ? 'SRS' : 'ทั่วไป')
    await reload()
    alert(`เอา ${code ?? 'งาน'} ออกจาก Sprint แล้ว — กลับไปที่แท็บ "${tabLabel}" ใน Backlog หน้าโปรเจกต์เพื่อดู`)
  }
  // Tasknista §Sprint & Board แก้ไข flow — ปิด Sprint ได้จากหน้า Detail Board โดยตรง (ไม่ต้องย้อนกลับไปหน้าโปรเจกต์)
  const completeSprint = async () => {
    if (!sprint) return
    if (!confirm('ปิด Sprint นี้เลยไหม? งานที่ยังไม่ Done จะเด้งกลับ Backlog')) return
    setBusy(true)
    try {
      await api.post(`/api/sprints/${sprint.id}/complete`)
      navigate(`/projects/${projectId}`)
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
          <Link to={`/projects/${projectId}`} className="text-brand-600 hover:underline">← กลับไปหน้า Sprint ของโปรเจกต์</Link>
        </div>
      </div>
    )

  const over = (e: DragEvent) => e.preventDefault()

  // Tasknista §Sprint & Board fix — การ์ด task/subtask เดี่ยว ใช้ร่วมกันทั้ง Sub-task View (แบนราบ) และ Mixed View (จัดกลุ่มใต้ parent)
  const renderCard = (t: BoardTask) => (
    <div
      key={t.id}
      draggable={canEdit}
      onDragStart={() => setDragId(t.id)}
      onClick={() => openTask(t.id)}
      className="group bg-white rounded-lg shadow-xs p-3 cursor-pointer hover:shadow-sm"
    >
      <div className="flex items-start gap-1.5">
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
        {t.srsRefCode && t.srsDocId && (
          <a
            href={`/api/docs/${t.srsDocId}/raw`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="เปิดเอกสาร SRS ต้นทาง"
            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-info-50 text-info-700 hover:bg-info-100"
          >
            📄 {t.srsRefCode}
          </a>
        )}
        {t.assigneeName && (
          <Avatar name={t.assigneeName} avatarUrl={t.assigneeAvatarUrl} className="w-5 h-5 text-[9px] ml-auto" colorClass={avatarColor(t.assigneeName)} />
        )}
      </div>
    </div>
  )

  return (
    <div className="p-3 sm:p-6">
      <Link to={`/projects/${projectId}`} className="text-sm text-muted hover:text-soft flex items-center gap-1 mb-4">
        <ChevronLeft className="w-4 h-4" /> กลับไปหน้าโปรเจกต์
      </Link>

      <div className="bg-white rounded-lg shadow-xs p-4 mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-ink">{sprint.name || 'Sprint'}</h2>
        <span className="text-xs text-muted">{fmtThaiDate(sprint.startDate)} – {fmtThaiDate(sprint.endDate, true)}</span>
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

      <div className="flex bg-divider rounded-lg p-0.5 text-sm font-medium w-fit mb-4">
        {([['kanban', 'Kanban'], ['timeline', 'Timeline']] as const).map(([v, lbl]) => (
          <button key={v} onClick={() => setTab(v)} className={`px-3 py-1.5 rounded-md ${tab === v ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>{lbl}</button>
        ))}
      </div>

      <div className="flex bg-divider rounded-lg p-0.5 text-xs font-medium w-fit mb-3">
        {SUB_VIEW_OPTIONS.map(([v, lbl]) => (
          <button key={v} onClick={() => setSubView(v)} className={`px-2.5 py-1 rounded-md ${subView === v ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>{lbl}</button>
        ))}
      </div>

      {tab === 'timeline' && (
        <SprintTimeline tasks={tasks} parents={data?.parents ?? []} epics={data?.epics ?? []} columns={columns} subView={subView} onOpenTask={openTask} />
      )}

      {tab === 'kanban' && (
        <>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {columns.map((col) => {
              const colTasks = tasks.filter((t) => t.sprintStatus === col.id)
              const { groups, singles } = groupColumnTasks(colTasks)
              return (
                <div key={col.id} onDragOver={over} onDrop={() => { if (dragId) void changeStatus(dragId, col.id); setDragId(null) }} className="bg-hover/60 rounded-lg p-2 min-h-32 w-64 shrink-0">
                  <div className="flex items-center gap-1.5 px-1.5 py-1 mb-1.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusChip(col.color)}`}>{col.name}</span>
                    <span className="text-xs text-muted">{colTasks.length}</span>
                  </div>
                  <div className="space-y-2">
                    {subView === 'sub' && colTasks.map((t) => renderCard(t))}

                    {subView === 'mixed' && (
                      <>
                        {groups.map(({ parentId, items }) => {
                          const parent = parentsMap.get(parentId)
                          return (
                            <div key={parentId} className="space-y-1.5">
                              <div className="text-[10px] font-medium text-muted px-1 flex items-center gap-1 truncate">
                                {parent?.code && <span className="font-mono shrink-0">{parent.code}</span>}
                                <span className="truncate">{parent?.title ?? 'Task'}</span>
                              </div>
                              {items.map((t) => renderCard(t))}
                            </div>
                          )
                        })}
                        {singles.map((t) => renderCard(t))}
                      </>
                    )}

                    {subView === 'task' && (
                      <>
                        {groups.map(({ parentId, items }) => {
                          const parent = parentsMap.get(parentId)
                          return (
                            <div
                              key={parentId}
                              onClick={() => openTask(parentId)}
                              className="bg-white rounded-lg shadow-xs p-3 cursor-pointer hover:shadow-sm"
                            >
                              <div className="flex items-start gap-1.5">
                                {parent?.code && <span className="text-[11px] font-mono text-muted shrink-0">{parent.code}</span>}
                                <span className="text-sm text-body flex-1">{parent?.title ?? 'Task'}</span>
                              </div>
                              <div className="text-[11px] text-muted mt-1.5">{items.length} งานย่อยอยู่คอลัมน์นี้</div>
                            </div>
                          )
                        })}
                        {singles.map((t) => renderCard(t))}
                      </>
                    )}

                    {colTasks.length === 0 && <div className="text-center text-[11px] text-border py-3">ไม่มีงาน</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

    </div>
  )
}
