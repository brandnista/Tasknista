/**
 * Pronista §Partner Detail — รายละเอียดพาร์ทเนอร์ (Outsource) 1 คน แก้ไขฟิลด์ได้ครบ (ต้นแบบจาก EmployeeDetail)
 */
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useDialog } from '../components/Dialog'
import { PageHeader } from '../components/PageHeader'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
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
  const { confirmDialog } = useDialog()
  const { user: me } = useAuth()
  const isOwner = me?.role === 'owner'
  const { data: p, reload } = useLoad<PartnerDetail>(() => api.get(`/api/admin/users/${id}`), [id])
  const [error, setError] = useState('')
  const [idCardError, setIdCardError] = useState('')

  if (!p) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>

  const save = async (patch: Partial<Omit<PartnerDetail, 'id' | 'status'>>) => {
    setError('')
    try {
      await api.patch(`/api/admin/users/${p.id}`, patch)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError && err.message === 'email_exists' ? 'อีเมลนี้ถูกใช้แล้ว' : 'บันทึกไม่สำเร็จ')
    }
  }
  const toggleStatus = async () => {
    await api.patch(`/api/admin/users/${p.id}`, { status: p.status === 'active' ? 'disabled' : 'active' })
    await reload()
  }
  const disable = async () => {
    const ok = await confirmDialog({ title: `ปิดการใช้งานพาร์ทเนอร์ "${p.businessName || p.name}"?`, message: 'พาร์ทเนอร์จะ login ไม่ได้ทันที (ข้อมูลไม่ถูกลบ)', confirmLabel: 'ปิดการใช้งาน', danger: true })
    if (!ok) return
    await toggleStatus()
  }

  const label = 'text-xs font-medium text-muted mb-1 block'
  const input = 'w-full text-sm bg-white shadow-xs rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
  const onBlurText = (field: keyof PartnerDetail, current: string | null) => (ev: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = ev.target.value.trim()
    if (v !== (current ?? '')) void save({ [field]: v || null })
  }
  const isJuristic = p.classificationType === 'ordinary_juristic' || p.classificationType === 'extraordinary_juristic'
  const isExtraIndividual = p.classificationType === 'extraordinary_individual'
  const onBlurIdCard = (ev: React.FocusEvent<HTMLInputElement>) => {
    const v = ev.target.value.trim()
    if (v && !/^\d{13}$/.test(v)) { setIdCardError('ต้องเป็นตัวเลข 13 หลัก'); return }
    setIdCardError('')
    if (v !== (p.idCardNumber ?? '')) void save({ idCardNumber: v || null })
  }
  const onBlurBranchCode = (ev: React.FocusEvent<HTMLInputElement>) => {
    const v = ev.target.value.trim()
    if (v && !/^\d{5}$/.test(v)) return
    if (v !== (p.branchCode ?? '')) void save({ branchCode: v || null })
  }

  return (
    <>
      <PageHeader
        title={p.businessName || p.name}
        action={
          isOwner && (
            <button onClick={() => void disable()} className="inline-flex items-center gap-1.5 text-sm text-danger-600 hover:text-danger-700 border border-border-subtle rounded-lg px-3 py-1.5">
              <Trash2 className="w-3.5 h-3.5" /> {p.status === 'active' ? 'ปิดการใช้งาน' : 'เปิดใช้งานแล้ว'}
            </button>
          )
        }
      />
      <div className="p-3 sm:p-6 max-w-2xl space-y-4">
        <Link to="/partners" className="text-xs text-muted hover:text-brand-700 inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> พาร์ทเนอร์ทั้งหมด</Link>
        {error && <div className="bg-danger-50 text-danger-700 text-sm rounded-lg px-3 py-2">{error}</div>}
        {p.status === 'disabled' && <div className="bg-warning-50 text-warning-700 text-sm rounded-lg px-3 py-2">พาร์ทเนอร์คนนี้ถูกปิดการใช้งานอยู่</div>}

        <div className="bg-white rounded-lg shadow-xs p-5 space-y-3">
          <div>
            <label className={label}>ประเภท</label>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {(Object.keys(CLASSIFICATION_TYPE_LABEL) as ClassificationType[]).map((t) => (
                <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="classificationType" checked={p.classificationType === t} onChange={() => void save({ classificationType: t })} />
                  {CLASSIFICATION_TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label}>ชื่อธุรกิจ</label>
              <input defaultValue={p.businessName ?? ''} onBlur={onBlurText('businessName', p.businessName)} className={input} />
            </div>
            <div>
              <label className={label}>ชื่อผู้ติดต่อ</label>
              <input defaultValue={p.name} onBlur={onBlurText('name', p.name)} className={input} />
            </div>
            <div>
              <label className={label}>อีเมล</label>
              {isOwner ? (
                <input type="email" defaultValue={p.email} onBlur={(ev) => void save({ email: ev.target.value.trim().toLowerCase() })} className={input} />
              ) : (
                <input value={p.email} readOnly className={`${input} bg-hover text-muted cursor-not-allowed`} />
              )}
            </div>
            <div>
              <label className={label}>เบอร์มือถือ</label>
              <input defaultValue={p.phone ?? ''} onBlur={onBlurText('phone', p.phone)} className={input} />
            </div>
            <div>
              <label className={label}>ความเชี่ยวชาญ</label>
              <input defaultValue={p.specialty ?? ''} onBlur={onBlurText('specialty', p.specialty)} className={input} placeholder="เช่น Frontend, UI/UX, ระบบบัญชี" />
            </div>
            <div>
              <label className={label}>บัญชีธนาคาร (สำหรับจ่ายเงิน)</label>
              <input defaultValue={p.bankAccount ?? ''} onBlur={onBlurText('bankAccount', p.bankAccount)} className={input} placeholder="ธนาคาร + เลขบัญชี" />
            </div>
            <div>
              <label className={label}>เงื่อนไขสัญญาจ้าง</label>
              <input defaultValue={p.contractType ?? ''} onBlur={onBlurText('contractType', p.contractType)} className={input} placeholder="เช่น รายโปรเจกต์, รายเดือน" />
            </div>
            <div>
              <label className={label}>วันหมดสัญญา</label>
              <input type="date" defaultValue={p.contractExpiryDate ?? ''} onBlur={(ev) => { const v = ev.target.value; if (v !== (p.contractExpiryDate ?? '')) void save({ contractExpiryDate: v || null }) }} className={input} />
            </div>
            {!isJuristic && (
              <div>
                <label className={label}>คำนำหน้า</label>
                <input defaultValue={p.prefix ?? ''} onBlur={onBlurText('prefix', p.prefix)} className={input} placeholder="นาย/นาง/นางสาว" />
              </div>
            )}
            <div className={isJuristic ? 'sm:col-span-2' : ''}>
              <label className={label}>{isJuristic ? 'เลขทะเบียนนิติบุคคล (Tax ID)' : 'เลขบัตรประชาชน'}</label>
              <input defaultValue={p.idCardNumber ?? ''} onBlur={onBlurIdCard} maxLength={13} className={input} placeholder="ตัวเลข 13 หลัก" />
              {idCardError && <div className="text-[11px] text-danger-600 mt-1">{idCardError}</div>}
            </div>
            {isJuristic && (
              <>
                <div>
                  <label className={label}>ประเภทสาขา</label>
                  <select defaultValue={p.branchType ?? ''} onChange={(ev) => void save({ branchType: (ev.target.value || null) as PartnerDetail['branchType'], branchCode: ev.target.value === 'branch' ? p.branchCode : null })} className={input}>
                    <option value="">— ไม่ระบุ —</option>
                    <option value="hq">สำนักงานใหญ่</option>
                    <option value="branch">สาขา</option>
                  </select>
                </div>
                {p.branchType === 'branch' && (
                  <div>
                    <label className={label}>รหัสสาขา</label>
                    <input defaultValue={p.branchCode ?? ''} onBlur={onBlurBranchCode} maxLength={5} className={input} placeholder="ตัวเลข 5 หลัก" />
                  </div>
                )}
              </>
            )}
            {isExtraIndividual && (
              <div className="sm:col-span-2">
                <label className={label}>สังกัดเดิม / ความเชี่ยวชาญพิเศษ / ข้อตกลงพิเศษ</label>
                <textarea rows={2} defaultValue={p.specialNote ?? ''} onBlur={onBlurText('specialNote', p.specialNote)} className={input} />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
