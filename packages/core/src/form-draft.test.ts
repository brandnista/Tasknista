import { describe, expect, it } from 'vitest'
import { changedFields, normalizeFieldValue } from './form-draft'

describe('normalizeFieldValue — ค่าว่าง/ช่องว่างล้วน = null (ตรงกับที่ API เก็บ)', () => {
  it('trim ข้อความ · ว่างหรือเว้นวรรคล้วน → null · null/undefined → null', () => {
    expect(normalizeFieldValue('  สมชาย ')).toBe('สมชาย')
    expect(normalizeFieldValue('')).toBeNull()
    expect(normalizeFieldValue('   ')).toBeNull()
    expect(normalizeFieldValue(null)).toBeNull()
    expect(normalizeFieldValue(undefined)).toBeNull()
  })
})

describe('changedFields — เอาเฉพาะฟิลด์ที่ผู้ใช้แก้จริงไปส่งบันทึก', () => {
  const base = { phone: '0812345678', address: null as string | null, jobTitle: 'Dev' }

  it('ไม่มีอะไรเปลี่ยน → {} (ปุ่มบันทึกไม่ต้อง active)', () => {
    expect(changedFields(base, {})).toEqual({})
    expect(changedFields(base, { phone: '0812345678', address: '' })).toEqual({})
  })

  it('แก้ค่า → ส่งค่าที่ trim แล้ว · ล้างช่อง → null', () => {
    expect(changedFields(base, { phone: ' 0899999999 ' })).toEqual({ phone: '0899999999' })
    expect(changedFields(base, { jobTitle: '' })).toEqual({ jobTitle: null })
  })

  it('จากว่างเป็นมีค่า → ส่ง · พิมพ์แล้วลบกลับเป็นค่าเดิม → ไม่นับว่าเปลี่ยน', () => {
    expect(changedFields(base, { address: '1/2 ถ.สุขุมวิท' })).toEqual({ address: '1/2 ถ.สุขุมวิท' })
    expect(changedFields(base, { phone: '0812345678', address: '  ' })).toEqual({})
  })

  it('ฟิลด์ที่ไม่ได้อยู่ใน draft ไม่ถูกแตะ (partial)', () => {
    expect(changedFields(base, { phone: '0800000000' })).not.toHaveProperty('address')
  })
})

describe('changedFields — ฟิลด์แบบรายการ (เช่น โปรเจกต์ที่ผูกกับลูกค้า) เทียบเนื้อหา ไม่สนลำดับ', () => {
  const base = { projectIds: ['b', 'a'] as string[] }
  it('เนื้อหาเท่ากัน (ลำดับต่าง) → ไม่นับว่าเปลี่ยน', () => {
    expect(changedFields(base, { projectIds: ['a', 'b'] })).toEqual({})
  })
  it('เพิ่ม/ลบรายการ → ส่งรายการใหม่', () => {
    expect(changedFields(base, { projectIds: ['a', 'b', 'c'] })).toEqual({ projectIds: ['a', 'b', 'c'] })
    expect(changedFields(base, { projectIds: ['a'] })).toEqual({ projectIds: ['a'] })
  })
})

describe('changedFields — ช่องตัวเลขที่ draft เก็บเป็นข้อความ', () => {
  it('"5" เทียบกับ 5 = ไม่เปลี่ยน · "6" เทียบกับ 5 = เปลี่ยน', () => {
    expect(changedFields({ n: 5 as number | null }, { n: '5' })).toEqual({})
    expect(changedFields({ n: 5 as number | null }, { n: '6' })).toEqual({ n: '6' })
    expect(changedFields({ n: null as number | null }, { n: '' })).toEqual({})
  })
})
