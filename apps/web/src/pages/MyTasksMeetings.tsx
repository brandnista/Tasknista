/** Pronista §Menu Restructure (2026-08-28) — แยกจากแท็บเดิมใน MyTasks.tsx ออกมาเป็น sub-menu ของ "งานของฉัน" (ดู Layout.tsx NAV) */
import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { MeetingsTab } from '../components/MeetingsTab'
import { PageHeader } from '../components/PageHeader'
import { useNotifications } from '../lib/notifications-context'

export function MyTasksMeetingsPage() {
  const [searchParams] = useSearchParams()
  // Pronista §Notification Badge Audit เฟส 6a (2026-09-24) — เข้าเมนู "การประชุม" แล้วเคลียร์ badge ทันที
  // หมายเหตุ: meeting_scheduled อยู่ใน TEAM_NOTIFICATION_TYPES ด้วย (Layout.tsx) — เคลียร์ที่นี่จะเคลียร์ badge ฝั่ง "ทีม" ของ type นี้ไปด้วยโดยธรรมชาติ ถือว่าถูกต้อง เพราะเดิม Team chat mark-read ไม่เคยครอบคลุม type นี้เลย
  const { markTypeRead } = useNotifications()
  useEffect(() => {
    void markTypeRead('meeting_scheduled')
    void markTypeRead('meeting_updated')
    void markTypeRead('meeting_cancelled')
    void markTypeRead('meeting_reminder')
  }, [markTypeRead])
  return (
    <>
      <PageHeader title="การประชุม" />
      <div className="p-4 sm:p-6">
        <MeetingsTab initialMeetingId={searchParams.get('meeting') ?? undefined} />
      </div>
    </>
  )
}
