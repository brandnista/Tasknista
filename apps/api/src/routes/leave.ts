import { bkkDateOf, computeLeaveBalance, leaveDaysInclusive } from '@seedoffice/core'
import { calendarEvents, createDb, leaveBalanceAdjustments, leaveRequests, leaveTypes, users, type Db } from '@seedoffice/db'
import { and, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { notifyUser } from '../lib/notify'
import type { AppEnv } from '../types'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15MB ต่อไฟล์ — mirror task-detail.ts
const decider = alias(users, 'decider') // Pronista §Leave Request Phase 2 — ชื่อผู้อนุมัติ/ปฏิเสธ (decidedBy) ใน GET /mine ใช้แสดง timeline

/** owner ทุกคน (ไม่ลบ deletedAt เพราะ users ไม่มี soft-delete ที่นี่ ใช้ pattern เดียวกับที่อื่นในระบบ) — fallback ผู้อนุมัติเมื่อผู้ยื่นไม่มี manager */
async function ownerUserIds(db: Db): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.role, 'owner'))
  return rows.map((r) => r.id)
}

export type LeaveRequestRow = typeof leaveRequests.$inferSelect

/** Pronista §Leave Management Overhaul เฟส D (2026-09-23) — 1 คำขอหลายช่วงวันที่ = หลายแถวใน leave_requests แชร์ groupId เดียวกัน
 * approve/reject/withdraw ต้องทำทั้งกลุ่มพร้อมกันเสมอ (atomic) กันเกิด partial state (บางช่วง approved บางช่วง pending) — หาพี่น้องทั้งกลุ่มจาก groupId (ไม่มี groupId = คำขอช่วงเดียว คืนแค่ตัวเอง พฤติกรรมเดิมเป๊ะ) */
async function siblingsOf(db: Db, row: LeaveRequestRow): Promise<LeaveRequestRow[]> {
  if (!row.groupId) return [row]
  return db.select().from(leaveRequests).where(eq(leaveRequests.groupId, row.groupId))
}

/** Pronista §Leave Management Overhaul เฟส D (2026-09-23) — ใช้กับ GET /mine, GET /pending: รวมแถวที่ groupId เดียวกันเป็น 1 รายการ พร้อม ranges[]
 * rows ต้องเรียงตาม desc(createdAt) มาก่อนแล้ว (จาก query) — ลำดับผลลัพธ์คงตามนั้น (Map เก็บ insertion order ของ key แรกที่เจอ) */
export function groupLeaveRows<T extends { req: LeaveRequestRow }>(rows: T[]) {
  const groups = new Map<string, T[]>()
  for (const r of rows) {
    const key = r.req.groupId ?? r.req.id
    const arr = groups.get(key) ?? []
    arr.push(r)
    groups.set(key, arr)
  }
  return [...groups.values()].map((group) => {
    const sorted = [...group].sort((a, b) => a.req.startDate.localeCompare(b.req.startDate))
    const { req, ...joined } = sorted[0]! // แยก req ออกก่อน กัน key "req" ค้างซ้อนอยู่ใน response (อยากได้ field แบนราบ ไม่ใช่ nested)
    return {
      ...joined,
      ...req,
      ranges: sorted.map((g) => ({ id: g.req.id, startDate: g.req.startDate, endDate: g.req.endDate })),
    }
  })
}

