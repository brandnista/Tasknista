import { MoreVertical } from 'lucide-react'
import { useState } from 'react'

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
 * Tasknista §Backlog cross-project convert — เมนู "จัดการ" ใช้ร่วมกันทั้งหน้า Backlog ของโปรเจกต์ (ProjectDetail)
 * และ Company Backlog (Projects.tsx) กันดีไซน์เพี้ยนกันสองที่เหมือนที่เคยเกิดมาก่อน
 */
export function BacklogConvertMenu({ onConvertDirect, onConvertPick, extraItems }: {
  // Epic/Story/CR/Defect ทำทันที (ไม่ต้องเลือก parent) · Task/Subtask ต้องเลือก parent ก่อน (เปิด picker ใน ConvertBacklogModal)
  onConvertDirect?: (to: 'epic' | 'story' | 'cr' | 'defect') => void
  onConvertPick?: (to: 'task' | 'subtask') => void
  extraItems?: { label: string; onClick: () => void }[]
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  if (!onConvertDirect && !onConvertPick && !extraItems?.length) return null
  return (
    <div className="relative shrink-0">
      <button onClick={() => setMenuOpen((v) => !v)} title="จัดการ" className="text-muted hover:text-body p-0.5 rounded hover:bg-hover">
        <MoreVertical className="w-3.5 h-3.5" />
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg shadow-lg border border-border-subtle py-1 z-20 text-xs">
            {(['epic', 'story', 'cr', 'defect'] as const).map((to) => (
              <button
                key={to}
                onClick={() => { setMenuOpen(false); onConvertDirect?.(to) }}
                className="w-full text-left px-3 py-1.5 text-body hover:bg-hover"
              >
                {CONVERT_LABEL[to]}
              </button>
            ))}
            {(['task', 'subtask'] as const).map((to) => (
              <button
                key={to}
                onClick={() => { setMenuOpen(false); onConvertPick?.(to) }}
                className="w-full text-left px-3 py-1.5 text-body hover:bg-hover"
              >
                {CONVERT_LABEL[to]}
              </button>
            ))}
            {extraItems?.map((it) => (
              <button
                key={it.label}
                onClick={() => { setMenuOpen(false); it.onClick() }}
                className="w-full text-left px-3 py-1.5 text-body hover:bg-hover border-t border-border-subtle"
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
