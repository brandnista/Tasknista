/**
 * Pronista §Mobile Responsive Refactor (2026-09-02) — เมนู "จัดการเพิ่มเติม" (⋮/...) แบบ generic
 * generalize มาจาก DocActionsMenu เดิมใน Docs.tsx (rename/move/delete) ให้รับ items เองได้ ใช้ซ้ำได้ทุกหน้า
 * เปิดจากปุ่ม trigger ที่ตำแหน่งไหนก็ได้ — caller ส่ง {x,y} มาจาก getBoundingClientRect() ของปุ่มเอง
 */
import type { ReactNode } from 'react'

export interface ActionMenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  /** ขีดเส้นคั่นเหนือรายการนี้ (แยกกลุ่ม เช่น กันปุ่มลบออกจากปุ่มอื่น) */
  dividerBefore?: boolean
}

export function ActionMenu({ x, y, onClose, items, align = 'left' }: { x: number; y: number; onClose: () => void; items: ActionMenuItem[]; align?: 'left' | 'right' }) {
  const itemCls = (danger?: boolean) => `w-full text-left text-sm px-3 py-2.5 rounded-lg hover:bg-hover flex items-center gap-2 min-h-11 ${danger ? 'text-danger-600' : 'text-body'}`
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ [align === 'right' ? 'right' : 'left']: align === 'right' ? window.innerWidth - x : x, top: y }}
        className="absolute w-52 bg-white rounded-lg shadow-2xl border border-border-subtle p-1.5"
      >
        {items.map((it, i) => (
          <div key={i}>
            {it.dividerBefore && <div className="my-1 border-t border-divider" />}
            <button className={itemCls(it.danger)} onClick={() => { it.onClick(); onClose() }}>
              {it.icon}
              {it.label}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