/** Pronista §Leave Request (2026-09-22, Phase 1) — mount ด้วย requireAuth + teamOnly (vendor/guest ❌ เหมือน expenses) */
export const leaveRoutes = new Hono<AppEnv>()

  // การ์ดประเภทลา + โควตา/เหลือ/รออนุมัติ ของปีปัจจุบัน (Asia/Bangkok)
  .get('/types', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const year = bkkDateOf(Date.now()).slice(0, 4)
    const [types, myRequests, myAdjustments] = await Promise.all([
      db.select().from(leaveTypes).where(eq(leaveTypes.active, true)).orderBy(leaveTypes.sortOrder),
      db
        .select({ leaveTypeId: leaveRequests.leaveTypeId, status: leaveRequests.status, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate })
        .from(leaveRequests)
        .where(and(eq(leaveRequests.userId, me.id), gte(leaveRequests.startDate, `${year}-01-01`), lte(leaveRequests.startDate, `${year}-12-31`))),
      // Pronista §Leave Request Phase 2 — ยอดที่ Admin backfill ไว้ (เช่น ลาไปแล้วก่อนขึ้นระบบ) พับรวมเข้ายอดที่ใช้ไปด้วย ให้เจ้าตัวเห็นยอดจริง
      db
        .select({ leaveTypeId: leaveBalanceAdjustments.leaveTypeId, days: leaveBalanceAdjustments.days })
        .from(leaveBalanceAdjustments)
        .where(and(eq(leaveBalanceAdjustments.userId, me.id), eq(leaveBalanceAdjustments.year, year))),
    ])
    const role = me.role === 'owner' || me.role === 'member' || me.role === 'vendor' ? me.role : 'member'
    return c.json({
      types: types.map((t) => {
        const quota = t.quotaDaysByRole?.[role] ?? null
        const approvedDays = myRequests.filter((r) => r.leaveTypeId === t.id && r.status === 'approved').reduce((s, r) => s + leaveDaysInclusive(r.startDate, r.endDate), 0)
        const adjustedDays = myAdjustments.filter((a) => a.leaveTypeId === t.id).reduce((s, a) => s + a.days, 0)
        const pendingDays = myRequests.filter((r) => r.leaveTypeId === t.id && r.status === 'pending').reduce((s, r) => s + leaveDaysInclusive(r.startDate, r.endDate), 0)
        return { ...t, balance: computeLeaveBalance(quota, approvedDays + adjustedDays, pendingDays) }
      }),
    })
  })

  // ยื่นคำขอลา (multipart ถ้ามีไฟล์แนบ) — Pronista §Leave Management Overhaul เฟส D (2026-09-23) รองรับหลายช่วงวันที่ในคำขอเดียว (ranges array แทน startDate/endDate เดี่ยว)
  .post('/', async (c) => {
    const form = await c.req.formData()
    let rangesRaw: unknown
    try {
      rangesRaw = JSON.parse(String(form.get('ranges') ?? '[]'))
    } catch {
      return c.json({ error: 'invalid_ranges' }, 400)
    }
    const parsed = z
      .object({
        leaveTypeId: z.string().min(1),
        ranges: z.array(z.object({ startDate: isoDate, endDate: isoDate })).min(1).max(10),
        reason: z.string().max(2000).optional(),
      })
      .safeParse({
        leaveTypeId: form.get('leaveTypeId'),
        ranges: rangesRaw,
        reason: form.get('reason') || undefined,
      })
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'invalid' }, 400)
    for (const r of parsed.data.ranges) {
      if (r.endDate < r.startDate) return c.json({ error: 'invalid_range' }, 400)
    }
    // ช่วงในคำขอเดียวกันห้ามทับกัน (ไม่เช็คกับคำขออื่นที่มีอยู่แล้ว — พฤติกรรมเดิมไม่เคยเช็คแบบนั้น)
    const sortedRanges = [...parsed.data.ranges].sort((a, b) => a.startDate.localeCompare(b.startDate))
    for (let i = 1; i < sortedRanges.length; i++) {
      if (sortedRanges[i]!.startDate <= sortedRanges[i - 1]!.endDate) return c.json({ error: 'ranges_overlap' }, 400)
    }

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
    // groupId เฉพาะตอนมีมากกว่า 1 ช่วง (ช่วงเดียว = null ไม่เพิ่ม overhead, พฤติกรรมแสดงผล/query เดิมเป๊ะ)
    const groupId = parsed.data.ranges.length > 1 ? crypto.randomUUID() : null

    const insertedRows: LeaveRequestRow[] = []
    for (const range of parsed.data.ranges) {
      const inserted = (
        await db
          .insert(leaveRequests)
          .values({
            userId: me.id,
            leaveTypeId: leaveType.id,
            startDate: range.startDate,
            endDate: range.endDate,
            reason: parsed.data.reason?.trim() || null,
            approverId,
            groupId,
            attachmentR2Key: attachment?.r2Key ?? null,
            attachmentFilename: attachment?.filename ?? null,
            attachmentMime: attachment?.mime ?? null,
            attachmentSizeBytes: attachment?.sizeBytes ?? null,
          })
          .returning()
      )[0]!
      insertedRows.push(inserted)
      await writeAudit(c.env, {
        actorId: me.id,
        action: 'leave_request.create',
        entity: 'leave_request',
        entityId: inserted.id,
        meta: { leaveTypeId: leaveType.id, startDate: inserted.startDate, endDate: inserted.endDate, groupId },
      })
    }

    // แจ้งเตือนครั้งเดียวต่อคำขอ (ไม่สแปมทีละช่วง) — สรุปจำนวนช่วงถ้ามากกว่า 1
    const rangeNote = insertedRows.length > 1 ? ` (${insertedRows.length} ช่วง)` : ''
    const recipients = approverId ? [approverId] : await ownerUserIds(db)
    for (const userId of recipients) {
      await notifyUser(db, { userId, type: 'leave_requested', message: `${me.name} ยื่นขอ${leaveType.name}${rangeNote}`, taskId: null, leaveRequestId: insertedRows[0]!.id })
    }

    return c.json(insertedRows.length > 1 ? insertedRows : insertedRows[0], 201)
  })

  // ประวัติของฉัน ทุกสถานะ (รวมชื่อผู้อนุมัติ/ปฏิเสธ ใช้แสดงไทม์ไลน์สถานะ)
  // Pronista §Leave Management Overhaul เฟส D (2026-09-23) — จัดกลุ่มตาม groupId ก่อนส่งกลับ (คำขอหลายช่วง = 1 รายการ พร้อม ranges[] แทนที่จะโชว์แยกเป็นหลายแถว)
  .get('/mine', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const rows = await db
      .select({ req: leaveRequests, leaveTypeName: leaveTypes.name, decidedByName: decider.name })
      .from(leaveRequests)
      .leftJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .leftJoin(decider, eq(leaveRequests.decidedBy, decider.id))
      .where(eq(leaveRequests.userId, me.id))
      .orderBy(desc(leaveRequests.createdAt))
    return c.json({ rows: groupLeaveRows(rows) })
  })

  // คำขอที่รอฉันอนุมัติ — Pronista §Leave Enhancements เฟส C (2026-09-24): จำกัดสิทธิ์เฉพาะหัวหน้าโดยตรง (approverId ตรง)
  // Owner เห็นเฉพาะคำขอที่ approverId ตรงกับตัวเอง หรือคำขอที่ไม่มีหัวหน้าเลย (approverId เป็น null — fallback เดิม)
  .get('/pending', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const cond =
      me.role === 'owner'
        ? and(eq(leaveRequests.status, 'pending'), or(eq(leaveRequests.approverId, me.id), isNull(leaveRequests.approverId)))
        : and(eq(leaveRequests.status, 'pending'), eq(leaveRequests.approverId, me.id))
    const rows = await db
      .select({ req: leaveRequests, leaveTypeName: leaveTypes.name, userName: users.name })
      .from(leaveRequests)
      .leftJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .leftJoin(users, eq(leaveRequests.userId, users.id))
      .where(cond)
      .orderBy(desc(leaveRequests.createdAt))
    return c.json({ rows: groupLeaveRows(rows) })
  })

  // Pronista §Leave Enhancements เฟส D (2026-09-24) — รายชื่อ Owner ทั้งหมด ให้ frontend ใช้เป็นตัวเลือกตอน "โอนสิทธิ์อนุมัติ"
  .get('/owners', async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, 'owner'))
    return c.json({ owners: rows })
  })

  // Pronista §Leave Management Overhaul เฟส D (2026-09-23) — approve/reject/withdraw ทำทั้งกลุ่ม (siblingsOf) พร้อมกันเสมอ กันเกิด partial state ระหว่างช่วงในคำขอเดียวกัน
  .post('/:id/approve', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select().from(leaveRequests).where(eq(leaveRequests.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const group = await siblingsOf(db, before)
    if (group.some((r) => r.status !== 'pending')) return c.json({ error: 'not_pending' }, 409)
    // Pronista §Leave Enhancements เฟส C (2026-09-24) — มีหัวหน้าที่ระบุไว้แล้ว ต้องเป็นคนนั้นเป๊ะเท่านั้น (ตัด Owner bypass) · ไม่มีหัวหน้าเลย → Owner คนไหนก็ได้ (fallback เดิม)
    const allowed = before.approverId ? before.approverId === me.id : me.role === 'owner'
    if (!allowed) return c.json({ error: 'forbidden' }, 403)

    const leaveType = (await db.select().from(leaveTypes).where(eq(leaveTypes.id, before.leaveTypeId)).limit(1))[0]
    const decidedAt = new Date()
    const updatedRows: LeaveRequestRow[] = []
    for (const r of group) {
      const event = (
        await db
          .insert(calendarEvents)
          .values({ type: 'leave', userId: r.userId, startDate: r.startDate, endDate: r.endDate, title: `ลา: ${leaveType?.name ?? ''}`, createdBy: me.id })
          .returning()
      )[0]!
      const updated = (
        await db
          .update(leaveRequests)
          .set({ status: 'approved', decidedBy: me.id, decidedAt, calendarEventId: event.id })
          .where(eq(leaveRequests.id, r.id))
          .returning()
      )[0]!
      updatedRows.push(updated)
    }

    await writeAudit(c.env, { actorId: me.id, action: 'leave_request.approve', entity: 'leave_request', entityId: before.id, meta: { groupSize: group.length } })
    await notifyUser(db, { userId: before.userId, type: 'leave_approved', message: `คำขอ${leaveType?.name ?? 'ลา'}ของคุณได้รับการอนุมัติแล้ว`, taskId: null, leaveRequestId: before.id })
    return c.json(updatedRows.length > 1 ? updatedRows : updatedRows[0])
  })

  .post('/:id/reject', async (c) => {
    const body = z.object({ reason: z.string().min(1).max(2000) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select().from(leaveRequests).where(eq(leaveRequests.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const group = await siblingsOf(db, before)
    if (group.some((r) => r.status !== 'pending')) return c.json({ error: 'not_pending' }, 409)
    // Pronista §Leave Enhancements เฟส C (2026-09-24) — เหมือน gate ของ /approve เป๊ะ
    const allowed = before.approverId ? before.approverId === me.id : me.role === 'owner'
    if (!allowed) return c.json({ error: 'forbidden' }, 403)

    const leaveType = (await db.select().from(leaveTypes).where(eq(leaveTypes.id, before.leaveTypeId)).limit(1))[0]
    const decidedAt = new Date()
    const updatedRows: LeaveRequestRow[] = []
    for (const r of group) {
      const updated = (
        await db
          .update(leaveRequests)
          .set({ status: 'rejected', decidedBy: me.id, decidedAt, rejectReason: body.data.reason })
          .where(eq(leaveRequests.id, r.id))
          .returning()
      )[0]!
      updatedRows.push(updated)
    }

    await writeAudit(c.env, { actorId: me.id, action: 'leave_request.reject', entity: 'leave_request', entityId: before.id, meta: { reason: body.data.reason, groupSize: group.length } })
    await notifyUser(db, { userId: before.userId, type: 'leave_rejected', message: `คำขอ${leaveType?.name ?? 'ลา'}ของคุณถูกปฏิเสธ: ${body.data.reason}`, taskId: null, leaveRequestId: before.id })
    return c.json(updatedRows.length > 1 ? updatedRows : updatedRows[0])
  })

  // Pronista §Leave Enhancements เฟส D (2026-09-24) — โอนสิทธิ์อนุมัติให้ Owner คนอื่นพิจารณาแทน (เช่น หัวหน้าติดภารกิจ) — ทำทั้งกลุ่มพร้อมกัน เหมือน approve/reject
  .post('/:id/delegate', async (c) => {
    const body = z.object({ toUserId: z.string().min(1) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select().from(leaveRequests).where(eq(leaveRequests.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const group = await siblingsOf(db, before)
    if (group.some((r) => r.status !== 'pending')) return c.json({ error: 'not_pending' }, 409)
    const allowed = before.approverId ? before.approverId === me.id : me.role === 'owner'
    if (!allowed) return c.json({ error: 'forbidden' }, 403)

    const target = (await db.select({ id: users.id, role: users.role, name: users.name }).from(users).where(eq(users.id, body.data.toUserId)).limit(1))[0]
    if (!target || target.role !== 'owner') return c.json({ error: 'invalid_delegate' }, 400)

    await db
      .update(leaveRequests)
      .set({ approverId: target.id })
      .where(
        inArray(
          leaveRequests.id,
          group.map((r) => r.id),
        ),
      )

    await writeAudit(c.env, {
      actorId: me.id,
      action: 'leave_request.delegate',
      entity: 'leave_request',
      entityId: before.id,
      meta: { fromApproverId: before.approverId, toApproverId: target.id, groupSize: group.length },
    })
    const requester = (await db.select({ name: users.name }).from(users).where(eq(users.id, before.userId)).limit(1))[0]
    await notifyUser(db, { userId: target.id, type: 'leave_requested', message: `${me.name} โอนคำขอลาของ ${requester?.name ?? 'พนักงาน'} มาให้คุณพิจารณาแทน`, taskId: null, leaveRequestId: before.id })
    return c.json({ ok: true })
  })

  // Pronista §Leave Request Phase 2 — ถอนคำขอ (pending) หรือยกเลิกเอง (approved แต่ยังไม่ถึงวันเริ่มลา) รวมไว้ endpoint เดียว ใช้ status 'withdrawn' เหมือนกันทั้งคู่
  // Pronista §Leave Management Overhaul เฟส D — กฎระดับกลุ่ม: บล็อกทั้งกลุ่มถ้ามีช่วงไหนช่วงหนึ่งเริ่มไปแล้ว (ทุกแถวในกลุ่มสถานะเดียวกันเสมอ เพราะ approve/reject/withdraw ทำทั้งกลุ่มพร้อมกัน ไม่มี partial state ให้ต้องจัดการเพิ่ม)
  .post('/:id/withdraw', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select().from(leaveRequests).where(eq(leaveRequests.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    if (before.userId !== me.id) return c.json({ error: 'forbidden' }, 403)
    const group = await siblingsOf(db, before)
    const today = bkkDateOf(Date.now())
    const canWithdraw = group.every((r) => r.status === 'pending') || group.every((r) => r.status === 'approved' && r.startDate > today)
    if (!canWithdraw) return c.json({ error: 'not_pending' }, 409)

    const updatedRows: LeaveRequestRow[] = []
    for (const r of group) {
      // เคลียร์ FK ที่ leave_requests อ้าง calendarEventId ก่อน แล้วค่อยลบ event เดิม (ลบก่อนจะชน FOREIGN KEY constraint)
      const updated = (await db.update(leaveRequests).set({ status: 'withdrawn', calendarEventId: null }).where(eq(leaveRequests.id, r.id)).returning())[0]!
      if (r.calendarEventId) await db.delete(calendarEvents).where(eq(calendarEvents.id, r.calendarEventId))
      updatedRows.push(updated)
    }
    await writeAudit(c.env, { actorId: me.id, action: 'leave_request.withdraw', entity: 'leave_request', entityId: before.id, meta: { from: before.status, groupSize: group.length } })
    return c.json(updatedRows.length > 1 ? updatedRows : updatedRows[0])
  })

  // ทีมลาวันนี้/สัปดาห์นี้ (widget หน้า "ขอลา") — เฉพาะ approved ช่วงวันที่ทับซ้อนกับ from..to (default วันนี้..+6 วัน)
  .get('/on-leave', async (c) => {
    const db = createDb(c.env.DB)
    const today = bkkDateOf(Date.now())
    const from = c.req.query('from') ?? today
    const to = c.req.query('to') ?? bkkDateOf(Date.now() + 6 * 86_400_000)
    if (!isoDate.safeParse(from).success || !isoDate.safeParse(to).success) return c.json({ error: 'invalid_range' }, 400)
    const rows = await db
      .select({ userId: leaveRequests.userId, userName: users.name, leaveTypeName: leaveTypes.name, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate })
      .from(leaveRequests)
      .innerJoin(users, eq(leaveRequests.userId, users.id))
      .leftJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .where(and(eq(leaveRequests.status, 'approved'), lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from)))
      .orderBy(leaveRequests.startDate)
    return c.json({ rows })
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
