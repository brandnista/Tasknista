/**
 * Pronista §Workload (Phase 2, 2026-09-04) — ภาพรวมภาระงานทีม: แถว=คน คอลัมน์=วันที่ (จัดกลุ่มเป็นแถบสัปดาห์)
 * ช่อง = ใช้ไป/เต็ม (ชม.) ไฮไลต์แดงเมื่อเกิน — ไม่มีการยกยอดตัวเลขไปวันถัดไป · owner-only (mirror /api/overview/company)
 */
import { addDaysISO, bkkDateOf, minutesToHoursLabel, WEEKDAYS, weekdayOfISO, type Weekday } from '@seedoffice/core'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { PageHeader } from '../components/PageHeader'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'

type ViewMode = 'daily' | 'weekly' | 'monthly' | 'sprint'

interface WorkloadCell {
  usedMinutes: number
  capacityMinutes: number
  onLeave: boolean
  taskIds: string[]
}
interface WorkloadResponse {
  people: { id: string; name: string; role: string; avatarUrl: string | null }[]
  days: string[]
  grid: Record<string, Record<string, WorkloadCell>>
  unscheduled: { id: string; code: string | null; title: string; assigneeId: string; estimateMinutes: number }[]
}
interface SprintOption { id: string; name: string | null; projectName: string | null; startDate: string; endDate: string; status: string }

const EMPTY_WORKLOAD: WorkloadResponse = { people: [], days: [], grid: {}, unscheduled: [] }
const WEEKDAY_LABEL_SHORT: Record<Weekday, string> = { mon: 'จ', tue: 'อ', wed: 'พ', thu: 'พฤ', fri: 'ศ', sat: 'ส', sun: 'อา' }
const VIEW_LABEL: Record<ViewMode, string> = { daily: 'รายวัน', weekly: 'รายสัปดาห์', monthly: 'รายเดือน', sprint: 'Sprint' }

