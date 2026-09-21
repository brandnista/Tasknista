import { bkkDateOf, minutesToHoursLabel } from '@seedoffice/core'
import { useNavigate } from 'react-router'
import { api } from '../lib/api'
import { avatarColor } from '../pages/ProjectDetail'
import { fmtThaiDate } from '../lib/project-ui'
import { useLoad } from '../lib/useLoad'
import { Avatar } from './Avatar'

interface CompanyStats {
  overdueList: { id: string; title: string; priority: 'low' | 'normal' | 'high'; projectId: string | null; projectName: string; dueDate: string; overdueDays: number }[]
  dueSoonList: { id: string; title: string; priority: 'low' | 'normal' | 'high'; projectId: string | null; projectName: string; dueDate: string }[]
  waitingReviewList: { id: string; title: string; projectId: string | null; projectName: string; submittedAt: string | number | null; assigneeName: string }[]
}

interface WorkloadDay {
  people: { id: string; name: string; avatarUrl: string | null }[]
  grid: Record<string, Record<string, { usedMinutes: number; taskMinutes: number; meetingMinutes: number; capacityMinutes: number; onLeave: boolean }>>
}

const PRIORITY_DOT = { low: 'bg-border', normal: 'bg-warning-400', high: 'bg-danger-500' } as const
const DENSITY_LABEL = { overloaded: 'เกินกำลัง', moderate: 'พอเหมาะ', free: 'ยังว่าง' } as const
const DENSITY_BAR = { overloaded: 'bg-danger-500', moderate: 'bg-warning-400', free: 'bg-success-500' } as const

/** ภาพรวมองค์กร (SPEC เพิ่มเติม) — งานเลยกำหนด/ใกล้ครบกำหนด + ภาระงานทีมข้ามโปรเจกต์ เห็นเฉพาะ Admin (owner) — วางเหนือ "งานวันนี้"/"งานเร็วๆ นี้" ส่วนตัวเดิม */
export function CompanyOverview() {
  const navigate = useNavigate()
  const { data: stats, loading } = useLoad<CompanyStats>(() => api.get('/api/overview/company'))
  const today = bkkDateOf(Date.now())
  const { data: workload } = useLoad<WorkloadDay>(() => api.get(`/api/workload?from=${today}&to=${today}`))

  if (loading || !stats) return null

  return (
    <div className="mb-6">
      <div className="text-sm font-semibold text-body mb-3">ภาพรวมองค์กร</div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="bg-white rounded-lg shadow-xs p-4">
          <div className="font-semibold text-ink text-sm mb-2">งานเลยกำหนด <span className="text-xs font-normal text-muted">({stats.overdueList.length})</span></div>
          <div className="divide-y divide-divider max-h-64 overflow-y-auto">
            {stats.overdueList.length === 0 && <div className="text-center text-xs text-border py-6">ไม่มีงานเลยกำหนด 🎉</div>}
            {stats.overdueList.map((t) => (
              <div key={t.id} onClick={() => t.projectId && navigate(`/projects/${t.projectId}?task=${t.id}`)} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2.5 py-2 cursor-pointer hover:bg-hover -mx-1 px-1 rounded-lg">
                <div className="flex items-center gap-2.5 min-w-0 sm:flex-1">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[t.priority]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-body truncate">{t.title}</div>
                    <div className="text-[11px] text-muted truncate">{t.projectName}</div>
                  </div>
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-danger-50 text-danger-600 self-start sm:self-auto shrink-0 ml-3.5 sm:ml-0">เลยกำหนด {t.overdueDays} วัน</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-xs p-4">
          <div className="font-semibold text-ink text-sm mb-2">ใกล้ครบกำหนด (7 วัน) <span className="text-xs font-normal text-muted">({stats.dueSoonList.length})</span></div>
          <div className="divide-y divide-divider max-h-64 overflow-y-auto">
            {stats.dueSoonList.length === 0 && <div className="text-center text-xs text-border py-6">ไม่มีงานใกล้ครบกำหนด</div>}
            {stats.dueSoonList.map((t) => (
              <div key={t.id} onClick={() => t.projectId && navigate(`/projects/${t.projectId}?task=${t.id}`)} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2.5 py-2 cursor-pointer hover:bg-hover -mx-1 px-1 rounded-lg">
                <div className="flex items-center gap-2.5 min-w-0 sm:flex-1">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[t.priority]}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-body truncate">{t.title}</div>
                    <div className="text-[11px] text-muted truncate">{t.projectName}</div>
                  </div>
                </div>
                <span className="text-[11px] text-dim shrink-0 ml-3.5 sm:ml-0">{fmtThaiDate(t.dueDate)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-xs p-4">
          <div className="font-semibold text-ink text-sm mb-2">งานรอตรวจ <span className="text-xs font-normal text-muted">({stats.waitingReviewList.length})</span></div>
          <div className="divide-y divide-divider max-h-64 overflow-y-auto">
            {stats.waitingReviewList.length === 0 && <div className="text-center text-xs text-border py-6">ไม่มีงานรอตรวจ</div>}
            {stats.waitingReviewList.map((t) => (
              <div key={t.id} onClick={() => t.projectId && navigate(`/projects/${t.projectId}?task=${t.id}`)} className="py-2 cursor-pointer hover:bg-hover -mx-1 px-1 rounded-lg">
                <div className="text-sm text-body truncate">{t.title}</div>
                <div className="text-[11px] text-muted truncate">{t.projectName}{t.assigneeName ? ` · ${t.assigneeName}` : ''}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-xs p-4">
        <div className="font-semibold text-ink text-sm mb-1">ภาระงานของทีม</div>
        <p className="text-[11px] text-muted mb-3">Manhour วันนี้จากงานที่กดรับแล้วและเวลาประชุม — เทียบกับกำลังการทำงานของแต่ละคน</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(workload?.people ?? []).map((u) => {
            const cell = workload?.grid[u.id]?.[today] ?? { usedMinutes: 0, taskMinutes: 0, meetingMinutes: 0, capacityMinutes: 0, onLeave: false }
            const ratio = cell.capacityMinutes > 0 ? cell.usedMinutes / cell.capacityMinutes : 0
            const density: keyof typeof DENSITY_LABEL = ratio > 1 ? 'overloaded' : ratio >= 0.6 ? 'moderate' : 'free'
            return (
            <div key={u.id} className="flex items-center gap-3 p-3 rounded-lg bg-hover/60">
              <Avatar name={u.name} avatarUrl={u.avatarUrl} className="w-8 h-8 text-xs shrink-0" colorClass={avatarColor(u.name)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5">
                  <span className="text-sm text-body truncate">{u.name}</span>
                  <span className="text-[11px] text-muted shrink-0">{cell.onLeave ? 'ลา' : DENSITY_LABEL[density]}</span>
                </div>
                <div className="h-1.5 bg-divider rounded-full overflow-hidden mt-1.5">
                  <div className={`h-full ${DENSITY_BAR[density]}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                </div>
                <div className="text-[10px] text-muted mt-1">
                  <span className="font-medium text-body">{minutesToHoursLabel(cell.usedMinutes)}/{minutesToHoursLabel(cell.capacityMinutes)} ชม.</span>
                  {' · '}งาน {minutesToHoursLabel(cell.taskMinutes)} · ประชุม {minutesToHoursLabel(cell.meetingMinutes)}
                </div>
              </div>
            </div>
          )})}
          {(workload?.people ?? []).length === 0 && <div className="text-xs text-muted py-3">ยังไม่มีข้อมูลภาระงานวันนี้</div>}
        </div>
      </div>
    </div>
  )
}
