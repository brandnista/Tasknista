/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 · genre: modern-minimal · macrostructure: Workbench · tone: friendly-readable · designed-as-app */
import { resolveTaskTypes, type TaskType } from '@seedoffice/core'
import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Copy,
  Eye,
  Inbox,
  LayoutGrid,
  PlayCircle,
  Plus,
  Rows3,
  RotateCw,
  Search,
  X,
  Zap,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Avatar } from '../components/Avatar'
import { useDialog } from '../components/Dialog'
import { PageHeader } from '../components/PageHeader'
import { StatusKanban, type KanbanTask } from '../components/StatusKanban'
import { TaskListView } from '../components/TaskListView'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useNotifications } from '../lib/notifications-context'
import { avatarColor } from './ProjectDetail'
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
  dispatcherAvatarUrl: string | null
  taskType: string | null
  subTaskType: string | null
}
const PRIORITY_ORDER: Record<MyTask['priority'], number> = { high: 0, normal: 1, low: 2 }
const bkkToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)
// Pronista §My Work UX — completedAt/submittedAt มาจาก API เป็น ISO string (Date ถูก serialize ผ่าน JSON) ต้อง +7h ก่อนตัดเป็นวันที่ไทย
const bkkDay = (x: string | number) => new Date(new Date(x).getTime() + 7 * 3_600_000).toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00+07:00`) - Date.parse(`${a}T00:00:00+07:00`)) / 86_400_000)
// Pronista §My Tasks — วันที่+เวลาแบบไทย (dd/mm/yy HH:mm) ให้คอลัมน์ "วันที่ เวลา" ของตาราง "งานใหม่ที่รอกดรับ"
const fmtDateTime = (x: string | number) =>
  new Date(x).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Pronista §My Work/Notification — งานย่อยของฉันที่ยังไม่เสร็จ เรียง priority แล้ว deadline พร้อมปุ่มติ๊กเสร็จตรงๆ */
function PendingSubtasksWidget({ tasks, onOpenTask, onComplete }: { tasks: MyTask[]; onOpenTask: (id: string) => void; onComplete: (id: string) => void }) {
  const pending = tasks
    .filter((t) => t.parentId && !isInactiveStatus(t.status))
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

/** Pronista §Task lifecycle accept step — งานที่จ่ายมาแล้วแต่ฉันยังไม่กดรับ (status ยังเป็น non_start) กดรับได้ตรงจากหน้านี้ ไม่ต้องเข้า Task Detail ก่อน
 * Pronista §My Tasks table redesign (2026-09-18) — เปลี่ยนเป็นตารางหัวคอลัมน์ชัดเจน (วันที่เวลา/รหัสงาน/ชื่องาน/ผู้จ่ายงาน/ปุ่มรับงาน) + เรียงงานที่จ่ายมาใหม่สุดไว้บนสุด (เดิมไม่เรียงเลย ใช้ลำดับดิบจาก API) */
type PendingWorkType = '' | 'task' | 'defect' | 'cr'
const PENDING_WORK_TYPE_OPTIONS: { value: Exclude<PendingWorkType, ''>; label: string }[] = [
  { value: 'task', label: 'Task' },
  { value: 'defect', label: 'Defect' },
  { value: 'cr', label: 'CR' },
]

function NewlyDispatchedWidget({ tasks, loading, acceptingTaskId, onOpenTask, onAccept }: {
  tasks: MyTask[]
  loading: boolean
  acceptingTaskId: string | null
  onOpenTask: (id: string) => void
  onAccept: (id: string) => void
}) {
  const [workTypeFilter, setWorkTypeFilter] = useState<PendingWorkType>('')
  const pending = tasks
    .filter((t) => t.dispatchedAt && t.status === 'non_start')
    .sort((a, b) => new Date(b.dispatchedAt!).getTime() - new Date(a.dispatchedAt!).getTime())
  const filtered = workTypeFilter ? pending.filter((t) => t.kind === workTypeFilter) : pending
  return (
    <section className="overflow-hidden rounded-xl border border-info-100 bg-info-50/70 shadow-xs" aria-busy={loading}>
      <div className="flex flex-col gap-3 border-b border-info-100 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold text-info-700">
            <Inbox className="h-4 w-4" /> งานใหม่ที่รอคุณกดรับ ({workTypeFilter ? `${filtered.length}/${pending.length}` : pending.length})
          </div>
          <p className="mt-1 text-[11px] text-info-700/70">ตรวจรายละเอียดและกดรับงานเพื่อเริ่มล็อก Workload</p>
        </div>
        <select
          value={workTypeFilter}
          onChange={(e) => setWorkTypeFilter(e.target.value as PendingWorkType)}
          aria-label="กรองประเภทงานใหม่ที่รอกดรับ"
          className="w-full sm:w-44 border border-info-200 bg-white text-soft px-2.5 py-1.5 rounded-lg text-xs focus:outline-hidden focus:border-brand-400"
        >
          <option value="">Work Type ทั้งหมด</option>
          {PENDING_WORK_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <div className="divide-y divide-info-100">
            {loading && Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 px-4 py-3" aria-hidden="true">
                <div className="h-9 flex-1 animate-pulse rounded-md bg-white/75" />
                <div className="h-8 w-20 animate-pulse rounded-lg bg-info-100" />
              </div>
            ))}
            {!loading && pending.length === 0 && (
              <div className="px-4 py-8 text-center">
                <CheckCircle2 className="mx-auto h-6 w-6 text-info-500" />
                <p className="mt-2 text-sm font-semibold text-info-700">ไม่มีงานใหม่ที่รอรับ</p>
                <p className="mt-1 text-xs text-info-700/70">งานที่มีคนจ่ายให้คุณจะมาแสดงตรงนี้</p>
              </div>
            )}
            {!loading && filtered.slice(0, 5).map((t) => (
              <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-white/60 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <button onClick={() => onOpenTask(t.id)} className="min-w-0 text-left focus-visible:outline-2 focus-visible:outline-brand-500">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 font-mono text-[10px] text-info-700">{t.code ?? '—'}</span>
                    <span className="truncate text-sm font-semibold text-body">{t.title}</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-muted">{fmtDateTime(t.dispatchedAt!)} · {t.projectName ?? 'ไม่ผูกโปรเจกต์'}</div>
                </button>
                  <div className="col-start-1 row-start-2 flex min-w-0 items-center gap-2 sm:col-start-2 sm:row-start-1" title={`ผู้จ่ายงาน: ${t.dispatcherName ?? '—'}`}>
                    <Avatar name={t.dispatcherName ?? '—'} avatarUrl={t.dispatcherAvatarUrl} className="h-7 w-7 shrink-0 text-[10px] ring-2 ring-white" colorClass={avatarColor(t.dispatcherName ?? '—')} />
                    <span className="max-w-28 truncate text-xs font-medium text-soft">{t.dispatcherName ?? '—'}</span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onAccept(t.id) }}
                    disabled={acceptingTaskId === t.id}
                    className="col-start-2 row-span-2 row-start-1 inline-flex min-h-11 min-w-20 items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-wait disabled:bg-brand-400 sm:col-start-3 sm:row-span-1"
                  >
                    {acceptingTaskId === t.id ? <RotateCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    {acceptingTaskId === t.id ? 'กำลังรับ' : 'รับงาน'}
                  </button>
              </div>
            ))}
            {!loading && pending.length > 0 && filtered.length === 0 && (
              <div className="py-8 text-center text-xs text-muted">ไม่มีงานใหม่ในประเภทที่เลือก</div>
            )}
            {filtered.length > 5 && <div className="px-4 py-2 text-right text-[11px] font-medium text-info-700">ยังมีอีก {filtered.length - 5} งาน</div>}
      </div>
    </section>
  )
}

type SummaryKey = 'all' | 'pending' | 'processing' | 'review' | 'overdue'

function SummaryCards({ cards, selected, loading, onSelect }: {
  cards: { key: SummaryKey; label: string; value: number; icon: typeof BriefcaseBusiness; tone: string }[]
  selected: SummaryKey
  loading: boolean
  onSelect: (key: SummaryKey) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
      {cards.map((card) => (
        <button key={card.key} type="button" disabled={loading} aria-pressed={selected === card.key} onClick={() => onSelect(card.key)} className={`group flex min-w-0 items-center gap-3 rounded-xl border bg-white p-3.5 text-left shadow-xs transition-colors focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-wait ${selected === card.key ? 'border-brand-400 ring-2 ring-brand-100' : 'border-border-subtle hover:border-border'}`}>
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${card.tone}`}><card.icon className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-[11px] text-muted">{card.label}</span>{loading ? <span className="mt-1 block h-6 w-14 animate-pulse rounded bg-divider" aria-label="กำลังโหลด" /> : <span className="mt-0.5 block text-xl font-bold tabular-nums text-ink">{card.value} <small className="text-[10px] font-medium text-muted">งาน</small></span>}</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-border group-hover:text-dim" />
        </button>
      ))}
    </div>
  )
}

