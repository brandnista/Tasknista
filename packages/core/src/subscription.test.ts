import { describe, expect, it } from 'vitest'
import {
  costRoleById,
  DEFAULT_COST_ROLES,
  DEFAULT_PRODUCT_TYPES,
  DEFAULT_SERVICE_TYPES,
  isNearExpiry,
  productTypeById,
  resolveCostRoles,
  resolveProductTypes,
  resolveServiceTypes,
  serviceTypeById,
  validateCostRoles,
  validateProductTypes,
  validateServiceTypes,
} from './subscription'

describe('isNearExpiry', () => {
  it('true เมื่อวันหมดอายุอยู่ในช่วงแจ้งเตือนล่วงหน้า', () => {
    expect(isNearExpiry('2026-08-20', 30, '2026-08-06')).toBe(true) // เหลือ 14 วัน ≤ 30
  })
  it('true พอดีขอบ (daysUntil === notifyBeforeDays)', () => {
    expect(isNearExpiry('2026-09-05', 30, '2026-08-06')).toBe(true) // เหลือพอดี 30 วัน
  })
  it('false เมื่อยังไม่ถึงช่วงแจ้งเตือน', () => {
    expect(isNearExpiry('2026-12-25', 30, '2026-08-06')).toBe(false)
  })
  it('true เมื่อหมดอายุไปแล้ว (daysUntil ติดลบ) — ยังต้องเตือนต่อจนกว่าจะต่ออายุ', () => {
    expect(isNearExpiry('2026-08-01', 30, '2026-08-06')).toBe(true)
  })
  it('false เมื่อไม่มีวันหมดอายุ (lifetime)', () => {
    expect(isNearExpiry(null, 30, '2026-08-06')).toBe(false)
  })
  it('false เมื่อไม่ได้ตั้งค่าแจ้งเตือนล่วงหน้า', () => {
    expect(isNearExpiry('2026-08-20', null, '2026-08-06')).toBe(false)
  })
})

describe('resolveServiceTypes / serviceTypeById', () => {
  it('คืน DEFAULT_SERVICE_TYPES 5 รายการเมื่อยังไม่ตั้งค่า', () => {
    const list = resolveServiceTypes(null)
    expect(list).toEqual(DEFAULT_SERVICE_TYPES)
    expect(list).toHaveLength(5)
  })
  it('เรียงตาม sortOrder และหา id ได้', () => {
    const custom = [
      { id: 'b', name: 'B', sortOrder: 1 },
      { id: 'a', name: 'A', sortOrder: 0 },
    ]
    expect(resolveServiceTypes(custom).map((s) => s.id)).toEqual(['a', 'b'])
    expect(serviceTypeById(custom, 'b')?.name).toBe('B')
    expect(serviceTypeById(custom, 'missing')).toBeUndefined()
  })
})

describe('validateServiceTypes', () => {
  it('ผ่านเมื่อข้อมูลถูกต้อง', () => {
    expect(validateServiceTypes(DEFAULT_SERVICE_TYPES)).toEqual({ ok: true })
  })
  it('ไม่ผ่านเมื่อ list ว่าง', () => {
    expect(validateServiceTypes([])).toEqual({ ok: false, error: 'ต้องมีอย่างน้อย 1 ประเภทบริการ' })
  })
  it('ไม่ผ่านเมื่อ id ซ้ำ', () => {
    const list = [
      { id: 'x', name: 'X', sortOrder: 0 },
      { id: 'x', name: 'Y', sortOrder: 1 },
    ]
    expect(validateServiceTypes(list).ok).toBe(false)
  })
  it('ไม่ผ่านเมื่อชื่อว่าง', () => {
    const list = [{ id: 'x', name: '  ', sortOrder: 0 }]
    expect(validateServiceTypes(list).ok).toBe(false)
  })
})

