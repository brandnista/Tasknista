import { describe, expect, it } from 'vitest'
import { durationToMinutes, minutesToDurationInput } from './duration'

describe('durationToMinutes (PRO-0034)', () => {
  it('หน่วยนาที: 45 → 45 นาที', () => expect(durationToMinutes('45', 'min')).toBe(45))
  it('หน่วย ชม. จำนวนเต็ม: 2 → 120 นาที', () => expect(durationToMinutes('2', 'hr')).toBe(120))
  it('หน่วย ชม. ทศนิยม (พฤติกรรมเดิม): 0.5 → 30 นาที', () => expect(durationToMinutes('0.5', 'hr')).toBe(30))
  it('หน่วยนาทีไม่รับทศนิยม: 45.6 → ปัดเป็น 46', () => expect(durationToMinutes('45.6', 'min')).toBe(46))
  it('ค่าว่าง / ศูนย์ / ติดลบ / ไม่ใช่ตัวเลข → 0', () => {
    for (const v of ['', '  ', '0', '-5', 'abc']) expect(durationToMinutes(v, 'hr')).toBe(0)
  })
})

describe('minutesToDurationInput (PRO-0034)', () => {
  it('หารด้วย 60 ลงตัว → ชม.', () => expect(minutesToDurationInput(120)).toEqual({ value: '2', unit: 'hr' }))
  it('ไม่ลงตัว → นาที (45 ไม่กลายเป็น 0.75 ชม.)', () => expect(minutesToDurationInput(45)).toEqual({ value: '45', unit: 'min' }))
  it('90 นาที → นาที (ไม่ใช่ 1.5 ชม.)', () => expect(minutesToDurationInput(90)).toEqual({ value: '90', unit: 'min' }))
  it('0 / ว่าง → ช่องว่าง หน่วย ชม.', () => {
    expect(minutesToDurationInput(0)).toEqual({ value: '', unit: 'hr' })
  })
})
