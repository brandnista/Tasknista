/**
 * Pronista §Notification overhaul (2026-08-27) — จับ 20 ประเภทแจ้งเตือนดิบให้เหลือ 6 กลุ่มให้ผู้ใช้เห็นในหน้าตั้งค่า
 * ผู้ใช้ปิด/เปิดเป็นกลุ่ม (users.notificationPrefs เก็บ "ประเภทดิบที่ปิด" — ปิดทั้งกลุ่ม = เก็บทุก type ในกลุ่มนั้นลง array)
 */
export interface NotificationCategory {
  key: string
  label: string
  types: readonly string[]
}

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  {
    key: 'task',
    label: 'งาน',
    types: [
      'subtask_assigned',
      'subtask_completed',
      'task_dispatched',
      'task_submitted',
      'task_approved',
      'task_bounced',
      'task_recalled',
      'task_commented',
      'task_overdue_reminder',
      'guest_item_created',
    ],
  },
  { key: 'chat_mention', label: 'มีคนแท็กฉันในแชท', types: ['chat_mention'] },
  { key: 'chat_message', label: 'มีข้อความใหม่ในแชท', types: ['chat_message'] },
  { key: 'meeting', label: 'ประชุม', types: ['meeting_scheduled', 'meeting_updated', 'meeting_cancelled', 'meeting_reminder'] },
  { key: 'daily_report', label: 'Daily Report', types: ['daily_report_submitted', 'daily_report_commented', 'daily_report_reviewed'] },
  {
    key: 'system',
    label: 'ระบบ/อื่นๆ',
    types: ['expiry_reminder', 'member_expiry_reminder', 'project_member_added', 'domain_expiry_reminder', 'domain_expired', 'note_shared'],
  },
] as const
