/* Hallmark · pre-emit critique: P4 H4 E4 S4 R4 V4 */
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ClipboardCheck,
  ClipboardList,
  Copy,
  Inbox,
  LayoutGrid,
  Plus,
  Rows3,
  Search,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Avatar } from '../components/Avatar'
import { useDialog } from '../components/Dialog'
import { MyWorkSummary } from '../components/MyWorkSummary'
import { PageHeader } from '../components/PageHeader'
import { QuickAddModal, TASK_CREATED_EVENT } from '../components/QuickAdd'
import { StatusKanban, type KanbanTask } from '../components/StatusKanban'
import { TaskListView } from '../components/TaskListView'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useNotifications } from '../lib/notifications-context'
import { isInactiveStatus, KANBAN_TASK_STATUS_ORDER, TASK_STATUS_LABEL, TASK_STATUS_ORDER, type TaskStatus } from '../lib/task-status'
import { useLoad } from '../lib/useLoad'

interface MyTask extends KanbanTask {
  // (2026-09-16 fix) — งานที่คีย์ตรงใน Workspace (ไม่ผูกโปรเจกต์) มี projectId เป็น null ได้จริง — GET /tasks/mine เปลี่ยนจาก innerJoin เป็น leftJoin แล้ว (เดิมหายไปจากลิสต์นี้ทั้งหมด)
  projectId: string | null
  projectName: string | null
  myRole: 'owner' | 'editor' | 'viewer'
  // Pronista §SOW Task/Subtask — ใช้กรอง "งานย่อยที่รอทำ" ใน widget My Work ใหม่
  parentId: string | null
  // Pronista §Task lifecycle accept step — ใช้เช็คว่างานนี้จ่ายมาแล้วแต่ฉันยังไม่กดรับ (status ยังเป็น non_start)
  dispatchedAt: string | number | null
  // Pronista §My Work UX — ใช้คำนวณ "เสร็จวันนี้"/"ส่งตรวจวันนี้" + ตัวกรอง Sprint/Backlog
  completedAt: string | number | null
  submittedAt: string | number | null
  sprintId: string | null
  // Pronista §My Tasks — งานใหม่ที่รอกดรับ (2026-09-18) — ใครเป็นคนกดจ่ายงานนี้มา (tasks.assignedBy resolve เป็นชื่อ)
  dispatcherName: string | null
}
const bkkToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)
// Pronista §My Work UX — completedAt/submittedAt มาจาก API เป็น ISO string (Date ถูก serialize ผ่าน JSON) ต้อง +7h ก่อนตัดเป็นวันที่ไทย
const bkkDay = (x: string | number) => new Date(new Date(x).getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00+07:00`) - Date.parse(`${a}T00:00:00+07:00`)) / 86_400_000)
// Pronista §My Tasks — วันที่+เวลาแบบไทย (dd/mm/yy HH:mm) ให้แถว "งานใหม่ที่รอกดรับ"
const fmtDateTime = (x: string | number) =>
  new Date(x).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Pronista §My Tasks redesign (2026-09-18) — การ์ดสรุปสถิติแบบไอคอน 5 ใบ แทน StatStrip แบบข้อความล้วนเดิม */
function StatCards({ stats }: { stats: { label: string; value: number; icon: typeof ClipboardList; cls: string; onClick?: () => void }[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
      {stats.map((s) => {
        const Tag = s.onClick ? 'button' : 'div'
        return (
          <Tag key={s.label} onClick={s.onClick} className={`bg-white rounded-lg shadow-xs p-4 flex items-center gap-3 text-left ${s.onClick ? 'hover:shadow-sm cursor-pointer' : ''}`}>
            <div className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${s.cls}`}>
              <s.icon className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <div className="text-xl font-bold text-ink leading-none">{s.value}</div>
              <div className="text-xs text-muted mt-0.5 truncate">{s.label}</div>
            </div>
          </Tag>
        )
      })}
    </div>
  )
}

