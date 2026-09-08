import { checklistLabel, dueUrgency, URGENCY_CARD_CLASS } from '../lib/due-urgency'
import { TASK_STATUS_DOT, TASK_STATUS_LABEL } from '../lib/task-status'
import { taskTypeLabel } from './MyWorkSummary'
import type { KanbanTask } from './StatusKanban'

/** Pronista §My Work UX — มุมมองตาราง (List View) ทางเลือกของ Board ใช้ตอนมี subtask เยอะ scan ทีละบรรทัดง่ายกว่า
 * (2026-09-07) แยกออกมาจาก MyTasks.tsx ให้ใช้ซ้ำได้กับหน้าอื่น (เช่น Workload drill-down) — generic บน KanbanTask ล้วนๆ ไม่ผูกกับ "งานของฉัน" */
export function TaskListView({ tasks, onOpenTask, soonDays }: { tasks: KanbanTask[]; onOpenTask: (id: string) => void; soonDays?: number }) {
  if (tasks.length === 0) return <div className="bg-white rounded-lg shadow-xs text-center text-sm text-muted py-10">ไม่พบงานตามตัวกรองนี้</div>
  return (
    <div className="bg-white rounded-lg shadow-xs overflow-hidden">
      {/* Pronista §Mobile responsive — ตารางคงเดิมบน sm+ ขึ้นไป, มือถือใช้การ์ดแทน (ตารางคอลัมน์ตายตัวบีบอ่านยากบนจอแคบ) */}
      <table className="hidden sm:table w-full text-sm" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '12%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '34%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '12%' }} />
        </colgroup>
        <thead>
          <tr className="bg-hover text-[11px] text-muted uppercase tracking-wide">
            <th className="text-left font-semibold px-3 py-2">วันที่จ่ายงาน</th>
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
              <td className="px-3 py-2.5 text-[11px] text-muted truncate">
                {t.dispatchedAt ? new Date(t.dispatchedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'}
              </td>
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
              {t.dispatchedAt && <span className="shrink-0">จ่ายงาน {new Date(t.dispatchedAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}</span>}
              {t.dispatchedAt && <span>·</span>}
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