function mondayOf(date: string): string {
  return addDaysISO(date, -WEEKDAYS.indexOf(weekdayOfISO(date)))
}
function monthRange(anchor: string): { from: string; to: string } {
  const year = Number(anchor.slice(0, 4))
  const month = Number(anchor.slice(5, 7)) // 1-indexed
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { from: `${anchor.slice(0, 7)}-01`, to: `${anchor.slice(0, 7)}-${String(lastDay).padStart(2, '0')}` }
}
function shiftMonth(anchor: string, delta: number): string {
  const year = Number(anchor.slice(0, 4))
  const month = Number(anchor.slice(5, 7)) - 1 // 0-indexed
  const d = new Date(Date.UTC(year, month + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

export function WorkloadPage() {
  const today = bkkDateOf(Date.now())
  const [view, setView] = useState<ViewMode>('weekly')
  const [anchor, setAnchor] = useState(today) // ใช้กับ daily/weekly/monthly
  const [sprintId, setSprintId] = useState('')

  const { data: sprintsData } = useLoad<{ sprints: SprintOption[] }>(() => api.get('/api/workload/sprints'), [])
  const sprintList = sprintsData?.sprints ?? []
  const selectedSprint = sprintList.find((s) => s.id === sprintId)

  const { from, to } = useMemo(() => {
    if (view === 'daily') return { from: anchor, to: anchor }
    if (view === 'weekly') {
      const m = mondayOf(anchor)
      return { from: m, to: addDaysISO(m, 6) }
    }
    if (view === 'monthly') return monthRange(anchor)
    if (selectedSprint) return { from: selectedSprint.startDate, to: selectedSprint.endDate }
    return { from: today, to: today }
  }, [view, anchor, selectedSprint, today])

  const { data, loading } = useLoad<WorkloadResponse>(
    () =>
      view === 'sprint' && !sprintId
        ? Promise.resolve(EMPTY_WORKLOAD)
        : api.get(`/api/workload?from=${from}&to=${to}${view === 'sprint' ? `&sprintId=${sprintId}` : ''}`),
    [from, to, view, sprintId],
  )

  const goPrev = () => {
    if (view === 'daily') setAnchor((a) => addDaysISO(a, -1))
    else if (view === 'weekly') setAnchor((a) => addDaysISO(a, -7))
    else if (view === 'monthly') setAnchor((a) => shiftMonth(a, -1))
  }
  const goNext = () => {
    if (view === 'daily') setAnchor((a) => addDaysISO(a, 1))
    else if (view === 'weekly') setAnchor((a) => addDaysISO(a, 7))
    else if (view === 'monthly') setAnchor((a) => shiftMonth(a, 1))
  }

  // จัดกลุ่มวันเป็นแถบสัปดาห์ (สัปดาห์เริ่มจันทร์) สำหรับหัวตาราง — ช่วงที่ไม่ได้เริ่มวันจันทร์ (Sprint/ต้นเดือน) แถบแรกจะสั้นกว่าปกติ ไม่เป็นไร
  const weeks = useMemo(() => {
    const groups: string[][] = []
    for (const d of data?.days ?? []) {
      if (weekdayOfISO(d) === 'mon' || groups.length === 0) groups.push([d])
      else groups[groups.length - 1]!.push(d)
    }
    return groups
  }, [data?.days])

  const showSprintEmpty = view === 'sprint' && !sprintId
  const rows = data ?? EMPTY_WORKLOAD

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="Workload" />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="inline-flex rounded-lg border border-border bg-white p-0.5">
          {(Object.keys(VIEW_LABEL) as ViewMode[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm rounded-md ${view === v ? 'bg-brand-600 text-white' : 'text-soft hover:bg-hover'}`}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>

        {view === 'sprint' ? (
          <select value={sprintId} onChange={(e) => setSprintId(e.target.value)} className="text-sm bg-white border border-border rounded-lg px-2.5 py-1.5">
            <option value="">— เลือก Sprint —</option>
            {sprintList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.projectName ? `${s.projectName} · ` : ''}
                {s.name || 'Sprint'}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex items-center gap-1">
            <button type="button" onClick={goPrev} className="p-1.5 rounded-lg text-soft hover:bg-hover" aria-label="ก่อนหน้า">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => setAnchor(today)} className="text-sm text-brand-600 hover:text-brand-700 px-1.5">
              วันนี้
            </button>
            <button type="button" onClick={goNext} className="p-1.5 rounded-lg text-soft hover:bg-hover" aria-label="ถัดไป">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
        <span className="text-sm text-muted ml-1 tabular-nums">
          {showSprintEmpty ? '' : `${from} – ${to}`}
        </span>
      </div>

      {loading && <div className="py-10 text-center text-sm text-muted">กำลังโหลด…</div>}

      {!loading && showSprintEmpty && <div className="py-10 text-center text-sm text-muted bg-white rounded-lg shadow-xs">เลือก Sprint ที่ต้องการดูก่อน</div>}

      {!loading && !showSprintEmpty && (
        <>
          {rows.people.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted bg-white rounded-lg shadow-xs mb-4">ยังไม่มีสมาชิกในทีม</div>
          ) : (
            <div className="bg-white rounded-lg shadow-xs overflow-hidden mb-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-30 bg-hover px-3 py-2 text-left text-xs font-semibold text-muted shadow-[1px_0_0_var(--color-border-subtle)]">สมาชิก</th>
                      {weeks.map((week) => (
                        <th key={week[0]} colSpan={week.length} className="px-2 py-1.5 bg-hover text-[11px] font-medium text-muted text-center border-l border-border-subtle whitespace-nowrap">
                          {week[0]} – {week[week.length - 1]}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      <th className="sticky left-0 z-30 bg-hover shadow-[1px_0_0_var(--color-border-subtle)]" />
                      {rows.days.map((d) => (
                        <th key={d} className={`px-2 py-1.5 text-[11px] font-medium text-center min-w-[64px] ${d === today ? 'bg-brand-50 text-brand-700' : 'text-muted'}`}>
                          {WEEKDAY_LABEL_SHORT[weekdayOfISO(d)]}
                          <span className="block tabular-nums">{d.slice(8, 10)}/{d.slice(5, 7)}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.people.map((p) => (
                      <tr key={p.id} className="group/row">
                        <td className="sticky left-0 z-20 bg-white group-hover/row:bg-hover px-3 py-2 shadow-[1px_0_0_var(--color-border-subtle)] whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <Avatar name={p.name} avatarUrl={p.avatarUrl} className="w-6 h-6 text-[10px]" />
                            <span className="font-medium text-strong">{p.name}</span>
                          </div>
                        </td>
                        {rows.days.map((d) => {
                          const cell = rows.grid[p.id]?.[d]
                          const over = !!cell && !cell.onLeave && cell.usedMinutes > cell.capacityMinutes
                          return (
                            <td key={d} className={`px-2 py-2 text-center tabular-nums ${d === today ? 'bg-brand-50/40' : ''}`}>
                              {cell?.onLeave ? (
                                <span className="inline-block text-[11px] font-medium text-warning-700 bg-warning-100 rounded-full px-2 py-0.5">ลา</span>
                              ) : cell ? (
                                <span className={`text-[12.5px] ${over ? 'text-danger-600 font-semibold' : 'text-body'}`}>
                                  {minutesToHoursLabel(cell.usedMinutes)}/{minutesToHoursLabel(cell.capacityMinutes)}
                                </span>
                              ) : (
                                <span className="text-[12.5px] text-muted">—</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg shadow-xs overflow-hidden">
            <div className="px-4 py-3 border-b border-border-subtle text-sm font-semibold text-ink">งานที่ยังไม่กำหนดวัน ({rows.unscheduled.length})</div>
            {rows.unscheduled.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted">ไม่มีงานค้าง</div>
            ) : (
              <div className="divide-y divide-divider">
                {rows.unscheduled.map((t) => {
                  const person = rows.people.find((p) => p.id === t.assigneeId)
                  return (
                    <div key={t.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                      {person && <Avatar name={person.name} avatarUrl={person.avatarUrl} className="w-6 h-6 text-[10px]" />}
                      <span className="flex-1 min-w-0 truncate text-body">
                        {t.code ? `${t.code} ` : ''}
                        {t.title}
                      </span>
                      <span className="text-muted tabular-nums shrink-0">{minutesToHoursLabel(t.estimateMinutes)} ชม.</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
