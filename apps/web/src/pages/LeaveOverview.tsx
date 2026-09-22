/** Pronista §Leave Request Phase 2 (2026-09-22) — owner เท่านั้น: ภาพรวมการลาทั้งทีม + ตั้งค่าประเภทลา + ปรับยอด backfill */
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useDialog } from '../components/Dialog'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { LEAVE_ICON_MAP, leaveIconOf } from '../lib/leave-icons'
import { useLoad } from '../lib/useLoad'

interface OverviewCell {
  userId: string
  leaveTypeId: string
  quota: number | null
  remain: number | null
  waiting: number
}
interface OverviewResponse {
  year: string
  users: { id: string; name: string }[]
  types: { id: string; name: string }[]
  cells: OverviewCell[]
}
interface LeaveTypeAdmin {
  id: string
  name: string
  icon: string | null
  requiresReason: boolean
  requiresAttachment: boolean
  quotaDaysByRole: Partial<Record<'owner' | 'member' | 'vendor', number>> | null
  active: boolean
  sortOrder: number
}
interface Adjustment {
  id: string
  userId: string
  leaveTypeId: string
  year: string
  days: number
  note: string | null
  createdByName: string | null
  createdAt: number
}

const inputCls = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
const toBE = (yearAD: string) => String(Number(yearAD) + 543)
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' })

function ModalShell({ title, subtitle, onClose, children, footer }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/30" />
      <div className="absolute inset-x-0 top-10 sm:top-20 mx-auto w-full max-w-md px-4">
        <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
            <div>
              <div className="font-semibold text-ink text-sm">{title}</div>
              {subtitle && <div className="text-xs text-muted mt-0.5">{subtitle}</div>}
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-hover text-dim shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 space-y-3 overflow-y-auto">{children}</div>
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-subtle shrink-0">{footer}</div>
        </div>
      </div>
    </div>
  )
}

