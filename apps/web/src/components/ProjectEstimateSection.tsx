/**
 * Pronista §Project Estimate v2 — แท็บ "Project Estimate" (เห็นเฉพาะ owner — เผยต้นทุน/margin ของทีมทั้งหมด)
 * Role ต่อ task มาจาก PM เลือกเองจาก company_config.parameterRoles (ดู tasks.costRoleId) — ไม่ผูกกับตำแหน่งสิทธิ์ (positions) ของสมาชิกโปรเจกต์
 * Cost/Hour คำนวณอัตโนมัติจาก Cost/Day ÷ 8 (costPerHourFromDay) · Work Hour/Day กรอกเองต่อ task (tasks.costWorkMinutesPerDay)
 * สรุปงานรายบุคคล (ภาพรวมทุกคน → คลิกดูรายละเอียดต่อคน) + 4 แท็บย่อย: Summary / Phase / Task Group / Task (ดึงงานทั้งหมดในโปรเจกต์อัตโนมัติ ไม่มี checkbox เลือกอีกต่อไป)
 */
import { formatSatang, minutesToHoursLabel, resolveParameterRoles, type ParameterRole } from '@seedoffice/core'
import { Check, Table2, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { useDialog } from './Dialog'

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
  name: string
  amountSatang: number
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

type EstimateView = 'summary' | 'phase' | 'group' | 'task'
const VIEWS: [EstimateView, string][] = [
  ['summary', 'Summary'],
  ['phase', 'Phase'],
  ['group', 'Task Group'],
  ['task', 'Task'],
]

/* ตาราง Task Group — คลาสร่วม แยก "ช่องกรอกเอง" ออกจาก "ตัวเลขที่ระบบคำนวณให้" ด้วยสายตา */
const bandCell = 'bg-hover text-left text-[10px] font-semibold tracking-[0.09em] uppercase text-muted px-3 pt-2 pb-0.5'
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
  members: { id: string; name: string; role?: 'owner' | 'member' | 'vendor' | 'guest' }[]
}) {
  const { confirmDialog } = useDialog()
  // Pronista §Project Estimate — สรุปงานรายบุคคล: ดึงสมาชิกทุกคนในโปรเจกต์ ยกเว้นลูกค้า (role='guest') — staff/outsource ดึงมาหมด
  // Admin(owner) ไม่มีทางอยู่ใน project_members ได้เลย (backend กันไว้ เพราะ owner เข้าถึงทุกโปรเจกต์เต็มรูปแบบเสมอ) แต่ยังถูก assign งานได้ปกติ — ดึงจาก /api/users มาต่อท้ายแทน
  const { data: allUsersData } = useLoad<{ id: string; name: string; role: 'owner' | 'member' | 'vendor' | 'guest' }[]>(() => api.get('/api/users'))
  const adminUsers = (allUsersData ?? []).filter((u) => u.role === 'owner')
  const summaryMembers = [...members.filter((m) => m.role !== 'guest'), ...adminUsers.filter((a) => !members.some((m) => m.id === a.id))]

  const { data: estimate, reload: reloadEstimate } = useLoad<EstimateResponse>(() => api.get(`/api/projects/${projectId}/estimate`), [projectId])
  const { data: groupsData, reload: reloadGroups } = useLoad<GroupsResponse>(() => api.get(`/api/projects/${projectId}/estimate/groups`), [projectId])
  const { data: phasesData, reload: reloadPhases } = useLoad<{ phases: PhaseRow[] }>(() => api.get(`/api/projects/${projectId}/estimate/phases`), [projectId])
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
    return { id: m.id, name: m.name, totalMinutes: tasksOfMember.reduce((sum, r) => sum + r.estimateMinutes, 0), count: tasksOfMember.length }
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
  const memberName = (id: string) => summaryMembers.find((m) => m.id === id)?.name ?? id
  const rowKey = (g: GroupRow) => `${g.taskTypeId}::${g.subTaskTypeId}`

  // --- ค่าใช้จ่ายนอกระบบ ---
  const addExtraCost = async () => {
    await api.post(`/api/projects/${projectId}/estimate/extra-costs`, { name: 'รายการใหม่', amountSatang: 0 })
    await reloadGroups()
  }
  const saveExtraCostName = async (id: string, name: string) => {
    await api.patch(`/api/projects/${projectId}/estimate/extra-costs/${id}`, { name })
    await reloadGroups()
  }
  const saveExtraCostAmount = async (id: string, v: string) => {
    await api.patch(`/api/projects/${projectId}/estimate/extra-costs/${id}`, { amountSatang: v.trim() ? Math.round(Number(v) * 100) : 0 })
    await reloadGroups()
  }
  const deleteExtraCost = async (id: string) => {
    await api.delete(`/api/projects/${projectId}/estimate/extra-costs/${id}`)
    await reloadGroups()
  }

  const inputCell = 'w-20 text-right text-sm bg-white border border-border rounded-lg px-2 py-1 tabular-nums focus:outline-hidden focus:border-brand-400'

  if (!estimate || !groupsData || !phasesData) return <div className="text-sm text-muted py-6 text-center">กำลังโหลด…</div>

  return (
    <div className="space-y-4">
      {/* ส่วนสรุปงานรายบุคคล */}
      <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
        <div className="text-sm font-semibold text-strong mb-3">สรุปงานรายบุคคล</div>
        <select
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          className="text-sm bg-white border border-border rounded-lg px-3 py-2 mb-3"
        >
          <option value="">— ภาพรวมทุกคน —</option>
          {summaryMembers.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        {!memberId ? (
          <table className="w-full text-sm">
            <thead className="text-dim text-xs">
              <tr>
                <th className="text-left font-medium py-1.5">สมาชิก</th>
                <th className="text-right font-medium py-1.5">จำนวนงาน</th>
                <th className="text-right font-medium py-1.5">ประมาณการรวม (ชม.)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {memberOverview.map((m) => (
                <tr key={m.id}>
                  <td className="py-1.5">
                    <button onClick={() => setMemberId(m.id)} className="text-brand-700 hover:underline">{m.name}</button>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{m.count}</td>
                  <td className="py-1.5 text-right tabular-nums">{m.totalMinutes ? hours(m.totalMinutes) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : memberTasks.length === 0 ? (
          <div className="text-sm text-muted py-4 text-center">ยังไม่มีงานที่ Assign ให้ {selectedMember?.name ?? 'คนนี้'} ในโปรเจกต์นี้</div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="text-dim text-xs">
                <tr>
                  <th className="text-left font-medium py-1.5">งาน</th>
                  <th className="text-right font-medium py-1.5">ประมาณการ (ชม.)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {memberTasks.map((r) => (
                  <tr key={r.taskId}>
                    <td className="py-1.5">
                      {r.taskCode && <span className="text-muted font-mono text-xs mr-1">{r.taskCode}</span>}
                      <Link to={`/tasks/${r.taskId}`} className="text-brand-700 hover:underline">{r.title}</Link>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{r.estimateMinutes ? hours(r.estimateMinutes) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-right text-sm font-semibold mt-2 pt-2 border-t border-border-subtle">
              รวม {hours(memberTotalMinutes)} ชม.
            </div>
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

      {/* Tab: Summary */}
      {view === 'summary' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
            <div className="text-sm font-semibold text-strong mb-3">สรุปวันประเมินตามหัวข้อหลัก (Phase)</div>
            <table className="w-full text-sm">
              <thead className="text-dim text-xs">
                <tr>
                  <th className="text-left font-medium py-1.5">Phase</th>
                  <th className="text-right font-medium py-1.5">Total Estimate Day</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {phasesData.phases.map((p) => (
                  <tr key={p.taskTypeId}>
                    <td className="py-1.5">{p.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.totalEstimateDays.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-subtle font-semibold">
                  <td className="py-1.5">รวม</td>
                  <td className="py-1.5 text-right tabular-nums">{phasesData.phases.reduce((s, p) => s + p.totalEstimateDays, 0).toFixed(1)}</td>
                </tr>
              </tfoot>
            </table>
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
                className="w-full text-sm bg-white border border-border rounded-lg px-3 py-2 mt-1 tabular-nums"
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

      {/* Tab: Phase */}
      {view === 'phase' && (
        <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
          <div className="text-sm font-semibold text-strong mb-3">Phase — รวม Estimate Day จาก Task Group ตามหัวข้อหลัก</div>
          <table className="w-full text-sm">
            <thead className="text-dim text-xs">
              <tr>
                <th className="text-left font-medium py-1.5">Phase</th>
                <th className="text-right font-medium py-1.5">Total Estimate Day</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {phasesData.phases.map((p) => (
                <tr key={p.taskTypeId}>
                  <td className="py-1.5">{p.name}</td>
                  <td className="py-1.5 text-right tabular-nums">{p.totalEstimateDays.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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

                            {/* Team Member — chip เลือกทีละคน */}
                            <td className={`${bodyCell} relative`}>
                              <div className="flex items-center gap-1.5 flex-wrap min-w-[172px]">
                                {g.teamMemberIds.map((uid) => (
                                  <span
                                    key={uid}
                                    className={
                                      auto
                                        ? 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-divider text-soft border border-border-subtle whitespace-nowrap'
                                        : 'inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-1 py-0.5 text-xs font-medium bg-brand-50 text-brand-800 border border-brand-100 whitespace-nowrap'
                                    }
                                  >
                                    {memberName(uid)}
                                    {!auto && (
                                      <button
                                        type="button"
                                        aria-label={`เอา ${memberName(uid)} ออก`}
                                        onClick={() => void toggleMember(g, uid)}
                                        className="w-[17px] h-[17px] grid place-items-center rounded-full text-brand-600 hover:bg-brand-200 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-brand-500"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    )}
                                  </span>
                                ))}
                                {auto ? (
                                  g.teamMemberIds.length === 0 && <span className="text-muted tabular-nums">{g.teamMember ?? '—'}</span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setPeoplePickerFor((v) => (v === rowKey(g) ? '' : rowKey(g)))}
                                    className="text-xs font-medium text-brand-700 bg-white border border-dashed border-border rounded-full px-2.5 py-0.5 whitespace-nowrap hover:border-brand-400 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500 focus-visible:outline-offset-2"
                                  >
                                    {g.teamMemberIds.length ? '+ เพิ่ม' : '+ เลือกคน'}
                                  </button>
                                )}
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

                            {/* Role */}
                            <td className={bodyCell}>
                              {auto ? (
                                <span className="text-dim whitespace-nowrap">{g.role ?? '—'}</span>
                              ) : (
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
                              )}
                            </td>

                            <td className={calcCell}>{g.costPerDaySatang != null ? money(g.costPerDaySatang) : '—'}</td>
                            <td className={calcCell}>{g.costPerHourSatang != null ? money(g.costPerHourSatang) : '—'}</td>

                            {/* Estimate W/H */}
                            <td className={auto ? calcCell : `${bodyCell} text-right`}>
                              {auto ? (
                                hours(g.estimateMinutes)
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  step={0.5}
                                  defaultValue={g.estimateMinutes / 60}
                                  onBlur={(e) => void saveGroupField(g.taskTypeId, g.subTaskTypeId, { estimateMinutes: e.target.value.trim() ? Math.round(Number(e.target.value) * 60) : 0 })}
                                  className={numCell}
                                />
                              )}
                            </td>

                            {/* Buffer % */}
                            <td className={auto ? calcCell : `${bodyCell} text-right`}>
                              {auto ? (
                                (g.bufferPercent ?? '—')
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  defaultValue={g.bufferPercent ?? ''}
                                  onBlur={(e) => void saveGroupField(g.taskTypeId, g.subTaskTypeId, { bufferPercent: e.target.value.trim() ? Math.round(Number(e.target.value)) : null })}
                                  className={numCell}
                                />
                              )}
                            </td>

                            <td className={calcCell}>{hours(g.bufferMinutes)}</td>
                            <td className={calcCell}>{hours(g.totalMinutes)}</td>
                            <td className={calcCell}>{g.netCostSatang != null ? money(g.netCostSatang) : '—'}</td>

                            {/* Work Hour/Day */}
                            <td className={auto ? calcCell : `${bodyCell} text-right`}>
                              {auto ? (
                                g.workMinutesPerDay != null ? hours(g.workMinutesPerDay) : '—'
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  step={0.5}
                                  defaultValue={(g.workMinutesPerDay ?? 0) / 60}
                                  onBlur={(e) => void saveGroupField(g.taskTypeId, g.subTaskTypeId, { workMinutesPerDay: e.target.value.trim() ? Math.round(Number(e.target.value) * 60) : null })}
                                  className={numCell}
                                />
                              )}
                            </td>

                            <td className={calcCell}>{g.estimateDays.toFixed(1)}</td>

                            {/* โซนเงิน */}
                            <td className={`${calcCell} bg-brand-50 group-hover/row:bg-brand-50 shadow-[inset_2px_0_0_var(--color-brand-200)]`}>{money(g.marginSatang)}</td>
                            <td className={`${calcCell} bg-brand-50 group-hover/row:bg-brand-50 text-strong font-semibold`}>{money(g.estimateCostSatang)}</td>
                            <td className={`${bodyCell} text-right bg-brand-50 group-hover/row:bg-brand-50`}>
                              {auto ? (
                                <span className="tabular-nums text-muted">{g.quotationSatang != null ? money(g.quotationSatang) : '—'}</span>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  defaultValue={g.quotationSatang != null ? g.quotationSatang / 100 : ''}
                                  placeholder={g.estimateCostSatang != null ? String(Math.round(g.estimateCostSatang / 100)) : '—'}
                                  onBlur={(e) => void saveGroupField(g.taskTypeId, g.subTaskTypeId, { quotationSatang: e.target.value.trim() ? Math.round(Number(e.target.value) * 100) : null })}
                                  className={`${numCell} w-[104px]`}
                                />
                              )}
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

          <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-strong">ค่าใช้จ่ายนอกระบบ (Cloud, ค่าเดินทาง ฯลฯ)</div>
              <button onClick={() => void addExtraCost()} className="text-sm text-brand-700 hover:text-brand-800">+ เพิ่มรายการ</button>
            </div>
            {groupsData.extraCosts.length === 0 ? (
              <div className="text-sm text-muted py-3 text-center">ยังไม่มีรายการ</div>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-divider">
                  {groupsData.extraCosts.map((x) => (
                    <tr key={x.id}>
                      <td className="py-1.5 pr-2">
                        <input
                          type="text"
                          defaultValue={x.name}
                          onBlur={(e) => void saveExtraCostName(x.id, e.target.value)}
                          className="w-full text-sm bg-white border border-border rounded-lg px-2 py-1"
                        />
                      </td>
                      <td className="py-1.5 pr-2 w-32">
                        <input
                          type="number"
                          min={0}
                          defaultValue={x.amountSatang / 100}
                          onBlur={(e) => void saveExtraCostAmount(x.id, e.target.value)}
                          className="w-full text-sm text-right bg-white border border-border rounded-lg px-2 py-1 tabular-nums"
                        />
                      </td>
                      <td className="py-1.5 w-8">
                        <button onClick={() => void deleteExtraCost(x.id)} className="text-danger-600 hover:text-danger-700 text-xs">ลบ</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border-subtle font-semibold">
                    <td className="py-1.5">รวม</td>
                    <td className="py-1.5 text-right tabular-nums">{formatSatang(groupsData.totals.extraCostsSatang)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Tab: Task */}
      {view === 'task' && (
        <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5 overflow-x-auto">
          <div className="text-sm font-semibold text-strong mb-3">ตาราง Task ({estimate.rows.length})</div>
          {estimate.rows.length === 0 ? (
            <div className="text-sm text-muted py-6 text-center">ยังไม่มีงานในโปรเจกต์นี้</div>
          ) : (
            <table className="w-full text-sm min-w-[1400px]">
              <thead className="bg-hover text-dim text-xs">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Task</th>
                  <th className="text-left font-medium px-3 py-2">Team Member</th>
                  <th className="text-left font-medium px-3 py-2">Role</th>
                  <th className="text-right font-medium px-3 py-2">Cost/Day</th>
                  <th className="text-right font-medium px-3 py-2">Cost/Hour</th>
                  <th className="text-right font-medium px-3 py-2">Estimate W/H</th>
                  <th className="text-right font-medium px-3 py-2">Buffer %</th>
                  <th className="text-right font-medium px-3 py-2">Buffer W/H</th>
                  <th className="text-right font-medium px-3 py-2">Total W/H</th>
                  <th className="text-right font-medium px-3 py-2">Net Cost (Hour)</th>
                  <th className="text-right font-medium px-3 py-2">Work Hour/Day</th>
                  <th className="text-right font-medium px-3 py-2">Estimate Day</th>
                  <th className="text-right font-medium px-3 py-2">Margin</th>
                  <th className="text-right font-medium px-3 py-2">Estimate Cost</th>
                  <th className="text-right font-medium px-3 py-2">Quotation Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {estimate.rows.map((r) => (
                  <tr key={r.taskId}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.taskCode && <span className="text-muted font-mono text-xs mr-1">{r.taskCode}</span>}
                      <Link to={`/tasks/${r.taskId}`} className="text-brand-700 hover:underline">{r.title}</Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.assigneeName ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <select
                        value={r.costRoleId ?? ''}
                        onChange={(e) => void saveRole(r.taskId, e.target.value)}
                        className="w-40 text-sm bg-white border border-border rounded-lg px-2 py-1 focus:outline-hidden focus:border-brand-400"
                      >
                        <option value="">— ยังไม่ระบุ —</option>
                        {parameterRoles.map((pr) => (
                          <option key={pr.id} value={pr.id}>{pr.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">
                      {r.costPerDaySatang != null ? money(r.costPerDaySatang) : <span className="text-warning-600 text-xs">ยังไม่ตั้งต้นทุน</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{money(r.costPerHourSatang)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{hours(r.estimateMinutes)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        defaultValue={r.bufferPercent}
                        onBlur={(e) => void saveBufferPercent(r.taskId, e.target.value)}
                        className={inputCell}
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{hours(r.bufferMinutes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{hours(r.totalMinutes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{r.netCostSatang != null ? money(r.netCostSatang) : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        defaultValue={r.workMinutesPerDay / 60}
                        onBlur={(e) => void saveWorkHourPerDay(r.taskId, e.target.value)}
                        className={inputCell}
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{r.estimateDays.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{money(r.marginSatang)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{money(r.estimateCostSatang)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        defaultValue={r.quotationSatang != null ? r.quotationSatang / 100 : ''}
                        placeholder="—"
                        onBlur={(e) => void saveQuotation(r.taskId, e.target.value)}
                        className={inputCell}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-subtle font-semibold">
                  <td className="px-3 py-2" colSpan={9}>รวม</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatSatang(estimate.totals.netCostSatang)}</td>
                  <td />
                  <td />
                  <td className="px-3 py-2 text-right tabular-nums">{formatSatang(estimate.totals.marginSatang)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatSatang(estimate.totals.estimateCostSatang)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
          {estimate.rows.some((r) => r.netCostSatang == null) && (
            <p className="text-xs text-warning-600 mt-2">
              แถวที่ "ยังไม่ตั้งต้นทุน" ไม่ถูกรวมในยอดด้านบน — เลือก Role ให้ครบ หรือไปตั้งต้นทุน/วันของ Role นั้นที่เมนู{' '}
              <Link to="/admin/cost" className="underline">กำหนดต้นทุน</Link>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
