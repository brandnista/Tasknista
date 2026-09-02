/**
 * Pronista §Daily Report — แท็บที่ 4 ของ "งานของฉัน" ให้พนักงานรวบรวมงานที่ทำวันนี้ (ดึงจาก activity จริง หรือคีย์เอง)
 * ส่งให้หัวหน้าที่เลือกทุกครั้งตอนกดส่ง แทนอีเมล — Draft → Submitted → Reviewed (auto flip ตอนหัวหน้าเปิดอ่าน)
 * แก้ไขได้ตลอดจนกว่าจะ Reviewed (submit ไม่ล็อกการแก้ไข แค่แจ้งเตือน+ให้หัวหน้าเห็น)
 * มี 2 โหมดภายในแท็บ: "วันนี้/แก้ไข" (แก้รายงานของตัวเอง — งานแนะนำ+คีย์เองรวมลิสต์เดียว) กับ "ประวัติ" (ดูย้อนหลัง ทั้งของฉัน/ที่ได้รับ)
 */
import { AlertTriangle, Calendar, Check, History as HistoryIcon, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Avatar } from './Avatar'
import { DateInputTH } from './DateInputTH'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { avatarColor } from '../pages/ProjectDetail'
import { TASK_STATUS_BADGE, TASK_STATUS_LABEL } from '../lib/task-status'
import { useLoad } from '../lib/useLoad'

const bkkToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)
const MONTHS = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
const MONTHS_SHORT = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const fmtDateTH = (d: string) => {
  const [y, m, day] = d.split('-')
  return `${Number(day)} ${MONTHS[Number(m)]} ${Number(y) + 543}`
}
const fmtMinutes = (min: number) => (min <= 0 ? '—' : min < 60 ? `${min} น.` : `${Math.floor(min / 60)}ชม. ${min % 60 ? `${min % 60}น.` : ''}`.trim())
/** Pronista §Daily Report Gmail-style inbox — คอลัมน์วันที่ขวาสุดของแถว: ถ้าเป็นวันนี้โชว์เวลาที่ส่ง ไม่งั้นโชว์วันที่สั้นๆ (เหมือน Gmail)
 * submittedAt มาจาก API เป็น ISO string (Date ผ่าน JSON) ไม่ใช่ epoch ms ดิบ — ต้องผ่าน new Date() ก่อนเสมอ (ตรงกับ fmtUpdated ใน Docs.tsx) */
function fmtInboxDate(dateStr: string, submittedAt: number | string | null): string {
  if (dateStr === bkkToday() && submittedAt) {
    const bkk = new Date(new Date(submittedAt).getTime() + 7 * 3_600_000)
    return `${String(bkk.getUTCHours()).padStart(2, '0')}:${String(bkk.getUTCMinutes()).padStart(2, '0')}`
  }
  const [, m, d] = dateStr.split('-')
  return `${Number(d)} ${MONTHS_SHORT[Number(m)]}`
}

const STATUS_LABEL: Record<'draft' | 'submitted' | 'reviewed', string> = { draft: 'Draft', submitted: 'Submitted', reviewed: 'Reviewed' }
const STATUS_BADGE: Record<'draft' | 'submitted' | 'reviewed', string> = {
  draft: 'bg-divider text-dim',
  submitted: 'bg-info-50 text-info-700',
  reviewed: 'bg-success-100 text-success-700',
}

interface MyTask { id: string; code: string | null; title: string; status: string; projectId: string | null; projectName: string | null }
interface ReportItem {
  id: string
  taskId: string | null
  note: string | null
  manualTitle: string | null
  manualMinutes: number | null
  minutes: number
  task: { id: string; code: string | null; title: string; status: string; projectId: string | null; projectName: string | null } | null
}
interface ReportComment { id: string; userId: string; userName: string | null; avatarUrl: string | null; body: string; createdAt: number }
interface ReportRecipient { id: string; name: string | null; avatarUrl: string | null; reviewedAt: number | null }
interface ReportDetail {
  id: string
  userId: string
  userName: string | null
  userAvatarUrl: string | null
  reportDate: string
  recipientId: string | null
  recipientName: string | null
  recipients: ReportRecipient[]
  status: 'draft' | 'submitted' | 'reviewed'
  notes: string | null
  blockerHasIssue: boolean
  blockerDetail: string | null
  blockerNeedHelpFrom: string | null
  submittedAt: number | null
  reviewedAt: number | null
  items: ReportItem[]
  comments: ReportComment[]
}
// Pronista §Daily Report Gmail-style inbox (2026-09-02) — recipients[] แทน recipientName เดี่ยว + myReviewedAt (เฉพาะ scope=received) ใช้ตัดสินตัวหนา=ยังไม่อ่าน
interface HistoryRow {
  id: string
  reportDate: string
  status: 'draft' | 'submitted' | 'reviewed'
  userName: string | null
  userAvatarUrl: string | null
  recipients: { id: string; name: string | null }[]
  itemCount: number
  submittedAt: number | string | null
  notes: string | null
  myReviewedAt: number | null
}
interface Recipient { id: string; name: string }

type DateRangePreset = 'week' | 'month' | 'custom'
/** Asia/Bangkok "วันนี้" → จุดเริ่มสัปดาห์ (จันทร์) เป็น YYYY-MM-DD */
function startOfWeekTH(today = bkkToday()): string {
  const d = new Date(`${today}T00:00:00+07:00`)
  const day = (d.getUTCDay() + 6) % 7 // จันทร์=0
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}
function startOfMonthTH(today = bkkToday()): string {
  return `${today.slice(0, 7)}-01`
}

