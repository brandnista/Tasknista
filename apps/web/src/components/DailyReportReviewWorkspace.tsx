/* Hallmark · pre-emit critique: P5 H5 E4 S5 R4 V4 · genre: modern-minimal · macrostructure: Workbench · tone: friendly-readable · designed-as-app */
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Inbox,
  MessageSquare,
  Send,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { avatarColor } from '../pages/ProjectDetail'
import { Avatar } from './Avatar'
import { DateInputTH } from './DateInputTH'
import { useDialog } from './Dialog'

type DateRangePreset = 'week' | 'month' | 'custom'
type QueueFilter = 'pending' | 'reviewed' | 'all'

interface HistoryRow {
  id: string
  reportDate: string
  status: 'draft' | 'submitted' | 'reviewed'
  userName: string | null
  userAvatarUrl: string | null
  itemCount: number
  submittedAt: number | string | null
  notes: string | null
  myReviewedAt: number | string | null
  blockerHasIssue: boolean
  blockerDetail: string | null
}

interface ReportDetail {
  id: string
  userId: string
  userName: string | null
  userAvatarUrl: string | null
  reportDate: string
  status: 'draft' | 'submitted' | 'reviewed'
  notes: string | null
  blockerHasIssue: boolean
  blockerDetail: string | null
  blockerNeedHelpFrom: string | null
  submittedAt: number | string | null
  items: {
    id: string
    taskId: string | null
    note: string | null
    manualTitle: string | null
    minutes: number
    task: { code: string | null; title: string; projectId: string | null; projectName: string | null } | null
  }[]
  comments: { id: string; userName: string | null; avatarUrl: string | null; body: string; createdAt: number | string }[]
}

const bkkToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)
const MONTHS = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

function startOfWeekTH(today = bkkToday()): string {
  const d = new Date(`${today}T00:00:00+07:00`)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}

const startOfMonthTH = (today = bkkToday()) => `${today.slice(0, 7)}-01`

function fmtDateTH(value: string): string {
  const [year, month, day] = value.split('-')
  return `${Number(day)} ${MONTHS[Number(month)]} ${Number(year) + 543}`
}

function fmtMinutes(minutes: number): string {
  if (minutes <= 0) return '—'
  if (minutes < 60) return `${minutes} นาที`
  const rest = minutes % 60
  return `${Math.floor(minutes / 60)} ชม.${rest ? ` ${rest} นาที` : ''}`
}

