/**
 * Pronista §Mobile Responsive Refactor (2026-09-02) — เมนู "จัดการเพิ่มเติม" (⋮/...) แบบ generic
 * generalize มาจาก DocActionsMenu เดิมใน Docs.tsx (rename/move/delete) ให้รับ items เองได้ ใช้ซ้ำได้ทุกหน้า
 * เปิดจากปุ่ม trigger ที่ตำแหน่งไหนก็ได้ — caller ส่ง {x,y} มาจาก getBoundingClientRect() ของปุ่มเอง
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface ActionMenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  /** ขีดเส้นคั่นเหนือรายการนี้ (แยกกลุ่ม เช่น กันปุ่มลบออกจากปุ่มอื่น) */
  dividerBefore?: boolean
  // Pronista §Team Directory (2026-09-16) — ปิดใช้งานรายการนี้ได้ (เช่น "โทร" ตอนยังไม่มีเบอร์) พร้อมเหตุผลโชว์เป็น title
  disabled?: boolean
  disabledReason?: string
}

const VIEWPORT_MARGIN = 8

export function ActionMenu({ x, y, onClose, items, align = 'left' }: { x: number; y: number; onClose: () => void; items: ActionMenuItem[]; align?: 'left' | 'right' }) {
  const itemCls = (danger?: boolean, disabled?: boolean) =>
    `w-full text-left text-sm px-3 py-2.5 rounded-lg flex items-center gap-2 min-h-11 ${disabled ? 'text-muted opacity-50 cursor-not-allowed' : `hover:bg-hover ${danger ? 'text-danger-600' : 'text-body'}`}`
  const menuRef = useRef<HTMLDivElement>(null)
  // Pronista §Backlog Convert Menu clipped near bottom (2026-09-24) — เดิมใช้ style={top:y} ตรงๆ ไม่มีการเช็คขอบจอเลย
  // แถวที่อยู่ใกล้ขอบล่าง (หรือขวา บนมือถือ) เมนูจะยื่นล้นออกนอกจอ มองไม่เห็น/กดตัวเลือกท้ายๆ ไม่ได้ (ไม่ใช่ถูกซ้อนทับ แค่เรนเดอร์เลยขอบจอไปเฉยๆ)
  // วัดขนาดจริงหลัง mount แล้วคำนวณตำแหน่งที่อยู่ในจอเสมอ: แนวตั้งพลิกขึ้นเหนือปุ่มถ้าเปิดลงแล้วล้น, แนวนอน clamp ไม่ให้ล้นซ้าย/ขวา
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    let top = y
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      const above = y - height - 8 // 8 = ระยะเดียวกับที่ caller บวกไว้ตอนเปิดลง (bottom+4 ปุ่ม + margin เมนู)
      top = above >= VIEWPORT_MARGIN ? above : Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
    }
    let left = align === 'right' ? x - width : x
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), window.innerWidth - width - VIEWPORT_MARGIN)
    setPos({ top, left })
  }, [x, y, align])
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        ref={menuRef}
        onClick={(e) => e.stopPropagation()}
        style={pos ? { top: pos.top, left: pos.left } : { top: y, left: align === 'right' ? undefined : x, right: align === 'right' ? window.innerWidth - x : undefined, visibility: 'hidden' }}
        className="absolute w-52 bg-white rounded-lg shadow-2xl border border-border-subtle p-1.5"
      >
        {items.map((it, i) => (
          <div key={i}>
            {it.dividerBefore && <div className="my-1 border-t border-divider" />}
            <button
              className={itemCls(it.danger, it.disabled)}
              disabled={it.disabled}
              title={it.disabled ? it.disabledReason : undefined}
              onClick={() => { if (it.disabled) return; it.onClick(); onClose() }}
            >
              {it.icon}
              {it.label}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
