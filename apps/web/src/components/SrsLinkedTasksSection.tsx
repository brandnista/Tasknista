import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'

export interface DocLinkRow {
  id: string
  projectId: string | null
  taskId: string | null
  taskTitle: string | null
  taskCode: string | null
  taskSrsRefCode: string | null
  taskSrsSourceCode: string | null
  taskProjectId: string | null
}

/** Pronista §SRS import — "งานที่สร้างจากเอกสารนี้" ย้อนกลับจากเอกสาร SRS ไปยัง Task ทั้งหมดที่แตกออกมา — ใช้ร่วมกันทั้งเอกสาร SRS ที่อัปโหลด (Docs.tsx) และ Template SRS (TemplateFillForm.tsx) */
export function SrsLinkedTasksSection({ docId }: { docId: string }) {
  const { data } = useLoad<DocLinkRow[]>(() => api.get(`/api/docs/${docId}/links`), [docId])
  const taskLinks = (data ?? []).filter((l) => l.taskId)
  if (taskLinks.length === 0) return null
  return (
    <div className="mt-8 pt-6 border-t border-divider">
      <div className="text-sm font-semibold text-ink mb-3">งานที่สร้างจากเอกสารนี้ ({taskLinks.length})</div>
      <div className="space-y-1.5">
        {taskLinks.map((l) => (
          <a
            key={l.id}
            href={`/projects/${l.taskProjectId}?task=${l.taskId}`}
            className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-border-subtle hover:bg-hover"
          >
            {l.taskSrsRefCode && <span className="text-[11px] font-mono text-info-700 bg-info-50 px-1.5 py-0.5 rounded shrink-0">{l.taskSrsRefCode}</span>}
            {l.taskCode && <span className="text-[11px] font-mono text-muted shrink-0">{l.taskCode}</span>}
            <span className="flex-1 truncate">{l.taskTitle}</span>
          </a>
        ))}
      </div>
    </div>
  )
}
