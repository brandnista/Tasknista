import {
  CheckCircle2,
  ClipboardList,
  Copy,
  LayoutGrid,
  Rows3,
  Search,
  X,
  Zap,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { MyWorkSummary, taskTypeLabel } from '../components/MyWorkSummary'
import { PageHeader } from '../components/PageHeader'
import { StatusKanban, type KanbanTask } from '../components/StatusKanban'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { checklistLabel, dueUrgency, URGENCY_CARD_CLASS } from '../lib/due-urgency'
import { useNotifications } from '../lib/notifications-context'
import { TASK_STATUS_DOT, TASK_STATUS_LABEL } from '../lib/task-status'
import { useLoad } from '../lib/useLoad'

interface MyTask extends KanbanTask {
  projectId: string
  projectName: string
  myRole: 'owner' | 'editor' | 'viewer'
  // Pronista §SOW Task/Subtask — ใช้กรอง "งานย่อยที่รอทำ" ใน widget My Work ใหม่
  parentId: string | null
  // Pronista §Task lifecycle accept step — ใช้เช็คว่างานนี้จ่ายมาแล้วแต่ฉันยังไม่กดรับ (status ยังเป็น non_start)
  dispatchedAt: string | number | null
  // Pronista §My Work UX — ใช้คำนวณ "เสร็จวันนี้"/"ส่งตรวจวันนี้" + ตัวกรอง Sprint/Backlog
  completedAt: string | number | null
  submittedAt: string | number | null
  sprintId: string | null
}
const PRIORITY_ORDER: Record<MyTask['priority'], number> = { high: 0, normal: 1, low: 2 }
const bkkToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)
// Pronista §My Work UX — completedAt/submittedAt มาจาก API เป็น ISO string (Date ถูก serialize ผ่าน JSON) ต้อง +7h ก่อนตัดเป็นวันที่ไทย
const bkkDay = (x: string | number) => new Date(new Date(x).getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00+07:00`) - Date.parse(`${a}T00:00:00+07:00`)) / 86_400_000)

/** Pronista §My Work/Notification — งานย่อยของฉันที่ยังไม่เสร็จ เรียง priority แล้ว deadline พร้อมปุ่มติ๊กเสร็จตรงๆ */
function PendingSubtasksWidget({ tasks, onOpenTask, onComplete }: { tasks: MyTask[]; onOpenTask: (id: string) => void; onComplete: (id: string) => void }) {
  const pending = tasks
    .filter((t) => t.parentId && t.status !== 'done')
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
  if (pending.length === 0) return null
  return (
    <div className="bg-white rounded-lg shadow-xs p-4 mb-5">
      <div className="text-sm font-semibold text-body mb-2">งานย่อยที่รอทำ</div>
      <div className="divide-y divide-divider">
        {pending.map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-2.5">
            <button
              onClick={(e) => { e.stopPropagation(); onComplete(t.id) }}
              title="เสร็จแล้ว"
              className="shrink-0 w-6 h-6 rounded-full border border-border grid place-items-center text-[10px] text-dim hover:border-brand-500 hover:text-brand-600 hover:bg-brand-50"
            >
              ✓
            </button>
            <button onClick={() => onOpenTask(t.id)} className="min-w-0 flex-1 text-left">
              <div className="text-sm text-body truncate">{t.title}</div>
              <div className="text-[11px] text-muted">{t.projectName}</div>
            </button>
            {t.priority === 'high' && <span className="text-[10px] text-danger-600 bg-danger-50 px-1.5 py-0.5 rounded shrink-0">สูง</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Pronista §Task lifecycle accept step — งานที่จ่ายมาแล้วแต่ฉันยังไม่กดรับ (status ยังเป็น non_start) กดรับได้ตรงจากหน้านี้ ไม่ต้องเข้า Task Detail ก่อน */
function NewlyDispatchedWidget({ tasks, onOpenTask, onAccept }: { tasks: MyTask[]; onOpenTask: (id: string) => void; onAccept: (id: string) => void }) {
  const pending = tasks.filter((t) => t.dispatchedAt && t.status === 'non_start')
  if (pending.length === 0) return null
  return (
    <div className="bg-info-50 border border-info-100 rounded-lg shadow-xs p-4 mb-5">
      <div className="text-sm font-semibold text-body mb-2">งานใหม่ที่รอคุณกดรับ</div>
      <div className="divide-y divide-divider">
        {pending.map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-2.5">
            <button onClick={() => onOpenTask(t.id)} className="min-w-0 flex-1 text-left">
              <div className="text-sm text-body truncate">{t.title}</div>
              <div className="text-[11px] text-muted">{t.projectName}</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAccept(t.id) }}
              className="shrink-0 flex items-center gap-1 text-xs bg-success-600 hover:bg-success-700 text-white px-2.5 py-1.5 rounded-lg font-medium"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> รับงาน
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Pronista §My Work UX — แถบสรุปสถิติแบบบรรทัดเดียว แทนการ์ดหลายแถวเดิม (กันเปลืองพื้นที่จอ) */
function StatStrip({ stats }: { stats: { label: string; value: number; tone?: 'danger' | 'success' }[] }) {
  return (
    <div className="flex bg-white rounded-lg shadow-xs border border-border-subtle overflow-x-auto mb-3 divide-x divide-divider">
      {stats.map((s) => (
        <div key={s.label} className="flex-1 min-w-[104px] px-3.5 py-2.5">
          <div className="text-[11px] text-muted whitespace-nowrap">{s.label}</div>
          <div className={`text-lg font-bold leading-tight mt-0.5 ${s.tone === 'danger' ? 'text-danger-600' : s.tone === 'success' ? 'text-success-600' : 'text-ink'}`}>{s.value}</div>
        </div>
      ))}
    </div>
  )
}

/** Pronista §My Work UX — มุมมองตาราง (List View) ทางเลือกของ Board ใช้ตอนมี subtask เยอะ scan ทีละบรรทัดง่ายกว่า */
function TaskListView({ tasks, onOpenTask, soonDays }: { tasks: MyTask[]; onOpenTask: (id: string) => void; soonDays?: number }) {
  if (tasks.length === 0) return <div className="bg-white rounded-lg shadow-xs text-center text-sm text-muted py-10">ไม่พบงานตามตัวกรองนี้</div>
  return (
    <div className="bg-white rounded-lg shadow-xs overflow-hidden">
      {/* Pronista §Mobile responsive — ตารางคงเดิมบน sm+ ขึ้นไป, มือถือใช้การ์ดแทน (ตารางคอลัมน์ตายตัวบีบอ่านยากบนจอแคบ) */}
      <table className="hidden sm:table w-full text-sm" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '16%' }} />
          <col style={{ width: '38%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '14%' }} />
        </colgroup>
        <thead>
          <tr className="bg-hover text-[11px] text-muted uppercase tracking-wide">
            <th className="text-left font-semibold px-3 py-2">รหัส</th>
            <th className="text-left font-semibold px-3 py-2">ชื่องาน</th>
            <th className="text-left font-semibold px-3 py-2">โปรเจกต์</th>
            <th className="text-left font-semibold px-3 py-2">ประเภท</th>
            <th className="text-left font-semibold px-3 py-2">สถานะ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {tasks.map((t) => (
            <tr
              key={t.id}
              onClick={() => onOpenTask(t.id)}
              className={`cursor-pointer ${URGENCY_CARD_CLASS[dueUrgency(t.dueDate, t.status === 'done', soonDays)]}`}
            >
              <td className="px-3 py-2.5 text-[11px] font-mono text-muted truncate">{t.code ?? '—'}</td>
              <td className="px-3 py-2.5 text-body truncate">
                <span className="truncate">{t.title}</span>
                {checklistLabel(t.checklistDone, t.checklistTotal) && (
                  <span className="ml-2 text-[11px] text-dim">{checklistLabel(t.checklistDone, t.checklistTotal)}</span>
                )}
              </td>
              <td className="px-3 py-2.5 text-muted truncate">{t.projectName}</td>
              <td className="px-3 py-2.5 text-muted truncate">{taskTypeLabel(t)}</td>
              <td className="px-3 py-2.5">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${TASK_STATUS_DOT[t.status]}`} />
                  {TASK_STATUS_LABEL[t.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sm:hidden divide-y divide-divider">
        {tasks.map((t) => (
          <button
            key={t.id}
            onClick={() => onOpenTask(t.id)}
            className={`w-full text-left px-4 py-3 ${URGENCY_CARD_CLASS[dueUrgency(t.dueDate, t.status === 'done', soonDays)]}`}
          >
            <div className="flex items-center gap-2">
              {t.code && <span className="text-[11px] font-mono text-muted shrink-0">{t.code}</span>}
              <span className="text-sm text-body truncate">{t.title}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[11px] text-muted">
              <span className="truncate">{t.projectName}</span>
              <span>·</span>
              <span className="truncate">{taskTypeLabel(t)}</span>
              {checklistLabel(t.checklistDone, t.checklistTotal) && <span className="text-dim">{checklistLabel(t.checklistDone, t.checklistTotal)}</span>}
              <span className="inline-flex items-center gap-1 ml-auto shrink-0">
                <span className={`w-1.5 h-1.5 rounded-full ${TASK_STATUS_DOT[t.status]}`} />
                {TASK_STATUS_LABEL[t.status]}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Pronista §My Work UX — Daily Accomplishment: สรุปผลงานประจำวัน + คัดลอกเป็นข้อความ Markdown ส่งกลุ่มแชท */
function DailySummaryModal({ open, onClose, userName, completedToday, inProgress, blockers }: {
  open: boolean
  onClose: () => void
  userName: string
  completedToday: MyTask[]
  inProgress: MyTask[]
  blockers: MyTask[]
}) {
  const [copied, setCopied] = useState(false)
  if (!open) return null
  const today = bkkToday()
  const dateLabel = `${today.slice(8, 10)}/${today.slice(5, 7)}/${today.slice(0, 4)}`
  const copy = () => {
    const lines = [`📌 สรุปผลงานประจำวัน (${dateLabel}) - ${userName}`]
    if (completedToday.length > 0) {
      lines.push('✅ เสร็จแล้ว/ส่งตรวจ:')
      completedToday.forEach((t) => lines.push(`- [${t.code ?? t.id}] ${t.title}`))
    }
    if (inProgress.length > 0) {
      lines.push('⏳ กำลังทำ:')
      inProgress.forEach((t) => lines.push(`- [${t.code ?? t.id}] ${t.title}`))
    }
    if (blockers.length > 0) {
      lines.push('🔴 ติดขัด:')
      blockers.forEach((t) => lines.push(`- [${t.code ?? t.id}] ${t.title}`))
    }
    void navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  const Section = ({ title, dot, items }: { title: string; dot: string; items: MyTask[] }) => (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-body mb-2">
        <span className={`w-2 h-2 rounded-full ${dot}`} /> {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-muted pl-3.5">ไม่มี</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map((t) => (
            <div key={t.id} className="text-sm bg-hover rounded-md px-2.5 py-1.5">
              {t.code && <span className="block text-[10px] font-mono text-muted">{t.code}</span>}
              {t.title}
            </div>
          ))}
        </div>
      )}
    </div>
  )
  return (
    <div className="fixed inset-0 bg-ink/40 z-50 flex items-start justify-center p-4 sm:pt-[8vh]" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-divider">
          <h2 className="text-base font-semibold text-ink">สรุปผลงานประจำวัน — {dateLabel}</h2>
          <button onClick={onClose} className="text-dim hover:text-body p-1" aria-label="ปิด"><X className="w-4.5 h-4.5" /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">
          <Section title="งานที่ทำเสร็จแล้ววันนี้" dot="bg-success-500" items={completedToday} />
          <Section title="งานที่กำลังดำเนินการ" dot="bg-warning-400" items={inProgress} />
          <Section title="ปัญหา/สิ่งติดขัด" dot="bg-danger-500" items={blockers} />
        </div>
        <div className="flex items-center gap-2 px-5 py-3.5 border-t border-divider">
          {copied && <span className="text-xs text-success-600 mr-auto">คัดลอกแล้ว</span>}
          <button onClick={onClose} className="ml-auto text-sm px-3 py-1.5 rounded-lg border border-border text-body hover:bg-hover">ปิด</button>
          <button onClick={copy} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium">
            <Copy className="w-3.5 h-3.5" /> คัดลอกสรุปงาน
          </button>
        </div>
      </div>
    </div>
  )
}

/** เมนู "งานของฉัน" — มองจากมุมคน (รวมงานที่ฉันรับผิดชอบข้ามทุกโปรเจกต์) ต่างจากเมนู โปรเจกต์ ที่มองทีละโปรเจกต์ */
export function MyTasksPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const openTask = (id: string) => navigate(`/tasks/${id}`)
  const { data, reload } = useLoad<MyTask[]>(() => api.get('/api/tasks/mine'))
  // Pronista §Card glance-at-a-glance — จำนวนวันก่อนถึงกำหนดส่งที่เริ่มเตือนสีเหลือง (ตั้งค่าทั่วไป)
  const { data: cfg } = useLoad<{ dueSoonDays: number }>(() => api.get('/api/config'))
  // Pronista §Notification overhaul (2026-08-27) — ย้ายมาอ่านจาก NotificationsProvider กลาง (แท็บ "แจ้งเตือน" ในหน้านี้ถูกถอดออกแล้ว เพราะมีกระดิ่งที่ Navbar เป็นจุดเข้าถึงหลักแทน)
  const { rows: notifRows } = useNotifications()
  const tasks = data ?? []
  const notifications = notifRows ?? []

  // Pronista §My Work UX — ตัวกรอง/มุมมองใหม่ (ค้นหา, โปรเจกต์, Sprint/Priority, ช่วงเวลา, เสร็จ/ส่งตรวจวันนี้, Board/List)
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')
  const [spFilter, setSpFilter] = useState<'all' | 'sprint' | 'backlog' | 'high'>('all')
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'overdue'>('all')
  const [todayOnly, setTodayOnly] = useState(false)
  const [view, setView] = useState<'board' | 'list'>('board')
  const [summaryOpen, setSummaryOpen] = useState(false)

  const changeStatus = async (taskId: string, status: KanbanTask['status']) => {
    await api.patch(`/api/tasks/${taskId}`, { status })
    await reload()
  }
  const acceptTask = async (taskId: string) => {
    await api.post(`/api/tasks/${taskId}/accept`, {})
    await reload()
  }
  const today = bkkToday()
  const isDoneToday = (t: MyTask) => t.status === 'done' && !!t.completedAt && bkkDay(t.completedAt) === today
  const isSubmittedToday = (t: MyTask) => !!t.submittedAt && bkkDay(t.submittedAt) === today
  const isOverdue = (t: MyTask) => !!t.dueDate && t.dueDate < today && t.status !== 'done'

  // Pronista §My Work/Notification — 2 stat เพิ่มเติมตามสเปก (คำนวณฝั่ง client จากข้อมูลที่โหลดอยู่แล้ว ไม่ต้องเพิ่ม endpoint)
  const assignedProjectsCount = new Set(tasks.map((t) => t.projectId)).size
  // Pronista §Task lifecycle notifications — งานที่ถูกตีกลับล่าสุด (แจ้งเตือนยังไม่อ่าน) โชว์ป้าย "ตีกลับ" ในบอร์ด
  const bouncedTaskIds = new Set(notifications.filter((n) => n.type === 'task_bounced' && !n.isRead && n.taskId).map((n) => n.taskId!))

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>()
    tasks.forEach((t) => seen.set(t.projectId, t.projectName))
    return Array.from(seen.entries())
  }, [tasks])

  const stats = useMemo(() => [
    { label: 'โปรเจกต์', value: assignedProjectsCount },
    { label: 'งานทั้งหมด', value: tasks.length },
    { label: 'กำลังทำ', value: tasks.filter((t) => t.status === 'on_processing').length },
    { label: 'รอรีวิว', value: tasks.filter((t) => t.status === 'waiting_for_test').length },
    { label: 'เสร็จวันนี้', value: tasks.filter(isDoneToday).length, tone: 'success' as const },
    { label: 'เลยกำหนด', value: tasks.filter(isOverdue).length, tone: 'danger' as const },
  ], [tasks, today])

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter((t) => {
      if (q && !(t.title.toLowerCase().includes(q) || (t.code ?? '').toLowerCase().includes(q))) return false
      if (projectFilter !== 'all' && t.projectId !== projectFilter) return false
      if (spFilter === 'sprint' && !t.sprintId) return false
      if (spFilter === 'backlog' && t.sprintId) return false
      if (spFilter === 'high' && t.priority !== 'high') return false
      if (dateFilter === 'today' && t.dueDate !== today) return false
      if (dateFilter === 'week' && (!t.dueDate || daysBetween(today, t.dueDate) < 0 || daysBetween(today, t.dueDate) > 6)) return false
      if (dateFilter === 'overdue' && !isOverdue(t)) return false
      if (todayOnly && !(isDoneToday(t) || isSubmittedToday(t))) return false
      return true
    })
  }, [tasks, search, projectFilter, spFilter, dateFilter, todayOnly, today])

  // Pronista §My Work UX — Daily Accomplishment: 3 กลุ่มสำหรับ "สรุปผลงานประจำวัน" (คำนวณจากงานทั้งหมด ไม่ผูกกับตัวกรองบนจอ)
  const completedTodayList = tasks.filter((t) => isDoneToday(t) || isSubmittedToday(t))
  const inProgressList = tasks.filter((t) => t.status === 'on_processing')
  const blockersList = tasks.filter((t) => isOverdue(t) || (t.kind === 'defect' && t.status !== 'done'))

  return (
    <>
      <PageHeader title="งานของฉัน" />
      <div className="p-3 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="text-sm text-muted">สวัสดี {user?.name} — นี่คือสรุปงานที่คุณรับผิดชอบ</p>
        <button
          onClick={() => setSummaryOpen(true)}
          className="shrink-0 flex items-center gap-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white px-3 py-2 rounded-lg"
        >
          <ClipboardList className="w-3.5 h-3.5" /> สรุปผลงานประจำวัน
        </button>
      </div>

      <StatStrip stats={stats} />

          <div className="sticky top-0 z-10 -mx-3 sm:-mx-6 px-3 sm:px-6 py-2.5 mb-3 border-b border-divider grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center" style={{ background: 'var(--page)' }}>
            <div className="flex items-center gap-1.5 bg-white border border-border rounded-lg px-2.5 h-9 col-span-2 sm:flex-1 sm:min-w-[180px]">
              <Search className="w-3.5 h-3.5 text-dim shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหา Task, Subtask หรือรหัสอ้างอิง"
                className="text-sm w-full outline-hidden bg-transparent placeholder:text-muted"
              />
            </div>
            <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="h-9 text-sm border border-border rounded-lg px-2.5 bg-white w-full sm:w-auto">
              <option value="all">โปรเจกต์: ทั้งหมด</option>
              {projectOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select value={spFilter} onChange={(e) => setSpFilter(e.target.value as typeof spFilter)} className="h-9 text-sm border border-border rounded-lg px-2.5 bg-white w-full sm:w-auto">
              <option value="all">Sprint/Priority: ทั้งหมด</option>
              <option value="sprint">อยู่ใน Sprint</option>
              <option value="backlog">Backlog</option>
              <option value="high">Priority สูง</option>
            </select>
            <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)} className="h-9 text-sm border border-border rounded-lg px-2.5 bg-white w-full sm:w-auto">
              <option value="all">ช่วงเวลา: ทั้งหมด</option>
              <option value="today">วันนี้</option>
              <option value="week">สัปดาห์นี้</option>
              <option value="overdue">เลยกำหนด</option>
            </select>
            <button
              onClick={() => setTodayOnly((v) => !v)}
              className={`h-9 flex items-center justify-center gap-1.5 text-xs font-medium px-3 rounded-lg border w-full sm:w-auto ${todayOnly ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-border text-dim'}`}
            >
              <Zap className="w-3.5 h-3.5" /> เสร็จ/ส่งตรวจวันนี้
            </button>
            <div className="hidden sm:flex ml-auto border border-border rounded-lg overflow-hidden h-9">
              <button onClick={() => setView('board')} className={`flex items-center gap-1.5 text-xs font-medium px-3 h-full ${view === 'board' ? 'bg-brand-600 text-white' : 'bg-white text-dim'}`}>
                <LayoutGrid className="w-3.5 h-3.5" /> Board
              </button>
              <button onClick={() => setView('list')} className={`flex items-center gap-1.5 text-xs font-medium px-3 h-full border-l border-border ${view === 'list' ? 'bg-brand-600 text-white' : 'bg-white text-dim'}`}>
                <Rows3 className="w-3.5 h-3.5" /> List
              </button>
            </div>
          </div>

          <NewlyDispatchedWidget tasks={tasks} onOpenTask={openTask} onAccept={(id) => void acceptTask(id)} />

          <PendingSubtasksWidget tasks={tasks} onOpenTask={openTask} onComplete={(id) => void changeStatus(id, 'done')} />

          <MyWorkSummary tasks={tasks} onOpenTask={(t) => openTask(t.id)} hideStats />

          {/* Pronista §Mobile responsive — ลาก drag-and-drop ใช้กับสัมผัสไม่ได้ บนมือถือบังคับเห็น List เสมอไม่ว่า view state จะเป็นอะไร */}
          <div className="sm:hidden">
            <TaskListView tasks={filteredTasks} onOpenTask={openTask} soonDays={cfg?.dueSoonDays} />
          </div>
          <div className="hidden sm:block">
            {view === 'board' ? (
              <StatusKanban
                tasks={filteredTasks}
                canEdit={(t) => (t as MyTask).myRole === 'owner' || (t as MyTask).myRole === 'editor'}
                onOpenTask={openTask}
                onStatusChange={changeStatus}
                bouncedTaskIds={bouncedTaskIds}
                soonDays={cfg?.dueSoonDays}
                meId={user?.id}
              />
            ) : (
              <TaskListView tasks={filteredTasks} onOpenTask={openTask} soonDays={cfg?.dueSoonDays} />
            )}
          </div>
      <DailySummaryModal
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        userName={user?.name ?? ''}
        completedToday={completedTodayList}
        inProgress={inProgressList}
        blockers={blockersList}
      />
      </div>
    </>
  )
}
