/**
 * Pronista §Menu Restructure — โครง list ที่ใช้ร่วมกัน 3 เมนูหลัก (จัดการพนักงาน/จัดการพาร์ทเนอร์/จัดการลูกค้า)
 * เดิมเป็น 3 แท็บในหน้า "ตั้งค่าผู้ใช้งาน" หน้าเดียว — ตอนนี้แยก route คนละเมนูแล้ว (ไม่มี tab-switcher ในหน้าอีกต่อไป)
 * ลูกค้า = List → กดเข้าไปดู/แก้รายละเอียดที่หน้า UserSettingsCustomerDetail (/customers/:id)
 * พนักงาน = List → กดเข้าไปดู/แก้รายละเอียดที่หน้า EmployeeDetail (/employees/:id)
 */
import { Plus, SquarePen, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { PageHeader } from '../components/PageHeader'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ROLE_LABEL, ROLE_BADGE } from '../lib/role-label'
import { useLoad } from '../lib/useLoad'

interface Team { id: string; name: string }
interface AdminUser {
  id: string
  email: string
  name: string
  role: 'owner' | 'member' | 'vendor' | 'guest'
  status: 'active' | 'disabled'
  teamId: string | null
  teamName: string | null
  jobTitle: string | null
  costPerDaySatang: number | null
  contactType: 'juristic' | 'individual' | null
  businessName: string | null
  phone: string | null
  projectIds: string[]
  // Pronista §Daily Report — "หัวหน้าโดยตรง" ผู้รับ Daily Report ของคนนี้
  managerId: string | null
  // Pronista §Partner/Client Classification — role='vendor'/'guest'
  classificationType: ClassificationType | null
  // Pronista §Entity Types Alignment — ฟิลด์ dynamic ตาม บุคคล/นิติบุคคล + เฉพาะทาง
  prefix: string | null
  idCardNumber: string | null
  branchType: 'hq' | 'branch' | null
  branchCode: string | null
  specialNote: string | null
  contractType: string | null
  contractExpiryDate: string | null
  employeeCode: string | null
}
interface ProjectOpt { id: string; code: string | null; name: string }

export type ClassificationType = 'ordinary_individual' | 'ordinary_juristic' | 'extraordinary_individual' | 'extraordinary_juristic'
// Pronista §Client Menu Cleanup — contactType (นิติบุคคล/บุคคลธรรมดา) ซ้ำซ้อนกับแกน individual/juristic ใน classificationType
// เลิกให้เลือกแยก แต่ยัง derive ส่งไป backend อัตโนมัติเพื่อให้ contactType เดิม (ที่ยังมีอยู่ใน schema) sync ตามอยู่เสมอ
export const contactTypeFor = (t: ClassificationType): 'individual' | 'juristic' => (t === 'ordinary_individual' || t === 'extraordinary_individual' ? 'individual' : 'juristic')
// Pronista §Partner/Client/Member Classification — ชุดนิยามเดียวกันใช้ซ้ำทั้งพาร์ทเนอร์/ลูกค้า/สมาชิก (เกณฑ์แยกยังไม่นิ่ง — radio ให้เลือกไปก่อน)
export const CLASSIFICATION_TYPE_LABEL: Record<ClassificationType, string> = {
  ordinary_individual: 'สามัญบุคคล',
  ordinary_juristic: 'สามัญนิติบุคคล',
  extraordinary_individual: 'วิสามัญบุคคล',
  extraordinary_juristic: 'วิสามัญนิติบุคคล',
}
type UserTab = 'staff' | 'outsource' | 'customer'

function AddTeamForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const submit = async () => {
    try {
      await api.post('/api/admin/teams', { name: name.trim() })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ผิดพลาด')
    }
  }
  return (
    <div className="p-4 bg-hover rounded-lg space-y-2">
      <div className="flex gap-2">
        <input
          autoFocus
          placeholder="ชื่อทีมใหม่ เช่น ฝ่ายขาย"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          className="flex-1 text-sm bg-white shadow-xs rounded-lg px-3 py-2"
        />
        <button
          onClick={() => void submit()}
          disabled={!name.trim()}
          className="text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg whitespace-nowrap"
        >
          บันทึกทีม
        </button>
      </div>
      {error && <div className="text-xs text-danger-600">{error}</div>}
    </div>
  )
}

