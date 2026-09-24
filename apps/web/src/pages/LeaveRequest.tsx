/** Pronista §Leave Request (2026-09-22, Phase 1+2) — เมนู "ขอลา": การ์ดโควตา (ไอคอน+progress bar) + ทีมลาวันนี้ + ประวัติของฉัน (ไทม์ไลน์สถานะ) + คำขอรออนุมัติ */
import { Check, Paperclip, Plus, Users, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { DateInputTH } from '../components/DateInputTH'
import { useDialog } from '../components/Dialog'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { leaveIconOf } from '../lib/leave-icons'
import { useNotifications } from '../lib/notifications-context'
import { useLoad } from '../lib/useLoad'
import { ModalShell } from './LeaveOverview'

interface LeaveTypeRow {
  id: string
  name: string
  icon: string | null
  requiresReason: boolean
  requiresAttachment: boolean
  balance: { quota: number | null; remain: number | null; waiting: number }
}
interface LeaveRequestRow {
  id: string
  leaveTypeId: string
  leaveTypeName: string | null
  userName?: string | null
  ranges: { id: string; startDate: string; endDate: string }[]
  reason: string | null
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  rejectReason: string | null
  attachmentR2Key: string | null
  attachmentFilename?: string | null
  attachmentMime?: string | null
  createdAt: number
  decidedByName?: string | null
  decidedAt: number | null
}
interface OnLeaveRow {
  userId: string
  userName: string | null
  leaveTypeName: string | null
  startDate: string
  endDate: string
}

const STATUS_LABEL: Record<LeaveRequestRow['status'], string> = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ถูกปฏิเสธ', withdrawn: 'ถอนคำขอแล้ว' }
const STATUS_BADGE: Record<LeaveRequestRow['status'], string> = {
  pending: 'bg-warning-50 text-warning-700',
  approved: 'bg-success-50 text-success-700',
  rejected: 'bg-danger-50 text-danger-700',
  withdrawn: 'bg-hover text-muted',
}
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const fmtDateShort = (d: string) => `${Number(d.slice(8, 10))} ${THAI_MONTHS_SHORT[Number(d.slice(5, 7)) - 1]}`
const fmtDateTime = (ms: number) => new Date(ms).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const todayISO = () => new Date().toLocaleString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 10)
const inputCls = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'

/** Pronista §Leave Management Overhaul เฟส D (2026-09-23) — แสดงหลายช่วงวันที่ของคำขอเดียวแบบย่อ เช่น "12-13 พ.ย., 16 พ.ย." */
function formatRanges(ranges: { startDate: string; endDate: string }[]): string {
  return ranges
    .map((r) => (r.endDate !== r.startDate ? `${fmtDateShort(r.startDate)}-${fmtDateShort(r.endDate)}` : fmtDateShort(r.startDate)))
    .join(', ')
}

