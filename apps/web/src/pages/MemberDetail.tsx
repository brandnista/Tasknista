/**
 * Pronista §Membership — รายละเอียดสมาชิก 1 คน แก้ไขฟิลด์ + ดูรายการสั่งซื้อของสมาชิกคนนี้
 */
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useDialog } from '../components/Dialog'
import { DateInputTH } from '../components/DateInputTH'
import { PageHeader } from '../components/PageHeader'
import { SaveBar } from '../components/SaveBar'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { useDraftForm } from '../lib/use-draft-form'
import { useLoad } from '../lib/useLoad'
import { CLASSIFICATION_TYPE_LABEL, type ClassificationType } from './UserSettings'

interface MemberDetail {
  id: string
  name: string
  classificationType: ClassificationType
  orgSizeTierId: string | null
  businessName: string | null
  phone: string | null
  email: string | null
  membershipMode: 'lifetime' | 'dated'
  startDate: string | null
  endDate: string | null
  notifyBeforeDays: number | null
  status: 'active' | 'disabled'
  prefix: string | null
  idCardNumber: string | null
  branchType: 'hq' | 'branch' | null
  branchCode: string | null
  specialNote: string | null
}
interface OrgSizeTier { id: string; name: string; feeSatang: number }
interface MemberOrder { id: string; memberId: string; feeSatang: number; orderedAt: number; status: 'pending' | 'paid' | 'cancelled' }

const fmtBaht = (satang: number) => (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 0 })

