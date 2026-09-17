/** Pronista §Daily Report center — เมนูหลักหน้าเดียว แยก "รายงานของฉัน" กับ "รายงานที่ได้รับ" ตามความสัมพันธ์ผู้ส่ง/ผู้รับ ไม่ผูก role หัวหน้า */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { DailyReportTab } from '../components/DailyReportTab'
import { DailyReportReviewWorkspace } from '../components/DailyReportReviewWorkspace'
import { PageHeader } from '../components/PageHeader'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'

type DailyReportView = 'mine' | 'received'

export function MyTasksDailyReportPage() {
  const [searchParams] = useSearchParams()
  const initialReportId = searchParams.get('report')
  const [view, setView] = useState<DailyReportView | null>(initialReportId ? 'received' : null)
  const { data: receivedData } = useLoad<{ reports: { myReviewedAt: number | string | null }[] }>(
    () => api.get('/api/daily-reports/history?scope=received'),
    [],
  )
  const pendingCount = (receivedData?.reports ?? []).filter((report) => !report.myReviewedAt).length

  useEffect(() => {
    if (view === null && receivedData) setView(pendingCount > 0 ? 'received' : 'mine')
  }, [pendingCount, receivedData, view])

  return (
    <>
      <PageHeader title="Daily Report" />
      <div className="p-4 sm:p-6">
        <div className="mb-5 flex w-full gap-1 rounded-xl border border-border-subtle bg-white p-1 shadow-xs sm:w-fit" role="tablist" aria-label="ประเภท Daily Report">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'mine'}
            onClick={() => setView('mine')}
            className={`flex-1 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-brand-500 sm:flex-none ${view === 'mine' ? 'bg-brand-50 text-brand-700' : 'text-dim hover:bg-hover hover:text-body'}`}
          >
            รายงานของฉัน
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'received'}
            onClick={() => setView('received')}
            className={`flex-1 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-brand-500 sm:flex-none ${view === 'received' ? 'bg-brand-50 text-brand-700' : 'text-dim hover:bg-hover hover:text-body'}`}
          >
            รายงานที่ได้รับ
            {pendingCount > 0 && <span className="ml-2 rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] text-white tabular-nums">{pendingCount}</span>}
          </button>
        </div>

        {view === null ? (
          <div className="rounded-xl border border-border-subtle bg-white px-5 py-10 text-center text-sm text-muted">กำลังโหลด Daily Report…</div>
        ) : view === 'received' ? (
          <DailyReportReviewWorkspace initialReportId={initialReportId} />
        ) : (
          <DailyReportTab />
        )}
      </div>
    </>
  )
}
