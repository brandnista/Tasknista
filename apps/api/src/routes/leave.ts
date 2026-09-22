import { bkkDateOf, computeLeaveBalance, leaveDaysInclusive } from '@seedoffice/core'
import { calendarEvents, createDb, leaveRequests, leaveTypes, users, type Db } from '@seedoffice/db'
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { notifyUser } from '../lib/notify'
import type { AppEnv } from '../types'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15MB ต่อไฟล์ — mirror task-detail.ts

/** owner ทุกคน (ไม่ลบ deletedAt เพราะ users ไม่มี soft-delete ที่นี่ ใช้ pattern เดียวกับที่อื่นในระบบ) — fallback ผู้อนุมัติเมื่อผู้ยื่นไม่มี manager */
async function ownerUserIds(db: Db): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.role, 'owner'))
  return rows.map((r) => r.id)
}

/** Pronista §Leave Request (2026-09-22, Phase 1) — mount ด้วย requireAuth + teamOnly (vendor/guest ❌ เหมือน expenses) */
export const leaveRoutes = new Hono<AppEnv>()

  // การ์ดประเภทลา + โควตา/เหลือ/รออนุมัติ ของปีปัจจุบัน (Asia/Bangkok)
  .get('/types', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const year = bkkDateOf(Date.now()).slice(0, 4)
    const [types, myRequests] = await Promise.all([
      db.select().from(leaveTypes).where(eq(leaveTypes.active, true)).orderBy(leaveTypes.sortOrder),
      db
        .select({ leaveTypeId: leaveRequests.leaveTypeId, status: leaveRequests.status, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate })
        .from(leaveRequests)
        .where(and(eq(leaveRequests.userId, me.id), gte(leaveRequests.startDate, `${year}-01-01`), lte(leaveRequests.startDate, `${year}-12-31`))),
    ])
    const role = me.role === 'owner' || me.role === 'member' || me.role === 'vendor' ? me.role : 'member'
    return c.json({
      types: types.map((t) => {
        const quota = t.quotaDaysByRole?.[role] ?? null
        const approvedDays = myRequests.filter((r) => r.leaveTypeId === t.id && r.status === 'approved').reduce((s, r) => s + leaveDaysInclusive(r.startDate, r.endDate), 0)
        const pendingDays = myRequests.filter((r) => r.leaveTypeId === t.id && r.status === 'pending').reduce((s, r) => s + leaveDaysInclusive(r.startDate, r.endDate), 0)
        return { ...t, balance: computeLeaveBalance(quota, approvedDays, pendingDays) }
      }),
    })
  })

  // ยื่นคำขอลา (multipart ถ้ามีไฟล์แนบ)
  .post('/', async (c) => {
    const form = await c.req.formData()
    const parsed = z
      .object({
        leaveTypeId: z.string().min(1),
        startDate: isoDate,
        endDate: isoDate,
        reason: z.string().max(2000).optional(),
      })
      .safeParse({
        leaveTypeId: form.get('leaveTypeId'),
        startDate: form.get('startDate'),
        endDate: form.get('endDate'),
        reason: form.get('reason') || undefined,
      })
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid' }, 400)
    if (parsed.data.endDate < parsed.data.startDate) return c.json({ error: 'invalid_range' }, 400)

    const db = createDb(c.env.DB)
    const me = c.get('user')
    const leaveType = (await db.select().from(leaveTypes).where(eq(leaveTypes.id, parsed.data.leaveTypeId)).limit(1))[0]
    if (!leaveType || !leaveType.active) return c.json({ error: 'not_found' }, 404)
    if (leaveType.requiresReason && !parsed.data.reason?.trim()) return c.json({ error: 'reason_required' }, 400)

    let attachment: { r2Key: string; filename: string; mime: string; sizeBytes: number } | null = null
    const file = form.get('attachment')
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_FILE_BYTES) return c.json({ error: 'file_too_large' }, 413)
      const safeName = file.name.replaceAll('/', '_').slice(0, 120)
      const r2Key = `leaves/${crypto.randomUUID()}-${safeName}`
      await c.env.FILES.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } })
      attachment = { r2Key, filename: safeName, mime: file.type || 'application/octet-stream', sizeBytes: file.size }
    }
    if (leaveType.requiresAttachment && !attachment) return c.json({ error: 'attachment_required' }, 400)

    const meRow = (await db.select({ managerId: users.managerId }).from(users).where(eq(users.id, me.id)).limit(1))[0]
    const approverId = meRow?.managerId ?? null

    const inserted = (
      await db
        .insert(leaveRequests)
        .values({
          userId: me.id,
          leaveTypeId: leaveType.id,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          reason: parsed.data.reason?.trim() || null,
          approverId,
          attachmentR2Key: attachment?.r2Key ?? null,
          attachmentFilename: attachment?.filename ?? null,
          attachmentMime: attachment?.mime ?? null,
          attachmentSizeBytes: attachment?.sizeBytes ?? null,
        })
        .returning()
    )[0]!

    await writeAudit(c.env, {
      actorId: me.id,
      action: 'leave_request.create',
      entity: 'leave_request',
      entityId: inserted.id,
      meta: { leaveTypeId: leaveType.id, startDate: inserted.startDate, endDate: inserted.endDate },
    })

    const recipients = approverId ? [approverId] : await ownerUserIds(db)
    for (const userId of recipients) {
      await notifyUser(db, { userId, type: 'leave_requested', message: `${me.name} ยื่นขอ${leaveType.name}`, taskId: null })
    }

    return c.json(inserted, 201)
  })

  // ประวัติของฉัน ทุกสถานะ
  .get('/mine', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const rows = await db
      .select({ req: leaveRequests, leaveTypeName: leaveTypes.name })
      .from(leaveRequests)
      .leftJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .where(eq(leaveRequests.userId, me.id))
      .orderBy(desc(leaveRequests.createdAt))
    return c.json({ rows: rows.map((r) => ({ ...r.req, leaveTypeName: r.leaveTypeName })) })
  })

  // คำขอที่รอฉันอนุมัติ (approverId ตรง หรือ owner เห็นทุกคำขอ)
  .get('/pending', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const cond = me.role === 'owner' ? eq(leaveRequests.status, 'pending') : and(eq(leaveRequests.approverId, me.id), eq(leaveRequests.status, 'pending'))
    const rows = await db
      .select({ req: leaveRequests, leaveTypeName: leaveTypes.name, userName: users.name })
      .from(leaveRequests)
      .leftJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .leftJoin(users, eq(leaveRequests.userId, users.id))
      .where(cond)
      .orderBy(desc(leaveRequests.createdAt))
    return c.json({ rows: rows.map((r) => ({ ...r.req, leaveTypeName: r.leaveTypeName, userName: r.userName })) })
  })

  .post('/:id/approve', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select().from(leaveRequests).where(eq(leaveRequests.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    if (before.status !== 'pending') return c.json({ error: 'not_pending' }, 409)
    if (me.role !== 'owner' && before.approverId !== me.id) return c.json({ error: 'forbidden' }, 403)

    const leaveType = (await db.select().from(leaveTypes).where(eq(leaveTypes.id, before.leaveTypeId)).limit(1))[0]
    const event = (
      await db
        .insert(calendarEvents)
        .values({ type: 'leave', userId: before.userId, startDate: before.startDate, endDate: before.endDate, title: `ลา: ${leaveType?.name ?? ''}`, createdBy: me.id })
        .returning()
    )[0]!

    const updated = (
      await db
        .update(leaveRequests)
        .set({ status: 'approved', decidedBy: me.id, decidedAt: new Date(), calendarEventId: event.id })
        .where(eq(leaveRequests.id, before.id))
        .returning()
    )[0]!

    await writeAudit(c.env, { actorId: me.id, action: 'leave_request.approve', entity: 'leave_request', entityId: before.id, meta: {} })
    await notifyUser(db, { userId: before.userId, type: 'leave_approved', message: `คำขอ${leaveType?.name ?? 'ลา'}ของคุณได้รับการอนุมัติแล้ว`, taskId: null })
    return c.json(updated)
  })

  .post('/:id/reject', async (c) => {
    const body = z.object({ reason: z.string().min(1).max(2000) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select().from(leaveRequests).where(eq(leaveRequests.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    if (before.status !== 'pending') return c.json({ error: 'not_pending' }, 409)
    if (me.role !== 'owner' && before.approverId !== me.id) return c.json({ error: 'forbidden' }, 403)

    const leaveType = (await db.select().from(leaveTypes).where(eq(leaveTypes.id, before.leaveTypeId)).limit(1))[0]
    const updated = (
      await db
        .update(leaveRequests)
        .set({ status: 'rejected', decidedBy: me.id, decidedAt: new Date(), rejectReason: body.data.reason })
        .where(eq(leaveRequests.id, before.id))
        .returning()
    )[0]!

    await writeAudit(c.env, { actorId: me.id, action: 'leave_request.reject', entity: 'leave_request', entityId: before.id, meta: { reason: body.data.reason } })
    await notifyUser(db, { userId: before.userId, type: 'leave_rejected', message: `คำขอ${leaveType?.name ?? 'ลา'}ของคุณถูกปฏิเสธ: ${body.data.reason}`, taskId: null })
    return c.json(updated)
  })

  .post('/:id/withdraw', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select().from(leaveRequests).where(eq(leaveRequests.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    if (before.userId !== me.id) return c.json({ error: 'forbidden' }, 403)
    if (before.status !== 'pending') return c.json({ error: 'not_pending' }, 409)
    const updated = (await db.update(leaveRequests).set({ status: 'withdrawn' }).where(eq(leaveRequests.id, before.id)).returning())[0]!
    await writeAudit(c.env, { actorId: me.id, action: 'leave_request.withdraw', entity: 'leave_request', entityId: before.id, meta: {} })
    return c.json(updated)
  })

  // ไฟล์แนบ (ใบรับรองแพทย์ ฯลฯ) — เฉพาะผู้ยื่น/ผู้อนุมัติที่ถูกระบุ/owner
  .get('/:id/attachment', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const row = (await db.select().from(leaveRequests).where(eq(leaveRequests.id, c.req.param('id'))).limit(1))[0]
    if (!row?.attachmentR2Key) return c.json({ error: 'not_found' }, 404)
    if (me.role !== 'owner' && row.userId !== me.id && row.approverId !== me.id) return c.json({ error: 'forbidden' }, 403)
    const obj = await c.env.FILES.get(row.attachmentR2Key)
    if (!obj) return c.json({ error: 'object_missing' }, 404)
    return new Response(obj.body, {
      headers: {
        'content-type': row.attachmentMime ?? 'application/octet-stream',
        'content-disposition': `attachment; filename="${encodeURIComponent(row.attachmentFilename ?? 'attachment')}"`,
        'cache-control': 'private, max-age=3600',
      },
    })
  })
