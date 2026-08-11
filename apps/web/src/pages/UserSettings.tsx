/**
 * Pronista §System Requirements Update — แยกเมนู "ตั้งค่าผู้ใช้งาน" ออกจาก "ตั้งค่า" เป็นเมนูหลักของตัวเอง
 * แบ่งเป็น 3 เมนูย่อยจริง (คนละ route): พนักงานในระบบ / พนักงาน Outsource / ลูกค้า (ลูกค้า = List → กดเข้าไปดู/แก้รายละเอียดที่หน้า UserSettingsCustomerDetail)
 */
import { Plus, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { PageHeader } from '../components/PageHeader'
import { PermissionCeilingSettings } from '../components/PermissionCeilingSettings'
import { PositionSettings } from '../components/PositionSettings'
import { api, ApiError } from '../lib/api'
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
}
interface ProjectOpt { id: string; code: string | null; name: string }

export const CONTACT_TYPE_LABEL: Record<'juristic' | 'individual', string> = { juristic: 'นิติบุคคล', individual: 'บุคคลธรรมดา' }
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

function AddUserForm({ role, memberDomain, teamsList, onDone }: { role: 'staff' | 'outsource'; memberDomain?: string; teamsList: Team[]; onDone: () => void }) {
  const [form, setForm] = useState({ email: '', name: '', role: role === 'staff' ? 'member' : 'vendor', teamId: '' })
  const [error, setError] = useState('')
  const submit = async () => {
    try {
      await api.post('/api/admin/users', { email: form.email, name: form.name, role: form.role, teamId: form.teamId || null })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ผิดพลาด')
    }
  }
  return (
    <div className="p-4 bg-hover rounded-lg space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <input placeholder="ชื่อ" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="text-sm bg-white shadow-xs rounded-lg px-3 py-2" />
        <input placeholder="อีเมล" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="text-sm bg-white shadow-xs rounded-lg px-3 py-2" />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="text-sm bg-white shadow-xs rounded-lg px-3 py-2">
          {role === 'staff' ? (
            <>
              <option value="member">พนักงาน</option>
              <option value="owner">Admin</option>
            </>
          ) : (
            <option value="vendor">ผู้รับจ้าง</option>
          )}
        </select>
        <select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })} className="text-sm bg-white shadow-xs rounded-lg px-3 py-2">
          <option value="">— ไม่ระบุทีม —</option>
          {teamsList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      {error && <div className="text-xs text-danger-600">{error}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={() => void submit()} disabled={!form.email || !form.name} className="text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg">
          เพิ่มผู้ใช้งาน
        </button>
      </div>
      {role === 'staff' && (
        <p className="text-[11px] text-muted">
          {memberDomain ? `พนักงาน = โดเมน ${memberDomain} (login ได้เองอยู่แล้ว)` : 'พนักงาน = ยังไม่ตั้งโดเมน auto-provision (ตั้งได้ที่ ค่าบริษัท)'}
        </p>
      )}
      {role === 'outsource' && <p className="text-[11px] text-muted">ผู้รับจ้าง = allowlist อีเมลภายนอก</p>}
    </div>
  )
}

/** เพิ่มลูกค้าใหม่ (role='guest') — ต้องเลือกโปรเจกต์อย่างน้อย 1 (บังคับ) */
function AddCustomerForm({ projects, onClose, onCreated }: { projects: ProjectOpt[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({
    name: '', email: '', businessName: '', phone: '', contactType: 'juristic' as 'juristic' | 'individual', projectIds: [] as string[],
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
        contactType: form.contactType,
        projectIds: form.projectIds,
      })
      onCreated(created.id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'ผิดพลาด')
    } finally {
      setBusy(false)
    }
  }
  const input = 'text-sm bg-white shadow-xs rounded-lg px-3 py-2'
  return (
    <div className="p-4 bg-hover rounded-lg space-y-3">
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
        <input placeholder="อีเมล *" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
        <input placeholder="เบอร์มือถือ" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={input} />
      </div>
      <div>
        <label className="text-xs font-medium text-muted mb-1 block">โปรเจกต์ * (บังคับเลือก อย่างน้อย 1)</label>
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
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-lg hover:bg-white">ยกเลิก</button>
        <button onClick={() => void submit()} disabled={!form.email || !form.name || busy} className="text-sm bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg">
          เพิ่มลูกค้า
        </button>
      </div>
    </div>
  )
}

