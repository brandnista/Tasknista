/** Pronista §Menu Restructure (2026-08-28) — แยกจากแท็บเดิมใน MyTasks.tsx ออกมาเป็น sub-menu ของ "งานของฉัน" (ดู Layout.tsx NAV) */
import { useNavigate } from 'react-router'
import type { KanbanTask } from '../components/StatusKanban'
import { PageHeader } from '../components/PageHeader'
import { api } from '../lib/api'
import { checklistLabel, dueUrgency, URGENCY_CARD_CLASS } from '../lib/due-urgency'
import { TASK_STATUS_BADGE, TASK_STATUS_LABEL } from '../lib/task-status'
import { useLoad } from '../lib/useLoad'

interface DispatchedRow extends KanbanTask {
  projectId: string
  projectName: string
}

/** Pronista §My Tasks dispatcher view — งานที่ฉัน assign ให้คนอื่น ดูสถานะรวมว่าแต่ละงานไปถึงไหนแล้ว */
export function MyTasksDispatchedPage() {
  const navigate = useNavigate()
  const openTask = (id: string) => navigate(`/tasks/${id}`)
  const { data } = useLoad<DispatchedRow[]>(() => api.get('/api/tasks/dispatched-by-me'))
  const { data: cfg } = useLoad<{ dueSoonDays: number }>(() => api.get('/api/config'))
  const tasks = data ?? []

  return (
    <>
      <PageHeader title="งานที่จ่ายให้คนอื่น" />
      <div className="p-3 sm:p-6">
        {tasks.length === 0 ? (
          <div className="text-center text-sm text-muted py-8">ยังไม่มีงานที่จ่ายให้คนอื่น</div>
        ) : (
          <div className="bg-white rounded-lg shadow-xs divide-y divide-divider overflow-hidden">
            {tasks.map((t) => (
              <button
                key={t.id}
                onClick={() => openTask(t.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left ${URGENCY_CARD_CLASS[dueUrgency(t.dueDate, t.status === 'done', cfg?.dueSoonDays)]}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-body truncate">
                    {t.title}
                    {checklistLabel(t.checklistDone, t.checklistTotal) && (
                      <span className="ml-2 text-[11px] text-dim">{checklistLabel(t.checklistDone, t.checklistTotal)}</span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted mt-0.5">{t.projectName}{t.assigneeName ? ` · ${t.assigneeName}` : ''}</div>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${TASK_STATUS_BADGE[t.status]}`}>{TASK_STATUS_LABEL[t.status]}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
