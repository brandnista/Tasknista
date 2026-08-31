import { Menu } from 'lucide-react'
import { BangkokClock } from './BangkokClock'
import { GlobalSearch } from './GlobalSearch'
import { NotificationCenter } from './NotificationCenter'
import { TopbarProfile } from './TopbarProfile'

/**
 * Pronista §Navbar (2026-08-27) — แถบหัวกลางของแอป (แทนที่แถบ h-16 ที่เดิมแต่ละหน้าเรนเดอร์เอง + แถบโลโก้บนมือถือ)
 * ซ้าย: ปุ่มเมนู (มือถือ) + ชื่อหน้า · ขวา: ค้นหา → วันที่-เวลาไทย → กระดิ่ง → โปรไฟล์
 * สูง h-16 เท่าหัวไซด์บาร์พอดี เส้นคั่นล่างจึงลากต่อกันเป็นเส้นเดียวทั้งจอ (ดู Layout.tsx)
 * Pronista §Navbar enrichment (2026-08-27) — เดิมมีแค่กระดิ่งตัวเดียว โล่งเกินไป เพิ่มค้นหาด่วน (งาน/โปรเจกต์/เอกสาร/คนข้ามระบบ)
 * ปุ่มเพิ่มงานด่วนที่เคยเพิ่มไว้ถูกถอดออกแล้ว (พี่ขอเปลี่ยนเป็นโปรไฟล์+เวลาแทน) — ยังกด "N" เปิดได้เหมือนเดิมทุกหน้า แค่ไม่มีปุ่มให้กดที่นี่แล้ว
 * Pronista §Navbar enrichment (รอบ 2) — พี่ทักว่าปุ่มเฉพาะหน้า (เช่น "+โปรเจกต์ใหม่", ตัวกรอง, สลับมุมมอง) ไม่ควรอยู่ "เลเยอร์" เดียวกับแถบไอคอนระบบ (ค้นหา/เวลา/กระดิ่ง/โปรไฟล์)
 * เลยแยกเป็นแถบที่สอง (พื้นสีอ่อนกว่า + เส้นคั่นบน) อยู่ใต้แถบหลัก — PageHeader ยังส่ง action มาที่ slot เดิมทุกอย่าง (API ไม่เปลี่ยน) แค่ตำแหน่ง portal ย้ายมาที่นี่แทน
 * ไม่มี action ส่งมา → แถบนี้ไม่โชว์เลย (`empty:hidden` จับจาก DOM children ที่ portal เข้ามา)
 * Pronista §Navbar enrichment (รอบ 3) — พี่ขอย้ายปุ่มในแถบที่สองทั้งหมดจากฝั่งซ้ายไปฝั่งขวา (ชิดขวาเหมือนแถบไอคอนระบบด้านบน)
 */
export function Topbar({
  title,
  onOpenNav,
  actionSlotRef,
}: {
  title: string
  onOpenNav: () => void
  actionSlotRef: (el: HTMLDivElement | null) => void
}) {
  return (
    <header className="shrink-0 bg-white border-b border-border-subtle">
      <div className="h-16 flex items-center gap-2 sm:gap-3 px-3 sm:px-5 lg:px-6">
        <button
          onClick={onOpenNav}
          aria-label="เมนู"
          className="lg:hidden -ml-1 w-9 h-9 shrink-0 grid place-items-center rounded-xl text-dim hover:bg-hover hover:text-body transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="text-lg sm:text-xl font-bold text-ink truncate min-w-0">{title}</h1>
        <div className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
          <GlobalSearch />
          <BangkokClock />
          <NotificationCenter />
          <TopbarProfile />
        </div>
      </div>
      {/* ปุ่มเฉพาะหน้า — PageHeader ยิงเข้ามาด้วย portal คนละเลเยอร์กับแถบไอคอนระบบด้านบน (ว่างไว้ถ้าหน้านั้นไม่ส่ง action มา) */}
      <div ref={actionSlotRef} className="flex items-center justify-end gap-2 px-3 sm:px-5 lg:px-6 py-2.5 border-t border-border-subtle bg-hover empty:hidden" />
    </header>
  )
}
