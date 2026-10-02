/**
 * Pronista §Employee Detail — รายละเอียดพนักงาน 1 คน แก้ไขฟิลด์มาตรฐาน HR ได้ครบ (ต้นแบบจาก UserSettingsCustomerDetail)
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
import { ROLE_LABEL } from '../lib/role-label'
import { useDraftForm } from '../lib/use-draft-form'
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
  const { confirmDialog, alertDialog } = useDialog()
  const toast = useToast()
  const { user: me } = useAuth()
  const isOwner = me?.role === 'owner'
  const { data: e, reload } = useLoad<EmployeeDetail>(() => api.get(`/api/admin/users/${id}`), [id])
  const { data: teams } = useLoad<Team[]>(() => api.get('/api/admin/teams'))
  const { data: allUsers } = useLoad<StaffOpt[]>(() => api.get('/api/admin/users'))
  const [idCardError, setIdCardError] = useState('')
  const [saving, setSaving] = useState(false)
  // Pronista §Save button (2026-10-02) — เดิมบันทึกเองตอนคลิกออกจากช่อง ไม่มีปุ่ม/แจ้งผล → ตอนนี้แก้ใน draft แล้วกดปุ่ม "บันทึก" (แจ้งผลด้วย toast/popup)
  const form = useDraftForm<EmployeeDetail>(e)

  if (!e) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>

  const staffOpts = (allUsers ?? []).filter((u): u is StaffOpt => (u.role === 'owner' || u.role === 'member') && u.id !== e.id)

  const saveAll = async () => {
    const idCard = form.changes.idCardNumber
    if (typeof idCard === 'string' && !/^d{13}$/.test(idCard)) {
      setIdCardError('ต้องเป็นตัวเลข 13 หลัก')
      await alertDialog({ title: 'บันทึกไม่ได้', message: 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก' })
      return
    }
    setIdCardError('')
    setSaving(true)
    try {
      const payload = { ...form.changes }
      if (typeof payload.email === 'string') payload.email = payload.email.toLowerCase()
      await api.patch(`/api/admin/users/${e.id}`, payload)
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
    await api.patch(`/api/admin/users/${e.id}`, { status: e.status === 'active' ? 'disabled' : 'active' })
    await reload()
  }
  // Pronista §Employee/Partner detail fix (2026-09-11) — เดิม dialog เขียนว่า "ปิดการใช้งาน" ตายตัวเสมอ ทั้งที่ปุ่มนี้สลับสถานะสองทาง — ถ้าปิดอยู่แล้วกดปุ่มนี้จะ "เปิดใช้งาน" จริง แต่ dialog หลอกว่ากำลังปิด (บั๊กเดียวกับที่เจอใน UserSettingsCustomerDetail.tsx)
  const disable = async () => {
    const disabling = e.status === 'active'
    const ok = await confirmDialog({
      title: `${disabling ? 'ปิด' : 'เปิด'}การใช้งานพนักงาน "${e.name}"?`,
      message: disabling ? 'พนักงานจะ login ไม่ได้ทันที (ข้อมูลไม่ถูกลบ)' : 'พนักงานจะ login ได้อีกครั้ง',
      confirmLabel: `${disabling ? 'ปิด' : 'เปิด'}การใช้งาน`,
      danger: disabling,
    })
    if (!ok) return
    await toggleStatus()
  }

  const label = 'text-xs font-medium text-muted mb-1 block'
  const input = 'w-full text-sm bg-white shadow-xs rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
  const text = (k: keyof EmployeeDetail) => ({ value: form.value(k), onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => form.set(k, ev.target.value) })

  return (
    <>
      <PageHeader
        title={e.name}
        action={
          isOwner && (
            <button onClick={() => void disable()} className="inline-flex items-center gap-1.5 text-sm text-danger-600 hover:text-danger-700 border border-border-subtle rounded-lg px-3 py-1.5">
              <Trash2 className="w-3.5 h-3.5" /> {e.status === 'active' ? 'ปิดการใช้งาน' : 'เปิดใช้งาน'}
            </button>
          )
        }
      />
      <div className="p-3 sm:p-6 max-w-2xl space-y-4">
        <Link to="/employees" className="text-xs text-muted hover:text-brand-700 inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> พนักงานทั้งหมด</Link>
        {e.status === 'disabled' && <div className="bg-warning-50 text-warning-700 text-sm rounded-lg px-3 py-2">พนักงานคนนี้ถูกปิดการใช้งานอยู่</div>}

        <div className="bg-white rounded-lg shadow-xs p-5 space-y-3">
          <div className="text-xs font-semibold text-muted uppercase tracking-wide">ข้อมูลพื้นฐาน</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label}>ชื่อ</label>
              <input {...text('name')} className={input} />
            </div>
            <div>
              <label className={label}>อีเมล</label>
              {isOwner ? (
                <input type="email" {...text('email')} className={input} />
              ) : (
                <input value={e.email} readOnly className={`${input} bg-hover text-muted cursor-not-allowed`} />
              )}
            </div>
            <div>
              <label className={label}>เบอร์โทร</label>
              <input {...text('phone')} className={input} />
            </div>
            <div>
              <label className={label}>ตำแหน่ง</label>
              <input {...text('jobTitle')} className={input} />
            </div>
            <div>
              <label className={label}>ทีม</label>
              <select {...text('teamId')} className={input}>
                <option value="">— ไม่ระบุทีม —</option>
                {(teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>หัวหน้าโดยตรง</label>
              <select {...text('managerId')} className={input}>
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
              <DateInputTH value={form.value('startDate')} onChange={(v) => form.set('startDate', v)} className={input} />
            </div>
            <div>
              <label className={label}>เลขบัตรประชาชน</label>
              <input {...text('idCardNumber')} maxLength={13} className={input} placeholder="ตัวเลข 13 หลัก" />
              {idCardError && <div className="text-[11px] text-danger-600 mt-1">{idCardError}</div>}
            </div>
            <div>
              <label className={label}>รหัสพนักงาน</label>
              <input value={e.employeeCode ?? '—'} readOnly className={`${input} bg-hover text-muted cursor-not-allowed`} />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>ที่อยู่</label>
              <textarea rows={2} {...text('address')} className={input} />
            </div>
            <div>
              <label className={label}>ผู้ติดต่อฉุกเฉิน (ชื่อ)</label>
              <input {...text('emergencyContactName')} className={input} />
            </div>
            <div>
              <label className={label}>ผู้ติดต่อฉุกเฉิน (เบอร์โทร)</label>
              <input {...text('emergencyContactPhone')} className={input} />
            </div>
          </div>
        </div>

        <SaveBar dirty={form.dirty} saving={saving} onSave={() => void saveAll()} onDiscard={() => { form.reset(); setIdCardError('') }} />
      </div>
    </>
  )
}
