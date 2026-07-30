import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface NotificationRow {
  id: string
  isRead: boolean
}

const POLL_MS = 45_000

/** Tasknista §My Work/Notification — badge จำนวนแจ้งเตือนที่ยังไม่อ่าน โผล่ข้างเมนู "งานของฉัน" ใน sidebar — poll เป็นระยะเหมือน timer.tsx/TeamBox.tsx (แอปนี้ไม่มี websocket) */
export function NotificationBell() {
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      api
        .get<NotificationRow[]>('/api/notifications')
        .then((rows) => { if (!cancelled) setUnread(rows.filter((r) => !r.isRead).length) })
        .catch(() => {})
    }
    load()
    const id = setInterval(load, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (unread === 0) return null
  return (
    <span className="ml-auto text-[10px] bg-danger-500 text-white rounded-full min-w-4 h-4 px-1 grid place-items-center leading-none">
      {unread > 9 ? '9+' : unread}
    </span>
  )
}
