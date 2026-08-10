import { CalendarDays, Check, Copy, Plus, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { GcalSettings } from '../components/GcalSettings'
import { PageHeader } from '../components/PageHeader'
import { BoardPresetSettings } from '../components/BoardPresetSettings'
import { PositionSettings } from '../components/PositionSettings'
import { ServiceTypeSettings } from '../components/ServiceTypeSettings'
import { ProductTypeSettings } from '../components/ProductTypeSettings'
import { LabelSettings } from '../components/LabelSettings'
import { ProjectStatusSettings } from '../components/ProjectStatusSettings'
import { api, ApiError } from '../lib/api'
import { useDialog } from '../components/Dialog'
import { ROLE_LABEL, ROLE_BADGE } from '../lib/role-label'
import { useLoad } from '../lib/useLoad'

interface Team {
  id: string
  name: string
}
interface AdminUser {
  id: string
  email: string
  name: string
  role: 'owner' | 'member' | 'vendor' | 'guest'
  status: 'active' | 'disabled'
  teamId: string | null
  teamName: string | null
  // Pronista §Project Estimate — ตำแหน่ง/ต้นทุนต่อวัน (ใหม่ แยกจาก rates เดิม)
  jobTitle: string | null
  costPerDaySatang: number | null
  // Pronista §User Settings — ฟิลด์เฉพาะ role='guest' (ลูกค้า)
  contactType: 'juristic' | 'individual' | null
  businessName: string | null
  phone: string | null
}

const CONTACT_TYPE_LABEL: Record<'juristic' | 'individual', string> = { juristic: 'นิติบุคคล', individual: 'บุคคลธรรมดา' }
interface Config {
  cutoffDay: number
  workHourCapMinutes: number
  memberDomain: string
}

/** เพิ่มทีมใหม่แบบ inline (Pronista §ตั้งค่า — ไอเดียจาก reference จัดการผู้ใช้) */
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

function AddUserForm({ memberDomain, teamsList, onDone }: { memberDomain?: string; teamsList: Team[]; onDone: () => void }) {
  const [form, setForm] = useState({ email: '', name: '', role: 'member', teamId: '' })
  const [error, setError] = useState('')
  const submit = async () => {
    try {
      await api.post('/api/admin/users', {
        email: form.email,
        name: form.name,
        role: form.role,
        teamId: form.teamId || null,
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ผิดพลาด')
    }
  }
  return (
    <div className="p-4 bg-hover rounded-lg space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <input
          placeholder="ชื่อ"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="text-sm bg-white shadow-xs rounded-lg px-3 py-2"
        />
        <input
          placeholder="อีเมล"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="text-sm bg-white shadow-xs rounded-lg px-3 py-2"
        />
        <select
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
          className="text-sm bg-white shadow-xs rounded-lg px-3 py-2"
        >
          <option value="member">พนักงาน</option>
          <option value="vendor">ผู้รับจ้าง</option>
          <option value="guest">Guest</option>
          <option value="owner">Admin</option>
        </select>
        <select
          value={form.teamId}
          onChange={(e) => setForm({ ...form, teamId: e.target.value })}
          className="text-sm bg-white shadow-xs rounded-lg px-3 py-2"
        >
          <option value="">— ไม่ระบุทีม —</option>
          {teamsList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      {error && <div className="text-xs text-danger-600">{error}</div>}
      <div className="flex justify-end gap-2">
        <button
          onClick={() => void submit()}
          disabled={!form.email || !form.name}
          className="text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg"
        >
          เพิ่มผู้ใช้งาน
        </button>
      </div>
      <p className="text-[11px] text-muted">
        {memberDomain
          ? `พนักงาน = โดเมน ${memberDomain} (login ได้เองอยู่แล้ว)`
          : 'พนักงาน = ยังไม่ตั้งโดเมน auto-provision (ตั้งได้ที่ ค่าบริษัท)'}{' '}
        · ผู้รับจ้าง = allowlist อีเมลภายนอก
      </p>
    </div>
  )
}

/** เพิ่มลูกค้าใหม่ (role='guest') — ฟิลด์ CRM ตามฟอร์มอ้างอิง แทนฟิลด์พนักงาน/ทีม/ตำแหน่งปกติ */
function AddCustomerForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    name: '', email: '', businessName: '', phone: '', contactType: 'juristic' as 'juristic' | 'individual',
  })
  const [error, setError] = useState('')
  const submit = async () => {
    try {
      await api.post('/api/admin/users', {
        email: form.email,
        name: form.name,
        role: 'guest',
        businessName: form.businessName || null,
        phone: form.phone || null,
        contactType: form.contactType,
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ผิดพลาด')
    }
  }
  const input = 'text-sm bg-white shadow-xs rounded-lg px-3 py-2'
  return (
    <div className="p-4 bg-hover rounded-lg space-y-2">
      <div className="flex items-center gap-4 text-sm">
        <span className="text-muted">ประเภทผู้ติดต่อ</span>
        {(['juristic', 'individual'] as const).map((t) => (
          <label key={t} className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name="contactType" checked={form.contactType === t} onChange={() => setForm({ ...form, contactType: t })} />
            {CONTACT_TYPE_LABEL[t]}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input placeholder="ชื่อธุรกิจ" value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} className={input} />
        <input placeholder="ชื่อผู้ติดต่อ" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
        <input placeholder="อีเมล" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
        <input placeholder="เบอร์มือถือ" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={input} />
      </div>
      {error && <div className="text-xs text-danger-600">{error}</div>}
      <div className="flex justify-end">
        <button
          onClick={() => void submit()}
          disabled={!form.email || !form.name}
          className="text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg"
        >
          เพิ่มลูกค้า
        </button>
      </div>
    </div>
  )
}

/** ลิงก์ subscribe ปฏิทินทีมเป็น ICS feed (SPEC §4.14 · E6) — owner สร้าง/รีเซ็ต/ปิด */
function IcsLinkCard() {
  const { data, reload } = useLoad<{ url: string | null }>(() => api.get('/api/admin/ics-link'))
  const { confirmDialog } = useDialog()
  const [copied, setCopied] = useState(false)
  const url = data?.url ?? null

  const generate = async () => {
    if (
      url &&
      !(await confirmDialog({
        title: 'สร้างลิงก์ใหม่?',
        message: 'ลิงก์เดิมจะใช้ไม่ได้ทันที — คนที่ subscribe ไว้ต้องเปลี่ยนเป็นลิงก์ใหม่',
        confirmLabel: 'สร้างใหม่',
      }))
    )
      return
    await api.post('/api/admin/ics-link/regenerate')
    await reload()
  }
  const disable = async () => {
    if (
      !(await confirmDialog({
        title: 'ปิดลิงก์ปฏิทิน?',
        message: 'feed จะเข้าไม่ได้จนกว่าจะสร้างลิงก์ใหม่',
        confirmLabel: 'ปิดลิงก์',
        danger: true,
      }))
    )
      return
    await api.delete('/api/admin/ics-link')
    await reload()
  }
  const copy = async () => {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="bg-white rounded-lg shadow-xs p-5 max-w-md">
      <div className="flex items-center gap-2 mb-1">
        <CalendarDays className="w-4 h-4 text-brand-600" />
        <div className="font-semibold text-ink">ลิงก์ปฏิทิน (ICS)</div>
      </div>
      <p className="text-[11px] text-muted mb-3">
        ลิงก์ subscribe ปฏิทินทีม (วันลา/ประชุม/วันหยุด + ตัดรอบ/จ่ายเงินเดือน) — เพิ่มใน Google/Apple
        Calendar บนมือถือ · ใครมีลิงก์เห็นได้ทั้งทีม
      </p>
      {url ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
              className="flex-1 min-w-0 text-xs bg-hover shadow-xs rounded-lg px-3 py-2 text-soft"
            />
            <button
              onClick={() => void copy()}
              className="shrink-0 text-sm px-3 py-2 rounded-lg bg-divider hover:bg-border-subtle flex items-center gap-1.5"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-success-600" /> คัดลอกแล้ว
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" /> คัดลอก
                </>
              )}
            </button>
          </div>
          <div className="flex gap-3 text-xs">
            <button onClick={() => void generate()} className="text-dim hover:text-body underline">
              สร้างลิงก์ใหม่
            </button>
            <button onClick={() => void disable()} className="text-danger-500 hover:text-danger-600 underline">
              ปิดลิงก์
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => void generate()}
          className="text-sm bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg"
        >
          สร้างลิงก์
        </button>
      )}
    </div>
  )
}

export function AdminPage() {
  const { data: usersList, loading, reload } = useLoad<AdminUser[]>(() => api.get('/api/admin/users'))
  const { data: teamsList, reload: reloadTeams } = useLoad<Team[]>(() => api.get('/api/admin/teams'))
  const { data: cfg, reload: reloadCfg } = useLoad<Config>(() => api.get('/api/config'))
  const [adding, setAdding] = useState(false)
  const [addingTeam, setAddingTeam] = useState(false)
  const [emailErrors, setEmailErrors] = useState<Record<string, string>>({})
  // Pronista §User Settings — แยกลิสต์ผู้ใช้งานเป็น 3 ประเภท: พนักงานในระบบ (owner+member) / พนักงาน Outsource (vendor) / ลูกค้า (guest)
  const [userTab, setUserTab] = useState<'staff' | 'outsource' | 'customer'>('staff')

  const saveCfg = async (patch: Partial<Config>) => {
    await api.patch('/api/admin/config', patch)
    await reloadCfg()
  }
  const toggleStatus = async (u: AdminUser) => {
    await api.patch(`/api/admin/users/${u.id}`, {
      status: u.status === 'active' ? 'disabled' : 'active',
    })
    await reload()
  }
  // Pronista §User Role — แก้ "สิทธิ์ระบบ" ของผู้ใช้เดิมได้ที่นี่ (หน้า /admin ทั้งหน้า + endpoint นี้ผูก ownerOnly อยู่แล้ว = Admin เท่านั้นที่แก้ได้)
  const saveUserRole = async (u: AdminUser, role: AdminUser['role']) => {
    if (role === u.role) return
    await api.patch(`/api/admin/users/${u.id}`, { role })
    await reload()
  }
  const saveEmail = async (u: AdminUser, email: string) => {
    const next = email.trim().toLowerCase()
    if (next === u.email) return
    try {
      await api.patch(`/api/admin/users/${u.id}`, { email: next })
      setEmailErrors((prev) => {
        if (!(u.id in prev)) return prev
        const rest = { ...prev }
        delete rest[u.id]
        return rest
      })
      await reload()
    } catch (e) {
      const message =
        e instanceof ApiError && e.message === 'email_exists' ? 'อีเมลนี้ถูกใช้แล้ว' : 'อีเมลไม่ถูกต้อง'
      setEmailErrors((prev) => ({ ...prev, [u.id]: message }))
    }
  }
  // Pronista §Project Estimate — ตำแหน่ง/ต้นทุนต่อวัน ใช้กับ Tab "Project Estimate" ทุกโปรเจกต์ (ไม่ผูก payroll เดิม)
  const saveUserEstimateFields = async (u: AdminUser, patch: { jobTitle?: string | null; costPerDaySatang?: number | null }) => {
    await api.patch(`/api/admin/users/${u.id}`, patch)
    await reload()
  }
  // Pronista §User Settings — แก้ฟิลด์ CRM ของลูกค้า (ชื่อผู้ติดต่อ/ชื่อธุรกิจ/อีเมล/เบอร์มือถือ/ประเภท)
  const saveCustomerField = async (u: AdminUser, patch: Partial<Pick<AdminUser, 'name' | 'businessName' | 'phone' | 'contactType'>>) => {
    await api.patch(`/api/admin/users/${u.id}`, patch)
    await reload()
  }

  const staffUsers = (usersList ?? []).filter((u) => u.role === 'owner' || u.role === 'member')
  const outsourceUsers = (usersList ?? []).filter((u) => u.role === 'vendor')
  const customerUsers = (usersList ?? []).filter((u) => u.role === 'guest')
  const visibleUsers = userTab === 'staff' ? staffUsers : userTab === 'outsource' ? outsourceUsers : customerUsers

  return (
    <>
      <PageHeader
        title="ตั้งค่า"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAddingTeam((v) => !v)}
              className="flex items-center gap-2 border border-border-subtle hover:bg-hover text-sm font-medium px-3.5 py-2 rounded-lg"
            >
              <Plus className="w-4 h-4" /> เพิ่มทีม
            </button>
            <button
              onClick={() => setAdding((v) => !v)}
              className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-3.5 py-2 rounded-lg"
            >
              <UserPlus className="w-4 h-4" /> {userTab === 'customer' ? 'เพิ่มลูกค้า' : 'เพิ่มผู้ใช้งาน'}
            </button>
          </div>
        }
      />
      <div className="p-3 sm:p-6 space-y-5">
        {addingTeam && (
          <AddTeamForm
            onDone={() => {
              setAddingTeam(false)
              void reloadTeams()
            }}
          />
        )}

        {adding && userTab !== 'customer' && (
          <AddUserForm
            memberDomain={cfg?.memberDomain}
            teamsList={teamsList ?? []}
            onDone={() => {
              setAdding(false)
              void reload()
            }}
          />
        )}
        {adding && userTab === 'customer' && (
          <AddCustomerForm
            onDone={() => {
              setAdding(false)
              void reload()
            }}
          />
        )}

        <div className="bg-white rounded-lg shadow-xs overflow-hidden">
          <div className="p-5 border-b border-border-subtle flex items-center gap-2 flex-wrap">
            <div className="font-semibold text-ink">
              ผู้ใช้งาน <span className="text-xs font-normal text-muted">· {visibleUsers.length} คน</span>
            </div>
            <div className="ml-auto flex bg-divider rounded-lg p-0.5 text-sm font-medium">
              {([
                ['staff', 'พนักงานในระบบ'],
                ['outsource', 'พนักงาน Outsource'],
                ['customer', 'ลูกค้า'],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setUserTab(tab)}
                  className={`px-3 py-1.5 rounded-md whitespace-nowrap ${userTab === tab ? 'bg-white shadow-xs text-ink' : 'text-dim'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="p-8 text-center text-sm text-muted">กำลังโหลด…</div>
          ) : userTab === 'customer' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-hover text-dim text-xs">
                  <tr>
                    <th className="text-left font-medium px-5 py-3">ชื่อผู้ติดต่อ</th>
                    <th className="text-left font-medium px-3 py-3">ชื่อธุรกิจ</th>
                    <th className="text-left font-medium px-3 py-3">ประเภท</th>
                    <th className="text-left font-medium px-3 py-3">อีเมล</th>
                    <th className="text-left font-medium px-3 py-3">เบอร์มือถือ</th>
                    <th className="text-right font-medium px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {customerUsers.length === 0 && (
                    <tr><td colSpan={6} className="text-center text-muted py-8">ยังไม่มีลูกค้า</td></tr>
                  )}
                  {customerUsers.map((u) => (
                    <tr key={u.id} className={u.status === 'disabled' ? 'opacity-40' : ''}>
                      <td className="px-5 py-3">
                        <input
                          type="text"
                          defaultValue={u.name}
                          onBlur={(e) => {
                            const v = e.target.value.trim()
                            if (v && v !== u.name) void saveCustomerField(u, { name: v })
                          }}
                          className="w-36 text-xs shadow-xs bg-white rounded-lg px-2 py-1.5"
                        />
                      </td>
                      <td className="px-3">
                        <input
                          type="text"
                          placeholder="—"
                          defaultValue={u.businessName ?? ''}
                          onBlur={(e) => {
                            const v = e.target.value.trim()
                            if (v !== (u.businessName ?? '')) void saveCustomerField(u, { businessName: v || null })
                          }}
                          className="w-36 text-xs shadow-xs bg-white rounded-lg px-2 py-1.5"
                        />
                      </td>
                      <td className="px-3">
                        <select
                          value={u.contactType ?? 'juristic'}
                          onChange={(e) => void saveCustomerField(u, { contactType: e.target.value as 'juristic' | 'individual' })}
                          className="text-xs shadow-xs bg-white rounded-lg px-2 py-1.5"
                        >
                          <option value="juristic">{CONTACT_TYPE_LABEL.juristic}</option>
                          <option value="individual">{CONTACT_TYPE_LABEL.individual}</option>
                        </select>
                      </td>
                      <td className="px-3">
                        <input
                          type="email"
                          defaultValue={u.email}
                          onBlur={(e) => void saveEmail(u, e.target.value)}
                          className="w-44 text-xs shadow-xs bg-white rounded-lg px-2 py-1.5 text-muted"
                        />
                        {emailErrors[u.id] && (
                          <div className="text-[10px] text-danger-600 mt-0.5">{emailErrors[u.id]}</div>
                        )}
                      </td>
                      <td className="px-3">
                        <input
                          type="text"
                          placeholder="—"
                          defaultValue={u.phone ?? ''}
                          onBlur={(e) => {
                            const v = e.target.value.trim()
                            if (v !== (u.phone ?? '')) void saveCustomerField(u, { phone: v || null })
                          }}
                          className="w-32 text-xs shadow-xs bg-white rounded-lg px-2 py-1.5"
                        />
                      </td>
                      <td className="text-right px-5">
                        <button
                          onClick={() => void toggleStatus(u)}
                          className="text-[11px] text-muted hover:text-soft underline"
                        >
                          {u.status === 'active' ? 'ปิดการใช้งาน' : 'เปิดใช้งาน'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="bg-hover text-dim text-xs">
                  <tr>
                    <th className="text-left font-medium px-5 py-3">ชื่อ</th>
                    <th className="text-left font-medium px-3 py-3">อีเมล</th>
                    <th className="text-left font-medium px-3 py-3">สิทธิ์ระบบ</th>
                    <th className="text-left font-medium px-3 py-3">ทีม</th>
                    <th className="text-left font-medium px-3 py-3">ตำแหน่ง (ต้นทุน)</th>
                    <th className="text-right font-medium px-3 py-3">ต้นทุน/วัน (฿)</th>
                    <th className="text-right font-medium px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {visibleUsers.length === 0 && (
                    <tr><td colSpan={7} className="text-center text-muted py-8">ยังไม่มีผู้ใช้งานในกลุ่มนี้</td></tr>
                  )}
                  {visibleUsers.map((u) => (
                    <tr key={u.id} className={u.status === 'disabled' ? 'opacity-40' : ''}>
                      <td className="px-5 py-3">{u.name}</td>
                      <td className="px-3">
                        <input
                          type="email"
                          defaultValue={u.email}
                          onBlur={(e) => void saveEmail(u, e.target.value)}
                          className="w-44 text-xs shadow-xs bg-white rounded-lg px-2 py-1.5 text-muted"
                        />
                        {emailErrors[u.id] && (
                          <div className="text-[10px] text-danger-600 mt-0.5">{emailErrors[u.id]}</div>
                        )}
                      </td>
                      <td className="px-3">
                        <select
                          value={u.role}
                          onChange={(e) => void saveUserRole(u, e.target.value as AdminUser['role'])}
                          className={`text-[11px] px-2 py-1 rounded-full border-0 ${ROLE_BADGE[u.role]}`}
                        >
                          <option value="member">{ROLE_LABEL.member}</option>
                          <option value="vendor">{ROLE_LABEL.vendor}</option>
                          <option value="guest">{ROLE_LABEL.guest}</option>
                          <option value="owner">{ROLE_LABEL.owner}</option>
                        </select>
                      </td>
                      <td className="px-3 text-muted">{u.teamName ?? '—'}</td>
                      <td className="px-3">
                        <input
                          type="text"
                          placeholder="เช่น Project Manager"
                          defaultValue={u.jobTitle ?? ''}
                          onBlur={(e) => {
                            const v = e.target.value.trim()
                            if (v !== (u.jobTitle ?? '')) void saveUserEstimateFields(u, { jobTitle: v || null })
                          }}
                          className="w-36 text-xs shadow-xs bg-white rounded-lg px-2 py-1.5"
                        />
                      </td>
                      <td className="px-3">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          placeholder="—"
                          defaultValue={u.costPerDaySatang != null ? u.costPerDaySatang / 100 : ''}
                          onBlur={(e) => {
                            const raw = e.target.value.trim()
                            const nextSatang = raw ? Math.round(Number(raw) * 100) : null
                            if (nextSatang !== u.costPerDaySatang) void saveUserEstimateFields(u, { costPerDaySatang: nextSatang })
                          }}
                          className="w-24 text-xs shadow-xs bg-white rounded-lg px-2 py-1.5 text-right tabular-nums"
                        />
                      </td>
                      <td className="text-right px-5">
                        <button
                          onClick={() => void toggleStatus(u)}
                          className="text-[11px] text-muted hover:text-soft underline"
                        >
                          {u.status === 'active' ? 'ปิดการใช้งาน' : 'เปิดใช้งาน'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted px-5 py-3 border-t border-divider">
            {userTab === 'customer'
              ? 'ปิดการใช้งาน = login ไม่ได้ทันที'
              : 'ปิดการใช้งาน = login ไม่ได้ทันที · ตำแหน่ง/ต้นทุน-วัน ใช้กับ Tab "Project Estimate" ในแต่ละโปรเจกต์เท่านั้น (เห็นเฉพาะ owner)'}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-xs p-5 max-w-md">
          <div className="font-semibold text-ink mb-3">ค่าบริษัท</div>
          {cfg && (
            <div className="space-y-3 text-sm">
              <label className="flex items-center justify-between gap-3">
                <span className="text-soft">วันตัดรอบเงินเดือน (งวด = วันนี้ → วันก่อนหน้าเดือนถัดไป)</span>
                <input
                  type="number"
                  min={1}
                  max={28}
                  defaultValue={cfg.cutoffDay}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (v !== cfg.cutoffDay) void saveCfg({ cutoffDay: v })
                  }}
                  className="w-20 text-sm shadow-xs bg-white rounded-lg px-3 py-2 text-right tabular-nums"
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-soft">เพดานชั่วโมงทำงาน/วัน (นาที)</span>
                <input
                  type="number"
                  min={60}
                  max={1440}
                  step={30}
                  defaultValue={cfg.workHourCapMinutes}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (v !== cfg.workHourCapMinutes) void saveCfg({ workHourCapMinutes: v })
                  }}
                  className="w-24 text-sm shadow-xs bg-white rounded-lg px-3 py-2 text-right tabular-nums"
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-soft">โดเมน auto-provision member (ว่าง = ปิด)</span>
                <input
                  type="text"
                  placeholder="@example.com"
                  defaultValue={cfg.memberDomain}
                  onBlur={(e) => {
                    const v = e.target.value.trim().toLowerCase()
                    if (v !== cfg.memberDomain) void saveCfg({ memberDomain: v })
                  }}
                  className="w-44 text-sm shadow-xs bg-white rounded-lg px-3 py-2"
                />
              </label>
              <p className="text-[11px] text-muted">
                ตอนนี้: งวด {cfg.cutoffDay} → {cfg.cutoffDay - 1} · เพดาน{' '}
                {(cfg.workHourCapMinutes / 60).toFixed(1)} ชม./วัน (ชนเพดาน = timer หยุด + บล็อก)
                {cfg.memberDomain
                  ? ` · อีเมล ${cfg.memberDomain} login ได้เองเป็น member`
                  : ' · auto-provision member ปิดอยู่ — เพิ่มผู้ใช้งานเองเท่านั้น'}
              </p>
            </div>
          )}
        </div>

        <IcsLinkCard />

        <ProjectStatusSettings />

        <BoardPresetSettings />

        <PositionSettings />

        <ServiceTypeSettings />

        <ProductTypeSettings />

        <LabelSettings />

        <GcalSettings />
      </div>
    </>
  )
}
