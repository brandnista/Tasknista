/** Pronista §PRO-0034 — ช่องเวลาใน Daily Report เลือกหน่วยได้ ชม./นาที */
export type DurationUnit = 'hr' | 'min'

/** แปลงค่าที่ผู้ใช้พิมพ์ + หน่วย เป็นจำนวนนาที (จำนวนเต็ม) — ค่าว่าง/ไม่ใช่ตัวเลข/ติดลบ/0 = 0
 *  ชม.: ทศนิยมได้ (0.5 ชม. = 30 นาที, ตรงพฤติกรรมเดิม) · นาที: ปัดเป็นจำนวนเต็ม */
export function durationToMinutes(value: string, unit: DurationUnit): number {
  const n = Number(value)
  if (!value.trim() || !Number.isFinite(n) || n <= 0) return 0
  return Math.round(unit === 'min' ? n : n * 60)
}

/** ตอนเปิดแก้ไขรายการเดิม: เลือกหน่วยที่อ่านง่ายที่สุด — หารด้วย 60 ลงตัวใช้ ชม. ไม่งั้นใช้ นาที (เช่น 45 นาที ไม่แสดงเป็น 0.75 ชม.) */
export function minutesToDurationInput(minutes: number): { value: string; unit: DurationUnit } {
  if (!minutes || minutes <= 0) return { value: '', unit: 'hr' }
  if (minutes % 60 === 0) return { value: String(minutes / 60), unit: 'hr' }
  return { value: String(minutes), unit: 'min' }
}
