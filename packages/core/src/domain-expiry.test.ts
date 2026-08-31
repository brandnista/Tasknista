import { describe, expect, it } from 'vitest'
import { dueDomainReminder, isDomainExpired } from './domain-expiry'

describe('dueDomainReminder — เตือนล่วงหน้า 30/15/7/1 วันก่อนโดเมนหมดอายุ', () => {
  it('ยังไกลเกิน 30 วัน → ยังไม่ถึงระดับไหนเลย', () => {
    expect(dueDomainReminder('2026-12-31', '2026-11-01', [])).toBeNull()
  })

  it('เหลือ 30 วันพอดี ยังไม่เคยเตือน → เตือนระดับ 30', () => {
    expect(dueDomainReminder('2026-12-01', '2026-11-01', [])).toEqual({ tierToAnnounce: 30, allDueTiers: [30] })
  })

  it('เหลือ 30 วัน แต่ระดับ 30 เตือนไปแล้ว → ไม่เตือนซ้ำ', () => {
    expect(dueDomainReminder('2026-12-01', '2026-11-01', [30])).toBeNull()
  })

  it('เหลือ 7 วัน ระดับ 30/15 เตือนไปแล้ว → เตือนระดับ 7', () => {
    expect(dueDomainReminder('2026-11-08', '2026-11-01', [30, 15])).toEqual({ tierToAnnounce: 7, allDueTiers: [7] })
  })

  it('cron หน่วงไปหลายวัน (ยังไม่เคยเตือนเลยจนเหลือ 5 วัน) → เตือนระดับใกล้สุด (1 ไม่ถึง แต่ 7/15/30 ถึงแล้ว) mark ทุกระดับที่ผ่านไปด้วย', () => {
    const res = dueDomainReminder('2026-11-06', '2026-11-01', [])
    expect(res?.tierToAnnounce).toBe(7)
    expect(res?.allDueTiers.sort((a, b) => a - b)).toEqual([7, 15, 30])
  })

  it('เหลือ 1 วัน ยังไม่เคยเตือนเลย → เตือนระดับ 1 mark ทั้ง 30/15/7/1 กันเตือนซ้ำย้อนหลัง', () => {
    const res = dueDomainReminder('2026-11-02', '2026-11-01', [])
    expect(res?.tierToAnnounce).toBe(1)
    expect(res?.allDueTiers.sort((a, b) => a - b)).toEqual([1, 7, 15, 30])
  })

  it('หมดอายุไปแล้ว → คืน null (ใช้ isDomainExpired แยกต่างหาก)', () => {
    expect(dueDomainReminder('2026-10-31', '2026-11-01', [])).toBeNull()
  })
})

describe('isDomainExpired', () => {
  it('วันหมดอายุเลยมาแล้ว = true', () => {
    expect(isDomainExpired('2026-10-31', '2026-11-01')).toBe(true)
  })
  it('วันหมดอายุคือวันนี้พอดี = ยังไม่หมดอายุ (false)', () => {
    expect(isDomainExpired('2026-11-01', '2026-11-01')).toBe(false)
  })
  it('ยังไม่ถึงวันหมดอายุ = false', () => {
    expect(isDomainExpired('2026-11-02', '2026-11-01')).toBe(false)
  })
})
