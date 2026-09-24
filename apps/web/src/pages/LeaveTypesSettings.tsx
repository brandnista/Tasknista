/** Pronista §Leave Management Overhaul เฟส E (2026-09-23) — แยก "ตั้งค่าประเภทการลา" ออกจากหน้าภาพรวมการลา มาเป็นหน้าเดี่ยวใต้เมนู "ตั้งค่า" (เดิมเป็นแท็บใน LeaveOverview.tsx) */
import { Pencil, Plus } from 'lucide-react'
import { useState } from 'react'
import { useDialog } from '../components/Dialog'
import { PageHeader } from '../components/PageHeader'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { LEAVE_ICON_MAP, leaveIconOf } from '../lib/leave-icons'
import { useLoad } from '../lib/useLoad'
import { inputCls, ModalShell, type LeaveTypeAdmin } from './LeaveOverview'

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

export function LeaveTypesSettingsPage() {
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
    <>
      <PageHeader
        title="ตั้งค่าประเภทการลา"
        action={
          <button onClick={() => setModalOpen('new')} className="flex items-center gap-1.5 text-sm bg-brand-600 text-white px-3 py-2 rounded-lg hover:bg-brand-700">
            <Plus className="w-4 h-4" /> เพิ่มประเภท
          </button>
        }
      />
      <div className="p-4 sm:p-6 space-y-3">
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
    </>
  )
}
