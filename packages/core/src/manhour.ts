import type { LoginPermissionCategory } from './permissions'
import { PERMISSION_CATEGORIES } from './permissions'

/**
 * Pronista §System Enhancements — Manhour/วัน แยกตาม "ประเภทผู้ใช้งาน" (staff/outsource/customer)
 * null = ยังไม่ตั้งค่า ใช้ workHourCapMinutes (เพดานรวมเดิม) เป็นค่าเริ่มต้นทั้ง 3 ประเภท — pure ล้วน mirror pattern ของ subscription.ts/permissions.ts
 * ยังไม่มีจุดไหน consume ค่านี้ (รอฟีเจอร์ Workload ในเฟสถัดไป) — งานรอบนี้แค่เก็บ+validate ค่า
 */
export type ManhourUserType = LoginPermissionCategory

export function resolveManhourMinutesPerDay(
  raw: Partial<Record<ManhourUserType, number>> | null | undefined,
  fallbackMinutes: number,
): Record<ManhourUserType, number> {
  const categories = PERMISSION_CATEGORIES.filter((c): c is ManhourUserType => c !== 'membership')
  return Object.fromEntries(categories.map((cat) => [cat, raw?.[cat] ?? fallbackMinutes])) as Record<ManhourUserType, number>
}

export function validateManhourMinutesPerDay(value: Record<ManhourUserType, number>): { ok: true } | { ok: false; error: string } {
  const categories = PERMISSION_CATEGORIES.filter((c): c is ManhourUserType => c !== 'membership')
  for (const cat of categories) {
    const v = value[cat]
    if (!Number.isInteger(v) || v < 60 || v > 1440) return { ok: false, error: `Manhour/วัน ของ "${cat}" ต้องเป็นจำนวนเต็มนาที ระหว่าง 60-1440` }
  }
  return { ok: true }
}
