import type { NotificationRow } from '../lib/notifications-context'

/** Pronista §System Enhancements — แถวแจ้งเตือน 1 รายการ ใช้ร่วมกันระหว่าง NotificationCenter (bell dropdown) กับหน้า "การแจ้งเตือน" เต็มหน้า */
export function NotificationRowItem({ n, onClick }: { n: NotificationRow; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex items-start gap-2.5 px-4 py-3 hover:bg-hover focus-visible:outline-hidden focus-visible:bg-hover ${n.isRead ? '' : 'bg-info-50/40'}`}
    >
      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.isRead ? 'bg-transparent' : 'bg-info-500'}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-body leading-snug whitespace-pre-line">{n.message}</span>
        <span className="block text-[11px] text-muted mt-0.5">{new Date(n.createdAt).toLocaleString('th-TH')}</span>
      </span>
    </button>
  )
}
