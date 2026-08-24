/**
 * Pronista §Membership — ตั้งค่าค่าธรรมเนียมตามประเภท + ราคาตามขนาดองค์กร (Submenu ใน "จัดการสมาชิก")
 * โครงหน้า+routing (Batch B) — ฟอร์มตั้งค่าจริงจะเติมใน Batch F
 */
import { PageHeader } from '../components/PageHeader'

export function MemberSettingsPage() {
  return (
    <>
      <PageHeader title="ตั้งค่าสมาชิก" />
      <div className="p-3 sm:p-6">
        <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-muted">
          อยู่ระหว่างพัฒนา — ตั้งค่าค่าธรรมเนียมตามประเภทและขนาดองค์กรจะแสดงที่นี่
        </div>
      </div>
    </>
  )
}