export function UserSettingsPage({ tab }: { tab: UserTab }) {
  const navigate = useNavigate()
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
  const saveUserEstimateFields = async (u: AdminUser, patch: { jobTitle?: string | null; costPerDaySatang?: number | null }) => {
    await api.patch(`/api/admin/users/${u.id}`, patch)
    await reload()
  }

  const staffUsers = (usersList ?? []).filter((u) => u.role === 'owner' || u.role === 'member')
  const outsourceUsers = (usersList ?? []).filter((u) => u.role === 'vendor')
  const customerUsers = (usersList ?? []).filter((u) => u.role === 'guest')
  const projectName = (id: string) => (projects ?? []).find((p) => p.id === id)
  const visibleUsers = tab === 'staff' ? staffUsers : outsourceUsers

  const tabLink = (t: UserTab, to: string, label: string, count: number) => (
    <Link
      to={to}
      className={`px-3 py-1.5 rounded-md whitespace-nowrap text-sm font-medium ${tab === t ? 'bg-white shadow-xs text-ink' : 'text-dim hover:text-body'}`}
    >
      {label} <span className="text-[11px] tabular-nums text-muted">{count}</span>
    </Link>
  )

  return (
    <>
      <PageHeader
        title="ตั้งค่าผู้ใช้งาน"
        action={
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
        }
      />
      <div className="p-3 sm:p-6 space-y-4">
        <div className="flex bg-divider rounded-lg p-0.5 w-fit">
          {tabLink('staff', '/user-settings', 'พนักงานในระบบ', staffUsers.length)}
          {tabLink('outsource', '/user-settings/outsource', 'พนักงาน Outsource', outsourceUsers.length)}
          {tabLink('customer', '/user-settings/customers', 'ลูกค้า', customerUsers.length)}
        </div>

        {addingTeam && tab !== 'customer' && (
          <AddTeamForm onDone={() => { setAddingTeam(false); void reloadTeams() }} />
        )}
        {adding && tab !== 'customer' && (
          <AddUserForm role={tab} memberDomain={cfg?.memberDomain} teamsList={teamsList ?? []} onDone={() => { setAdding(false); void reload() }} />
        )}
        {adding && tab === 'customer' && (
          <AddCustomerForm
            projects={projects ?? []}
            onClose={() => setAdding(false)}
            onCreated={(id) => { setAdding(false); void reload(); navigate(`/user-settings/customers/${id}`) }}
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
                  onClick={() => navigate(`/user-settings/customers/${u.id}`)}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-hover ${u.status === 'disabled' ? 'opacity-40' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-strong truncate">{u.businessName || u.name}</span>
                      {u.contactType && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-info-50 text-info-700 shrink-0">{CONTACT_TYPE_LABEL[u.contactType]}</span>}
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
                          <input type="email" defaultValue={u.email} onBlur={(e) => void saveEmail(u, e.target.value)} className="w-44 text-xs shadow-xs bg-white rounded-lg px-2 py-1.5 text-muted" />
                          {emailErrors[u.id] && <div className="text-[10px] text-danger-600 mt-0.5">{emailErrors[u.id]}</div>}
                        </td>
                        <td className="px-3">
                          <select value={u.role} onChange={(e) => void saveUserRole(u, e.target.value as AdminUser['role'])} className={`text-[11px] px-2 py-1 rounded-full border-0 ${ROLE_BADGE[u.role]}`}>
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
                            onBlur={(e) => { const v = e.target.value.trim(); if (v !== (u.jobTitle ?? '')) void saveUserEstimateFields(u, { jobTitle: v || null }) }}
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
                            onBlur={(e) => { const raw = e.target.value.trim(); const nextSatang = raw ? Math.round(Number(raw) * 100) : null; if (nextSatang !== u.costPerDaySatang) void saveUserEstimateFields(u, { costPerDaySatang: nextSatang }) }}
                            className="w-24 text-xs shadow-xs bg-white rounded-lg px-2 py-1.5 text-right tabular-nums"
                          />
                        </td>
                        <td className="text-right px-5">
                          <button onClick={() => void toggleStatus(u)} className="text-[11px] text-muted hover:text-soft underline">
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
              ปิดการใช้งาน = login ไม่ได้ทันที · ตำแหน่ง/ต้นทุน-วัน ใช้กับ Tab "Project Estimate" ในแต่ละโปรเจกต์เท่านั้น (เห็นเฉพาะ owner)
            </p>
          </div>
        )}

        {/* Pronista §System Requirements Update — ย้ายมาจากหน้า "ตั้งค่า" เดิม เพราะเป็นการกำหนดสิทธิ์ของผู้ใช้งานโดยตรง */}
        <PermissionCeilingSettings />
        <PositionSettings />
      </div>
    </>
  )
}
