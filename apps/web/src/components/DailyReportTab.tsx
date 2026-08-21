/**
 * Pronista §Daily Report — แท็บที่ 4 ของ "งานของฉัน" ให้พนักงานรวบรวมงานที่ทำวันนี้ (ดึงจาก activity จริง)
 * ส่งให้หัวหน้าโดยตรง (users.managerId) แทนอีเมล — Draft → Submitted → Reviewed (auto flip ตอนหัวหน้าเปิดอ่าน)
 * มี 2 โหมดภายในแท็บ: "วันนี้/แก้ไข" (แก้รายงานของตัวเอง) กับ "ประวัติ" (ดูย้อนหลัง ทั้งของฉัน/ที่ได้รับ)
 */
import { AlertTriangle, Calendar, CheckCircle2, History as HistoryIcon, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Avatar } from './Avatar'
import { DateInputTH } from './DateInputTH'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { avatarColor } from '../pages/ProjectDetail'
import { TASK_STATUS_BADGE, TASK_STATUS_LABEL } from '../lib/task-status'
import { useLoad } from '../lib/useLoad'

const bkkToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)
const fmtDateTH = (d: string) => {
  const [y, m, day] = d.split('-')
  const MONTHS = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
  return `${Number(day)} ${MONTHS[Number(m)]} ${Number(y) + 543}`
}
const fmtMinutes = (min: number) => (min <= 0 ? '—' : min < 60 ? `${min} น.` : `${Math.floor(min / 60)}ชม. ${min % 60 ? `${min % 60}น.` : ''}`.trim())

const STATUS_LABEL: Record<'draft' | 'submitted' | 'reviewed', string> = { draft: 'Draft', submitted: 'Submitted', reviewed: 'Reviewed' }
const STATUS_BADGE: Record<'draft' | 'submitted' | 'reviewed', string> = {
  draft: 'bg-hover text-dim',
  submitted: 'bg-info-50 text-info-700',
  reviewed: 'bg-success-50 text-success-700',
}

interface SuggestedTask { id: string; code: string | null; title: string; status: string; projectId: string | null; projectName: string | null; minutes: number; inReport: boolean }
interface PlanSuggestedTask { id: string; code: string | null; title: string; status: string; dueDate: string | null; projectId: string | null; projectName: string | null; dueTomorrow: boolean }
interface ReportItem { id: string; taskId: string; note: string | null; minutes: number; task: { id: string; code: string | null; title: string; status: string; projectId: string | null; projectName: string | null } }
interface PlanItem { id: string; taskId: string | null; note: string; task: { id: string; code: string | null; title: string } | null }
interface ReportComment { id: string; userId: string; userName: string | null; avatarUrl: string | null; body: string; createdAt: number }
interface ReportDetail {
  id: string
  userId: string
  userName: string | null
  userAvatarUrl: string | null
  reportDate: string
  recipientId: string
  recipientName: string | null
  status: 'draft' | 'submitted' | 'reviewed'
  notes: string | null
  blockerHasIssue: boolean
  blockerDetail: string | null
  blockerNeedHelpFrom: string | null
  submittedAt: number | null
  reviewedAt: number | null
  items: ReportItem[]
  planItems: PlanItem[]
  comments: ReportComment[]
}
interface HistoryRow { id: string; reportDate: string; status: 'draft' | 'submitted' | 'reviewed'; userName: string | null; recipientName: string | null; itemCount: number; submittedAt: number | null }

