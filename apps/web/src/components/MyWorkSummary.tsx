import { minutesToHoursLabel } from '@seedoffice/core'
import { AlertTriangle, CalendarClock, CheckCircle2, ListChecks, Loader2 } from 'lucide-react'
import { useMemo } from 'react'
import type { TaskStatus } from '../lib/task-status'

export interface MyWorkTask {
  id: string
  title: string
  status: TaskStatus
  dueDate: string | null
  projectId: string
  projectName: string
  // Pronista §Back to Basic (ต่อยอด) — เพิ่มให้การ์ดโชว์รหัส/ประเภทงาน + ชั่วโมงประเมิน + ความคืบหน้าเกณฑ์ว่าเสร็จ + แยก "งานวันนี้"
  code?: string | null
  kind?: 'task' | 'defect' | 'cr' | 'backlog'
  parentId?: string | null
  startDate?: string | null
  estimateMinutes?: number | null
  checklistDone?: number
  checklistTotal?: number
}

const bkkToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)

// Pronista §Back to Basic (ต่อยอด) — ป้ายประเภทงาน: Story = ยังไม่มีพ่อ (โครงสร้างเดิม) ไม่ใช่ field แยก
export function taskTypeLabel(t: Pick<MyWorkTask, 'kind' | 'parentId'>): string {
  if (t.kind === 'defect') return 'Defect'
  if (t.kind === 'cr') return 'CR'
  if (t.kind === 'backlog') return 'Backlog'
  return t.parentId ? 'Task' : 'Story'
}

export function TaskMetaBadges({ t }: { t: MyWorkTask }) {
  return (
    <>
      {t.code && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-divider text-dim shrink-0">{t.code}</span>}
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-info-50 text-info-700 shrink-0">{taskTypeLabel(t)}</span>
      {t.estimateMinutes != null && <span className="text-[11px] text-dim shrink-0">⏱ {minutesToHoursLabel(t.estimateMinutes)} ชม.</span>}
      {!!t.checklistTotal && <span className="text-[11px] text-dim shrink-0">☑ {t.checklistDone}/{t.checklistTotal}</span>}
    </>
  )
}

/** สรุปงานของฉัน (การ์ด 4 ใบ + "ต้องรีบทำ") — ใช้ร่วมกันระหว่างหน้า "งานของฉัน" กับส่วน "ภาพรวมงานของฉัน" บนหน้า ภาพรวม (Pronista §permission)
 * hideStats: หน้า "งานของฉัน" มี stat strip แบบ compact ของตัวเองแล้ว (Pronista §My Work UX) — ซ่อนการ์ด 4 ใบตรงนี้กันซ้ำ เหลือแค่ลิสต์ "งานวันนี้"/"ต้องรีบทำ" */
export function MyWorkSummary({ tasks, onOpenTask, hideStats }: { tasks: MyWorkTask[]; onOpenTask: (task: MyWorkTask) => void; hideStats?: boolean }) {
  const stats = useMemo(() => {
    const today = bkkToday()
    const notDone = tasks.filter((t) => t.status !== 'done')
    const overdue = notDone.filter((t) => t.dueDate && t.dueDate < today)
    return { total: tasks.length, notDone: notDone.length, done: tasks.length - notDone.length, overdue: overdue.length }
  }, [tasks])

  const urgent = useMemo(() => {
    const today = bkkToday()
    return tasks
      .filter((t) => t.status !== 'done')
      .map((t) => ({ ...t, overdueDays: t.dueDate && t.dueDate < today ? Math.round((Date.parse(`${today}T00:00:00+07:00`) - Date.parse(`${t.dueDate}T00:00:00+07:00`)) / 86_400_000) : 0 }))
      .sort((a, b) => (b.overdueDays - a.overdueDays) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
      .slice(0, 5)
  }, [tasks])

  // Pronista §Back to Basic (ต่อยอด) — "งานวันนี้" (ควรเริ่มทำวันนี้ตาม startDate) แยกจาก "ต้องรีบทำ" (ตาม dueDate)
  const todayTasks = useMemo(() => {
    const today = bkkToday()
    return tasks.filter((t) => t.status !== 'done' && t.startDate && t.startDate <= today && (!t.dueDate || t.dueDate >= today))
  }, [tasks])

  const cards = [
    { label: 'งานทั้งหมด', value: stats.total, icon: ListChecks, cls: 'bg-divider text-soft' },
    { label: 'ยังไม่เสร็จ', value: stats.notDone, icon: Loader2, cls: 'bg-info-50 text-info-600' },
    { label: 'เสร็จแล้ว', value: stats.done, icon: CheckCircle2, cls: 'bg-success-50 text-success-600' },
    { label: 'เลยกำหนด', value: stats.overdue, icon: AlertTriangle, cls: 'bg-danger-50 text-danger-600' },
  ]

  return (
    <>
      {!hideStats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {cards.map((c) => (
            <div key={c.label} className="bg-white rounded-lg shadow-xs p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${c.cls}`}>
                <c.icon className="w-4.5 h-4.5" />
              </div>
              <div>
                <div className="text-xl font-bold text-ink leading-none">{c.value}</div>
                <div className="text-xs text-muted mt-0.5">{c.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {todayTasks.length > 0 && (
        <div className="bg-white rounded-lg shadow-xs p-4 mb-5">
          <div className="text-sm font-semibold text-body mb-2 flex items-center gap-1.5"><CalendarClock className="w-4 h-4 text-brand-600" /> งานวันนี้</div>
          <div className="divide-y divide-divider">
            {todayTasks.map((t) => (
              <div key={t.id} onClick={() => onOpenTask(t)} className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-hover -mx-1 px-1 rounded-lg">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-body truncate">{t.title}</div>
                  <div className="text-[11px] text-muted">{t.projectName}</div>
                </div>
                <TaskMetaBadges t={t} />
              </div>
            ))}
          </div>
        </div>
      )}

      {urgent.length > 0 && (
        <div className="bg-white rounded-lg shadow-xs p-4 mb-5">
          <div className="text-sm font-semibold text-body mb-2">ต้องรีบทำ</div>
          <div className="divide-y divide-divider">
            {urgent.map((t) => (
              <div key={t.id} onClick={() => onOpenTask(t)} className="flex items-center gap-3 py-2.5 cursor-pointer hover:bg-hover -mx-1 px-1 rounded-lg">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-body truncate">{t.title}</div>
                  <div className="text-[11px] text-muted">{t.projectName}</div>
                </div>
                <TaskMetaBadges t={t} />
                {t.overdueDays > 0 ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-danger-50 text-danger-600 shrink-0">เลยกำหนด {t.overdueDays} วัน</span>
                ) : t.dueDate ? (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-divider text-dim shrink-0">อีก {Math.round((Date.parse(`${t.dueDate}T00:00:00+07:00`) - Date.parse(`${bkkToday()}T00:00:00+07:00`)) / 86_400_000)} วัน</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
