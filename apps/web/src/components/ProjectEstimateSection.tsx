/**
 * Pronista §Project Estimate v2 — แท็บ "Project Estimate" (เห็นเฉพาะ owner — เผยต้นทุน/margin ของทีมทั้งหมด)
 * Role ต่อ task มาจาก PM เลือกเองจาก company_config.parameterRoles (ดู tasks.costRoleId) — ไม่ผูกกับตำแหน่งสิทธิ์ (positions) ของสมาชิกโปรเจกต์
 * Cost/Hour คำนวณอัตโนมัติจาก Cost/Day ÷ 8 (costPerHourFromDay) · Work Hour/Day กรอกเองต่อ task (tasks.costWorkMinutesPerDay)
 * สรุปงานรายบุคคล (ภาพรวมทุกคน → คลิกดูรายละเอียดต่อคน) + 4 แท็บย่อย: Summary / Phase / Task Group / Task (ดึงงานทั้งหมดในโปรเจกต์อัตโนมัติ ไม่มี checkbox เลือกอีกต่อไป)
 */
import { formatSatang, minutesToHoursLabel, resolveParameterRoles, resolveTaskTypes, type ParameterRole, type TaskType } from '@seedoffice/core'
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

interface GroupsResponse {
  groups: GroupRow[]
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
  const { data: taskTypeCfg } = useLoad<{ taskTypes: TaskType[] }>(() => api.get('/api/admin/task-types'))

  const parameterRoles = resolveParameterRoles(roleCfg?.parameterRoles)
  const taskTypeCatalog = resolveTaskTypes(taskTypeCfg?.taskTypes)

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
  const [addGroupKey, setAddGroupKey] = useState('')
  const existingGroupKeys = new Set(groupsData?.groups.map((g) => `${g.taskTypeId}::${g.subTaskTypeId}`) ?? [])
  const availableGroupOptions = taskTypeCatalog.flatMap((tt) =>
    tt.subTypes.filter((st) => !existingGroupKeys.has(`${tt.id}::${st.id}`)).map((st) => ({ taskTypeId: tt.id, taskTypeName: tt.name, subTaskTypeId: st.id, subTaskTypeName: st.name })),
  )
  const addGroupRow = async () => {
    const [taskTypeId, subTaskTypeId] = addGroupKey.split('::')
    if (!taskTypeId || !subTaskTypeId) return
    await saveGroupField(taskTypeId, subTaskTypeId, {})
    setAddGroupKey('')
  }
  const deleteGroupRow = async (taskTypeId: string, subTaskTypeId: string) => {
    const yes = await confirmDialog({ title: 'ลบแถวนี้ออกจาก Task Group?', message: 'กู้คืนเองไม่ได้ผ่านหน้านี้', confirmLabel: 'ลบ', danger: true })
    if (!yes) return
    await api.delete(`/api/projects/${projectId}/estimate/groups/override?taskTypeId=${taskTypeId}&subTaskTypeId=${subTaskTypeId}`)
    await reloadAll()
  }

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

