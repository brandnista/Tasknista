import { bkkDateOf, computeLeaveBalance, leaveDaysInclusive, LEAVE_ICON_NAMES } from '@seedoffice/core'
import { createDb, leaveBalanceAdjustments, leaveRequests, leaveTypes, users } from '@seedoffice/db'
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import type { AppEnv } from '../types'

const leaveTypeBody = z.object({
  name: z.string().min(1).max(100),
  icon: z.enum(LEAVE_ICON_NAMES).nullable().optional(),
  requiresReason: z.boolean().default(true),
  requiresAttachment: z.boolean().default(false),
  quotaDaysByRole: z
    .object({ owner: z.number().int().min(0).optional(), member: z.number().int().min(0).optional(), vendor: z.number().int().min(0).optional() })
    .nullable()
    .optional(),
  sortOrder: z.number().int().default(0),
})

/** Pronista §Leave Request Phase 2 (2026-09-22) — เฉพาะ owner: จัดการประเภทลา + ภาพรวมทั้งทีม + ปรับยอด backfill — mount ด้วย ownerOnly */
export const leaveAdminRoutes = new Hono<AppEnv>()

  // ประเภทลาทั้งหมด (รวม inactive) — สำหรับแท็บ "ตั้งค่าประเภทลา"
  .get('/types', async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db.select().from(leaveTypes).orderBy(leaveTypes.sortOrder)
    return c.json({ types: rows })
  })

  .post('/types', async (c) => {
    const body = leaveTypeBody.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const inserted = (await db.insert(leaveTypes).values(body.data).returning())[0]!
    await writeAudit(c.env, { actorId: c.get('user').id, action: 'leave_type.create', entity: 'leave_type', entityId: inserted.id, meta: { name: inserted.name } })
    return c.json(inserted, 201)
  })

  // แก้ไขทุกฟิลด์ รวม active (ปิดใช้งาน = soft-delete — leave_requests เก่ายังอ้าง leaveTypeId อยู่ ห้ามลบจริง)
  .patch('/types/:id', async (c) => {
    const body = leaveTypeBody.partial().extend({ active: z.boolean().optional() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const updated = await db.update(leaveTypes).set(body.data).where(eq(leaveTypes.id, c.req.param('id'))).returning()
    if (!updated[0]) return c.json({ error: 'not_found' }, 404)
    await writeAudit(c.env, { actorId: c.get('user').id, action: 'leave_type.update', entity: 'leave_type', entityId: updated[0].id, meta: body.data })
    return c.json(updated[0])
  })

  // ภาพรวมการลาทั้งทีม (matrix user × ประเภทลา) ของปีที่ระบุ (default ปีปัจจุบัน)
  .get('/overview', async (c) => {
    const db = createDb(c.env.DB)
    const year = c.req.query('year') ?? bkkDateOf(Date.now()).slice(0, 4)
    const [teamUsers, types, allRequests, allAdjustments] = await Promise.all([
      db
        .select({ id: users.id, name: users.name, role: users.role })
        .from(users)
        .where(and(eq(users.status, 'active'), inArray(users.role, ['owner', 'member', 'vendor']))),
      db.select().from(leaveTypes).where(eq(leaveTypes.active, true)).orderBy(leaveTypes.sortOrder),
      db
        .select({ userId: leaveRequests.userId, leaveTypeId: leaveRequests.leaveTypeId, status: leaveRequests.status, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate })
        .from(leaveRequests)
        .where(and(gte(leaveRequests.startDate, `${year}-01-01`), lte(leaveRequests.startDate, `${year}-12-31`))),
      db
        .select({ userId: leaveBalanceAdjustments.userId, leaveTypeId: leaveBalanceAdjustments.leaveTypeId, days: leaveBalanceAdjustments.days })
        .from(leaveBalanceAdjustments)
        .where(eq(leaveBalanceAdjustments.year, year)),
    ])

    const cells = teamUsers.flatMap((u) =>
      types.map((t) => {
        const quota = t.quotaDaysByRole?.[u.role as 'owner' | 'member' | 'vendor'] ?? null
        const approvedDays = allRequests.filter((r) => r.userId === u.id && r.leaveTypeId === t.id && r.status === 'approved').reduce((s, r) => s + leaveDaysInclusive(r.startDate, r.endDate), 0)
        const adjustedDays = allAdjustments.filter((a) => a.userId === u.id && a.leaveTypeId === t.id).reduce((s, a) => s + a.days, 0)
        const pendingDays = allRequests.filter((r) => r.userId === u.id && r.leaveTypeId === t.id && r.status === 'pending').reduce((s, r) => s + leaveDaysInclusive(r.startDate, r.endDate), 0)
        return { userId: u.id, leaveTypeId: t.id, ...computeLeaveBalance(quota, approvedDays + adjustedDays, pendingDays) }
      }),
    )

    return c.json({
      year,
      users: teamUsers.map((u) => ({ id: u.id, name: u.name, role: u.role })),
      types: types.map((t) => ({ id: t.id, name: t.name })),
      cells,
    })
  })

  // ปรับยอดวันลา (backfill ก่อนขึ้นระบบ/แก้ยอดผิด) — insert-only, แก้ผิดด้วยการลบแถว (ดู DELETE ด้านล่าง) หรือ insert แถวหักล้าง
  .post('/adjustments', async (c) => {
    const body = z
      .object({
        userId: z.string().min(1),
        leaveTypeId: z.string().min(1),
        year: z.string().regex(/^\d{4}$/),
        days: z.number().int().refine((n) => n !== 0, { message: 'days ห้ามเป็น 0' }),
        note: z.string().max(300).optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const inserted = (await db.insert(leaveBalanceAdjustments).values({ ...body.data, createdBy: c.get('user').id }).returning())[0]!
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'leave_balance_adjustment.create',
      entity: 'leave_balance_adjustment',
      entityId: inserted.id,
      meta: { userId: body.data.userId, leaveTypeId: body.data.leaveTypeId, days: body.data.days },
    })
    return c.json(inserted, 201)
  })

  // ประวัติการปรับยอด — กรองได้ (โชว์ตอนกดดู breakdown ของ cell ในตารางภาพรวม)
  .get('/adjustments', async (c) => {
    const db = createDb(c.env.DB)
    const userId = c.req.query('userId')
    const leaveTypeId = c.req.query('leaveTypeId')
    const year = c.req.query('year')
    const conds = [
      userId ? eq(leaveBalanceAdjustments.userId, userId) : undefined,
      leaveTypeId ? eq(leaveBalanceAdjustments.leaveTypeId, leaveTypeId) : undefined,
      year ? eq(leaveBalanceAdjustments.year, year) : undefined,
    ].filter((x) => x !== undefined)
    const rows = await db
      .select({ adj: leaveBalanceAdjustments, createdByName: users.name })
      .from(leaveBalanceAdjustments)
      .leftJoin(users, eq(leaveBalanceAdjustments.createdBy, users.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(leaveBalanceAdjustments.createdAt))
    return c.json({ rows: rows.map((r) => ({ ...r.adj, createdByName: r.createdByName })) })
  })

  .delete('/adjustments/:id', async (c) => {
    const db = createDb(c.env.DB)
    const before = (await db.select().from(leaveBalanceAdjustments).where(eq(leaveBalanceAdjustments.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    await db.delete(leaveBalanceAdjustments).where(eq(leaveBalanceAdjustments.id, before.id))
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'leave_balance_adjustment.delete',
      entity: 'leave_balance_adjustment',
      entityId: before.id,
      meta: { userId: before.userId, leaveTypeId: before.leaveTypeId, days: before.days },
    })
    return c.json({ ok: true })
  })
