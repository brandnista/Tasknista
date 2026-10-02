/** Pronista §System Requirements Update — รายละเอียดลูกค้า 1 คน แก้ไขฟิลด์ + โปรเจกต์ที่ผูกอยู่ (บังคับมีอย่างน้อย 1) */
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useDialog } from '../components/Dialog'
import { PageHeader } from '../components/PageHeader'
import { SaveBar } from '../components/SaveBar'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useDraftForm } from '../lib/use-draft-form'
import { useLoad } from '../lib/useLoad'
import { CLASSIFICATION_TYPE_LABEL, contactTypeFor, type ClassificationType } from './UserSettings'

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
  prefix: string | null
  idCardNumber: string | null
  branchType: 'hq' | 'branch' | null
  branchCode: string | null
  specialNote: string | null
}
interface ProjectOpt { id: string; code: string | null; name: string }

export function UserSettingsCustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { confirmDialog, alertDialog } = useDialog()
  const toast = useToast()
  const { user: me } = useAuth()
  const isOwner = me?.role === 'owner'
  const { data: c, reload } = useLoad<CustomerDetail>(() => api.get(`/api/admin/users/${id}`), [id])
  const { data: projects } = useLoad<ProjectOpt[]>(() => api.get('/api/projects'))
  const [idCardError, setIdCardError] = useState('')
  const [saving, setSaving] = useState(false)
  // Pronista §Save button (2026-10-02) — แก้ใน draft แล้วกดปุ่ม "บันทึก" (เดิมบันทึกเองตอนคลิกออกจากช่อง/ติ๊กโปรเจกต์ ไม่มีปุ่ม/แจ้งผล)
  const form = useDraftForm<CustomerDetail>(c)

  if (!c) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>

  const draftProjectIds = (form.raw('projectIds') ?? []) as string[]
  const toggleProject = (projectId: string) =>
    form.set('projectIds', draftProjectIds.includes(projectId) ? draftProjectIds.filter((x) => x !== projectId) : [...draftProjectIds, projectId])

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
    if (draftProjectIds.length === 0) {
      await alertDialog({ title: 'บันทึกไม่ได้', message: 'ลูกค้าต้องผูกอย่างน้อย 1 โปรเจกต์' })
      return
    }
    // Pronista §Admin UX fix (2026-09-15) — ถอดโปรเจกต์ออก = ลูกค้าเห็นข้อมูลโปรเจกต์นั้นไม่ได้อีกทันที ควรถามยืนยันก่อนบันทึก
    const removed = c.projectIds.filter((x) => !draftProjectIds.includes(x))
    if (removed.length > 0) {
      const names = removed.map((rid) => (projects ?? []).find((pr) => pr.id === rid)?.name ?? rid).join(', ')
      const ok = await confirmDialog({
        title: `ถอด ${removed.length} โปรเจกต์ออกจากลูกค้านี้?`,
        message: `${names}\nลูกค้าจะมองไม่เห็นข้อมูลโปรเจกต์เหล่านี้อีกทันที`,
        confirmLabel: 'ถอดออกและบันทึก',
        danger: true,
      })
      if (!ok) return
    }
    setIdCardError('')
    setSaving(true)
    try {
      const payload = { ...form.changes }
      if (typeof payload.email === 'string') payload.email = payload.email.toLowerCase()
      await api.patch(`/api/admin/users/${c.id}`, payload)
      await reload()
      form.reset()
      toast('บันทึกสำเร็จ')
    } catch (e) {
      await alertDialog({
        title: 'บันทึกไม่สำเร็จ',
        message: e instanceof ApiError && e.message === 'email_exists' ? 'อีเมลนี้ถูกใช้แล้ว' : 'กรุณาลองใหม่อีกครั้ง',
      })
    } finally {
      setSaving(false)
    }
  }
  // Pronista §Admin UX fix (2026-09-15) — เดิมไม่มี try/catch เลย (ปิดการใช้งาน = ลูกค้า login ไม่ได้ทันที error ต้องไม่เงียบ)
  const toggleStatus = async () => {
    try {
      await api.patch(`/api/admin/users/${c.id}`, { status: c.status === 'active' ? 'disabled' : 'active' })
      await reload()
    } catch {
      await alertDialog({ title: 'ทำรายการไม่สำเร็จ', message: 'กรุณาลองใหม่อีกครั้ง' })
    }
  }
  // Pronista §Customer detail fix (2026-09-11) — เดิม dialog ยืนยันเขียนว่า "ปิดการใช้งาน" ตายตัวเสมอ ทั้งที่ปุ่มนี้สลับสถานะทั้งสองทาง — ถ้าลูกค้าปิดอยู่แล้วกดปุ่มนี้จะ "เปิดใช้งาน" จริง แต่ dialog หลอกว่ากำลังปิด
  const remove = async () => {
    const disabling = c.status === 'active'
    const ok = await confirmDialog({
      title: `${disabling ? 'ปิด' : 'เปิด'}การใช้งานลูกค้า "${c.businessName || c.name}"?`,
      message: disabling ? 'ลูกค้าจะ login ไม่ได้ทันที (ข้อมูลไม่ถูกลบ)' : 'ลูกค้าจะ login ได้อีกครั้ง',
      confirmLabel: `${disabling ? 'ปิด' : 'เปิด'}การใช้งาน`,
      danger: disabling,
    })
    if (!ok) return
    await toggleStatus()
  }

  const label = 'text-xs font-medium text-muted mb-1 block'
  const input = 'w-full text-sm bg-white shadow-xs rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
  const text = (k: keyof CustomerDetail) => ({ value: form.value(k), onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => form.set(k, ev.target.value) })
  const classification = form.value('classificationType')
  const branchType = form.value('branchType')
  const isJuristic = classification === 'ordinary_juristic' || classification === 'extraordinary_juristic'
  const isExtraIndividual = classification === 'extraordinary_individual'

  return (
    <>
      <PageHeader
        title={c.businessName || c.name}
        action={
          isOwner && (
            <button onClick={() => void remove()} className="inline-flex items-center gap-1.5 text-sm text-danger-600 hover:text-danger-700 border border-border-subtle rounded-lg px-3 py-1.5">
              <Trash2 className="w-3.5 h-3.5" /> {c.status === 'active' ? 'ปิดการใช้งาน' : 'เปิดใช้งาน'}
            </button>
          )
        }
      />
      <div className="p-3 sm:p-6 max-w-2xl space-y-4">
        <Link to="/customers" className="text-xs text-muted hover:text-brand-700 inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> ทุกลูกค้า</Link>
        {c.status === 'disabled' && <div className="bg-warning-50 text-warning-700 text-sm rounded-lg px-3 py-2">ลูกค้ารายนี้ถูกปิดการใช้งานอยู่</div>}

        <div className="bg-white rounded-lg shadow-xs p-5 space-y-3">
          <div>
            <label className={label}>ประเภท</label>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {(Object.keys(CLASSIFICATION_TYPE_LABEL) as ClassificationType[]).map((t) => (
                <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="classificationType" checked={classification === t} onChange={() => { form.set('classificationType', t); form.set('contactType', contactTypeFor(t)) }} />
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
              <label className={label}>อีเมล *</label>
              {isOwner ? (
                <input type="email" {...text('email')} className={input} />
              ) : (
                <input value={c.email} readOnly className={`${input} bg-hover text-muted cursor-not-allowed`} />
              )}
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

        <div className="bg-white rounded-lg shadow-xs p-5">
          <label className={label}>โปรเจกต์ * (บังคับเลือก อย่างน้อย 1 — เลือกได้หลายโปรเจกต์)</label>
          <div className="border border-border-subtle rounded-lg max-h-64 overflow-y-auto divide-y divide-divider">
            {(projects ?? []).length === 0 && <div className="text-xs text-muted px-3 py-4 text-center">ยังไม่มีโปรเจกต์ในระบบ</div>}
            {(projects ?? []).map((p) => (
              <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-hover">
                <input type="checkbox" checked={draftProjectIds.includes(p.id)} onChange={() => toggleProject(p.id)} />
                <span className="text-body truncate">{p.name}</span>
                {p.code && <span className="text-[10px] font-mono text-muted ml-auto shrink-0">{p.code}</span>}
              </label>
            ))}
          </div>
        </div>

        <SaveBar dirty={form.dirty} saving={saving} onSave={() => void saveAll()} onDiscard={() => { form.reset(); setIdCardError('') }} />
      </div>
    </>
  )
}
