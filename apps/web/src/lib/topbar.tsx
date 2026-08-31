import { createContext, useContext } from 'react'

/**
 * Pronista §Navbar (2026-08-27) — Topbar กลางตัวเดียวของแอป
 * เดิมแต่ละหน้าเรนเดอร์แถบหัวของตัวเอง (PageHeader h-16) ทำให้ไม่มีที่วาง action ระดับแอป (กระดิ่งแจ้งเตือน)
 * ต้องไปเบียดอยู่ในหัวไซด์บาร์ซ้าย → panel เปิดออกซ้ายแล้วตกขอบจอ
 * ตอนนี้ Layout เรนเดอร์ Topbar ตัวเดียว · หน้าไหนอยากตั้งชื่อ/ใส่ปุ่มก็เรียก <PageHeader> เหมือนเดิม (API ไม่เปลี่ยน)
 * — title ส่งผ่าน context (string เสถียร ไม่ลูป), action ยิงเข้า DOM slot ด้วย portal (ReactNode เปลี่ยน identity ทุกเรนเดอร์ ใส่ state ตรงๆ จะลูป)
 */
export interface TopbarValue {
  /** ตั้งชื่อหน้าบน Topbar — null = กลับไปใช้ชื่อจากเมนู (NAV) ตาม path */
  setTitle: (title: string | null) => void
  /** DOM node ฝั่งขวาของ Topbar สำหรับ portal ปุ่มเฉพาะหน้าเข้าไป */
  actionSlot: HTMLElement | null
}

export const TopbarContext = createContext<TopbarValue>({ setTitle: () => {}, actionSlot: null })

export const useTopbar = () => useContext(TopbarContext)
