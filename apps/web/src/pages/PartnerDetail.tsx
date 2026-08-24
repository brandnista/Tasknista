/**
 * Pronista §Partner Detail — รายละเอียดพาร์ทเนอร์ (Outsource) 1 คน แก้ไขฟิลด์ได้ครบ (ต้นแบบจาก EmployeeDetail)
 */
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useDialog } from '../components/Dialog'
import { PageHeader } from '../components/PageHeader'
import { api, ApiError } from '../lib/api'
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
}

export function PartnerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { confirmDialog } = useDialog()
  const { data: p, reload } = useLoad<PartnerDetail>(() => api.get(`/api/admin/users/${id}`), [id])
  const [error, setError] = useState('')

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

  return (
    <>
      <PageHeader
        title={p.businessName || p.name}
        action={
          <button onClick={() => void disable()} className="inline-flex items-center gap-1.5 text-sm text-danger-600 hover:text-danger-700 border border-border-subtle rounded-lg px-3 py-1.5">
            <Trash2 className="w-3.5 h-3.5" /> {p.status === 'active' ? 'ปิดการใช้งาน' : 'เปิดใช้งานแล้ว'}
          </button>
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
              <input type="email" defaultValue={p.email} onBlur={(ev) => void save({ email: ev.target.value.trim().toLowerCase() })} className={input} />
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
          </div>
        </div>
      </div>
    </>
  )
}
