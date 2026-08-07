import type { Me } from './auth'

/** ป้ายชื่อ role บริษัท (global) — DB เก็บค่าเดิม owner/member/vendor/guest เสมอ (ทั้งแอปอ้างค่านี้อยู่)
 * เปลี่ยนแค่ข้อความที่แสดงผล: owner → "Admin" · member → "พนักงาน" (ตามเดิม) · vendor → "ผู้รับจ้าง" · guest → "Guest"
 * guest มีสิทธิ์เข้าถึงเหมือน vendor ทุกอย่าง (external, view-only) แค่แยก label ไว้จัดกลุ่มคนละประเภท (เช่น ลูกค้า vs ผู้รับจ้างภายนอก)
 * "หัวหน้า" ไม่ใช่ role นี้ — คือคนที่ถูกตั้งเป็น editor ของโปรเจกต์ใดโปรเจกต์หนึ่ง (ดู project-role.ts) */
export const ROLE_LABEL: Record<Me['role'], string> = {
  owner: 'Admin',
  member: 'พนักงาน',
  vendor: 'ผู้รับจ้าง',
  guest: 'Guest',
}

export const ROLE_BADGE: Record<Me['role'], string> = {
  owner: 'bg-brand-100 text-brand-700',
  member: 'bg-divider text-soft',
  vendor: 'bg-warning-100 text-warning-700',
  guest: 'bg-divider text-dim',
}
