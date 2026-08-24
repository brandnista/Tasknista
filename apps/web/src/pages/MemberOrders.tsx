/**
 * Pronista §Membership — รายการสั่งซื้อค่าสมาชิก (Submenu ใน "จัดการสมาชิก")
 * โครงหน้า+routing (Batch B) — ตารางจริงจะเติมใน Batch F
 */
import { PageHeader } from '../components/PageHeader'

export function MemberOrdersPage() {
  return (
    <>
      <PageHeader title="รายการสั่งซื้อ" />
      <div className="p-3 sm:p-6">
        <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-muted">
          อยู่ระหว่างพัฒนา — รายการสั่งซื้อค่าสมาชิกจะแสดงที่นี่
        </div>
      </div>
    </>
  )
}
