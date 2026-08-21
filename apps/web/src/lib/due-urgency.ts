/**
 * Pronista §Card glance-at-a-glance (แนวคิดจาก Worktray) — ระดับความเร่งด่วนจากวันครบกำหนด
 * ใช้ร่วมกันทุกที่ที่มีการ์ด/แถว Backlog เพื่อให้กฎเดียวกัน: overdue = เลยกำหนดแล้ว, soon = เหลือ ≤3 วัน, normal = ที่เหลือ (รวมงานที่เสร็จแล้ว/ไม่มีกำหนด)
 */
export type DueUrgency = 'normal' | 'soon' | 'overdue'

const bkkToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10)

// Pronista §Card glance-at-a-glance — soonDays ปรับได้ที่ตั้งค่าทั่วไป (company_config.dueSoonDays, ไม่ระบุ/undefined = ใช้ default 3)
export function dueUrgency(dueDate: string | null | undefined, isDone: boolean, soonDays = 3): DueUrgency {
  if (!dueDate || isDone) return 'normal'
  const today = bkkToday()
  if (dueDate < today) return 'overdue'
  const soonBy = new Date(Date.now() + 7 * 3_600_000 + soonDays * 86_400_000).toISOString().slice(0, 10)
  if (dueDate <= soonBy) return 'soon'
  return 'normal'
}

/** แถบสีขอบซ้ายของแถว (มุมมองตาราง/Backlog) — โชว์ระดับความเร่งด่วนโดยไม่ต้องอ่านวันที่ */
export const URGENCY_BORDER_CLASS: Record<DueUrgency, string> = {
  normal: 'border-l-4 border-l-transparent',
  soon: 'border-l-4 border-l-warning-400',
  overdue: 'border-l-4 border-l-danger-500',
}

/** พื้นหลังทั้งการ์ด (มุมมอง Kanban) — เข้มกว่าขอบเฉยๆ เห็นชัดกว่าตอนดูทีละหลายใบพร้อมกัน */
export const URGENCY_CARD_CLASS: Record<DueUrgency, string> = {
  normal: 'bg-white',
  soon: 'bg-warning-50',
  overdue: 'bg-danger-50',
}

export function checklistLabel(done: number | null | undefined, total: number | null | undefined): string | null {
  if (!total) return null
  return `☑ ${done ?? 0}/${total}`
}
