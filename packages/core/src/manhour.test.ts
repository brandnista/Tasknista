import { describe, expect, it } from 'vitest'
import { resolveManhourMinutesPerDay } from './manhour'

describe('resolveManhourMinutesPerDay — Working Calendar (เสาร์-อาทิตย์เป็นวันหยุดโดยค่าเริ่มต้น)', () => {
  it('ยังไม่ตั้งค่า (null) → ใช้ค่ารวมเดิมเฉพาะ จ-ศ · ความจุสัปดาห์ = 40 ชม.', () => {
    const r = resolveManhourMinutesPerDay(null, 480)
    expect(r.staff).toEqual({ mon: 480, tue: 480, wed: 480, thu: 480, fri: 480, sat: 0, sun: 0 })
    expect(Object.values(r.staff).reduce((a, b) => a + b, 0)).toBe(40 * 60)
  })

  it('เลขแบนราบของเดิม (ก่อนแยกรายวัน) = ชม./วันทำงาน จ-ศ', () => {
    const r = resolveManhourMinutesPerDay({ staff: 420 }, 480)
    expect(r.staff).toEqual({ mon: 420, tue: 420, wed: 420, thu: 420, fri: 420, sat: 0, sun: 0 })
  })

  it('ตั้งค่ารายวันไว้ชัดเจน (เช่น พาร์ทเนอร์ทำเสาร์-อาทิตย์) → ใช้ตามที่ตั้ง · วันที่ไม่ได้ระบุ: จ-ศ ใช้ค่ารวม, ส-อา = 0', () => {
    const r = resolveManhourMinutesPerDay({ outsource: { mon: 240, sat: 600 } }, 480)
    expect(r.outsource).toEqual({ mon: 240, tue: 480, wed: 480, thu: 480, fri: 480, sat: 600, sun: 0 })
  })
})
