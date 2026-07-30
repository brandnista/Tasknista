import { minutesToHoursLabel } from '@seedoffice/core'
import { type DragEvent, useState } from 'react'
import { TASK_STATUS_DOT, TASK_STATUS_LABEL, TASK_STATUS_ORDER, type TaskStatus } from '../lib/task-status'
import { Avatar } from './Avatar'
import { taskTypeLabel } from './MyWorkSummary'
import { avatarColor } from '../pages/ProjectDetail'

export interface KanbanTask {
  id: string
  title: string
  status: TaskStatus
  priority: 'low' | 'normal' | 'high'
  dueDate: string | null
  assigneeId?: string | null
  assigneeName: string | null
  assigneeAvatarUrl?: string | null
  projectName?: string
  // Tasknista §SRS import — chip อ้างอิงเอกสาร SRS ต้นทาง (ไม่มีถ้าไม่ได้มาจาก SRS)
  srsRefCode?: string | null
  srsDocId?: string | null
  // Tasknista §Back to Basic (ต่อยอด) — รหัสงาน+ประเภท + ชั่วโมงประเมิน + ความคืบหน้าเกณฑ์ว่าเสร็จ
  code?: string | null
  kind?: 'task' | 'defect' | 'cr' | 'backlog'
  parentId?: string | null
  estimateMinutes?: number | null
  checklistDone?: number
  checklistTotal?: number
}

const PRIORITY_DOT = { low: 'bg-border', normal: 'bg-warning-400', high: 'bg-danger-500' } as const
const PRIORITY_LABEL = { low: 'ต่ำ', normal: 'กลาง', high: 'สูง' } as const

const bkkToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)

function dueBadge(dueDate: string | null, status: TaskStatus) {
  if (!dueDate || status === 'done') return null
  const diffDays = Math.round((Date.parse(`${dueDate}T00:00:00+07:00`) - Date.parse(`${bkkToday()}T00:00:00+07:00`)) / 86_400_000)
  if (diffDays < 0) return { text: `เลยกำหนด ${-diffDays} วัน`, cls: 'bg-danger-50 text-danger-600' }
  return { text: `อีก ${diffDays} วัน`, cls: 'bg-divider text-dim' }
}

/** Tasknista §2.12 — Kanban 4 สถานะตายตัว ใช้ทั้งในโปรเจกต์เดี่ยว (ProjectDetail) และข้ามโปรเจกต์ (งานของฉัน)
 * canEdit: boolean (ทุกใบเท่ากัน) หรือ function ต่อใบ (Tasknista §permission — พนักงานลากได้เฉพาะงานที่ตัวเอง assign) */
export function StatusKanban({ tasks, onOpenTask, onStatusChange, canEdit }: {
  tasks: KanbanTask[]
  onOpenTask: (id: string) => void
  onStatusChange: (id: string, status: TaskStatus) => void | Promise<void>
  canEdit: boolean | ((task: KanbanTask) => boolean)
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const over = (e: DragEvent) => e.preventDefault()
  const editableOf = (t: KanbanTask) => (typeof canEdit === 'function' ? canEdit(t) : canEdit)
  const dragTask = dragId ? tasks.find((t) => t.id === dragId) : null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {TASK_STATUS_ORDER.map((status) => {
        const col = tasks.filter((t) => t.status === status)
        const dropOk = !!dragTask && editableOf(dragTask)
        return (
          <div
            key={status}
            onDragOver={dropOk ? over : undefined}
            onDrop={dropOk ? () => { if (dragId) void onStatusChange(dragId, status); setDragId(null) } : undefined}
            className="bg-hover/60 rounded-lg p-2 min-h-24"
          >
            <div className="flex items-center gap-1.5 px-1.5 py-1 mb-1.5">
              <span className={`w-2 h-2 rounded-full ${TASK_STATUS_DOT[status]}`} />
              <span className="text-sm font-semibold text-body">{TASK_STATUS_LABEL[status]}</span>
              <span className="text-xs text-muted">{col.length}</span>
            </div>
            <div className="space-y-2">
              {col.map((t) => {
                const badge = dueBadge(t.dueDate, t.status)
                const editable = editableOf(t)
                return (
                  <div
                    key={t.id}
                    draggable={editable}
                    onDragStart={() => setDragId(t.id)}
                    onClick={() => onOpenTask(t.id)}
                    title={editable ? undefined : 'ต้องมีสิทธิ์แก้ไข (editor) ในโปรเจกต์นี้'}
                    className={`bg-white rounded-lg shadow-xs p-3 cursor-pointer hover:shadow-sm ${editable ? '' : 'opacity-80'}`}
                  >
                    <div className="text-sm text-body mb-1.5">{t.title}</div>
                    {t.projectName && <div className="text-[11px] text-muted mb-1.5">{t.projectName}</div>}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {t.code && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-divider text-dim">{t.code}</span>}
                      {t.kind !== undefined && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-info-50 text-info-700">{taskTypeLabel(t)}</span>}
                      <span className="flex items-center gap-1 text-[11px] text-dim">
                        <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[t.priority]}`} /> {PRIORITY_LABEL[t.priority]}
                      </span>
                      {t.estimateMinutes != null && <span className="text-[11px] text-dim">⏱ {minutesToHoursLabel(t.estimateMinutes)} ชม.</span>}
                      {!!t.checklistTotal && <span className="text-[11px] text-dim">☑ {t.checklistDone}/{t.checklistTotal}</span>}
                      {badge && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${badge.cls}`}>{badge.text}</span>}
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
              })}
              {col.length === 0 && <div className="text-center text-[11px] text-border py-3">ไม่มีงาน</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
