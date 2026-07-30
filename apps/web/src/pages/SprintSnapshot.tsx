import { ChevronLeft } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { api } from '../lib/api'
import { fmtThaiDate, statusChip } from '../lib/project-ui'
import { useLoad } from '../lib/useLoad'

interface SnapshotColumn { id: string; name: string; color: string; sortOrder: number }
interface SnapshotPreset { id: string; name: string; columns: SnapshotColumn[] }
interface SnapshotSprint {
  id: string
  projectId: string
  name: string | null
  startDate: string
  endDate: string
  status: 'planned' | 'active' | 'completed'
  doneCount: number | null
  notDoneCount: number | null
}
interface SnapshotTask {
  id: string
  taskCode: string | null
  taskTitle: string
  statusIdAtClose: string | null
  priority: string | null
  srsRefCode: string | null
}
interface SnapshotData {
  sprint: SnapshotSprint
  preset: SnapshotPreset | null
  cols: SnapshotColumn[]
  tasks: SnapshotTask[]
}

const PRIORITY_DOT: Record<string, string> = { low: 'bg-border', normal: 'bg-warning-400', high: 'bg-danger-500' }

/** Tasknista §Sprint & Board แก้ไข flow (ข้อ 8) — Detail Board ย้อนหลังของ sprint ที่ปิดแล้ว อ่านจาก sprint_task_snapshots (read-only)
 * ถ้า preset ถูกลบไปหลังปิด sprint แล้ว (cols ว่าง) จะ group ตาม statusIdAtClose ดิบแทน กันหน้าแตก */
export function SprintSnapshotPage() {
  const { id: projectId, sprintId } = useParams<{ id: string; sprintId: string }>()
  const { data, error } = useLoad<SnapshotData>(() => api.get(`/api/sprints/${sprintId}/snapshot`), [sprintId])

  if (error)
    return (
      <div className="p-6 text-center text-sm text-muted">
        ดู Detail Board ย้อนหลังได้เฉพาะ Sprint ที่ปิดแล้ว
        <div className="mt-3">
          <Link to={`/projects/${projectId}`} className="text-brand-600 hover:underline">← กลับไปหน้าโปรเจกต์</Link>
        </div>
      </div>
    )
  if (!data) return <div className="p-6 text-sm text-muted">กำลังโหลด…</div>

  const { sprint, tasks } = data
  const columns: SnapshotColumn[] =
    data.cols.length > 0
      ? data.cols
      : Array.from(new Set(tasks.map((t) => t.statusIdAtClose ?? 'ไม่ทราบสถานะ'))).map((id, i) => ({ id, name: id, color: 'slate', sortOrder: i }))

  return (
    <div className="p-3 sm:p-6">
      <Link to={`/projects/${projectId}`} className="text-sm text-muted hover:text-soft flex items-center gap-1 mb-4">
        <ChevronLeft className="w-4 h-4" /> กลับไปหน้าโปรเจกต์
      </Link>

      <div className="bg-white rounded-lg shadow-xs p-4 mb-4 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-ink">{sprint.name || 'Sprint'}</h2>
        <span className="text-xs text-muted">{fmtThaiDate(sprint.startDate)} – {fmtThaiDate(sprint.endDate, true)}</span>
        {data.preset && <span className="text-xs px-2 py-0.5 rounded-full bg-info-50 text-info-700 ml-2">{data.preset.name}</span>}
        <span className="text-xs px-2 py-0.5 rounded-full bg-success-50 text-success-700">{sprint.doneCount ?? 0} เสร็จ</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-divider text-dim">{sprint.notDoneCount ?? 0} ไม่เสร็จ</span>
        <span className="text-[11px] text-muted ml-auto">📋 มุมมองย้อนหลัง — แก้ไข/ลากไม่ได้</span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const colTasks = tasks.filter((t) => (t.statusIdAtClose ?? 'ไม่ทราบสถานะ') === col.id)
          return (
            <div key={col.id} className="bg-hover/60 rounded-lg p-2 min-h-32 w-64 shrink-0">
              <div className="flex items-center gap-1.5 px-1.5 py-1 mb-1.5">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusChip(col.color)}`}>{col.name}</span>
                <span className="text-xs text-muted">{colTasks.length}</span>
              </div>
              <div className="space-y-2">
                {colTasks.map((t) => (
                  <div key={t.id} className="bg-white rounded-lg shadow-xs p-3">
                    <div className="flex items-start gap-1.5">
                      {t.taskCode && <span className="text-[11px] font-mono text-muted shrink-0">{t.taskCode}</span>}
                      <span className="text-sm text-body flex-1">{t.taskTitle}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                      {t.priority && <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[t.priority] ?? 'bg-border'}`} />}
                      {t.srsRefCode && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-info-50 text-info-700">📄 {t.srsRefCode}</span>}
                    </div>
                  </div>
                ))}
                {colTasks.length === 0 && <div className="text-center text-[11px] text-border py-3">ไม่มีงาน</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
