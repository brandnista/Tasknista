/**
 * Pronista §Employee Detail — รายละเอียดพนักงาน 1 คน แก้ไขฟิลด์มาตรฐาน HR ได้ครบ (ต้นแบบจาก UserSettingsCustomerDetail)
 */
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useDialog } from '../components/Dialog'
import { PageHeader } from '../components/PageHeader'
import { api, ApiError } from '../lib/api'
import { ROLE_LABEL } from '../lib/role-label'
import { useLoad } from '../lib/useLoad'

interface EmployeeDetail {
  id: string
  email: string
  name: string
  role: 'owner' | 'member'
  status: 'active' | 'disabled'
  teamId: string | null
  jobTitle: string | null
  phone: string | null
  managerId: string | null
  startDate: string | null
  address: string | null
  idCardNumber: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  employeeCode: string | null
}
interface Team { id: string; name: string }
interface StaffOpt { id: string; name: string; role: 'owner' | 'member' }

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { confirmDialog } = useDialog()
  const { data: e, reload } = useLoad<EmployeeDetail>(() => api.get(`/api/admin/users/${id}`), [id])
  const { data: teams } = useLoad<Team[]>(() => api.get('/api/admin/teams'))
  const { data: allUsers } = useLoad<StaffOpt[]>(() => api.get('/api/admin/users'))
  const [error, setError] = useState('')
  const [idCardError, setIdCardError] = useState('')

  if (!e) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>

  const staffOpts = (allUsers ?? []).filter((u): u is StaffOpt => (u.role === 'owner' || u.role === 'member') && u.id !== e.id)

  const save = async (patch: Partial<Omit<EmployeeDetail, 'id' | 'role' | 'status'>>) => {
    setError('')
    try {
      await api.patch(`/api/admin/users/${e.id}`, patch)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError && err.message === 'email_exists' ? 'อีเมลนี้ถูกใช้แล้ว' : 'บันทึกไม่สำเร็จ')
    }
  }
  const toggleStatus = async () => {
    await api.patch(`/api/admin/users/${e.id}`, { status: e.status === 'active' ? 'disabled' : 'active' })
    await reload()
  }
  const disable = async () => {
    const ok = await confirmDialog({ title: `ปิดการใช้งานพนักงาน "${e.name}"?`, message: 'พนักงานจะ login ไม่ได้ทันที (ข้อมูลไม่ถูกลบ)', confirmLabel: 'ปิดการใช้งาน', danger: true })
    if (!ok) return
    await toggleStatus()
  }

  const label = 'text-xs font-medium text-muted mb-1 block'
  const input = 'w-full text-sm bg-white shadow-xs rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
  const onBlurText = (field: keyof EmployeeDetail, current: string | null) => (ev: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = ev.target.value.trim()
    if (v !== (current ?? '')) void save({ [field]: v || null })
  }
  const onBlurIdCard = (ev: React.FocusEvent<HTMLInputElement>) => {
    const v = ev.target.value.trim()
    if (v && !/^\d{13}$/.test(v)) { setIdCardError('ต้องเป็นตัวเลข 13 หลัก'); return }
    setIdCardError('')
    if (v !== (e.idCardNumber ?? '')) void save({ idCardNumber: v || null })
  }

  return (
    <>
      <PageHeader
        title={e.name}
        action={
          <button onClick={() => void disable()} className="inline-flex items-center gap-1.5 text-sm text-danger-600 hover:text-danger-700 border border-border-subtle rounded-lg px-3 py-1.5">
            <Trash2 className="w-3.5 h-3.5" /> {e.status === 'active' ? 'ปิดการใช้งาน' : 'เปิดใช้งานแล้ว'}
          </button>
        }
      />
      <div className="p-3 sm:p-6 max-w-2xl space-y-4">
        <Link to="/employees" className="text-xs text-muted hover:text-brand-700 inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> พนักงานทั้งหมด</Link>
        {error && <div className="bg-danger-50 text-danger-700 text-sm rounded-lg px-3 py-2">{error}</div>}
        {e.status === 'disabled' && <div className="bg-warning-50 text-warning-700 text-sm rounded-lg px-3 py-2">พนักงานคนนี้ถูกปิดการใช้งานอยู่</div>}

        <div className="bg-white rounded-lg shadow-xs p-5 space-y-3">
          <div className="text-xs font-semibold text-muted uppercase tracking-wide">ข้อมูลพื้นฐาน</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label}>ชื่อ</label>
              <input defaultValue={e.name} onBlur={onBlurText('name', e.name)} className={input} />
            </div>
            <div>
              <label className={label}>อีเมล</label>
              <input type="email" defaultValue={e.email} onBlur={(ev) => void save({ email: ev.target.value.trim().toLowerCase() })} className={input} />
            </div>
            <div>
              <label className={label}>เบอร์โทร</label>
              <input defaultValue={e.phone ?? ''} onBlur={onBlurText('phone', e.phone)} className={input} />
            </div>
            <div>
              <label className={label}>ตำแหน่ง</label>
              <input defaultValue={e.jobTitle ?? ''} onBlur={onBlurText('jobTitle', e.jobTitle)} className={input} />
            </div>
            <div>
              <label className={label}>ทีม</label>
              <select value={e.teamId ?? ''} onChange={(ev) => void save({ teamId: ev.target.value || null })} className={input}>
                <option value="">— ไม่ระบุทีม —</option>
                {(teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>หัวหน้าโดยตรง</label>
              <select value={e.managerId ?? ''} onChange={(ev) => void save({ managerId: ev.target.value || null })} className={input}>
                <option value="">— ยังไม่ตั้ง —</option>
                {staffOpts.map((s) => <option key={s.id} value={s.id}>{s.name} ({ROLE_LABEL[s.role]})</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-xs p-5 space-y-3">
          <div className="text-xs font-semibold text-muted uppercase tracking-wide">ข้อมูลเพิ่มเติม</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label}>วันเริ่มงาน</label>
              <input type="date" defaultValue={e.startDate ?? ''} onBlur={onBlurText('startDate', e.startDate)} className={input} />
            </div>
            <div>
              <label className={label}>เลขบัตรประชาชน</label>
              <input defaultValue={e.idCardNumber ?? ''} onBlur={onBlurIdCard} maxLength={13} className={input} placeholder="ตัวเลข 13 หลัก" />
              {idCardError && <div className="text-[11px] text-danger-600 mt-1">{idCardError}</div>}
            </div>
            <div>
              <label className={label}>รหัสพนักงาน</label>
              <input value={e.employeeCode ?? '—'} readOnly className={`${input} bg-hover text-muted cursor-not-allowed`} />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>ที่อยู่</label>
              <textarea rows={2} defaultValue={e.address ?? ''} onBlur={onBlurText('address', e.address)} className={input} />
            </div>
            <div>
              <label className={label}>ผู้ติดต่อฉุกเฉิน (ชื่อ)</label>
              <input defaultValue={e.emergencyContactName ?? ''} onBlur={onBlurText('emergencyContactName', e.emergencyContactName)} className={input} />
            </div>
            <div>
              <label className={label}>ผู้ติดต่อฉุกเฉิน (เบอร์โทร)</label>
              <input defaultValue={e.emergencyContactPhone ?? ''} onBlur={onBlurText('emergencyContactPhone', e.emergencyContactPhone)} className={input} />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
