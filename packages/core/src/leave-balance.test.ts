import { describe, expect, it } from 'vitest'
import { computeLeaveBalance, leaveDaysInclusive } from './leave-balance'

describe('leaveDaysInclusive', () => {
  it('วันเดียวกัน (ลา 1 วัน) — นับ 1', () => {
    expect(leaveDaysInclusive('2026-09-22', '2026-09-22')).toBe(1)
  })
  it('ช่วงหลายวัน — นับรวมหัวท้าย', () => {
    expect(leaveDaysInclusive('2026-09-22', '2026-09-24')).toBe(3)
  })
  it('ข้ามเดือน — นับรวมหัวท้ายถูกต้อง', () => {
    expect(leaveDaysInclusive('2026-09-29', '2026-10-02')).toBe(4)
  })
})

describe('computeLeaveBalance', () => {
  it('quota ปกติ — remain หักเฉพาะที่อนุมัติแล้ว, waiting โชว์แยกไม่หักซ้ำ', () => {
    expect(computeLeaveBalance(30, 1, 0)).toEqual({ quota: 30, remain: 29, waiting: 0 })
  })
  it('มี waiting ค้างอยู่ — ไม่ไปลด remain', () => {
    expect(computeLeaveBalance(10, 2, 3)).toEqual({ quota: 10, remain: 8, waiting: 3 })
  })
  it('quota=null (ไม่มีโควตากำหนด) — remain เป็น null ด้วย', () => {
    expect(computeLeaveBalance(null, 0, 0)).toEqual({ quota: null, remain: null, waiting: 0 })
  })
  it('ยังไม่เคยลาเลยปีนี้ — remain = quota เต็ม', () => {
    expect(computeLeaveBalance(6, 0, 0)).toEqual({ quota: 6, remain: 6, waiting: 0 })
  })
  it('ใช้โควตาเกิน (edge case) — remain ติดลบได้ ไม่ clamp เป็น 0', () => {
    expect(computeLeaveBalance(3, 5, 0)).toEqual({ quota: 3, remain: -2, waiting: 0 })
  })
})
