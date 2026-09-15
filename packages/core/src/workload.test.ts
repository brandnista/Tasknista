import { describe, expect, it } from 'vitest'
import type { WeeklyMinutes } from './manhour'
import { spreadTaskMinutes, suggestEstimateMinutes, weekdayOfISO } from './workload'

describe('spreadTaskMinutes — เกลี่ยเวลาประเมินลงวันปฏิทิน', () => {
  it('ไม่มี dueDate เลย → ว่าง (ไปอยู่ unscheduled)', () => {
    expect(spreadTaskMinutes({ startDate: null, dueDate: null, estimateMinutes: 480 })).toEqual({})
    expect(spreadTaskMinutes({ startDate: '2026-09-01', dueDate: null, estimateMinutes: 480 })).toEqual({})
  })

  it('มีแค่ dueDate → กองทั้งหมดวันเดียว', () => {
    expect(spreadTaskMinutes({ startDate: null, dueDate: '2026-09-05', estimateMinutes: 960 })).toEqual({ '2026-09-05': 960 })
  })

  it('startDate หลัง dueDate (ข้อมูลเพี้ยน) → กองที่ dueDate วันเดียวเหมือนไม่มี startDate', () => {
    expect(spreadTaskMinutes({ startDate: '2026-09-10', dueDate: '2026-09-05', estimateMinutes: 240 })).toEqual({ '2026-09-05': 240 })
  })

  it('มีทั้ง startDate/dueDate 2 วัน หารลงตัว → เกลี่ยเท่ากัน', () => {
    expect(spreadTaskMinutes({ startDate: '2026-09-01', dueDate: '2026-09-02', estimateMinutes: 960 })).toEqual({
      '2026-09-01': 480,
      '2026-09-02': 480,
    })
  })

  it('3 วัน หารไม่ลงตัว → นาทีส่วนเกินแจกให้วันแรกๆ ทีละ 1 นาที (integer ทุกวัน รวมแล้วต้องเท่าของเดิมเป๊ะ)', () => {
    const res = spreadTaskMinutes({ startDate: '2026-09-01', dueDate: '2026-09-03', estimateMinutes: 100 })
    expect(res).toEqual({ '2026-09-01': 34, '2026-09-02': 33, '2026-09-03': 33 })
    expect(Object.values(res).reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('5 วันคร่อมเดือน — เช็ควันครบและผลรวมถูกต้อง', () => {
    const res = spreadTaskMinutes({ startDate: '2026-08-30', dueDate: '2026-09-03', estimateMinutes: 500 })
    expect(Object.keys(res).sort()).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03'])
    expect(Object.values(res).reduce((a, b) => a + b, 0)).toBe(500)
  })

  it('startDate = dueDate วันเดียวกัน → กองทั้งหมดวันนั้น', () => {
    expect(spreadTaskMinutes({ startDate: '2026-09-05', dueDate: '2026-09-05', estimateMinutes: 300 })).toEqual({ '2026-09-05': 300 })
  })

  it('estimateMinutes = 0 (ไม่มีค่าประเมิน) → แต่ละวันได้ 0 นาที ไม่ error', () => {
    expect(spreadTaskMinutes({ startDate: '2026-09-01', dueDate: '2026-09-02', estimateMinutes: 0 })).toEqual({
      '2026-09-01': 0,
      '2026-09-02': 0,
    })
  })
})

describe('suggestEstimateMinutes — แนะนำเลขประเมินจาก Manhour จริงของ assignee (2.7)', () => {
  const flat8h: WeeklyMinutes = { mon: 480, tue: 480, wed: 480, thu: 480, fri: 480, sat: 480, sun: 480 }
  const partnerWeek: WeeklyMinutes = { mon: 240, tue: 240, wed: 240, thu: 240, fri: 240, sat: 600, sun: 600 }

  it('ไม่มี startDate หรือ dueDate → 0', () => {
    expect(suggestEstimateMinutes(null, '2026-09-05', flat8h)).toBe(0)
    expect(suggestEstimateMinutes('2026-09-01', null, flat8h)).toBe(0)
    expect(suggestEstimateMinutes(null, null, flat8h)).toBe(0)
  })

  it('startDate > dueDate (ข้อมูลเพี้ยนชั่วคราว) → 0', () => {
    expect(suggestEstimateMinutes('2026-09-10', '2026-09-05', flat8h)).toBe(0)
  })

  it('วันเดียว (start=due) → เท่ากับ capacity วันนั้นวันเดียว', () => {
    // 2026-09-01 = อังคาร (2026-09-04 ยืนยันแล้วว่าเป็นศุกร์)
    expect(suggestEstimateMinutes('2026-09-01', '2026-09-01', flat8h)).toBe(480)
  })

  it('พนักงานคงที่ 8 ชม./วันทุกวัน — คร่อม 2 วัน = รวมตรงๆ', () => {
    expect(suggestEstimateMinutes('2026-09-04', '2026-09-05', flat8h)).toBe(960)
  })

  it('พาร์ทเนอร์ (จ-ศ 4 ชม., ส-อา 10 ชม.) คร่อมวันหยุด — รวมตามวันในสัปดาห์จริง ไม่ใช่เฉลี่ย', () => {
    // 2026-09-04=ศุกร์(240) · 09-05=เสาร์(600) · 09-06=อาทิตย์(600) → รวม 1440
    expect(suggestEstimateMinutes('2026-09-04', '2026-09-06', partnerWeek)).toBe(1440)
  })

  it('คร่อมเต็ม 1 สัปดาห์พอดี (7 วัน) — รวมเท่ากับผลรวมทุกวันในสัปดาห์เสมอ ไม่ว่าจะเริ่มวันไหน', () => {
    // 2026-09-01(อังคาร)..09-07(จันทร์) = ครบ 7 วันพอดี
    expect(suggestEstimateMinutes('2026-09-01', '2026-09-07', partnerWeek)).toBe(240 * 5 + 600 * 2)
  })

  it('วันหยุด/ลาที่ capacity=0 ในบางวัน — วันนั้นไม่เพิ่มยอด', () => {
    const withLeaveDay: WeeklyMinutes = { ...flat8h, sat: 0 }
    // 09-04(ศุกร์,480) + 09-05(เสาร์,0) = 480
    expect(suggestEstimateMinutes('2026-09-04', '2026-09-05', withLeaveDay)).toBe(480)
  })
})

describe('weekdayOfISO', () => {
  it('แมปวันที่จริงถูกต้อง (2026-09-04 = ศุกร์)', () => {
    expect(weekdayOfISO('2026-09-04')).toBe('fri')
    expect(weekdayOfISO('2026-09-05')).toBe('sat')
    expect(weekdayOfISO('2026-09-06')).toBe('sun')
    expect(weekdayOfISO('2026-09-07')).toBe('mon')
  })
})
