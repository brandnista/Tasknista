/* Hallmark · pre-emit critique: P4 H5 E4 S5 R5 V4 */
/** Pronista §Menu Restructure (2026-08-28) — แยกจากแท็บเดิมใน MyTasks.tsx ออกมาเป็น sub-menu ของ "งานของฉัน" (ดู Layout.tsx NAV) */
import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { PageHeader } from '../components/PageHeader'
import { TaskTrackingView, type TrackingTask } from '../components/TaskTrackingView'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/useLoad'

interface DispatchedRow extends TrackingTask {
  projectId: string | null
}

/** Pronista §My Tasks dispatcher view — งานที่ฉัน assign ให้คนอื่น ดูสถานะรวมว่าแต่ละงานไปถึงไหนแล้ว */
export function MyTasksDispatchedPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data, loading, error } = useLoad<DispatchedRow[]>(() => api.get('/api/tasks/dispatched-by-me'))
  const { data: cfg } = useLoad<{ dueSoonDays: number }>(() => api.get('/api/config'))
  // ชื่อเมนูระบุว่า "ให้คนอื่น" — endpoint กลางยังคงงานที่จ่ายให้ตัวเองไว้ให้ Daily Report ใช้ แต่หน้านี้ต้องไม่แสดง
  const tasks = useMemo(() => (data ?? []).filter((task) => !!user?.id && task.assigneeId !== user.id), [data, user?.id])

  return (
    <>
      <PageHeader title="งานที่จ่ายให้คนอื่น" />
      <div className="p-4 sm:p-6">
        <TaskTrackingView
          tasks={tasks}
          loading={loading}
          error={error}
          onOpenTask={(id) => navigate(`/tasks/${id}`)}
          soonDays={cfg?.dueSoonDays}
          storageKey="dispatched-tasks-view"
          dateColumnLabel="วันที่จ่ายงาน"
          dateOf={(task) => task.dispatchedAt}
          emptyLabel="ยังไม่มีงานที่จ่ายให้คนอื่น"
        />
      </div>
    </>
  )
}
