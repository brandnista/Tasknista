/**
 * Pronista §Project Estimate v2 — แท็บ "Project Estimate" (เห็นเฉพาะ owner — เผยต้นทุน/margin ของทีมทั้งหมด)
 * Role ต่อ task มาจาก PM เลือกเองจาก company_config.parameterRoles (ดู tasks.costRoleId) — ไม่ผูกกับตำแหน่งสิทธิ์ (positions) ของสมาชิกโปรเจกต์
 * Cost/Hour คำนวณอัตโนมัติจาก Cost/Day ÷ 8 (costPerHourFromDay) · Work Hour/Day กรอกเองต่อ task (tasks.costWorkMinutesPerDay)
 * สรุปงานรายบุคคล (ภาพรวมทุกคน → คลิกดูรายละเอียดต่อคน) + 4 แท็บย่อย: Summary / Phase / Task Group / Task (ดึงงานทั้งหมดในโปรเจกต์อัตโนมัติ ไม่มี checkbox เลือกอีกต่อไป)
 */
import { formatSatang, minutesToHoursLabel, resolveParameterRoles, type ParameterRole } from '@seedoffice/core'
import { Check, Table2, X } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { Avatar } from './Avatar'
import { useDialog } from './Dialog'

/* ตัวย่อสี fallback ของ Avatar — ก็อปสูตรเดียวกับ pages/ProjectDetail.tsx (ไม่ import ข้ามหน้า กัน circular import เพราะหน้านั้น import component นี้อยู่แล้ว) */
const AVATAR_COLORS = ['bg-brand-100 text-brand-700', 'bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700', 'bg-rose-100 text-rose-700', 'bg-amber-100 text-amber-700', 'bg-teal-100 text-teal-700', 'bg-indigo-100 text-indigo-700', 'bg-pink-100 text-pink-700']
const avatarColor = (key: string) => AVATAR_COLORS[[...key].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AVATAR_COLORS.length]

interface EstimateRow {
  taskId: string
  taskCode: string | null
  title: string
  assigneeId: string | null
  assigneeName: string | null
  costRoleId: string | null
  roleName: string | null
  costPerDaySatang: number | null
  costPerHourSatang: number | null
  estimateMinutes: number
  bufferPercent: number
  bufferMinutes: number
  totalMinutes: number
  netCostSatang: number | null
  workMinutesPerDay: number
  estimateDays: number
  marginSatang: number | null
  estimateCostSatang: number | null
  quotationSatang: number | null
}

interface EstimateResponse {
  rows: EstimateRow[]
  totals: { netCostSatang: number; marginSatang: number; estimateCostSatang: number }
  project: { estimateNetWorkingDays: number | null; quotedSatang: number | null }
  suggestedNetWorkingDays: number | null
  estimateProjectCostPerDaySatang: number | null
}

interface GroupRow {
  taskTypeId: string
  taskTypeName: string
  subTaskTypeId: string
  name: string
  source: 'auto' | 'manual'
  teamMember: string | null
  teamMemberIds: string[]
  role: string | null
  costRoleId?: string | null
  costPerDaySatang: number | null
  costPerHourSatang: number | null
  estimateMinutes: number
  bufferPercent: number | null
  bufferMinutes: number
  totalMinutes: number
  netCostSatang: number | null
  workMinutesPerDay: number | null
  estimateDays: number
  marginSatang: number | null
  estimateCostSatang: number | null
  quotationSatang: number | null
}

interface ExtraCost {
  id: string
  category: 'aex' | 'opex'
  name: string
  netCostSatang: number | null
  marginSatang: number | null
  estimateCostSatang: number | null
  quotationSatang: number | null
}

/** กลุ่มที่ยังไม่ถูกเลือก — ใช้ทำเมนู "เพิ่มกลุ่มงาน" · taskCount > 0 = เลือกแล้วระบบดึงงานจริงมากรอกให้เอง */
interface AvailableGroup {
  taskTypeId: string
  taskTypeName: string
  subTaskTypeId: string
  name: string
  taskCount: number
}

interface GroupsResponse {
  groups: GroupRow[]
  available: AvailableGroup[]
  extraCosts: ExtraCost[]
  totals: { netCostSatang: number; marginSatang: number; extraCostsSatang: number; estimateCostSatang: number; quotationSatang: number }
}

interface PhaseRow {
  taskTypeId: string
  name: string
  totalEstimateDays: number
}

interface ExtraCostCategoryTotal {
  netCostSatang: number
  marginSatang: number
  estimateCostSatang: number
  quotationSatang: number
}

interface PhasesResponse {
  phases: PhaseRow[]
  extraCostTotals: { aex: ExtraCostCategoryTotal; opex: ExtraCostCategoryTotal }
}

const EXTRA_COST_LABEL: Record<'aex' | 'opex', string> = { aex: 'AEX', opex: 'OPEX' }

type EstimateView = 'summary' | 'phase' | 'group' | 'task'
const VIEWS: [EstimateView, string][] = [
  ['summary', 'Summary'],
  ['phase', 'Phase'],
  ['group', 'Task Group'],
  ['task', 'Task'],
]

/* ตาราง Task Group — คลาสร่วม แยก "ช่องกรอกเอง" ออกจาก "ตัวเลขที่ระบบคำนวณให้" ด้วยสายตา */
const bandCell = 'bg-hover text-left text-[10px] font-semibold tracking-[0.09em] uppercase text-muted px-3 pt-2 pb-0.5'
/* Tab Summary — "ค่าใช้จ่ายในระบบ" กับ "ค่าใช้จ่ายนอกระบบ" ใช้โทนฟ้าเดียวกันทั้งคู่ (ไม่แยกสี) แต่หัวข้อหลักตัวหนา+ใหญ่กว่าหัวข้อย่อย ให้เห็นลำดับชั้นชัดโดยไม่ต้องแย่งสี */
const bandCellMain = 'text-left text-[13px] font-bold px-3 py-2 bg-sky-100 text-sky-900'
const bandCellIn = `${bandCell} bg-sky-50 text-sky-700`
const bandCellOutMain = bandCellMain
const bandCellOut = `${bandCell} bg-sky-50 text-sky-700`
const colCell = 'bg-hover text-[11.5px] font-medium text-dim px-3 pt-1 pb-2.5 border-b border-border-subtle whitespace-nowrap'
const bodyCell = 'px-3 py-2.5 border-b border-divider align-middle'
const calcCell = `${bodyCell} text-right tabular-nums text-dim`
const footCell = 'px-3 py-3 border-t-2 border-border-subtle bg-white'
const fieldCell =
  'text-sm text-body bg-white border border-border rounded-md px-2 py-1.5 hover:border-muted focus:outline-hidden focus:border-brand-400 focus:ring-3 focus:ring-brand-100'
const numCell = `${fieldCell} w-[78px] text-right tabular-nums`