function TaskLink({ projectId, taskId, code, title }: { projectId: string | null; taskId: string; code: string | null; title: string }) {
  if (!projectId) return <span className="text-[13.5px] text-strong font-medium truncate">{code ?? title}</span>
  return (
    <a
      href={`/projects/${projectId}?task=${taskId}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-[13.5px] text-strong font-medium truncate hover:text-brand-700 hover:underline"
      title={title}
    >
      {code ?? title}
    </a>
  )
}

export function DailyReportTab({ initialReportId }: { initialReportId?: string | null }) {
  const { user } = useAuth()
  const [mode, setMode] = useState<'today' | 'history'>('today')
  const [date, setDate] = useState(bkkToday())
  const [openId, setOpenId] = useState<string | null>(initialReportId ?? null)
  const [historyScope, setHistoryScope] = useState<'mine' | 'received'>('mine')
  const [rangePreset, setRangePreset] = useState<DateRangePreset>('month')
  const [customFrom, setCustomFrom] = useState(startOfMonthTH())
  const [customTo, setCustomTo] = useState(bkkToday())
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [submitRecipientIds, setSubmitRecipientIds] = useState<Set<string>>(new Set())
  const [justSubmitted, setJustSubmitted] = useState<string[] | null>(null) // ชื่อผู้รับที่เพิ่งส่งสำเร็จ — โชว์หน้ายืนยันสั้นๆ
  const [commentBody, setCommentBody] = useState('')
  const [error, setError] = useState('')
  const [manualTitle, setManualTitle] = useState('')
  const [manualHours, setManualHours] = useState('')

  const { data: report, reload: reloadReport } = useLoad<ReportDetail | null>(async () => {
    if (openId) return api.get<ReportDetail>(`/api/daily-reports/${openId}`)
    const res = await api.get<{ report: ReportDetail | null }>(`/api/daily-reports?date=${date}`)
    return res.report
  }, [openId, date])

  const isOwner = !!report && report.userId === user?.id
  // แก้ไขได้ตลอด ตราบใดที่ยังไม่ถึง reviewed (หัวหน้าเปิดอ่านแล้ว) — submit ไม่ล็อก
  const canEditNow = !report || (isOwner && report.status !== 'reviewed')
  const isLocked = !!report && report.status === 'reviewed'

  // Pronista §Daily Report (ต่อยอด) — ฝั่งซ้ายดึง "งานทั้งหมด" ของตัวเองมาให้เลือก ไม่จำกัดแค่ activity วันนี้เหมือนเดิม
  const { data: myTasks, reload: reloadMyTasks } = useLoad<MyTask[]>(
    () => (canEditNow ? api.get('/api/tasks/mine') : Promise.resolve([])),
    [canEditNow],
  )
  // Pronista §Daily Report Gmail-style inbox — ตัวกรองช่วงวันที่ (สัปดาห์/เดือน/กำหนดเอง) คำนวณ from/to ฝั่ง frontend แล้วส่งให้ /history
  const rangeFrom = rangePreset === 'week' ? startOfWeekTH() : rangePreset === 'month' ? startOfMonthTH() : customFrom
  const rangeTo = rangePreset === 'custom' ? customTo : bkkToday()
  const { data: historyData, reload: reloadHistory } = useLoad<{ reports: HistoryRow[] }>(
    () => (mode === 'history' ? api.get(`/api/daily-reports/history?scope=${historyScope}&from=${rangeFrom}&to=${rangeTo}`) : Promise.resolve({ reports: [] })),
    [mode, historyScope, rangeFrom, rangeTo],
  )
  const { data: recipients } = useLoad<{ recipients: Recipient[] }>(() => api.get('/api/daily-reports/recipients'), [])

  const ensureReport = async (): Promise<ReportDetail> => {
    if (report) return report
    try {
      const created = await api.post<ReportDetail>('/api/daily-reports', { date })
      setOpenId(created.id)
      return created
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'สร้างรายงานไม่สำเร็จ')
      throw e
    }
  }

  const addItem = async (taskId: string) => {
    setError('')
    const r = await ensureReport().catch(() => null)
    if (!r) return
    await api.post(`/api/daily-reports/${r.id}/items`, { taskId })
    await reloadReport()
  }
  const addManualItem = async () => {
    if (!manualTitle.trim()) return
    setError('')
    const r = await ensureReport().catch(() => null)
    if (!r) return
    const hours = Number(manualHours)
    await api.post(`/api/daily-reports/${r.id}/items`, { manualTitle: manualTitle.trim(), manualMinutes: Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : 0 })
    setManualTitle('')
    setManualHours('')
    await reloadReport()
  }
  const updateItemNote = async (itemId: string, note: string) => {
    if (!report) return
    await api.patch(`/api/daily-reports/${report.id}/items/${itemId}`, { note: note || null })
  }
  const removeItem = async (itemId: string) => {
    if (!report) return
    await api.delete(`/api/daily-reports/${report.id}/items/${itemId}`)
    await reloadReport()
  }
  const removeItemByTaskId = async (taskId: string) => {
    const it = (report?.items ?? []).find((x) => x.taskId === taskId)
    if (it) await removeItem(it.id)
  }
  const saveMeta = async (patch: Partial<Pick<ReportDetail, 'notes' | 'blockerHasIssue' | 'blockerDetail' | 'blockerNeedHelpFrom'>>) => {
    const r = await ensureReport().catch(() => null)
    if (!r) return
    await api.patch(`/api/daily-reports/${r.id}`, patch)
    await reloadReport()
  }
  const openSubmitModal = () => {
    setSubmitRecipientIds(new Set())
    setConfirmSubmit(true)
  }
  const toggleSubmitRecipient = (id: string) => {
    setSubmitRecipientIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const doSubmit = async () => {
    if (!report || submitRecipientIds.size === 0) return
    const names = [...submitRecipientIds].map((id) => recipients?.recipients.find((r) => r.id === id)?.name).filter((n): n is string => !!n)
    await api.post(`/api/daily-reports/${report.id}/submit`, { recipientIds: [...submitRecipientIds] })
    setJustSubmitted(names)
    await reloadReport()
  }
  const requestEdit = async () => {
    if (!report) return
    await api.post(`/api/daily-reports/${report.id}/request-edit`, {})
    await reloadReport()
  }
  const postComment = async () => {
    if (!report || !commentBody.trim()) return
    await api.post(`/api/daily-reports/${report.id}/comments`, { body: commentBody.trim() })
    setCommentBody('')
    await reloadReport()
  }

  const openFromHistory = (id: string) => {
    setOpenId(id)
    setMode('today')
  }
  const backToToday = () => {
    setOpenId(null)
    setDate(bkkToday())
  }
  const scrollToStage = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const totalMinutes = (report?.items ?? []).reduce((s, it) => s + it.minutes, 0)
  const itemByTaskId = new Map<string, ReportItem>()
  for (const it of report?.items ?? []) if (it.taskId) itemByTaskId.set(it.taskId, it)
  const manualItems = (report?.items ?? []).filter((it) => !it.taskId)
  const taskItems = (report?.items ?? []).filter((it) => it.taskId && it.task)
  const myTaskCount = myTasks?.length ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex bg-divider rounded-lg p-0.5 text-sm font-medium w-fit">
          <button onClick={() => { setMode('today'); setOpenId(null) }} className={`px-3 py-1.5 rounded-md ${mode === 'today' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>วันนี้/แก้ไข</button>
          <button onClick={() => { setMode('history'); void reloadHistory() }} className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 ${mode === 'history' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>
            <HistoryIcon className="w-3.5 h-3.5" /> ประวัติ
          </button>
        </div>
      </div>

      {error && <div className="bg-danger-50 text-danger-700 text-sm px-4 py-2.5 rounded-lg">{error}</div>}

      {mode === 'history' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex bg-divider rounded-lg p-0.5 text-xs font-medium w-fit">
              <button onClick={() => setHistoryScope('mine')} className={`px-3 py-1.5 rounded-md ${historyScope === 'mine' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>รายงานของฉัน</button>
              <button onClick={() => setHistoryScope('received')} className={`px-3 py-1.5 rounded-md ${historyScope === 'received' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>รายงานที่ได้รับ</button>
            </div>
            {/* Pronista §Daily Report — ตัวกรองช่วงวันที่ สัปดาห์/เดือน/กำหนดเอง (recipient view) */}
            <div className="flex items-center gap-1.5 text-xs">
              {(['week', 'month', 'custom'] as DateRangePreset[]).map((p) => (
                <button key={p} onClick={() => setRangePreset(p)} className={`px-2.5 py-1.5 rounded-lg font-medium ${rangePreset === p ? 'bg-brand-50 text-brand-700' : 'text-dim hover:bg-hover'}`}>
                  {p === 'week' ? 'สัปดาห์นี้' : p === 'month' ? 'เดือนนี้' : 'กำหนดเอง'}
                </button>
              ))}
              {rangePreset === 'custom' && (
                <>
                  <DateInputTH value={customFrom} onChange={setCustomFrom} className="h-7 text-xs border border-border rounded-lg px-2 bg-white w-28" />
                  <span className="text-muted">–</span>
                  <DateInputTH value={customTo} onChange={setCustomTo} className="h-7 text-xs border border-border rounded-lg px-2 bg-white w-28" />
                </>
              )}
            </div>
          </div>

          {/* Pronista §Daily Report Gmail-style inbox — ตัวหนา+จุดฟ้า = ยังไม่อ่าน (scope=received เท่านั้น, เทียบจาก myReviewedAt ของฉันเอง) */}
          {(historyData?.reports ?? []).length === 0 ? (
            <div className="bg-white border border-border-subtle rounded-xl text-center text-sm text-muted py-10">ไม่พบรายงานในช่วงที่เลือก</div>
          ) : (
            <div className="bg-white border border-border-subtle rounded-xl divide-y divide-divider overflow-hidden">
              {historyData!.reports.map((r) => {
                const unread = historyScope === 'received' && !r.myReviewedAt
                const counterpartName = historyScope === 'mine' ? r.recipients.map((x) => x.name).join(', ') || '—' : (r.userName ?? '—')
                const snippet = r.notes?.trim() || `${r.itemCount} งาน`
                return (
                  <div
                    key={r.id}
                    onClick={() => openFromHistory(r.id)}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-hover transition-colors ${unread ? 'bg-brand-50/40' : 'bg-white'}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${unread ? 'bg-brand-600' : 'bg-transparent'}`} />
                    <Avatar name={counterpartName} avatarUrl={historyScope === 'received' ? r.userAvatarUrl : null} className="w-8 h-8 text-xs shrink-0" colorClass={avatarColor(counterpartName)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className={`text-[13.5px] truncate ${unread ? 'font-bold text-ink' : 'font-medium text-strong'}`}>{counterpartName}</span>
                        <span className={`shrink-0 text-[10.5px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                      </div>
                      <div className={`text-[12.5px] truncate ${unread ? 'text-body font-medium' : 'text-muted'}`}>Daily Report — {fmtDateTH(r.reportDate)} · {snippet}</div>
                    </div>
                    <span className={`shrink-0 text-[11px] tabular-nums ${unread ? 'text-brand-700 font-semibold' : 'text-muted'}`}>{fmtInboxDate(r.reportDate, r.submittedAt)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Header */}
          <div className="bg-white rounded-lg shadow-xs px-5 py-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-dim" />
              <div>
                <div className="font-bold text-ink text-[15px]">Daily Report — {fmtDateTH(report?.reportDate ?? date)}</div>
                {report && (
                  <div className="text-xs text-muted mt-0.5">
                    {isOwner ? (report.recipients.length > 0 ? `ส่งถึง ${report.recipients.map((r) => r.name).join(', ')}` : 'ยังไม่ได้เลือกผู้รับ') : `จาก ${report.userName ?? '—'}`}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {report && <span className={`text-[11px] px-2.5 py-1 rounded-full font-bold ${STATUS_BADGE[report.status]}`}>{STATUS_LABEL[report.status]}</span>}
              {openId && (
                <button onClick={backToToday} className="text-xs px-3 py-1.5 rounded-lg border border-border-subtle hover:bg-hover">สร้างรายงานใหม่ / วันนี้</button>
              )}
              {!openId && (
                <>
                  <DateInputTH value={date} onChange={setDate} className="h-8 text-xs border border-border rounded-lg px-2.5 bg-white w-32" />
                  <button onClick={() => setDate(bkkToday())} className="text-xs px-3 py-1.5 rounded-lg border border-border-subtle hover:bg-hover">วันนี้</button>
                </>
              )}
            </div>
          </div>

          {isOwner && report?.status === 'submitted' && (
            <div className="bg-info-50 text-info-700 text-xs px-4 py-2.5 rounded-lg">ส่งแล้ว — ยังแก้ไขต่อได้จนกว่าจะมีคนเปิดอ่าน ({report.recipients.map((r) => r.name).join(', ') || 'หัวหน้า'})</div>
          )}

          {/* Summary strip */}
          <div className="flex bg-white rounded-lg shadow-xs border border-border-subtle overflow-x-auto divide-x divide-divider">
            {[
              ...(canEditNow ? [{ label: 'งานทั้งหมดของฉัน', value: myTaskCount }] : []),
              { label: 'เพิ่มในรายงาน', value: report?.items.length ?? 0 },
              { label: 'เวลารวม', value: fmtMinutes(totalMinutes), raw: true },
              { label: 'สถานะ', value: report ? STATUS_LABEL[report.status] : 'ยังไม่สร้าง', raw: true },
            ].map((s) => (
              <div key={s.label} className="flex-1 min-w-[110px] px-3.5 py-2.5">
                <div className="text-[11px] text-muted whitespace-nowrap">{s.label}</div>
                <div className="text-lg font-bold leading-tight mt-0.5 text-ink tabular-nums">{s.value}</div>
              </div>
            ))}
          </div>

          {canEditNow && (
            <div className="grid grid-cols-1 md:grid-cols-[168px_minmax(0,1fr)] gap-x-9 items-start">
              {/* Progress rail */}
              <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-3 md:pb-1 mb-3 md:mb-0 border-b md:border-b-0 border-divider md:sticky md:top-4">
                {[
                  { id: 'stage-tasks', label: 'งานวันนี้', state: (report?.items.length ?? 0) > 0 ? 'filled' : 'empty' },
                  { id: 'stage-blocker', label: 'ปัญหา/Blocker', state: report?.blockerHasIssue ? 'warn' : 'filled' },
                  { id: 'stage-notes', label: 'หมายเหตุ', state: report?.notes ? 'filled' : 'empty' },
                ].map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    onClick={scrollToStage(s.id)}
                    className="flex items-center gap-2.5 text-[13px] font-medium text-dim hover:text-body hover:bg-hover px-2.5 py-2 rounded-lg shrink-0 focus-visible:outline-2 focus-visible:outline-brand-500"
                  >
                    <span className={`w-[7px] h-[7px] rounded-full border-[1.5px] shrink-0 ${s.state === 'filled' ? 'bg-brand-600 border-brand-600' : s.state === 'warn' ? 'bg-danger-600 border-danger-600' : 'border-border'}`} />
                    {s.label}
                  </a>
                ))}
                <div className="hidden md:block mt-4 pt-3.5 border-t border-divider text-[11.5px] text-muted leading-relaxed">
                  {!report || report.status === 'draft' ? 'ยังไม่ส่ง — แก้ไขได้อิสระ' : 'ส่งแล้ว — แก้ไขต่อได้จนกว่าจะถูกเปิดอ่าน'}
                </div>
              </nav>

              <div>
                {/* Stage 1 — งานวันนี้ */}
                <section id="stage-tasks" className="pb-6 border-b border-divider scroll-mt-4">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
                    <div className="flex items-center gap-2.5">
                      <span className="w-[22px] h-[22px] rounded-full bg-ink text-white text-[11px] font-bold grid place-items-center shrink-0">1</span>
                      <h2 className="text-[15px] font-bold text-ink">วันนี้ทำอะไรไปบ้าง</h2>
                    </div>
                    <button onClick={() => void reloadMyTasks()} className="text-xs flex items-center gap-1 text-dim hover:text-body shrink-0"><RefreshCw className="w-3 h-3" /></button>
                  </div>
                  <p className="text-[12.5px] text-muted ml-[32px] mb-3">เลือกจากงานทั้งหมดของคุณทางซ้าย แล้วเติมสั้นๆ ว่าทำอะไรไปวันนี้</p>

                  <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] gap-4 items-start">
                    {/* ซ้าย — งานทั้งหมดของฉัน (ไม่จำกัดแค่วันนี้) */}
                    <div className="border border-border-subtle rounded-xl overflow-hidden bg-white">
                      <div className="px-3.5 py-2.5 border-b border-divider flex items-center justify-between">
                        <span className="text-xs font-semibold text-strong">งานทั้งหมดของฉัน</span>
                        <span className="text-[11px] text-muted tabular-nums">{myTaskCount}</span>
                      </div>
                      <div className="max-h-[420px] overflow-y-auto divide-y divide-divider">
                        {myTaskCount === 0 && (
                          <div className="text-center text-xs text-muted py-8 px-3">ยังไม่มีงานที่ได้รับมอบหมาย — เพิ่มงานเองทางขวาได้เลย</div>
                        )}
                        {(myTasks ?? []).map((t) => {
                          const inReport = itemByTaskId.has(t.id)
                          return (
                            <button
                              key={t.id}
                              type="button"
                              aria-pressed={inReport}
                              onClick={() => (inReport ? void removeItemByTaskId(t.id) : void addItem(t.id))}
                              className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:-outline-offset-2"
                            >
                              <span className={`mt-0.5 w-[17px] h-[17px] rounded-md border-[1.6px] shrink-0 grid place-items-center transition-colors ${inReport ? 'bg-brand-600 border-brand-600' : 'border-border bg-white'}`}>
                                {inReport && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3.5} />}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {t.code && <span className="font-mono text-[10px] text-brand-700 bg-brand-50 px-1 py-0.5 rounded font-semibold shrink-0">{t.code}</span>}
                                  <span className="text-[12.5px] text-strong font-medium truncate">{t.title}</span>
                                </div>
                                <div className="text-[10.5px] text-muted mt-0.5 truncate">
                                  {t.projectName ?? '—'} · <span className={`px-1 py-0.5 rounded text-[10px] font-semibold ${TASK_STATUS_BADGE[t.status as keyof typeof TASK_STATUS_BADGE] ?? ''}`}>{TASK_STATUS_LABEL[t.status as keyof typeof TASK_STATUS_LABEL] ?? t.status}</span>
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* ขวา — งานที่เพิ่มในรายงานแล้ว (ผูก task จริง + คีย์เอง) */}
                    <div className="flex flex-col gap-px bg-border-subtle border border-border-subtle rounded-xl overflow-hidden">
                      {taskItems.length === 0 && manualItems.length === 0 && (
                        <div className="text-center text-sm text-muted py-8 bg-white">ยังไม่มีงานในรายงาน — ติ๊กจากซ้าย หรือเพิ่มเองด้านล่าง</div>
                      )}
                      {taskItems.map((it) => (
                        <div key={it.id} className="bg-white">
                          <div className="flex items-start gap-3 px-3.5 py-3 hover:bg-hover">
                            <button
                              type="button"
                              aria-label="เอาออกจากรายงาน"
                              onClick={() => void removeItem(it.id)}
                              className="mt-0.5 w-[19px] h-[19px] rounded-md border-[1.6px] shrink-0 grid place-items-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:outline-offset-2 bg-brand-600 border-brand-600"
                            >
                              <Check className="w-3 h-3 text-white" strokeWidth={3} />
                            </button>
                            <div className="min-w-0 flex-1 cursor-pointer" onClick={() => void removeItem(it.id)}>
                              <div className="flex items-center gap-2 flex-wrap">
                                {it.task!.code && <span className="font-mono text-[11px] text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded font-semibold shrink-0">{it.task!.code}</span>}
                                <TaskLink projectId={it.task!.projectId} taskId={it.taskId!} code={null} title={it.task!.title} />
                              </div>
                              <div className="text-[11.5px] text-muted mt-0.5">
                                {it.task!.projectName ?? '—'} · <span className={`px-1 py-0.5 rounded text-[10.5px] font-semibold ${TASK_STATUS_BADGE[it.task!.status as keyof typeof TASK_STATUS_BADGE] ?? ''}`}>{TASK_STATUS_LABEL[it.task!.status as keyof typeof TASK_STATUS_LABEL] ?? it.task!.status}</span>
                              </div>
                            </div>
                            <span className="text-xs text-dim tabular-nums shrink-0 pt-0.5">{fmtMinutes(it.minutes)}</span>
                          </div>
                          <div className="px-3.5 pb-3.5 pl-[46px]">
                            <textarea
                              defaultValue={it.note ?? ''}
                              onBlur={(e) => void updateItemNote(it.id, e.target.value)}
                              placeholder="สิ่งที่ทำวันนี้..."
                              rows={2}
                              className="w-full text-sm bg-hover rounded-lg px-3 py-2 outline-hidden focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:bg-white"
                            />
                          </div>
                        </div>
                      ))}
                      {manualItems.map((it) => (
                        <div key={it.id} className="flex items-start gap-3 px-3.5 py-3 hover:bg-hover bg-white">
                          <span className="mt-0.5 w-[19px] h-[19px] rounded-md border-[1.6px] border-brand-600 bg-brand-600 shrink-0 grid place-items-center">
                            <Check className="w-3 h-3 text-white" strokeWidth={3} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13.5px] text-strong font-medium">{it.manualTitle}</div>
                            <div className="text-[11.5px] text-muted mt-0.5">คีย์เอง</div>
                          </div>
                          <span className="text-xs text-dim tabular-nums shrink-0 pt-0.5">{fmtMinutes(it.minutes)}</span>
                          <button onClick={() => void removeItem(it.id)} className="text-border hover:text-danger-600 shrink-0" aria-label="ลบ"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      ))}
                      <div className="flex gap-2 p-3 bg-white">
                        <input
                          value={manualTitle}
                          onChange={(e) => setManualTitle(e.target.value)}
                          placeholder="เพิ่มงานเอง เช่น ประชุมกับลูกค้า..."
                          className="flex-1 min-w-[140px] border border-dashed border-border rounded-lg px-3 py-2.5 text-sm bg-transparent placeholder:text-muted outline-hidden focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:border-solid"
                        />
                        <input
                          value={manualHours}
                          onChange={(e) => setManualHours(e.target.value)}
                          type="number"
                          min="0"
                          step="0.5"
                          placeholder="ชม."
                          className="w-20 border border-border-subtle rounded-lg px-3 py-2.5 text-sm bg-hover outline-hidden focus-visible:outline-2 focus-visible:outline-brand-500"
                        />
                        <button onClick={() => void addManualItem()} className="text-xs font-semibold px-3.5 rounded-lg border border-border-subtle bg-white hover:bg-hover text-soft shrink-0 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> เพิ่ม</button>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Stage 2 — Blocker */}
                <section id="stage-blocker" className="py-6 border-b border-divider scroll-mt-4">
                  <div className="flex items-center gap-2.5 mb-1">
                    <span className="w-[22px] h-[22px] rounded-full bg-ink text-white text-[11px] font-bold grid place-items-center shrink-0">2</span>
                    <h2 className="text-[15px] font-bold text-ink">ติดขัดอะไรไหม</h2>
                  </div>
                  <p className="text-[12.5px] text-muted ml-[32px] mb-3">บอกตรงๆ ได้ — ไม่ต้องรอถึงประชุม</p>
                  <div className="bg-white border border-border-subtle rounded-xl px-4 py-3.5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2.5 text-[13.5px] text-strong font-medium">
                      <AlertTriangle className="w-[17px] h-[17px] text-warning-500 shrink-0" />
                      มีปัญหา / ติด Blocker วันนี้
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!!report?.blockerHasIssue}
                      onClick={() => void saveMeta({ blockerHasIssue: !(report?.blockerHasIssue ?? false) })}
                      className={`relative w-[38px] h-[22px] rounded-full shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:outline-offset-2 ${report?.blockerHasIssue ? 'bg-danger-600' : 'bg-border'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow-xs transition-transform ${report?.blockerHasIssue ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                  {report?.blockerHasIssue && (
                    <div className="mt-3 bg-danger-50 border border-danger-100 rounded-xl px-4 py-3.5 space-y-2.5">
                      <div>
                        <div className="text-[11.5px] font-semibold text-danger-700 uppercase tracking-wide mb-1">รายละเอียด</div>
                        <textarea
                          defaultValue={report.blockerDetail ?? ''}
                          onBlur={(e) => void saveMeta({ blockerDetail: e.target.value })}
                          rows={2}
                          className="w-full text-[13.5px] border border-border-subtle bg-white rounded-lg px-2.5 py-2 outline-hidden focus-visible:outline-2 focus-visible:outline-brand-500"
                        />
                      </div>
                      <div>
                        <div className="text-[11.5px] font-semibold text-danger-700 uppercase tracking-wide mb-1">ต้องการความช่วยเหลือจาก</div>
                        <input
                          defaultValue={report.blockerNeedHelpFrom ?? ''}
                          onBlur={(e) => void saveMeta({ blockerNeedHelpFrom: e.target.value })}
                          placeholder="เช่น PM / หัวหน้า / ทีม Backend"
                          className="w-full text-[13.5px] border border-border-subtle bg-white rounded-lg px-2.5 py-2 outline-hidden focus-visible:outline-2 focus-visible:outline-brand-500"
                        />
                      </div>
                    </div>
                  )}
                </section>

                {/* Stage 3 — หมายเหตุ */}
                <section id="stage-notes" className="py-6 scroll-mt-4">
                  <div className="flex items-center gap-2.5 mb-1">
                    <span className="w-[22px] h-[22px] rounded-full bg-ink text-white text-[11px] font-bold grid place-items-center shrink-0">3</span>
                    <h2 className="text-[15px] font-bold text-ink">หมายเหตุเพิ่มเติม</h2>
                  </div>
                  <p className="text-[12.5px] text-muted ml-[32px] mb-3">ไม่บังคับ</p>
                  <textarea
                    defaultValue={report?.notes ?? ''}
                    onBlur={(e) => void saveMeta({ notes: e.target.value || null })}
                    rows={3}
                    placeholder="อะไรก็ได้ที่อยากบอกเพิ่มเติม..."
                    className="w-full text-[13.5px] border border-border-subtle bg-white rounded-xl px-4 py-3.5 outline-hidden focus-visible:outline-2 focus-visible:outline-brand-500 resize-y"
                  />
                </section>

                {/* Sticky footer */}
                <div className="sticky bottom-4 mt-2 bg-white border border-border-subtle rounded-2xl shadow-md px-4.5 py-3.5 flex items-center justify-between gap-4 flex-wrap">
                  <div className="text-sm text-dim">
                    <b className="text-strong tabular-nums">{report?.items.length ?? 0}</b> งาน · <b className="text-strong tabular-nums">{fmtMinutes(totalMinutes)}</b>
                    {report?.blockerHasIssue && <> · Blocker <b className="text-danger-600">1</b> รายการ</>}
                  </div>
                  {report && report.status === 'draft' && (
                    <button
                      onClick={openSubmitModal}
                      disabled={report.items.length === 0}
                      className="flex items-center gap-1.5 text-sm font-bold bg-brand-600 hover:bg-brand-700 disabled:bg-border disabled:text-muted disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-xl transition-colors"
                    >
                      <Send className="w-4 h-4" /> ส่งรายงาน
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {isLocked && (
            <div className="space-y-4">
              <div className="bg-white border border-border-subtle rounded-2xl shadow-xs px-5 py-4">
                <div className="flex items-center gap-3">
                  <Avatar name={report!.userName ?? '—'} avatarUrl={report!.userAvatarUrl} className="w-9 h-9 text-sm" colorClass={avatarColor(report!.userName ?? '—')} />
                  <div>
                    <div className="text-[15px] font-bold text-ink">Daily Report — {fmtDateTH(report!.reportDate)}</div>
                    <div className="text-xs text-dim mt-0.5">
                      จาก {report!.userName ?? '—'}
                      {report!.submittedAt ? ` · ส่งเมื่อ ${new Date(report!.submittedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}` : ''}
                      {' · '}
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE.reviewed}`}>{STATUS_LABEL.reviewed}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-6 mt-4 pt-4 border-t border-divider flex-wrap">
                  <div className="text-xs text-dim">งานที่ทำ<b className="block text-[15px] text-strong tabular-nums mt-0.5">{report!.items.length}</b></div>
                  <div className="text-xs text-dim">เวลารวม<b className="block text-[15px] text-strong tabular-nums mt-0.5">{fmtMinutes(totalMinutes)}</b></div>
                  <div className="text-xs text-dim">Blocker<b className={`block text-[15px] tabular-nums mt-0.5 ${report!.blockerHasIssue ? 'text-danger-600' : 'text-strong'}`}>{report!.blockerHasIssue ? 1 : 0}</b></div>
                </div>
                {isOwner && report!.recipients.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t border-divider">
                    {report!.recipients.map((r) => (
                      <span key={r.id} className={`text-[11px] font-medium px-2 py-1 rounded-full ${r.reviewedAt ? 'bg-success-50 text-success-700' : 'bg-divider text-dim'}`}>
                        {r.name} · {r.reviewedAt ? 'อ่านแล้ว' : 'ยังไม่อ่าน'}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="text-[11.5px] font-bold text-muted uppercase tracking-wide mb-2 ml-0.5">งานวันนี้</div>
                <div className="bg-white border border-border-subtle rounded-xl overflow-hidden divide-y divide-divider">
                  {report!.items.map((it) => (
                    <div key={it.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                      <div className="min-w-0 flex-1">
                        {it.task ? (
                          <>
                            <TaskLink projectId={it.task.projectId} taskId={it.taskId!} code={it.task.code} title={it.task.title} />
                            {it.note && <div className="text-[12.5px] text-soft mt-0.5">{it.note}</div>}
                          </>
                        ) : (
                          <>
                            <span className="font-medium text-strong">{it.manualTitle}</span>
                            <div className="text-[11px] text-muted mt-0.5">คีย์เอง</div>
                          </>
                        )}
                      </div>
                      <span className="text-xs text-dim tabular-nums shrink-0">{fmtMinutes(it.minutes)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {report!.blockerHasIssue && (
                <div>
                  <div className="text-[11.5px] font-bold text-muted uppercase tracking-wide mb-2 ml-0.5">ปัญหา / Blocker</div>
                  <div className="bg-danger-50 border border-danger-100 rounded-xl px-4 py-3.5 flex gap-2.5">
                    <AlertTriangle className="w-[18px] h-[18px] text-danger-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-[13px] font-bold text-danger-800">{report!.blockerDetail}</div>
                      {report!.blockerNeedHelpFrom && <div className="text-xs text-danger-700 mt-1">ต้องการความช่วยเหลือจาก: {report!.blockerNeedHelpFrom}</div>}
                    </div>
                  </div>
                </div>
              )}

              {report!.notes && (
                <div>
                  <div className="text-[11.5px] font-bold text-muted uppercase tracking-wide mb-2 ml-0.5">หมายเหตุ</div>
                  <div className="bg-white border border-border-subtle rounded-xl px-4 py-3.5 text-sm text-body">{report!.notes}</div>
                </div>
              )}

              {isOwner && (
                <div className="flex justify-end">
                  <button onClick={() => void requestEdit()} className="text-xs font-semibold px-3.5 py-2 rounded-lg border border-border-subtle bg-white hover:bg-hover text-soft">ขอแก้ไขรายงาน</button>
                </div>
              )}
            </div>
          )}

          {/* Comment thread */}
          {report && (
            <div className="bg-white border border-border-subtle rounded-xl px-4 py-4">
              <div className="text-[11.5px] font-bold text-muted uppercase tracking-wide mb-3">ความเห็น</div>
              {report.comments.length === 0 && <div className="text-sm text-muted mb-1">ยังไม่มีความเห็น</div>}
              <div className="space-y-3.5">
                {report.comments.map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    <Avatar name={c.userName ?? '—'} avatarUrl={c.avatarUrl} className="w-7 h-7 text-[10px] shrink-0" colorClass={avatarColor(c.userName ?? '—')} />
                    <div className="min-w-0">
                      <div className="rounded-2xl rounded-tl-sm px-3.5 py-2 text-[13px] bg-hover text-body inline-block max-w-full">
                        <b className="text-strong">{c.userName}</b> · {c.body}
                      </div>
                      <div className="text-[10.5px] text-muted mt-1 ml-1">{new Date(c.createdAt).toLocaleString('th-TH')}</div>
                    </div>
                  </div>
                ))}
              </div>
              {(report.userId === user?.id || report.recipients.some((r) => r.id === user?.id)) && (
                <div className="flex gap-2 mt-3.5 pt-3.5 border-t border-divider">
                  <input
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void postComment() }}
                    placeholder="เพิ่มความเห็น..."
                    className="flex-1 text-sm bg-hover rounded-lg px-3.5 py-2.5 outline-hidden focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:bg-white"
                  />
                  <button onClick={() => void postComment()} className="w-10 h-10 shrink-0 rounded-lg bg-brand-600 hover:bg-brand-700 text-white grid place-items-center"><Send className="w-4 h-4" /></button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {confirmSubmit && report && (
        <div
          className="fixed inset-0 bg-ink/40 z-50 grid place-items-center p-4"
          onClick={() => { setConfirmSubmit(false); setJustSubmitted(null) }}
        >
          <div className="bg-white rounded-2xl shadow-lg w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            {justSubmitted ? (
              // Pronista §Daily Report submit confirmation (2026-09-02) — หน้าจอยืนยันหลังกดส่งสำเร็จ (เดิมโมดัลปิดเงียบๆ ไม่มีการยืนยันอะไรเลย)
              <>
                <div className="w-10 h-10 rounded-xl bg-success-50 text-success-600 grid place-items-center mb-3.5"><Check className="w-5 h-5" strokeWidth={3} /></div>
                <div className="text-base font-bold text-ink mb-1">ส่งสำเร็จ</div>
                <div className="text-[13px] text-dim mb-5">
                  Daily Report วันที่ {fmtDateTH(report.reportDate)} ถูกส่งถึง <b className="text-strong">{justSubmitted.join(', ')}</b> แล้ว
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setConfirmSubmit(false); setJustSubmitted(null) }} className="text-sm font-bold px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white">ปิด</button>
                </div>
              </>
            ) : (
              <>
                <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 grid place-items-center mb-3.5"><Send className="w-5 h-5" /></div>
                <div className="text-base font-bold text-ink mb-1">ส่งรายงานนี้เลยไหม</div>
                <div className="text-[13px] text-dim mb-4">แก้ไขต่อได้จนกว่าผู้รับจะเปิดอ่าน หลังจากนั้นต้องกด &ldquo;ขอแก้ไขรายงาน&rdquo; ถ้าอยากแก้ทีหลัง</div>

                {/* Pronista §Daily Report multi-recipient — เลือกผู้รับได้หลายคน (เดิม select เดี่ยว) */}
                <label className="block text-[11.5px] font-semibold text-dim mb-1.5">ส่งถึง (เลือกได้หลายคน)</label>
                <div className="border border-border rounded-lg mb-4 max-h-40 overflow-y-auto divide-y divide-divider">
                  {(recipients?.recipients ?? []).map((r) => (
                    <label key={r.id} className="flex items-center gap-2.5 px-3 py-2 text-sm text-body cursor-pointer hover:bg-hover">
                      <input type="checkbox" checked={submitRecipientIds.has(r.id)} onChange={() => toggleSubmitRecipient(r.id)} className="shrink-0" />
                      {r.name}
                    </label>
                  ))}
                </div>

                <div className="bg-hover rounded-xl px-4 py-3.5 space-y-2 mb-5">
                  <div className="flex justify-between text-[13px]"><span className="text-dim">วันที่</span><span className="text-strong font-semibold">{fmtDateTH(report.reportDate)}</span></div>
                  <div className="flex justify-between text-[13px]"><span className="text-dim">งานในรายงาน</span><span className="text-strong font-semibold tabular-nums">{report.items.length} งาน</span></div>
                  <div className="flex justify-between text-[13px]"><span className="text-dim">เวลารวม</span><span className="text-strong font-semibold tabular-nums">{fmtMinutes(totalMinutes)}</span></div>
                  <div className="flex justify-between text-[13px]"><span className="text-dim">Blocker</span><span className={`font-semibold ${report.blockerHasIssue ? 'text-danger-600' : 'text-strong'}`}>{report.blockerHasIssue ? '1 รายการ' : 'ไม่มี'}</span></div>
                </div>

                <div className="flex justify-end gap-2">
                  <button onClick={() => setConfirmSubmit(false)} className="text-sm font-medium px-4 py-2 rounded-lg border border-border text-body hover:bg-hover">กลับไปแก้</button>
                  <button onClick={() => void doSubmit()} disabled={submitRecipientIds.size === 0} className="text-sm font-bold px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-border disabled:text-muted text-white flex items-center gap-1.5">
                    <Send className="w-3.5 h-3.5" /> ส่งถึง{submitRecipientIds.size > 0 ? ` ${submitRecipientIds.size} คน` : ''}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
