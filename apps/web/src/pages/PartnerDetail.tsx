/**
 * Pronista §Partner Detail — รายละเอียดพาร์ทเนอร์ (Outsource) 1 คน แก้ไขฟิลด์ได้ครบ (ต้นแบบจาก EmployeeDetail)
 */
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useDialog } from '../components/Dialog'
import { DateInputTH } from '../components/DateInputTH'
import { PageHeader } from '../components/PageHeader'
import { SaveBar } from '../components/SaveBar'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useDraftForm } from '../lib/use-draft-form'
import { useLoad } from '../lib/useLoad'
import { CLASSIFICATION_TYPE_LABEL, type ClassificationType } from './UserSettings'

interface PartnerDetail {
  id: string
  email: string
  name: string
  status: 'active' | 'disabled'
  businessName: string | null
  phone: string | null
  classificationType: ClassificationType | null
  specialty: string | null
  bankAccount: string | null
  contractType: string | null
  contractExpiryDate: string | null
  prefix: string | null
  idCardNumber: string | null
  branchType: 'hq' | 'branch' | null
  branchCode: string | null
  specialNote: string | null
}

export function PartnerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { confirmDialog, alertDialog } = useDialog()
  const toast = useToast()
  const { user: me } = useAuth()
  const isOwner = me?.role === 'owner'
  const { data: p, reload } = useLoad<PartnerDetail>(() => api.get(`/api/admin/users/${id}`), [id])
  const [idCardError, setIdCardError] = useState('')
  const [saving, setSaving] = useState(false)
  // Pronista §Save button (2026-10-02) — แก้ใน draft แล้วกดปุ่ม "บันทึก" (เดิมบันทึกเองตอนคลิกออกจากช่อง ไม่มีปุ่ม/แจ้งผล)
  const form = useDraftForm<PartnerDetail>(p)

  if (!p) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>

  const saveAll = async () => {
    const idCard = form.changes.idCardNumber
    if (typeof idCard === 'string' && !/^d{13}$/.test(idCard)) {
      setIdCardError('ต้องเป็นตัวเลข 13 หลัก')
      await alertDialog({ title: 'บันทึกไม่ได้', message: 'เลขบัตรประชาชน / Tax ID ต้องเป็นตัวเลข 13 หลัก' })
      return
    }
    const branchCode = form.changes.branchCode
    if (typeof branchCode === 'string' && !/^d{5}$/.test(branchCode)) {
      await alertDialog({ title: 'บันทึกไม่ได้', message: 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก' })
      return
    }
    setIdCardError('')
    setSaving(true)
    try {
      const payload = { ...form.changes }
      if (typeof payload.email === 'string') payload.email = payload.email.toLowerCase()
      await api.patch(`/api/admin/users/${p.id}`, payload)
      await reload()
      form.reset()
      toast('บันทึกสำเร็จ')
    } catch (err) {
      await alertDialog({
        title: 'บันทึกไม่สำเร็จ',
        message: err instanceof ApiError && err.message === 'email_exists' ? 'อีเมลนี้ถูกใช้แล้ว' : 'กรุณาลองใหม่อีกครั้ง',
      })
    } finally {
      setSaving(false)
    }
  }
  const toggleStatus = async () => {
    await api.patch(`/api/admin/users/${p.id}`, { status: p.status === 'active' ? 'disabled' : 'active' })
    await reload()
  }
  // Pronista §Employee/Partner detail fix (2026-09-11) — เดิม dialog เขียนว่า "ปิดการใช้งาน" ตายตัวเสมอ ทั้งที่ปุ่มนี้สลับสถานะสองทาง — ถ้าปิดอยู่แล้วกดปุ่มนี้จะ "เปิดใช้งาน" จริง แต่ dialog หลอกว่ากำลังปิด (บั๊กเดียวกับที่เจอใน UserSettingsCustomerDetail.tsx)
  const disable = async () => {
    const disabling = p.status === 'active'
    const ok = await confirmDialog({
      title: `${disabling ? 'ปิด' : 'เปิด'}การใช้งานพาร์ทเนอร์ "${p.businessName || p.name}"?`,
      message: disabling ? 'พาร์ทเนอร์จะ login ไม่ได้ทันที (ข้อมูลไม่ถูกลบ)' : 'พาร์ทเนอร์จะ login ได้อีกครั้ง',
      confirmLabel: `${disabling ? 'ปิด' : 'เปิด'}การใช้งาน`,
      danger: disabling,
    })
    if (!ok) return
    await toggleStatus()
  }

  const label = 'text-xs font-medium text-muted mb-1 block'
  const input = 'w-full text-sm bg-white shadow-xs rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
  const text = (k: keyof PartnerDetail) => ({ value: form.value(k), onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => form.set(k, ev.target.value) })
  const classification = form.value('classificationType')
  const branchType = form.value('branchType')
  const isJuristic = classification === 'ordinary_juristic' || classification === 'extraordinary_juristic'
  const isExtraIndividual = classification === 'extraordinary_individual'

  return (
    <>
      <PageHeader
        title={p.businessName || p.name}
        action={
          isOwner && (
            <button onClick={() => void disable()} className="inline-flex items-center gap-1.5 text-sm text-danger-600 hover:text-danger-700 border border-border-subtle rounded-lg px-3 py-1.5">
              <Trash2 className="w-3.5 h-3.5" /> {p.status === 'active' ? 'ปิดการใช้งาน' : 'เปิดใช้งาน'}
            </button>
          )
        }
      />
      <div className="p-3 sm:p-6 max-w-2xl space-y-4">
        <Link to="/partners" className="text-xs text-muted hover:text-brand-700 inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> พาร์ทเนอร์ทั้งหมด</Link>
        {p.status === 'disabled' && <div className="bg-warning-50 text-warning-700 text-sm rounded-lg px-3 py-2">พาร์ทเนอร์คนนี้ถูกปิดการใช้งานอยู่</div>}

        <div className="bg-white rounded-lg shadow-xs p-5 space-y-3">
          <div>
            <label className={label}>ประเภท</label>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {(Object.keys(CLASSIFICATION_TYPE_LABEL) as ClassificationType[]).map((t) => (
                <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="classificationType" checked={classification === t} onChange={() => form.set('classificationType', t)} />
                  {CLASSIFICATION_TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </div>
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
              {isOwner ? (
                <input type="email" {...text('email')} className={input} />
              ) : (
                <input value={p.email} readOnly className={`${input} bg-hover text-muted cursor-not-allowed`} />
              )}
            </div>
            <div>
              <label className={label}>เบอร์มือถือ</label>
              <input {...text('phone')} className={input} />
            </div>
            <div>
              <label className={label}>ความเชี่ยวชาญ</label>
              <input {...text('specialty')} className={input} placeholder="เช่น Frontend, UI/UX, ระบบบัญชี" />
            </div>
            <div>
              <label className={label}>บัญชีธนาคาร (สำหรับจ่ายเงิน)</label>
              <input {...text('bankAccount')} className={input} placeholder="ธนาคาร + เลขบัญชี" />
            </div>
            <div>
              <label className={label}>เงื่อนไขสัญญาจ้าง</label>
              <input {...text('contractType')} className={input} placeholder="เช่น รายโปรเจกต์, รายเดือน" />
            </div>
            <div>
              <label className={label}>วันหมดสัญญา</label>
              <DateInputTH value={form.value('contractExpiryDate')} onChange={(v) => form.set('contractExpiryDate', v)} className={input} />
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
                  <select value={branchType} onChange={(ev) => { form.set('branchType', ev.target.value || null); if (ev.target.value !== 'branch') form.set('branchCode', null) }} className={input}>
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

        <SaveBar dirty={form.dirty} saving={saving} onSave={() => void saveAll()} onDiscard={() => { form.reset(); setIdCardError('') }} />
      </div>
    </>
  )
}
