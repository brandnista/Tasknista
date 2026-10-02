import { Check, Loader2 } from 'lucide-react'

/**
 * Pronista §Save button (2026-10-02) — แถบปุ่ม "บันทึก" ท้ายหน้าแก้ข้อมูล (พนักงาน/พาร์ทเนอร์/ลูกค้า/สมาชิก/ตั้งค่า)
 * ติดขอบล่างของจอ เห็นตลอดแม้ฟอร์มยาว · ปุ่มกดได้เฉพาะเมื่อมีการแก้ไข · ผลบันทึก (สำเร็จ/ผิดพลาด) แจ้งผ่าน toast/popup ที่หน้าเรียกใช้
 */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  inline = false,
}: {
  dirty: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  /** inline = วางในการ์ดเล็กๆ (ไม่ติดขอบล่างจอ) */
  inline?: boolean
}) {
  return (
    <div
      className={
        inline
          ? "pt-3 border-t border-divider flex items-center gap-3 flex-wrap"
          : "sticky bottom-0 z-10 -mx-3 sm:-mx-6 px-3 sm:px-6 py-3 bg-white/95 backdrop-blur border-t border-border-subtle flex items-center gap-3 flex-wrap"
      }
    >
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || saving}
        className="inline-flex items-center gap-2 text-sm bg-brand-600 hover:bg-brand-700 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 text-white px-4 py-2 rounded-lg transition-all focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-brand-200"
      >
        {saving ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" /> กำลังบันทึก…
          </>
        ) : (
          <>
            <Check className="w-4 h-4" /> บันทึก
          </>
        )}
      </button>
      {dirty && !saving && (
        <button type="button" onClick={onDiscard} className="text-sm text-muted hover:text-ink">
          ยกเลิกการแก้ไข
        </button>
      )}
      <span className={`text-xs ${dirty ? 'text-warning-700' : 'text-muted'}`}>{dirty ? 'มีการแก้ไขที่ยังไม่ได้บันทึก' : 'ยังไม่มีการแก้ไข'}</span>
    </div>
  )
}