type AttentionFilter = 'all' | 'overdue' | 'today' | 'soon'

function AttentionWidget({ tasks, loading, onOpenTask, soonDays = 3 }: { tasks: MyTask[]; loading: boolean; onOpenTask: (id: string) => void; soonDays?: number }) {
  const [filter, setFilter] = useState<AttentionFilter>('all')
  const today = bkkToday()
  const rows = tasks
    .filter((t) => !isInactiveStatus(t.status) && t.dueDate)
    .map((t) => ({ ...t, days: daysBetween(today, t.dueDate!) }))
    .filter((t) => t.days <= soonDays)
    .sort((a, b) => a.days - b.days)
  const counts = {
    all: rows.length,
    overdue: rows.filter((t) => t.days < 0).length,
    today: rows.filter((t) => t.days === 0).length,
    soon: rows.filter((t) => t.days > 0).length,
  }
  const visible = rows.filter((t) => filter === 'all' || (filter === 'overdue' ? t.days < 0 : filter === 'today' ? t.days === 0 : t.days > 0))
  return (
    <section className="overflow-hidden rounded-xl border border-danger-100 bg-danger-50/55 shadow-xs" aria-busy={loading}>
      <div className="border-b border-danger-100 px-4 py-3.5">
        <div className="flex items-center gap-2 text-sm font-bold text-danger-700"><AlertTriangle className="h-4 w-4" /> งานที่ต้องให้ความสนใจ ({rows.length})</div>
        <div className="mt-2 flex gap-1 overflow-x-auto" role="tablist" aria-label="กรองงานที่ต้องให้ความสนใจ">
          {([['all', 'ทั้งหมด'], ['overdue', 'เกินกำหนด'], ['today', 'วันนี้'], ['soon', 'ใกล้ครบกำหนด']] as const).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)} className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-danger-500 ${filter === key ? 'bg-white text-danger-700 shadow-xs' : 'text-danger-700/70 hover:bg-white/60'}`}>{label} {counts[key]}</button>
          ))}
        </div>
      </div>
      <div className="divide-y divide-danger-100">
        {loading && Array.from({ length: 3 }, (_, index) => <div key={index} className="mx-4 my-3 h-9 animate-pulse rounded-md bg-white/75" aria-hidden="true" />)}
        {!loading && visible.slice(0, 5).map((t) => (
          <button key={t.id} type="button" onClick={() => onOpenTask(t.id)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-white/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-danger-500">
            <span className="min-w-0"><span className="flex items-center gap-2"><span className="shrink-0 font-mono text-[10px] text-danger-700">{t.code ?? '—'}</span><span className="truncate text-sm font-semibold text-body">{t.title}</span></span><span className="mt-1 block truncate text-[11px] text-muted">{t.projectName ?? 'ไม่ผูกโปรเจกต์'} · กำหนด {new Date(`${t.dueDate}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</span></span>
            <span className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ${t.days < 0 ? 'bg-danger-100 text-danger-700' : t.days === 0 ? 'bg-warning-100 text-warning-700' : 'bg-white text-danger-700'}`}>{t.days < 0 ? `เกิน ${-t.days} วัน` : t.days === 0 ? 'ครบกำหนดวันนี้' : `อีก ${t.days} วัน`}</span>
          </button>
        ))}
        {!loading && visible.length === 0 && <div className="px-4 py-8 text-center"><CheckCircle2 className="mx-auto h-6 w-6 text-danger-400" /><p className="mt-2 text-sm font-semibold text-danger-700">ไม่มีงานที่ต้องกังวลในกลุ่มนี้</p><p className="mt-1 text-xs text-danger-700/65">เมื่อมีงานใกล้ครบกำหนด ระบบจะแจ้งเตือนที่นี่</p></div>}
      </div>
    </section>
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
  const { data, loading, error, reload } = useLoad<MyTask[]>(() => api.get('/api/tasks/mine'))
  // Pronista §Card glance-at-a-glance — จำนวนวันก่อนถึงกำหนดส่งที่เริ่มเตือนสีเหลือง (ตั้งค่าทั่วไป)
  const { data: cfg } = useLoad<{ dueSoonDays: number; taskTypes: TaskType[] }>(() => api.get('/api/config'))
  // Pronista §Notification overhaul (2026-08-27) — ย้ายมาอ่านจาก NotificationsProvider กลาง (แท็บ "แจ้งเตือน" ในหน้านี้ถูกถอดออกแล้ว เพราะมีกระดิ่งที่ Navbar เป็นจุดเข้าถึงหลักแทน)
  const { rows: notifRows } = useNotifications()
  const tasks = data ?? []
  const notifications = notifRows ?? []

  // Pronista §My Work UX — ตัวกรอง/มุมมองใหม่ (ค้นหา, โปรเจกต์, Sprint/Priority, ช่วงเวลา, เสร็จ/ส่งตรวจวันนี้, Board/List)
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')
  const [taskTypeFilter, setTaskTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all')
  const [spFilter, setSpFilter] = useState<'all' | 'sprint' | 'backlog'>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | MyTask['priority']>('all')
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'overdue'>('all')
  const [todayOnly, setTodayOnly] = useState(false)
  const [view, setView] = useState<'board' | 'list'>('board')
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summarySelection, setSummarySelection] = useState<SummaryKey>('all')
  const [acceptingTaskId, setAcceptingTaskId] = useState<string | null>(null)

  // Pronista §My Work fix (2026-09-11) — เดิมไม่ดัก error เลย ปุ่ม "✓ เสร็จแล้ว" ในวิดเจ็ต "งานย่อยที่รอทำ" เลยเงียบสนิทตอน backend ปฏิเสธ (เช่น งานย่อยที่ถูกจ่ายมาแล้วกำลังทำอยู่ ข้ามไป done ตรงๆ ไม่ได้ ต้องผ่าน "ส่งตรวจ" ก่อน — PATCH /tasks/:id เช็คเงื่อนไขนี้อยู่แล้วฝั่ง server) ผู้ใช้กดแล้วไม่เกิดอะไรขึ้นเลย งงว่าทำไมกดไม่ติด
  const changeStatus = async (taskId: string, status: KanbanTask['status']) => {
    try {
      await api.patch(`/api/tasks/${taskId}`, { status })
      await reload()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'เปลี่ยนสถานะไม่สำเร็จ' })
    }
  }
  const acceptTask = async (taskId: string) => {
    try {
      setAcceptingTaskId(taskId)
      await api.post(`/api/tasks/${taskId}/accept`, {})
      await reload()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'รับงานไม่สำเร็จ' })
    } finally {
      setAcceptingTaskId(null)
    }
  }
  const today = bkkToday()
  const isDoneToday = (t: MyTask) => t.status === 'done' && !!t.completedAt && bkkDay(t.completedAt) === today
  const isSubmittedToday = (t: MyTask) => !!t.submittedAt && bkkDay(t.submittedAt) === today
  const isOverdue = (t: MyTask) => !!t.dueDate && t.dueDate < today && !isInactiveStatus(t.status)

  // Pronista §Task lifecycle notifications — งานที่ถูกตีกลับล่าสุด (แจ้งเตือนยังไม่อ่าน) โชว์ป้าย "ตีกลับ" ในบอร์ด
  const bouncedTaskIds = new Set(notifications.filter((n) => n.type === 'task_bounced' && !n.isRead && n.taskId).map((n) => n.taskId!))

  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>()
    // งานไม่ผูกโปรเจกต์ (projectId ว่าง) ข้ามไป — ตัวกรอง "โปรเจกต์" ไม่มีความหมายกับงานพวกนี้ (ยังเห็นในลิสต์ตอนไม่ได้กรองอยู่แล้ว)
    tasks.forEach((t) => { if (t.projectId) seen.set(t.projectId, t.projectName ?? '') })
    return Array.from(seen.entries())
  }, [tasks])

  const summaryCards = useMemo(() => [
    { key: 'all' as const, label: 'งานทั้งหมด', value: tasks.length, icon: BriefcaseBusiness, tone: 'bg-divider text-soft' },
    { key: 'pending' as const, label: 'รอรับ', value: tasks.filter((t) => !!t.dispatchedAt && t.status === 'non_start').length, icon: Inbox, tone: 'bg-info-50 text-info-700' },
    { key: 'processing' as const, label: 'กำลังทำ', value: tasks.filter((t) => t.status === 'on_processing').length, icon: PlayCircle, tone: 'bg-brand-50 text-brand-700' },
    { key: 'review' as const, label: 'รอตรวจ', value: tasks.filter((t) => t.status === 'waiting_for_test').length, icon: Eye, tone: 'bg-warning-50 text-warning-700' },
    { key: 'overdue' as const, label: 'เกินกำหนด', value: tasks.filter(isOverdue).length, icon: AlertTriangle, tone: 'bg-danger-50 text-danger-700' },
  ], [tasks, today])

  const selectSummary = (key: SummaryKey) => {
    setSummarySelection(key)
    setStatusFilter(key === 'pending' ? 'non_start' : key === 'processing' ? 'on_processing' : key === 'review' ? 'waiting_for_test' : 'all')
    setDateFilter(key === 'overdue' ? 'overdue' : 'all')
  }

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter((t) => {
      if (q && !(t.title.toLowerCase().includes(q) || (t.code ?? '').toLowerCase().includes(q))) return false
      if (projectFilter !== 'all' && t.projectId !== projectFilter) return false
      if (taskTypeFilter !== 'all' && t.taskType !== taskTypeFilter) return false
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (spFilter === 'sprint' && !t.sprintId) return false
      if (spFilter === 'backlog' && t.sprintId) return false
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false
      if (dateFilter === 'today' && t.dueDate !== today) return false
      if (dateFilter === 'week' && (!t.dueDate || daysBetween(today, t.dueDate) < 0 || daysBetween(today, t.dueDate) > 6)) return false
      if (dateFilter === 'overdue' && !isOverdue(t)) return false
      if (todayOnly && !(isDoneToday(t) || isSubmittedToday(t))) return false
      return true
    })
  }, [tasks, search, projectFilter, taskTypeFilter, statusFilter, spFilter, priorityFilter, dateFilter, todayOnly, today])

  const activeFilterCount = [projectFilter, taskTypeFilter, statusFilter, spFilter, priorityFilter, dateFilter].filter((value) => value !== 'all').length + (todayOnly ? 1 : 0)
  const clearFilters = () => {
    setSearch('')
    setProjectFilter('all')
    setTaskTypeFilter('all')
    setStatusFilter('all')
    setSpFilter('all')
    setPriorityFilter('all')
    setDateFilter('all')
    setTodayOnly(false)
    setSummarySelection('all')
  }

  // Pronista §My Work UX — Daily Accomplishment: 3 กลุ่มสำหรับ "สรุปผลงานประจำวัน" (คำนวณจากงานทั้งหมด ไม่ผูกกับตัวกรองบนจอ)
  const completedTodayList = tasks.filter((t) => isDoneToday(t) || isSubmittedToday(t))
  const inProgressList = tasks.filter((t) => t.status === 'on_processing')
  const blockersList = tasks.filter((t) => isOverdue(t) || (t.kind === 'defect' && !isInactiveStatus(t.status)))

  return (
    <>
      <PageHeader title="งานของฉัน" />
      <div className="space-y-4 p-3 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm text-body">สวัสดี {user?.name} — นี่คือภาพรวมงานที่คุณรับผิดชอบ</p>
            <p className="mt-1 text-xs text-muted">{new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
          <button onClick={() => setSummaryOpen(true)} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
            <ClipboardList className="h-3.5 w-3.5" /> สรุปผลงานประจำวัน
          </button>
        </div>

        {error && (
          <div role="alert" className="flex flex-col gap-3 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-danger-700">โหลดข้อมูลงานไม่สำเร็จ</p>
              <p className="mt-0.5 text-xs text-danger-700/75">{error.message || 'กรุณาลองโหลดข้อมูลอีกครั้ง'}</p>
            </div>
            <button type="button" onClick={() => void reload()} className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-danger-300 bg-white px-3 text-xs font-semibold text-danger-700 hover:bg-danger-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-500">
              <RotateCw className="h-3.5 w-3.5" /> ลองใหม่
            </button>
          </div>
        )}

        <SummaryCards cards={summaryCards} selected={summarySelection} loading={loading} onSelect={selectSummary} />

        <div className="grid grid-cols-1 gap-3 min-[900px]:grid-cols-2">
          <NewlyDispatchedWidget tasks={tasks} loading={loading} acceptingTaskId={acceptingTaskId} onOpenTask={openTask} onAccept={(id) => void acceptTask(id)} />
          <AttentionWidget tasks={tasks} loading={loading} onOpenTask={openTask} soonDays={cfg?.dueSoonDays} />
        </div>

        <PendingSubtasksWidget tasks={tasks} onOpenTask={openTask} onComplete={(id) => void changeStatus(id, 'done')} />

        <section className="rounded-xl border border-border-subtle bg-white shadow-xs">
          <div className="flex flex-col gap-3 border-b border-divider px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-base font-bold text-ink"><BriefcaseBusiness className="h-4.5 w-4.5 text-brand-600" /> งานทั้งหมดของฉัน</div>
              <p className="mt-1 text-xs text-muted">ค้นหา กรอง และติดตามงานจากทุกโปรเจกต์ในที่เดียว</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex overflow-hidden rounded-lg border border-border">
                <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')} className={`flex h-9 items-center gap-1.5 px-3 text-xs font-semibold focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-brand-500 ${view === 'board' ? 'bg-brand-600 text-white' : 'bg-white text-dim hover:bg-hover'}`}><LayoutGrid className="h-3.5 w-3.5" /> Board</button>
                <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`flex h-9 items-center gap-1.5 border-l border-border px-3 text-xs font-semibold focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-brand-500 ${view === 'list' ? 'bg-brand-600 text-white' : 'bg-white text-dim hover:bg-hover'}`}><Rows3 className="h-3.5 w-3.5" /> List</button>
              </div>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyN', bubbles: true }))}
                className="inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 active:bg-brand-800 sm:h-9"
              >
                <Plus className="h-3.5 w-3.5" /> สร้างงาน
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 border-b border-divider bg-hover/45 p-3 sm:flex sm:flex-wrap sm:items-center">
            <div className="flex items-center gap-1.5 bg-white border border-border rounded-lg px-2.5 h-9 col-span-2 sm:flex-1 sm:min-w-[180px]">
              <Search className="w-3.5 h-3.5 text-dim shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหา Task, Subtask หรือรหัสอ้างอิง"
                aria-label="ค้นหางาน"
                className="text-sm w-full outline-hidden bg-transparent placeholder:text-muted"
              />
            </div>
            <select aria-label="กรองตามโปรเจกต์" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="h-9 w-full rounded-lg border border-border bg-white px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-brand-500 sm:w-auto">
              <option value="all">โปรเจกต์: ทั้งหมด</option>
              {projectOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select aria-label="กรองตามประเภทงาน" value={taskTypeFilter} onChange={(e) => setTaskTypeFilter(e.target.value)} className="h-9 w-full rounded-lg border border-border bg-white px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-brand-500 sm:w-auto">
              <option value="all">ประเภท: ทั้งหมด</option>
              {resolveTaskTypes(cfg?.taskTypes).map((tt) => <option key={tt.id} value={tt.id}>{tt.name}</option>)}
            </select>
            <select
              aria-label="กรองงานตามสถานะ"
              value={statusFilter}
              onChange={(e) => {
                const nextStatus = e.target.value as 'all' | TaskStatus
                setStatusFilter(nextStatus)
                setSummarySelection(nextStatus === 'non_start' ? 'pending' : nextStatus === 'on_processing' ? 'processing' : nextStatus === 'waiting_for_test' ? 'review' : 'all')
                if (dateFilter === 'overdue') setDateFilter('all')
                if (nextStatus !== 'all' && !KANBAN_TASK_STATUS_ORDER.includes(nextStatus)) setView('list')
              }}
              className="h-9 text-sm border border-border rounded-lg px-2.5 bg-white w-full sm:w-auto focus:outline-hidden focus:ring-2 focus:ring-brand-500/25"
            >
              <option value="all">สถานะ: ทั้งหมด</option>
              {TASK_STATUS_ORDER.map((status) => <option key={status} value={status}>{TASK_STATUS_LABEL[status]}</option>)}
            </select>
            <select aria-label="กรองตาม Sprint" value={spFilter} onChange={(e) => setSpFilter(e.target.value as typeof spFilter)} className="h-9 w-full rounded-lg border border-border bg-white px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-brand-500 sm:w-auto">
              <option value="all">Sprint: ทั้งหมด</option>
              <option value="sprint">อยู่ใน Sprint</option>
              <option value="backlog">Backlog</option>
            </select>
            <select aria-label="กรองตามความสำคัญ" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)} className="h-9 w-full rounded-lg border border-border bg-white px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-brand-500 sm:w-auto">
              <option value="all">Priority: ทั้งหมด</option>
              <option value="high">สูง</option>
              <option value="normal">กลาง</option>
              <option value="low">ต่ำ</option>
            </select>
            <select aria-label="กรองตามวันครบกำหนด" value={dateFilter} onChange={(e) => { const nextDate = e.target.value as typeof dateFilter; setDateFilter(nextDate); setSummarySelection(nextDate === 'overdue' ? 'overdue' : 'all'); if (nextDate === 'overdue') setStatusFilter('all') }} className="h-9 w-full rounded-lg border border-border bg-white px-2.5 text-sm focus-visible:outline-2 focus-visible:outline-brand-500 sm:w-auto">
              <option value="all">ช่วงเวลา: ทั้งหมด</option>
              <option value="today">วันนี้</option>
              <option value="week">สัปดาห์นี้</option>
              <option value="overdue">เลยกำหนด</option>
            </select>
            <button
              type="button"
              aria-pressed={todayOnly}
              onClick={() => setTodayOnly((v) => !v)}
              className={`flex h-9 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500 sm:w-auto ${todayOnly ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-border text-dim'}`}
            >
              <Zap className="w-3.5 h-3.5" /> เสร็จ/ส่งตรวจวันนี้
            </button>
            {activeFilterCount > 0 && <button type="button" onClick={clearFilters} className="h-9 whitespace-nowrap rounded-lg px-3 text-xs font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500">ล้างตัวกรอง ({activeFilterCount})</button>}
          </div>

          <div className="p-3">

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
          </div>
        </section>
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
