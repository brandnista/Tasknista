import { useNotifications } from '../lib/notifications-context'

/** Pronista §My Work/Notification — badge จำนวนแจ้งเตือนที่ยังไม่อ่าน โผล่ข้างเมนู sidebar — อ่านจาก NotificationsProvider กลาง (ไม่ poll ของตัวเองแล้ว)
 * `types` = นับเฉพาะประเภทที่ระบุ (เช่น เมนู "ทีม" นับเฉพาะแจ้งเตือนแชท/ประชุม), `excludeTypes` = นับทุกประเภทยกเว้นที่ระบุ (กันนับซ้ำกับเมนูอื่นที่มี badge ของตัวเองแล้ว) — ไม่ใส่ทั้งคู่ = นับทุกประเภท */
export function NotificationBell({ types, excludeTypes }: { types?: readonly string[]; excludeTypes?: ReadonlySet<string> } = {}) {
  const { rows } = useNotifications()
  const unread = (rows ?? []).filter((r) => !r.isRead && (!types || types.includes(r.type)) && (!excludeTypes || !excludeTypes.has(r.type))).length

  if (unread === 0) return null
  return (
    <span className="ml-auto text-[10px] bg-danger-500 text-white rounded-full min-w-4 h-4 px-1 grid place-items-center leading-none">
      {unread > 9 ? '9+' : unread}
    </span>
  )
}
