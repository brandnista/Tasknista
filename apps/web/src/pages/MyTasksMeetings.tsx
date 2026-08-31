/** Pronista §Menu Restructure (2026-08-28) — แยกจากแท็บเดิมใน MyTasks.tsx ออกมาเป็น sub-menu ของ "งานของฉัน" (ดู Layout.tsx NAV) */
import { useSearchParams } from 'react-router'
import { MeetingsTab } from '../components/MeetingsTab'
import { PageHeader } from '../components/PageHeader'

export function MyTasksMeetingsPage() {
  const [searchParams] = useSearchParams()
  return (
    <>
      <PageHeader title="การประชุม" />
      <div className="p-3 sm:p-6">
        <MeetingsTab initialMeetingId={searchParams.get('meeting') ?? undefined} />
      </div>
    </>
  )
}
