import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { api } from './api'
import type { NotificationLike } from './notification-href'

export interface NotificationRow extends NotificationLike {
  id: string
  message: string
  isRead: boolean
  createdAt: number
  // Pronista §PRD badge fix (2026-09-22) — สถานะปัจจุบันของ task ที่แจ้งเตือนอ้างถึง (join จาก backend) — null ถ้าแจ้งเตือนไม่ผูก task หรือ task ถูกลบไปแล้ว
  taskAssigneeId: string | null
  taskDispatchedAt: string | number | null
  // Pronista §Notification Badge Audit เฟส 6b (2026-09-24) — ข้อมูลสด join เพิ่มให้เช็ค relevance ของแจ้งเตือนกลุ่มงานรอตรวจ/งานที่จ่ายให้คนอื่น/การประชุม/การลา (กัน ghost badge — badge ค้างทั้งที่หน้าจริงไม่มีข้อมูล)
  taskStatus: string | null
  taskReviewerId: string | null
  taskAssignedBy: string | null
  meetingStartAt: string | number | null
  leaveRequestStatus: 'pending' | 'approved' | 'rejected' | 'withdrawn' | null
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
  /** Pronista §PRO-DEF-0002 (2026-09-25) — จำนวน task จริงใน GET /api/tasks/pending-review (เหมือนที่หน้า "งานรอตรวจ" list ใช้) แยกจาก unread notification เพราะเข้าเพจแล้ว mark อ่านทันที + reviewer=assigner เดียวกันไม่มีแจ้งเตือนส่งเลย ทำให้ badge เดิมนับแจ้งเตือนไม่ตรงกับจำนวนงานจริง */
  reviewCount: number
  reloadReviewCount: () => void
}

const NotificationsContext = createContext<NotificationsValue>({
  rows: null,
  loadError: false,
  reload: () => {},
  markRead: async () => {},
  markAllRead: async () => {},
  markChannelRead: async () => {},
  markTypeRead: async () => {},
  reviewCount: 0,
  reloadReviewCount: () => {},
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
  const [reviewCount, setReviewCount] = useState(0)
  // Pronista §PRO-DEF-0002 (2026-09-25) — NotificationsProvider ถูก mount อยู่ใต้ Router อยู่แล้ว (เป็นลูกของ Layout) เลยเรียก useLocation() ตรงนี้ได้ ใช้เป็นสัญญาณ "เปลี่ยนหน้า" รีเฟรชเลข badge งานรอตรวจให้สดหลังอนุมัติ/ตีกลับ task แล้วเปลี่ยนหน้า
  const location = useLocation()

  const reload = useCallback(() => {
    api
      .get<NotificationRow[]>('/api/notifications')
      .then((data) => { setRows(data); setLoadError(false) })
      .catch(() => setLoadError(true))
  }, [])

  // Pronista §PRO-DEF-0002 (2026-09-25) — ดึงจาก endpoint เดียวกับ list หน้า "งานรอตรวจ" ตรงๆ (ไม่ใช่นับ unread notification) กันเลข badge เพี้ยนจาก list จริง
  const reloadReviewCount = useCallback(() => {
    api
      .get<unknown[]>('/api/tasks/pending-review')
      .then((data) => setReviewCount(data.length))
      .catch(() => {})
  }, [])

  useEffect(() => {
    reload()
    reloadReviewCount()
    const id = setInterval(() => { reload(); reloadReviewCount() }, POLL_MS)
    return () => clearInterval(id)
  }, [reload, reloadReviewCount])

  // เปลี่ยนหน้า (เช่น อนุมัติ/ตีกลับ task ที่หน้า detail แล้วย้อนกลับ) → รีเฟรชเลขทันที ไม่ต้องรอ poll รอบถัดไป
  useEffect(() => {
    reloadReviewCount()
  }, [location.pathname, reloadReviewCount])

  // กลับมาโฟกัสแท็บ/หน้าต่าง (เช่นสลับไปแท็บอื่นอนุมัติ task แล้วกลับมา) → รีเฟรชเลขด้วยเช่นกัน
  useEffect(() => {
    window.addEventListener('focus', reloadReviewCount)
    return () => window.removeEventListener('focus', reloadReviewCount)
  }, [reloadReviewCount])

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
    <NotificationsContext.Provider value={{ rows, loadError, reload, markRead, markAllRead, markChannelRead, markTypeRead, reviewCount, reloadReviewCount }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export const useNotifications = () => useContext(NotificationsContext)
