import { MoreVertical } from 'lucide-react'
import { useState } from 'react'
import { ActionMenu, type ActionMenuItem } from './ActionMenu'

export type ConvertTo = 'epic' | 'story' | 'task' | 'subtask' | 'defect' | 'cr'

export const CONVERT_LABEL: Record<ConvertTo, string> = {
  epic: 'ย้ายเป็น Epic',
  story: 'ย้ายเป็น Story',
  task: 'ย้ายเป็น Task',
  subtask: 'ย้ายเป็น Subtask',
  defect: 'ย้ายเป็น Defect',
  cr: 'ย้ายเป็น CR',
}

/**
 * Pronista §Backlog cross-project convert — เมนู "จัดการ" ใช้ร่วมกันทั้งหน้า Backlog ของโปรเจกต์ (ProjectDetail)
 * และ Company Backlog (Projects.tsx) กันดีไซน์เพี้ยนกันสองที่เหมือนที่เคยเกิดมาก่อน
 * (2026-09-16) เดิม dropdown เป็น absolute ผูกกับ container ตัวเอง — พอแถวอยู่ใน overflow-x-auto (แถวยาวๆ ที่ตัดกลับมา
 * scroll แนวนอนแทนการตกบรรทัด) เมนูโดนตัด/บังจากกล่อง scroll หรือ grid ข้างๆ เปลี่ยนไปใช้ ActionMenu (position:fixed
 * คำนวณจาก getBoundingClientRect) แทน ลอยได้อิสระไม่ติด overflow/stacking ของ container ไหนเลย
 */
export function BacklogConvertMenu({ onConvertDirect, onConvertPick, extraItems }: {
  // Epic/Story/CR/Defect ทำทันที (ไม่ต้องเลือก parent) · Task/Subtask ต้องเลือก parent ก่อน (เปิด picker ใน ConvertBacklogModal)
  onConvertDirect?: (to: 'epic' | 'story' | 'cr' | 'defect') => void
  onConvertPick?: (to: 'task' | 'subtask') => void
  extraItems?: { label: string; onClick: () => void }[]
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  if (!onConvertDirect && !onConvertPick && !extraItems?.length) return null
  const items: ActionMenuItem[] = [
    ...(onConvertDirect ? (['epic', 'story', 'cr', 'defect'] as const).map((to) => ({ label: CONVERT_LABEL[to], onClick: () => onConvertDirect(to) })) : []),
    ...(onConvertPick ? (['task', 'subtask'] as const).map((to) => ({ label: CONVERT_LABEL[to], onClick: () => onConvertPick(to) })) : []),
    ...(extraItems?.map((it) => ({ label: it.label, onClick: it.onClick, dividerBefore: true })) ?? []),
  ]
  return (
    <div className="relative shrink-0">
      <button
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAnchor({ x: r.right, y: r.bottom + 4 }) }}
        title="จัดการ"
        className="text-muted hover:text-body p-0.5 rounded hover:bg-hover"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>
      {anchor && <ActionMenu x={anchor.x} y={anchor.y} align="right" onClose={() => setAnchor(null)} items={items} />}
    </div>
  )
}
