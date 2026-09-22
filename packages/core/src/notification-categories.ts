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
      'task_updated',
      // Pronista §Notification categories fix (2026-09-11) — เดิม 3 ตัวนี้ก็ไม่อยู่ในหมวดไหนเลยเหมือนกัน (ตกหล่นตั้งแต่เพิ่ม type ตอน §Assign/Accept audit 2026-09-03)
      'task_accepted',
      'task_rejected',
      'task_reassigned',
      // Pronista §Business Rules Workflow (เฟส B, 2026-09-15)
      'task_cancelled',
      // Pronista §My Tasks menu badges (2026-09-18)
      'task_review_requested',
    ],
  },
  { key: 'chat_mention', label: 'มีคนแท็กฉันในแชท', types: ['chat_mention'] },
  { key: 'chat_message', label: 'มีข้อความใหม่ในแชท', types: ['chat_message'] },
  { key: 'meeting', label: 'ประชุม', types: ['meeting_scheduled', 'meeting_updated', 'meeting_cancelled', 'meeting_reminder'] },
  { key: 'daily_report', label: 'Daily Report', types: ['daily_report_submitted', 'daily_report_commented', 'daily_report_reviewed'] },
  // Pronista §Leave Request (2026-09-22, Phase 1)
  { key: 'leave', label: 'การลา', types: ['leave_requested', 'leave_approved', 'leave_rejected'] },
  // Pronista §Notification categories wording (2026-09-14) — เดิมยัดของหมดอายุ 4 อย่างรวมกันไว้ใน "ระบบ/อื่นๆ" กลุ่มเดียว มองไม่ออกว่าข้างในมีอะไรบ้าง
  // แยกออกมาให้เห็นชัดเจนทีละประเภท (เปิด/ปิดแยกกันได้ด้วย) เหลือ "อื่นๆ" ไว้เฉพาะของที่ไม่เข้าพวกจริงๆ
  { key: 'project_expiry', label: 'โปรเจกต์ใกล้หมดอายุบริการ', types: ['expiry_reminder'] },
  { key: 'domain_expiry', label: 'โดเมนใกล้หมดอายุ/หมดอายุแล้ว', types: ['domain_expiry_reminder', 'domain_expired'] },
  { key: 'sellnista_expiry', label: 'Sellnista Subscription ใกล้หมดอายุ/หมดอายุแล้ว', types: ['sellnista_expiry_reminder', 'sellnista_expired'] },
  { key: 'member_expiry', label: 'สมาชิกใกล้หมดอายุ', types: ['member_expiry_reminder'] },
  {
    key: 'system',
    label: 'อื่นๆ',
    types: [
      'project_member_added',
      'note_shared',
      // Pronista §Notification categories fix (2026-09-11) — เดิม vault_accessed ไม่อยู่ในหมวดไหนเลย ทำให้ filter ตามหมวด/หน้าตั้งค่าปิด-เปิดแจ้งเตือนมองไม่เห็นเลย
      'vault_accessed',
    ],
  },
] as const
