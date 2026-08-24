/**
 * Pronista §Membership — ประวัติการชำระเงินค่าสมาชิก (Submenu ใน "จัดการสมาชิก")
 * โครงหน้า+routing (Batch B) — ตารางจริงจะเติมใน Batch F
 */
import { PageHeader } from '../components/PageHeader'

export function MemberPaymentsPage() {
  return (
    <>
      <PageHeader title="รายการชำระเงิน" />
      <div className="p-3 sm:p-6">
        <div className="bg-white rounded-lg shadow-xs p-8 text-center text-sm text-muted">
          อยู่ระหว่างพัฒนา — ประวัติการชำระเงินค่าสมาชิกจะแสดงที่นี่
        </div>
      </div>
    </>
  )
}
