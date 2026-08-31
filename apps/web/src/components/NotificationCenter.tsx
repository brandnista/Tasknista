/* Hallmark · component: notification-bell · genre: modern-minimal · theme: project tokens (Pronista design system)
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: pass (existing token pairs already in production use)
 */
import { Bell } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { notificationHref } from '../lib/notification-href'
import { useNotifications, type NotificationRow } from '../lib/notifications-context'

const MAX_ROWS = 20

/**
 * Pronista §Notification header bell (2026-08-27) — จุดเข้าถึงแจ้งเตือนทั้งหมดจากทุกหน้า
 * Pronista §Notification overhaul Batch C (2026-08-27) — อ่าน/mark ผ่าน NotificationsProvider กลาง (ไม่ fetch ของตัวเองแล้ว) กัน poll ซ้ำซ้อนกับ badge อื่นๆ
 * วางไว้ทั้งแถบหัว sidebar (desktop) และแถบบนมือถือ — ใช้ absolute right-0 top-full ยึดกับปุ่มกระดิ่ง กันล้นขอบจอมือถือด้วย max-w-[calc(100vw-2rem)]
 */
export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { rows, loadError, reload, markRead, markAllRead } = useNotifications()

  // ปิด panel ตอนคลิกนอก/กด Escape/เปลี่ยนหน้า — แบบเดียวกับ SidebarProfile
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  useEffect(() => setOpen(false), [location.pathname])

  const unread = (rows ?? []).filter((r) => !r.isRead).length

  const openNotif = (n: NotificationRow) => {
    if (!n.isRead) void markRead(n.id)
    setOpen(false)
    const href = notificationHref(n)
    if (href) navigate(href)
  }

  const onMarkAllRead = async () => {
    if (unread === 0 || markingAll) return
    setMarkingAll(true)
    try {
      await markAllRead()
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="การแจ้งเตือน"
        onClick={() => setOpen((v) => !v)}
        className={`relative w-9 h-9 grid place-items-center rounded-xl transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 ${
          open ? 'bg-brand-50 text-brand-700' : 'text-dim hover:bg-hover hover:text-body'
        }`}
      >
        <Bell className="w-[18px] h-[18px]" />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 text-[10px] bg-danger-500 text-white rounded-full min-w-4 h-4 px-1 grid place-items-center leading-none ring-2 ring-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 z-50 w-80 max-w-[calc(100vw-2rem)] bg-white border border-border-subtle rounded-2xl shadow-lg so-fade-in flex flex-col max-h-[70vh]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
            <span className="font-semibold text-ink text-sm">การแจ้งเตือน</span>
            <button
              type="button"
              onClick={() => void onMarkAllRead()}
              disabled={unread === 0 || markingAll}
              className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              อ่านทั้งหมด
            </button>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-divider">
            {rows === null ? (
              <div className="py-10 text-center text-sm text-muted">กำลังโหลด...</div>
            ) : loadError ? (
              <div className="py-10 text-center text-sm">
                <div className="text-danger-600 mb-1">โหลดแจ้งเตือนไม่สำเร็จ</div>
                <button type="button" onClick={reload} className="text-brand-600 hover:underline text-xs">ลองใหม่</button>
              </div>
            ) : rows.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted">ยังไม่มีการแจ้งเตือน</div>
            ) : (
              rows.slice(0, MAX_ROWS).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  role="menuitem"
                  onClick={() => openNotif(n)}
                  className={`w-full text-left flex items-start gap-2.5 px-4 py-3 hover:bg-hover focus-visible:outline-hidden focus-visible:bg-hover ${n.isRead ? '' : 'bg-info-50/40'}`}
                >
                  <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.isRead ? 'bg-transparent' : 'bg-info-500'}`} />
                  <span className="min-w-0 flex-1">
                    {/* Pronista §Meeting Schedule Tab (2026-08-27) — แจ้งเตือนประชุมเป็นข้อความหลายบรรทัด (ชื่อ/เวลา/Agenda/ผู้เข้าร่วม) — pre-line ไม่กระทบข้อความอื่นที่เป็นบรรทัดเดียวอยู่แล้ว */}
                    <span className="block text-sm text-body leading-snug whitespace-pre-line">{n.message}</span>
                    <span className="block text-[11px] text-muted mt-0.5">{new Date(n.createdAt).toLocaleString('th-TH')}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
