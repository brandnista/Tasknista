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
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: 'ต้องมีอย่างน้อย 1 ประเภทบริการ' }
  const ids = new Set<string>()
  for (const s of list) {
    if (!ID_RE.test(s.id)) return { ok: false, error: `id ประเภทบริการไม่ถูกต้อง: ${s.id}` }
    if (ids.has(s.id)) return { ok: false, error: `id ประเภทบริการซ้ำ: ${s.id}` }
    ids.add(s.id)
    const name = s.name?.trim() ?? ''
    if (name.length === 0 || name.length > 60) return { ok: false, error: 'ชื่อประเภทบริการต้องยาว 1–60 ตัว' }
  }
  return { ok: true }
}

/**
 * Pronista §Subscription Notify (Product Type) — แคตตาล็อกชื่อผลิตภัณฑ์ (Sellnista/Paynista/ฯลฯ) ใช้เมื่อ category='product'
 * โครงสร้าง/พฤติกรรมเหมือน ServiceType ทุกอย่าง (คนละแคตตาล็อกกัน — service สำหรับ category='project', product สำหรับ category='product')
 */
export interface ProductType {
  id: string
  name: string
  sortOrder: number
}

/** ค่าเริ่มต้น = รายชื่อผลิตภัณฑ์ในเครือ Brandnista ตามที่กำหนดไว้ตอนออกแบบฟีเจอร์ (seed ตอน migrate — แก้ไข/เพิ่ม/ลบได้ที่ตั้งค่าภายหลัง) */
export const DEFAULT_PRODUCT_TYPES: ProductType[] = [
  { id: 'prd_sellnista', name: 'Sellnista', sortOrder: 0 },
  { id: 'prd_paynista', name: 'Paynista', sortOrder: 1 },
  { id: 'prd_signnista', name: 'Signnista', sortOrder: 2 },
  { id: 'prd_sharenista', name: 'Sharenista', sortOrder: 3 },
  { id: 'prd_munista', name: 'Munista', sortOrder: 4 },
  { id: 'prd_jobnista', name: 'Jobnista', sortOrder: 5 },
  { id: 'prd_auctionnista', name: 'Auctionnista', sortOrder: 6 },
  { id: 'prd_allnista', name: 'Allnista', sortOrder: 7 },
  { id: 'prd_beautynista', name: 'Beautynista', sortOrder: 8 },
  { id: 'prd_brandnista', name: 'Brandnista', sortOrder: 9 },
  { id: 'prd_pronista', name: 'Pronista', sortOrder: 10 },
  { id: 'prd_packnista', name: 'Packnista', sortOrder: 11 },
]

export function resolveProductTypes(raw: ProductType[] | null | undefined): ProductType[] {
  const list = raw && raw.length > 0 ? raw : DEFAULT_PRODUCT_TYPES
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder)
}

export function productTypeById(raw: ProductType[] | null | undefined, id: string | null | undefined): ProductType | undefined {
  if (!id) return undefined
  return resolveProductTypes(raw).find((p) => p.id === id)
}

/** ตรวจ config ที่จะบันทึก (CRUD ผ่าน API) — คืน error ภาษาไทยถ้าไม่ผ่าน */
export function validateProductTypes(list: ProductType[]): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: 'ต้องมีอย่างน้อย 1 ประเภทสินค้า' }
  const ids = new Set<string>()
  for (const p of list) {
    if (!ID_RE.test(p.id)) return { ok: false, error: `id ประเภทสินค้าไม่ถูกต้อง: ${p.id}` }
    if (ids.has(p.id)) return { ok: false, error: `id ประเภทสินค้าซ้ำ: ${p.id}` }
    ids.add(p.id)
    const name = p.name?.trim() ?? ''
    if (name.length === 0 || name.length > 60) return { ok: false, error: 'ชื่อประเภทสินค้าต้องยาว 1–60 ตัว' }
  }
  return { ok: true }
}

/**
 * Pronista §กำหนดต้นทุน — จับคู่ตำแหน่ง (อ้าง Parameter Role — ดู parameter-role.ts) กับต้นทุน/วัน ใช้ใน Tab "Project Estimate"
 * แยกจาก positions (สิทธิ์โปรเจกต์) โดยเจตนา — อันนี้เป็นแค่ rate card ไม่มีเรื่องสิทธิ์
 * PM เลือก Role ต่อ Task ได้เอง (ไม่ผูกกับคนคนเดียวตายตัว) — คนเดียวกันรับ Role ต่างกันคนละ Task ได้ ต้นทุน/วันจึงมาจาก Role ไม่ใช่จากคน
 * ชื่อตำแหน่งไม่ได้เก็บซ้ำที่นี่ — อ้าง roleId ไปที่ company_config.parameterRoles เสมอ (ไม่มี DB-level FK)
 */
export interface CostRole {
  roleId: string
  costPerDaySatang: number
  sortOrder: number
}

export const DEFAULT_COST_ROLES: CostRole[] = []

export function resolveCostRoles(raw: CostRole[] | null | undefined): CostRole[] {
  const list = raw && raw.length > 0 ? raw : DEFAULT_COST_ROLES
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder)
}

export function costRoleByRoleId(raw: CostRole[] | null | undefined, roleId: string | null | undefined): CostRole | undefined {
  if (!roleId) return undefined
  return resolveCostRoles(raw).find((r) => r.roleId === roleId)
}

/** ตรวจ config ที่จะบันทึก (CRUD ผ่าน API) — คืน error ภาษาไทยถ้าไม่ผ่าน */
export function validateCostRoles(list: CostRole[]): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(list)) return { ok: false, error: 'ข้อมูลไม่ถูกต้อง' }
  const roleIds = new Set<string>()
  for (const r of list) {
    if (!r.roleId || typeof r.roleId !== 'string') return { ok: false, error: 'ต้องเลือกตำแหน่งทุกแถว' }
    if (roleIds.has(r.roleId)) return { ok: false, error: 'ตำแหน่งซ้ำ — เลือกตำแหน่งได้แค่ครั้งเดียวต่อรายการ' }
    roleIds.add(r.roleId)
    if (!Number.isInteger(r.costPerDaySatang) || r.costPerDaySatang < 0) return { ok: false, error: 'ต้นทุน/วันต้องเป็นจำนวนเต็มไม่ติดลบ' }
  }
  return { ok: true }
}
