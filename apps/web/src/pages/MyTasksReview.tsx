/** Pronista §Menu Restructure (2026-09-18) — แยกจากแท็บ "งานรอตรวจของฉัน" เดิมใน MyTasks.tsx ออกมาเป็น sub-menu ของ "งานของฉัน" (ดู Layout.tsx NAV) */
import { useNavigate } from 'react-router'
import { PageHeader } from '../components/PageHeader'
import { TaskTrackingView, type TrackingTask } from '../components/TaskTrackingView'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'

interface ReviewRow extends TrackingTask {
  submittedAt?: string | number | null
}

/** Pronista §My Tasks reviewer view — งานที่ฉันถูกเลือกเป็นผู้ตรวจ และผู้รับผิดชอบส่งงานมาแล้ว (รอฉันอนุมัติ/ตีกลับ) */
export function MyTasksReviewPage() {
  const navigate = useNavigate()
  const { data, loading, error } = useLoad<ReviewRow[]>(() => api.get('/api/tasks/pending-review'))
  const { data: cfg } = useLoad<{ dueSoonDays: number }>(() => api.get('/api/config'))
  const tasks = data ?? []

  return (
    <>
      <PageHeader title="งานรอตรวจ" />
      <div className="p-4 sm:p-6">
        <TaskTrackingView
          tasks={tasks}
          loading={loading}
          error={error}
          onOpenTask={(id) => navigate(`/tasks/${id}`)}
          soonDays={cfg?.dueSoonDays}
          storageKey="review-tasks-view"
          dateColumnLabel="วันที่ส่งตรวจ"
          dateOf={(task) => task.submittedAt}
          emptyLabel="ยังไม่มีงานที่รอคุณตรวจ"
        />
      </div>
    </>
  )
}
