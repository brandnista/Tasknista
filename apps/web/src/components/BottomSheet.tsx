/**
 * Pronista §Mobile Responsive Refactor (2026-09-02) — Bottom Sheet ทั่วไป (ไม่มี pattern นี้ในระบบมาก่อน สร้างใหม่)
 * ใช้ครอบ Filter บนมือถือแทน select แถวเดิม (สเปก §7): backdrop + panel เลื่อนขึ้นจากขอบล่าง, กัน safe-area, มีปุ่ม "ล้าง"/"ใช้ Filter" ติดล่างเสมอ
 */
import { X } from 'lucide-react'
import { useEffect } from 'react'

export function BottomSheet({
  title,
  onClose,
  onClear,
  onApply,
  applyLabel = 'ใช้ Filter',
  children,
}: {
  title: string
  onClose: () => void
  /** ไม่ส่ง = ไม่โชว์ปุ่ม "ล้าง Filter" */
  onClear?: () => void
  onApply: () => void
  applyLabel?: string
  children: React.ReactNode
}) {
  // กัน background เลื่อนตามนิ้วขณะ sheet เปิดอยู่ (เหมือน mobile drawer)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <div className="fixed inset-0 z-50">
      <div onClick={onClose} className="absolute inset-0 bg-ink/40" />
      <div className="absolute inset-x-0 bottom-0 bg-white rounded-t-2xl shadow-2xl max-h-[80vh] flex flex-col pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border-subtle shrink-0">
          <span className="font-semibold text-ink text-sm">{title}</span>
          <button onClick={onClose} aria-label="ปิด" className="p-2 -mr-2 rounded-lg text-muted hover:bg-hover min-w-11 min-h-11 grid place-items-center">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">{children}</div>
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border-subtle shrink-0">
          {onClear && (
            <button onClick={onClear} className="text-sm font-medium text-soft hover:bg-hover px-4 py-2.5 rounded-lg min-h-11">ล้าง Filter</button>
          )}
          <button onClick={onApply} className="flex-1 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 px-4 py-2.5 rounded-lg min-h-11">{applyLabel}</button>
        </div>
      </div>
    </div>
  )
}
