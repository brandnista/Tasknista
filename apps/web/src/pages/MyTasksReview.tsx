/** Pronista §Menu Restructure (2026-09-18) — แยกจากแท็บ "งานรอตรวจของฉัน" เดิมใน MyTasks.tsx ออกมาเป็น sub-menu ของ "งานของฉัน" (ดู Layout.tsx NAV) */
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { PageHeader } from '../components/PageHeader'
import { TaskTrackingView, type TrackingTask } from '../components/TaskTrackingView'
import { api } from '../lib/api'
import { useNotifications } from '../lib/notifications-context'
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
  // Pronista §Notification Badge Audit เฟส 6a (2026-09-24) — เข้าเมนู "งานรอตรวจ" แล้วเคลียร์ badge ทันที
  // (2026-09-25) + มาร์คงานรอตรวจทั้งหมดว่า "เห็นแล้ว" → เลข badge งานรอตรวจลดเป็น 0 ทันทีที่เข้าเมนู (งานยังอยู่ใน list จนกว่าจะอนุมัติ/ตีกลับ)
  const { markTypeRead, markReviewSeen } = useNotifications()
  useEffect(() => { void markTypeRead('task_review_requested'); void markReviewSeen() }, [markTypeRead, markReviewSeen])

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