function TaskLink({ projectId, taskId, code, title }: { projectId: string | null; taskId: string; code: string | null; title: string }) {
  if (!projectId) return <span className="truncate">{code ?? title}</span>
  return (
    <a href={`/projects/${projectId}?task=${taskId}`} target="_blank" rel="noreferrer" className="truncate hover:underline text-brand-700" title={title}>
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
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [error, setError] = useState('')

  const { data: report, reload: reloadReport } = useLoad<ReportDetail | null>(async () => {
    if (openId) return api.get<ReportDetail>(`/api/daily-reports/${openId}`)
    const res = await api.get<{ report: ReportDetail | null }>(`/api/daily-reports?date=${date}`)
    return res.report
  }, [openId, date])

  const isOwner = !!report && report.userId === user?.id
  const isDraftOwnedByMe = !!report && isOwner && report.status === 'draft'
  const canEditNow = !report || isDraftOwnedByMe

  const { data: suggested, reload: reloadSuggested } = useLoad<{ date: string; tasks: SuggestedTask[] }>(
    () => (canEditNow ? api.get(`/api/daily-reports/suggested?date=${report?.reportDate ?? date}`) : Promise.resolve({ date, tasks: [] })),
    [report?.reportDate, date, canEditNow],
  )
  const { data: planSuggested } = useLoad<{ date: string; tasks: PlanSuggestedTask[] }>(
    () => (canEditNow ? api.get(`/api/daily-reports/plan-suggested?date=${report?.reportDate ?? date}`) : Promise.resolve({ date, tasks: [] })),
    [report?.reportDate, date, canEditNow],
  )
  const { data: historyData, reload: reloadHistory } = useLoad<{ reports: HistoryRow[] }>(
    () => (mode === 'history' ? api.get(`/api/daily-reports/history?scope=${historyScope}`) : Promise.resolve({ reports: [] })),
    [mode, historyScope],
  )

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
    await Promise.all([reloadReport(), reloadSuggested()])
  }
  const addAllSuggested = async () => {
    const todo = (suggested?.tasks ?? []).filter((t) => !t.inReport)
    for (const t of todo) await addItem(t.id)
  }
  const updateItemNote = async (itemId: string, note: string) => {
    if (!report) return
    await api.patch(`/api/daily-reports/${report.id}/items/${itemId}`, { note: note || null })
  }
  const removeItem = async (itemId: string) => {
    if (!report) return
    await api.delete(`/api/daily-reports/${report.id}/items/${itemId}`)
    await Promise.all([reloadReport(), reloadSuggested()])
  }
  const addPlanItem = async (taskId: string | null, note: string) => {
    const r = await ensureReport().catch(() => null)
    if (!r || !note.trim()) return
    await api.post(`/api/daily-reports/${r.id}/plan-items`, { taskId, note: note.trim() })
    await reloadReport()
  }
  const removePlanItem = async (id: string) => {
    if (!report) return
    await api.delete(`/api/daily-reports/${report.id}/plan-items/${id}`)
    await reloadReport()
  }
  const saveMeta = async (patch: Partial<Pick<ReportDetail, 'notes' | 'blockerHasIssue' | 'blockerDetail' | 'blockerNeedHelpFrom'>>) => {
    const r = await ensureReport().catch(() => null)
    if (!r) return
    await api.patch(`/api/daily-reports/${r.id}`, patch)
    await reloadReport()
  }
  const doSubmit = async () => {
    if (!report) return
    await api.post(`/api/daily-reports/${report.id}/submit`, {})
    setConfirmSubmit(false)
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

  const totalMinutes = (report?.items ?? []).reduce((s, it) => s + it.minutes, 0)

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
          <div className="flex bg-divider rounded-lg p-0.5 text-xs font-medium w-fit">
            <button onClick={() => setHistoryScope('mine')} className={`px-3 py-1.5 rounded-md ${historyScope === 'mine' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>รายงานของฉัน</button>
            <button onClick={() => setHistoryScope('received')} className={`px-3 py-1.5 rounded-md ${historyScope === 'received' ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}>รายงานที่ได้รับ</button>
          </div>
          <div className="bg-white rounded-lg shadow-xs overflow-hidden">
            {(historyData?.reports ?? []).length === 0 ? (
              <div className="text-center text-sm text-muted py-10">ไม่พบรายงาน</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-hover text-xs text-muted">
                  <tr>
                    <th className="text-left font-medium px-4 py-2.5">วันที่</th>
                    <th className="text-left font-medium px-3 py-2.5">สถานะ</th>
                    <th className="text-right font-medium px-3 py-2.5">งาน</th>
                    <th className="text-left font-medium px-3 py-2.5">{historyScope === 'mine' ? 'ผู้รับ' : 'ผู้ส่ง'}</th>
                    <th className="text-right font-medium px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {(historyData?.reports ?? []).map((r) => (
                    <tr key={r.id} className="hover:bg-hover cursor-pointer" onClick={() => openFromHistory(r.id)}>
                      <td className="px-4 py-2.5">{fmtDateTH(r.reportDate)}</td>
                      <td className="px-3"><span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                      <td className="px-3 text-right tabular-nums">{r.itemCount}</td>
                      <td className="px-3 text-muted">{historyScope === 'mine' ? r.recipientName : r.userName}</td>
                      <td className="px-4 text-right text-brand-700 text-xs">เปิดดู →</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Header */}
          <div className="bg-white rounded-lg shadow-xs px-5 py-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-dim" />
              <div>
                <div className="font-semibold text-strong">Daily Report — {fmtDateTH(report?.reportDate ?? date)}</div>
                {report && <div className="text-xs text-muted mt-0.5">{isOwner ? `ส่งถึง ${report.recipientName ?? '—'}` : `จาก ${report.userName ?? '—'}`}</div>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {report && <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_BADGE[report.status]}`}>{STATUS_LABEL[report.status]}</span>}
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

          {/* Summary cards — "งานที่แนะนำ" สื่อความหมายเฉพาะตอนแก้ไขรายงานของตัวเอง (ไม่งั้นจะเป็นตัวเลขงานแนะนำของ "ผู้ดู" ไม่ใช่เจ้าของรายงาน สับสน) */}
          <div className="flex bg-white rounded-lg shadow-xs border border-border-subtle overflow-x-auto divide-x divide-divider">
            {[
              ...(canEditNow ? [{ label: 'งานที่แนะนำ', value: (suggested?.tasks ?? []).length }] : []),
              { label: 'เพิ่มในรายงาน', value: report?.items.length ?? 0 },
              { label: 'เวลารวม', value: fmtMinutes(totalMinutes), raw: true },
              { label: 'สถานะ', value: report ? STATUS_LABEL[report.status] : 'ยังไม่สร้าง', raw: true },
            ].map((s) => (
              <div key={s.label} className="flex-1 min-w-[110px] px-3.5 py-2.5">
                <div className="text-[11px] text-muted whitespace-nowrap">{s.label}</div>
                <div className="text-lg font-bold leading-tight mt-0.5 text-ink">{s.value}</div>
              </div>
            ))}
          </div>

          {canEditNow && (
            <>
              {/* งานที่ระบบแนะนำ */}
              <div className="bg-white rounded-lg shadow-xs overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-divider">
                  <div className="text-sm font-medium text-strong">งานที่ระบบแนะนำ (มี activity วันนี้)</div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => void reloadSuggested()} className="text-xs flex items-center gap-1 text-dim hover:text-body"><RefreshCw className="w-3 h-3" /> รีเฟรช</button>
                    {(suggested?.tasks ?? []).some((t) => !t.inReport) && (
                      <button onClick={() => void addAllSuggested()} className="text-xs px-2.5 py-1 rounded-lg bg-brand-50 text-brand-700 hover:bg-brand-100">เพิ่มทั้งหมด</button>
                    )}
                  </div>
                </div>
                {(suggested?.tasks ?? []).length === 0 ? (
                  <div className="text-center text-sm text-muted py-6">ยังไม่พบ Task ที่มี activity ในวันนี้</div>
                ) : (
                  <div className="divide-y divide-divider">
                    {suggested!.tasks.map((t) => (
                      <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <div className="min-w-0 flex-1">
                          <TaskLink projectId={t.projectId} taskId={t.id} code={t.code} title={t.title} />
                          <div className="text-[11px] text-muted mt-0.5">{t.projectName ?? '—'} · {fmtMinutes(t.minutes)}</div>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${TASK_STATUS_BADGE[t.status as keyof typeof TASK_STATUS_BADGE] ?? ''}`}>{TASK_STATUS_LABEL[t.status as keyof typeof TASK_STATUS_LABEL] ?? t.status}</span>
                        {t.inReport ? (
                          <span className="text-xs text-success-600 flex items-center gap-1 shrink-0"><CheckCircle2 className="w-3.5 h-3.5" /> อยู่ในรายงาน</span>
                        ) : (
                          <button onClick={() => void addItem(t.id)} className="text-xs px-2.5 py-1 rounded-lg border border-border-subtle hover:bg-hover shrink-0">+ เพิ่มในรายงาน</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* งานที่ทำวันนี้ */}
              <div className="bg-white rounded-lg shadow-xs overflow-hidden">
                <div className="px-4 py-2.5 border-b border-divider text-sm font-medium text-strong">งานที่ทำวันนี้</div>
                {(report?.items ?? []).length === 0 ? (
                  <div className="text-center text-sm text-muted py-6">ยังไม่มีงานในรายงาน — เลือกจากรายการแนะนำด้านบน</div>
                ) : (
                  <div className="divide-y divide-divider">
                    {report!.items.map((it) => (
                      <div key={it.id} className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <TaskLink projectId={it.task.projectId} taskId={it.taskId} code={it.task.code} title={it.task.title} />
                            <div className="text-[11px] text-muted mt-0.5">{it.task.projectName ?? '—'} · {fmtMinutes(it.minutes)} · <span className={`px-1 py-0.5 rounded ${TASK_STATUS_BADGE[it.task.status as keyof typeof TASK_STATUS_BADGE] ?? ''}`}>{TASK_STATUS_LABEL[it.task.status as keyof typeof TASK_STATUS_LABEL] ?? it.task.status}</span></div>
                          </div>
                          <button onClick={() => void removeItem(it.id)} className="text-border hover:text-danger-600 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                        <textarea
                          defaultValue={it.note ?? ''}
                          onBlur={(e) => void updateItemNote(it.id, e.target.value)}
                          placeholder="สิ่งที่ทำวันนี้..."
                          rows={2}
                          className="mt-2 w-full text-sm bg-hover rounded-lg px-3 py-2 outline-hidden"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Blocker */}
              <div className="bg-white rounded-lg shadow-xs px-4 py-4 space-y-3">
                <div className="text-sm font-medium text-strong flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-warning-500" /> ปัญหา / Blocker</div>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1.5"><input type="radio" checked={!report?.blockerHasIssue} onChange={() => void saveMeta({ blockerHasIssue: false })} /> ไม่มีปัญหา</label>
                  <label className="flex items-center gap-1.5"><input type="radio" checked={!!report?.blockerHasIssue} onChange={() => void saveMeta({ blockerHasIssue: true })} /> มีปัญหา / ติด Blocker</label>
                </div>
                {report?.blockerHasIssue && (
                  <div className="space-y-2">
                    <textarea defaultValue={report.blockerDetail ?? ''} onBlur={(e) => void saveMeta({ blockerDetail: e.target.value })} placeholder="รายละเอียดปัญหา" rows={2} className="w-full text-sm bg-hover rounded-lg px-3 py-2 outline-hidden" />
                    <input defaultValue={report.blockerNeedHelpFrom ?? ''} onBlur={(e) => void saveMeta({ blockerNeedHelpFrom: e.target.value })} placeholder="ต้องการความช่วยเหลือจากใคร (เช่น PM / หัวหน้า / ทีม Backend)" className="w-full text-sm bg-hover rounded-lg px-3 py-2 outline-hidden" />
                  </div>
                )}
              </div>

              {/* แผนพรุ่งนี้ */}
              <div className="bg-white rounded-lg shadow-xs overflow-hidden">
                <div className="px-4 py-2.5 border-b border-divider text-sm font-medium text-strong">แผนงานพรุ่งนี้</div>
                <div className="divide-y divide-divider">
                  {(report?.planItems ?? []).map((p) => (
                    <div key={p.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        {p.task ? <TaskLink projectId={null} taskId={p.task.id} code={p.task.code} title={p.task.title} /> : null}
                        <div className="text-body">{p.note}</div>
                      </div>
                      <button onClick={() => void removePlanItem(p.id)} className="text-border hover:text-danger-600 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  {(planSuggested?.tasks ?? []).filter((t) => !(report?.planItems ?? []).some((p) => p.taskId === t.id)).map((t) => (
                    <div key={t.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <TaskLink projectId={t.projectId} taskId={t.id} code={t.code} title={t.title} />
                        <div className="text-[11px] text-muted mt-0.5">{t.projectName ?? '—'}{t.dueTomorrow ? ' · ครบกำหนดพรุ่งนี้' : ''}</div>
                      </div>
                      <button onClick={() => void addPlanItem(t.id, t.code ?? t.title)} className="text-xs px-2.5 py-1 rounded-lg border border-border-subtle hover:bg-hover shrink-0">+ เพิ่ม</button>
                    </div>
                  ))}
                </div>
                <PlanFreeAdd onAdd={(note) => void addPlanItem(null, note)} />
              </div>

              {/* หมายเหตุ */}
              <div className="bg-white rounded-lg shadow-xs px-4 py-4">
                <div className="text-sm font-medium text-strong mb-2">หมายเหตุเพิ่มเติม</div>
                <textarea defaultValue={report?.notes ?? ''} onBlur={(e) => void saveMeta({ notes: e.target.value || null })} rows={2} placeholder="(ไม่บังคับ)" className="w-full text-sm bg-hover rounded-lg px-3 py-2 outline-hidden" />
              </div>

              {/* บันทึก/ส่ง */}
              {report && (
                <div className="flex justify-end gap-2">
                  <button onClick={() => setConfirmSubmit(true)} disabled={report.items.length === 0} className="flex items-center gap-1.5 text-sm font-medium bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg">
                    <Send className="w-4 h-4" /> ส่งรายงาน
                  </button>
                </div>
              )}
            </>
          )}

          {report && !canEditNow && report.status !== 'draft' && (
            <>
              {/* มุมมองอ่านอย่างเดียว/หัวหน้า — รายการงาน */}
              <div className="bg-white rounded-lg shadow-xs overflow-hidden">
                <div className="px-4 py-2.5 border-b border-divider text-sm font-medium text-strong">งานในรายงาน</div>
                <div className="divide-y divide-divider">
                  {report.items.map((it) => (
                    <div key={it.id} className="px-4 py-3 text-sm">
                      <TaskLink projectId={it.task.projectId} taskId={it.taskId} code={it.task.code} title={it.task.title} />
                      <div className="text-[11px] text-muted mt-0.5">{it.task.projectName ?? '—'} · {fmtMinutes(it.minutes)}</div>
                      {it.note && <div className="text-body mt-1">{it.note}</div>}
                    </div>
                  ))}
                </div>
              </div>
              {report.blockerHasIssue && (
                <div className="bg-danger-50 rounded-lg px-4 py-3 text-sm text-danger-800">
                  <div className="font-medium flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> มีปัญหา / Blocker</div>
                  <div className="mt-1">{report.blockerDetail}</div>
                  {report.blockerNeedHelpFrom && <div className="text-xs mt-1">ต้องการความช่วยเหลือจาก: {report.blockerNeedHelpFrom}</div>}
                </div>
              )}
              {report.planItems.length > 0 && (
                <div className="bg-white rounded-lg shadow-xs px-4 py-4">
                  <div className="text-sm font-medium text-strong mb-2">แผนงานพรุ่งนี้</div>
                  <ul className="text-sm text-body list-disc pl-5 space-y-1">
                    {report.planItems.map((p) => <li key={p.id}>{p.note}</li>)}
                  </ul>
                </div>
              )}
              {report.notes && (
                <div className="bg-white rounded-lg shadow-xs px-4 py-4">
                  <div className="text-sm font-medium text-strong mb-1">หมายเหตุ</div>
                  <div className="text-sm text-body">{report.notes}</div>
                </div>
              )}
              {isOwner && (
                <div className="flex justify-end">
                  <button onClick={() => void requestEdit()} className="text-xs px-3 py-1.5 rounded-lg border border-border-subtle hover:bg-hover">ขอแก้ไขรายงาน</button>
                </div>
              )}
            </>
          )}

          {/* Comment thread */}
          {report && (
            <div className="bg-white rounded-lg shadow-xs px-4 py-4 space-y-3">
              <div className="text-sm font-medium text-strong">ความเห็น</div>
              {report.comments.length === 0 && <div className="text-sm text-muted">ยังไม่มีความเห็น</div>}
              {report.comments.map((c) => (
                <div key={c.id} className="flex gap-2">
                  <Avatar name={c.userName ?? '—'} avatarUrl={c.avatarUrl} className="w-7 h-7 text-[10px]" colorClass={avatarColor(c.userName ?? '—')} />
                  <div className="min-w-0">
                    <div className="rounded-xl px-3 py-2 text-sm bg-hover text-soft">
                      <b className="text-body">{c.userName}</b> · {c.body}
                    </div>
                    <div className="text-[10px] text-muted mt-0.5">{new Date(c.createdAt).toLocaleString('th-TH')}</div>
                  </div>
                </div>
              ))}
              {(report.userId === user?.id || report.recipientId === user?.id) && (
                <div className="flex gap-2">
                  <input
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void postComment() }}
                    placeholder="เพิ่มความเห็น..."
                    className="flex-1 text-sm bg-white shadow-xs border border-border rounded-lg px-3 py-2 outline-hidden"
                  />
                  <button onClick={() => void postComment()} className="bg-brand-600 hover:bg-brand-700 text-white px-3 rounded-lg shrink-0"><Send className="w-4 h-4" /></button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {confirmSubmit && report && (
        <div className="fixed inset-0 bg-ink/40 z-50 grid place-items-center p-4" onClick={() => setConfirmSubmit(false)}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <div className="font-semibold text-strong mb-2">คุณกำลังจะส่ง Daily Report ให้ {report.recipientName}</div>
            <div className="text-sm text-body space-y-0.5 mb-4">
              <div>วันที่: {fmtDateTH(report.reportDate)}</div>
              <div>งานในรายงาน: {report.items.length} งาน</div>
              <div>เวลารวม: {fmtMinutes(totalMinutes)}</div>
              <div>Blocker: {report.blockerHasIssue ? '1 รายการ' : 'ไม่มี'}</div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmSubmit(false)} className="text-sm px-3 py-1.5 rounded-lg border border-border text-body hover:bg-hover">ยกเลิก</button>
              <button onClick={() => void doSubmit()} className="text-sm px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium flex items-center gap-1.5"><Send className="w-3.5 h-3.5" /> ส่งรายงาน</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PlanFreeAdd({ onAdd }: { onAdd: (note: string) => void }) {
  const [text, setText] = useState('')
  return (
    <div className="flex gap-2 px-4 py-2.5 border-t border-divider">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) { onAdd(text.trim()); setText('') } }}
        placeholder="เพิ่มแผนงานอื่นเอง..."
        className="flex-1 text-sm bg-hover rounded-lg px-3 py-2 outline-hidden"
      />
      <button onClick={() => { if (text.trim()) { onAdd(text.trim()); setText('') } }} className="text-xs px-3 py-1.5 rounded-lg border border-border-subtle hover:bg-hover flex items-center gap-1 shrink-0"><Plus className="w-3.5 h-3.5" /> เพิ่ม</button>
    </div>
  )
}