/** Pronista §Task lifecycle accept step — งานที่จ่ายมาแล้วแต่ฉันยังไม่กดรับ (status ยังเป็น non_start) กดรับได้ตรงจากหน้านี้ ไม่ต้องเข้า Task Detail ก่อน
 * Pronista §My Tasks redesign (2026-09-18) — เปลี่ยนจากตารางเป็นการ์ดรายการ (มือถือ/จอเล็กอ่านง่ายกว่า) + จำกัด 3 รายการแรก มี "ดูทั้งหมด" ขยายดูที่เหลือ */
function NewlyDispatchedWidget({ tasks, onOpenTask, onAccept }: { tasks: MyTask[]; onOpenTask: (id: string) => void; onAccept: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const pending = tasks
    .filter((t) => t.dispatchedAt && t.status === 'non_start')
    .sort((a, b) => new Date(b.dispatchedAt!).getTime() - new Date(a.dispatchedAt!).getTime())
  if (pending.length === 0) return null
  const visible = expanded ? pending : pending.slice(0, 3)
  return (
    <div className="bg-info-50 border border-info-100 rounded-lg shadow-xs p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-body flex items-center gap-1.5"><Inbox className="w-4 h-4 text-info-600" /> งานใหม่ที่รอคุณกดรับ ({pending.length})</div>
        {pending.length > 3 && (
          <button onClick={() => setExpanded((v) => !v)} className="text-xs text-brand-600 hover:text-brand-700 font-medium shrink-0">
            {expanded ? 'แสดงน้อยลง' : 'ดูทั้งหมด →'}
          </button>
        )}
      </div>
      <div className="divide-y divide-info-100">
        {visible.map((t) => (
          <div key={t.id} className="flex items-center gap-3 py-2.5">
            <Avatar name={t.dispatcherName ?? '—'} className="w-8 h-8 text-xs" />
            <button onClick={() => onOpenTask(t.id)} className="min-w-0 flex-1 text-left">
              <div className="text-[10px] font-mono text-muted">{t.code ?? '—'}</div>
              <div className="text-sm text-body truncate">{t.title}</div>
              <div className="text-[11px] text-muted">ได้รับมอบหมายเมื่อ {fmtDateTime(t.dispatchedAt!)}</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onAccept(t.id) }}
              className="shrink-0 inline-flex items-center gap-1 text-xs bg-success-600 hover:bg-success-700 text-white px-2.5 py-1.5 rounded-lg font-medium"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> รับงาน
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

type AttentionTab = 'all' | 'overdue' | 'today' | 'soon'
const ATTENTION_LABEL: Record<AttentionTab, string> = { all: 'ทั้งหมด', overdue: 'เกินกำหนด', today: 'ครบกำหนดวันนี้', soon: 'ใกล้ครบกำหนด' }
const ATTENTION_TONE: Record<AttentionTab, string> = {
  all: 'bg-hover text-dim',
  overdue: 'bg-danger-50 text-danger-700',
  today: 'bg-warning-50 text-warning-700',
  soon: 'bg-info-50 text-info-700',
}

/** Pronista §My Tasks redesign (2026-09-18) — แทนที่ "งานย่อยที่รอทำ" เดิม: รวมงานที่ต้องรีบดู (เกินกำหนด/ครบกำหนดวันนี้/ใกล้ครบกำหนด) เป็น widget เดียว แยกแท็บย่อยกรองได้ */
function AttentionWidget({ tasks, onOpenTask, soonDays = 3 }: { tasks: MyTask[]; onOpenTask: (id: string) => void; soonDays?: number }) {
  const [tab, setTab] = useState<AttentionTab>('all')
  const [expanded, setExpanded] = useState(false)
  const today = bkkToday()
  const soonBy = new Date(Date.now() + 7 * 3_600_000 + soonDays * 86_400_000).toISOString().slice(0, 10)

  const categorized = useMemo(() => {
    return tasks
      .filter((t) => t.dueDate && !isInactiveStatus(t.status))
      .map((t) => {
        const cat: Exclude<AttentionTab, 'all'> = t.dueDate! < today ? 'overdue' : t.dueDate === today ? 'today' : 'soon'
        return { t, cat }
      })
      .filter((x) => x.cat !== 'soon' || x.t.dueDate! <= soonBy)
      .sort((a, b) => a.t.dueDate!.localeCompare(b.t.dueDate!))
  }, [tasks, today, soonBy])

  const counts = {
    all: categorized.length,
    overdue: categorized.filter((x) => x.cat === 'overdue').length,
    today: categorized.filter((x) => x.cat === 'today').length,
    soon: categorized.filter((x) => x.cat === 'soon').length,
  }
  const filtered = tab === 'all' ? categorized : categorized.filter((x) => x.cat === tab)
  const visible = expanded ? filtered : filtered.slice(0, 5)

  return (
    <div className="bg-white rounded-lg shadow-xs p-4 h-full">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-body mb-3">
        <AlertTriangle className="w-4 h-4 text-danger-600" /> งานที่ต้องให้ความสนใจ ({counts.all})
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {(['all', 'overdue', 'today', 'soon'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`text-xs font-medium px-2.5 py-1 rounded-full ${tab === k ? ATTENTION_TONE[k] : 'bg-hover text-dim hover:text-body'}`}
          >
            {ATTENTION_LABEL[k]} {counts[k]}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="text-sm text-muted text-center py-6">ไม่มีงานที่ต้องรีบในหมวดนี้</div>
      ) : (
        <>
          <div className="divide-y divide-divider">
            {visible.map(({ t, cat }) => (
              <button key={t.id} onClick={() => onOpenTask(t.id)} className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-hover -mx-1 px-1 rounded-lg">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-body truncate">{t.title}</div>
                  <div className="text-[11px] text-muted">{t.projectName}</div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${ATTENTION_TONE[cat]}`}>{ATTENTION_LABEL[cat]}</span>
              </button>
            ))}
          </div>
          {filtered.length > 5 && (
            <button onClick={() => setExpanded((v) => !v)} className="w-full text-center text-xs text-brand-600 hover:text-brand-700 font-medium mt-2 py-1.5">
              {expanded ? 'แสดงน้อยลง' : `ดูทั้งหมด (${filtered.length})`}
            </button>
          )}
        </>
      )}
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
  const { alertDialog } = useDialog()
  const openTask = (id: string) => navigate(`/tasks/${id}`)
  const { data, reload } = useLoad<MyTask[]>(() => api.get('/api/tasks/mine'))
  // Pronista §My Tasks redesign (2026-09-18) — การ์ดสรุป "รอตรวจ" ต้องรู้จำนวนจริง ดึงแบบเบาๆ แค่เอาความยาว ไม่ได้ผูก UI อื่นในหน้านี้ (เนื้อหาเต็มอยู่ที่ /my-tasks/review แยกแล้ว)
  const { data: pendingReviewData } = useLoad<{ id: string }[]>(() => api.get('/api/tasks/pending-review'))
  // Pronista §Card glance-at-a-glance — จำนวนวันก่อนถึงกำหนดส่งที่เริ่มเตือนสีเหลือง (ตั้งค่าทั่วไป)
  const { data: cfg } = useLoad<{ dueSoonDays: number }>(() => api.get('/api/config'))
  // Pronista §Notification overhaul (2026-08-27) — ย้ายมาอ่านจาก NotificationsProvider กลาง (แท็บ "แจ้งเตือน" ในหน้านี้ถูกถอดออกแล้ว เพราะมีกระดิ่งที่ Navbar เป็นจุดเข้าถึงหลักแทน)
  const { rows: notifRows } = useNotifications()
  const tasks = data ?? []
  const notifications = notifRows ?? []
  const pendingReviewCount = (pendingReviewData ?? []).length

  // Pronista §My Work UX — ตัวกรอง/มุมมองใหม่ (ค้นหา, โปรเจกต์, Sprint/Priority, ช่วงเวลา, เสร็จ/ส่งตรวจวันนี้, Board/List)
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all')
  const [spFilter, setSpFilter] = useState<'all' | 'sprint' | 'backlog' | 'high'>('all')
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'overdue'>('all')
  const [todayOnly, setTodayOnly] = useState(false)
  const [view, setView] = useState<'board' | 'list'>('board')
  const [summaryOpen, setSummaryOpen] = useState(false)
  // Pronista §My Tasks redesign (2026-09-18) — ปุ่ม "+ สร้างงาน" ใหม่ในหน้านี้ ใช้ modal "เพิ่มงานด่วน" เดิมที่มีอยู่แล้วทั้งระบบ (ปุ่ม ⚡ มุมขวาบน) ไม่สร้าง flow ใหม่ซ้ำซ้อน
  const [quickAddOpen, setQuickAddOpen] = useState(false)

  useEffect(() => {
    const onCreated = () => void reload()
    window.addEventListener(TASK_CREATED_EVENT, onCreated)
    return () => window.removeEventListener(TASK_CREATED_EVENT, onCreated)
  }, [reload])

  // Pronista §My Work fix (2026-09-11) — เดิมไม่ดักerror เลย ปุ่มเปลี่ยนสถานะเลยเงียบสนิทตอน backend ปฏิเสธ ผู้ใช้กดแล้วไม่เกิดอะไรขึ้นเลย งงว่าทำไมกดไม่ติด
  const changeStatus = async (taskId: string, status: KanbanTask['status']) => {
    try {
      await api.patch(`/api/tasks/${taskId}`, { status })
      await reload()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'เปลี่ยนสถานะไม่สำเร็จ' })
    }
  }
  const acceptTask = async (taskId: string) => {
    await api.post(`/api/tasks/${taskId}/accept`, {})
    await reload()
  }
  const today = bkkToday()
  const isDoneToday = (t: MyTask) => t.status === 'done' && !!t.completedAt && bkkDay(t.completedAt) === today
  const isSubmittedToday = (t: MyTask) => !!t.submittedAt && bkkDay(t.submittedAt) === today
  const isOverdue = (t: MyTask) => !!t.dueDate && t.dueDate < today && !isInactiveStatus(t.status)
  const isPendingAccept = (t: MyTask) => !!t.dispatchedAt && t.status === 'non_start'

  // Pronista §Task lifecycle notifications — งานที่ถูกตีกลับล่าสุด (แจ้งเตือนยังไม่อ่าน) โชว์ป้าย "ตีกลับ" ในบอร์ด
  const bouncedTaskIds = new Set(notifications.filter((n) => n.type === 'task_bounced' && !n.isRead && n.taskId).map((n) => n.taskId!))

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>()
    // งานไม่ผูกโปรเจกต์ (projectId ว่าง) ข้ามไป — ตัวกรอง "โปรเจกต์" ไม่มีความหมายกับงานพวกนี้ (ยังเห็นในลิสต์ตอนไม่ได้กรองอยู่แล้ว)
    tasks.forEach((t) => { if (t.projectId) seen.set(t.projectId, t.projectName ?? '') })
    return Array.from(seen.entries())
  }, [tasks])

  // Pronista §My Tasks redesign (2026-09-18) — การ์ดสรุปด้านบน 5 ใบ แทน StatStrip แบบข้อความล้วนเดิม ("รอตรวจ" กดแล้วพาไปหน้า /my-tasks/review ที่แยกออกไปแล้ว)
  const statCards = useMemo(() => [
    { label: 'งานทั้งหมด', value: tasks.length, icon: ClipboardList, cls: 'bg-brand-50 text-brand-600' },
    { label: 'รอรับ', value: tasks.filter(isPendingAccept).length, icon: Inbox, cls: 'bg-success-50 text-success-600' },
    { label: 'กำลังทำ', value: tasks.filter((t) => t.status === 'on_processing').length, icon: Zap, cls: 'bg-warning-50 text-warning-600' },
    { label: 'รอตรวจ', value: pendingReviewCount, icon: ClipboardCheck, cls: 'bg-violet-50 text-violet-600', onClick: () => navigate('/my-tasks/review') },
    { label: 'เกินกำหนด', value: tasks.filter(isOverdue).length, icon: Clock, cls: 'bg-danger-50 text-danger-600' },
  ], [tasks, pendingReviewCount, today])

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter((t) => {
      if (q && !(t.title.toLowerCase().includes(q) || (t.code ?? '').toLowerCase().includes(q))) return false
      if (projectFilter !== 'all' && t.projectId !== projectFilter) return false
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (spFilter === 'sprint' && !t.sprintId) return false
      if (spFilter === 'backlog' && t.sprintId) return false
      if (spFilter === 'high' && t.priority !== 'high') return false
      if (dateFilter === 'today' && t.dueDate !== today) return false
      if (dateFilter === 'week' && (!t.dueDate || daysBetween(today, t.dueDate) < 0 || daysBetween(today, t.dueDate) > 6)) return false
      if (dateFilter === 'overdue' && !isOverdue(t)) return false
      if (todayOnly && !(isDoneToday(t) || isSubmittedToday(t))) return false
      return true
    })
  }, [tasks, search, projectFilter, statusFilter, spFilter, dateFilter, todayOnly, today])

  // Pronista §My Work UX — Daily Accomplishment: 3 กลุ่มสำหรับ "สรุปผลงานประจำวัน" (คำนวณจากงานทั้งหมด ไม่ผูกกับตัวกรองบนจอ)
  const completedTodayList = tasks.filter((t) => isDoneToday(t) || isSubmittedToday(t))
  const inProgressList = tasks.filter((t) => t.status === 'on_processing')
  const blockersList = tasks.filter((t) => isOverdue(t) || (t.kind === 'defect' && !isInactiveStatus(t.status)))

  return (
    <>
      <PageHeader title="งานของฉัน" />
      <div className="p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="text-sm text-muted">จัดการงานของคุณทั้งหมด โฟกัสสิ่งสำคัญ ทำงานได้มากขึ้น</p>
        <button
          onClick={() => setSummaryOpen(true)}
          className="shrink-0 flex items-center gap-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white px-3 py-2 rounded-lg"
        >
          <ClipboardList className="w-3.5 h-3.5" /> สรุปผลงานประจำวัน
        </button>
      </div>

      <StatCards stats={statCards} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5 items-stretch">
        <NewlyDispatchedWidget tasks={tasks} onOpenTask={openTask} onAccept={(id) => void acceptTask(id)} />
        <AttentionWidget tasks={tasks} onOpenTask={openTask} soonDays={cfg?.dueSoonDays} />
      </div>

      <MyWorkSummary tasks={tasks} onOpenTask={(t) => openTask(t.id)} hideStats />

      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-base font-semibold text-ink">งานทั้งหมดของฉัน</h2>
          <p className="text-xs text-muted mt-0.5">รายการงานที่คุณรับผิดชอบ สามารถกรองและจัดการข้อมูลได้</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:flex border border-border rounded-lg overflow-hidden h-9">
            <button onClick={() => setView('board')} className={`flex items-center gap-1.5 text-xs font-medium px-3 h-full ${view === 'board' ? 'bg-brand-600 text-white' : 'bg-white text-dim'}`}>
              <LayoutGrid className="w-3.5 h-3.5" /> Board
            </button>
            <button onClick={() => setView('list')} className={`flex items-center gap-1.5 text-xs font-medium px-3 h-full border-l border-border ${view === 'list' ? 'bg-brand-600 text-white' : 'bg-white text-dim'}`}>
              <Rows3 className="w-3.5 h-3.5" /> List
            </button>
          </div>
          <button
            onClick={() => setQuickAddOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium bg-brand-600 hover:bg-brand-700 text-white px-3 h-9 rounded-lg"
          >
            <Plus className="w-3.5 h-3.5" /> สร้างงาน
          </button>
        </div>
      </div>

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
            <select
              aria-label="กรองงานตามสถานะ"
              value={statusFilter}
              onChange={(e) => {
                const nextStatus = e.target.value as 'all' | TaskStatus
                setStatusFilter(nextStatus)
                if (nextStatus !== 'all' && !KANBAN_TASK_STATUS_ORDER.includes(nextStatus)) setView('list')
              }}
              className="h-9 text-sm border border-border rounded-lg px-2.5 bg-white w-full sm:w-auto focus:outline-hidden focus:ring-2 focus:ring-brand-500/25"
            >
              <option value="all">สถานะ: ทั้งหมด</option>
              {TASK_STATUS_ORDER.map((status) => <option key={status} value={status}>{TASK_STATUS_LABEL[status]}</option>)}
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
          </div>

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
      {quickAddOpen && <QuickAddModal onClose={() => setQuickAddOpen(false)} />}
      </div>
    </>
  )
}