export function MemberDetailPage() {
  const toast = useToast()
  const { id } = useParams<{ id: string }>()
  const { confirmDialog, alertDialog } = useDialog()
  const { data: m, reload } = useLoad<MemberDetail>(() => api.get(`/api/members/${id}`), [id])
  const { data: settings } = useLoad<{ memberOrgSizeTiers: OrgSizeTier[]; membershipFees: { classificationType: ClassificationType; feeSatang: number }[] }>(() => api.get('/api/members/settings'))
  const { data: orders, reload: reloadOrders } = useLoad<MemberOrder[]>(() => api.get('/api/member-orders'), [])
  const [idCardError, setIdCardError] = useState('')
  const [saving, setSaving] = useState(false)
  // Pronista §Save button (2026-10-02) — แก้ใน draft แล้วกดปุ่ม "บันทึก" (เดิมบันทึกเองตอนคลิกออกจากช่อง ไม่มีปุ่ม/แจ้งผล)
  const form = useDraftForm<MemberDetail>(m)

  if (!m) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>

  const memberOrders = (orders ?? []).filter((o) => o.memberId === m.id)
  const suggestedFee = settings?.membershipFees.find((f) => f.classificationType === m.classificationType)?.feeSatang ?? 0

  const saveAll = async () => {
    const idCard = form.changes.idCardNumber
    if (typeof idCard === 'string' && !/^\d{13}$/.test(idCard)) {
      setIdCardError('ต้องเป็นตัวเลข 13 หลัก')
      await alertDialog({ title: 'บันทึกไม่ได้', message: 'เลขบัตรประชาชน / Tax ID ต้องเป็นตัวเลข 13 หลัก' })
      return
    }
    const branchCode = form.changes.branchCode
    if (typeof branchCode === 'string' && !/^\d{5}$/.test(branchCode)) {
      await alertDialog({ title: 'บันทึกไม่ได้', message: 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก' })
      return
    }
    if (form.changes.name === null) {
      await alertDialog({ title: 'บันทึกไม่ได้', message: 'ชื่อผู้ติดต่อห้ามว่าง' })
      return
    }
    setIdCardError('')
    setSaving(true)
    try {
      const payload: Record<string, unknown> = { ...form.changes }
      if ('notifyBeforeDays' in payload) payload.notifyBeforeDays = payload.notifyBeforeDays === null ? null : Number(payload.notifyBeforeDays)
      await api.patch(`/api/members/${m.id}`, payload)
      await reload()
      form.reset()
      toast('บันทึกสำเร็จ')
    } catch (err) {
      await alertDialog({ title: 'บันทึกไม่สำเร็จ', message: err instanceof ApiError ? err.message : 'กรุณาลองใหม่อีกครั้ง' })
    } finally {
      setSaving(false)
    }
  }
  const toggleStatus = async () => {
    if (m.status === 'active') {
      const ok = await confirmDialog({ title: `ปิดการใช้งานสมาชิก "${m.name}"?`, message: 'ข้อมูลไม่ถูกลบ', confirmLabel: 'ปิดการใช้งาน', danger: true })
      if (!ok) return
      await api.delete(`/api/members/${m.id}`)
    } else {
      await api.patch<MemberDetail>(`/api/members/${m.id}`, { status: 'active' })
    }
    await reload()
  }
  const createOrder = async () => {
    try {
      await api.post(`/api/members/${m.id}/orders`, { feeSatang: suggestedFee })
      await reloadOrders()
      toast('สร้างคำสั่งซื้อสำเร็จ')
    } catch (err) {
      await alertDialog({ title: 'สร้างคำสั่งซื้อไม่สำเร็จ', message: err instanceof ApiError ? err.message : 'กรุณาลองใหม่อีกครั้ง' })
    }
  }
  const recordPayment = async (orderId: string, amountSatang: number) => {
    try {
      await api.post(`/api/member-orders/${orderId}/payments`, { amountSatang })
      toast('บันทึกสำเร็จ')
      await reloadOrders()
    } catch (err) {
      await alertDialog({ title: 'บันทึกการชำระเงินไม่สำเร็จ', message: err instanceof ApiError ? err.message : 'กรุณาลองใหม่อีกครั้ง' })
    }
  }

  const label = 'text-xs font-medium text-muted mb-1 block'
  const input = 'w-full text-sm bg-white shadow-xs rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
  const text = (k: keyof MemberDetail) => ({ value: form.value(k), onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => form.set(k, ev.target.value) })
  const classification = form.value('classificationType')
  const branchType = form.value('branchType')
  const membershipMode = form.value('membershipMode')
  const isJuristic = classification === 'ordinary_juristic' || classification === 'extraordinary_juristic'
  const isExtraIndividual = classification === 'extraordinary_individual'

  return (
    <>
      <PageHeader
        title={m.businessName || m.name}
        action={
          <button onClick={() => void toggleStatus()} className="inline-flex items-center gap-1.5 text-sm text-danger-600 hover:text-danger-700 border border-border-subtle rounded-lg px-3 py-1.5">
            <Trash2 className="w-3.5 h-3.5" /> {m.status === 'active' ? 'ปิดการใช้งาน' : 'เปิดใช้งาน'}
          </button>
        }
      />
      <div className="p-3 sm:p-6 max-w-2xl space-y-4">
        <Link to="/members" className="text-xs text-muted hover:text-brand-700 inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> สมาชิกทั้งหมด</Link>
        {m.status === 'disabled' && <div className="bg-warning-50 text-warning-700 text-sm rounded-lg px-3 py-2">สมาชิกรายนี้ถูกปิดการใช้งานอยู่</div>}

        <div className="bg-white rounded-lg shadow-xs p-5 space-y-3">
          <div>
            <label className={label}>ประเภท</label>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {(Object.keys(CLASSIFICATION_TYPE_LABEL) as ClassificationType[]).map((t) => (
                <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="classificationType" checked={classification === t} onChange={() => { form.set('classificationType', t); if (t !== 'extraordinary_juristic') form.set('orgSizeTierId', null) }} />
                  {CLASSIFICATION_TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </div>
          {classification === 'extraordinary_juristic' && (
            <div>
              <label className={label}>ขนาดองค์กร</label>
              <select {...text('orgSizeTierId')} className={input}>
                <option value="">— เลือกขนาดองค์กร —</option>
                {(settings?.memberOrgSizeTiers ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} ({fmtBaht(t.feeSatang)} บาท)</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label}>ชื่อธุรกิจ</label>
              <input {...text('businessName')} className={input} />
            </div>
            <div>
              <label className={label}>ชื่อผู้ติดต่อ</label>
              <input {...text('name')} className={input} />
            </div>
            <div>
              <label className={label}>อีเมล</label>
              <input type="email" {...text('email')} className={input} />
            </div>
            <div>
              <label className={label}>เบอร์มือถือ</label>
              <input {...text('phone')} className={input} />
            </div>
            {!isJuristic && (
              <div>
                <label className={label}>คำนำหน้า</label>
                <input {...text('prefix')} className={input} placeholder="นาย/นาง/นางสาว" />
              </div>
            )}
            <div className={isJuristic ? 'sm:col-span-2' : ''}>
              <label className={label}>{isJuristic ? 'เลขทะเบียนนิติบุคคล (Tax ID)' : 'เลขบัตรประชาชน'}</label>
              <input {...text('idCardNumber')} maxLength={13} className={input} placeholder="ตัวเลข 13 หลัก" />
              {idCardError && <div className="text-[11px] text-danger-600 mt-1">{idCardError}</div>}
            </div>
            {isJuristic && (
              <>
                <div>
                  <label className={label}>ประเภทสาขา</label>
                  <select
                    value={branchType}
                    onChange={(ev) => { form.set('branchType', ev.target.value || null); if (ev.target.value !== 'branch') form.set('branchCode', null) }}
                    className={input}
                  >
                    <option value="">— ไม่ระบุ —</option>
                    <option value="hq">สำนักงานใหญ่</option>
                    <option value="branch">สาขา</option>
                  </select>
                </div>
                {branchType === 'branch' && (
                  <div>
                    <label className={label}>รหัสสาขา</label>
                    <input {...text('branchCode')} maxLength={5} className={input} placeholder="ตัวเลข 5 หลัก" />
                  </div>
                )}
              </>
            )}
            {isExtraIndividual && (
              <div className="sm:col-span-2">
                <label className={label}>สังกัดเดิม / ความเชี่ยวชาญพิเศษ / ข้อตกลงพิเศษ</label>
                <textarea rows={2} {...text('specialNote')} className={input} />
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-xs p-5 space-y-3">
          <div className="text-xs font-semibold text-muted uppercase tracking-wide">อายุสมาชิก</div>
          <div className="flex items-center gap-4 text-sm">
            {(['lifetime', 'dated'] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="membershipMode" checked={membershipMode === mode} onChange={() => form.set('membershipMode', mode)} />
                {mode === 'lifetime' ? 'ตลอดชีพ (Lifetime)' : 'มีอายุ (กำหนดวันที่)'}
              </label>
            ))}
          </div>
          {membershipMode === 'dated' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={label}>วันเริ่มต้น</label>
                <DateInputTH value={form.value('startDate')} onChange={(v) => form.set('startDate', v)} className={input} />
              </div>
              <div>
                <label className={label}>วันหมดอายุ</label>
                <DateInputTH value={form.value('endDate')} onChange={(v) => form.set('endDate', v)} className={input} />
              </div>
              <div>
                <label className={label}>แจ้งเตือนล่วงหน้า (วัน)</label>
                <input type="number" min={0} {...text('notifyBeforeDays')} className={input} />
              </div>
            </div>
          )}
        </div>

        <SaveBar dirty={form.dirty} saving={saving} onSave={() => void saveAll()} onDiscard={() => { form.reset(); setIdCardError('') }} />

        <div className="bg-white rounded-lg shadow-xs overflow-hidden">
          <div className="px-5 py-3 border-b border-divider flex items-center justify-between">
            <div className="text-xs font-semibold text-muted uppercase tracking-wide">รายการสั่งซื้อ</div>
            <button onClick={() => void createOrder()} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
              <Plus className="w-3.5 h-3.5" /> สร้างคำสั่งซื้อ ({fmtBaht(suggestedFee)} บาท)
            </button>
          </div>
          {memberOrders.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted">ยังไม่มีรายการสั่งซื้อ</div>
          ) : (
            <div className="divide-y divide-divider">
              {memberOrders.map((o) => (
                <div key={o.id} className="px-5 py-3 flex items-center justify-between text-sm">
                  <div>
                    <div className="text-strong">{fmtBaht(o.feeSatang)} บาท</div>
                    <div className="text-[11px] text-muted">{new Date(o.orderedAt).toLocaleDateString('th-TH')}</div>
                  </div>
                  {o.status === 'paid' ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-success-50 text-success-700">ชำระแล้ว</span>
                  ) : o.status === 'cancelled' ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-hover text-muted">ยกเลิก</span>
                  ) : (
                    <button onClick={() => void recordPayment(o.id, o.feeSatang)} className="text-[11px] px-2.5 py-1 rounded-lg border border-border-subtle hover:bg-hover">
                      บันทึกการชำระเงิน
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
