/**
 * Pronista §Membership — จัดการสมาชิก (ธุรกิจใหม่แยกจากงานโปรเจกต์ลูกค้าเดิม)
 * โครงหน้า+routing (Batch B) — รายการสมาชิกจริงจะเติมใน Batch F
 */
import { PageHeader } from '../components/PageHeader'

export function MembersPage() {
  return (
    <>
      <PageHeader title="จัดการสมาชิก" />
      <div className="p-3 sm:p-6">
        <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-muted">
          อยู่ระหว่างพัฒนา — รายการสมาชิกจะแสดงที่นี่
        </div>
      </div>
    </>
  )
}
