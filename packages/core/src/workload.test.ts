import { describe, expect, it } from 'vitest'
import { spreadTaskMinutes, weekdayOfISO } from './workload'

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

describe('weekdayOfISO', () => {
  it('แมปวันที่จริงถูกต้อง (2026-09-04 = ศุกร์)', () => {
    expect(weekdayOfISO('2026-09-04')).toBe('fri')
    expect(weekdayOfISO('2026-09-05')).toBe('sat')
    expect(weekdayOfISO('2026-09-06')).toBe('sun')
    expect(weekdayOfISO('2026-09-07')).toBe('mon')
  })
})
