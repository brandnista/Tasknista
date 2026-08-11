import { Avatar } from './Avatar'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'
import { avatarColor } from '../pages/ProjectDetail'

interface ChangeLogEntry {
  id: string
  at: number
  actorName: string
  actorAvatarUrl: string | null
  action: string
  entity: string
  meta: Record<string, unknown> | null
}

const ACTION_LABEL: Record<string, string> = {
  'project.create': 'สร้างโปรเจกต์นี้',
  'project.update': 'แก้ไขข้อมูลโปรเจกต์',
  'project.member_position': 'เปลี่ยนตำแหน่งสมาชิก',
  'project.delete': 'ลบโปรเจกต์',
  'project_release.create': 'เพิ่มเวอร์ชัน (Version Release)',
  'project_release.edit': 'แก้ไขเวอร์ชัน',
  'project_release.delete': 'ลบเวอร์ชัน',
  'external_doc_log.create': 'บันทึกเวอร์ชันเอกสารภายนอก',
  'external_doc_log.delete': 'ลบบันทึกเวอร์ชันเอกสารภายนอก',
  'sprint.create': 'สร้าง Sprint',
  'sprint.start': 'เริ่ม Sprint',
  'sprint.complete': 'ปิด Sprint',
  'epic.create': 'สร้าง Epic',
  'task.create': 'สร้างงาน',
  'task.update': 'แก้รายละเอียดงาน',
  'task.assign': 'เปลี่ยนผู้รับผิดชอบ',
  'task.status': 'เปลี่ยนสถานะงาน',
  'task.done': 'ทำงานเสร็จ',
  'task.delete': 'ลบงาน',
  'task.attach': 'แนบไฟล์ในงาน',
  'task.attach_delete': 'ลบไฟล์แนบในงาน',
  'task.convert': 'แปลงประเภทงาน',
  'task.dispatch': 'จ่ายงาน',
  'task.accept': 'รับงาน',
  'doc.create': 'สร้างเอกสาร',
  'doc.rename': 'เปลี่ยนชื่อเอกสาร',
  'doc.move': 'ย้ายเอกสาร',
  'doc.duplicate': 'ทำสำเนาเอกสาร',
  'doc.delete': 'ลบเอกสาร',
  'doc.attach': 'แนบไฟล์ในเอกสาร',
  'doc.attach_delete': 'ลบไฟล์แนบในเอกสาร',
}

const ENTITY_LABEL: Record<string, string> = {
  project: 'โปรเจกต์',
  task: 'งาน',
  doc: 'เอกสาร',
  sprint: 'Sprint',
  epic: 'Epic',
}

const fmtWhen = (ms: number) =>
  new Date(ms).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function metaLabel(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null
  const title = meta.title ?? meta.filename ?? meta.version ?? meta.name
  return typeof title === 'string' && title.trim() ? title : null
}

/** Pronista §System Requirements Update — แท็บ "Change Log" ต่อโปรเจกต์ รวมความเคลื่อนไหวทุกอย่างที่ผูกกับโปรเจกต์นี้ (task/epic/sprint/doc/project เอง) จาก audit_logs */
export function ProjectChangeLogTab({ projectId }: { projectId: string }) {
  const { data } = useLoad<{ entries: ChangeLogEntry[] }>(() => api.get(`/api/projects/${projectId}/changelog`))
  const entries = data?.entries ?? []

  return (
    <div className="bg-white rounded-lg shadow-xs overflow-hidden">
      <div className="p-4 border-b border-border-subtle font-semibold text-ink text-sm">Change Log · {entries.length} รายการ</div>
      {entries.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted">ยังไม่มีความเคลื่อนไหวในโปรเจกต์นี้</div>
      ) : (
        <div className="divide-y divide-divider">
          {entries.map((e) => {
            const label = metaLabel(e.meta)
            return (
              <div key={e.id} className="flex items-start gap-2.5 px-4 py-3 text-sm">
                <Avatar name={e.actorName} avatarUrl={e.actorAvatarUrl} className="w-6 h-6 text-[10px] shrink-0 mt-0.5" colorClass={avatarColor(e.actorName)} />
                <div className="min-w-0">
                  <div>
                    <b className="text-body">{e.actorName}</b>{' '}
                    <span className="text-dim">{ACTION_LABEL[e.action] ?? e.action}</span>
                    {label && <span className="text-muted"> · {label}</span>}
                  </div>
                  <div className="text-[11px] text-muted mt-0.5">{ENTITY_LABEL[e.entity] ?? e.entity} · {fmtWhen(e.at)}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