/** ปุ่ม + เมนูเลือกกลุ่มงาน (จัดกลุ่มตาม Task Type · badge บอกว่ากลุ่มไหนมีงานจริงรออยู่) */
function GroupPicker({
  open,
  setOpen,
  buckets,
  onPick,
  label,
}: {
  open: boolean
  setOpen: (v: boolean) => void
  buckets: { taskTypeId: string; taskTypeName: string; items: AvailableGroup[] }[]
  onPick: (taskTypeId: string, subTaskTypeId: string) => void | Promise<void>
  label: string
}) {
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 active:translate-y-px rounded-lg px-3.5 py-2 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:outline-offset-2"
      >
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 w-[300px] max-h-[330px] overflow-y-auto bg-white rounded-xl shadow-2xl border border-border-subtle p-2">
            {buckets.length === 0 ? (
              <div className="px-2.5 py-4 text-center text-xs text-muted">เลือกครบทุกกลุ่มแล้ว</div>
            ) : (
              buckets.map((b) => (
                <div key={b.taskTypeId}>
                  <div className="px-2.5 pt-2 pb-1 text-[10.5px] font-semibold tracking-wider uppercase text-muted">{b.taskTypeName}</div>
                  {b.items.map((it) => (
                    <button
                      key={it.subTaskTypeId}
                      type="button"
                      onClick={() => void onPick(it.taskTypeId, it.subTaskTypeId)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-hover text-left text-[13px] text-body"
                    >
                      <span className="flex-1 min-w-0 truncate">{it.name}</span>
                      {it.taskCount > 0 && (
                        <span className="text-[10.5px] font-medium rounded-full px-1.5 py-0.5 bg-success-50 text-success-700 whitespace-nowrap">
                          มีงานจริง {it.taskCount}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

export function ProjectEstimateSection({
  projectId,
  members,
}: {
  projectId: string
  members: { id: string; name: string; role?: 'owner' | 'member' | 'vendor' | 'guest'; avatarUrl?: string | null }[]
}) {
  const { confirmDialog } = useDialog()
  // Pronista §Project Estimate — สรุปงานรายบุคคล: ดึงสมาชิกทุกคนในโปรเจกต์ ยกเว้นลูกค้า (role='guest') — staff/outsource ดึงมาหมด
  // Admin(owner) ไม่มีทางอยู่ใน project_members ได้เลย (backend กันไว้ เพราะ owner เข้าถึงทุกโปรเจกต์เต็มรูปแบบเสมอ) แต่ยังถูก assign งานได้ปกติ — ดึงจาก /api/users มาต่อท้ายแทน
  const { data: allUsersData } = useLoad<{ id: string; name: string; role: 'owner' | 'member' | 'vendor' | 'guest'; avatarUrl: string | null }[]>(() =>
    api.get('/api/users'),
  )
  const adminUsers = (allUsersData ?? []).filter((u) => u.role === 'owner')
  const summaryMembers = [...members.filter((m) => m.role !== 'guest'), ...adminUsers.filter((a) => !members.some((m) => m.id === a.id))]

  const { data: estimate, reload: reloadEstimate } = useLoad<EstimateResponse>(() => api.get(`/api/projects/${projectId}/estimate`), [projectId])
  const { data: groupsData, reload: reloadGroups } = useLoad<GroupsResponse>(() => api.get(`/api/projects/${projectId}/estimate/groups`), [projectId])
  const { data: phasesData, reload: reloadPhases } = useLoad<PhasesResponse>(() => api.get(`/api/projects/${projectId}/estimate/phases`), [projectId])
  const { data: roleCfg } = useLoad<{ parameterRoles: ParameterRole[] }>(() => api.get('/api/admin/parameter-roles'))

  const parameterRoles = resolveParameterRoles(roleCfg?.parameterRoles)

  const money = (satang: number | null) => (satang != null ? formatSatang(satang) : '—')
  const hours = (minutes: number) => minutesToHoursLabel(minutes)

  const reloadAll = async () => {
    await Promise.all([reloadEstimate(), reloadGroups(), reloadPhases()])
  }

  // --- สรุปงานรายบุคคล — default = ภาพรวมทุกคน · คลิกชื่อ = ดูรายละเอียดงานของคนนั้น ---
  const [memberId, setMemberId] = useState('')
  const memberOverview = summaryMembers.map((m) => {
    const tasksOfMember = (estimate?.rows ?? []).filter((r) => r.assigneeId === m.id)
    return {
      id: m.id,
      name: m.name,
      avatarUrl: m.avatarUrl,
      totalMinutes: tasksOfMember.reduce((sum, r) => sum + r.estimateMinutes, 0),
      count: tasksOfMember.length,
    }
  })
  const selectedMember = summaryMembers.find((m) => m.id === memberId)
  const memberTasks = (estimate?.rows ?? []).filter((r) => r.assigneeId === memberId)
  const memberTotalMinutes = memberTasks.reduce((sum, r) => sum + r.estimateMinutes, 0)

  // --- แท็บย่อย ---
  const [view, setView] = useState<EstimateView>('group')

  // --- แก้ไขในตาราง Estimate (แท็บ Task) ---
  const saveRole = async (taskId: string, costRoleId: string) => {
    await api.patch(`/api/tasks/${taskId}`, { costRoleId: costRoleId || null })
    await reloadAll()
  }
  const saveWorkHourPerDay = async (taskId: string, v: string) => {
    await api.patch(`/api/tasks/${taskId}`, { costWorkMinutesPerDay: v.trim() ? Math.round(Number(v) * 60) : null })
    await reloadAll()
  }
  const saveBufferPercent = async (taskId: string, v: string) => {
    await api.patch(`/api/tasks/${taskId}`, { costBufferPercent: v.trim() ? Math.round(Number(v)) : null })
    await reloadAll()
  }
  const saveQuotation = async (taskId: string, v: string) => {
    await api.patch(`/api/tasks/${taskId}`, { quotationSatang: v.trim() ? Math.round(Number(v) * 100) : null })
    await reloadAll()
  }
  const saveNetWorkingDays = async (v: string) => {
    const n = v.trim() ? Math.round(Number(v)) : null
    await api.patch(`/api/projects/${projectId}`, { estimateNetWorkingDays: n })
    await reloadEstimate()
  }

  // --- Task Group แบบ custom: PM/แบงค์กดเพิ่มแถวเอง เลือก Task Group จากแคตตาล็อก ตั้งค่า > ประเภทงาน ---
  const saveGroupField = async (taskTypeId: string, subTaskTypeId: string, patch: Record<string, unknown>) => {
    await api.put(`/api/projects/${projectId}/estimate/groups/override`, { taskTypeId, subTaskTypeId, ...patch })
    await reloadAll()
  }
  // เมนูเลือกกลุ่มงาน — จัดกลุ่มตาม Task Type ตามแคตตาล็อกใน ตั้งค่า > ประเภทงาน
  const [groupPickerOpen, setGroupPickerOpen] = useState(false)
  const availableByType = (groupsData?.available ?? []).reduce<{ taskTypeId: string; taskTypeName: string; items: AvailableGroup[] }[]>((acc, a) => {
    const bucket = acc.find((x) => x.taskTypeId === a.taskTypeId)
    if (bucket) bucket.items.push(a)
    else acc.push({ taskTypeId: a.taskTypeId, taskTypeName: a.taskTypeName, items: [a] })
    return acc
  }, [])
  // Tab Summary — ต้นไม้ Task Type > Task Group (groupsData.groups มาตามลำดับแคตตาล็อกจาก backend อยู่แล้ว)
  const groupsByType = (groupsData?.groups ?? []).reduce<{ taskTypeId: string; taskTypeName: string; items: GroupRow[] }[]>((acc, g) => {
    const bucket = acc.find((x) => x.taskTypeId === g.taskTypeId)
    if (bucket) bucket.items.push(g)
    else acc.push({ taskTypeId: g.taskTypeId, taskTypeName: g.taskTypeName, items: [g] })
    return acc
  }, [])
  const addGroupRow = async (taskTypeId: string, subTaskTypeId: string) => {
    setGroupPickerOpen(false)
    await saveGroupField(taskTypeId, subTaskTypeId, {})
  }
  const deleteGroupRow = async (taskTypeId: string, subTaskTypeId: string, name: string) => {
    const yes = await confirmDialog({ title: `เอา "${name}" ออกจาก Task Group?`, message: 'ค่าที่กรอกไว้ในแถวนี้จะหายไป', confirmLabel: 'เอาออก', danger: true })
    if (!yes) return
    await api.delete(`/api/projects/${projectId}/estimate/groups/override?taskTypeId=${taskTypeId}&subTaskTypeId=${subTaskTypeId}`)
    await reloadAll()
  }

  // เลือกคนทีละคน — เมนูค้างเปิดไว้ ติ๊กรวดเดียวหลายคนได้ (key = taskTypeId::subTaskTypeId ของแถวที่เปิดอยู่)
  const [peoplePickerFor, setPeoplePickerFor] = useState('')
  const toggleMember = async (g: GroupRow, userId: string) => {
    const next = g.teamMemberIds.includes(userId) ? g.teamMemberIds.filter((id) => id !== userId) : [...g.teamMemberIds, userId]
    await saveGroupField(g.taskTypeId, g.subTaskTypeId, { teamMemberIds: next })
  }
  // ค้นชื่อจาก allUsersData (สมาชิกทั้งองค์กร) ก่อนเสมอ — ไม่ใช่แค่ summaryMembers (สมาชิกโปรเจกต์) เพราะ Task Group แบบ auto อาจมีคนที่ถูก assign งานจริงแต่ไม่ได้ถูกเพิ่มเป็นสมาชิกโปรเจกต์ทางการ (เช่น vendor ที่รับงานตรง) — ไม่งั้นจะเจอ user id ดิบๆ โผล่แทนชื่อ
  const memberName = (id: string) => (allUsersData ?? []).find((u) => u.id === id)?.name ?? summaryMembers.find((m) => m.id === id)?.name ?? id
  const memberAvatarUrl = (id: string) => (allUsersData ?? []).find((u) => u.id === id)?.avatarUrl ?? summaryMembers.find((m) => m.id === id)?.avatarUrl
  const rowKey = (g: GroupRow) => `${g.taskTypeId}::${g.subTaskTypeId}`

  // --- ค่าใช้จ่ายนอกระบบ — แยกหัวข้อหลัก AEX/OPEX · netCostSatang กรอกเอง margin/estimateCost คำนวณจาก company margin% ---
  const addExtraCost = async (category: 'aex' | 'opex') => {
    await api.post(`/api/projects/${projectId}/estimate/extra-costs`, { category, name: 'รายการใหม่' })
    await reloadAll()
  }
  const saveExtraCostName = async (id: string, name: string) => {
    await api.patch(`/api/projects/${projectId}/estimate/extra-costs/${id}`, { name })
    await reloadAll()
  }
  const saveExtraCostNetCost = async (id: string, v: string) => {
    await api.patch(`/api/projects/${projectId}/estimate/extra-costs/${id}`, { netCostSatang: v.trim() ? Math.round(Number(v) * 100) : null })
    await reloadAll()
  }
  const saveExtraCostQuotation = async (id: string, v: string) => {
    await api.patch(`/api/projects/${projectId}/estimate/extra-costs/${id}`, { quotationSatang: v.trim() ? Math.round(Number(v) * 100) : null })
    await reloadAll()
  }
  const deleteExtraCost = async (id: string, name: string) => {
    const yes = await confirmDialog({ title: `เอา "${name}" ออกจากค่าใช้จ่ายนอกระบบ?`, message: 'กู้คืนเองไม่ได้ผ่านหน้านี้', confirmLabel: 'เอาออก', danger: true })
    if (!yes) return
    await api.delete(`/api/projects/${projectId}/estimate/extra-costs/${id}`)
    await reloadAll()
  }

  if (!estimate || !groupsData || !phasesData) return <div className="text-sm text-muted py-6 text-center">กำลังโหลด…</div>

  return (
    <div className="space-y-4">
      {/* ส่วนสรุปงานรายบุคคล */}
      <div className="bg-white rounded-lg shadow-xs">
        <div className="flex items-center justify-between gap-3 flex-wrap p-4 sm:p-5 pb-4">
          <div className="text-sm font-semibold text-strong">สรุปงานรายบุคคล</div>
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className={`${fieldCell} w-[200px]`}
          >
            <option value="">— ภาพรวมทุกคน —</option>
            {summaryMembers.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        {!memberId ? (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={`${colCell} text-left`}>สมาชิก</th>
                <th className={`${colCell} text-right`}>จำนวนงาน</th>
                <th className={`${colCell} text-right`}>ประมาณการรวม (ชม.)</th>
              </tr>
            </thead>
            <tbody>
              {memberOverview.map((m) => (
                <tr key={m.id} className="hover:bg-hover">
                  <td className={bodyCell}>
                    <button onClick={() => setMemberId(m.id)} className="flex items-center gap-2.5 text-brand-700 hover:underline">
                      <Avatar name={m.name} avatarUrl={m.avatarUrl} className="w-7 h-7 text-[11px]" colorClass={avatarColor(m.name)} />
                      {m.name}
                    </button>
                  </td>
                  <td className={calcCell}>{m.count}</td>
                  <td className={calcCell}>{m.totalMinutes ? hours(m.totalMinutes) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : memberTasks.length === 0 ? (
          <div className="text-sm text-muted py-8 text-center border-t border-divider">ยังไม่มีงานที่ Assign ให้ {selectedMember?.name ?? 'คนนี้'} ในโปรเจกต์นี้</div>
        ) : (
          <>
            <div className="flex items-center gap-2.5 px-4 sm:px-5 pb-3">
              <Avatar name={selectedMember?.name ?? ''} avatarUrl={selectedMember?.avatarUrl} className="w-8 h-8 text-xs" colorClass={avatarColor(selectedMember?.name ?? '')} />
              <span className="text-sm font-medium text-strong">{selectedMember?.name}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={`${colCell} text-left`}>งาน</th>
                  <th className={`${colCell} text-right`}>ประมาณการ (ชม.)</th>
                </tr>
              </thead>
              <tbody>
                {memberTasks.map((r) => (
                  <tr key={r.taskId} className="hover:bg-hover">
                    <td className={bodyCell}>
                      {r.taskCode && <span className="text-muted font-mono text-xs mr-1">{r.taskCode}</span>}
                      <Link to={`/tasks/${r.taskId}`} className="text-brand-700 hover:underline">{r.title}</Link>
                    </td>
                    <td className={calcCell}>{r.estimateMinutes ? hours(r.estimateMinutes) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-strong">
                  <td className={footCell}>รวม</td>
                  <td className={`${footCell} text-right tabular-nums`}>{hours(memberTotalMinutes)} ชม.</td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
      </div>

      {/* แท็บย่อย Summary / Phase / Task Group / Task */}
      <div className="bg-white rounded-lg shadow-xs p-2 flex gap-1 flex-wrap">
        {VIEWS.map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium ${view === v ? 'bg-ink text-white' : 'text-body hover:bg-hover'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab: Summary — ต้นไม้ Task Type > Task Group + ค่าใช้จ่ายนอกระบบ (AEX/OPEX) แล้วปิดท้ายด้วย Total ตามภาพร่างที่แนบ */}
      {view === 'summary' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-xs">
            <div className="p-4 sm:p-5 pb-3">
              <div className="text-sm font-semibold text-strong">Summary — ภาพรวมต้นทุนทั้งโปรเจกต์</div>
              <p className="text-xs text-dim mt-0.5">รวมทุก Task Group และค่าใช้จ่ายนอกระบบ แยกตามหัวข้อ</p>
            </div>
            <div className="overflow-x-auto border-t border-divider">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr>
                    <th className={`${colCell} text-left`}>รายการ</th>
                    <th className={`${colCell} text-right`}>Net Cost (Hour)</th>
                    <th className={`${colCell} text-right bg-brand-50 text-brand-700 shadow-[inset_2px_0_0_var(--color-brand-200)]`}>Margin</th>
                    <th className={`${colCell} text-right bg-brand-50 text-brand-700`}>Estimate Cost</th>
                    <th className={`${colCell} text-right bg-brand-50 text-brand-700`}>Quotation Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {groupsByType.length > 0 && (
                    <>
                      <tr>
                        <td colSpan={5} className={bandCellMain}>ค่าใช้จ่ายในระบบ</td>
                      </tr>
                      {groupsByType.map((bucket) => (
                        <Fragment key={bucket.taskTypeId}>
                          <tr>
                            <td colSpan={5} className={`${bandCellIn} pl-6`}>{bucket.taskTypeName}</td>
                          </tr>
                          {bucket.items.map((g) => (
                            <tr key={`${g.taskTypeId}::${g.subTaskTypeId}`} className="hover:bg-hover">
                              <td className={`${bodyCell} pl-9`}>{g.name}</td>
                              <td className={calcCell}>{g.netCostSatang != null ? money(g.netCostSatang) : '—'}</td>
                              <td className={`${calcCell} bg-brand-50 shadow-[inset_2px_0_0_var(--color-brand-200)]`}>{money(g.marginSatang)}</td>
                              <td className={`${calcCell} bg-brand-50 text-strong font-semibold`}>{money(g.estimateCostSatang)}</td>
                              <td className={`${calcCell} bg-brand-50`}>{g.quotationSatang != null ? money(g.quotationSatang) : '—'}</td>
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </>
                  )}

                  {groupsData.extraCosts.length > 0 && (
                    <>
                      <tr>
                        <td colSpan={5} className={bandCellOutMain}>ค่าใช้จ่ายนอกระบบ</td>
                      </tr>
                      {(['aex', 'opex'] as const).map((cat) => {
                        const items = groupsData.extraCosts.filter((x) => x.category === cat)
                        if (items.length === 0) return null
                        return (
                          <Fragment key={cat}>
                            <tr>
                              <td colSpan={5} className={`${bandCellOut} pl-6`}>{EXTRA_COST_LABEL[cat]}</td>
                            </tr>
                            {items.map((x) => (
                              <tr key={x.id} className="hover:bg-hover">
                                <td className={`${bodyCell} pl-9`}>{x.name}</td>
                                <td className={calcCell}>{x.netCostSatang != null ? money(x.netCostSatang) : '—'}</td>
                                <td className={`${calcCell} bg-brand-50 shadow-[inset_2px_0_0_var(--color-brand-200)]`}>{money(x.marginSatang)}</td>
                                <td className={`${calcCell} bg-brand-50 text-strong font-semibold`}>{money(x.estimateCostSatang)}</td>
                                <td className={`${calcCell} bg-brand-50`}>{x.quotationSatang != null ? money(x.quotationSatang) : '—'}</td>
                              </tr>
                            ))}
                          </Fragment>
                        )
                      })}
                    </>
                  )}

                  {groupsByType.length === 0 && groupsData.extraCosts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-sm text-muted py-8 text-center">ยังไม่มีรายการ — เริ่มที่แท็บ Task Group</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-strong">
                    <td className={`${footCell} whitespace-nowrap`}>Total</td>
                    <td className={`${footCell} text-right tabular-nums`}>{formatSatang(groupsData.totals.netCostSatang)}</td>
                    <td className={`${footCell} text-right tabular-nums bg-brand-50`}>{formatSatang(groupsData.totals.marginSatang)}</td>
                    <td className={`${footCell} text-right tabular-nums bg-brand-50`}>{formatSatang(groupsData.totals.estimateCostSatang)}</td>
                    <td className={`${footCell} text-right tabular-nums bg-brand-50`}>{formatSatang(groupsData.totals.quotationSatang)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Phase — Estimate Day ตามหัวข้อหลัก + สรุปค่าใช้จ่ายนอกระบบแยก AEX/OPEX */}
      {view === 'phase' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-xs">
            <div className="p-4 sm:p-5 pb-3">
              <div className="text-sm font-semibold text-strong">Phase — รวม Estimate Day จาก Task Group ตามหัวข้อหลัก</div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={`${colCell} text-left`}>Phase</th>
                  <th className={`${colCell} text-right`}>Total Estimate Day</th>
                </tr>
              </thead>
              <tbody>
                {phasesData.phases.map((p) => (
                  <tr key={p.taskTypeId} className="hover:bg-hover">
                    <td className={bodyCell}>{p.name}</td>
                    <td className={calcCell}>{p.totalEstimateDays.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold text-strong">
                  <td className={footCell}>รวม</td>
                  <td className={`${footCell} text-right tabular-nums`}>{phasesData.phases.reduce((s, p) => s + p.totalEstimateDays, 0).toFixed(1)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="bg-white rounded-lg shadow-xs">
            <div className="p-4 sm:p-5 pb-3">
              <div className="text-sm font-semibold text-strong">ค่าใช้จ่ายนอกระบบ — รวมตามหัวข้อ AEX / OPEX</div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={`${colCell} text-left`}>หัวข้อ</th>
                  <th className={`${colCell} text-right`}>Net Cost (Hour)</th>
                  <th className={`${colCell} text-right bg-brand-50 text-brand-700 shadow-[inset_2px_0_0_var(--color-brand-200)]`}>Margin</th>
                  <th className={`${colCell} text-right bg-brand-50 text-brand-700`}>Estimate Cost</th>
                </tr>
              </thead>
              <tbody>
                {(['aex', 'opex'] as const).map((cat) => {
                  const t = phasesData.extraCostTotals[cat]
                  return (
                    <tr key={cat} className="hover:bg-hover">
                      <td className={bodyCell}>{EXTRA_COST_LABEL[cat]}</td>
                      <td className={calcCell}>{formatSatang(t.netCostSatang)}</td>
                      <td className={`${calcCell} bg-brand-50 shadow-[inset_2px_0_0_var(--color-brand-200)]`}>{formatSatang(t.marginSatang)}</td>
                      <td className={`${calcCell} bg-brand-50 text-strong font-semibold`}>{formatSatang(t.estimateCostSatang)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Task Group — เริ่มจากตารางว่าง PM เลือกกลุ่มงานเองทีละกลุ่ม (กลุ่มที่มี task จริงจะเติมข้อมูลให้อัตโนมัติ) */}
      {view === 'group' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-xs">
            <div className="flex items-start justify-between gap-4 flex-wrap p-4 sm:p-5 pb-4">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-strong">Task Group</div>
                <p className="text-xs text-dim mt-0.5">
                  เลือกกลุ่มงานที่จะใส่ในใบเสนอราคา — กลุ่มไหนมีงานจริงในโปรเจกต์อยู่แล้ว ระบบจะดึงมากรอกให้เอง
                </p>
              </div>
              {groupsData.groups.length > 0 && (
                <GroupPicker
                  open={groupPickerOpen}
                  setOpen={setGroupPickerOpen}
                  buckets={availableByType}
                  onPick={addGroupRow}
                  label="+ เพิ่มกลุ่มงาน"
                />
              )}
            </div>

            {groupsData.groups.length === 0 ? (
              <div className="m-4 sm:m-5 mt-0 border-[1.5px] border-dashed border-border rounded-lg bg-hover px-6 py-14 text-center">
                <div className="w-11 h-11 mx-auto mb-4 grid place-items-center rounded-[10px] bg-brand-50 text-brand-600">
                  <Table2 className="w-[22px] h-[22px]" />
                </div>
                <div className="text-sm font-semibold text-strong mb-1.5">ยังไม่ได้เลือกกลุ่มงาน</div>
                <p className="text-[13px] text-dim leading-relaxed max-w-[42ch] mx-auto mb-5">
                  เริ่มจากเลือกกลุ่มงานที่จะคิดเงินลูกค้า เช่น UX &amp; UI Design หรือ Backend แล้วค่อยกรอกชั่วโมงกับราคา
                </p>
                <GroupPicker
                  open={groupPickerOpen}
                  setOpen={setGroupPickerOpen}
                  buckets={availableByType}
                  onPick={addGroupRow}
                  label="+ เลือกกลุ่มงานแรก"
                />
              </div>
            ) : (
              <>
                {/* legend — บอกความหมายของสีในตาราง ไม่ต้องเดาว่าช่องไหนแตะได้ */}
                <div className="flex items-center gap-4 flex-wrap px-4 sm:px-5 pb-3 text-[11.5px] text-dim">
                  <span className="inline-flex items-center gap-1.5">
                    <i className="w-[22px] h-3.5 rounded bg-white border border-border inline-block" /> ช่องที่กรอกเอง
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <i className="w-[22px] h-3.5 rounded bg-divider inline-block" /> ระบบคำนวณให้
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <i className="w-[22px] h-3.5 rounded bg-brand-50 border border-brand-100 inline-block" /> เงินที่จะเสนอลูกค้า
                  </span>
                </div>

                <div className="overflow-x-auto border-t border-divider">
                  <table className="w-full text-sm min-w-[1360px] border-separate border-spacing-0">
                    <thead>
                      {/* แถวบน = ป้ายกลุ่มคอลัมน์ ให้ตาจับได้ว่ากำลังอ่านโซนไหน */}
                      <tr>
                        <th colSpan={3} className={`${bandCell} sticky left-0 z-30 bg-hover`}>งาน &amp; ผู้รับผิดชอบ</th>
                        <th colSpan={9} className={bandCell}>ต้นทุน &amp; เวลา</th>
                        <th colSpan={3} className={`${bandCell} bg-brand-50 text-brand-700 shadow-[inset_2px_0_0_var(--color-brand-200)]`}>ราคา</th>
                        <th className="bg-hover" />
                      </tr>
                      <tr>
                        <th className={`${colCell} text-left sticky left-0 z-30 bg-hover shadow-[1px_0_0_var(--color-border-subtle)]`}>Task Group</th>
                        <th className={`${colCell} text-left`}>Team Member</th>
                        <th className={`${colCell} text-left`}>Role</th>
                        <th className={`${colCell} text-right`}>Cost/Day</th>
                        <th className={`${colCell} text-right`}>Cost/Hour</th>
                        <th className={`${colCell} text-right`}>Estimate W/H</th>
                        <th className={`${colCell} text-right`}>Buffer %</th>
                        <th className={`${colCell} text-right`}>Buffer W/H</th>
                        <th className={`${colCell} text-right`}>Total W/H</th>
                        <th className={`${colCell} text-right`}>Net Cost (Hour)</th>
                        <th className={`${colCell} text-right`}>Work Hour/Day</th>
                        <th className={`${colCell} text-right`}>Estimate Day</th>
                        <th className={`${colCell} text-right bg-brand-50 text-brand-700 shadow-[inset_2px_0_0_var(--color-brand-200)]`}>Margin</th>
                        <th className={`${colCell} text-right bg-brand-50 text-brand-700`}>Estimate Cost</th>
                        <th className={`${colCell} text-right bg-brand-50 text-brand-700`}>Quotation Cost</th>
                        <th className={colCell} />
                      </tr>
                    </thead>
                    <tbody>
                      {groupsData.groups.map((g) => {
                        const auto = g.source === 'auto'
                        return (
                          <tr key={`${g.taskTypeId}::${g.subTaskTypeId}`} className="group/row">
                            {/* คอลัมน์แรกตรึงไว้ — เลื่อนไปขวาสุดก็ยังรู้ว่าอ่านแถวไหนอยู่ */}
                            <td className={`${bodyCell} sticky left-0 z-20 bg-white group-hover/row:bg-hover shadow-[1px_0_0_var(--color-border-subtle)] whitespace-nowrap`}>
                              <span className="font-medium text-strong">{g.name}</span>
                              {auto && (
                                <span className="ml-2 align-middle text-[10px] font-medium rounded-full px-1.5 py-0.5 bg-success-50 text-success-700 whitespace-nowrap">
                                  จากงานจริง
                                </span>
                              )}
                              <span className="block text-[10.5px] text-muted font-normal mt-px">{g.taskTypeName}</span>
                            </td>

                            {/* Team Member — กรอกทับเองได้เสมอ (chip ใช้สีเดียวกับ avatar แถวสมาชิกด้านบนของโปรเจกต์) ไม่แตะ = auto-fill จากผู้รับผิดชอบงานจริง */}
                            <td className={`${bodyCell} relative`}>
                              <div className="flex items-center gap-1.5 flex-wrap min-w-[172px]">
                                {g.teamMemberIds.map((uid) => (
                                  <span
                                    key={uid}
                                    className="inline-flex items-center gap-1.5 rounded-full pl-1 pr-1 py-0.5 text-xs font-medium bg-brand-50 text-brand-800 border border-brand-100 whitespace-nowrap"
                                  >
                                    <Avatar name={memberName(uid)} avatarUrl={memberAvatarUrl(uid)} className="w-4 h-4 text-[8px]" colorClass={avatarColor(memberName(uid))} />
                                    {memberName(uid)}
                                    <button
                                      type="button"
                                      aria-label={`เอา ${memberName(uid)} ออก`}
                                      onClick={() => void toggleMember(g, uid)}
                                      className="w-[17px] h-[17px] grid place-items-center rounded-full text-brand-600 hover:bg-brand-200 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-brand-500"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </span>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => setPeoplePickerFor((v) => (v === rowKey(g) ? '' : rowKey(g)))}
                                  className="text-xs font-medium text-brand-700 bg-white border border-dashed border-border rounded-full px-2.5 py-0.5 whitespace-nowrap hover:border-brand-400 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:outline-offset-2"
                                >
                                  {g.teamMemberIds.length ? '+ เพิ่ม' : '+ เลือกคน'}
                                </button>
                              </div>
                              {peoplePickerFor === rowKey(g) && (
                                <>
                                  <div className="fixed inset-0 z-40" onClick={() => setPeoplePickerFor('')} />
                                  <div className="absolute left-3 top-full mt-1 z-50 w-[186px] bg-white rounded-lg shadow-2xl border border-border-subtle p-2">
                                    <div className="px-2.5 pt-1 pb-1 text-[10.5px] font-semibold tracking-wider uppercase text-muted">สมาชิกโปรเจกต์</div>
                                    {summaryMembers.map((m) => {
                                      const on = g.teamMemberIds.includes(m.id)
                                      return (
                                        <button
                                          key={m.id}
                                          type="button"
                                          aria-pressed={on}
                                          onClick={() => void toggleMember(g, m.id)}
                                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-hover text-left text-[13px] text-body"
                                        >
                                          <Avatar name={m.name} avatarUrl={m.avatarUrl} className="w-5 h-5 text-[9px] shrink-0" colorClass={avatarColor(m.name)} />
                                          <span className="flex-1 min-w-0 truncate">{m.name}</span>
                                          {on && <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />}
                                        </button>
                                      )
                                    })}
                                    {summaryMembers.length === 0 && <div className="px-2.5 py-4 text-center text-xs text-muted">ยังไม่มีสมาชิกในโปรเจกต์</div>}
                                  </div>
                                </>
                              )}
                            </td>

                            {/* Role — กรอกทับเองได้เสมอ ไม่แตะ = auto-fill จาก role ที่งานจริงในกลุ่มนี้ใช้ตรงกันหมด */}
                            <td className={bodyCell}>
                              <select
                                value={g.costRoleId ?? ''}
                                onChange={(e) => void saveGroupField(g.taskTypeId, g.subTaskTypeId, { costRoleId: e.target.value || null })}
                                className={`${fieldCell} w-[150px] cursor-pointer`}
                              >
                                <option value="">— ยังไม่ระบุ —</option>
                                {parameterRoles.map((pr) => (
                                  <option key={pr.id} value={pr.id}>{pr.name}</option>
                                ))}
                              </select>
                            </td>

                            <td className={calcCell}>{g.costPerDaySatang != null ? money(g.costPerDaySatang) : '—'}</td>
                            <td className={calcCell}>{g.costPerHourSatang != null ? money(g.costPerHourSatang) : '—'}</td>

                            {/* Estimate W/H — กรอกทับเองได้เสมอ ไม่แตะ = auto-fill จากงานจริงในกลุ่ม */}
                            <td className={`${bodyCell} text-right`}>
                              <input
                                type="number"
                                min={0}
                                step={0.5}
                                defaultValue={g.estimateMinutes / 60}
                                onBlur={(e) => void saveGroupField(g.taskTypeId, g.subTaskTypeId, { estimateMinutes: e.target.value.trim() ? Math.round(Number(e.target.value) * 60) : 0 })}
                                className={numCell}
                              />
                            </td>

                            {/* Buffer % — กรอกทับเองได้เสมอ */}
                            <td className={`${bodyCell} text-right`}>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                defaultValue={g.bufferPercent ?? ''}
                                onBlur={(e) => void saveGroupField(g.taskTypeId, g.subTaskTypeId, { bufferPercent: e.target.value.trim() ? Math.round(Number(e.target.value)) : null })}
                                className={numCell}
                              />
                            </td>

                            <td className={calcCell}>{hours(g.bufferMinutes)}</td>
                            <td className={calcCell}>{hours(g.totalMinutes)}</td>
                            <td className={calcCell}>{g.netCostSatang != null ? money(g.netCostSatang) : '—'}</td>

                            {/* Work Hour/Day — กรอกทับเองได้เสมอ */}
                            <td className={`${bodyCell} text-right`}>
                              <input
                                type="number"
                                min={0}
                                step={0.5}
                                defaultValue={(g.workMinutesPerDay ?? 0) / 60}
                                onBlur={(e) => void saveGroupField(g.taskTypeId, g.subTaskTypeId, { workMinutesPerDay: e.target.value.trim() ? Math.round(Number(e.target.value) * 60) : null })}
                                className={numCell}
                              />
                            </td>

                            <td className={calcCell}>{g.estimateDays.toFixed(1)}</td>

                            {/* โซนเงิน */}
                            <td className={`${calcCell} bg-brand-50 group-hover/row:bg-brand-50 shadow-[inset_2px_0_0_var(--color-brand-200)]`}>{money(g.marginSatang)}</td>
                            <td className={`${calcCell} bg-brand-50 group-hover/row:bg-brand-50 text-strong font-semibold`}>{money(g.estimateCostSatang)}</td>
                            {/* Quotation Cost — กรอกทับเองได้เสมอ ไม่ว่า Task Group นี้จะ auto หรือ manual (ราคาที่จะเสนอลูกค้าเป็นสิทธิ์ PM กำหนดเองอยู่แล้ว) */}
                            <td className={`${bodyCell} text-right bg-brand-50 group-hover/row:bg-brand-50`}>
                              <input
                                type="number"
                                min={0}
                                defaultValue={g.quotationSatang != null ? g.quotationSatang / 100 : ''}
                                placeholder={g.estimateCostSatang != null ? String(Math.round(g.estimateCostSatang / 100)) : '—'}
                                onBlur={(e) => void saveGroupField(g.taskTypeId, g.subTaskTypeId, { quotationSatang: e.target.value.trim() ? Math.round(Number(e.target.value) * 100) : null })}
                                className={`${numCell} w-[104px]`}
                              />
                            </td>

                            <td className={`${bodyCell} text-right`}>
                              <button
                                type="button"
                                aria-label={`เอา ${g.name} ออก`}
                                onClick={() => void deleteGroupRow(g.taskTypeId, g.subTaskTypeId, g.name)}
                                className="text-[11.5px] text-muted rounded px-1.5 py-1 hover:bg-danger-50 hover:text-danger-700 group-hover/row:text-danger-600"
                              >
                                เอาออก
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="font-semibold text-strong">
                        <td className={`${footCell} sticky left-0 z-20 bg-white shadow-[1px_0_0_var(--color-border-subtle)] whitespace-nowrap`} colSpan={9}>
                          รวมทั้งหมด
                          <span className="block text-[11px] font-normal text-dim mt-px">รวมค่าใช้จ่ายนอกระบบแล้ว</span>
                        </td>
                        <td className={`${footCell} text-right tabular-nums`}>{formatSatang(groupsData.totals.netCostSatang)}</td>
                        <td className={footCell} />
                        <td className={`${footCell} text-right tabular-nums`}>
                          {groupsData.groups.reduce((s, g) => s + g.estimateDays, 0).toFixed(1)}
                        </td>
                        <td className={`${footCell} text-right tabular-nums bg-brand-50 shadow-[inset_2px_0_0_var(--color-brand-200)]`}>{formatSatang(groupsData.totals.marginSatang)}</td>
                        <td className={`${footCell} text-right tabular-nums bg-brand-50`}>{formatSatang(groupsData.totals.estimateCostSatang)}</td>
                        <td className={`${footCell} text-right tabular-nums bg-brand-50`}>{formatSatang(groupsData.totals.quotationSatang)}</td>
                        <td className={footCell} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-xs">
            <div className="p-4 sm:p-5 pb-2">
              <div className="text-sm font-semibold text-strong">ค่าใช้จ่ายนอกระบบ</div>
              <p className="text-xs text-dim mt-0.5">แยกหัวข้อหลัก AEX / OPEX — กรอก Net Cost แล้วระบบคำนวณ Margin/Estimate Cost ให้อัตโนมัติ</p>
            </div>
            {(['aex', 'opex'] as const).map((cat) => {
              const items = groupsData.extraCosts.filter((x) => x.category === cat)
              return (
                <div key={cat} className="border-t border-divider">
                  <div className="flex items-center justify-between px-4 sm:px-5 py-2.5">
                    <div className="text-[10.5px] font-semibold tracking-[0.09em] uppercase text-muted">{EXTRA_COST_LABEL[cat]}</div>
                    <button onClick={() => void addExtraCost(cat)} className="text-sm text-brand-700 hover:text-brand-800">+ เพิ่มรายการ</button>
                  </div>
                  {items.length === 0 ? (
                    <div className="text-sm text-muted pb-4 text-center">ยังไม่มีรายการ</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[640px]">
                        <thead>
                          <tr>
                            <th className={`${colCell} text-left`}>รายการ</th>
                            <th className={`${colCell} text-right`}>Net Cost (Hour)</th>
                            <th className={`${colCell} text-right bg-brand-50 text-brand-700 shadow-[inset_2px_0_0_var(--color-brand-200)]`}>Margin</th>
                            <th className={`${colCell} text-right bg-brand-50 text-brand-700`}>Estimate Cost</th>
                            <th className={`${colCell} text-right bg-brand-50 text-brand-700`}>Quotation Cost</th>
                            <th className={colCell} />
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((x) => (
                            <tr key={x.id} className="group/row hover:bg-hover">
                              <td className={bodyCell}>
                                <input
                                  type="text"
                                  defaultValue={x.name}
                                  onBlur={(e) => void saveExtraCostName(x.id, e.target.value)}
                                  className={`${fieldCell} w-full`}
                                />
                              </td>
                              <td className={`${bodyCell} text-right`}>
                                <input
                                  type="number"
                                  min={0}
                                  defaultValue={x.netCostSatang != null ? x.netCostSatang / 100 : ''}
                                  placeholder="—"
                                  onBlur={(e) => void saveExtraCostNetCost(x.id, e.target.value)}
                                  className={numCell}
                                />
                              </td>
                              <td className={`${calcCell} bg-brand-50 shadow-[inset_2px_0_0_var(--color-brand-200)]`}>{x.marginSatang != null ? money(x.marginSatang) : '—'}</td>
                              <td className={`${calcCell} bg-brand-50 text-strong font-semibold`}>{x.estimateCostSatang != null ? money(x.estimateCostSatang) : '—'}</td>
                              <td className={`${bodyCell} text-right bg-brand-50`}>
                                <input
                                  type="number"
                                  min={0}
                                  defaultValue={x.quotationSatang != null ? x.quotationSatang / 100 : ''}
                                  placeholder={x.estimateCostSatang != null ? String(Math.round(x.estimateCostSatang / 100)) : '—'}
                                  onBlur={(e) => void saveExtraCostQuotation(x.id, e.target.value)}
                                  className={`${numCell} w-[104px]`}
                                />
                              </td>
                              <td className={`${bodyCell} text-right`}>
                                <button
                                  type="button"
                                  aria-label={`เอา ${x.name} ออก`}
                                  onClick={() => void deleteExtraCost(x.id, x.name)}
                                  className="text-[11.5px] text-muted rounded px-1.5 py-1 hover:bg-danger-50 hover:text-danger-700 group-hover/row:text-danger-600"
                                >
                                  เอาออก
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
            <div className="border-t-2 border-border-subtle px-4 sm:px-5 py-3 flex justify-end">
              <div className="text-sm font-semibold text-strong tabular-nums">รวมค่าใช้จ่ายนอกระบบ: {formatSatang(groupsData.totals.extraCostsSatang)}</div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5 grid sm:grid-cols-3 gap-4">
            <label className="text-xs text-muted">
              Net Working Days
              <input
                type="number"
                min={1}
                defaultValue={estimate.project.estimateNetWorkingDays ?? estimate.suggestedNetWorkingDays ?? ''}
                placeholder={estimate.suggestedNetWorkingDays != null ? String(estimate.suggestedNetWorkingDays) : ''}
                onBlur={(e) => void saveNetWorkingDays(e.target.value)}
                className={`${fieldCell} w-full mt-1`}
              />
              {estimate.suggestedNetWorkingDays != null && (
                <span className="text-[11px] text-muted">แนะนำ {estimate.suggestedNetWorkingDays} วัน (จาก Task ที่ใช้เวลานานสุด)</span>
              )}
            </label>
            <div className="text-xs text-muted">
              Net Quotation Cost
              <div className="text-lg font-semibold text-ink tabular-nums mt-1">{money(estimate.project.quotedSatang)}</div>
              <Link to={`/projects/${projectId}/edit`} className="text-[11px] text-brand-600 hover:underline">แก้ที่หน้าแก้ไขโปรเจกต์</Link>
            </div>
            <div className="text-xs text-muted">
              Estimate Project Cost/Day
              <div className="text-lg font-semibold text-ink tabular-nums mt-1">{money(estimate.estimateProjectCostPerDaySatang)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Task — สไตล์เดียวกับ Task Group (band header + money-zone) เพื่อความสม่ำเสมอทั้ง 4 แท็บ */}
      {view === 'task' && (
        <div className="bg-white rounded-lg shadow-xs">
          <div className="p-4 sm:p-5 pb-3">
            <div className="text-sm font-semibold text-strong">Task ({estimate.rows.length})</div>
          </div>
          {estimate.rows.length === 0 ? (
            <div className="text-sm text-muted py-8 text-center border-t border-divider">ยังไม่มีงานในโปรเจกต์นี้</div>
          ) : (
            <div className="overflow-x-auto border-t border-divider">
              <table className="w-full text-sm min-w-[1360px]">
                <thead>
                  <tr>
                    <th colSpan={3} className={bandCell}>งาน &amp; ผู้รับผิดชอบ</th>
                    <th colSpan={9} className={bandCell}>ต้นทุน &amp; เวลา</th>
                    <th colSpan={3} className={`${bandCell} bg-brand-50 text-brand-700 shadow-[inset_2px_0_0_var(--color-brand-200)]`}>ราคา</th>
                  </tr>
                  <tr>
                    <th className={`${colCell} text-left`}>Task</th>
                    <th className={`${colCell} text-left`}>Team Member</th>
                    <th className={`${colCell} text-left`}>Role</th>
                    <th className={`${colCell} text-right`}>Cost/Day</th>
                    <th className={`${colCell} text-right`}>Cost/Hour</th>
                    <th className={`${colCell} text-right`}>Estimate W/H</th>
                    <th className={`${colCell} text-right`}>Buffer %</th>
                    <th className={`${colCell} text-right`}>Buffer W/H</th>
                    <th className={`${colCell} text-right`}>Total W/H</th>
                    <th className={`${colCell} text-right`}>Net Cost (Hour)</th>
                    <th className={`${colCell} text-right`}>Work Hour/Day</th>
                    <th className={`${colCell} text-right`}>Estimate Day</th>
                    <th className={`${colCell} text-right bg-brand-50 text-brand-700 shadow-[inset_2px_0_0_var(--color-brand-200)]`}>Margin</th>
                    <th className={`${colCell} text-right bg-brand-50 text-brand-700`}>Estimate Cost</th>
                    <th className={`${colCell} text-right bg-brand-50 text-brand-700`}>Quotation Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {estimate.rows.map((r) => (
                    <tr key={r.taskId} className="hover:bg-hover">
                      <td className={`${bodyCell} whitespace-nowrap`}>
                        {r.taskCode && <span className="text-muted font-mono text-xs mr-1">{r.taskCode}</span>}
                        <Link to={`/tasks/${r.taskId}`} className="text-brand-700 hover:underline">{r.title}</Link>
                      </td>
                      <td className={`${bodyCell} whitespace-nowrap`}>{r.assigneeName ?? '—'}</td>
                      <td className={bodyCell}>
                        <select
                          value={r.costRoleId ?? ''}
                          onChange={(e) => void saveRole(r.taskId, e.target.value)}
                          className={`${fieldCell} w-[150px] cursor-pointer`}
                        >
                          <option value="">— ยังไม่ระบุ —</option>
                          {parameterRoles.map((pr) => (
                            <option key={pr.id} value={pr.id}>{pr.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className={calcCell}>
                        {r.costPerDaySatang != null ? money(r.costPerDaySatang) : <span className="text-warning-600 text-xs">ยังไม่ตั้งต้นทุน</span>}
                      </td>
                      <td className={calcCell}>{money(r.costPerHourSatang)}</td>
                      <td className={calcCell}>{hours(r.estimateMinutes)}</td>
                      <td className={`${bodyCell} text-right`}>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          defaultValue={r.bufferPercent}
                          onBlur={(e) => void saveBufferPercent(r.taskId, e.target.value)}
                          className={numCell}
                        />
                      </td>
                      <td className={calcCell}>{hours(r.bufferMinutes)}</td>
                      <td className={calcCell}>{hours(r.totalMinutes)}</td>
                      <td className={calcCell}>{r.netCostSatang != null ? money(r.netCostSatang) : '—'}</td>
                      <td className={`${bodyCell} text-right`}>
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          defaultValue={r.workMinutesPerDay / 60}
                          onBlur={(e) => void saveWorkHourPerDay(r.taskId, e.target.value)}
                          className={numCell}
                        />
                      </td>
                      <td className={calcCell}>{r.estimateDays.toFixed(1)}</td>
                      <td className={`${calcCell} bg-brand-50 shadow-[inset_2px_0_0_var(--color-brand-200)]`}>{money(r.marginSatang)}</td>
                      <td className={`${calcCell} bg-brand-50 text-strong font-semibold`}>{money(r.estimateCostSatang)}</td>
                      <td className={`${bodyCell} text-right bg-brand-50`}>
                        <input
                          type="number"
                          min={0}
                          defaultValue={r.quotationSatang != null ? r.quotationSatang / 100 : ''}
                          placeholder="—"
                          onBlur={(e) => void saveQuotation(r.taskId, e.target.value)}
                          className={`${numCell} w-[104px]`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold text-strong">
                    <td className={footCell} colSpan={9}>รวม</td>
                    <td className={`${footCell} text-right tabular-nums`}>{formatSatang(estimate.totals.netCostSatang)}</td>
                    <td className={footCell} />
                    <td className={footCell} />
                    <td className={`${footCell} text-right tabular-nums bg-brand-50`}>{formatSatang(estimate.totals.marginSatang)}</td>
                    <td className={`${footCell} text-right tabular-nums bg-brand-50`}>{formatSatang(estimate.totals.estimateCostSatang)}</td>
                    <td className={`${footCell} bg-brand-50`} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {estimate.rows.some((r) => r.netCostSatang == null) && (
            <p className="text-xs text-warning-600 px-4 sm:px-5 pb-4 pt-2">
              แถวที่ "ยังไม่ตั้งต้นทุน" ไม่ถูกรวมในยอดด้านบน — เลือก Role ให้ครบ หรือไปตั้งต้นทุน/วันของ Role นั้นที่เมนู{' '}
              <Link to="/admin/cost" className="underline">กำหนดต้นทุน</Link>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
