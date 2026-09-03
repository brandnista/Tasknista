import {
  auditLogs,
  createDb,
  dailyReportComments,
  dailyReportItems,
  dailyReportRecipients,
  dailyReports,
  projects,
  taskStars,
  tasks,
  timeEntries,
  users,
} from '@seedoffice/db'
import { and, desc, eq, gte, inArray, lt, lte, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { notifyUser } from '../lib/notify'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

/**
 * Pronista §Daily Report — พนักงานรวบรวมงานที่ทำวันนี้ (ดึงจาก activity จริง หรือคีย์เอง) ส่งให้หัวหน้าที่เลือกทุกครั้งตอนกดส่ง
 * แทนอีเมลรายงานประจำวัน — workflow Draft → Submitted → Reviewed (auto flip ตอนหัวหน้าเปิดอ่าน)
 * แก้ไขได้ตลอดตราบใดที่ยังไม่ถึง 'reviewed' (submit ไม่ล็อกการแก้ไข แค่จุด notification + ทำให้หัวหน้าเห็นในลิสต์)
 * สิทธิ์เข้าถึง 1 รายงาน = เจ้าของ (userId) หรือผู้รับ (recipientId) หรือ Admin (owner) เท่านั้น — เช็ค inline ทุก route ไม่ใช้ canEditTask (คนละความสัมพันธ์)
 */
export const dailyReportRoutes = new Hono<AppEnv>()

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** YYYY-MM-DD (Asia/Bangkok) → ช่วง epoch ms [startMs, endMs) ของวันนั้น — pattern เดียวกับ overview.ts */
function bangkokDayRangeMs(date: string): { startMs: number; endMs: number } {
  const startMs = Date.parse(`${date}T00:00:00+07:00`)
  return { startMs, endMs: startMs + 86_400_000 }
}

/** วันถัดไปแบบ string YYYY-MM-DD (ไม่ผ่าน Date object ตรงๆ กัน timezone เพี้ยน) */
function nextDateStr(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y!, m! - 1, d! + 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

const TASK_ACTIVITY_ACTIONS = [
  'task.status',
  'task.assign',
  'task.update',
  'task.comment',
  'task.attach',
  'task.dispatch',
  'task.accept',
  'task.checklist',
]

// Pronista §Daily Report multi-recipient — เข้าถึงได้ = เจ้าของ, "หนึ่งในผู้รับ" (ผ่านตาราง daily_report_recipients), หรือ owner บริษัท
async function canAccessReport(db: ReturnType<typeof createDb>, report: { id: string; userId: string }, me: { id: string; role: string }) {
  if (report.userId === me.id || me.role === 'owner') return true
  const row = (
    await db.select({ id: dailyReportRecipients.id }).from(dailyReportRecipients).where(and(eq(dailyReportRecipients.reportId, report.id), eq(dailyReportRecipients.recipientId, me.id))).limit(1)
  )[0]
  return !!row
}
function canEditReport(report: { userId: string }, me: { id: string }) {
  return report.userId === me.id
}
/** แก้ไขได้ตลอด ตราบใดที่ยังไม่ถึง 'reviewed' (หัวหน้าเปิดอ่านแล้ว) — submit ไม่ล็อก */
function isLocked(report: { status: string }) {
  return report.status === 'reviewed'
}

/** โหลดรายละเอียดเต็ม 1 รายงาน (items/comments join ข้อมูล task/user สด) */
async function loadReportDetail(db: ReturnType<typeof createDb>, reportId: string) {
  const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, reportId)).limit(1))[0]
  if (!report) return null

  const [owner, recipientRows] = await Promise.all([
    db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, report.userId)).limit(1),
    db
      .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl, reviewedAt: dailyReportRecipients.reviewedAt })
      .from(dailyReportRecipients)
      .innerJoin(users, eq(users.id, dailyReportRecipients.recipientId))
      .where(eq(dailyReportRecipients.reportId, reportId)),
  ])

  const itemRows = await db
    .select({ item: dailyReportItems, task: tasks, projectName: projects.name })
    .from(dailyReportItems)
    .leftJoin(tasks, eq(tasks.id, dailyReportItems.taskId))
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(dailyReportItems.reportId, reportId))
    .orderBy(dailyReportItems.sortOrder)

  const taskIds = itemRows.map((r) => r.item.taskId).filter((id): id is string => id !== null)
  const minutesRows = taskIds.length
    ? await db
        .select({ taskId: timeEntries.taskId, minutes: sql<number>`sum(${timeEntries.minutes})` })
        .from(timeEntries)
        .where(and(eq(timeEntries.userId, report.userId), eq(timeEntries.workDate, report.reportDate), inArray(timeEntries.taskId, taskIds)))
        .groupBy(timeEntries.taskId)
    : []
  const minutesByTask = new Map(minutesRows.map((r) => [r.taskId, r.minutes]))

  const commentRows = await db
    .select({ comment: dailyReportComments, userName: users.name, avatarUrl: users.avatarUrl })
    .from(dailyReportComments)
    .leftJoin(users, eq(users.id, dailyReportComments.userId))
    .where(eq(dailyReportComments.reportId, reportId))
    .orderBy(dailyReportComments.createdAt)

  return {
    ...report,
    userName: owner[0]?.name ?? null,
    userAvatarUrl: owner[0]?.avatarUrl ?? null,
    // Pronista §Daily Report multi-recipient — recipientName/recipientAvatarUrl (คนแรก) เก็บไว้ให้ backward-compat กับที่เก่าอ่านฟิลด์เดี่ยว · ของใหม่ใช้ recipients[] แทน
    recipientName: recipientRows[0]?.name ?? null,
    recipientAvatarUrl: recipientRows[0]?.avatarUrl ?? null,
    recipients: recipientRows.map((r) => ({ id: r.id, name: r.name, avatarUrl: r.avatarUrl, reviewedAt: r.reviewedAt })),
    items: itemRows.map((r) => ({
      id: r.item.id,
      taskId: r.item.taskId,
      note: r.item.note,
      manualTitle: r.item.manualTitle,
      manualMinutes: r.item.manualMinutes,
      minutes: r.item.taskId ? (minutesByTask.get(r.item.taskId) ?? 0) : (r.item.manualMinutes ?? 0),
      task: r.task ? { id: r.task.id, code: r.task.code, title: r.task.title, status: r.task.status, projectId: r.task.projectId, projectName: r.projectName } : null,
    })),
    comments: commentRows.map((r) => ({ id: r.comment.id, userId: r.comment.userId, userName: r.userName, avatarUrl: r.avatarUrl, body: r.comment.body, createdAt: r.comment.createdAt })),
  }
}

