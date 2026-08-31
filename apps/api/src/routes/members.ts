import { companyConfig, createDb, memberOrders, memberPayments, members, users } from '@seedoffice/db'
import { isNearExpiry } from '@seedoffice/core'
import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { notifyUser } from '../lib/notify'
import type { AppEnv } from '../types'

/**
 * Pronista §Membership — ระบบสมาชิก (ธุรกิจใหม่แยกจากงานโปรเจกต์ลูกค้าเดิม) — owner-only ทั้งหมด
 * สมาชิกยังไม่ login เข้า Pronista ในเฟสนี้ (ตาราง members แยกจาก users) — flow สมัคร/login จริงเป็นเฟสถัดไป (ยังไม่ทำ)
 */
export const memberRoutes = new Hono<AppEnv>()

const CLASSIFICATION_TYPES = ['ordinary_individual', 'ordinary_juristic', 'extraordinary_individual', 'extraordinary_juristic'] as const

// Pronista §Entity Types Alignment — เลขบัตร ปชช./ทะเบียนนิติบุคคล 13 หลัก, รหัสสาขา 5 หลัก
const ID_CARD_SCHEMA = z
  .string()
  .nullable()
  .optional()
  .refine((v) => !v || /^\d{13}$/.test(v), { message: 'เลขบัตรประชาชน/ทะเบียนนิติบุคคลต้องเป็นตัวเลข 13 หลัก' })
