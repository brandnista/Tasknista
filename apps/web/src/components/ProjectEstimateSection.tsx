/**
 * Pronista §Project Estimate — แท็บ "Project Estimate" (เห็นเฉพาะ owner — เผยต้นทุน/margin ของทีมทั้งหมด)
 * Role ต่อ task มาจาก PM เลือกเองจาก company_config.parameterRoles (ดู tasks.costRoleId) — ไม่ผูกกับตำแหน่งสิทธิ์ (positions) ของสมาชิกโปรเจกต์
 * Cost/Hour คำนวณอัตโนมัติจาก Cost/Day ÷ 8 (costPerHourFromDay) · Work Hour/Day กรอกเองต่อ task (tasks.costWorkMinutesPerDay)
 * 3 ส่วน: (1) สรุปงานรายบุคคล (2) เลือกงานเข้า Estimate แบบ filter+checkbox (3) ตาราง Estimate ที่คำนวณจากงานที่เลือกไว้
 */
import { formatSatang, minutesToHoursLabel, resolveParameterRoles, resolveTaskTypes, type ParameterRole, type TaskType } from '@seedoffice/core'
import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'

interface EstimateTaskRow {
  id: string
  code: string | null
  title: string
  kind: string
  assigneeId: string | null
  assigneeName: string | null
  taskType: string | null
  subTaskType: string | null
  estimateMinutes: number | null
  estimateSelected: boolean
}

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
  quotationSatang: number | null
}

interface EstimateResponse {
  rows: EstimateRow[]
  totals: { netCostSatang: number; marginSatang: number; quotationSatang: number }
  project: { estimateNetWorkingDays: number | null; quotedSatang: number | null }
  suggestedNetWorkingDays: number | null
  estimateProjectCostPerDaySatang: number | null
}

const KIND_LABEL: Record<string, string> = { task: 'Task', defect: 'Defect', cr: 'CR', backlog: 'Backlog' }

