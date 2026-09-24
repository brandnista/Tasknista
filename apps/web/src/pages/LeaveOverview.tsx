/** Pronista §Leave Request Phase 2 (2026-09-22) — owner เท่านั้น: ภาพรวมการลาทั้งทีม + ปรับยอด backfill (ตั้งค่าประเภทลาแยกไปหน้า LeaveTypesSettings เฟส D) */
import { ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
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
  users: { id: string; name: string; role: 'owner' | 'member' | 'vendor' }[]
  types: { id: string; name: string }[]
  cells: OverviewCell[]
}
export interface LeaveTypeAdmin {
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
interface LeaveHistoryRow {
  id: string
  leaveTypeName: string | null
  ranges: { id: string; startDate: string; endDate: string }[]
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  reason: string | null
}

export const inputCls = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
const toBE = (yearAD: string) => String(Number(yearAD) + 543)
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' })
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const fmtDateShort = (d: string) => `${Number(d.slice(8, 10))} ${THAI_MONTHS_SHORT[Number(d.slice(5, 7)) - 1]}`
/** Pronista §Leave Detail Drill-Down เฟส 4 (2026-09-24) — แสดงหลายช่วงวันที่แบบย่อ เหมือน formatRanges ใน LeaveRequest.tsx (duplicate เล็กๆ ไม่คุ้มแยกไฟล์ใช้ร่วม) */
const formatRangesShort = (ranges: { startDate: string; endDate: string }[]) =>
  ranges.map((r) => (r.endDate !== r.startDate ? `${fmtDateShort(r.startDate)}-${fmtDateShort(r.endDate)}` : fmtDateShort(r.startDate))).join(', ')
const HISTORY_STATUS_LABEL: Record<LeaveHistoryRow['status'], string> = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ถูกปฏิเสธ', withdrawn: 'ถอนคำขอแล้ว' }
const HISTORY_STATUS_BADGE: Record<LeaveHistoryRow['status'], string> = {
  pending: 'bg-warning-50 text-warning-700',
  approved: 'bg-success-50 text-success-700',
  rejected: 'bg-danger-50 text-danger-700',
  withdrawn: 'bg-hover text-muted',
}

export function ModalShell({ title, subtitle, onClose, children, footer }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
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

const ROLE_LABEL: Record<'owner' | 'member' | 'vendor', string> = { owner: 'Admin', member: 'พนักงาน', vendor: 'พาร์ทเนอร์' }

/** Pronista §Leave Detail Drill-Down เฟส 4 (2026-09-24) — คลิกชื่อพนักงานในตารางภาพรวม เปิดดูประวัติการลาแต่ละวัน + สรุปโควตา (คนละปุ่มจากคลิกตัวเลข cell ที่เปิด AdjustmentModal) */
function EmployeeLeaveHistoryModal({
  userId,
  userName,
  year,
  types,
  cells,
  onClose,
}: {
  userId: string
  userName: string
  year: string
  types: { id: string; name: string }[]
  cells: OverviewCell[]
  onClose: () => void
}) {
  const load = useLoad<{ rows: LeaveHistoryRow[] }>(() => api.get(`/api/leave-admin/users/${userId}/requests`))
  const rows = load.data?.rows ?? []

  return (
    <ModalShell
      title={userName}
      subtitle={`ประวัติการลา · ปี พ.ศ. ${toBE(year)}`}
      onClose={onClose}
      footer={
        <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">
          ปิด
        </button>
      }
    >
      <div>
        <div className="text-xs font-medium text-muted mb-1.5">สรุปโควตา</div>
        <div className="grid grid-cols-2 gap-1.5">
          {types.map((t) => {
            const cell = cells.find((c) => c.leaveTypeId === t.id)
            const used = cell?.quota != null && cell.remain != null ? cell.quota - cell.remain : null
            return (
              <div key={t.id} className="bg-hover rounded-lg px-2.5 py-1.5 text-xs">
                <div className="text-dim">{t.name}</div>
                <div className="text-body font-medium tabular-nums">{cell?.quota == null ? 'ไม่จำกัด' : `${used} / ${cell.quota} วัน`}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="pt-2 border-t border-border-subtle">
        <div className="text-xs font-medium text-muted mb-1.5">ประวัติการลารายวัน</div>
        {load.loading ? (
          <p className="text-xs text-muted">กำลังโหลด…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted">ยังไม่มีประวัติการลาในปีนี้</p>
        ) : (
          <div className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.id} className="text-xs bg-hover rounded-lg px-2.5 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-body">{r.leaveTypeName ?? '—'}</span>
                  <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${HISTORY_STATUS_BADGE[r.status]}`}>{HISTORY_STATUS_LABEL[r.status]}</span>
                </div>
                <div className="text-dim mt-0.5">{formatRangesShort(r.ranges)}</div>
                {r.reason && <div className="text-muted mt-0.5 truncate">{r.reason}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  )
}

function OverviewTab() {
  const [year, setYear] = useState(() => new Date().toLocaleString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(0, 4))
  const load = useLoad<OverviewResponse>(() => api.get(`/api/leave-admin/overview?year=${year}`), [year])
  const [modal, setModal] = useState<{ userId: string; userName: string; leaveTypeId: string; typeName: string } | null>(null)
  const [historyModal, setHistoryModal] = useState<{ userId: string; userName: string } | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | 'owner' | 'member' | 'vendor'>('all')

  const cellOf = (userId: string, leaveTypeId: string) => load.data?.cells.find((c) => c.userId === userId && c.leaveTypeId === leaveTypeId)

  /** Pronista §Leave Management Overhaul เฟส F (2026-09-23) — ค้นหาชื่อ + กรองตามประเภทผู้ใช้งาน ฝั่ง client (ข้อมูลโหลดมาเต็มต่อปีอยู่แล้ว ไม่ต้อง re-fetch) */
  const filteredUsers = (load.data?.users ?? []).filter((u) => (roleFilter === 'all' || u.role === roleFilter) && u.name.toLowerCase().includes(search.trim().toLowerCase()))

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

      {load.data && load.data.users.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อพนักงาน…" className={`${inputCls} max-w-64`} />
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)} className={`${inputCls} w-auto`}>
            <option value="all">ทุกประเภทผู้ใช้งาน</option>
            {(Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
      )}

      {load.loading ? (
        <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">กำลังโหลด…</div>
      ) : !load.data || load.data.users.length === 0 || load.data.types.length === 0 ? (
        <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">ยังไม่มีข้อมูลพนักงาน/ประเภทลาให้แสดง</div>
      ) : filteredUsers.length === 0 ? (
        <div className="bg-white rounded-xl border border-border-subtle py-12 text-center text-sm text-muted">ไม่พบพนักงานที่ตรงกับตัวกรอง</div>
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
              {filteredUsers.map((u) => (
                <tr key={u.id} className="border-t border-divider">
                  <td
                    onClick={() => setHistoryModal({ userId: u.id, userName: u.name })}
                    className="px-4 py-2.5 font-medium text-ink whitespace-nowrap sticky left-0 bg-white cursor-pointer hover:underline"
                  >
                    {u.name}
                  </td>
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
      {historyModal && load.data && (
        <EmployeeLeaveHistoryModal
          userId={historyModal.userId}
          userName={historyModal.userName}
          year={year}
          types={load.data.types}
          cells={load.data.cells.filter((c) => c.userId === historyModal.userId)}
          onClose={() => setHistoryModal(null)}
        />
      )}
    </div>
  )
}

export function LeaveOverviewPage() {
  return (
    <>
      <PageHeader title="ภาพรวมการลา" />
      <div className="p-4 sm:p-6 space-y-4">
        <OverviewTab />
      </div>
    </>
  )
}