/** popup กลาง — pattern เดียวกับที่ใช้ทั่วแอป (fixed inset-0 bg-ink/40 + card กลางจอ, คลิก backdrop ปิด) — export ให้ Members.tsx ใช้ร่วมด้วย */
export function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-ink/40 z-50 flex items-start justify-center p-4 sm:pt-[8vh]" onClick={onClose}>
      <div className={`bg-white rounded-xl shadow-lg w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[85vh] flex flex-col`} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-divider flex items-center justify-between shrink-0">
          <div className="font-semibold text-strong">{title}</div>
          <button onClick={onClose} className="text-muted hover:text-body text-xl leading-none">&times;</button>
        </div>
        <div className="p-5 overflow-y-auto space-y-3">{children}</div>
      </div>
    </div>
  )
}

export const fieldInput = 'w-full text-sm bg-white shadow-xs border border-border-subtle rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'
export const fieldLabel = 'text-xs font-medium text-muted mb-1 block'

/** เพิ่มพนักงานใหม่ (role='member'/'owner') — ฟิลด์เท่ากับหน้าแก้ไข EmployeeDetail ทุกฟิลด์ */
function AddStaffForm({ memberDomain, teamsList, staffOpts, onClose, onCreated }: { memberDomain?: string; teamsList: Team[]; staffOpts: AdminUser[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({
    name: '', email: '', role: 'member' as 'member' | 'owner', teamId: '', managerId: '', phone: '', jobTitle: '',
    startDate: '', address: '', idCardNumber: '', emergencyContactName: '', emergencyContactPhone: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const created = await api.post<{ id: string }>('/api/admin/users', {
        email: form.email, name: form.name, role: form.role,
        teamId: form.teamId || null, managerId: form.managerId || null, phone: form.phone || null, jobTitle: form.jobTitle || null,
        startDate: form.startDate || null, address: form.address || null, idCardNumber: form.idCardNumber || null,
        emergencyContactName: form.emergencyContactName || null, emergencyContactPhone: form.emergencyContactPhone || null,
      })
      onCreated(created.id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'ผิดพลาด')
    } finally {
      setBusy(false)
    }
  }
  return (
    <ModalShell title="เพิ่มพนักงาน" onClose={onClose}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className={fieldLabel}>ชื่อ *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={fieldInput} /></div>
        <div><label className={fieldLabel}>อีเมล *</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={fieldInput} /></div>
        <div>
          <label className={fieldLabel}>สิทธิ์ระบบ</label>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'member' | 'owner' })} className={fieldInput}>
            <option value="member">พนักงาน</option>
            <option value="owner">Admin</option>
          </select>
        </div>
        <div><label className={fieldLabel}>เบอร์โทร</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={fieldInput} /></div>
        <div><label className={fieldLabel}>ตำแหน่ง</label><input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} className={fieldInput} /></div>
        <div>
          <label className={fieldLabel}>ทีม</label>
          <select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })} className={fieldInput}>
            <option value="">— ไม่ระบุทีม —</option>
            {teamsList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className={fieldLabel}>หัวหน้าโดยตรง</label>
          <select value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })} className={fieldInput}>
            <option value="">— ยังไม่ตั้ง —</option>
            {staffOpts.map((s) => <option key={s.id} value={s.id}>{s.name} ({ROLE_LABEL[s.role]})</option>)}
          </select>
        </div>
        <div><label className={fieldLabel}>วันเริ่มงาน</label><input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={fieldInput} /></div>
        <div><label className={fieldLabel}>เลขบัตรประชาชน</label><input value={form.idCardNumber} onChange={(e) => setForm({ ...form, idCardNumber: e.target.value })} className={fieldInput} /></div>
        <div className="sm:col-span-2"><label className={fieldLabel}>ที่อยู่</label><textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={fieldInput} /></div>
        <div><label className={fieldLabel}>ผู้ติดต่อฉุกเฉิน (ชื่อ)</label><input value={form.emergencyContactName} onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })} className={fieldInput} /></div>
        <div><label className={fieldLabel}>ผู้ติดต่อฉุกเฉิน (เบอร์โทร)</label><input value={form.emergencyContactPhone} onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })} className={fieldInput} /></div>
      </div>
      <p className="text-[11px] text-muted">
        {memberDomain ? `พนักงาน = โดเมน ${memberDomain} (login ได้เองอยู่แล้ว)` : 'พนักงาน = ยังไม่ตั้งโดเมน auto-provision (ตั้งได้ที่ ค่าบริษัท)'}
      </p>
      {error && <div className="text-xs text-danger-600">{error}</div>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg border border-border text-body hover:bg-hover">ยกเลิก</button>
        <button onClick={() => void submit()} disabled={!form.email || !form.name || busy} className="text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg">
          เพิ่มพนักงาน
        </button>
      </div>
    </ModalShell>
  )
}

