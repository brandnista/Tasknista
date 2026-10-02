/**
 * Pronista §Profile fields (2026-10-02) — ฟิลด์ที่ผู้ใช้แก้ได้เองในหน้า "โปรไฟล์ของฉัน"
 * ข้อมูลชุดเดียวกับหน้า จัดการพนักงาน / จัดการพาร์ทเนอร์ (ตาราง users เดียวกัน) — กรอกที่โปรไฟล์แล้วโผล่ในหน้านั้นอัตโนมัติ
 * เฉพาะ "ข้อมูลส่วนตัว" — ฟิลด์ที่แอดมิน/HR ดูแล (ตำแหน่ง ทีม หัวหน้า วันเริ่มงาน รหัสพนักงาน สัญญา ประเภท ต้นทุน) แก้เองไม่ได้
 */
export type ProfileRole = 'owner' | 'member' | 'vendor' | 'guest'

const STAFF_FIELDS = ['phone', 'address', 'idCardNumber', 'emergencyContactName', 'emergencyContactPhone'] as const
const PARTNER_FIELDS = ['businessName', 'phone', 'specialty', 'bankAccount', 'prefix', 'idCardNumber', 'branchType', 'branchCode'] as const

export type SelfEditableProfileField = (typeof STAFF_FIELDS)[number] | (typeof PARTNER_FIELDS)[number]

export function selfEditableProfileFields(role: ProfileRole): SelfEditableProfileField[] {
  if (role === 'owner' || role === 'member') return [...STAFF_FIELDS]
  if (role === 'vendor') return [...PARTNER_FIELDS]
  return []
}

export function isSelfEditableProfileField(role: ProfileRole, field: string): boolean {
  return (selfEditableProfileFields(role) as string[]).includes(field)
}