export function ProjectEstimateSection({
  projectId,
  members,
}: {
  projectId: string
  members: { id: string; name: string; role?: 'owner' | 'member' | 'vendor' | 'guest' }[]
}) {
  // Pronista §Project Estimate — สรุปงานรายบุคคล: ดึงสมาชิกทุกคนในโปรเจกต์ ยกเว้นลูกค้า (role='guest') — staff/outsource ดึงมาหมด
  // Admin(owner) ไม่มีทางอยู่ใน project_members ได้เลย (backend กันไว้ เพราะ owner เข้าถึงทุกโปรเจกต์เต็มรูปแบบเสมอ) แต่ยังถูก assign งานได้ปกติ — ดึงจาก /api/users มาต่อท้ายแทน
  const { data: allUsersData } = useLoad<{ id: string; name: string; role: 'owner' | 'member' | 'vendor' | 'guest' }[]>(() => api.get('/api/users'))
  const adminUsers = (allUsersData ?? []).filter((u) => u.role === 'owner')
  const summaryMembers = [...members.filter((m) => m.role !== 'guest'), ...adminUsers.filter((a) => !members.some((m) => m.id === a.id))]
  const { data: allTasks, reload: reloadTasks } = useLoad<EstimateTaskRow[]>(() => api.get(`/api/projects/${projectId}/estimate/tasks`), [projectId])
  const { data: estimate, reload: reloadEstimate } = useLoad<EstimateResponse>(() => api.get(`/api/projects/${projectId}/estimate`), [projectId])
  const { data: cfg } = useLoad<{ taskTypes: TaskType[] }>(() => api.get('/api/config'))
  const { data: roleCfg } = useLoad<{ parameterRoles: ParameterRole[] }>(() => api.get('/api/admin/parameter-roles'))

  const parameterRoles = resolveParameterRoles(roleCfg?.parameterRoles)
  const taskTypeCatalog = resolveTaskTypes(cfg?.taskTypes)

  const money = (satang: number | null) => (satang != null ? formatSatang(satang) : '—')
  const hours = (minutes: number) => minutesToHoursLabel(minutes)

  const reload = async () => {
    await Promise.all([reloadTasks(), reloadEstimate()])
  }

  // --- สรุปงานรายบุคคล ---
  const [memberId, setMemberId] = useState('')
  const memberTasks = (allTasks ?? []).filter((t) => t.assigneeId === memberId)
  const memberTotalMinutes = memberTasks.reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0)

  // --- เลือกงานเข้า Estimate ---
  const [pickerOpen, setPickerOpen] = useState(false)
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [taskTypeFilter, setTaskTypeFilter] = useState('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const openPicker = () => {
    setPicked(new Set((allTasks ?? []).filter((t) => t.estimateSelected).map((t) => t.id)))
    setAssigneeFilter('all')
    setKindFilter('all')
    setTaskTypeFilter('all')
    setPickerOpen(true)
  }
  const assigneeOptions = [...new Set((allTasks ?? []).map((t) => t.assigneeName).filter((n): n is string => !!n))].sort()
  const filteredTasks = (allTasks ?? [])
    .filter((t) => assigneeFilter === 'all' || t.assigneeName === assigneeFilter)
    .filter((t) => kindFilter === 'all' || t.kind === kindFilter)
    .filter((t) => taskTypeFilter === 'all' || t.taskType === taskTypeFilter)
  const togglePick = (id: string) =>
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allFilteredPicked = filteredTasks.length > 0 && filteredTasks.every((t) => picked.has(t.id))
  const toggleAll = () =>
    setPicked((s) => {
      const next = new Set(s)
      for (const t of filteredTasks) {
        if (allFilteredPicked) next.delete(t.id)
        else next.add(t.id)
      }
      return next
    })
  const pickedTotalMinutes = (allTasks ?? [])
    .filter((t) => picked.has(t.id))
    .reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0)

  const confirmSelection = async () => {
    setSaving(true)
    try {
      await api.put(`/api/projects/${projectId}/estimate/selection`, { taskIds: [...picked] })
      setPickerOpen(false)
      await reload()
    } finally {
      setSaving(false)
    }
  }

  // --- แก้ไขในตาราง Estimate ---
  const saveRole = async (taskId: string, costRoleId: string) => {
    await api.patch(`/api/tasks/${taskId}`, { costRoleId: costRoleId || null })
    await reloadEstimate()
  }
  const saveWorkHourPerDay = async (taskId: string, v: string) => {
    await api.patch(`/api/tasks/${taskId}`, { costWorkMinutesPerDay: v.trim() ? Math.round(Number(v) * 60) : null })
    await reloadEstimate()
  }
  const saveBufferPercent = async (taskId: string, v: string) => {
    await api.patch(`/api/tasks/${taskId}`, { costBufferPercent: v.trim() ? Math.round(Number(v)) : null })
    await reloadEstimate()
  }
  const saveNetWorkingDays = async (v: string) => {
    const n = v.trim() ? Math.round(Number(v)) : null
    await api.patch(`/api/projects/${projectId}`, { estimateNetWorkingDays: n })
    await reloadEstimate()
  }

  const inputCell = 'w-20 text-right text-sm bg-white border border-border rounded-lg px-2 py-1 tabular-nums focus:outline-hidden focus:border-brand-400'

  if (!allTasks || !estimate) return <div className="text-sm text-muted py-6 text-center">กำลังโหลด…</div>

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
          <option value="">— เลือกสมาชิก —</option>
          {summaryMembers.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        {memberId &&
          (memberTasks.length === 0 ? (
            <div className="text-sm text-muted py-4 text-center">ยังไม่มีงานที่ Assign ให้คนนี้ในโปรเจกต์นี้</div>
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
                  {memberTasks.map((t) => (
                    <tr key={t.id}>
                      <td className="py-1.5">
                        {t.code && <span className="text-muted font-mono text-xs mr-1">{t.code}</span>}
                        {t.title}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{t.estimateMinutes ? hours(t.estimateMinutes) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-right text-sm font-semibold mt-2 pt-2 border-t border-border-subtle">
                รวม {hours(memberTotalMinutes)} ชม.
              </div>
            </>
          ))}
      </div>

      {/* เลือกงานเข้า Estimate */}
      <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-semibold text-strong">รายการงานใน Estimate ({estimate.rows.length})</div>
          <button onClick={openPicker} className="text-sm text-brand-700 hover:text-brand-800">จัดการรายการงาน</button>
        </div>
        {pickerOpen && (
          <div className="mt-3 border-t border-border-subtle pt-3">
            <div className="flex flex-wrap gap-2 mb-3">
              <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="text-xs border border-border rounded-lg px-2 py-1.5">
                <option value="all">ผู้รับผิดชอบ: ทั้งหมด</option>
                {assigneeOptions.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="text-xs border border-border rounded-lg px-2 py-1.5">
                <option value="all">ประเภทงาน: ทั้งหมด</option>
                {Object.entries(KIND_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
              <select value={taskTypeFilter} onChange={(e) => setTaskTypeFilter(e.target.value)} className="text-xs border border-border rounded-lg px-2 py-1.5">
                <option value="all">ประเภท Task: ทั้งหมด</option>
                {taskTypeCatalog.map((tt) => (
                  <option key={tt.id} value={tt.id}>{tt.name}</option>
                ))}
              </select>
            </div>
            <div className="max-h-80 overflow-y-auto border border-border-subtle rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-hover text-dim text-xs sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 w-8">
                      <input type="checkbox" checked={allFilteredPicked} onChange={toggleAll} />
                    </th>
                    <th className="text-left font-medium px-2 py-1.5">งาน</th>
                    <th className="text-left font-medium px-2 py-1.5">ผู้รับผิดชอบ</th>
                    <th className="text-right font-medium px-2 py-1.5">ประมาณการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {filteredTasks.map((t) => (
                    <tr key={t.id}>
                      <td className="px-2 py-1.5">
                        <input type="checkbox" checked={picked.has(t.id)} onChange={() => togglePick(t.id)} />
                      </td>
                      <td className="px-2 py-1.5">
                        {t.code && <span className="text-muted font-mono text-xs mr-1">{t.code}</span>}
                        {t.title}
                      </td>
                      <td className="px-2 py-1.5 text-dim">{t.assigneeName ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{t.estimateMinutes ? hours(t.estimateMinutes) : '—'}</td>
                    </tr>
                  ))}
                  {filteredTasks.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center text-muted py-4">ไม่มีงานตรงเงื่อนไข</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="sticky bottom-0 z-10 flex items-center gap-3 bg-ink text-white rounded-lg shadow-lg px-4 py-2.5 mt-2 flex-wrap">
              <span className="text-sm font-medium">เลือก {picked.size} งาน</span>
              <span className="text-sm text-white/70">รวม ⏱ {hours(pickedTotalMinutes)} ชม.</span>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => setPickerOpen(false)} className="text-sm text-white/70 hover:text-white px-2">ยกเลิก</button>
                <button
                  onClick={() => void confirmSelection()}
                  disabled={saving}
                  className="text-sm bg-white text-ink px-3 py-1.5 rounded-lg font-medium disabled:opacity-40"
                >
                  {saving ? 'กำลังบันทึก…' : 'ตกลง'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ตาราง Estimate */}
      <div className="bg-white rounded-lg shadow-xs p-4 sm:p-5 overflow-x-auto">
        <div className="text-sm font-semibold text-strong mb-3">ตาราง Estimate</div>
        {estimate.rows.length === 0 ? (
          <div className="text-sm text-muted py-6 text-center">ยังไม่มีงานที่เลือกเข้า Estimate — กด "จัดการรายการงาน" ด้านบน</div>
        ) : (
          <table className="w-full text-sm min-w-[1280px]">
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
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{money(r.quotationSatang)}</td>
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
                <td className="px-3 py-2 text-right tabular-nums">{formatSatang(estimate.totals.quotationSatang)}</td>
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

      {/* Net Quotation Cost / Net Working Days / Estimate Project Cost per Day */}
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
  )
}
