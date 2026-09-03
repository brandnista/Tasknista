import { NOTIFICATION_CATEGORIES } from '@seedoffice/core'
import { useNavigate } from 'react-router'
import { NotificationRowItem } from '../components/NotificationRowItem'
import { PageHeader } from '../components/PageHeader'
import { DEFAULT_PAGE_SIZE, Pager } from '../components/Pager'
import { useState } from 'react'
import { notificationHref } from '../lib/notification-href'
import { useNotifications, type NotificationRow } from '../lib/notifications-context'
import { api } from '../lib/api'
import { useLoad } from '../lib/useLoad'

interface PagedNotifications { rows: NotificationRow[]; total: number }

/** Pronista §System Enhancements — เมนูหลัก "การแจ้งเตือน" แยกจาก bell dropdown เดิม (จำกัดแค่ 20 แถวล่าสุด) — ดูประวัติเต็ม + filter ตามหมวดหมู่ได้ */
export function NotificationsPage() {
  const navigate = useNavigate()
  const { markRead, markAllRead, reload: reloadUnread } = useNotifications()
  const [category, setCategory] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const { data, reload } = useLoad<PagedNotifications>(
    () => api.get(`/api/notifications?page=${page}&pageSize=${pageSize}${category === 'all' ? '' : `&category=${category}`}`),
    [page, pageSize, category],
  )
  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const unread = rows.filter((r) => !r.isRead).length

  const open = (n: NotificationRow) => {
    if (!n.isRead) {
      void markRead(n.id).then(() => { void reload(); reloadUnread() })
    }
    const href = notificationHref(n)
    if (href) navigate(href)
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <PageHeader title="การแจ้งเตือน" />
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setPage(1) }}
          className="text-sm bg-white border border-border rounded-lg px-2.5 py-1.5"
        >
          <option value="all">ทุกประเภท</option>
          {NOTIFICATION_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <button
          type="button"
          onClick={() => void markAllRead().then(() => { void reload(); reloadUnread() })}
          disabled={unread === 0}
          className="text-sm text-brand-600 hover:text-brand-700 disabled:opacity-40 disabled:cursor-not-allowed ml-auto"
        >
          อ่านทั้งหมด
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-xs overflow-hidden">
        <div className="divide-y divide-divider">
          {rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted">ยังไม่มีการแจ้งเตือน</div>
          ) : (
            rows.map((n) => <NotificationRowItem key={n.id} n={n} onClick={() => open(n)} />)
          )}
        </div>
        {total > 0 && <Pager page={page} pageSize={pageSize} total={total} unitLabel="รายการ" onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }} />}
      </div>
    </div>
  )
}