export interface ClassificationFieldValues {
  prefix: string
  idCardNumber: string
  branchType: '' | 'hq' | 'branch'
  branchCode: string
  specialNote: string
}

/**
 * Pronista §Entity Types Alignment — ฟิลด์ dynamic ตาม บุคคล/นิติบุคคล ใช้ร่วมกัน พาร์ทเนอร์/ลูกค้า/สมาชิก
 * บุคคล (สามัญ/วิสามัญบุคคล) = คำนำหน้า + เลขบัตรประชาชน 13 หลัก
 * นิติบุคคล (สามัญ/วิสามัญนิติบุคคล) = เลขทะเบียนนิติบุคคล 13 หลัก + ประเภทสาขา (+รหัสสาขา 5 หลัก ถ้าเป็นสาขา)
 * วิสามัญบุคคล = เพิ่มฟิลด์สังกัดเดิม/ความเชี่ยวชาญพิเศษ/ข้อตกลงพิเศษ
 */
export function ClassificationFields({
  classificationType,
  values,
  onChange,
}: {
  classificationType: ClassificationType
  values: ClassificationFieldValues
  onChange: (patch: Partial<ClassificationFieldValues>) => void
}) {
  const isJuristic = classificationType === 'ordinary_juristic' || classificationType === 'extraordinary_juristic'
  const isExtraIndividual = classificationType === 'extraordinary_individual'
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {!isJuristic && (
        <div>
          <label className={fieldLabel}>คำนำหน้า</label>
          <input value={values.prefix} onChange={(e) => onChange({ prefix: e.target.value })} placeholder="นาย/นาง/นางสาว" className={fieldInput} />
        </div>
      )}
      <div className={isJuristic ? 'sm:col-span-2' : ''}>
        <label className={fieldLabel}>{isJuristic ? 'เลขทะเบียนนิติบุคคล (Tax ID)' : 'เลขบัตรประชาชน'}</label>
        <input value={values.idCardNumber} onChange={(e) => onChange({ idCardNumber: e.target.value })} maxLength={13} placeholder="ตัวเลข 13 หลัก" className={fieldInput} />
      </div>
      {isJuristic && (
        <>
          <div>
            <label className={fieldLabel}>ประเภทสาขา</label>
            <select
              value={values.branchType}
              onChange={(e) => onChange({ branchType: e.target.value as ClassificationFieldValues['branchType'], branchCode: e.target.value === 'branch' ? values.branchCode : '' })}
              className={fieldInput}
            >
              <option value="">— ไม่ระบุ —</option>
              <option value="hq">สำนักงานใหญ่</option>
              <option value="branch">สาขา</option>
            </select>
          </div>
          {values.branchType === 'branch' && (
            <div>
              <label className={fieldLabel}>รหัสสาขา</label>
              <input value={values.branchCode} onChange={(e) => onChange({ branchCode: e.target.value })} maxLength={5} placeholder="ตัวเลข 5 หลัก" className={fieldInput} />
            </div>
          )}
        </>
      )}
      {isExtraIndividual && (
        <div className="sm:col-span-2">
          <label className={fieldLabel}>สังกัดเดิม / ความเชี่ยวชาญพิเศษ / ข้อตกลงพิเศษ</label>
          <textarea rows={2} value={values.specialNote} onChange={(e) => onChange({ specialNote: e.target.value })} className={fieldInput} />
        </div>
      )}
    </div>
  )
}

