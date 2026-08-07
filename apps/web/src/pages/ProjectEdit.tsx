/** หน้าแก้ไขโปรเจกต์ (SPEC §4.3) — แก้ไอคอน/ชื่อ/ลูกค้า/ราคา/วันที่/สถานะ · owner หรือ member ที่เป็น editor ของโปรเจกต์นี้ */
import { ChevronLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ClientCombobox } from '../components/ClientCombobox'
import { IconPicker } from '../components/IconPicker'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { type ProjectRow } from '../lib/project-ui'
import { ROLE_LABEL } from '../lib/role-label'
import { useLoad } from '../lib/useLoad'

interface EditableProject extends ProjectRow {
  type: 'project' | 'recurring'
}
interface StatusOpt { id: string; name: string; kind: string }
interface TeamUser { id: string; name: string; role: 'owner' | 'member' | 'vendor' | 'guest' }
interface PositionOpt { id: string; name: string }
interface ServiceTypeOpt { id: string; name: string }
interface ProductTypeOpt { id: string; name: string }

const input = 'w-full text-sm bg-white border border-border rounded-lg px-3 py-2 focus:outline-hidden focus:border-brand-400'

/**
 * Pronista §Position-based permission — owner assign ตำแหน่ง (BA/PM/ฯลฯ) ให้ member เป็นรายโปรเจกต์ (สิทธิ์มาจากตำแหน่งที่เลือกล้วนๆ)
 * Pronista §7 (2026-07-03) — controlled component: แค่เก็บ positionId ที่เลือกไว้ใน state ของหน้าแม่ ไม่ยิง API เอง — รอปุ่ม "บันทึก" เดียวที่ด้านล่างสุดจัดการให้ทั้งคู่พร้อมกัน
 */
