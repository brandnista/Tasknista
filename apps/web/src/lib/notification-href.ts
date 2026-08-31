export interface NotificationLike {
  type: string
  taskId: string | null
  projectId: string | null
  dailyReportId: string | null
  meetingId: string | null
  chatChannelId: string | null
  memberId: string | null
  domainId: string | null
}

/** Pronista §Notification deep-link — ใช้ร่วมกันระหว่างแท็บ "แจ้งเตือน" (งานของฉัน) กับ NotificationCenter (header bell) กันแยกกฎ href สองที่ */
export function notificationHref(n: NotificationLike): string | undefined {
  // Pronista §Menu Restructure (2026-08-28) — Daily Report/การประชุม แยกเป็น sub-menu คนละ route ของตัวเองแล้ว (เดิมเป็น ?tab= บนหน้าเดียว)
  if (n.dailyReportId) return `/my-tasks/daily-report?report=${n.dailyReportId}`
  if (n.type === 'meeting_scheduled' || n.type === 'meeting_updated' || n.type === 'meeting_cancelled' || n.type === 'meeting_reminder')
    return n.meetingId ? `/my-tasks/meetings?meeting=${n.meetingId}` : '/my-tasks/meetings'
  if (n.type === 'chat_mention' || n.type === 'chat_message') return n.chatChannelId ? `/team?tab=chat&channel=${n.chatChannelId}` : '/team'
  if (n.type === 'member_expiry_reminder') return n.memberId ? `/members/${n.memberId}` : undefined
  if (n.type === 'domain_expiry_reminder' || n.type === 'domain_expired') return '/admin/domains'
  if (n.projectId) return n.taskId ? `/projects/${n.projectId}?task=${n.taskId}` : `/projects/${n.projectId}`
  return undefined
}
