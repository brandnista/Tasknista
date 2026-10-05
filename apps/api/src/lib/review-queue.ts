import { tasks } from '@seedoffice/db'
import { and, eq, isNull, or } from 'drizzle-orm'

/**
 * Pronista §Review queue fix (2026-10-05) — เงื่อนไข "งานที่รอฉันตรวจ" (Waiting for Review) ใช้ร่วมกันของเมนู "งานรอตรวจ" / ตัวเลข badge / การมาร์คว่าเห็นแล้ว
 * ผู้ตรวจจริง = reviewerId ?? ผู้จ่ายงาน (assignedBy) ตรงกับกฎอนุมัติ/ตีกลับ — งานเก่าที่ส่งตรวจก่อนระบบตั้งผู้ตรวจให้อัตโนมัติ (reviewerId ว่าง) จะโผล่ในคิวของผู้จ่ายงาน
 */
export const waitingForMyReview = (meId: string) =>
  and(or(eq(tasks.reviewerId, meId), and(isNull(tasks.reviewerId), eq(tasks.assignedBy, meId))), eq(tasks.status, 'waiting_for_test'))