/** เพิ่มพาร์ทเนอร์ใหม่ (role='vendor') — ฟิลด์เท่ากับหน้าแก้ไข PartnerDetail ทุกฟิลด์ */
function AddOutsourceForm({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({
    name: '', email: '', businessName: '', phone: '', classificationType: 'ordinary_individual' as ClassificationType, specialty: '', bankAccount: '',
    contractType: '', contractExpiryDate: '',
    prefix: '', idCardNumber: '', branchType: '' as ClassificationFieldValues['branchType'], branchCode: '', specialNote: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const created = await api.post<{ id: string }>('/api/admin/users', {
        email: form.email, name: form.name, role: 'vendor',
        businessName: form.businessName || null, phone: form.phone || null, classificationType: form.classificationType,
        specialty: form.specialty || null, bankAccount: form.bankAccount || null,
        contractType: form.contractType || null, contractExpiryDate: form.contractExpiryDate || null,
        prefix: form.prefix || null, idCardNumber: form.idCardNumber || null,
        branchType: form.branchType || null, branchCode: form.branchCode || null, specialNote: form.specialNote || null,
      })
      onCreated(created.id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'ผิดพลาด')
    } finally {
      setBusy(false)
    }
  }
  return (
    <ModalShell title="เพิ่มพาร์ทเนอร์" onClose={onClose} wide>
      <div>
        <label className={fieldLabel}>ประเภท</label>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {(Object.keys(CLASSIFICATION_TYPE_LABEL) as ClassificationType[]).map((t) => (
            <label key={t} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="classificationType" checked={form.classificationType === t} onChange={() => setForm({ ...form, classificationType: t })} />
              {CLASSIFICATION_TYPE_LABEL[t]}
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className={fieldLabel}>ชื่อธุรกิจ</label><input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} className={fieldInput} /></div>
        <div><label className={fieldLabel}>ชื่อผู้ติดต่อ *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={fieldInput} /></div>
        <div><label className={fieldLabel}>อีเมล *</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={fieldInput} /></div>
        <div><label className={fieldLabel}>เบอร์มือถือ</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={fieldInput} /></div>
        <div><label className={fieldLabel}>ความเชี่ยวชาญ</label><input value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} placeholder="เช่น Frontend, UI/UX" className={fieldInput} /></div>
        <div><label className={fieldLabel}>บัญชีธนาคาร (สำหรับจ่ายเงิน)</label><input value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} placeholder="ธนาคาร + เลขบัญชี" className={fieldInput} /></div>
        <div><label className={fieldLabel}>เงื่อนไขสัญญาจ้าง</label><input value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value })} placeholder="เช่น รายโปรเจกต์, รายเดือน" className={fieldInput} /></div>
        <div><label className={fieldLabel}>วันหมดสัญญา</label><input type="date" value={form.contractExpiryDate} onChange={(e) => setForm({ ...form, contractExpiryDate: e.target.value })} className={fieldInput} /></div>
      </div>
      <ClassificationFields classificationType={form.classificationType} values={form} onChange={(patch) => setForm({ ...form, ...patch })} />
      <p className="text-[11px] text-muted">ผู้รับจ้าง = allowlist อีเมลภายนอก</p>
      {error && <div className="text-xs text-danger-600">{error}</div>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg border border-border text-body hover:bg-hover">ยกเลิก</button>
        <button onClick={() => void submit()} disabled={!form.email || !form.name || busy} className="text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg">
          เพิ่มพาร์ทเนอร์
        </button>
      </div>
    </ModalShell>
  )
}

