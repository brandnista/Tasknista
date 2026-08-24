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
}
interface ProjectOpt { id: string; code: string | null; name: string }

export const CONTACT_TYPE_LABEL: Record<'juristic' | 'individual', string> = { juristic: 'นิติบุคคล', individual: 'บุคคลธรรมดา' }
export type ClassificationType = 'ordinary_individual' | 'ordinary_juristic' | 'extraordinary_individual' | 'extraordinary_juristic'
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
                      {u.contactType && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-info-50 text-info-700 shrink-0">{CONTACT_TYPE_LABEL[u.contactType]}</span>}
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
                      <tr><td colSpan={6} className="text-center text-muted py-8">ยังไม่มีผู้ใช้งานในกลุ่มนี้</td></tr>
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
                            <button onClick={() => void toggleStatus(u)} className="text-[11px] text-muted hover:text-soft underline">
                              {u.status === 'active' ? 'ปิดการใช้งาน' : 'เปิดใช้งาน'}
                            </button>
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
