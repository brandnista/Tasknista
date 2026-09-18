/** Pronista §Menu Restructure (2026-09-18) — แยกจากแท็บ "งานรอตรวจของฉัน" เดิมใน MyTasks.tsx ออกมาเป็น sub-menu ของ "งานของฉัน" (ดู Layout.tsx NAV) */
import { useNavigate } from 'react-router'
import { PageHeader } from '../components/PageHeader'
import type { KanbanTask } from '../components/StatusKanban'
import { TaskListView } from '../components/TaskListView'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'

/** Pronista §My Tasks reviewer view — งานที่ฉันถูกเลือกเป็นผู้ตรวจ และผู้รับผิดชอบส่งงานมาแล้ว (รอฉันอนุมัติ/ตีกลับ) */
export function MyTasksReviewPage() {
  const navigate = useNavigate()
  const openTask = (id: string) => navigate(`/tasks/${id}`)
  const { data, loading, error } = useLoad<KanbanTask[]>(() => api.get('/api/tasks/pending-review'))
  const { data: cfg } = useLoad<{ dueSoonDays: number }>(() => api.get('/api/config'))
  const tasks = data ?? []

  return (
    <>
      <PageHeader title="งานรอตรวจ" />
      <div className="p-4 sm:p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-ink">งานที่รอคุณตรวจ</h2>
          <p className="text-sm text-muted mt-0.5">แสดงเฉพาะงานที่คุณถูกเลือกเป็นผู้ตรวจและผู้รับผิดชอบส่งงานแล้ว</p>
        </div>

        {loading ? (
          <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">กำลังโหลดงาน…</div>
        ) : error ? (
          <div className="bg-danger-50 rounded-xl border border-danger-100 py-12 text-center text-sm text-danger-700">โหลดงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</div>
        ) : (
          <TaskListView tasks={tasks} onOpenTask={openTask} soonDays={cfg?.dueSoonDays} />
        )}
      </div>
    </>
  )
}
