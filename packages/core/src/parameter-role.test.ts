import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMETER_ROLES, parameterRoleById, resolveParameterRoles, validateParameterRoles } from './parameter-role'

describe('resolveParameterRoles / parameterRoleById', () => {
  it('คืน list ว่างเมื่อยังไม่ตั้งค่า', () => {
    expect(resolveParameterRoles(null)).toEqual(DEFAULT_PARAMETER_ROLES)
    expect(resolveParameterRoles(null)).toHaveLength(0)
  })
  it('เรียงตาม sortOrder และหา id ได้', () => {
    const custom = [
      { id: 'b', name: 'B', sortOrder: 1 },
      { id: 'a', name: 'A', sortOrder: 0 },
    ]
    expect(resolveParameterRoles(custom).map((r) => r.id)).toEqual(['a', 'b'])
    expect(parameterRoleById(custom, 'b')?.name).toBe('B')
    expect(parameterRoleById(custom, 'missing')).toBeUndefined()
  })
})

describe('validateParameterRoles', () => {
  it('ผ่านเมื่อ list ว่าง', () => {
    expect(validateParameterRoles([])).toEqual({ ok: true })
  })
  it('ผ่านเมื่อข้อมูลถูกต้อง', () => {
    const list = [{ id: 'r1', name: 'Senior Full Stack Developer', sortOrder: 0 }]
    expect(validateParameterRoles(list)).toEqual({ ok: true })
  })
  it('ไม่ผ่านเมื่อ id ซ้ำ', () => {
    const list = [
      { id: 'x', name: 'X', sortOrder: 0 },
      { id: 'x', name: 'Y', sortOrder: 1 },
    ]
    expect(validateParameterRoles(list).ok).toBe(false)
  })
  it('ไม่ผ่านเมื่อชื่อว่าง', () => {
    const list = [{ id: 'x', name: '  ', sortOrder: 0 }]
    expect(validateParameterRoles(list).ok).toBe(false)
  })
})