/** เพิ่มลูกค้าใหม่ (role='guest') — ต้องเลือกโปรเจกต์อย่างน้อย 1 (บังคับ) — ฟิลด์เท่ากับหน้าแก้ไข UserSettingsCustomerDetail ทุกฟิลด์ */
function AddCustomerForm({ projects, onClose, onCreated }: { projects: ProjectOpt[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({
    name: '', email: '', businessName: '', phone: '',
    classificationType: 'ordinary_individual' as ClassificationType, projectIds: [] as string[],
    prefix: '', idCardNumber: '', branchType: '' as ClassificationFieldValues['branchType'], branchCode: '', specialNote: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const toggleProject = (id: string) => setForm((f) => ({ ...f, projectIds: f.projectIds.includes(id) ? f.projectIds.filter((x) => x !== id) : [...f.projectIds, id] }))
  const submit = async () => {
    if (form.projectIds.length === 0) { setError('ต้องเลือกโปรเจกต์อย่างน้อย 1 โปรเจกต์'); return }
    setBusy(true)
    setError('')
    try {
      const created = await api.post<{ id: string }>('/api/admin/users', {
        email: form.email,
        name: form.name,
        role: 'guest',
        businessName: form.businessName || null,
        phone: form.phone || null,
        contactType: contactTypeFor(form.classificationType),
        classificationType: form.classificationType,
        projectIds: form.projectIds,
        prefix: form.prefix || null, idCardNumber: form.idCardNumber || null,
        branchType: form.branchType || null, branchCode: form.branchCode || null, specialNote: form.specialNote || null,
      })
      onCreated(created.id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'ผิดพลาด')
    } finally {
      setBusy(false)
    }
  }
  return (
    <ModalShell title="เพิ่มลูกค้า" onClose={onClose} wide>
      <div>
        <label className={fieldLabel}>ประเภท</label>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {(Object.keys(CLASSIFICATION_TYPE_LABEL) as ClassificationType[]).map((t) => (
            <label key={t} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="classificationType" checked={form.classificationType === t} onChange={() => setForm({ ...form, classificationType: t })} />
              {CLASSIFICATION_TYPE_LABEL[t]}
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className={fieldLabel}>ชื่อธุรกิจ</label><input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} className={fieldInput} /></div>
        <div><label className={fieldLabel}>ชื่อผู้ติดต่อ</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={fieldInput} /></div>
        <div><label className={fieldLabel}>อีเมล *</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={fieldInput} /></div>
        <div><label className={fieldLabel}>เบอร์มือถือ</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={fieldInput} /></div>
      </div>
      <ClassificationFields classificationType={form.classificationType} values={form} onChange={(patch) => setForm({ ...form, ...patch })} />
      <div>
        <label className={fieldLabel}>โปรเจกต์ * (บังคับเลือก อย่างน้อย 1)</label>
        <div className="border border-border-subtle rounded-lg max-h-40 overflow-y-auto divide-y divide-divider bg-white">
          {projects.length === 0 && <div className="text-xs text-muted px-3 py-3 text-center">ยังไม่มีโปรเจกต์ในระบบ</div>}
          {projects.map((p) => (
            <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-hover">
              <input type="checkbox" checked={form.projectIds.includes(p.id)} onChange={() => toggleProject(p.id)} />
              <span className="text-body truncate">{p.name}</span>
              {p.code && <span className="text-[10px] font-mono text-muted ml-auto shrink-0">{p.code}</span>}
            </label>
          ))}
        </div>
      </div>
      {error && <div className="text-xs text-danger-600">{error}</div>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg border border-border text-body hover:bg-hover">ยกเลิก</button>
        <button onClick={() => void submit()} disabled={!form.email || !form.name || busy} className="text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg">
          เพิ่มลูกค้า
        </button>
      </div>
    </ModalShell>
  )
}

export function UserSettingsPage({ tab }: { tab: UserTab }) {
  const navigate = useNavigate()
  const { user: me } = useAuth()
  const isOwner = me?.role === 'owner'
  const { data: usersList, loading, reload } = useLoad<AdminUser[]>(() => api.get('/api/admin/users'))
  const { data: teamsList, reload: reloadTeams } = useLoad<Team[]>(() => api.get('/api/admin/teams'))
  const { data: cfg } = useLoad<{ memberDomain: string }>(() => api.get('/api/config'))
  const { data: projects } = useLoad<ProjectOpt[]>(() => api.get('/api/projects'))
  const [adding, setAdding] = useState(false)
  const [addingTeam, setAddingTeam] = useState(false)
  const [emailErrors, setEmailErrors] = useState<Record<string, string>>({})

  const toggleStatus = async (u: AdminUser) => {
    await api.patch(`/api/admin/users/${u.id}`, { status: u.status === 'active' ? 'disabled' : 'active' })
    await reload()
  }
  const saveUserRole = async (u: AdminUser, role: AdminUser['role']) => {
    if (role === u.role) return
    await api.patch(`/api/admin/users/${u.id}`, { role })
    await reload()
  }
  const saveManager = async (u: AdminUser, managerId: string) => {
    const next = managerId || null
    if (next === u.managerId) return
    await api.patch(`/api/admin/users/${u.id}`, { managerId: next })
    await reload()
  }
  const saveEmail = async (u: AdminUser, email: string) => {
    const next = email.trim().toLowerCase()
    if (next === u.email) return
    try {
      await api.patch(`/api/admin/users/${u.id}`, { email: next })
      setEmailErrors((prev) => { if (!(u.id in prev)) return prev; const rest = { ...prev }; delete rest[u.id]; return rest })
      await reload()
    } catch (e) {
      setEmailErrors((prev) => ({ ...prev, [u.id]: e instanceof ApiError && e.message === 'email_exists' ? 'อีเมลนี้ถูกใช้แล้ว' : 'อีเมลไม่ถูกต้อง' }))
    }
  }
  const staffUsers = (usersList ?? []).filter((u) => u.role === 'owner' || u.role === 'member')
  const outsourceUsers = (usersList ?? []).filter((u) => u.role === 'vendor')
  const customerUsers = (usersList ?? []).filter((u) => u.role === 'guest')
  const projectName = (id: string) => (projects ?? []).find((p) => p.id === id)
  const visibleUsers = tab === 'staff' ? staffUsers : outsourceUsers
  const pageTitle = tab === 'staff' ? 'จัดการพนักงาน' : tab === 'outsource' ? 'จัดการพาร์ทเนอร์' : 'จัดการลูกค้า'

  return (
    <>
      <PageHeader
        title={pageTitle}
        action={
          // Pronista §Menu Restructure — สร้างบัญชีใหม่ยังเป็น owner-only เสมอ (ต่างจากดู/แก้ที่เปิดผ่านเพดานได้แล้ว) กันปุ่มค้างเวลา staff เข้าเมนูนี้ผ่านเพดาน
          isOwner && (
            <div className="flex items-center gap-2">
              {tab !== 'customer' && (
                <button onClick={() => setAddingTeam((v) => !v)} className="flex items-center gap-2 border border-border-subtle hover:bg-hover text-sm font-medium px-3.5 py-2 rounded-lg">
                  <Plus className="w-4 h-4" /> เพิ่มทีม
                </button>
              )}
              <button onClick={() => setAdding((v) => !v)} className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-3.5 py-2 rounded-lg">
                <UserPlus className="w-4 h-4" /> {tab === 'customer' ? 'เพิ่มลูกค้า' : 'เพิ่มผู้ใช้งาน'}
              </button>
            </div>
          )
        }
      />
      <div className="p-3 sm:p-6 space-y-4">
        {addingTeam && tab !== 'customer' && (
          <AddTeamForm onDone={() => { setAddingTeam(false); void reloadTeams() }} />
        )}
        {adding && tab === 'staff' && (
          <AddStaffForm
            memberDomain={cfg?.memberDomain}
            teamsList={teamsList ?? []}
            staffOpts={staffUsers}
            onClose={() => setAdding(false)}
            onCreated={(id) => { setAdding(false); void reload(); navigate(`/employees/${id}`) }}
          />
        )}
        {adding && tab === 'outsource' && (
          <AddOutsourceForm
            onClose={() => setAdding(false)}
            onCreated={(id) => { setAdding(false); void reload(); navigate(`/partners/${id}`) }}
          />
        )}
        {adding && tab === 'customer' && (
          <AddCustomerForm
            projects={projects ?? []}
            onClose={() => setAdding(false)}
            onCreated={(id) => { setAdding(false); void reload(); navigate(`/customers/${id}`) }}
          />
        )}

        {tab === 'customer' ? (
          <div className="bg-white rounded-lg shadow-xs divide-y divide-divider">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted">กำลังโหลด…</div>
            ) : customerUsers.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted">
                <Users className="w-8 h-8 text-muted mx-auto mb-2" />
                ยังไม่มีลูกค้า — กด "เพิ่มลูกค้า"
              </div>
            ) : (
              customerUsers.map((u) => (
                <button
                  key={u.id}
                  onClick={() => navigate(`/customers/${u.id}`)}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-hover ${u.status === 'disabled' ? 'opacity-40' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-strong truncate">{u.businessName || u.name}</span>
                      {u.classificationType && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-hover text-soft shrink-0">{CLASSIFICATION_TYPE_LABEL[u.classificationType]}</span>}
                    </div>
                    <div className="text-[11px] text-muted truncate mt-0.5">{u.name} · {u.email}{u.phone ? ` · ${u.phone}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap justify-end max-w-[40%] shrink-0">
                    {u.projectIds.length === 0 ? (
                      <span className="text-[10px] text-danger-600">ยังไม่ผูกโปรเจกต์</span>
                    ) : (
                      u.projectIds.slice(0, 2).map((pid) => {
                        const p = projectName(pid)
                        return p ? <span key={pid} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-brand-50 text-brand-700">{p.name}</span> : null
                      })
                    )}
                    {u.projectIds.length > 2 && <span className="text-[10px] text-muted">+{u.projectIds.length - 2}</span>}
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-xs overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-sm text-muted">กำลังโหลด…</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead className="bg-hover text-dim text-xs">
                    <tr>
                      {tab === 'staff' && <th className="text-left font-medium px-5 py-3">รหัสพนักงาน</th>}
                      <th className="text-left font-medium px-5 py-3">ชื่อ</th>
                      <th className="text-left font-medium px-3 py-3">อีเมล</th>
                      <th className="text-left font-medium px-3 py-3">สิทธิ์ระบบ</th>
                      <th className="text-left font-medium px-3 py-3">ทีม</th>
                      {tab === 'staff' && <th className="text-left font-medium px-3 py-3">หัวหน้าโดยตรง</th>}
                      {tab === 'outsource' && <th className="text-left font-medium px-3 py-3">ประเภท</th>}
                      <th className="text-right font-medium px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-divider">
                    {visibleUsers.length === 0 && (
                      <tr><td colSpan={7} className="text-center text-muted py-8">ยังไม่มีผู้ใช้งานในกลุ่มนี้</td></tr>
                    )}
                    {visibleUsers.map((u) => (
                      <tr key={u.id} className={u.status === 'disabled' ? 'opacity-40' : ''}>
                        {tab === 'staff' && <td className="px-5 py-3 text-xs font-mono text-muted">{u.employeeCode ?? '—'}</td>}
                        <td className="px-5 py-3">{u.name}</td>
                        <td className="px-3">
                          {isOwner ? (
                            <>
                              <input type="email" defaultValue={u.email} onBlur={(e) => void saveEmail(u, e.target.value)} className="w-44 text-xs shadow-xs bg-white rounded-lg px-2 py-1.5 text-muted" />
                              {emailErrors[u.id] && <div className="text-[10px] text-danger-600 mt-0.5">{emailErrors[u.id]}</div>}
                            </>
                          ) : (
                            <span className="text-xs text-muted">{u.email}</span>
                          )}
                        </td>
                        <td className="px-3">
                          {isOwner ? (
                            <select value={u.role} onChange={(e) => void saveUserRole(u, e.target.value as AdminUser['role'])} className={`text-[11px] px-2 py-1 rounded-full border-0 ${ROLE_BADGE[u.role]}`}>
                              <option value="member">{ROLE_LABEL.member}</option>
                              <option value="vendor">{ROLE_LABEL.vendor}</option>
                              <option value="guest">{ROLE_LABEL.guest}</option>
                              <option value="owner">{ROLE_LABEL.owner}</option>
                            </select>
                          ) : (
                            <span className={`text-[11px] px-2 py-1 rounded-full ${ROLE_BADGE[u.role]}`}>{ROLE_LABEL[u.role]}</span>
                          )}
                        </td>
                        <td className="px-3 text-muted">{u.teamName ?? '—'}</td>
                        {tab === 'staff' && (
                          <td className="px-3">
                            <select value={u.managerId ?? ''} onChange={(e) => void saveManager(u, e.target.value)} className="text-xs shadow-xs bg-white rounded-lg px-2 py-1.5 text-muted max-w-40">
                              <option value="">— ยังไม่ตั้ง —</option>
                              {staffUsers.filter((s) => s.id !== u.id).map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                          </td>
                        )}
                        {tab === 'outsource' && (
                          <td className="px-3">
                            {u.classificationType ? (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-info-50 text-info-700 whitespace-nowrap">{CLASSIFICATION_TYPE_LABEL[u.classificationType]}</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        )}
                        <td className="text-right px-5">
                          <div className="flex items-center justify-end gap-3">
                            {(tab === 'staff' || tab === 'outsource') && (
                              <button
                                onClick={() => navigate(`/${tab === 'staff' ? 'employees' : 'partners'}/${u.id}`)}
                                className="inline-flex items-center gap-1 text-[11px] text-brand-700 hover:underline"
                              >
                                <SquarePen className="w-3 h-3" /> แก้ไขข้อมูล
                              </button>
                            )}
                            {isOwner && (
                              <button onClick={() => void toggleStatus(u)} className="text-[11px] text-muted hover:text-soft underline">
                                {u.status === 'active' ? 'ปิดการใช้งาน' : 'เปิดใช้งาน'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-muted px-5 py-3 border-t border-divider">
              ปิดการใช้งาน = login ไม่ได้ทันที · ตำแหน่ง/ต้นทุน-วัน ย้ายไปตั้งที่เมนู "กำหนดต้นทุน" แล้ว
            </p>
          </div>
        )}
      </div>
    </>
  )
}
