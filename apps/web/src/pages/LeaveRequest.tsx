/** Pronista §Leave Request (2026-09-22, Phase 1) — เมนู "ขอลา": การ์ดโควตา/เหลือ/รออนุมัติ ต่อประเภท + ประวัติของฉัน + คำขอรออนุมัติ (ถ้าเป็น manager/owner) */
import { Check, Paperclip, Plus, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { DateInputTH } from '../components/DateInputTH'
import { useDialog } from '../components/Dialog'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'

interface LeaveTypeRow {
  id: string
  name: string
  requiresReason: boolean
  requiresAttachment: boolean
  balance: { quota: number | null; remain: number | null; waiting: number }
}
interface LeaveRequestRow {
  id: string
  leaveTypeId: string
  leaveTypeName: string | null
  userName?: string | null
  startDate: string
  endDate: string
  reason: string | null
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  rejectReason: string | null
  attachmentR2Key: string | null
  createdAt: number
}

const STATUS_LABEL: Record<LeaveRequestRow['status'], string> = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ถูกปฏิเสธ', withdrawn: 'ถอนคำขอแล้ว' }
const STATUS_BADGE: Record<LeaveRequestRow['status'], string> = {
  pending: 'bg-warning-50 text-warning-700',
  approved: 'bg-success-50 text-success-700',
  rejected: 'bg-danger-50 text-danger-700',
  withdrawn: 'bg-hover text-muted',
}
const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const inputCls = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'

function NewLeaveModal({ types, onClose, onSaved }: { types: LeaveTypeRow[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [leaveTypeId, setLeaveTypeId] = useState(types[0]?.id ?? '')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const selectedType = types.find((t) => t.id === leaveTypeId)

  const submit = async () => {
    if (!leaveTypeId) return setError('ต้องเลือกประเภทลา')
    if (!startDate || !endDate) return setError('ต้องเลือกวันที่')
    if (endDate < startDate) return setError('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม')
    if (selectedType?.requiresReason && !reason.trim()) return setError('ต้องระบุเหตุผล')
    if (selectedType?.requiresAttachment && !file) return setError('ประเภทลานี้ต้องแนบไฟล์ (เช่น ใบรับรองแพทย์)')
    setSaving(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('leaveTypeId', leaveTypeId)
      fd.append('startDate', startDate)
      fd.append('endDate', endDate)
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
          <span className="font-semibold text-ink text-sm">ขอลา</span>
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
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted mb-1 block">วันเริ่ม *</label>
              <DateInputTH value={startDate} onChange={setStartDate} className={inputCls} />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-muted mb-1 block">วันสิ้นสุด *</label>
              <DateInputTH value={endDate} onChange={setEndDate} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">เหตุผล{selectedType?.requiresReason ? ' *' : ''}</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={inputCls} placeholder="สาเหตุ/รายละเอียดการลา" />
          </div>
          {selectedType?.requiresAttachment && (
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">แนบไฟล์ (เช่น ใบรับรองแพทย์) *</label>
              <button onClick={() => fileRef.current?.click()} className="w-full text-sm border border-dashed border-border rounded-lg px-3 py-3 text-center hover:bg-hover text-dim">
                {file ? file.name : 'เลือกไฟล์…'}
                <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </button>
            </div>
          )}
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
  )
}

export function LeaveRequestPage() {
  const [tab, setTab] = useState<'apply' | 'mine' | 'pending'>('apply')
  const [modalOpen, setModalOpen] = useState(false)
  const typesLoad = useLoad<{ types: LeaveTypeRow[] }>(() => api.get('/api/leave-requests/types'))
  const mineLoad = useLoad<{ rows: LeaveRequestRow[] }>(() => api.get('/api/leave-requests/mine'))
  const pendingLoad = useLoad<{ rows: LeaveRequestRow[] }>(() => api.get('/api/leave-requests/pending'))
  const { alertDialog, promptDialog, confirmDialog } = useDialog()
  const toast = useToast()

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
        title="ขอลา"
        action={
          types.length > 0 && (
            <button onClick={() => setModalOpen(true)} className="flex items-center gap-1.5 text-sm bg-brand-600 text-white px-3 py-2 rounded-lg hover:bg-brand-700">
              <Plus className="w-4 h-4" /> ขอลา
            </button>
          )
        }
      />
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-1 mb-1 border-b border-border-subtle overflow-x-auto">
          <button onClick={() => setTab('apply')} className={`text-sm font-medium px-3 py-2 border-b-2 -mb-px whitespace-nowrap ${tab === 'apply' ? 'border-brand-600 text-brand-700' : 'border-transparent text-dim'}`}>
            ขอลา
          </button>
          <button onClick={() => setTab('mine')} className={`text-sm font-medium px-3 py-2 border-b-2 -mb-px whitespace-nowrap ${tab === 'mine' ? 'border-brand-600 text-brand-700' : 'border-transparent text-dim'}`}>
            ประวัติของฉัน
          </button>
          <button onClick={() => setTab('pending')} className={`text-sm font-medium px-3 py-2 border-b-2 -mb-px whitespace-nowrap ${tab === 'pending' ? 'border-brand-600 text-brand-700' : 'border-transparent text-dim'}`}>
            รออนุมัติ{pending.length > 0 ? ` (${pending.length})` : ''}
          </button>
        </div>

        {tab === 'apply' &&
          (typesLoad.loading ? (
            <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">กำลังโหลด…</div>
          ) : types.length === 0 ? (
            <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">ยังไม่มีประเภทการลาในระบบ ติดต่อ Admin เพื่อตั้งค่า</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {types.map((t) => (
                <div key={t.id} className="bg-white rounded-xl border border-border-subtle p-4">
                  <div className="font-medium text-ink text-sm mb-2">{t.name}</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-lg font-semibold text-ink tabular-nums">{t.balance.quota ?? '—'}</div>
                      <div className="text-[11px] text-muted">โควตา</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-ink tabular-nums">{t.balance.remain ?? '—'}</div>
                      <div className="text-[11px] text-muted">คงเหลือ</div>
                    </div>
                    <div>
                      <div className="text-lg font-semibold text-warning-700 tabular-nums">{t.balance.waiting}</div>
                      <div className="text-[11px] text-muted">รออนุมัติ</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}

        {tab === 'mine' &&
          (mineLoad.loading ? (
            <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">กำลังโหลด…</div>
          ) : mine.length === 0 ? (
            <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">ยังไม่มีประวัติการลา</div>
          ) : (
            <div className="bg-white rounded-xl border border-border-subtle divide-y divide-divider">
              {mine.map((r) => (
                <div key={r.id} className="p-4 flex flex-wrap items-start gap-2">
                  <div className="flex-1 min-w-[180px]">
                    <div className="text-sm font-medium text-ink">{r.leaveTypeName ?? '—'}</div>
                    <div className="text-xs text-muted mt-0.5">
                      {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                    </div>
                    {r.reason && <div className="text-xs text-dim mt-1">{r.reason}</div>}
                    {r.status === 'rejected' && r.rejectReason && <div className="text-xs text-danger-700 mt-1">เหตุผลที่ปฏิเสธ: {r.rejectReason}</div>}
                    {r.attachmentR2Key && (
                      <a href={`/api/leave-requests/${r.id}/attachment`} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline mt-1 inline-flex items-center gap-1">
                        <Paperclip className="w-3 h-3" /> ไฟล์แนบ
                      </a>
                    )}
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  {r.status === 'pending' && (
                    <button onClick={() => withdraw(r.id)} className="text-xs text-danger-700 hover:underline shrink-0">
                      ถอนคำขอ
                    </button>
                  )}
                </div>
              ))}
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
                <div key={r.id} className="p-4 flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-[180px]">
                    <div className="text-sm font-medium text-ink">
                      {r.userName ?? '—'} · {r.leaveTypeName ?? '—'}
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                    </div>
                    {r.reason && <div className="text-xs text-dim mt-1">{r.reason}</div>}
                    {r.attachmentR2Key && (
                      <a href={`/api/leave-requests/${r.id}/attachment`} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline mt-1 inline-flex items-center gap-1">
                        <Paperclip className="w-3 h-3" /> ไฟล์แนบ
                      </a>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => approve(r.id)} className="flex items-center gap-1 text-xs font-medium bg-success-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-success-700">
                      <Check className="w-3.5 h-3.5" /> อนุมัติ
                    </button>
                    <button onClick={() => reject(r.id)} className="flex items-center gap-1 text-xs font-medium bg-danger-50 text-danger-700 px-2.5 py-1.5 rounded-lg hover:bg-danger-100">
                      <X className="w-3.5 h-3.5" /> ปฏิเสธ
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
      </div>

      {modalOpen && <NewLeaveModal types={types} onClose={() => setModalOpen(false)} onSaved={reloadAll} />}
    </>
  )
}