function OnLeaveWidget() {
  const load = useLoad<{ rows: OnLeaveRow[] }>(() => api.get('/api/leave-requests/on-leave'))
  const rows = load.data?.rows ?? []
  if (load.loading) return null
  return (
    <div className="bg-white rounded-xl border border-border-subtle px-4 py-3 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-soft shrink-0">
        <Users className="w-3.5 h-3.5" />
        {rows.length === 0 ? 'วันนี้ไม่มีใครลา' : `ทีมลาช่วงนี้ (${rows.length})`}
      </div>
      {rows.length > 0 && <div className="h-4 w-px bg-border-subtle shrink-0" />}
      {rows.map((r) => (
        <div key={`${r.userId}-${r.startDate}`} className="flex items-center gap-1.5 text-xs text-body">
          <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-[10px] font-semibold flex items-center justify-center shrink-0">{(r.userName ?? '?').slice(0, 1)}</span>
          <span>
            {r.userName ?? '—'} — {r.leaveTypeName ?? 'ลา'} {fmtDate(r.startDate)}
            {r.endDate !== r.startDate ? `–${fmtDate(r.endDate)}` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Pronista §Leave Request Phase 2 — ไทม์ไลน์สถานะคำขอ แทน badge เดี่ยวเดิม */
function StatusTimeline({ r }: { r: LeaveRequestRow }) {
  type Step = { label: string; sub: string; tone: 'done' | 'pending' | 'danger' | 'muted' }
  const steps: Step[] = [{ label: 'ยื่นคำขอ', sub: fmtDateTime(r.createdAt), tone: 'done' }]
  if (r.status === 'pending') {
    steps.push({ label: 'รอผู้อนุมัติพิจารณา', sub: '', tone: 'pending' })
  } else if (r.status === 'approved') {
    steps.push({ label: `${r.decidedByName ?? 'ผู้อนุมัติ'}อนุมัติ`, sub: r.decidedAt ? fmtDateTime(r.decidedAt) : '', tone: 'done' })
    steps.push({ label: 'ขึ้นปฏิทินทีมงานแล้ว', sub: '', tone: 'done' })
  } else if (r.status === 'rejected') {
    steps.push({ label: `${r.decidedByName ?? 'ผู้อนุมัติ'}ปฏิเสธ`, sub: r.decidedAt ? fmtDateTime(r.decidedAt) : '', tone: 'danger' })
  } else {
    steps.push({ label: 'ถอน/ยกเลิกคำขอ', sub: '', tone: 'muted' })
  }
  const dotCls: Record<Step['tone'], string> = { done: 'bg-brand-600', pending: 'bg-divider border border-border', danger: 'bg-danger-600', muted: 'bg-divider' }
  return (
    <div className="flex items-start mt-2">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1 w-24 shrink-0">
            <div className={`w-3.5 h-3.5 rounded-full ${dotCls[s.tone]}`} />
            <span className="text-[11px] text-dim text-center leading-tight">{s.label}</span>
            {s.sub && <span className="text-[10px] text-muted">{s.sub}</span>}
          </div>
          {i < steps.length - 1 && <div className={`flex-1 h-0.5 mb-5 ${s.tone === 'done' && steps[i + 1]!.tone === 'done' ? 'bg-brand-600' : 'bg-divider'}`} />}
        </div>
      ))}
    </div>
  )
}

interface DraftRange {
  startDate: string
  endDate: string
}

/** Pronista §Leave Enhancements เฟส A (2026-09-24) — ดูรูปแนบขนาดเต็มแบบ Lightbox คลิกที่ไหนก็ปิด */
function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-60 bg-ink/80 flex items-center justify-center p-4 cursor-zoom-out" onClick={onClose}>
      <img src={src} alt={alt} className="max-w-full max-h-full object-contain rounded-lg" />
      <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white">
        <X className="w-5 h-5" />
      </button>
    </div>
  )
}

function NewLeaveModal({ types, onClose, onSaved }: { types: LeaveTypeRow[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [leaveTypeId, setLeaveTypeId] = useState(types[0]?.id ?? '')
  const [ranges, setRanges] = useState<DraftRange[]>([{ startDate: '', endDate: '' }])
  const [reason, setReason] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const selectedType = types.find((t) => t.id === leaveTypeId)

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) {
      setFilePreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setFilePreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const setRange = (i: number, patch: Partial<DraftRange>) => setRanges((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const addRange = () => setRanges((rs) => [...rs, { startDate: '', endDate: '' }])
  const removeRange = (i: number) => setRanges((rs) => rs.filter((_, idx) => idx !== i))

  const submit = async () => {
    if (!leaveTypeId) return setError('ต้องเลือกประเภทลา')
    if (ranges.some((r) => !r.startDate || !r.endDate)) return setError('ต้องเลือกวันที่ให้ครบทุกช่วง')
    if (ranges.some((r) => r.endDate < r.startDate)) return setError('วันสิ้นสุดต้องไม่ก่อนวันเริ่มในแต่ละช่วง')
    const sorted = [...ranges].sort((a, b) => a.startDate.localeCompare(b.startDate))
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.startDate <= sorted[i - 1]!.endDate) return setError('ช่วงวันที่ห้ามซ้อนทับกัน')
    }
    if (selectedType?.requiresReason && !reason.trim()) return setError('ต้องระบุเหตุผล')
    if (selectedType?.requiresAttachment && !file) return setError('ประเภทลานี้ต้องแนบไฟล์ (เช่น ใบรับรองแพทย์)')
    setSaving(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('leaveTypeId', leaveTypeId)
      fd.append('ranges', JSON.stringify(ranges))
      if (reason.trim()) fd.append('reason', reason.trim())
      if (file) fd.append('attachment', file)
      await api.post('/api/leave-requests', fd)
      toast('ส่งคำขอลาแล้ว')
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'ส่งคำขอไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-10 sm:top-20 mx-auto w-full max-w-md px-4">
        <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
            <span className="font-semibold text-ink text-sm">เพิ่มการลา</span>
            <button onClick={onClose} className="p-1 rounded hover:bg-hover text-dim">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 space-y-3 overflow-y-auto">
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">ประเภทลา *</label>
              <select value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} className={inputCls}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted block">ช่วงวันที่ลา *</label>
              {ranges.map((r, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1 min-w-0">
                    {i === 0 && <span className="text-[11px] text-dim block mb-1">วันเริ่ม</span>}
                    <DateInputTH value={r.startDate} onChange={(v) => setRange(i, { startDate: v })} className={inputCls} />
                  </div>
                  <div className="flex-1 min-w-0">
                    {i === 0 && <span className="text-[11px] text-dim block mb-1">วันสิ้นสุด</span>}
                    <DateInputTH value={r.endDate} onChange={(v) => setRange(i, { endDate: v })} className={inputCls} />
                  </div>
                  {ranges.length > 1 && (
                    <button onClick={() => removeRange(i)} className="p-2 rounded-lg hover:bg-hover text-dim shrink-0" title="ลบช่วงนี้">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={addRange} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                <Plus className="w-3.5 h-3.5" /> เพิ่มช่วงวันที่
              </button>
            </div>
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">เหตุผล{selectedType?.requiresReason ? ' *' : ''}</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={inputCls} placeholder="สาเหตุ/รายละเอียดการลา" />
            </div>
            {/* Pronista §Leave Management Overhaul เฟส C (2026-09-23) — เดิมโชว์ช่องแนบไฟล์เฉพาะ requiresAttachment=true เท่านั้น แนบเอกสารประกอบเองไม่ได้แม้ประเภทลานั้นไม่บังคับ — เปิดให้แนบได้เสมอ (optional) บังคับเฉพาะ type ที่ requiresAttachment เท่านั้น (validate ทั้ง client submit() ด้านบนและ server อยู่แล้ว ไม่ต้องแก้) */}
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">แนบไฟล์ (เช่น ใบรับรองแพทย์){selectedType?.requiresAttachment ? ' *' : ''}</label>
              <button onClick={() => fileRef.current?.click()} className="w-full text-sm border border-dashed border-border rounded-lg px-3 py-3 text-center hover:bg-hover text-dim">
                {file ? file.name : 'เลือกไฟล์… (ไม่บังคับ)'}
                <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </button>
              {filePreviewUrl && (
                <img
                  src={filePreviewUrl}
                  alt={file?.name ?? 'ตัวอย่างไฟล์แนบ'}
                  onClick={() => setLightboxOpen(true)}
                  className="mt-2 h-20 w-20 object-cover rounded-lg border border-border-subtle cursor-zoom-in"
                />
              )}
            </div>
            {error && <p className="text-xs text-danger-600">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-subtle shrink-0">
            <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">
              ยกเลิก
            </button>
            <button disabled={saving} onClick={submit} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50">
              {saving ? 'กำลังส่ง…' : 'ส่งคำขอลา'}
            </button>
          </div>
        </div>
      </div>
      {lightboxOpen && filePreviewUrl && <ImageLightbox src={filePreviewUrl} alt={file?.name ?? 'ตัวอย่างไฟล์แนบ'} onClose={() => setLightboxOpen(false)} />}
    </div>
  )
}

/** Pronista §Leave Detail Drill-Down เฟส 2 (2026-09-24) + §Leave Enhancements เฟส A/B/D (2026-09-24)
 * modal รายละเอียดคำขอลาเต็ม — ใช้ร่วมกันทั้งบริบทผู้อนุมัติ ("รออนุมัติ": onApprove/onReject) และผู้ยื่นเอง ("ประวัติของฉัน": onWithdraw)
 * onApprove/onReject/onWithdraw/onDelegate เป็น optional — ไม่ส่งมา = ไม่โชว์ปุ่มนั้น */
function LeaveDetailModal({
  request,
  onClose,
  onApprove,
  onReject,
  onWithdraw,
  onDelegated,
  delegateEnabled,
}: {
  request: LeaveRequestRow
  onClose: () => void
  onApprove?: () => void
  onReject?: () => void
  onWithdraw?: () => void
  onDelegated?: () => void
  delegateEnabled?: boolean
}) {
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [delegating, setDelegating] = useState(false)
  const [owners, setOwners] = useState<{ id: string; name: string | null }[]>([])
  const [delegateTo, setDelegateTo] = useState('')
  const [delegateBusy, setDelegateBusy] = useState(false)
  const [delegateError, setDelegateError] = useState('')
  const isImage = request.attachmentMime?.startsWith('image/') ?? false

  useEffect(() => {
    if (!request.attachmentR2Key || !isImage) return
    let cancelled = false
    let objectUrl: string | null = null
    void fetch(`/api/leave-requests/${request.id}/attachment`)
      .then((r) => r.blob())
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setImgUrl(objectUrl)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [request.id, request.attachmentR2Key, isImage])

  const startDelegate = () => {
    setDelegating(true)
    setDelegateError('')
    if (owners.length === 0) {
      void api.get<{ owners: { id: string; name: string | null }[] }>('/api/leave-requests/owners').then((res) => setOwners(res.owners))
    }
  }
  const confirmDelegate = async () => {
    if (!delegateTo) return setDelegateError('เลือกผู้รับโอนสิทธิ์')
    setDelegateBusy(true)
    setDelegateError('')
    try {
      await api.post(`/api/leave-requests/${request.id}/delegate`, { toUserId: delegateTo })
      onDelegated?.()
      onClose()
    } catch (e) {
      setDelegateError(e instanceof ApiError ? e.message : 'โอนสิทธิ์ไม่สำเร็จ')
    } finally {
      setDelegateBusy(false)
    }
  }

  const approverFooter = request.status === 'pending' && (onApprove || onReject)
  const withdrawFooter = !approverFooter && onWithdraw

  return (
    <ModalShell
      title={request.userName ? `${request.userName} · ${request.leaveTypeName ?? '—'}` : (request.leaveTypeName ?? '—')}
      subtitle={STATUS_LABEL[request.status]}
      onClose={onClose}
      footer={
        approverFooter && delegating ? (
          <div className="flex items-center gap-2 w-full">
            <select value={delegateTo} onChange={(e) => setDelegateTo(e.target.value)} className={`${inputCls} flex-1`}>
              <option value="">เลือกผู้รับโอนสิทธิ์…</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name ?? o.id}
                </option>
              ))}
            </select>
            <button onClick={() => setDelegating(false)} className="text-sm px-3 py-2 rounded-lg hover:bg-hover shrink-0">
              ยกเลิก
            </button>
            <button disabled={delegateBusy} onClick={() => void confirmDelegate()} className="text-sm font-medium bg-brand-600 text-white px-3 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50 shrink-0">
              {delegateBusy ? 'กำลังโอน…' : 'ยืนยันโอนสิทธิ์'}
            </button>
            {delegateError && <p className="text-xs text-danger-600 w-full">{delegateError}</p>}
          </div>
        ) : approverFooter ? (
          <>
            <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">
              ปิด
            </button>
            {delegateEnabled && (
              <button onClick={startDelegate} className="text-sm font-medium bg-hover text-body px-3 py-2 rounded-lg hover:bg-divider">
                โอนสิทธิ์อนุมัติ
              </button>
            )}
            <button onClick={onReject} className="flex items-center gap-1 text-sm font-medium bg-danger-50 text-danger-700 px-3 py-2 rounded-lg hover:bg-danger-100">
              <X className="w-4 h-4" /> ปฏิเสธ
            </button>
            <button onClick={onApprove} className="flex items-center gap-1 text-sm font-medium bg-success-600 text-white px-3 py-2 rounded-lg hover:bg-success-700">
              <Check className="w-4 h-4" /> อนุมัติ
            </button>
          </>
        ) : withdrawFooter ? (
          <>
            <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">
              ปิด
            </button>
            <button onClick={onWithdraw} className="text-sm font-medium text-danger-700 hover:underline px-3 py-2">
              {request.status === 'pending' ? 'ถอนคำขอ' : 'ยกเลิก'}
            </button>
          </>
        ) : (
          <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">
            ปิด
          </button>
        )
      }
    >
      <div>
        <div className="text-xs font-medium text-muted mb-1">ช่วงวันที่ลา</div>
        <div className="text-sm text-body">{formatRanges(request.ranges)}</div>
      </div>
      <div>
        <div className="text-xs font-medium text-muted mb-1">เหตุผล</div>
        <div className="text-sm text-body whitespace-pre-line">{request.reason || '—'}</div>
      </div>
      {request.status === 'rejected' && request.rejectReason && (
        <div>
          <div className="text-xs font-medium text-muted mb-1">เหตุผลที่ปฏิเสธ</div>
          <div className="text-sm text-danger-700">{request.rejectReason}</div>
        </div>
      )}
      {request.attachmentR2Key && (
        <div>
          <div className="text-xs font-medium text-muted mb-1">ไฟล์แนบ</div>
          {isImage ? (
            imgUrl ? (
              <img
                src={imgUrl}
                alt={request.attachmentFilename ?? 'ไฟล์แนบ'}
                onClick={() => setLightboxOpen(true)}
                className="max-w-full rounded-lg border border-border-subtle cursor-zoom-in"
              />
            ) : (
              <div className="text-xs text-muted">กำลังโหลดรูป…</div>
            )
          ) : (
            <a href={`/api/leave-requests/${request.id}/attachment`} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:underline inline-flex items-center gap-1">
              <Paperclip className="w-4 h-4" /> {request.attachmentFilename ?? 'เปิดไฟล์แนบ'}
            </a>
          )}
        </div>
      )}
      <div>
        <div className="text-xs font-medium text-muted mb-1">ไทม์ไลน์</div>
        <StatusTimeline r={request} />
      </div>
      {lightboxOpen && imgUrl && <ImageLightbox src={imgUrl} alt={request.attachmentFilename ?? 'ไฟล์แนบ'} onClose={() => setLightboxOpen(false)} />}
    </ModalShell>
  )
}

export function LeaveRequestPage() {
  const [tab, setTab] = useState<'apply' | 'mine' | 'pending'>('apply')
  const [modalOpen, setModalOpen] = useState(false)
  const [detailRequest, setDetailRequest] = useState<LeaveRequestRow | null>(null)
  const [detailSource, setDetailSource] = useState<'mine' | 'pending' | null>(null)
  const typesLoad = useLoad<{ types: LeaveTypeRow[] }>(() => api.get('/api/leave-requests/types'))
  const mineLoad = useLoad<{ rows: LeaveRequestRow[] }>(() => api.get('/api/leave-requests/mine'))
  const pendingLoad = useLoad<{ rows: LeaveRequestRow[] }>(() => api.get('/api/leave-requests/pending'))
  const { alertDialog, promptDialog, confirmDialog } = useDialog()
  const toast = useToast()
  // Pronista §Notification Badge Audit เฟส 6a (2026-09-24) — เข้าเมนู "การลา" แล้วเคลียร์ badge ทั้ง 3 type ทันที (เดิมไม่เคยเคลียร์เลย)
  const { markTypeRead } = useNotifications()
  useEffect(() => {
    void markTypeRead('leave_requested')
    void markTypeRead('leave_approved')
    void markTypeRead('leave_rejected')
  }, [markTypeRead])

  const reloadAll = async () => {
    await Promise.all([typesLoad.reload(), mineLoad.reload(), pendingLoad.reload()])
  }

  const approve = async (id: string) => {
    try {
      await api.post(`/api/leave-requests/${id}/approve`)
      toast('อนุมัติคำขอลาแล้ว')
      await reloadAll()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'อนุมัติไม่สำเร็จ' })
    }
  }
  const reject = async (id: string) => {
    const reason = await promptDialog({ title: 'ปฏิเสธคำขอลา', message: 'ระบุเหตุผลที่ปฏิเสธ', placeholder: 'เช่น เอกสารไม่ครบ', confirmLabel: 'ปฏิเสธคำขอ', required: true })
    if (!reason?.trim()) return
    try {
      await api.post(`/api/leave-requests/${id}/reject`, { reason: reason.trim() })
      toast('ปฏิเสธคำขอแล้ว')
      await reloadAll()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'ปฏิเสธไม่สำเร็จ' })
    }
  }
  const withdraw = async (id: string) => {
    if (!(await confirmDialog({ title: 'ถอนคำขอลานี้?', message: 'คำขอจะถูกยกเลิก ต้องยื่นใหม่หากยังต้องการลา', danger: true, confirmLabel: 'ถอนคำขอ' }))) return
    try {
      await api.post(`/api/leave-requests/${id}/withdraw`)
      toast('ถอนคำขอแล้ว')
      await reloadAll()
    } catch (e) {
      await alertDialog({ title: e instanceof ApiError ? e.message : 'ถอนคำขอไม่สำเร็จ' })
    }
  }

  const types = typesLoad.data?.types ?? []
  const mine = mineLoad.data?.rows ?? []
  const pending = pendingLoad.data?.rows ?? []

  return (
    <>
      <PageHeader
        title="การลา"
        action={
          types.length > 0 && (
            <button onClick={() => setModalOpen(true)} className="flex items-center gap-1.5 text-sm bg-brand-600 text-white px-3 py-2 rounded-lg hover:bg-brand-700">
              <Plus className="w-4 h-4" /> เพิ่มการลา
            </button>
          )
        }
      />
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-1 mb-1 border-b border-border-subtle overflow-x-auto">
          <button onClick={() => setTab('apply')} className={`text-sm font-medium px-3 py-2 border-b-2 -mb-px whitespace-nowrap ${tab === 'apply' ? 'border-brand-600 text-brand-700' : 'border-transparent text-dim'}`}>
            การลา
          </button>
          <button onClick={() => setTab('mine')} className={`text-sm font-medium px-3 py-2 border-b-2 -mb-px whitespace-nowrap ${tab === 'mine' ? 'border-brand-600 text-brand-700' : 'border-transparent text-dim'}`}>
            ประวัติของฉัน
          </button>
          <button onClick={() => setTab('pending')} className={`text-sm font-medium px-3 py-2 border-b-2 -mb-px whitespace-nowrap ${tab === 'pending' ? 'border-brand-600 text-brand-700' : 'border-transparent text-dim'}`}>
            รออนุมัติ{pending.length > 0 ? ` (${pending.length})` : ''}
          </button>
        </div>

        {tab === 'apply' && (
          <div className="space-y-3">
            <OnLeaveWidget />
            {typesLoad.loading ? (
              <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">กำลังโหลด…</div>
            ) : types.length === 0 ? (
              <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">ยังไม่มีประเภทการลาในระบบ ติดต่อ Admin เพื่อตั้งค่า</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {types.map((t) => {
                  const Icon = leaveIconOf(t.icon)
                  const used = t.balance.quota != null && t.balance.remain != null ? t.balance.quota - t.balance.remain : null
                  const pct = t.balance.quota ? Math.min(100, Math.max(0, ((used ?? 0) / t.balance.quota) * 100)) : 0
                  return (
                    <div key={t.id} className="bg-white rounded-xl border border-border-subtle p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                          <Icon className="w-4 h-4 text-brand-600" />
                        </div>
                        <span className="font-medium text-ink text-sm">{t.name}</span>
                        {t.balance.waiting > 0 && <span className="ml-auto text-[11px] font-medium bg-warning-50 text-warning-700 px-2 py-0.5 rounded-full shrink-0">รออนุมัติ {t.balance.waiting}</span>}
                      </div>
                      {t.balance.quota != null && (
                        <div className="h-1.5 rounded-full bg-divider overflow-hidden mb-1.5">
                          <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs text-muted">{t.balance.quota != null ? `ใช้ไป ${used} จาก ${t.balance.quota} วัน` : 'ไม่จำกัดโควตา'}</span>
                        <span className="text-lg font-semibold text-ink tabular-nums">{t.balance.remain ?? '—'}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'mine' &&
          (mineLoad.loading ? (
            <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">กำลังโหลด…</div>
          ) : mine.length === 0 ? (
            <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">ยังไม่มีประวัติการลา</div>
          ) : (
            <div className="bg-white rounded-xl border border-border-subtle divide-y divide-divider">
              {mine.map((r) => {
                const today = todayISO()
                const canCancel = r.status === 'pending' || (r.status === 'approved' && r.ranges.every((rg) => rg.startDate > today))
                return (
                  <div
                    key={r.id}
                    onClick={() => {
                      setDetailRequest(r)
                      setDetailSource('mine')
                    }}
                    className="p-4 cursor-pointer hover:bg-hover"
                  >
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="flex-1 min-w-[180px]">
                        <div className="text-sm font-medium text-ink">{r.leaveTypeName ?? '—'}</div>
                        <div className="text-xs text-muted mt-0.5">{formatRanges(r.ranges)}</div>
                        {r.reason && <div className="text-xs text-dim mt-1">{r.reason}</div>}
                        {r.status === 'rejected' && r.rejectReason && <div className="text-xs text-danger-700 mt-1">เหตุผลที่ปฏิเสธ: {r.rejectReason}</div>}
                        {r.attachmentR2Key && (
                          <a href={`/api/leave-requests/${r.id}/attachment`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-brand-600 hover:underline mt-1 inline-flex items-center gap-1">
                            <Paperclip className="w-3 h-3" /> ไฟล์แนบ
                          </a>
                        )}
                      </div>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                      {canCancel && (
                        <button onClick={(e) => { e.stopPropagation(); void withdraw(r.id) }} className="text-xs text-danger-700 hover:underline shrink-0">
                          {r.status === 'pending' ? 'ถอนคำขอ' : 'ยกเลิก'}
                        </button>
                      )}
                    </div>
                    <StatusTimeline r={r} />
                  </div>
                )
              })}
            </div>
          ))}

        {tab === 'pending' &&
          (pendingLoad.loading ? (
            <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">กำลังโหลด…</div>
          ) : pending.length === 0 ? (
            <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">ไม่มีคำขอลาที่รอคุณอนุมัติ</div>
          ) : (
            <div className="bg-white rounded-xl border border-border-subtle divide-y divide-divider">
              {pending.map((r) => (
                <div
                  key={r.id}
                  onClick={() => {
                    setDetailRequest(r)
                    setDetailSource('pending')
                  }}
                  className="p-4 flex flex-wrap items-start gap-3 cursor-pointer hover:bg-hover"
                >
                  <div className="flex-1 min-w-[180px]">
                    <div className="text-sm font-medium text-ink">
                      {r.userName ?? '—'} · {r.leaveTypeName ?? '—'}
                    </div>
                    <div className="text-xs text-muted mt-0.5">{formatRanges(r.ranges)}</div>
                    {r.reason && <div className="text-xs text-dim mt-1">{r.reason}</div>}
                    {r.attachmentR2Key && (
                      <a href={`/api/leave-requests/${r.id}/attachment`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-brand-600 hover:underline mt-1 inline-flex items-center gap-1">
                        <Paperclip className="w-3 h-3" /> ไฟล์แนบ
                      </a>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={(e) => { e.stopPropagation(); void approve(r.id) }} className="flex items-center gap-1 text-xs font-medium bg-success-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-success-700">
                      <Check className="w-3.5 h-3.5" /> อนุมัติ
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); void reject(r.id) }} className="flex items-center gap-1 text-xs font-medium bg-danger-50 text-danger-700 px-2.5 py-1.5 rounded-lg hover:bg-danger-100">
                      <X className="w-3.5 h-3.5" /> ปฏิเสธ
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
      </div>

      {modalOpen && <NewLeaveModal types={types} onClose={() => setModalOpen(false)} onSaved={reloadAll} />}
      {detailRequest && (
        <LeaveDetailModal
          request={detailRequest}
          onClose={() => {
            setDetailRequest(null)
            setDetailSource(null)
          }}
          onApprove={
            detailSource === 'pending'
              ? () => {
                  void approve(detailRequest.id)
                  setDetailRequest(null)
                }
              : undefined
          }
          onReject={
            detailSource === 'pending'
              ? () => {
                  void reject(detailRequest.id)
                  setDetailRequest(null)
                }
              : undefined
          }
          onWithdraw={
            detailSource === 'mine' && (detailRequest.status === 'pending' || (detailRequest.status === 'approved' && detailRequest.ranges.every((rg) => rg.startDate > todayISO())))
              ? () => {
                  void withdraw(detailRequest.id)
                  setDetailRequest(null)
                }
              : undefined
          }
          onDelegated={() => void reloadAll()}
          delegateEnabled={detailSource === 'pending'}
        />
      )}
    </>
  )
}
