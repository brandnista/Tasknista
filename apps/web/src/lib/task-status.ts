/** Pronista §2.12 — สถานะ task ตายตัว 4 ค่า ใช้ทุกโปรเจกต์ (Product/Project เหมือนกัน) */
export type TaskStatus = 'non_start' | 'on_processing' | 'waiting_for_test' | 'done'

export const TASK_STATUS_ORDER: TaskStatus[] = ['non_start', 'on_processing', 'waiting_for_test', 'done']

// Pronista §Back to Basic (ต่อยอด) — เปลี่ยนแค่ label ที่โชว์ ("Waiting for Review") ไม่แตะ enum value เดิม (waiting_for_test) กัน migration/ผลกระทบข้อมูลเดิม
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  non_start: 'Non Start',
  on_processing: 'On Processing',
  waiting_for_test: 'Waiting for Review',
  done: 'Done',
}

export const TASK_STATUS_DOT: Record<TaskStatus, string> = {
  non_start: 'bg-border',
  on_processing: 'bg-info-500',
  waiting_for_test: 'bg-warning-400',
  done: 'bg-success-500',
}

export const TASK_STATUS_BADGE: Record<TaskStatus, string> = {
  non_start: 'bg-divider text-soft',
  on_processing: 'bg-info-50 text-info-700',
  waiting_for_test: 'bg-warning-100 text-warning-700',
  done: 'bg-success-100 text-success-700',
}