const BRANCH_CODE_SCHEMA = z
  .string()
  .nullable()
  .optional()
  .refine((v) => !v || /^\d{5}$/.test(v), { message: 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก' })

const memberInput = z.object({
  name: z.string().min(1).max(200),
  classificationType: z.enum(CLASSIFICATION_TYPES),
  orgSizeTierId: z.string().nullable().optional(),
  businessName: z.string().max(200).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().nullable().optional(),
  membershipMode: z.enum(['lifetime', 'dated']).default('lifetime'),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  notifyBeforeDays: z.number().int().nonnegative().nullable().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  // Pronista §Entity Types Alignment — ฟิลด์ dynamic ตาม บุคคล/นิติบุคคล
  idCardNumber: ID_CARD_SCHEMA,
  prefix: z.string().max(30).nullable().optional(),
  branchType: z.enum(['hq', 'branch']).nullable().optional(),
  branchCode: BRANCH_CODE_SCHEMA,
  specialNote: z.string().max(1000).nullable().optional(),
})

memberRoutes
  .get('/members', async (c) => {
    const db = createDb(c.env.DB)
    const all = await db.select().from(members).orderBy(desc(members.createdAt))
    return c.json(all)
  })

  .get('/members/settings', async (c) => {
    const db = createDb(c.env.DB)
    const cfg = (await db.select({ membershipFees: companyConfig.membershipFees, memberOrgSizeTiers: companyConfig.memberOrgSizeTiers }).from(companyConfig).limit(1))[0]
    return c.json({
      membershipFees: cfg?.membershipFees ?? CLASSIFICATION_TYPES.map((t, i) => ({ classificationType: t, feeSatang: 0, sortOrder: i })),
      memberOrgSizeTiers: cfg?.memberOrgSizeTiers ?? [],
    })
  })

  .put('/members/settings', async (c) => {
    const body = z
      .object({
        membershipFees: z.array(z.object({ classificationType: z.enum(CLASSIFICATION_TYPES), feeSatang: z.number().int().min(0), sortOrder: z.number().int() })),
        memberOrgSizeTiers: z.array(z.object({ id: z.string(), name: z.string().min(1), feeSatang: z.number().int().min(0), sortOrder: z.number().int() })),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)

    const db = createDb(c.env.DB)
    // กันลบ tier ที่ยังมีสมาชิกใช้อยู่
    const inUse = await db.selectDistinct({ orgSizeTierId: members.orgSizeTierId }).from(members)
    const newTierIds = new Set(body.data.memberOrgSizeTiers.map((t) => t.id))
    const orphan = inUse.map((r) => r.orgSizeTierId).filter((id): id is string => id !== null && !newTierIds.has(id))
    if (orphan.length > 0) return c.json({ error: 'tier_in_use', message: 'ยังมีสมาชิกใช้ระดับขนาดองค์กรนี้อยู่ — เปลี่ยนของสมาชิกนั้นก่อนจึงลบได้' }, 409)

    await db.update(companyConfig).set({ membershipFees: body.data.membershipFees, memberOrgSizeTiers: body.data.memberOrgSizeTiers }).where(eq(companyConfig.id, 1))
    await writeAudit(c.env, { actorId: c.get('user').id, action: 'config.membership_settings', entity: 'company_config', entityId: '1', meta: body.data })
    return c.json(body.data)
  })

  .get('/members/:id', async (c) => {
    const db = createDb(c.env.DB)
    const m = (await db.select().from(members).where(eq(members.id, c.req.param('id'))).limit(1))[0]
    if (!m) return c.json({ error: 'not_found' }, 404)
    return c.json(m)
  })

  .post('/members', async (c) => {
    const body = memberInput.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    if (body.data.classificationType !== 'extraordinary_juristic' && body.data.orgSizeTierId)
      return c.json({ error: 'invalid', message: 'ขนาดองค์กรใช้ได้เฉพาะวิสามัญนิติบุคคล' }, 400)

    const db = createDb(c.env.DB)
    const inserted = (
      await db
        .insert(members)
        .values({
          name: body.data.name,
          classificationType: body.data.classificationType,
          orgSizeTierId: body.data.orgSizeTierId ?? null,
          businessName: body.data.businessName ?? null,
          phone: body.data.phone ?? null,
          email: body.data.email ?? null,
          membershipMode: body.data.membershipMode,
          startDate: body.data.startDate ?? null,
          endDate: body.data.membershipMode === 'dated' ? (body.data.endDate ?? null) : null,
          notifyBeforeDays: body.data.notifyBeforeDays ?? null,
          idCardNumber: body.data.idCardNumber ?? null,
          prefix: body.data.prefix ?? null,
          branchType: body.data.branchType ?? null,
          branchCode: body.data.branchCode ?? null,
          specialNote: body.data.specialNote ?? null,
        })
        .returning()
    )[0]!
    await writeAudit(c.env, { actorId: c.get('user').id, action: 'member.create', entity: 'member', entityId: inserted.id, meta: { name: inserted.name } })
    return c.json(inserted, 201)
  })

  .patch('/members/:id', async (c) => {
    const body = memberInput.partial().safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const before = (await db.select().from(members).where(eq(members.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)

    const patch: Record<string, unknown> = { ...body.data }
    // เปลี่ยน endDate reset expiryNotifiedAt กันไม่แจ้งเตือนซ้ำ/ไม่แจ้งเตือนเลยหลังเลื่อนวันหมดอายุ (มิเรอร์ projects.expiryNotifiedAt)
    if ('endDate' in body.data && body.data.endDate !== before.endDate) patch.expiryNotifiedAt = null
    if (Object.keys(patch).length === 0) return c.json(before)

    const updated = (await db.update(members).set(patch).where(eq(members.id, before.id)).returning())[0]
    await writeAudit(c.env, { actorId: c.get('user').id, action: 'member.update', entity: 'member', entityId: before.id, meta: { before, after: body.data } })
    return c.json(updated)
  })

  .delete('/members/:id', async (c) => {
    const db = createDb(c.env.DB)
    const m = (await db.select().from(members).where(eq(members.id, c.req.param('id'))).limit(1))[0]
    if (!m) return c.json({ error: 'not_found' }, 404)
    await db.update(members).set({ status: 'disabled' }).where(eq(members.id, m.id))
    await writeAudit(c.env, { actorId: c.get('user').id, action: 'member.disable', entity: 'member', entityId: m.id, meta: {} })
    return c.json({ ok: true })
  })

  // รายการสั่งซื้อค่าสมาชิก
  .get('/member-orders', async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db
      .select({ order: memberOrders, memberName: members.name })
      .from(memberOrders)
      .leftJoin(members, eq(members.id, memberOrders.memberId))
      .orderBy(desc(memberOrders.orderedAt))
    return c.json(rows.map((r) => ({ ...r.order, memberName: r.memberName })))
  })

  .post('/members/:id/orders', async (c) => {
    const body = z.object({ feeSatang: z.number().int().nonnegative() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const m = (await db.select().from(members).where(eq(members.id, c.req.param('id'))).limit(1))[0]
    if (!m) return c.json({ error: 'not_found' }, 404)
    const inserted = (await db.insert(memberOrders).values({ memberId: m.id, feeSatang: body.data.feeSatang }).returning())[0]!
    await writeAudit(c.env, { actorId: c.get('user').id, action: 'member_order.create', entity: 'member_order', entityId: inserted.id, meta: { memberId: m.id, feeSatang: body.data.feeSatang } })
    return c.json(inserted, 201)
  })

  // ประวัติการชำระเงินค่าสมาชิก
  .get('/member-payments', async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db
      .select({ payment: memberPayments, memberName: members.name })
      .from(memberPayments)
      .leftJoin(members, eq(members.id, memberPayments.memberId))
      .orderBy(desc(memberPayments.paidAt))
    return c.json(rows.map((r) => ({ ...r.payment, memberName: r.memberName })))
  })

  .post('/member-orders/:orderId/payments', async (c) => {
    const body = z.object({ amountSatang: z.number().int().nonnegative(), method: z.string().max(60).nullable().optional() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const order = (await db.select().from(memberOrders).where(eq(memberOrders.id, c.req.param('orderId'))).limit(1))[0]
    if (!order) return c.json({ error: 'not_found' }, 404)
    const inserted = (
      await db.insert(memberPayments).values({ memberId: order.memberId, orderId: order.id, amountSatang: body.data.amountSatang, method: body.data.method ?? null }).returning()
    )[0]!
    await db.update(memberOrders).set({ status: 'paid' }).where(eq(memberOrders.id, order.id))
    await writeAudit(c.env, { actorId: c.get('user').id, action: 'member_payment.create', entity: 'member_payment', entityId: inserted.id, meta: { orderId: order.id, amountSatang: body.data.amountSatang } })
    return c.json(inserted, 201)
  })

// ใช้เฉพาะ scheduled.ts — คืนจำนวนสมาชิกที่แจ้งเตือนไป (มิเรอร์ notifyExpiringProjects แต่แยกฟังก์ชันเพราะคนละตาราง/ผู้รับ)
export async function notifyExpiringMembers(db: ReturnType<typeof createDb>, today: string) {
  const candidates = await db
    .select()
    .from(members)
    .where(and(eq(members.status, 'active'), eq(members.membershipMode, 'dated')))
  let notified = 0
  for (const m of candidates) {
    if (m.expiryNotifiedAt) continue
    if (!isNearExpiry(m.endDate, m.notifyBeforeDays, today)) continue
    const owners = await db.select({ id: users.id }).from(users).where(eq(users.role, 'owner'))
    for (const o of owners) {
      await notifyUser(db, {
        userId: o.id,
        type: 'member_expiry_reminder',
        memberId: m.id,
        message: `สมาชิก "${m.name}" ใกล้หมดอายุ (${m.endDate})`,
      })
    }
    await db.update(members).set({ expiryNotifiedAt: new Date() }).where(eq(members.id, m.id))
    notified++
  }
  return notified
}
