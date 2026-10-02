import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
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
  /** (2026-09-25) เข้าเมนู "งานรอตรวจ" → ถือว่าเห็นงานรอตรวจทั้งหมดแล้ว badge เป็น 0 ทันที */
  markReviewSeen: () => Promise<void>
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
  markReviewSeen: async () => {},
})

// Pronista §D1 row-read quota (2026-10-02) — เดิมทุกแท็บดึงรายการแจ้งเตือน (50 แถว + join) + รายการงานรอตรวจทุก 30 วินาที แม้แท็บถูกซ่อนอยู่
// ตอนนี้: ถามแบบเบา (/api/notifications/stamp) ทุก 60 วินาที เฉพาะตอนแท็บมองเห็น · ดึงรายการเต็มก็ต่อเมื่อมีแจ้งเตือนใหม่ หรือครบรอบรีเฟรชเต็ม (กันสถานะอ่านแล้วจากอุปกรณ์อื่นค้าง)
const POLL_MS = 60_000
const FULL_REFRESH_MS = 5 * 60_000
const MIN_GAP_MS = 5_000

interface NotificationStamp {
  latest: string | null
  review: number
}

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

  const lastLatest = useRef<string | null>(null)
  const lastFullAt = useRef(0)
  const lastRefreshAt = useRef(0)

  const reload = useCallback(() => {
    api
      .get<NotificationRow[]>('/api/notifications')
      .then((data) => { lastFullAt.current = Date.now(); setRows(data); setLoadError(false) })
      .catch(() => setLoadError(true))
  }, [])

  // Pronista §PRO-DEF-0002 (2026-09-25) — เลข badge งานรอตรวจนับจากงานจริง (ไม่ใช่นับ unread notification) กันเลขเพี้ยนจาก list จริง
  // (2026-09-25 follow-up) นับเฉพาะงานที่ยังไม่เคยเห็นในเมนู "งานรอตรวจ" หรือถูกส่งตรวจใหม่หลังเห็นครั้งล่าสุด — เข้าเมนูแล้ว (markReviewSeen) เลขลดทันที
  // (2026-10-02) นับที่ server แล้วส่งมาใน /api/notifications/stamp (นิยามเดียวกัน) แทนดึงรายการงานรอตรวจทั้งก้อนมานับเอง
  const reloadReviewCount = useCallback(() => {
    api
      .get<NotificationStamp>('/api/notifications/stamp')
      .then((s) => setReviewCount(s.review))
      .catch(() => {})
  }, [])

  // ถามแบบเบาก่อน — ดึงรายการแจ้งเตือนเต็มเฉพาะเมื่อมีแจ้งเตือนใหม่ (latest เปลี่ยน) / ยังไม่เคยโหลด / ครบรอบรีเฟรชเต็ม
  const refresh = useCallback(() => {
    lastRefreshAt.current = Date.now()
    api
      .get<NotificationStamp>('/api/notifications/stamp')
      .then((s) => {
        setReviewCount(s.review)
        const changed = s.latest !== lastLatest.current
        lastLatest.current = s.latest
        if (changed || lastFullAt.current === 0 || Date.now() - lastFullAt.current > FULL_REFRESH_MS) reload()
      })
      .catch(() => setLoadError(true))
  }, [reload])

  const markReviewSeen = useCallback(async () => {
    setReviewCount(0)
    try {
      await api.post('/api/tasks/pending-review/seen')
    } finally {
      reloadReviewCount()
    }
  }, [reloadReviewCount])

  useEffect(() => {
    refresh()
    // แท็บถูกซ่อน (สลับไปแท็บอื่น/ย่อหน้าต่าง) ไม่ต้องถาม — กลับมามองเห็นเมื่อไหร่ค่อยถามทันที (effect ด้านล่าง)
    const id = setInterval(() => { if (!document.hidden) refresh() }, POLL_MS)
    return () => clearInterval(id)
  }, [refresh])

  // เปลี่ยนหน้า (เช่น อนุมัติ/ตีกลับ task ที่หน้า detail แล้วย้อนกลับ) → รีเฟรชเลขทันที ไม่ต้องรอ poll รอบถัดไป
  useEffect(() => {
    reloadReviewCount()
  }, [location.pathname, reloadReviewCount])

  // กลับมาโฟกัสแท็บ/หน้าต่าง (เช่นสลับไปแท็บอื่นอนุมัติ task แล้วกลับมา) → รีเฟรชเลขด้วยเช่นกัน
  // (2026-10-02) focus + visibilitychange ยิงพร้อมกันได้ในการกลับมาครั้งเดียว — กันถามซ้ำด้วยช่วงห่างขั้นต่ำ 5 วินาที
  useEffect(() => {
    const onBack = () => {
      if (document.hidden || Date.now() - lastRefreshAt.current < MIN_GAP_MS) return
      refresh()
    }
    window.addEventListener('focus', onBack)
    document.addEventListener('visibilitychange', onBack)
    return () => {
      window.removeEventListener('focus', onBack)
      document.removeEventListener('visibilitychange', onBack)
    }
  }, [refresh])

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
    <NotificationsContext.Provider value={{ rows, loadError, reload, markRead, markAllRead, markChannelRead, markTypeRead, reviewCount, reloadReviewCount, markReviewSeen }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export const useNotifications = () => useContext(NotificationsContext)