function fmtSentAt(value: number | string | null): string {
  if (!value) return 'ไม่พบเวลาส่ง'
  return new Date(value).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function DailyReportReviewWorkspace({ initialReportId }: { initialReportId?: string | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(initialReportId ?? null)
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('pending')
  const [rangePreset, setRangePreset] = useState<DateRangePreset>('month')
  const [customFrom, setCustomFrom] = useState(startOfMonthTH())
  const [customTo, setCustomTo] = useState(bkkToday())
  const [commentBody, setCommentBody] = useState('')
  const [commentBusy, setCommentBusy] = useState(false)
  const [editBusy, setEditBusy] = useState(false)
  const { alertDialog } = useDialog()

  const rangeFrom = rangePreset === 'week' ? startOfWeekTH() : rangePreset === 'month' ? startOfMonthTH() : customFrom
  const rangeTo = rangePreset === 'custom' ? customTo : bkkToday()
  const { data: historyData, loading: historyLoading, error: historyError, reload: reloadHistory } = useLoad<{ reports: HistoryRow[] }>(
    () => api.get(`/api/daily-reports/history?scope=received&from=${rangeFrom}&to=${rangeTo}`),
    [rangeFrom, rangeTo],
  )
  const { data: report, loading: reportLoading, error: reportError, reload: reloadReport } = useLoad<ReportDetail | null>(
    () => (selectedId ? api.get<ReportDetail>(`/api/daily-reports/${selectedId}`) : Promise.resolve(null)),
    [selectedId],
  )

  useEffect(() => {
    if (report?.id) void reloadHistory()
  }, [report?.id, reloadHistory])

  const reports = historyData?.reports ?? []
  const pendingCount = reports.filter((item) => !item.myReviewedAt).length
  const reviewedCount = reports.length - pendingCount
  const visibleReports = useMemo(() => reports.filter((item) => (
    queueFilter === 'all' || (queueFilter === 'pending' ? !item.myReviewedAt : !!item.myReviewedAt)
  )), [queueFilter, reports])
  const totalMinutes = report?.items.reduce((sum, item) => sum + item.minutes, 0) ?? 0

  const postComment = async () => {
    if (!report || !commentBody.trim() || commentBusy) return
    setCommentBusy(true)
    try {
      await api.post(`/api/daily-reports/${report.id}/comments`, { body: commentBody.trim() })
      setCommentBody('')
      await reloadReport()
    } catch (error) {
      await alertDialog({ title: error instanceof ApiError ? error.message : 'ส่งความเห็นไม่สำเร็จ' })
    } finally {
      setCommentBusy(false)
    }
  }

  const requestEdit = async () => {
    if (!report || editBusy) return
    setEditBusy(true)
    try {
      await api.post(`/api/daily-reports/${report.id}/request-edit`, {})
      await Promise.all([reloadReport(), reloadHistory()])
    } catch (error) {
      await alertDialog({ title: error instanceof ApiError ? error.message : 'ขอแก้ไขรายงานไม่สำเร็จ' })
    } finally {
      setEditBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border-subtle bg-white px-5 py-5 sm:px-6 sm:py-6 shadow-xs">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-brand-700">
              <Inbox className="h-4 w-4" /> รายงานที่ส่งถึงคุณ
            </div>
            <h1 className="min-w-0 text-2xl font-bold tracking-tight text-ink [overflow-wrap:anywhere] sm:text-[28px]">Daily Report ที่ส่งถึงคุณ</h1>
            <p className="mt-2 text-sm leading-6 text-dim">ไล่อ่านความคืบหน้า เห็นสิ่งที่ติดขัด และคุยต่อกับเจ้าของรายงานได้จากหน้าเดียว</p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-divider overflow-hidden rounded-xl bg-hover xl:min-w-[430px]">
            {[
              { label: 'รอตรวจ', value: pendingCount, tone: 'text-brand-700' },
              { label: 'ตรวจแล้ว', value: reviewedCount, tone: 'text-success-700' },
              { label: 'ทั้งหมด', value: reports.length, tone: 'text-ink' },
            ].map(({ label, value, tone }) => (
              <div key={label} className="px-3 py-4 text-center sm:px-5 sm:text-left">
                <div className="text-2xl font-bold tabular-nums text-ink">{value}</div>
                <div className={`mt-1 text-xs font-medium ${tone}`}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border-subtle bg-white shadow-xs">
        <div className="flex flex-col gap-3 border-b border-divider px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex w-full gap-1 rounded-xl bg-hover p-1 sm:w-fit" role="tablist" aria-label="กรองสถานะรายงาน">
            {([
              ['pending', 'รอตรวจ', pendingCount],
              ['reviewed', 'ตรวจแล้ว', reviewedCount],
              ['all', 'ทั้งหมด', reports.length],
            ] as const).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={queueFilter === value}
                onClick={() => setQueueFilter(value)}
                className={`min-w-0 flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-brand-500 sm:flex-none ${queueFilter === value ? 'bg-white text-ink shadow-xs' : 'text-dim hover:text-body'}`}
              >
                {label} <span className="ml-1 tabular-nums text-muted">{count}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {(['week', 'month', 'custom'] as DateRangePreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setRangePreset(preset)}
                className={`whitespace-nowrap rounded-lg px-2.5 py-2 font-medium focus-visible:outline-2 focus-visible:outline-brand-500 ${rangePreset === preset ? 'bg-brand-50 text-brand-700' : 'text-dim hover:bg-hover'}`}
              >
                {preset === 'week' ? 'สัปดาห์นี้' : preset === 'month' ? 'เดือนนี้' : 'กำหนดเอง'}
              </button>
            ))}
            {rangePreset === 'custom' && (
              <div className="mt-1 flex w-full items-center gap-1.5 sm:mt-0 sm:w-auto">
                <DateInputTH value={customFrom} onChange={setCustomFrom} className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-white px-2 text-xs sm:w-28" />
                <span className="text-muted">–</span>
                <DateInputTH value={customTo} onChange={setCustomTo} className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-white px-2 text-xs sm:w-28" />
              </div>
            )}
          </div>
        </div>

        <div className="grid min-h-[610px] grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className={`${selectedId ? 'hidden lg:block' : 'block'} border-divider lg:border-r`} aria-label="คิว Daily Report">
            {historyLoading ? (
              <div className="p-5 text-sm text-muted">กำลังโหลดคิวรายงาน…</div>
            ) : historyError ? (
              <div className="m-4 rounded-xl bg-danger-50 p-4 text-sm text-danger-700">โหลดรายงานไม่สำเร็จ กรุณาลองใหม่</div>
            ) : visibleReports.length === 0 ? (
              <div className="grid min-h-[420px] place-items-center p-8 text-center">
                <div>
                  <CheckCircle2 className="mx-auto h-8 w-8 text-success-500" />
                  <div className="mt-3 text-sm font-semibold text-strong">ไม่มีรายงานในคิวนี้</div>
                  <div className="mt-1 text-xs leading-5 text-muted">เปลี่ยนช่วงวันที่หรือเลือกดูรายงานทั้งหมดได้</div>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-divider">
                {visibleReports.map((item) => {
                  const unread = !item.myReviewedAt
                  const selected = selectedId === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={`group w-full px-4 py-4 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 ${selected ? 'bg-brand-50' : 'hover:bg-hover'} ${unread ? 'bg-brand-50/40' : 'bg-white'}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="relative shrink-0">
                          <Avatar name={item.userName ?? '—'} avatarUrl={item.userAvatarUrl} className="h-10 w-10 text-xs" colorClass={avatarColor(item.userName ?? '—')} />
                          {unread && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-600" aria-label="ยังไม่อ่าน" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className={`truncate text-sm ${unread ? 'font-bold text-ink' : 'font-semibold text-strong'}`}>{item.userName ?? 'ไม่พบชื่อ'}</span>
                            <span className="shrink-0 text-[10.5px] tabular-nums text-muted">{fmtSentAt(item.submittedAt)}</span>
                          </div>
                          <div className="mt-1 text-xs font-medium text-body">{fmtDateTH(item.reportDate)} · {item.itemCount} งาน</div>
                          <div className="mt-2 flex items-center gap-1.5">
                            {item.blockerHasIssue ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-danger-50 px-2 py-1 text-[10.5px] font-semibold text-danger-700"><AlertTriangle className="h-3 w-3" /> มี Blocker</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-1 text-[10.5px] font-semibold text-success-700"><CheckCircle2 className="h-3 w-3" /> ไม่มี Blocker</span>
                            )}
                            <span className="truncate text-[10.5px] text-muted">{item.notes?.trim() || item.blockerDetail?.trim() || 'ไม่มีหมายเหตุเพิ่มเติม'}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </aside>

          <main className={`${selectedId ? 'block' : 'hidden lg:block'} min-w-0 bg-hover/40`}>
            {!selectedId ? (
              <div className="grid min-h-[610px] place-items-center px-8 text-center">
                <div className="max-w-sm">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-border-subtle bg-white text-brand-600 shadow-xs"><FileText className="h-5 w-5" /></div>
                  <h2 className="mt-4 text-base font-bold text-ink">เลือกรายงานที่ต้องการอ่าน</h2>
                  <p className="mt-1.5 text-sm leading-6 text-muted">รายงานจะถูกนับว่าอ่านแล้วเมื่อคุณเปิดดูรายละเอียด</p>
                </div>
              </div>
            ) : reportLoading ? (
              <div className="p-6 text-sm text-muted">กำลังเปิดรายงาน…</div>
            ) : reportError || !report ? (
              <div className="m-5 rounded-xl bg-danger-50 p-4 text-sm text-danger-700">เปิดรายงานไม่สำเร็จ กรุณาลองใหม่</div>
            ) : (
              <div className="p-4 sm:p-6">
                <button type="button" onClick={() => setSelectedId(null)} className="mb-4 inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-dim hover:text-body focus-visible:outline-2 focus-visible:outline-brand-500 lg:hidden">
                  <ArrowLeft className="h-4 w-4" /> กลับไปที่คิวรายงาน
                </button>

                <article className="mx-auto max-w-3xl space-y-4">
                  <header className="rounded-2xl border border-border-subtle bg-white p-5 sm:p-6 shadow-xs">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={report.userName ?? '—'} avatarUrl={report.userAvatarUrl} className="h-11 w-11 text-sm shrink-0" colorClass={avatarColor(report.userName ?? '—')} />
                        <div className="min-w-0">
                          <div className="truncate text-base font-bold text-ink">{report.userName ?? 'ไม่พบชื่อ'}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted"><CalendarDays className="h-3.5 w-3.5" /> Daily Report · {fmtDateTH(report.reportDate)}</div>
                        </div>
                      </div>
                      <span className="w-fit whitespace-nowrap rounded-full bg-success-50 px-2.5 py-1 text-[11px] font-semibold text-success-700">เปิดอ่านแล้ว</span>
                    </div>
                    <div className="mt-5 grid grid-cols-3 divide-x divide-divider border-t border-divider pt-4">
                      <div className="pr-3"><div className="text-[11px] text-muted">งานที่ทำ</div><div className="mt-1 text-lg font-bold tabular-nums text-ink">{report.items.length}</div></div>
                      <div className="px-3"><div className="text-[11px] text-muted">เวลารวม</div><div className="mt-1 text-sm font-bold tabular-nums text-ink sm:text-lg">{fmtMinutes(totalMinutes)}</div></div>
                      <div className="pl-3"><div className="text-[11px] text-muted">Blocker</div><div className={`mt-1 text-sm font-bold sm:text-lg ${report.blockerHasIssue ? 'text-danger-600' : 'text-success-700'}`}>{report.blockerHasIssue ? 'มี' : 'ไม่มี'}</div></div>
                    </div>
                  </header>

                  {report.blockerHasIssue && (
                    <section className="rounded-2xl border border-danger-100 bg-danger-50 p-5">
                      <div className="flex gap-3">
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-danger-600"><AlertTriangle className="h-4.5 w-4.5" /></div>
                        <div className="min-w-0">
                          <h2 className="text-sm font-bold text-danger-800">เรื่องที่ต้องช่วยดู</h2>
                          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-danger-700">{report.blockerDetail || 'ผู้ส่งระบุว่ามี Blocker แต่ยังไม่ได้ใส่รายละเอียด'}</p>
                          {report.blockerNeedHelpFrom && <div className="mt-2 text-xs font-semibold text-danger-700">ต้องการความช่วยเหลือจาก: {report.blockerNeedHelpFrom}</div>}
                        </div>
                      </div>
                    </section>
                  )}

                  <section className="overflow-hidden rounded-2xl border border-border-subtle bg-white shadow-xs">
                    <div className="flex items-center justify-between border-b border-divider px-5 py-4">
                      <div><h2 className="text-sm font-bold text-ink">งานที่ทำวันนี้</h2><p className="mt-0.5 text-xs text-muted">{report.items.length} รายการ</p></div>
                      <Clock3 className="h-4 w-4 text-muted" />
                    </div>
                    {report.items.length === 0 ? (
                      <div className="px-5 py-8 text-center text-sm text-muted">ไม่มีรายการงานในรายงานนี้</div>
                    ) : (
                      <div className="divide-y divide-divider">
                        {report.items.map((item) => (
                          <div key={item.id} className="flex items-start gap-4 px-5 py-4">
                            <div className="min-w-0 flex-1">
                              {item.task?.projectId && item.taskId ? (
                                <a href={`/projects/${item.task.projectId}?task=${item.taskId}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-strong hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
                                  {item.task.code ? `${item.task.code} · ` : ''}{item.task.title}
                                </a>
                              ) : (
                                <div className="text-sm font-semibold text-strong">{item.task?.title || item.manualTitle || 'งานที่คีย์เอง'}</div>
                              )}
                              {item.task?.projectName && <div className="mt-1 text-[11px] text-muted">{item.task.projectName}</div>}
                              {item.note && <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-soft">{item.note}</p>}
                            </div>
                            <span className="shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums text-dim">{fmtMinutes(item.minutes)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {report.notes && (
                    <section className="rounded-2xl border border-border-subtle bg-white p-5 shadow-xs">
                      <h2 className="text-sm font-bold text-ink">หมายเหตุเพิ่มเติม</h2>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-body">{report.notes}</p>
                    </section>
                  )}

                  <section className="rounded-2xl border border-border-subtle bg-white p-5 shadow-xs">
                    <div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-dim" /><h2 className="text-sm font-bold text-ink">พูดคุยต่อจากรายงาน</h2></div>
                    {report.comments.length === 0 ? (
                      <div className="mt-4 rounded-xl bg-hover px-4 py-3 text-sm text-muted">ยังไม่มีความเห็น คุณสามารถเริ่มบทสนทนาได้ด้านล่าง</div>
                    ) : (
                      <div className="mt-4 space-y-4">
                        {report.comments.map((comment) => (
                          <div key={comment.id} className="flex gap-2.5">
                            <Avatar name={comment.userName ?? '—'} avatarUrl={comment.avatarUrl} className="h-8 w-8 shrink-0 text-[10px]" colorClass={avatarColor(comment.userName ?? '—')} />
                            <div className="min-w-0">
                              <div className="rounded-xl rounded-tl-sm bg-hover px-3.5 py-2.5 text-sm leading-5 text-body"><b className="text-strong">{comment.userName ?? 'ไม่พบชื่อ'}</b><br />{comment.body}</div>
                              <div className="ml-1 mt-1 text-[10.5px] text-muted">{new Date(comment.createdAt).toLocaleString('th-TH')}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-4 flex gap-2 border-t border-divider pt-4">
                      <input
                        value={commentBody}
                        onChange={(event) => setCommentBody(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter') void postComment() }}
                        placeholder="เขียนความเห็นหรือถามต่อ…"
                        className="min-w-0 flex-1 rounded-xl border border-border-subtle bg-hover px-3.5 py-2.5 text-sm outline-hidden focus-visible:border-brand-500 focus-visible:bg-white focus-visible:outline-2 focus-visible:outline-brand-500"
                      />
                      <button type="button" onClick={() => void postComment()} disabled={!commentBody.trim() || commentBusy} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:bg-border disabled:text-muted" aria-label="ส่งความเห็น">
                        <Send className="h-4 w-4" />
                      </button>
                    </div>
                  </section>

                  <div className="flex justify-end">
                    <button type="button" onClick={() => void requestEdit()} disabled={editBusy} className="whitespace-nowrap rounded-xl border border-border bg-white px-4 py-2.5 text-xs font-semibold text-body hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-50">
                      {editBusy ? 'กำลังดำเนินการ…' : 'ส่งกลับให้แก้ไขรายงาน'}
                    </button>
                  </div>
                </article>
              </div>
            )}
          </main>
        </div>
      </section>
    </div>
  )
}
