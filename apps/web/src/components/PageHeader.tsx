import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTopbar } from '../lib/topbar'

/**
 * header ต่อหน้า (h1 + action) ตาม SPEC §4 IA
 * Pronista §Navbar (2026-08-27) — ไม่เรนเดอร์แถบของตัวเองแล้ว แต่ส่งชื่อ+ปุ่มขึ้นไปที่ Topbar กลางของ Layout แทน
 * (API เดิมทุกอย่าง — 25 หน้าที่เรียกอยู่ไม่ต้องแก้) · หน้าที่ไม่เรียก PageHeader จะได้ชื่อจากเมนู NAV อัตโนมัติ
 */
export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  const { setTitle, actionSlot } = useTopbar()

  // title เป็น string → deps เสถียร ไม่ลูป (action เป็น ReactNode เปลี่ยน identity ทุกเรนเดอร์ จึงไปทาง portal แทน state)
  useEffect(() => {
    setTitle(title)
    return () => setTitle(null)
  }, [title, setTitle])

  return action && actionSlot ? createPortal(action, actionSlot) : null
}
