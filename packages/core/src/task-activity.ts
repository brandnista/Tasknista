/**
 * Pronista §Sort newest first (2026-10-02) — รายการที่ "มีการอัปเดต/ทำล่าสุด" ต้องอยู่บนสุดเสมอ
 * งานไม่มีคอลัมน์ updatedAt จึงใช้เวลาล่าสุดจากช่องเหตุการณ์ของงาน (สร้าง/จ่าย/รับ/ส่งตรวจ/ตีกลับ/ปิด/ปุ่มบันทึก)
 */
type Ts = string | number | Date | null | undefined

export interface TaskActivityStamps {
  createdAt?: Ts
  dispatchedAt?: Ts
  acceptedAt?: Ts
  submittedAt?: Ts
  bouncedAt?: Ts
  completedAt?: Ts
  lastActivityAt?: Ts
}

const toMs = (v: Ts): number => {
  if (v == null) return 0
  if (v instanceof Date) return v.getTime() || 0
  if (typeof v === 'number') return v
  const parsed = Date.parse(v)
  return Number.isNaN(parsed) ? 0 : parsed
}

const STAMP_KEYS = ['createdAt', 'dispatchedAt', 'acceptedAt', 'submittedAt', 'bouncedAt', 'completedAt', 'lastActivityAt'] as const

export function latestTaskActivityMs(t: TaskActivityStamps): number {
  let max = 0
  for (const k of STAMP_KEYS) max = Math.max(max, toMs(t[k]))
  return max
}

/** เรียงใหม่สุดไว้บน (คืน array ใหม่ ไม่แก้ต้นฉบับ · เวลาเท่ากันคงลำดับเดิม) */
export function sortByRecentActivity<T extends TaskActivityStamps>(list: readonly T[]): T[] {
  return list
    .map((item, index) => ({ item, index, at: latestTaskActivityMs(item) }))
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .map((x) => x.item)
}
