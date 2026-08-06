/**
 * Pronista §Subscription Notify — ช่วงเวลาให้บริการต่อโปรเจกต์ (1 ช่วงเวลา/โปรเจกต์ ตั้งตอนสร้าง)
 * แคตตาล็อกประเภทโปรเจกต์ (Website Dev/Mobile App/ฯลฯ) เก็บเป็น JSON ใน company_config.serviceTypes
 * projects.serviceType อ้าง id ที่นี่ (ไม่มี DB-level FK — เหมือน positions/board-preset)
 * pure ล้วน รับ `today` เป็น string 'YYYY-MM-DD' เข้า (ไม่มี Date.now — ดู time.ts/crm.ts)
 */
import { daysBetweenISO } from './crm'

export interface ServiceType {
  id: string
  name: string
  sortOrder: number
}

/** ค่าเริ่มต้น = 5 ประเภทตามที่กำหนดไว้ตอนออกแบบฟีเจอร์ (seed ตอน migrate — แก้ไข/เพิ่ม/ลบได้ที่ตั้งค่าภายหลัง) */
export const DEFAULT_SERVICE_TYPES: ServiceType[] = [
  { id: 'svc_website_dev', name: 'Website Development', sortOrder: 0 },
  { id: 'svc_mobile_app', name: 'Mobile Application Development', sortOrder: 1 },
  { id: 'svc_digital_marketing', name: 'Digital Marketing', sortOrder: 2 },
  { id: 'svc_digital_production', name: 'Digital Production', sortOrder: 3 },
  { id: 'svc_ecommerce_mgmt', name: 'E-Commerce Management', sortOrder: 4 },
]

export function resolveServiceTypes(raw: ServiceType[] | null | undefined): ServiceType[] {
  const list = raw && raw.length > 0 ? raw : DEFAULT_SERVICE_TYPES
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder)
}

export function serviceTypeById(raw: ServiceType[] | null | undefined, id: string | null | undefined): ServiceType | undefined {
  if (!id) return undefined
  return resolveServiceTypes(raw).find((s) => s.id === id)
}

/**
 * ใกล้หมดอายุหรือหมดอายุไปแล้ว (ยังไม่ต่ออายุ) — ใช้ทั้งคัดกรอง Dashboard และ cron แจ้งเตือน
 * lifetime (serviceEndDate null) หรือไม่ได้ตั้งวันแจ้งเตือนล่วงหน้า → false เสมอ
 */
export function isNearExpiry(
  serviceEndDate: string | null | undefined,
  notifyBeforeDays: number | null | undefined,
  today: string,
): boolean {
  if (!serviceEndDate || notifyBeforeDays == null) return false
  return daysBetweenISO(today, serviceEndDate) <= notifyBeforeDays
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** ตรวจ config ที่จะบันทึก (CRUD ผ่าน API) — คืน error ภาษาไทยถ้าไม่ผ่าน */
export function validateServiceTypes(list: ServiceType[]): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: 'ต้องมีอย่างน้อย 1 ประเภทโปรเจกต์' }
  const ids = new Set<string>()
  for (const s of list) {
    if (!ID_RE.test(s.id)) return { ok: false, error: `id ประเภทโปรเจกต์ไม่ถูกต้อง: ${s.id}` }
    if (ids.has(s.id)) return { ok: false, error: `id ประเภทโปรเจกต์ซ้ำ: ${s.id}` }
    ids.add(s.id)
    const name = s.name?.trim() ?? ''
    if (name.length === 0 || name.length > 60) return { ok: false, error: 'ชื่อประเภทโปรเจกต์ต้องยาว 1–60 ตัว' }
  }
  return { ok: true }
}
