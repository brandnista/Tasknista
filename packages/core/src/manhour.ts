import type { LoginPermissionCategory } from './permissions'
import { PERMISSION_CATEGORIES } from './permissions'

/**
 * Pronista §System Enhancements — Manhour/วัน แยกตาม "ประเภทผู้ใช้งาน" (staff/outsource/customer)
 * §Workload (2026-09-04) — แยกเพิ่มเป็นรายวันในสัปดาห์ได้ด้วย (เช่น outsource จ-ศ 4 ชม. ส-อา 10 ชม.)
 * null = ยังไม่ตั้งค่า ใช้ workHourCapMinutes (เพดานรวมเดิม) เป็นค่าเริ่มต้นเฉพาะวันทำงาน จ-ศ (เสาร์-อาทิตย์ = 0) ของทั้ง 3 ประเภท
 */
export type ManhourUserType = LoginPermissionCategory
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Weekday = (typeof WEEKDAYS)[number]
export type WeeklyMinutes = Record<Weekday, number>

const manhourCategories = () => PERMISSION_CATEGORIES.filter((c): c is ManhourUserType => c !== 'membership')

/** ค่าที่เก็บจริงอาจเป็นเลขแบนราบของเดิม (ก่อนแยกรายวัน) — normalize ให้เป็น WeeklyMinutes เสมอ */
const WEEKEND: readonly Weekday[] = ['sat', 'sun']

function normalizeCategoryValue(raw: number | Partial<WeeklyMinutes> | undefined, fallbackMinutes: number): WeeklyMinutes {
  // (2026-09-30) Working Calendar จริง — ค่าเริ่มต้น/เลขแบนราบเดิม = ชม.ต่อ "วันทำงาน" (จ-ศ) เสาร์-อาทิตย์เป็นวันหยุด (0) เว้นแต่บริษัทตั้งค่ารายวันไว้ชัดเจน
  // (เดิมเติมให้ครบ 7 วัน ทำให้ความจุสัปดาห์ = 56 ชม. แทน 40 และรายเดือนนับเสาร์-อาทิตย์เป็นวันทำงาน)
  const base = typeof raw === 'number' ? raw : fallbackMinutes
  return Object.fromEntries(
    WEEKDAYS.map((d) => [d, typeof raw === 'object' && raw?.[d] !== undefined ? raw[d] : WEEKEND.includes(d) ? 0 : base]),
  ) as WeeklyMinutes
}

export function resolveManhourMinutesPerDay(
  raw: Partial<Record<ManhourUserType, number | Partial<WeeklyMinutes>>> | null | undefined,
  fallbackMinutes: number,
): Record<ManhourUserType, WeeklyMinutes> {
  return Object.fromEntries(manhourCategories().map((cat) => [cat, normalizeCategoryValue(raw?.[cat], fallbackMinutes)])) as Record<
    ManhourUserType,
    WeeklyMinutes
  >
}

export function validateManhourMinutesPerDay(value: Record<ManhourUserType, WeeklyMinutes>): { ok: true } | { ok: false; error: string } {
  for (const cat of manhourCategories()) {
    for (const day of WEEKDAYS) {
      const v = value[cat]?.[day]
      if (!Number.isInteger(v) || v < 0 || v > 1440) return { ok: false, error: `Manhour/วัน ของ "${cat}" (${day}) ต้องเป็นจำนวนเต็มนาที ระหว่าง 0-1440` }
    }
  }
  return { ok: true }
}
