/**
 * Pronista §Project Estimate — ต้นทุนพนักงานต่อ Task ที่แตกจาก SRS ใช้ทำใบเสนอราคา (SPEC §9: pure ล้วน)
 * เงิน = integer สตางค์ · เวลา = integer นาที · ปัดเศษ = ครึ่งปัดขึ้น (เหมือน money.ts) — Net Cost (Hour) reuse `baseSatang` ตรงๆ ไม่เขียนใหม่
 */

function assertInt(n: number, name: string): void {
  if (!Number.isInteger(n)) throw new TypeError(`${name} ต้องเป็น integer ได้ ${n}`)
}
function assertNonNeg(n: number, name: string): void {
  assertInt(n, name)
  if (n < 0) throw new RangeError(`${name} ต้องไม่ติดลบ ได้ ${n}`)
}

/** Cost/Hour = Cost/Day ÷ 8 (มาตรฐาน 8 ชม./วัน) — round-half-up */
export function costPerHourFromDay(costPerDaySatang: number): number {
  assertNonNeg(costPerDaySatang, 'costPerDaySatang')
  return Math.round(costPerDaySatang / 8)
}

/** Buffer W/H (นาที) = Estimate W/H (นาที) × bufferPercent/100 — round-half-up */
export function bufferMinutes(estimateMinutes: number, bufferPercent: number): number {
  assertNonNeg(estimateMinutes, 'estimateMinutes')
  assertNonNeg(bufferPercent, 'bufferPercent')
  return Math.round((estimateMinutes * bufferPercent) / 100)
}

/** Margin (สตางค์) = Net Cost (Hour) × marginPercent/100 — round-half-up */
export function marginSatang(netCostSatang: number, marginPercent: number): number {
  assertNonNeg(netCostSatang, 'netCostSatang')
  assertNonNeg(marginPercent, 'marginPercent')
  return Math.round((netCostSatang * marginPercent) / 100)
}

/** Quotation Cost = Net Cost (Hour) + Margin */
export function quotationSatang(netCostSatang: number, marginSatangAmount: number): number {
  assertNonNeg(netCostSatang, 'netCostSatang')
  assertNonNeg(marginSatangAmount, 'marginSatangAmount')
  return netCostSatang + marginSatangAmount
}

/**
 * Estimate Day = Total W/H (นาที) ÷ Work Hour/Day (นาที) — ใช้แสดงผลเท่านั้น ไม่เก็บ ไม่ปัด (float)
 * workMinutesPerDay ≤ 0 → คืน 0 กันหารศูนย์ (ไม่ควรเกิดจริง เพราะมี company_config.workHourCapMinutes เป็น fallback เสมอ)
 */
export function estimateDays(totalMinutes: number, workMinutesPerDay: number): number {
  assertNonNeg(totalMinutes, 'totalMinutes')
  if (workMinutesPerDay <= 0) return 0
  return totalMinutes / workMinutesPerDay
}
