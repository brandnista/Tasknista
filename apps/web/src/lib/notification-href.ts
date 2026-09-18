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
  if (n.type === 'note_shared') return '/my-tasks/notes'
  // Pronista §My Tasks menu badges (2026-09-18) — แจ้งเตือนผู้ตรวจ พาไปหน้า "งานรอตรวจ" ตรงๆ (คนละหน้ากับ task_submitted ที่ไปหาผู้จ่ายงาน — ตกไป fallback taskId ด้านล่างตามเดิม)
  if (n.type === 'task_review_requested') return '/my-tasks/review'
  if (n.type === 'domain_expiry_reminder' || n.type === 'domain_expired') return '/admin/domains'
  if (n.type === 'sellnista_expiry_reminder' || n.type === 'sellnista_expired') return '/admin/sellnista'
  // Pronista §Notification href fix (2026-09-11) — vault_accessed ไม่มี taskId/projectId/... เลย ตกไปที่ generic fallback ล่างสุดแล้วได้ undefined คลิกแล้วไม่ไปไหนเลย
  if (n.type === 'vault_accessed') return '/vault'
  if (n.projectId) return n.taskId ? `/projects/${n.projectId}?task=${n.taskId}` : `/projects/${n.projectId}`
  // (2026-09-16 bug fix) — งานที่ไม่ผูกโปรเจกต์ (คีย์ตรงใน Workspace) มี taskId แต่ไม่มี projectId เลย เดิมตกไปถึงตรงนี้แล้วได้ undefined
  // คลิกแจ้งเตือนแล้วไม่ไปไหนเลย ทั้งที่ /tasks/:id เข้าได้ตรงๆ อยู่แล้วไม่ต้องพึ่ง projectId (route แยกต่างหาก ไม่ได้ซ้อนอยู่ใต้ /projects)
  if (n.taskId) return `/tasks/${n.taskId}`
  return undefined
}
