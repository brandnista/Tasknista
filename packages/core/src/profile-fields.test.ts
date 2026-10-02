import { describe, expect, it } from 'vitest'
import { isSelfEditableProfileField, selfEditableProfileFields } from './profile-fields'

describe('selfEditableProfileFields — ฟิลด์ข้อมูลส่วนตัวที่แต่ละกลุ่มผู้ใช้แก้เองได้ในหน้า "โปรไฟล์ของฉัน"', () => {
  it('พนักงาน (owner/member): เบอร์โทร ที่อยู่ เลขบัตร ผู้ติดต่อฉุกเฉิน — ไม่มีฟิลด์ที่ HR ดูแล', () => {
    for (const role of ['owner', 'member'] as const) {
      expect(selfEditableProfileFields(role)).toEqual(['phone', 'address', 'idCardNumber', 'emergencyContactName', 'emergencyContactPhone'])
    }
    for (const hrOnly of ['jobTitle', 'managerId', 'teamId', 'startDate', 'employeeCode', 'contractType', 'costPerDaySatang']) {
      expect(isSelfEditableProfileField('member', hrOnly)).toBe(false)
    }
  })

  it('พาร์ทเนอร์ (vendor): ชื่อธุรกิจ เบอร์มือถือ ความเชี่ยวชาญ บัญชีธนาคาร คำนำหน้า เลขบัตร/Tax ID สาขา — แต่ไม่รวมสัญญา/ประเภท', () => {
    const f = selfEditableProfileFields('vendor')
    expect(f).toEqual(['businessName', 'phone', 'specialty', 'bankAccount', 'prefix', 'idCardNumber', 'branchType', 'branchCode'])
    expect(isSelfEditableProfileField('vendor', 'contractType')).toBe(false)
    expect(isSelfEditableProfileField('vendor', 'classificationType')).toBe(false)
    expect(isSelfEditableProfileField('vendor', 'specialNote')).toBe(false)
  })

  it('ลูกค้า (guest): ไม่มีฟิลด์เพิ่ม · role แปลก → ไม่มี', () => {
    expect(selfEditableProfileFields('guest')).toEqual([])
    expect(selfEditableProfileFields('xxx' as never)).toEqual([])
  })

  it('พนักงานแก้ฟิลด์ของพาร์ทเนอร์ไม่ได้ และกลับกัน', () => {
    expect(isSelfEditableProfileField('member', 'bankAccount')).toBe(false)
    expect(isSelfEditableProfileField('vendor', 'emergencyContactName')).toBe(false)
  })
})
