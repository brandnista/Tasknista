import { isSelfEditableProfileField, PERMISSION_MENU_KEYS, permissionCategoryOfRole, resolvePermissionCeilings, type SelfEditableProfileField } from '@seedoffice/core'
import { companyConfig, createDb, users, type User } from '@seedoffice/db'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types'

const ALL_MENUS_VISIBLE = Object.fromEntries(PERMISSION_MENU_KEYS.map((k) => [k, true])) as Record<(typeof PERMISSION_MENU_KEYS)[number], boolean>

/**
 * โปรไฟล์ตัวเอง (ทุก role) — ดู/แก้ ชื่อจริง/นามสกุล/ชื่อเล่น ของตัวเอง
 * email + role แก้ที่นี่ไม่ได้ (owner provision) · name = display ทั้งแอป → derive จาก nickname || "first last"
 * (หน้า Profile ยังเป็นบ้านของ Access Tokens §4.18 ฝั่ง UI ด้วย)
 */
const nameField = z.string().trim().max(80).nullable()
// Pronista §Profile fields (2026-10-02) — ข้อมูลส่วนตัวที่แก้เองได้ (ตามกลุ่มผู้ใช้ ดู selfEditableProfileFields ใน core) · '' = ล้างช่อง · เลขบัตร 13 หลัก/รหัสสาขา 5 หลัก
const textField = (max: number) => z.string().trim().max(max).nullable().optional()
const digitsField = (n: number) => z.string().trim().refine((v) => v === '' || new RegExp(`^\\d{${n}}$`).test(v), `ต้องเป็นตัวเลข ${n} หลัก`).nullable().optional()
const PERSONAL_SCHEMA = {
  phone: textField(40),
  address: textField(500),
  idCardNumber: digitsField(13),
  emergencyContactName: textField(120),
  emergencyContactPhone: textField(40),
  businessName: textField(160),
  specialty: textField(200),
  bankAccount: textField(200),
  prefix: textField(40),
  branchType: z.union([z.enum(['hq', 'branch']), z.literal('')]).nullable().optional(),
  branchCode: digitsField(5),
} satisfies Record<SelfEditableProfileField, z.ZodType>
const NAME_KEYS = ['firstName', 'lastName', 'nickname']
const profilePatch = z.object({
  firstName: nameField.optional(),
  lastName: nameField.optional(),
  nickname: nameField.optional(),
  ...PERSONAL_SCHEMA,
})

/** display name: ชื่อเล่นมาก่อน → "ชื่อ นามสกุล" → fallback (กันว่าง) */
function displayName(p: {
  firstName: string | null
  lastName: string | null
  nickname: string | null
  fallback: string
}): string {
  const nick = p.nickname?.trim()
  if (nick) return nick
  const full = `${p.firstName?.trim() ?? ''} ${p.lastName?.trim() ?? ''}`.trim()
  return full || p.fallback
}

const meShape = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  avatarUrl: u.avatarUrl,
  firstName: u.firstName,
  lastName: u.lastName,
  nickname: u.nickname,
  // ข้อมูลส่วนตัว (แก้เองได้ — ชุดเดียวกับหน้าจัดการพนักงาน/พาร์ทเนอร์)
  phone: u.phone,
  address: u.address,
  idCardNumber: u.idCardNumber,
  emergencyContactName: u.emergencyContactName,
  emergencyContactPhone: u.emergencyContactPhone,
  businessName: u.businessName,
  specialty: u.specialty,
  bankAccount: u.bankAccount,
  prefix: u.prefix,
  branchType: u.branchType,
  branchCode: u.branchCode,
  // ข้อมูลที่แอดมิน/HR ดูแล (แสดงอย่างเดียว)
  jobTitle: u.jobTitle,
  employeeCode: u.employeeCode,
  startDate: u.startDate,
  contractType: u.contractType,
  contractExpiryDate: u.contractExpiryDate,
  classificationType: u.classificationType,
})

export const profileRoutes = new Hono<AppEnv>()
  // Pronista §System Requirements Update — เมนู sidebar ที่มองเห็นได้ ผูกกับหมวดผู้ใช้งาน (owner เห็นทุกเมนูเสมอ ไม่ผ่านเพดาน)
  .get('/me', async (c) => {
    const me = c.get('user')
    const category = permissionCategoryOfRole(me.role)
    let menuVisibility = ALL_MENUS_VISIBLE
    if (category) {
      const db = createDb(c.env.DB)
      const cfg = (await db.select({ permissionCeilings: companyConfig.permissionCeilings }).from(companyConfig).limit(1))[0]
      menuVisibility = resolvePermissionCeilings(cfg?.permissionCeilings)[category].menus
    }
    // Pronista §Leave Feature Rollback (2026-09-23) — ปิดชั่วคราวเฉพาะ production (พนักงานส่งคำขอลาไม่ได้จริง) mirror pattern importDataEnabled เดิม
    return c.json({ ...meShape(me), menuVisibility, importDataEnabled: c.env.IMPORT_DATA_ENABLED === '1', leaveEnabled: c.env.LEAVE_ENABLED === '1' })
  })

  .patch('/me', async (c) => {
    const raw: unknown = await c.req.json().catch(() => null)
    const me = c.get('user')
    // ส่งฟิลด์นอกสิทธิ์ของกลุ่มตัวเองมา (เช่น พนักงานส่ง jobTitle/ธนาคาร) → ปฏิเสธชัดเจน ไม่เงียบทิ้ง
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const bad = Object.keys(raw).find((k) => !NAME_KEYS.includes(k) && !isSelfEditableProfileField(me.role, k))
      if (bad) return c.json({ error: 'field_not_allowed', field: bad }, 400)
    }
    const body = profilePatch.safeParse(raw)
    if (!body.success || Object.keys(body.data).length === 0) return c.json({ error: 'invalid_body' }, 400)
    // เฉพาะ field ที่ส่งมาเท่านั้นที่เปลี่ยน (partial) · '' → null
    const norm = (v: string | null | undefined) => (v === undefined ? undefined : v === '' ? null : v)
    const merged = {
      firstName: 'firstName' in body.data ? (norm(body.data.firstName) ?? null) : me.firstName,
      lastName: 'lastName' in body.data ? (norm(body.data.lastName) ?? null) : me.lastName,
      nickname: 'nickname' in body.data ? (norm(body.data.nickname) ?? null) : me.nickname,
    }
    const name = displayName({ ...merged, fallback: me.email.split('@')[0] ?? me.email })
    // ข้อมูลส่วนตัว: เฉพาะที่ส่งมา ('' → null) — ที่เหลือไม่ถูกแตะ
    const personal: Record<string, string | null> = {}
    for (const [k, v] of Object.entries(body.data)) {
      if (NAME_KEYS.includes(k)) continue
      personal[k] = norm(v as string | null) ?? null
    }
    const [updated] = await createDb(c.env.DB)
      .update(users)
      .set({ ...merged, ...personal, name })
      .where(eq(users.id, me.id))
      .returning()
    if (!updated) return c.json({ error: 'not_found' }, 404)
    return c.json(meShape(updated))
  })
