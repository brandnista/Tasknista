/** Pronista §System Requirements Update — รายละเอียดลูกค้า 1 คน แก้ไขฟิลด์ + โปรเจกต์ที่ผูกอยู่ (บังคับมีอย่างน้อย 1) */
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useDialog } from '../components/Dialog'
import { PageHeader } from '../components/PageHeader'
import { api, ApiError } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { CLASSIFICATION_TYPE_LABEL, CONTACT_TYPE_LABEL, type ClassificationType } from './UserSettings'

interface CustomerDetail {
  id: string
  email: string
  name: string
  status: 'active' | 'disabled'
  contactType: 'juristic' | 'individual' | null
  businessName: string | null
  phone: string | null
  projectIds: string[]
  classificationType: ClassificationType | null
}
interface ProjectOpt { id: string; code: string | null; name: string }

export function UserSettingsCustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { confirmDialog } = useDialog()
  const { data: c, reload } = useLoad<CustomerDetail>(() => api.get(`/api/admin/users/${id}`), [id])
  const { data: projects } = useLoad<ProjectOpt[]>(() => api.get('/api/projects'))
  const [error, setError] = useState('')

  if (!c) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>

  const save = async (patch: Partial<Pick<CustomerDetail, 'name' | 'businessName' | 'phone' | 'email' | 'contactType' | 'classificationType'>>) => {
    setError('')
    try {
      await api.patch(`/api/admin/users/${c.id}`, patch)
      await reload()
    } catch (e) {
      setError(e instanceof ApiError && e.message === 'email_exists' ? 'อีเมลนี้ถูกใช้แล้ว' : 'บันทึกไม่สำเร็จ')
    }
  }
  const toggleProject = async (projectId: string) => {
    const next = c.projectIds.includes(projectId) ? c.projectIds.filter((x) => x !== projectId) : [...c.projectIds, projectId]
    if (next.length === 0) {
      setError('ลูกค้าต้องผูกอย่างน้อย 1 โปรเจกต์')
      return
    }
    setError('')
    await api.patch(`/api/admin/users/${c.id}`, { projectIds: next })
    await reload()
  }
  const toggleStatus = async () => {
    await api.patch(`/api/admin/users/${c.id}`, { status: c.status === 'active' ? 'disabled' : 'active' })
    await reload()
  }
  const remove = async () => {
    const ok = await confirmDialog({ title: `ปิดการใช้งานลูกค้า "${c.businessName || c.name}"?`, message: 'ลูกค้าจะ login ไม่ได้ทันที (ข้อมูลไม่ถูกลบ)', confirmLabel: 'ปิดการใช้งาน', danger: true })
    if (!ok) return
    await toggleStatus()
  }

  const label = 'text-xs font-medium text-muted mb-1 block'
  const input = 'w-full text-sm bg-white shadow-xs rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'

  return (
    <>
      <PageHeader
        title={c.businessName || c.name}
        action={
          <button onClick={() => void remove()} className="inline-flex items-center gap-1.5 text-sm text-danger-600 hover:text-danger-700 border border-border-subtle rounded-lg px-3 py-1.5">
            <Trash2 className="w-3.5 h-3.5" /> {c.status === 'active' ? 'ปิดการใช้งาน' : 'เปิดใช้งานแล้ว'}
          </button>
        }
      />
      <div className="p-3 sm:p-6 max-w-2xl space-y-4">
        <Link to="/customers" className="text-xs text-muted hover:text-brand-700 inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> ทุกลูกค้า</Link>
        {error && <div className="bg-danger-50 text-danger-700 text-sm rounded-lg px-3 py-2">{error}</div>}
        {c.status === 'disabled' && <div className="bg-warning-50 text-warning-700 text-sm rounded-lg px-3 py-2">ลูกค้ารายนี้ถูกปิดการใช้งานอยู่</div>}

        <div className="bg-white rounded-lg shadow-xs p-5 space-y-3">
          <div>
            <label className={label}>ประเภทผู้ติดต่อ</label>
            <div className="flex items-center gap-4 text-sm">
              {(['juristic', 'individual'] as const).map((t) => (
                <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="contactType" checked={(c.contactType ?? 'juristic') === t} onChange={() => void save({ contactType: t })} />
                  {CONTACT_TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className={label}>ประเภท</label>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {(Object.keys(CLASSIFICATION_TYPE_LABEL) as ClassificationType[]).map((t) => (
                <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="classificationType" checked={c.classificationType === t} onChange={() => void save({ classificationType: t })} />
                  {CLASSIFICATION_TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label}>ชื่อธุรกิจ</label>
              <input defaultValue={c.businessName ?? ''} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (c.businessName ?? '')) void save({ businessName: v || null }) }} className={input} />
            </div>
            <div>
              <label className={label}>ชื่อผู้ติดต่อ</label>
              <input defaultValue={c.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) void save({ name: v }) }} className={input} />
            </div>
            <div>
              <label className={label}>อีเมล *</label>
              <input type="email" defaultValue={c.email} onBlur={(e) => void save({ email: e.target.value.trim().toLowerCase() })} className={input} />
            </div>
            <div>
              <label className={label}>เบอร์มือถือ</label>
              <input defaultValue={c.phone ?? ''} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (c.phone ?? '')) void save({ phone: v || null }) }} className={input} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-xs p-5">
          <label className={label}>โปรเจกต์ * (บังคับเลือก อย่างน้อย 1 — เลือกได้หลายโปรเจกต์)</label>
          <div className="border border-border-subtle rounded-lg max-h-64 overflow-y-auto divide-y divide-divider">
            {(projects ?? []).length === 0 && <div className="text-xs text-muted px-3 py-4 text-center">ยังไม่มีโปรเจกต์ในระบบ</div>}
            {(projects ?? []).map((p) => (
              <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-hover">
                <input type="checkbox" checked={c.projectIds.includes(p.id)} onChange={() => void toggleProject(p.id)} />
                <span className="text-body truncate">{p.name}</span>
                {p.code && <span className="text-[10px] font-mono text-muted ml-auto shrink-0">{p.code}</span>}
              </label>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
