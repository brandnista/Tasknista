import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import type { NotificationLike } from './notification-href'

export interface NotificationRow extends NotificationLike {
  id: string
  message: string
  isRead: boolean
  createdAt: number
}

interface NotificationsValue {
  rows: NotificationRow[] | null
  loadError: boolean
  reload: () => void
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  /** Pronista §Notification overhaul (2026-08-27) — เปิดห้องแชทแล้ว mark แจ้งเตือนของห้องนั้นอ่านทันที (chat_mention/chat_message) กัน badge เมนู "ทีม" ค้าง */
  markChannelRead: (channelId: string) => Promise<void>
  /** Pronista §My Note badge (2026-09-01) — เปิดแท็บ/หน้าที่มี badge เฉพาะประเภทแล้ว mark อ่านทั้งประเภทนั้น (เช่น เปิดแท็บ "บอร์ดที่แชร์กับฉัน" → mark note_shared ทั้งหมดอ่าน) */
  markTypeRead: (type: string) => Promise<void>
}

const NotificationsContext = createContext<NotificationsValue>({
  rows: null,
  loadError: false,
  reload: () => {},
  markRead: async () => {},
  markAllRead: async () => {},
  markChannelRead: async () => {},
  markTypeRead: async () => {},
})

const POLL_MS = 30_000

/**
 * Pronista §Notification overhaul (2026-08-27) — Batch C: จุดโหลด/สถานะแจ้งเตือนกลางจุดเดียวของทั้งแอป
 * เดิม NotificationCenter (header bell) + NotificationBell (badge เมนู "งานของฉัน"/"ทีม") ต่างคน fetch /api/notifications เอง (poll ซ้ำ 3 รอบพร้อมกันทุก 45s)
 * ตอนนี้ fetch ครั้งเดียวจุดนี้ที่เดียว แล้วแชร์ state ผ่าน context — mark read จากที่ไหนก็ตาม (bell dropdown, เปิดห้องแชท) อัปเดตทุกจุดที่ใช้ context นี้ทันที ไม่ค้าง
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<NotificationRow[] | null>(null)
  const [loadError, setLoadError] = useState(false)

  const reload = useCallback(() => {
    api
      .get<NotificationRow[]>('/api/notifications')
      .then((data) => { setRows(data); setLoadError(false) })
      .catch(() => setLoadError(true))
  }, [])

  useEffect(() => {
    reload()
    const id = setInterval(reload, POLL_MS)
    return () => clearInterval(id)
  }, [reload])

  const markRead = useCallback(async (id: string) => {
    setRows((prev) => prev?.map((r) => (r.id === id ? { ...r, isRead: true } : r)) ?? prev)
    await api.post(`/api/notifications/${id}/read`)
  }, [])

  const markAllRead = useCallback(async () => {
    setRows((prev) => prev?.map((r) => ({ ...r, isRead: true })) ?? prev)
    await api.post('/api/notifications/mark-all-read')
  }, [])

  const markChannelRead = useCallback(async (channelId: string) => {
    setRows((prev) => prev?.map((r) => (r.chatChannelId === channelId ? { ...r, isRead: true } : r)) ?? prev)
    await api.post(`/api/chat/channels/${channelId}/read`)
  }, [])

  const markTypeRead = useCallback(async (type: string) => {
    setRows((prev) => prev?.map((r) => (r.type === type ? { ...r, isRead: true } : r)) ?? prev)
    await api.post('/api/notifications/mark-type-read', { type })
  }, [])

  return (
    <NotificationsContext.Provider value={{ rows, loadError, reload, markRead, markAllRead, markChannelRead, markTypeRead }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export const useNotifications = () => useContext(NotificationsContext)
