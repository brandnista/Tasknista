import { describe, expect, it } from 'vitest'
import { DEFAULT_LABELS, labelById, labelsByIds, resolveLabels, validateLabels } from './labels'

describe('resolveLabels / labelById', () => {
  it('คืน DEFAULT_LABELS 3 รายการเมื่อยังไม่ตั้งค่า', () => {
    const list = resolveLabels(null)
    expect(list).toEqual(DEFAULT_LABELS)
    expect(list).toHaveLength(3)
  })
  it('เรียงตาม sortOrder และหา id ได้', () => {
    const custom = [
      { id: 'b', name: 'B', color: 'sky', sortOrder: 1 },
      { id: 'a', name: 'A', color: 'rose', sortOrder: 0 },
    ]
    expect(resolveLabels(custom).map((l) => l.id)).toEqual(['a', 'b'])
    expect(labelById(custom, 'b')?.name).toBe('B')
    expect(labelById(custom, 'missing')).toBeUndefined()
  })
})

describe('labelsByIds', () => {
  it('คืน array ว่างเมื่อไม่มี ids', () => {
    expect(labelsByIds(DEFAULT_LABELS, null)).toEqual([])
    expect(labelsByIds(DEFAULT_LABELS, [])).toEqual([])
  })
  it('resolve ids ที่มีจริงตามลำดับที่ให้มา', () => {
    const result = labelsByIds(DEFAULT_LABELS, ['lbl_blocked', 'lbl_bug'])
    expect(result.map((l) => l.id)).toEqual(['lbl_blocked', 'lbl_bug'])
  })
  it('ตัด id ที่ไม่มีในแคตตาล็อกทิ้งเงียบๆ', () => {
    const result = labelsByIds(DEFAULT_LABELS, ['lbl_bug', 'lbl_ghost'])
    expect(result.map((l) => l.id)).toEqual(['lbl_bug'])
  })
})

describe('validateLabels', () => {
  it('ผ่านเมื่อข้อมูลถูกต้อง', () => {
    expect(validateLabels(DEFAULT_LABELS)).toEqual({ ok: true })
  })
  it('ไม่ผ่านเมื่อ list ว่าง', () => {
    expect(validateLabels([])).toEqual({ ok: false, error: 'ต้องมีอย่างน้อย 1 label' })
  })
  it('ไม่ผ่านเมื่อ id ซ้ำ', () => {
    const list = [
      { id: 'x', name: 'X', color: 'sky', sortOrder: 0 },
      { id: 'x', name: 'Y', color: 'rose', sortOrder: 1 },
    ]
    expect(validateLabels(list).ok).toBe(false)
  })
  it('ไม่ผ่านเมื่อชื่อว่าง', () => {
    const list = [{ id: 'x', name: '  ', color: 'sky', sortOrder: 0 }]
    expect(validateLabels(list).ok).toBe(false)
  })
  it('ไม่ผ่านเมื่อสีไม่ถูกต้อง', () => {
    const list = [{ id: 'x', name: 'X', color: 'not-a-color', sortOrder: 0 }]
    expect(validateLabels(list).ok).toBe(false)
  })
})
