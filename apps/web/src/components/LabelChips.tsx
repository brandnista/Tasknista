/**
 * Pronista §Workspace — render แท็กสีของ Task เป็น chip ใช้ร่วมกันทุกที่ (TaskDetail/BacklogTaskRow/Workspace/Board)
 * รับ catalog (จาก GET /api/config) + labelIds ของ task แล้ว resolve+เรียงเอง ไม่ต้องรอ props เรียงมาแล้ว
 */
import { labelsByIds, type Label } from '@seedoffice/core'
import { statusChip } from '../lib/project-ui'

export function LabelChips({ catalog, ids, className }: { catalog: Label[] | null | undefined; ids: string[] | null | undefined; className?: string }) {
  const labels = labelsByIds(catalog, ids)
  if (labels.length === 0) return null
  return (
    <div className={`flex items-center gap-1 flex-wrap ${className ?? ''}`}>
      {labels.map((l) => (
        <span key={l.id} className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${statusChip(l.color)}`}>
          {l.name}
        </span>
      ))}
    </div>
  )
}
