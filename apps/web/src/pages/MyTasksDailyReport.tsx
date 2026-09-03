/** Pronista §Menu Restructure (2026-08-28) — แยกจากแท็บเดิมใน MyTasks.tsx ออกมาเป็น sub-menu ของ "งานของฉัน" (ดู Layout.tsx NAV) */
import { useSearchParams } from 'react-router'
import { DailyReportTab } from '../components/DailyReportTab'
import { PageHeader } from '../components/PageHeader'

export function MyTasksDailyReportPage() {
  const [searchParams] = useSearchParams()
  return (
    <>
      <PageHeader title="Daily Report" />
      <div className="p-4 sm:p-6">
        <DailyReportTab initialReportId={searchParams.get('report')} />
      </div>
    </>
  )
}