const itemInput = z
  .object({
    taskId: z.string().optional(),
    manualTitle: z.string().min(1).max(200).optional(),
    manualMinutes: z.number().int().nonnegative().max(1440).optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .refine((d) => !!d.taskId !== !!d.manualTitle, { message: 'ระบุ taskId หรือ manualTitle อย่างใดอย่างหนึ่ง' })

dailyReportRoutes

  // งานที่ระบบแนะนำให้เพิ่มใน Daily Report ของวันที่ระบุ — union: audit_logs (activity) / time_entries (timer) / task_stars (ติดดาว)
  .get('/daily-reports/suggested', teamOnly, async (c) => {
    const date = c.req.query('date')
    if (!date || !isoDate.safeParse(date).success) return c.json({ error: 'invalid_date' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const { startMs, endMs } = bangkokDayRangeMs(date)

    const [activityRows, timeRows, starRows, existingReport] = await Promise.all([
      db
        .selectDistinct({ taskId: auditLogs.entityId })
        .from(auditLogs)
        .where(and(eq(auditLogs.actorId, me.id), eq(auditLogs.entity, 'task'), inArray(auditLogs.action, TASK_ACTIVITY_ACTIONS), gte(auditLogs.at, new Date(startMs)), lt(auditLogs.at, new Date(endMs)))),
      db
        .select({ taskId: timeEntries.taskId, minutes: sql<number>`sum(${timeEntries.minutes})` })
        .from(timeEntries)
        .where(and(eq(timeEntries.userId, me.id), eq(timeEntries.workDate, date)))
        .groupBy(timeEntries.taskId),
      db.selectDistinct({ taskId: taskStars.taskId }).from(taskStars).where(and(eq(taskStars.userId, me.id), eq(taskStars.forDate, date))),
      db.select({ id: dailyReports.id }).from(dailyReports).where(and(eq(dailyReports.userId, me.id), eq(dailyReports.reportDate, date))).limit(1),
    ])

    const minutesByTask = new Map(timeRows.map((r) => [r.taskId, r.minutes]))
    const taskIds = new Set<string>([...activityRows.map((r) => r.taskId), ...timeRows.map((r) => r.taskId), ...starRows.map((r) => r.taskId)])
    if (taskIds.size === 0) return c.json({ date, tasks: [] })

    const report = existingReport[0]
    const alreadyAdded = report
      ? new Set((await db.select({ taskId: dailyReportItems.taskId }).from(dailyReportItems).where(eq(dailyReportItems.reportId, report.id))).map((r) => r.taskId))
      : new Set<string>()

    const taskRows = await db
      .select({ task: tasks, projectName: projects.name })
      .from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .where(inArray(tasks.id, [...taskIds]))

    return c.json({
      date,
      tasks: taskRows.map((r) => ({
        id: r.task.id,
        code: r.task.code,
        title: r.task.title,
        status: r.task.status,
        projectId: r.task.projectId,
        projectName: r.projectName,
        minutes: minutesByTask.get(r.task.id) ?? 0,
        inReport: alreadyAdded.has(r.task.id),
      })),
    })
  })

  // งานแนะนำสำหรับ "แผนพรุ่งนี้" — เก็บ endpoint ไว้เผื่อกลับมาใช้ (ตัด UI ออกแล้วตามคำขอ) — งานของฉันที่ยังไม่เสร็จ/ใกล้ครบกำหนดพรุ่งนี้
  .get('/daily-reports/plan-suggested', teamOnly, async (c) => {
    const date = c.req.query('date')
    if (!date || !isoDate.safeParse(date).success) return c.json({ error: 'invalid_date' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const tomorrow = nextDateStr(date)
    const rows = await db
      .select({ task: tasks, projectName: projects.name })
      .from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.assigneeId, me.id), inArray(tasks.status, ['non_start', 'on_processing'])))
    const tasksList = rows.map((r) => ({
      id: r.task.id,
      code: r.task.code,
      title: r.task.title,
      status: r.task.status,
      dueDate: r.task.dueDate,
      projectId: r.task.projectId,
      projectName: r.projectName,
      dueTomorrow: r.task.dueDate === tomorrow,
    }))
    return c.json({ date: tomorrow, tasks: tasksList })
  })

  // รายชื่อคนที่เลือกเป็นผู้รับได้ (owner+member ทุกคน ยกเว้นตัวเอง) — ใช้ทำ dropdown ตอนกดส่งรายงาน
  .get('/daily-reports/recipients', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const rows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(inArray(users.role, ['owner', 'member']), ne(users.id, me.id), eq(users.status, 'active')))
      .orderBy(users.name)
    return c.json({ recipients: rows })
  })

  // get-or-create draft ต่อ (userId, reportDate) — idempotent · recipientId default จาก managerId ถ้ามี (เลือกใหม่ได้ทุกครั้งตอนส่ง)
  .post('/daily-reports', teamOnly, async (c) => {
    const body = z.object({ date: isoDate }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')

    const existing = (await db.select().from(dailyReports).where(and(eq(dailyReports.userId, me.id), eq(dailyReports.reportDate, body.data.date))).limit(1))[0]
    if (existing) return c.json(await loadReportDetail(db, existing.id))

    const meRow = (await db.select({ managerId: users.managerId }).from(users).where(eq(users.id, me.id)).limit(1))[0]
    const inserted = (await db.insert(dailyReports).values({ userId: me.id, reportDate: body.data.date, recipientId: meRow?.managerId ?? null }).returning())[0]!
    await writeAudit(c.env, { actorId: me.id, action: 'daily_report.create', entity: 'daily_report', entityId: inserted.id, meta: { reportDate: inserted.reportDate } })
    return c.json(await loadReportDetail(db, inserted.id), 201)
  })

  // ดูรายงานของฉันวันที่ระบุ (เพื่อความสะดวก ไม่ต้องรู้ id) — คืน null ถ้ายังไม่มี
  .get('/daily-reports', teamOnly, async (c) => {
    const date = c.req.query('date')
    if (!date || !isoDate.safeParse(date).success) return c.json({ error: 'invalid_date' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const existing = (await db.select().from(dailyReports).where(and(eq(dailyReports.userId, me.id), eq(dailyReports.reportDate, date))).limit(1))[0]
    if (!existing) return c.json({ report: null })
    return c.json({ report: await loadReportDetail(db, existing.id) })
  })

  // ประวัติ — mine = ที่ฉันเป็นเจ้าของ, received = ที่ฉันเป็นหนึ่งในผู้รับ (ผ่านตาราง daily_report_recipients)
  // Pronista §Daily Report Gmail-style inbox — เพิ่ม from/to (กรองช่วงวันที่: สัปดาห์/เดือน/กำหนดเอง คำนวณฝั่ง frontend แล้วส่ง ISO date มา) + myReviewedAt (ต่อผู้ดู เอาไว้ทำตัวหนา = ยังไม่อ่าน)
  .get('/daily-reports/history', teamOnly, async (c) => {
    const scope = c.req.query('scope') === 'received' ? 'received' : 'mine'
    const status = c.req.query('status')
    const from = c.req.query('from')
    const to = c.req.query('to')
    const db = createDb(c.env.DB)
    const me = c.get('user')

    let receivedReportIds: string[] | null = null
    if (scope === 'received') {
      const rows = await db.select({ reportId: dailyReportRecipients.reportId }).from(dailyReportRecipients).where(eq(dailyReportRecipients.recipientId, me.id))
      receivedReportIds = rows.map((r) => r.reportId)
      if (receivedReportIds.length === 0) return c.json({ reports: [] })
    }

    const conditions = scope === 'received' ? [inArray(dailyReports.id, receivedReportIds!)] : [eq(dailyReports.userId, me.id)]
    if (status && ['draft', 'submitted', 'reviewed'].includes(status)) conditions.push(eq(dailyReports.status, status as 'draft' | 'submitted' | 'reviewed'))
    if (from && isoDate.safeParse(from).success) conditions.push(gte(dailyReports.reportDate, from))
    if (to && isoDate.safeParse(to).success) conditions.push(lte(dailyReports.reportDate, to))

    const rows = await db
      .select({ report: dailyReports, userName: users.name, userAvatarUrl: users.avatarUrl })
      .from(dailyReports)
      .leftJoin(users, eq(users.id, dailyReports.userId))
      .where(and(...conditions))
      .orderBy(desc(dailyReports.reportDate))
      .limit(200)

    const reportIds = rows.map((r) => r.report.id)
    const [recipientRows, itemCounts, myRows] = await Promise.all([
      reportIds.length
        ? db
            .select({ reportId: dailyReportRecipients.reportId, id: users.id, name: users.name })
            .from(dailyReportRecipients)
            .innerJoin(users, eq(users.id, dailyReportRecipients.recipientId))
            .where(inArray(dailyReportRecipients.reportId, reportIds))
        : [],
      reportIds.length
        ? db.select({ reportId: dailyReportItems.reportId, count: sql<number>`count(*)` }).from(dailyReportItems).where(inArray(dailyReportItems.reportId, reportIds)).groupBy(dailyReportItems.reportId)
        : [],
      scope === 'received' && reportIds.length
        ? db
            .select({ reportId: dailyReportRecipients.reportId, reviewedAt: dailyReportRecipients.reviewedAt })
            .from(dailyReportRecipients)
            .where(and(inArray(dailyReportRecipients.reportId, reportIds), eq(dailyReportRecipients.recipientId, me.id)))
        : [],
    ])
    const recipientsByReport = new Map<string, { id: string; name: string | null }[]>()
    for (const r of recipientRows) recipientsByReport.set(r.reportId, [...(recipientsByReport.get(r.reportId) ?? []), { id: r.id, name: r.name }])
    const countByReport = new Map(itemCounts.map((r) => [r.reportId, r.count]))
    const myReviewedAtByReport = new Map(myRows.map((r) => [r.reportId, r.reviewedAt]))

    return c.json({
      reports: rows.map((r) => ({
        id: r.report.id,
        reportDate: r.report.reportDate,
        status: r.report.status,
        userName: r.userName,
        userAvatarUrl: r.userAvatarUrl,
        recipients: recipientsByReport.get(r.report.id) ?? [],
        itemCount: countByReport.get(r.report.id) ?? 0,
        submittedAt: r.report.submittedAt,
        notes: r.report.notes,
        myReviewedAt: scope === 'received' ? (myReviewedAtByReport.get(r.report.id) ?? null) : null,
      })),
    })
  })

  // รายละเอียดเต็ม — ผู้รับคนไหนเปิดก็ mark ว่า "ตัวเองอ่านแล้ว" (ต่อคน) · "คนแรก" ที่เปิด flip รายงานทั้งใบเป็น reviewed (ล็อกแก้ไข — เหมือนเดิม ไม่ต้องรอทุกคนอ่านครบ)
  .get('/daily-reports/:id', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, c.req.param('id'))).limit(1))[0]
    if (!report) return c.json({ error: 'not_found' }, 404)
    if (!(await canAccessReport(db, report, me))) return c.json({ error: 'forbidden' }, 403)

    const myRecipientRow = (
      await db.select().from(dailyReportRecipients).where(and(eq(dailyReportRecipients.reportId, report.id), eq(dailyReportRecipients.recipientId, me.id))).limit(1)
    )[0]
    if (myRecipientRow && !myRecipientRow.reviewedAt) {
      await db.update(dailyReportRecipients).set({ reviewedAt: new Date() }).where(eq(dailyReportRecipients.id, myRecipientRow.id))
    }
    if (report.status === 'submitted' && myRecipientRow) {
      await db.update(dailyReports).set({ status: 'reviewed', reviewedAt: new Date() }).where(eq(dailyReports.id, report.id))
      await notifyUser(db, {
        userId: report.userId,
        type: 'daily_report_reviewed',
        dailyReportId: report.id,
        message: `${me.name} เปิดดู Daily Report วันที่ ${report.reportDate} ของคุณแล้ว`,
      })
    }
    return c.json(await loadReportDetail(db, report.id))
  })

  // แก้ notes/blocker fields — เจ้าของเท่านั้น, แก้ไขได้จนกว่าจะ reviewed
  .patch('/daily-reports/:id', teamOnly, async (c) => {
    const body = z
      .object({
        notes: z.string().max(4000).nullable().optional(),
        blockerHasIssue: z.boolean().optional(),
        blockerDetail: z.string().max(2000).nullable().optional(),
        blockerNeedHelpFrom: z.string().max(500).nullable().optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, c.req.param('id'))).limit(1))[0]
    if (!report) return c.json({ error: 'not_found' }, 404)
    if (!canEditReport(report, me)) return c.json({ error: 'forbidden' }, 403)
    if (isLocked(report)) return c.json({ error: 'locked', message: 'หัวหน้าเปิดอ่านแล้ว แก้ไขไม่ได้ — กด "ขอแก้ไขรายงาน" ก่อน' }, 400)
    await db.update(dailyReports).set(body.data).where(eq(dailyReports.id, report.id))
    return c.json(await loadReportDetail(db, report.id))
  })

  // เพิ่มงานเข้ารายงาน — ผูก task จริง (taskId, upsert กันซ้ำ) หรือคีย์เองแบบ freeform (manualTitle+manualMinutes)
  .post('/daily-reports/:id/items', teamOnly, async (c) => {
    const body = itemInput.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, c.req.param('id'))).limit(1))[0]
    if (!report) return c.json({ error: 'not_found' }, 404)
    if (!canEditReport(report, me)) return c.json({ error: 'forbidden' }, 403)
    if (isLocked(report)) return c.json({ error: 'locked' }, 400)

    if (body.data.taskId) {
      const existing = (await db.select().from(dailyReportItems).where(and(eq(dailyReportItems.reportId, report.id), eq(dailyReportItems.taskId, body.data.taskId))).limit(1))[0]
      if (existing) {
        const updated = (await db.update(dailyReportItems).set({ note: body.data.note ?? existing.note }).where(eq(dailyReportItems.id, existing.id)).returning())[0]
        return c.json(updated)
      }
    }
    const count = (await db.select({ n: sql<number>`count(*)` }).from(dailyReportItems).where(eq(dailyReportItems.reportId, report.id)))[0]?.n ?? 0
    const inserted = (
      await db
        .insert(dailyReportItems)
        .values({
          reportId: report.id,
          taskId: body.data.taskId ?? null,
          manualTitle: body.data.manualTitle ?? null,
          manualMinutes: body.data.manualMinutes ?? null,
          note: body.data.note ?? null,
          sortOrder: count,
        })
        .returning()
    )[0]
    return c.json(inserted, 201)
  })

  .patch('/daily-reports/:id/items/:itemId', teamOnly, async (c) => {
    const body = z.object({ note: z.string().max(2000).nullable() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, c.req.param('id'))).limit(1))[0]
    if (!report) return c.json({ error: 'not_found' }, 404)
    if (!canEditReport(report, me)) return c.json({ error: 'forbidden' }, 403)
    if (isLocked(report)) return c.json({ error: 'locked' }, 400)
    const updated = (await db.update(dailyReportItems).set({ note: body.data.note }).where(and(eq(dailyReportItems.id, c.req.param('itemId')), eq(dailyReportItems.reportId, report.id))).returning())[0]
    if (!updated) return c.json({ error: 'not_found' }, 404)
    return c.json(updated)
  })

  .delete('/daily-reports/:id/items/:itemId', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, c.req.param('id'))).limit(1))[0]
    if (!report) return c.json({ error: 'not_found' }, 404)
    if (!canEditReport(report, me)) return c.json({ error: 'forbidden' }, 403)
    if (isLocked(report)) return c.json({ error: 'locked' }, 400)
    await db.delete(dailyReportItems).where(and(eq(dailyReportItems.id, c.req.param('itemId')), eq(dailyReportItems.reportId, report.id)))
    return c.json({ ok: true })
  })

  // ส่งรายงาน — เลือก/ยืนยันผู้รับทุกครั้งที่ส่ง (Pronista §Daily Report multi-recipient — เลือกได้หลายคน) · ไม่ล็อกการแก้ไข
  .post('/daily-reports/:id/submit', teamOnly, async (c) => {
    const body = z.object({ recipientIds: z.array(z.string().min(1)).min(1).max(20) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'recipient_required', message: 'กรุณาเลือกผู้รับรายงานอย่างน้อย 1 คน' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, c.req.param('id'))).limit(1))[0]
    if (!report) return c.json({ error: 'not_found' }, 404)
    if (!canEditReport(report, me)) return c.json({ error: 'forbidden' }, 403)
    if (report.status !== 'draft') return c.json({ error: 'already_submitted' }, 400)

    const recipientIds = [...new Set(body.data.recipientIds)]
    const recipientRows = await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(inArray(users.id, recipientIds))
    if (recipientRows.length !== recipientIds.length || recipientRows.some((r) => r.role !== 'owner' && r.role !== 'member')) return c.json({ error: 'invalid_recipient' }, 400)

    await db.update(dailyReports).set({ status: 'submitted', submittedAt: new Date(), recipientId: recipientRows[0]!.id }).where(eq(dailyReports.id, report.id))
    await db.insert(dailyReportRecipients).values(recipientRows.map((r) => ({ reportId: report.id, recipientId: r.id })))
    await writeAudit(c.env, { actorId: me.id, action: 'daily_report.submit', entity: 'daily_report', entityId: report.id, meta: { reportDate: report.reportDate, recipientIds } })
    for (const r of recipientRows) {
      await notifyUser(db, {
        userId: r.id,
        type: 'daily_report_submitted',
        dailyReportId: report.id,
        message: `${me.name} ส่ง Daily Report ประจำวันที่ ${report.reportDate}`,
      })
    }
    return c.json(await loadReportDetail(db, report.id))
  })

  // "ขอแก้ไขรายงาน" — reviewed → submitted (ปลดล็อกกลับมาแก้ไขได้ ไม่ต้องส่งใหม่ ไม่กระทบว่าส่งไปแล้ว)
  .post('/daily-reports/:id/request-edit', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, c.req.param('id'))).limit(1))[0]
    if (!report) return c.json({ error: 'not_found' }, 404)
    if (!canEditReport(report, me)) return c.json({ error: 'forbidden' }, 403)
    if (report.status !== 'reviewed') return c.json({ error: 'not_locked' }, 400)
    await db.update(dailyReports).set({ status: 'submitted', reviewedAt: null }).where(eq(dailyReports.id, report.id))
    await writeAudit(c.env, { actorId: me.id, action: 'daily_report.request_edit', entity: 'daily_report', entityId: report.id, meta: {} })
    return c.json(await loadReportDetail(db, report.id))
  })

  // คอมเมนต์ — เจ้าของหรือผู้รับคนใดคนหนึ่งเท่านั้น (Pronista §Daily Report multi-recipient — เธรดเดียวรวมทุกฝ่าย)
  .post('/daily-reports/:id/comments', teamOnly, async (c) => {
    const body = z.object({ body: z.string().min(1).max(2000) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, c.req.param('id'))).limit(1))[0]
    if (!report) return c.json({ error: 'not_found' }, 404)
    if (!(await canAccessReport(db, report, me))) return c.json({ error: 'forbidden' }, 403)

    const inserted = (await db.insert(dailyReportComments).values({ reportId: report.id, userId: me.id, body: body.data.body }).returning())[0]!
    await writeAudit(c.env, { actorId: me.id, action: 'daily_report.comment', entity: 'daily_report', entityId: report.id, meta: { preview: body.data.body.slice(0, 80) } })
    const recipientRows = await db.select({ id: dailyReportRecipients.recipientId }).from(dailyReportRecipients).where(eq(dailyReportRecipients.reportId, report.id))
    const otherPartyIds = new Set([report.userId, ...recipientRows.map((r) => r.id)])
    otherPartyIds.delete(me.id)
    for (const userId of otherPartyIds) {
      await notifyUser(db, {
        userId,
        type: 'daily_report_commented',
        dailyReportId: report.id,
        message: `${me.name} คอมเมนต์ใน Daily Report วันที่ ${report.reportDate}`,
      })
    }
    return c.json({ ...inserted, userName: me.name }, 201)
  })