function MembersSection({
  assignments,
  positions,
  existingMemberIds,
  onChange,
}: {
  assignments: Record<string, string>
  positions: PositionOpt[]
  existingMemberIds: Set<string>
  onChange: (userId: string, positionId: string) => void
}) {
  const { data: users } = useLoad<TeamUser[]>(() => api.get('/api/users'))
  // ตำแหน่ง (catalog) มีผลเฉพาะ role=member — owner/vendor/guest สิทธิ์คงที่ตาม role อยู่แล้ว ตั้งตำแหน่งไม่ได้ (backend ปฏิเสธ)
  const team = (users ?? []).filter((u) => u.role === 'member')
  // owner/vendor/guest ที่ถูกเลือกไว้ตอนสร้างโปรเจกต์ (เห็นในนี้ได้ แต่แก้ตำแหน่งไม่ได้ — สิทธิ์มาจาก role โดยตรง)
  const fixedAccessMembers = (users ?? []).filter((u) => u.role !== 'member' && existingMemberIds.has(u.id))
  const fixedAccessLabel = (role: TeamUser['role']) => (role === 'owner' ? 'เข้าถึงเต็มรูปแบบ' : 'ดูอย่างเดียว')
  return (
    <div className="bg-white rounded-lg shadow-xs p-5 sm:p-6 mt-5">
      <h2 className="font-semibold text-ink mb-1">สมาชิกโปรเจกต์</h2>
      <p className="text-xs text-muted mb-4">
        สิทธิ์แก้ไข/มองเห็นเมนูมาจากตำแหน่งที่เลือก (ตั้งค่าตำแหน่งได้ที่ ตั้งค่า → ตำแหน่งและสิทธิ์) · ยังไม่ตั้งค่า = ยังไม่ใช่สมาชิก · กด "บันทึก" ด้านล่างเพื่อยืนยัน
      </p>
      <div className="divide-y divide-divider">
        {team.map((u) => (
          <div key={u.id} className="flex items-center gap-3 py-2.5">
            <span className="flex-1 text-sm text-body">{u.name}</span>
            <select
              value={assignments[u.id] ?? ''}
              onChange={(e) => onChange(u.id, e.target.value)}
              className="text-sm bg-white border border-border rounded-lg px-2.5 py-1.5"
            >
              <option value="" disabled>— ยังไม่ใช่สมาชิก —</option>
              {positions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        ))}
        {team.length === 0 && <div className="text-sm text-muted py-3">ไม่มีพนักงาน (member) ในระบบ</div>}
      </div>
      {fixedAccessMembers.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border-subtle">
          <p className="text-[11px] text-muted mb-2">สมาชิกอื่นในโปรเจกต์นี้ — สิทธิ์มาจาก "สิทธิ์ระบบ" โดยตรง (ไม่ผ่านตำแหน่ง แก้ที่นี่ไม่ได้)</p>
          <div className="divide-y divide-divider">
            {fixedAccessMembers.map((u) => (
              <div key={u.id} className="flex items-center gap-3 py-2">
                <span className="flex-1 text-sm text-body">{u.name}</span>
                <span className="text-xs text-muted">{ROLE_LABEL[u.role]} · {fixedAccessLabel(u.role)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function ProjectEditPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: project, loading } = useLoad<EditableProject>(() => api.get(`/api/projects/${id}`), [id])
  const { data: clientsRes } = useLoad<{ rows: { id: string; name: string }[] }>(() => api.get('/api/clients'))
  const clientList = clientsRes?.rows ?? []
  const { data: cfg } = useLoad<{ projectStatuses: StatusOpt[] }>(() => api.get('/api/config'))
  const statusOptions = cfg?.projectStatuses ?? []
  const { data: positionsData } = useLoad<{ positions: PositionOpt[] }>(() => api.get('/api/admin/positions'))
  const { data: serviceTypeData } = useLoad<{ serviceTypes: ServiceTypeOpt[] }>(() => api.get('/api/admin/service-types'))
  const serviceTypes = serviceTypeData?.serviceTypes ?? []
  const { data: productTypeData } = useLoad<{ productTypes: ProductTypeOpt[] }>(() => api.get('/api/admin/product-types'))
  const productTypes = productTypeData?.productTypes ?? []
  const isOwner = user?.role === 'owner'
  const canEditProject = project?.myRole === 'owner' || project?.myRole === 'editor'

  const [form, setForm] = useState({
    name: '', description: '', url: '', status: 'dev' as ProjectRow['status'], clientId: '', code: '',
    budgetBaht: '', startDate: '', dueDate: '', recurringPeriod: 'monthly' as 'monthly' | 'yearly',
    // Pronista §Subscription Notify — ประเภทโปรเจกต์ (project) / ประเภทสินค้า (product) + ช่วงเวลาให้บริการ (แก้ไขได้ภายหลัง เช่น ต่ออายุ)
    serviceType: '', productType: '', hasServicePeriod: false, serviceStartDate: '', serviceEndDate: '', notifyValue: '30', notifyUnit: 'day' as 'day' | 'month',
  })
  const [logo, setLogo] = useState<string | null>(null)
  const [logoDirty, setLogoDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Pronista §Position-based permission — ตำแหน่งต่อสมาชิกที่ "กำลังแก้ไข" อยู่ในหน้านี้ (ยังไม่บันทึก) แยกจาก project.members ที่โหลดมา
  const [memberAssignments, setMemberAssignments] = useState<Record<string, string>>({})

  // เติมค่าจากโปรเจกต์ที่โหลดมา (ครั้งเดียวตอนได้ data)
  useEffect(() => {
    if (!project) return
    setForm({
      name: project.name,
      description: project.description ?? '',
      url: project.url ?? '',
      status: project.status,
      clientId: project.clientId ?? '',
      code: project.code ?? '',
      budgetBaht: project.quotedSatang != null ? String(project.quotedSatang / 100) : '',
      startDate: project.startDate ?? '',
      dueDate: project.dueDate ?? '',
      recurringPeriod: project.recurringPeriod ?? 'monthly',
      serviceType: project.serviceType ?? '',
      productType: project.productType ?? '',
      hasServicePeriod: !!project.serviceEndDate,
      serviceStartDate: project.serviceStartDate ?? '',
      serviceEndDate: project.serviceEndDate ?? '',
      notifyValue: project.notifyBeforeDays != null ? String(project.notifyBeforeDays) : '30',
      notifyUnit: 'day',
    })
    setLogo(project.logo)
    setLogoDirty(false)
    setMemberAssignments(Object.fromEntries((project.members ?? []).map((m) => [m.id, m.positionId ?? ''])))
  }, [project])

  if (loading) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>
  if (!project) return <div className="p-6 text-sm text-muted">ไม่พบโปรเจกต์นี้</div>
  if (!canEditProject) {
    return (
      <div className="p-3 sm:p-6 max-w-2xl">
        <button onClick={() => navigate(`/projects/${id}`)} className="text-sm text-muted hover:text-soft flex items-center gap-1 mb-4">
          <ChevronLeft className="w-4 h-4" /> กลับไปหน้าโปรเจกต์
        </button>
        <div className="bg-white rounded-lg shadow-xs p-6 text-sm text-muted">
          คุณไม่มีสิทธิ์แก้ไขโปรเจกต์นี้ — ต้องเป็น editor ของโปรเจกต์นี้ (ติดต่อหัวหน้าทีมเพื่อขอสิทธิ์)
        </div>
      </div>
    )
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        description: form.description || null,
        url: form.url || null,
        status: form.status,
        clientId: form.clientId || null,
        code: form.code || null,
      }
      if (project.type === 'project') {
        body.quotedSatang = form.budgetBaht ? Math.round(Number(form.budgetBaht) * 100) : null
        body.startDate = form.startDate || null
        body.dueDate = form.dueDate || null
      } else {
        body.recurringPeriod = form.recurringPeriod
      }
      if (project.category === 'project') {
        body.serviceType = form.serviceType || null
      } else {
        body.productType = form.productType || null
      }
      body.serviceStartDate = form.hasServicePeriod ? form.serviceStartDate || null : null
      body.serviceEndDate = form.hasServicePeriod ? form.serviceEndDate || null : null
      body.notifyBeforeDays =
        form.hasServicePeriod && form.notifyValue ? Number(form.notifyValue) * (form.notifyUnit === 'month' ? 30 : 1) : null
      // logo: ส่งเฉพาะตอนเปลี่ยน lucide/เคลียร์ (อัปโหลดบันทึกที่ server แล้ว → ไม่ส่งซ้ำ)
      if (logoDirty) body.logo = logo
      await api.patch(`/api/projects/${id}`, body)
      // Pronista §7 — ปุ่ม "บันทึก" เดียวจัดการทั้ง Grid แก้ไขโปรเจกต์ + Grid สมาชิกโปรเจกต์: บันทึกเฉพาะ role ที่เปลี่ยนจริง (เทียบกับตอนโหลดมา)
      if (isOwner) {
        const before = Object.fromEntries((project.members ?? []).map((m) => [m.id, m.positionId ?? '']))
        const changed = Object.entries(memberAssignments).filter(([userId, positionId]) => positionId && positionId !== before[userId])
        await Promise.all(changed.map(([userId, positionId]) => api.post(`/api/projects/${id}/members`, { userId, positionId })))
      }
      navigate(`/projects/${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ')
      setSaving(false)
    }
  }

  return (
    <div className="p-3 sm:p-6 max-w-2xl">
      <button onClick={() => navigate(`/projects/${id}`)} className="text-sm text-muted hover:text-soft flex items-center gap-1 mb-4">
        <ChevronLeft className="w-4 h-4" /> กลับไปหน้าโปรเจกต์
      </button>

      <div className="bg-white rounded-lg shadow-xs p-5 sm:p-6">
        <h2 className="font-semibold text-ink mb-5">แก้ไขโปรเจกต์</h2>

        <div className="flex items-start gap-4 mb-5">
          <div>
            <div className="text-xs font-medium text-muted mb-1.5">ไอคอน</div>
            <IconPicker
              projectId={id}
              logo={logo}
              onChange={(l) => { setLogo(l); setLogoDirty(true) }}
              onUploaded={(l) => { setLogo(l); setLogoDirty(false) }}
            />
          </div>
          <div className="flex-1">
            <div className="text-xs font-medium text-muted mb-1.5">ชื่อโปรเจกต์</div>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} placeholder="ชื่อโปรเจกต์…" />
            <div className="text-[11px] text-muted mt-1.5">
              ประเภท: {project.type === 'project' ? 'งานโปรเจกต์' : 'งานต่อเนื่อง'} — เปลี่ยนประเภทไม่ได้
            </div>
          </div>
        </div>

        <label className="block mb-3">
          <div className="text-xs font-medium text-muted mb-1.5">คำโปรยสั้นๆ (แสดงใต้ชื่อโปรเจกต์)</div>
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={input} placeholder="เช่น เป็น Delivery app" maxLength={300} />
        </label>
        <label className="block mb-5">
          <div className="text-xs font-medium text-muted mb-1.5">URL (ถ้ามี)</div>
          <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className={input} placeholder="เช่น https://example.com" />
        </label>

        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <div className="text-xs font-medium text-muted mb-1.5">สถานะ</div>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={input}>
              {statusOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <div className="block">
            <div className="text-xs font-medium text-muted mb-1.5">ลูกค้า</div>
            <ClientCombobox
              clients={clientList}
              clientId={form.clientId}
              clientName=""
              onSelect={(id) => setForm({ ...form, clientId: id })}
              onClear={() => setForm({ ...form, clientId: '' })}
              allowClear
              placeholder="— ไม่ระบุ —"
            />
          </div>

          {project.type === 'project' ? (
            <>
              <label className="block">
                <div className="text-xs font-medium text-muted mb-1.5">งบประมาณ (บาท)</div>
                <input type="number" value={form.budgetBaht} onChange={(e) => setForm({ ...form, budgetBaht: e.target.value })} className={input} placeholder="0" />
              </label>
              <label className="block">
                <div className="text-xs font-medium text-muted mb-1.5">รหัสโปรเจกต์ (code)</div>
                <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={input} placeholder="ไม่บังคับ" maxLength={12} />
              </label>
              <label className="block">
                <div className="text-xs font-medium text-muted mb-1.5">เริ่ม</div>
                <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={input} />
              </label>
              <label className="block">
                <div className="text-xs font-medium text-muted mb-1.5">กำหนดส่ง</div>
                <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={input} />
              </label>
            </>
          ) : (
            <>
              <label className="block">
                <div className="text-xs font-medium text-muted mb-1.5">รอบ</div>
                <select value={form.recurringPeriod} onChange={(e) => setForm({ ...form, recurringPeriod: e.target.value as 'monthly' | 'yearly' })} className={input}>
                  <option value="monthly">รายเดือน</option>
                  <option value="yearly">รายปี</option>
                </select>
              </label>
              <label className="block">
                <div className="text-xs font-medium text-muted mb-1.5">รหัสโปรเจกต์ (code)</div>
                <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={input} placeholder="ไม่บังคับ" maxLength={12} />
              </label>
            </>
          )}
        </div>

        {(
          <div className="mt-5 pt-5 border-t border-border-subtle">
            <h3 className="text-sm font-semibold text-ink mb-3">บริการ / Subscription Notify</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              {project.category === 'project' ? (
                <label className="block">
                  <div className="text-xs font-medium text-muted mb-1.5">Service Type</div>
                  <select value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })} className={input}>
                    <option value="">— ไม่ระบุ —</option>
                    {serviceTypes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              ) : (
                <label className="block">
                  <div className="text-xs font-medium text-muted mb-1.5">Product Type</div>
                  <select value={form.productType} onChange={(e) => setForm({ ...form, productType: e.target.value })} className={input}>
                    <option value="">— ไม่ระบุ —</option>
                    {productTypes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-body cursor-pointer mt-3 mb-2">
              <input type="checkbox" checked={form.hasServicePeriod} onChange={(e) => setForm({ ...form, hasServicePeriod: e.target.checked })} />
              มีระยะเวลาให้บริการ (ไม่ติ๊ก = lifetime ไม่มีวันหมดอายุ)
            </label>
            {form.hasServicePeriod && (
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block">
                  <div className="text-xs font-medium text-muted mb-1.5">วันเริ่มบริการ</div>
                  <input type="date" value={form.serviceStartDate} onChange={(e) => setForm({ ...form, serviceStartDate: e.target.value })} className={input} />
                </label>
                <label className="block">
                  <div className="text-xs font-medium text-muted mb-1.5">วันหมดอายุบริการ</div>
                  <input type="date" value={form.serviceEndDate} onChange={(e) => setForm({ ...form, serviceEndDate: e.target.value })} className={input} />
                </label>
                <label className="block sm:col-span-2">
                  <div className="text-xs font-medium text-muted mb-1.5">แจ้งเตือนล่วงหน้าก่อนหมดอายุ</div>
                  <div className="flex gap-2">
                    <input type="number" min={1} value={form.notifyValue} onChange={(e) => setForm({ ...form, notifyValue: e.target.value })} className={`${input} w-24`} />
                    <select value={form.notifyUnit} onChange={(e) => setForm({ ...form, notifyUnit: e.target.value as 'day' | 'month' })} className={input}>
                      <option value="day">วัน</option>
                      <option value="month">เดือน</option>
                    </select>
                  </div>
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      {isOwner && (
        <MembersSection
          assignments={memberAssignments}
          positions={positionsData?.positions ?? []}
          existingMemberIds={new Set((project.members ?? []).map((m) => m.id))}
          onChange={(userId, positionId) => setMemberAssignments((a) => ({ ...a, [userId]: positionId }))}
        />
      )}

      {error && <div className="text-xs text-danger-600 mt-4">{error}</div>}

      {/* Pronista §7 — ปุ่มบันทึกเดียว ครอบทั้ง Grid แก้ไขโปรเจกต์ + Grid สมาชิกโปรเจกต์ */}
      <div className="flex justify-end gap-2 mt-6">
        <button onClick={() => navigate(`/projects/${id}`)} className="text-sm px-3 py-2 rounded-lg hover:bg-hover">ยกเลิก</button>
        <button onClick={() => void save()} disabled={!form.name || saving} className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-40">
          {saving ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </div>
    </div>
  )
}
