/** Pronista §2.12 — สถานะ task หลัก 4 ค่า ใช้ทุกโปรเจกต์ (Product/Project เหมือนกัน) */
/** Pronista §Business Rules Workflow (เฟส B, 2026-09-15) — เพิ่ม 'rejected'/'cancelled' เป็นสถานะข้อยกเว้น (เข้าถึงได้เฉพาะผ่าน action ปุ่มเฉพาะ ไม่ใช่ dropdown อิสระ — ดู FREE_EDIT_TASK_STATUS_ORDER ด้านล่าง) */
export type TaskStatus = 'non_start' | 'on_processing' | 'waiting_for_test' | 'done' | 'rejected' | 'cancelled'

export const TASK_STATUS_ORDER: TaskStatus[] = ['non_start', 'on_processing', 'waiting_for_test', 'done', 'rejected', 'cancelled']

// dropdown อิสระ (canEditStatusFreely ใน TaskDetail.tsx) เลือกได้แค่ 4 ค่านี้ — rejected/cancelled ต้องผ่านปุ่ม "ยกเลิกงาน"/ระบบตั้งเองตอนปฏิเสธเท่านั้น (บังคับเหตุผลเสมอ)
export const FREE_EDIT_TASK_STATUS_ORDER: TaskStatus[] = ['non_start', 'on_processing', 'waiting_for_test', 'done']

// Kanban (StatusKanban.tsx) แสดงแค่ 4 คอลัมน์หลักเหมือนเดิม — rejected/cancelled เป็นสถานะข้อยกเว้น ไม่ใช่ขั้นตอนงานปกติ
export const KANBAN_TASK_STATUS_ORDER: TaskStatus[] = ['non_start', 'on_processing', 'waiting_for_test', 'done']

// mirror ของ INACTIVE_TASK_STATUSES ฝั่ง backend (packages/db/src/schema.ts) — ไม่ import ข้าม @seedoffice/db มาฝั่งเว็บตรงๆ (ดึง dependency ฝั่ง server เข้า bundle โดยไม่จำเป็น)
// ใช้แทนเช็ค `status !== 'done'` ในจุดที่หมายถึง "งานที่ยังต้อง action อยู่" (overdue/pending widgets) — งานที่ถูกปฏิเสธ/ยกเลิกไม่ควรนับเป็นงานค้าง
export const INACTIVE_TASK_STATUSES: TaskStatus[] = ['done', 'rejected', 'cancelled']
export const isInactiveStatus = (s: TaskStatus | null | undefined): boolean => !!s && (INACTIVE_TASK_STATUSES as TaskStatus[]).includes(s)

// Pronista §Back to Basic (ต่อยอด) — เปลี่ยนแค่ label ที่โชว์ ("Waiting for Review") ไม่แตะ enum value เดิม (waiting_for_test) กัน migration/ผลกระทบข้อมูลเดิม
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  non_start: 'Non Start',
  on_processing: 'On Processing',
  waiting_for_test: 'Waiting for Review',
  done: 'Done',
  rejected: 'ถูกปฏิเสธ',
  cancelled: 'ยกเลิกแล้ว',
}

export const TASK_STATUS_DOT: Record<TaskStatus, string> = {
  non_start: 'bg-border',
  on_processing: 'bg-info-500',
  waiting_for_test: 'bg-warning-400',
  done: 'bg-success-500',
  rejected: 'bg-danger-500',
  cancelled: 'bg-muted',
}

export const TASK_STATUS_BADGE: Record<TaskStatus, string> = {
  non_start: 'bg-divider text-soft',
  on_processing: 'bg-info-50 text-info-700',
  waiting_for_test: 'bg-warning-100 text-warning-700',
  done: 'bg-success-100 text-success-700',
  rejected: 'bg-danger-100 text-danger-700',
  cancelled: 'bg-divider text-muted',
}
