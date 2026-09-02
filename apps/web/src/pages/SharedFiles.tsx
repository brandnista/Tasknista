/** Pronista §Menu Restructure (2026-08-28) — แยกจากแท็บเดิมใน MyTasks.tsx ออกมาเป็น sub-menu ของ "งานของฉัน" (ดู Layout.tsx NAV)
 * Pronista §My Note shared split (2026-09-01) — เคยลองเอาบันทึกที่แชร์มารวมไว้หน้านี้ด้วย พี่แจ้งว่าไม่สวย/ไม่ใช่ที่ที่ควรอยู่ —
 * ย้ายกลับไปอยู่ที่เมนู "My Note" เป็นแท็บในบอร์ดฝั่งขวาแทน (ดู MyNoteTab.tsx) หน้านี้จึงเหลือแค่ไฟล์ที่แชร์กับฉันเหมือนเดิม
 */
import { MyFilesTab } from '../components/MyFilesTab'
import { PageHeader } from '../components/PageHeader'

export function SharedFilesPage() {
  return (
    <>
      <PageHeader title="แชร์กับฉัน" />
      <div className="p-4 sm:p-6">
        <MyFilesTab root="shared" />
      </div>
    </>
  )
}
