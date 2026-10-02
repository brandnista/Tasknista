import { describe, expect, it } from 'vitest'
import { latestTaskActivityMs, sortByRecentActivity } from './task-activity'

describe('latestTaskActivityMs — เวลาความเคลื่อนไหวล่าสุดของงาน (ใช้เรียงรายการให้ของใหม่อยู่บน)', () => {
  it('เอาค่าที่ใหม่ที่สุดจากทุกช่องเวลา · รับได้ทั้งข้อความ ISO ตัวเลข และ Date · ไม่มีเลย = 0', () => {
    expect(latestTaskActivityMs({})).toBe(0)
    expect(
      latestTaskActivityMs({
        createdAt: '2026-10-01T01:00:00.000Z',
        dispatchedAt: Date.parse('2026-10-01T02:00:00.000Z'),
        bouncedAt: new Date('2026-10-02T05:04:00.000Z'),
        acceptedAt: null,
        submittedAt: undefined,
      }),
    ).toBe(Date.parse('2026-10-02T05:04:00.000Z'))
  })

  it('ค่าเวลาที่อ่านไม่ออกถูกข้าม ไม่ทำให้ทั้งหมดพัง', () => {
    expect(latestTaskActivityMs({ createdAt: 'ไม่ใช่วันที่', dispatchedAt: '2026-10-01T02:00:00.000Z' })).toBe(Date.parse('2026-10-01T02:00:00.000Z'))
  })
})

describe('sortByRecentActivity — ใหม่สุดอยู่บน', () => {
  const a = { id: 'a', dispatchedAt: '2026-09-25T07:27:00.000Z' }
  const b = { id: 'b', dispatchedAt: '2026-09-23T09:18:00.000Z' }
  const c = { id: 'c', dispatchedAt: '2026-09-25T07:27:00.000Z', bouncedAt: '2026-10-02T05:04:00.000Z' }
  const none = { id: 'none' }

  it('งานที่เพิ่งถูกตีกลับ/เพิ่งขยับล่าสุดขึ้นบนสุด · ไม่มีเวลาเลยไปอยู่ท้าย', () => {
    expect(sortByRecentActivity([a, b, c, none]).map((t) => t.id)).toEqual(['c', 'a', 'b', 'none'])
  })

  it('เวลาเท่ากันคงลำดับเดิม (stable) · ไม่แก้ array ต้นฉบับ', () => {
    const x = { id: 'x', dispatchedAt: '2026-10-01T00:00:00.000Z' }
    const y = { id: 'y', dispatchedAt: '2026-10-01T00:00:00.000Z' }
    const input = [x, y]
    expect(sortByRecentActivity(input).map((t) => t.id)).toEqual(['x', 'y'])
    expect(input.map((t) => t.id)).toEqual(['x', 'y'])
  })
})
