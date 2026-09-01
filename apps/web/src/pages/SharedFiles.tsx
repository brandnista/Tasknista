/** Pronista §Menu Restructure (2026-08-28) — แยกจากแท็บเดิมใน MyTasks.tsx ออกมาเป็น sub-menu ของ "งานของฉัน" (ดู Layout.tsx NAV)
 * Pronista §My Note shared split (2026-09-01) — เพิ่มบันทึกที่แชร์กันไปมา (เดิมปนอยู่บนบอร์ด My Note) มารวมอยู่หน้าเดียวกับไฟล์ที่แชร์กับฉัน
 */
import { MyFilesTab } from '../components/MyFilesTab'
import { PageHeader } from '../components/PageHeader'
import { SharedNotesSection } from '../components/SharedNotesSection'

export function SharedFilesPage() {
  return (
    <>
      <PageHeader title="แชร์กับฉัน" />
      <div className="p-3 sm:p-6 space-y-6">
        <SharedNotesSection />
        <MyFilesTab root="shared" />
      </div>
    </>
  )
}
