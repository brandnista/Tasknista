import { describe, expect, it } from 'vitest'
import { DEFAULT_TASK_TYPES, isValidTaskTypePair, resolveTaskTypes, taskSubTypeById, taskTypeById, validateTaskTypes } from './task-type'

describe('DEFAULT_TASK_TYPES', () => {
  it('ผ่าน validateTaskTypes เสมอ (กัน id เกิน 32 ตัวอักษรหลุดออกไปโดยไม่มีใครจับได้ตอน PUT /api/admin/task-types)', () => {
    expect(validateTaskTypes(DEFAULT_TASK_TYPES)).toEqual({ ok: true })
  })
})

describe('resolveTaskTypes / taskTypeById / taskSubTypeById', () => {
  it('คืน DEFAULT_TASK_TYPES 5 รายการเมื่อยังไม่ตั้งค่า', () => {
    const list = resolveTaskTypes(null)
    expect(list).toHaveLength(5)
    expect(list.map((t) => t.id)).toEqual(['tt_brd', 'tt_design', 'tt_development', 'tt_internal_testing', 'tt_debug'])
  })
  it('เรียงตาม sortOrder ทั้งระดับ type และ subType', () => {
    const custom = [
      { id: 'b', name: 'B', sortOrder: 1, subTypes: [{ id: 'b2', name: 'B2', sortOrder: 1 }, { id: 'b1', name: 'B1', sortOrder: 0 }] },
      { id: 'a', name: 'A', sortOrder: 0, subTypes: [{ id: 'a1', name: 'A1', sortOrder: 0 }] },
    ]
    const list = resolveTaskTypes(custom)
    expect(list.map((t) => t.id)).toEqual(['a', 'b'])
    expect(list[1]!.subTypes.map((s) => s.id)).toEqual(['b1', 'b2'])
  })
  it('หา type/subType ได้ตาม id', () => {
    expect(taskTypeById(DEFAULT_TASK_TYPES, 'tt_design')?.name).toBe('Design')
    expect(taskTypeById(DEFAULT_TASK_TYPES, 'missing')).toBeUndefined()
    expect(taskSubTypeById(DEFAULT_TASK_TYPES, 'tt_development', 'tts_api')?.name).toBe('API')
    expect(taskSubTypeById(DEFAULT_TASK_TYPES, 'tt_development', 'missing')).toBeUndefined()
  })
})

describe('validateTaskTypes', () => {
  it('ไม่ผ่านเมื่อ list ว่าง', () => {
    expect(validateTaskTypes([])).toEqual({ ok: false, error: 'ต้องมีอย่างน้อย 1 ประเภทงาน' })
  })
  it('ไม่ผ่านเมื่อ id เกิน 32 ตัวอักษร', () => {
    const list = [{ id: 'tt_x', name: 'X', sortOrder: 0, subTypes: [{ id: 'a'.repeat(33), name: 'A', sortOrder: 0 }] }]
    expect(validateTaskTypes(list).ok).toBe(false)
  })
  it('ไม่ผ่านเมื่อ id ซ้ำ', () => {
    const list = [
      { id: 'x', name: 'X', sortOrder: 0, subTypes: [{ id: 's', name: 'S', sortOrder: 0 }] },
      { id: 'x', name: 'Y', sortOrder: 1, subTypes: [{ id: 's2', name: 'S2', sortOrder: 0 }] },
    ]
    expect(validateTaskTypes(list).ok).toBe(false)
  })
  it('ไม่ผ่านเมื่อไม่มีตัวเลือกย่อยเลย', () => {
    const list = [{ id: 'x', name: 'X', sortOrder: 0, subTypes: [] }]
    expect(validateTaskTypes(list).ok).toBe(false)
  })
})

describe('isValidTaskTypePair', () => {
  it('ผ่านเมื่อทั้งคู่ว่าง', () => {
    expect(isValidTaskTypePair(DEFAULT_TASK_TYPES, null, null)).toBe(true)
  })
  it('ไม่ผ่านเมื่อมี subTaskType แต่ไม่มี taskType', () => {
    expect(isValidTaskTypePair(DEFAULT_TASK_TYPES, null, 'tts_api')).toBe(false)
  })
  it('ผ่านเมื่อมี taskType อย่างเดียว', () => {
    expect(isValidTaskTypePair(DEFAULT_TASK_TYPES, 'tt_development', null)).toBe(true)
  })
  it('ผ่านเมื่อ subTaskType อยู่ใต้ taskType จริง', () => {
    expect(isValidTaskTypePair(DEFAULT_TASK_TYPES, 'tt_development', 'tts_api')).toBe(true)
  })
  it('ไม่ผ่านเมื่อ subTaskType ไม่ได้อยู่ใต้ taskType ที่เลือก', () => {
    expect(isValidTaskTypePair(DEFAULT_TASK_TYPES, 'tt_development', 'tts_debug')).toBe(false)
  })
  it('ไม่ผ่านเมื่อ taskType ไม่มีจริง', () => {
    expect(isValidTaskTypePair(DEFAULT_TASK_TYPES, 'tt_missing', null)).toBe(false)
  })
})