function AdjustmentModal({
  userId,
  userName,
  leaveTypeId,
  typeName,
  year,
  onClose,
  onSaved,
}: {
  userId: string
  userName: string
  leaveTypeId: string
  typeName: string
  year: string
  onClose: () => void
  onSaved: () => void
}) {
  const toast = useToast()
  const [days, setDays] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const history = useLoad<{ rows: Adjustment[] }>(() => api.get(`/api/leave-admin/adjustments?userId=${userId}&leaveTypeId=${leaveTypeId}&year=${year}`))

  const submit = async () => {
    const n = Number(days)
    if (!Number.isInteger(n) || n === 0) return setError('กรอกจำนวนวันเป็นจำนวนเต็ม (ติดลบได้ถ้าจะหักยอด) ห้ามเป็น 0')
    setSaving(true)
    setError('')
    try {
      await api.post('/api/leave-admin/adjustments', { userId, leaveTypeId, year, days: n, note: note.trim() || undefined })
      toast('ปรับยอดแล้ว')
      setDays('')
      setNote('')
      await history.reload()
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'ปรับยอดไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  const removeAdj = async (id: string) => {
    await api.delete(`/api/leave-admin/adjustments/${id}`)
    toast('ลบรายการปรับยอดแล้ว')
    await history.reload()
    onSaved()
  }

  return (
    <ModalShell
      title="ปรับยอดวันลา"
      subtitle={`${userName} · ${typeName} · ปี พ.ศ. ${toBE(year)}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">
            ปิด
          </button>
          <button disabled={saving} onClick={submit} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'กำลังบันทึก…' : 'บันทึกการปรับยอด'}
          </button>
        </>
      }
    >
      <div>
        <label className="text-xs font-medium text-muted mb-1 block">จำนวนวัน (บวก = นับเป็นวันที่ใช้ไปเพิ่ม · ลบ = หักยอดคืน)</label>
        <input value={days} onChange={(e) => setDays(e.target.value)} type="number" step="1" className={inputCls} placeholder="เช่น 3 หรือ -1" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted mb-1 block">เหตุผล (แนะนำให้ใส่)</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={inputCls} placeholder="เช่น ลาไปแล้วก่อนขึ้นระบบ อ้างอิงบันทึกเดิม" />
      </div>
      {error && <p className="text-xs text-danger-600">{error}</p>}

      <div className="pt-2 border-t border-border-subtle">
        <div className="text-xs font-medium text-muted mb-1.5">ประวัติการปรับยอด</div>
        {history.loading ? (
          <p className="text-xs text-muted">กำลังโหลด…</p>
        ) : (history.data?.rows.length ?? 0) === 0 ? (
          <p className="text-xs text-muted">ยังไม่เคยปรับยอด</p>
        ) : (
          <div className="space-y-1.5">
            {history.data!.rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-xs bg-hover rounded-lg px-2.5 py-1.5">
                <div className="min-w-0">
                  <span className={`font-semibold ${r.days > 0 ? 'text-danger-700' : 'text-success-700'}`}>{r.days > 0 ? `+${r.days}` : r.days} วัน</span>
                  <span className="text-muted"> · {fmtDate(r.createdAt)} · {r.createdByName ?? '—'}</span>
                  {r.note && <div className="text-dim truncate">{r.note}</div>}
                </div>
                <button onClick={() => removeAdj(r.id)} className="p-1 rounded hover:bg-white text-muted hover:text-danger-600 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  )
}

const LEAVE_ICON_OPTIONS = Object.keys(LEAVE_ICON_MAP)

function LeaveTypeModal({ base, onClose, onSaved }: { base: LeaveTypeAdmin | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(base?.name ?? '')
  const [icon, setIcon] = useState(base?.icon ?? LEAVE_ICON_OPTIONS[0]!)
  const [requiresReason, setRequiresReason] = useState(base?.requiresReason ?? true)
  const [requiresAttachment, setRequiresAttachment] = useState(base?.requiresAttachment ?? false)
  const [quotaOwner, setQuotaOwner] = useState(String(base?.quotaDaysByRole?.owner ?? ''))
  const [quotaMember, setQuotaMember] = useState(String(base?.quotaDaysByRole?.member ?? ''))
  const [quotaVendor, setQuotaVendor] = useState(String(base?.quotaDaysByRole?.vendor ?? ''))
  const [sortOrder, setSortOrder] = useState(String(base?.sortOrder ?? 0))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!name.trim()) return setError('ต้องระบุชื่อประเภทลา')
    setSaving(true)
    setError('')
    const quotaDaysByRole: Record<string, number> = {}
    if (quotaOwner.trim()) quotaDaysByRole.owner = Number(quotaOwner)
    if (quotaMember.trim()) quotaDaysByRole.member = Number(quotaMember)
    if (quotaVendor.trim()) quotaDaysByRole.vendor = Number(quotaVendor)
    const body = {
      name: name.trim(),
      icon,
      requiresReason,
      requiresAttachment,
      quotaDaysByRole: Object.keys(quotaDaysByRole).length ? quotaDaysByRole : null,
      sortOrder: Number(sortOrder) || 0,
    }
    try {
      if (base) await api.patch(`/api/leave-admin/types/${base.id}`, body)
      else await api.post('/api/leave-admin/types', body)
      toast(base ? 'บันทึกแล้ว' : 'เพิ่มประเภทลาแล้ว')
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title={base ? 'แก้ไขประเภทลา' : 'เพิ่มประเภทลา'}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">
            ยกเลิก
          </button>
          <button disabled={saving} onClick={submit} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </>
      }
    >
      <div>
        <label className="text-xs font-medium text-muted mb-1 block">ชื่อประเภทลา *</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="เช่น ลาพักร้อน" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted mb-1 block">ไอคอน</label>
        <div className="grid grid-cols-4 gap-2">
          {LEAVE_ICON_OPTIONS.map((k) => {
            const Icon = LEAVE_ICON_MAP[k]!
            return (
              <button
                key={k}
                onClick={() => setIcon(k)}
                className={`flex items-center justify-center p-2.5 rounded-lg border ${icon === k ? 'border-brand-500 bg-brand-50' : 'border-border-subtle hover:bg-hover'}`}
              >
                <Icon className={`w-4 h-4 ${icon === k ? 'text-brand-600' : 'text-dim'}`} />
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted mb-1.5 block">โควตา (วัน/ปี) ต่อประเภทผู้ใช้งาน — เว้นว่าง = ไม่จำกัด</label>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <span className="text-[11px] text-muted">Owner</span>
            <input value={quotaOwner} onChange={(e) => setQuotaOwner(e.target.value)} type="number" min="0" className={inputCls} />
          </div>
          <div>
            <span className="text-[11px] text-muted">Member</span>
            <input value={quotaMember} onChange={(e) => setQuotaMember(e.target.value)} type="number" min="0" className={inputCls} />
          </div>
          <div>
            <span className="text-[11px] text-muted">Vendor</span>
            <input value={quotaVendor} onChange={(e) => setQuotaVendor(e.target.value)} type="number" min="0" className={inputCls} />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-sm text-body cursor-pointer">
          <input type="checkbox" checked={requiresReason} onChange={(e) => setRequiresReason(e.target.checked)} /> บังคับกรอกเหตุผล
        </label>
        <label className="flex items-center gap-1.5 text-sm text-body cursor-pointer">
          <input type="checkbox" checked={requiresAttachment} onChange={(e) => setRequiresAttachment(e.target.checked)} /> บังคับแนบไฟล์
        </label>
      </div>
      <div>
        <label className="text-xs font-medium text-muted mb-1 block">ลำดับแสดงผล</label>
        <input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} type="number" className={`${inputCls} w-28`} />
      </div>
      {error && <p className="text-xs text-danger-600">{error}</p>}
    </ModalShell>
  )
}

function OverviewTab() {
  const [year, setYear] = useState(() => new Date().toLocaleString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 4))
  const load = useLoad<OverviewResponse>(() => api.get(`/api/leave-admin/overview?year=${year}`), [year])
  const [modal, setModal] = useState<{ userId: string; userName: string; leaveTypeId: string; typeName: string } | null>(null)

  const cellOf = (userId: string, leaveTypeId: string) => load.data?.cells.find((c) => c.userId === userId && c.leaveTypeId === leaveTypeId)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <button onClick={() => setYear(String(Number(year) - 1))} className="p-1.5 rounded-lg hover:bg-hover text-dim">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-ink w-24 text-center">ปี พ.ศ. {toBE(year)}</span>
        <button onClick={() => setYear(String(Number(year) + 1))} className="p-1.5 rounded-lg hover:bg-hover text-dim">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {load.loading ? (
        <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">กำลังโหลด…</div>
      ) : !load.data || load.data.users.length === 0 || load.data.types.length === 0 ? (
        <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">ยังไม่มีข้อมูลพนักงาน/ประเภทลาให้แสดง</div>
      ) : (
        <div className="bg-white rounded-xl border border-border-subtle overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="text-left text-xs font-semibold text-dim px-4 py-2.5 bg-hover sticky left-0 whitespace-nowrap">พนักงาน</th>
                {load.data.types.map((t) => (
                  <th key={t.id} className="text-center text-xs font-semibold text-dim px-3 py-2.5 bg-hover whitespace-nowrap">
                    {t.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {load.data.users.map((u) => (
                <tr key={u.id} className="border-t border-divider">
                  <td className="px-4 py-2.5 font-medium text-ink whitespace-nowrap sticky left-0 bg-white">{u.name}</td>
                  {load.data!.types.map((t) => {
                    const cell = cellOf(u.id, t.id)
                    const used = cell?.quota != null && cell.remain != null ? cell.quota - cell.remain : null
                    return (
                      <td key={t.id} className="px-3 py-2.5 text-center">
                        <button onClick={() => setModal({ userId: u.id, userName: u.name, leaveTypeId: t.id, typeName: t.name })} className="hover:underline decoration-dashed underline-offset-2">
                          <span className="tabular-nums text-body">{cell?.quota == null ? '—' : `${used} / ${cell.quota}`}</span>
                          {cell && cell.waiting > 0 && <span className="text-warning-700 text-[11px] ml-1">(+{cell.waiting} รอ)</span>}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">คลิกตัวเลขในตารางเพื่อปรับยอด (เช่น backfill วันลาที่ใช้ไปก่อนขึ้นระบบ)</p>

      {modal && (
        <AdjustmentModal
          userId={modal.userId}
          userName={modal.userName}
          leaveTypeId={modal.leaveTypeId}
          typeName={modal.typeName}
          year={year}
          onClose={() => setModal(null)}
          onSaved={load.reload}
        />
      )}
    </div>
  )
}

function LeaveTypesTab() {
  const load = useLoad<{ types: LeaveTypeAdmin[] }>(() => api.get('/api/leave-admin/types'))
  const [modalOpen, setModalOpen] = useState<'new' | LeaveTypeAdmin | null>(null)
  const { confirmDialog } = useDialog()
  const toast = useToast()

  const toggleActive = async (t: LeaveTypeAdmin) => {
    if (t.active && !(await confirmDialog({ title: `ปิดใช้งาน "${t.name}"?`, message: 'พนักงานจะยื่นขอประเภทนี้ไม่ได้อีก (ประวัติเดิมยังอยู่ครบ)', confirmLabel: 'ปิดใช้งาน' }))) return
    await api.patch(`/api/leave-admin/types/${t.id}`, { active: !t.active })
    toast(t.active ? 'ปิดใช้งานแล้ว' : 'เปิดใช้งานแล้ว')
    await load.reload()
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setModalOpen('new')} className="flex items-center gap-1.5 text-sm bg-brand-600 text-white px-3 py-2 rounded-lg hover:bg-brand-700">
          <Plus className="w-4 h-4" /> เพิ่มประเภท
        </button>
      </div>

      {load.loading ? (
        <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">กำลังโหลด…</div>
      ) : (load.data?.types.length ?? 0) === 0 ? (
        <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">ยังไม่มีประเภทลาในระบบ</div>
      ) : (
        <div className="bg-white rounded-xl border border-border-subtle divide-y divide-divider">
          {load.data!.types.map((t) => {
            const Icon = leaveIconOf(t.icon)
            return (
              <div key={t.id} className={`p-4 flex items-center gap-3 ${!t.active ? 'opacity-50' : ''}`}>
                <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-brand-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink">
                    {t.name} {!t.active && <span className="text-xs text-muted font-normal">(ปิดใช้งาน)</span>}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    โควตา: owner {t.quotaDaysByRole?.owner ?? '—'} · member {t.quotaDaysByRole?.member ?? '—'} · vendor {t.quotaDaysByRole?.vendor ?? '—'} วัน/ปี
                    {t.requiresAttachment && ' · บังคับแนบไฟล์'}
                  </div>
                </div>
                <button onClick={() => setModalOpen(t)} className="p-2 rounded-lg hover:bg-hover text-dim shrink-0">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => toggleActive(t)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-border-subtle hover:bg-hover shrink-0">
                  {t.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {modalOpen && <LeaveTypeModal base={modalOpen === 'new' ? null : modalOpen} onClose={() => setModalOpen(null)} onSaved={load.reload} />}
    </div>
  )
}

export function LeaveOverviewPage() {
  const [tab, setTab] = useState<'overview' | 'types'>('overview')
  return (
    <>
      <PageHeader title="ภาพรวมการลา" />
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-1 mb-1 border-b border-border-subtle overflow-x-auto">
          <button onClick={() => setTab('overview')} className={`text-sm font-medium px-3 py-2 border-b-2 -mb-px whitespace-nowrap ${tab === 'overview' ? 'border-brand-600 text-brand-700' : 'border-transparent text-dim'}`}>
            ภาพรวมทีม
          </button>
          <button onClick={() => setTab('types')} className={`text-sm font-medium px-3 py-2 border-b-2 -mb-px whitespace-nowrap ${tab === 'types' ? 'border-brand-600 text-brand-700' : 'border-transparent text-dim'}`}>
            ตั้งค่าประเภทลา
          </button>
        </div>
        {tab === 'overview' ? <OverviewTab /> : <LeaveTypesTab />}
      </div>
    </>
  )
}
