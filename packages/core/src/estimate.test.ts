import { describe, expect, it } from 'vitest'
import { baseSatang } from './money'
import { bufferMinutes, costPerHourFromDay, estimateDays, marginSatang, quotationSatang } from './estimate'

describe('costPerHourFromDay — Cost/Day ÷ 8 ปัดครึ่งขึ้น (SPEC Project Estimate)', () => {
  it('หารลงตัว', () => {
    expect(costPerHourFromDay(8000)).toBe(1000) // ฿80/วัน → ฿10/ชม.
    expect(costPerHourFromDay(0)).toBe(0)
  })
  it('ปัดครึ่งขึ้นเมื่อหารไม่ลงตัว', () => {
    expect(costPerHourFromDay(6500)).toBe(813) // 812.5 → 813
  })
  it('ปฏิเสธ input ที่ไม่ใช่ integer ≥ 0', () => {
    expect(() => costPerHourFromDay(-100)).toThrow(RangeError)
    expect(() => costPerHourFromDay(100.5)).toThrow(TypeError)
  })
})

describe('bufferMinutes — Buffer W/H = Estimate W/H × %', () => {
  it('ตรงสูตรจากไฟล์ตัวอย่าง (20%)', () => {
    expect(bufferMinutes(6600, 20)).toBe(1320) // 110 ชม. × 20% = 22 ชม. = 1320 นาที
  })
  it('ปัดครึ่งขึ้นเมื่อไม่ลงตัว', () => {
    expect(bufferMinutes(5, 20)).toBe(1) // 1.0 พอดี
    expect(bufferMinutes(3, 25)).toBe(1) // 0.75 → 1
  })
  it('0% = ไม่มี buffer', () => {
    expect(bufferMinutes(1000, 0)).toBe(0)
  })
})

describe('marginSatang — Margin = Net Cost × %', () => {
  it('ตรงสูตรจากไฟล์ตัวอย่าง (30%)', () => {
    expect(marginSatang(10_800_00, 30)).toBe(3_240_00) // Net Cost ฿10,800 × 30% = ฿3,240
  })
  it('ปัดครึ่งขึ้นเมื่อไม่ลงตัว', () => {
    expect(marginSatang(1, 50)).toBe(1) // 0.5 → 1
  })
})

describe('quotationSatang — Net Cost + Margin', () => {
  it('บวกตรงๆ', () => {
    expect(quotationSatang(10_800_00, 3_240_00)).toBe(14_040_00)
    expect(quotationSatang(0, 0)).toBe(0)
  })
  it('ปฏิเสธ input ที่ไม่ใช่ integer', () => {
    expect(() => quotationSatang(1.5, 0)).toThrow(TypeError)
    expect(() => quotationSatang(0, -1)).toThrow(RangeError)
  })
})

describe('estimateDays — Total W/H ÷ Work Hour/Day (แสดงผลเท่านั้น ไม่เก็บ)', () => {
  it('ตรงสูตรจากไฟล์ตัวอย่าง', () => {
    expect(estimateDays(2880, 240)).toBe(12) // 48 ชม. ÷ 4 ชม./วัน = 12 วัน
  })
  it('คืนทศนิยมเมื่อหารไม่ลงตัว (ใช้แสดงผล ไม่ปัด)', () => {
    expect(estimateDays(100, 3)).toBeCloseTo(33.333, 3)
  })
  it('workMinutesPerDay ≤ 0 → คืน 0 (กันหารศูนย์)', () => {
    expect(estimateDays(100, 0)).toBe(0)
    expect(estimateDays(100, -5)).toBe(0)
  })
})

describe('reuse baseSatang สำหรับ Net Cost (Hour) — ไม่เขียนใหม่', () => {
  it('Total W/H (นาที) × Cost/Hour (สตางค์) ตรงไฟล์ตัวอย่าง', () => {
    expect(baseSatang(6600, 850_00)).toBe(93_500_00) // 110 ชม. × ฿850/ชม. = ฿93,500
  })
})
