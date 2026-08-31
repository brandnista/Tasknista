/** Pronista §Notification overhaul (2026-08-27) — "ตั้งค่าการแจ้งเตือน" เมนูย่อยของ ตั้งค่า ต่อจาก "ตั้งค่าสิทธิ์ผู้ใช้งาน" — ย้ายมาจากหน้าโปรไฟล์ (ของเดิมเคยอยู่ที่นั่น) */
import { NotificationPrefs } from '../components/NotificationPrefs'
import { PageHeader } from '../components/PageHeader'

export function AdminNotificationsPage() {
  return (
    <>
      <PageHeader title="ตั้งค่าการแจ้งเตือน" />
      <div className="max-w-2xl p-3 sm:p-6">
        <NotificationPrefs />
      </div>
    </>
  )
}