      {/* Tab: Task Group */}
      {view === 'group' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5 overflow-x-auto">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="text-sm font-semibold text-strong">ตาราง Task Group</div>
              <div className="flex items-center gap-2">
                <select
                  value={addGroupKey}
                  onChange={(e) => setAddGroupKey(e.target.value)}
                  className="text-sm bg-white border border-border rounded-lg px-2 py-1.5"
                >
                  <option value="">— เลือก Task Group —</option>
                  {taskTypeCatalog.map((tt) => {
                    const opts = availableGroupOptions.filter((o) => o.taskTypeId === tt.id)
                    if (opts.length === 0) return null
                    return (
                      <optgroup key={tt.id} label={tt.name}>
                        {opts.map((o) => (
                          <option key={o.subTaskTypeId} value={`${o.taskTypeId}::${o.subTaskTypeId}`}>{o.subTaskTypeName}</option>
                        ))}
                      </optgroup>
                    )
                  })}
                </select>
                <button
                  onClick={() => void addGroupRow()}
                  disabled={!addGroupKey}
                  className="text-sm text-brand-700 hover:text-brand-800 disabled:text-muted disabled:cursor-not-allowed"
                >
                  + เพิ่มแถว
                </button>
              </div>
            </div>
            <table className="w-full text-sm min-w-[1600px]">
              <thead className="bg-hover text-dim text-xs">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Task Group</th>
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
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {groupsData.groups.map((g) => (
                  <tr key={g.subTaskTypeId}>
                    <td className="px-3 py-2 whitespace-nowrap">{g.name}</td>
                    {g.source === 'auto' ? (
                      <>
                        <td className="px-3 py-2 whitespace-nowrap text-dim">{g.teamMember ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-dim">{g.role ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">—</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">—</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{hours(g.estimateMinutes)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">—</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{hours(g.bufferMinutes)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{hours(g.totalMinutes)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{g.netCostSatang != null ? money(g.netCostSatang) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{g.workMinutesPerDay != null ? hours(g.workMinutesPerDay) : '—'}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2">
                          <select
                            multiple
                            size={Math.min(4, Math.max(2, summaryMembers.length))}
                            value={g.teamMemberIds}
                            onChange={(e) =>
                              void saveGroupField(g.taskTypeId, g.subTaskTypeId, {
                                teamMemberIds: Array.from(e.target.selectedOptions).map((o) => o.value),
                              })
                            }
                            className="w-36 text-sm bg-white border border-border rounded-lg px-2 py-1"
                          >
                            {summaryMembers.map((m) => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            defaultValue={g.costRoleId ?? ''}
                            onChange={(e) => void saveGroupField(g.taskTypeId, g.subTaskTypeId, { costRoleId: e.target.value || null })}
                            className="w-36 text-sm bg-white border border-border rounded-lg px-2 py-1"
                          >
                            <option value="">— ยังไม่ระบุ —</option>
                            {parameterRoles.map((pr) => (
                              <option key={pr.id} value={pr.id}>{pr.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{g.costPerDaySatang != null ? money(g.costPerDaySatang) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{g.costPerHourSatang != null ? money(g.costPerHourSatang) : '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            defaultValue={g.estimateMinutes / 60}
                            onBlur={(e) => void saveGroupField(g.taskTypeId, g.subTaskTypeId, { estimateMinutes: e.target.value.trim() ? Math.round(Number(e.target.value) * 60) : 0 })}
                            className={inputCell}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            defaultValue={g.bufferPercent ?? ''}
                            onBlur={(e) => void saveGroupField(g.taskTypeId, g.subTaskTypeId, { bufferPercent: e.target.value.trim() ? Math.round(Number(e.target.value)) : null })}
                            className={inputCell}
                          />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{hours(g.bufferMinutes)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{hours(g.totalMinutes)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted">{g.netCostSatang != null ? money(g.netCostSatang) : '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            defaultValue={(g.workMinutesPerDay ?? 0) / 60}
                            onBlur={(e) => void saveGroupField(g.taskTypeId, g.subTaskTypeId, { workMinutesPerDay: e.target.value.trim() ? Math.round(Number(e.target.value) * 60) : null })}
                            className={inputCell}
                          />
                        </td>
                      </>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{g.estimateDays.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{money(g.marginSatang)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{money(g.estimateCostSatang)}</td>
                    <td className="px-3 py-2 text-right">
                      {g.source === 'auto' ? (
                        <span className="tabular-nums text-muted">{g.quotationSatang != null ? money(g.quotationSatang) : '—'}</span>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          defaultValue={g.quotationSatang != null ? g.quotationSatang / 100 : ''}
                          placeholder="—"
                          onBlur={(e) => void saveGroupField(g.taskTypeId, g.subTaskTypeId, { quotationSatang: e.target.value.trim() ? Math.round(Number(e.target.value) * 100) : null })}
                          className={inputCell}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {g.source === 'manual' && (
                        <button onClick={() => void deleteGroupRow(g.taskTypeId, g.subTaskTypeId)} className="text-danger-600 hover:text-danger-700 text-xs">ลบ</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-subtle font-semibold">
                  <td className="px-3 py-2" colSpan={8}>รวม (รวมค่าใช้จ่ายนอกระบบแล้ว)</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatSatang(groupsData.totals.netCostSatang)}</td>
                  <td />
                  <td />
                  <td className="px-3 py-2 text-right tabular-nums">{formatSatang(groupsData.totals.marginSatang)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatSatang(groupsData.totals.estimateCostSatang)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatSatang(groupsData.totals.quotationSatang)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
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