describe('resolveProductTypes / productTypeById', () => {
  it('คืน DEFAULT_PRODUCT_TYPES 12 รายการเมื่อยังไม่ตั้งค่า', () => {
    const list = resolveProductTypes(null)
    expect(list).toEqual(DEFAULT_PRODUCT_TYPES)
    expect(list).toHaveLength(12)
  })
  it('เรียงตาม sortOrder และหา id ได้', () => {
    const custom = [
      { id: 'b', name: 'B', sortOrder: 1 },
      { id: 'a', name: 'A', sortOrder: 0 },
    ]
    expect(resolveProductTypes(custom).map((p) => p.id)).toEqual(['a', 'b'])
    expect(productTypeById(custom, 'b')?.name).toBe('B')
    expect(productTypeById(custom, 'missing')).toBeUndefined()
  })
})

describe('validateProductTypes', () => {
  it('ผ่านเมื่อข้อมูลถูกต้อง', () => {
    expect(validateProductTypes(DEFAULT_PRODUCT_TYPES)).toEqual({ ok: true })
  })
  it('ไม่ผ่านเมื่อ list ว่าง', () => {
    expect(validateProductTypes([])).toEqual({ ok: false, error: 'ต้องมีอย่างน้อย 1 ประเภทสินค้า' })
  })
  it('ไม่ผ่านเมื่อ id ซ้ำ', () => {
    const list = [
      { id: 'x', name: 'X', sortOrder: 0 },
      { id: 'x', name: 'Y', sortOrder: 1 },
    ]
    expect(validateProductTypes(list).ok).toBe(false)
  })
  it('ไม่ผ่านเมื่อชื่อว่าง', () => {
    const list = [{ id: 'x', name: '  ', sortOrder: 0 }]
    expect(validateProductTypes(list).ok).toBe(false)
  })
})

describe('resolveCostRoles / costRoleById', () => {
  it('คืน list ว่างเมื่อยังไม่ตั้งค่า (ไม่มี default ตายตัว)', () => {
    expect(resolveCostRoles(null)).toEqual(DEFAULT_COST_ROLES)
    expect(resolveCostRoles(null)).toHaveLength(0)
  })
  it('เรียงตาม sortOrder และหา id ได้', () => {
    const custom = [
      { id: 'b', name: 'B', costPerDaySatang: 200000, sortOrder: 1 },
      { id: 'a', name: 'A', costPerDaySatang: 100000, sortOrder: 0 },
    ]
    expect(resolveCostRoles(custom).map((r) => r.id)).toEqual(['a', 'b'])
    expect(costRoleById(custom, 'b')?.name).toBe('B')
    expect(costRoleById(custom, 'missing')).toBeUndefined()
  })
})

describe('validateCostRoles', () => {
  it('ผ่านเมื่อ list ว่าง (ยังไม่มีตำแหน่งไหนเลยก็ได้)', () => {
    expect(validateCostRoles([])).toEqual({ ok: true })
  })
  it('ผ่านเมื่อข้อมูลถูกต้อง', () => {
    const list = [{ id: 'r1', name: 'Senior Full Stack Developer', costPerDaySatang: 650000, sortOrder: 0 }]
    expect(validateCostRoles(list)).toEqual({ ok: true })
  })
  it('ไม่ผ่านเมื่อ id ซ้ำ', () => {
    const list = [
      { id: 'x', name: 'X', costPerDaySatang: 0, sortOrder: 0 },
      { id: 'x', name: 'Y', costPerDaySatang: 0, sortOrder: 1 },
    ]
    expect(validateCostRoles(list).ok).toBe(false)
  })
  it('ไม่ผ่านเมื่อชื่อว่าง', () => {
    const list = [{ id: 'x', name: '  ', costPerDaySatang: 0, sortOrder: 0 }]
    expect(validateCostRoles(list).ok).toBe(false)
  })
  it('ไม่ผ่านเมื่อต้นทุน/วันติดลบ', () => {
    const list = [{ id: 'x', name: 'X', costPerDaySatang: -1, sortOrder: 0 }]
    expect(validateCostRoles(list).ok).toBe(false)
  })
  it('ไม่ผ่านเมื่อต้นทุน/วันไม่ใช่จำนวนเต็ม', () => {
    const list = [{ id: 'x', name: 'X', costPerDaySatang: 1.5, sortOrder: 0 }]
    expect(validateCostRoles(list).ok).toBe(false)
  })
})
