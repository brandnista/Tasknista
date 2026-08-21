import {
  auditLogs,
  createDb,
  dailyReportComments,
  dailyReportItems,
  dailyReportPlanItems,
  dailyReports,
  notifications,
  projects,
  taskStars,
  tasks,
  timeEntries,
  users,
} from '@seedoffice/db'
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

/**
 * Pronista §Daily Report — พนักงานรวบรวมงานที่ทำวันนี้ (ดึงจาก activity จริง ไม่กรอกใหม่) ส่งให้ "หัวหน้าโดยตรง" (users.managerId)
 * แทนอีเมลรายงานประจำวัน — workflow Draft → Submitted → Reviewed (auto flip ตอนหัวหน้าเปิดอ่าน)
 * สิทธิ์เข้าถึง 1 รายงาน = เจ้าของ (userId) หรือผู้รับ (recipientId ที่ snapshot ไว้ตอนสร้าง) หรือ Admin (owner) เท่านั้น — เช็ค inline ทุก route ไม่ใช้ canEditTask (คนละความสัมพันธ์)
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

function canAccessReport(report: { userId: string; recipientId: string }, me: { id: string; role: string }) {
  return report.userId === me.id || report.recipientId === me.id || me.role === 'owner'
}
function canEditReport(report: { userId: string }, me: { id: string }) {
  return report.userId === me.id
}

/** โหลดรายละเอียดเต็ม 1 รายงาน (items/planItems/comments join ข้อมูล task/user สด) */
async function loadReportDetail(db: ReturnType<typeof createDb>, reportId: string) {
  const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, reportId)).limit(1))[0]
  if (!report) return null

  const [owner, recipient] = await Promise.all([
    db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, report.userId)).limit(1),
    db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, report.recipientId)).limit(1),
  ])

  const itemRows = await db
    .select({ item: dailyReportItems, task: tasks, projectName: projects.name })
    .from(dailyReportItems)
    .innerJoin(tasks, eq(tasks.id, dailyReportItems.taskId))
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(dailyReportItems.reportId, reportId))
    .orderBy(dailyReportItems.sortOrder)

  const taskIds = itemRows.map((r) => r.item.taskId)
  const minutesRows = taskIds.length
    ? await db
        .select({ taskId: timeEntries.taskId, minutes: sql<number>`sum(${timeEntries.minutes})` })
        .from(timeEntries)
        .where(and(eq(timeEntries.userId, report.userId), eq(timeEntries.workDate, report.reportDate), inArray(timeEntries.taskId, taskIds)))
        .groupBy(timeEntries.taskId)
    : []
  const minutesByTask = new Map(minutesRows.map((r) => [r.taskId, r.minutes]))

  const planRows = await db
    .select({ plan: dailyReportPlanItems, task: tasks })
    .from(dailyReportPlanItems)
    .leftJoin(tasks, eq(tasks.id, dailyReportPlanItems.taskId))
    .where(eq(dailyReportPlanItems.reportId, reportId))
    .orderBy(dailyReportPlanItems.sortOrder)

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
    recipientName: recipient[0]?.name ?? null,
    recipientAvatarUrl: recipient[0]?.avatarUrl ?? null,
    items: itemRows.map((r) => ({
      id: r.item.id,
      taskId: r.item.taskId,
      note: r.item.note,
      minutes: minutesByTask.get(r.item.taskId) ?? 0,
      task: { id: r.task.id, code: r.task.code, title: r.task.title, status: r.task.status, projectId: r.task.projectId, projectName: r.projectName },
    })),
    planItems: planRows.map((r) => ({
      id: r.plan.id,
      taskId: r.plan.taskId,
      note: r.plan.note,
      task: r.task ? { id: r.task.id, code: r.task.code, title: r.task.title } : null,
    })),
    comments: commentRows.map((r) => ({ id: r.comment.id, userId: r.comment.userId, userName: r.userName, avatarUrl: r.avatarUrl, body: r.comment.body, createdAt: r.comment.createdAt })),
  }
}

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

  // งานแนะนำสำหรับ "แผนพรุ่งนี้" — งานของฉันที่ยังไม่เสร็จ/ใกล้ครบกำหนดพรุ่งนี้
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

  // get-or-create draft ต่อ (userId, reportDate) — idempotent
  .post('/daily-reports', teamOnly, async (c) => {
    const body = z.object({ date: isoDate }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')

    const existing = (await db.select().from(dailyReports).where(and(eq(dailyReports.userId, me.id), eq(dailyReports.reportDate, body.data.date))).limit(1))[0]
    if (existing) return c.json(await loadReportDetail(db, existing.id))

    const meRow = (await db.select({ managerId: users.managerId }).from(users).where(eq(users.id, me.id)).limit(1))[0]
    if (!meRow?.managerId) return c.json({ error: 'no_manager', message: 'ยังไม่ได้ตั้งผู้รับรายงาน กรุณาติดต่อ Admin ให้ตั้งค่า "หัวหน้าโดยตรง" ที่หน้าตั้งค่าผู้ใช้งานก่อน' }, 400)

    const inserted = (await db.insert(dailyReports).values({ userId: me.id, reportDate: body.data.date, recipientId: meRow.managerId }).returning())[0]!
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

  // ประวัติ — mine = ที่ฉันเป็นเจ้าของ, received = ที่ฉันเป็นผู้รับ
  .get('/daily-reports/history', teamOnly, async (c) => {
    const scope = c.req.query('scope') === 'received' ? 'received' : 'mine'
    const status = c.req.query('status')
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const owner = { id: users.id, name: users.name }
    const scopeCol = scope === 'received' ? dailyReports.recipientId : dailyReports.userId
    const conditions = [eq(scopeCol, me.id)]
    if (status && ['draft', 'submitted', 'reviewed'].includes(status)) conditions.push(eq(dailyReports.status, status as 'draft' | 'submitted' | 'reviewed'))

    const rows = await db
      .select({ report: dailyReports, userName: users.name })
      .from(dailyReports)
      .leftJoin(users, eq(users.id, dailyReports.userId))
      .where(and(...conditions))
      .orderBy(desc(dailyReports.reportDate))
      .limit(200)

    const recipientIds = [...new Set(rows.map((r) => r.report.recipientId))]
    const recipients = recipientIds.length ? await db.select(owner).from(users).where(inArray(users.id, recipientIds)) : []
    const recipientNameById = new Map(recipients.map((r) => [r.id, r.name]))

    const reportIds = rows.map((r) => r.report.id)
    const itemCounts = reportIds.length
      ? await db.select({ reportId: dailyReportItems.reportId, count: sql<number>`count(*)` }).from(dailyReportItems).where(inArray(dailyReportItems.reportId, reportIds)).groupBy(dailyReportItems.reportId)
      : []
    const countByReport = new Map(itemCounts.map((r) => [r.reportId, r.count]))

    return c.json({
      reports: rows.map((r) => ({
        id: r.report.id,
        reportDate: r.report.reportDate,
        status: r.report.status,
        userName: r.userName,
        recipientName: recipientNameById.get(r.report.recipientId) ?? null,
        itemCount: countByReport.get(r.report.id) ?? 0,
        submittedAt: r.report.submittedAt,
      })),
    })
  })

  // รายละเอียดเต็ม — ถ้าผู้รับเปิดรายงานที่ submitted แล้ว auto flip เป็น reviewed (§9/§14 "Daily Report ถูกเปิดดู")
  .get('/daily-reports/:id', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, c.req.param('id'))).limit(1))[0]
    if (!report) return c.json({ error: 'not_found' }, 404)
    if (!canAccessReport(report, me)) return c.json({ error: 'forbidden' }, 403)

    if (report.status === 'submitted' && me.id === report.recipientId) {
      await db.update(dailyReports).set({ status: 'reviewed', reviewedAt: new Date() }).where(eq(dailyReports.id, report.id))
      await db.insert(notifications).values({
        userId: report.userId,
        type: 'daily_report_reviewed',
        dailyReportId: report.id,
        message: `Daily Report วันที่ ${report.reportDate} ของคุณถูกเปิดดูแล้ว`,
      })
    }
    return c.json(await loadReportDetail(db, report.id))
  })

  // แก้ notes/blocker fields — เจ้าของเท่านั้น, ตอนยังเป็น draft เท่านั้น
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
    if (report.status !== 'draft') return c.json({ error: 'not_draft' }, 400)
    await db.update(dailyReports).set(body.data).where(eq(dailyReports.id, report.id))
    return c.json(await loadReportDetail(db, report.id))
  })

  // เพิ่ม/แก้ไข task เข้ารายงาน (upsert ตาม taskId — กันซ้ำ)
  .post('/daily-reports/:id/items', teamOnly, async (c) => {
    const body = z.object({ taskId: z.string(), note: z.string().max(2000).nullable().optional() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, c.req.param('id'))).limit(1))[0]
    if (!report) return c.json({ error: 'not_found' }, 404)
    if (!canEditReport(report, me)) return c.json({ error: 'forbidden' }, 403)
    if (report.status !== 'draft') return c.json({ error: 'not_draft' }, 400)

    const existing = (await db.select().from(dailyReportItems).where(and(eq(dailyReportItems.reportId, report.id), eq(dailyReportItems.taskId, body.data.taskId))).limit(1))[0]
    if (existing) {
      const updated = (await db.update(dailyReportItems).set({ note: body.data.note ?? existing.note }).where(eq(dailyReportItems.id, existing.id)).returning())[0]
      return c.json(updated)
    }
    const count = (await db.select({ n: sql<number>`count(*)` }).from(dailyReportItems).where(eq(dailyReportItems.reportId, report.id)))[0]?.n ?? 0
    const inserted = (await db.insert(dailyReportItems).values({ reportId: report.id, taskId: body.data.taskId, note: body.data.note ?? null, sortOrder: count }).returning())[0]
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
    if (report.status !== 'draft') return c.json({ error: 'not_draft' }, 400)
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
    if (report.status !== 'draft') return c.json({ error: 'not_draft' }, 400)
    await db.delete(dailyReportItems).where(and(eq(dailyReportItems.id, c.req.param('itemId')), eq(dailyReportItems.reportId, report.id)))
    return c.json({ ok: true })
  })

  // แผนพรุ่งนี้ — taskId เลือกจากงานจริงได้ (nullable) หรือพิมพ์เองล้วน
  .post('/daily-reports/:id/plan-items', teamOnly, async (c) => {
    const body = z.object({ taskId: z.string().nullable().optional(), note: z.string().min(1).max(500) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, c.req.param('id'))).limit(1))[0]
    if (!report) return c.json({ error: 'not_found' }, 404)
    if (!canEditReport(report, me)) return c.json({ error: 'forbidden' }, 403)
    if (report.status !== 'draft') return c.json({ error: 'not_draft' }, 400)
    const count = (await db.select({ n: sql<number>`count(*)` }).from(dailyReportPlanItems).where(eq(dailyReportPlanItems.reportId, report.id)))[0]?.n ?? 0
    const inserted = (await db.insert(dailyReportPlanItems).values({ reportId: report.id, taskId: body.data.taskId ?? null, note: body.data.note.trim(), sortOrder: count }).returning())[0]
    return c.json(inserted, 201)
  })

  .delete('/daily-reports/:id/plan-items/:itemId', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, c.req.param('id'))).limit(1))[0]
    if (!report) return c.json({ error: 'not_found' }, 404)
    if (!canEditReport(report, me)) return c.json({ error: 'forbidden' }, 403)
    if (report.status !== 'draft') return c.json({ error: 'not_draft' }, 400)
    await db.delete(dailyReportPlanItems).where(and(eq(dailyReportPlanItems.id, c.req.param('itemId')), eq(dailyReportPlanItems.reportId, report.id)))
    return c.json({ ok: true })
  })

  // draft → submitted
  .post('/daily-reports/:id/submit', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, c.req.param('id'))).limit(1))[0]
    if (!report) return c.json({ error: 'not_found' }, 404)
    if (!canEditReport(report, me)) return c.json({ error: 'forbidden' }, 403)
    if (report.status !== 'draft') return c.json({ error: 'not_draft' }, 400)

    await db.update(dailyReports).set({ status: 'submitted', submittedAt: new Date() }).where(eq(dailyReports.id, report.id))
    await writeAudit(c.env, { actorId: me.id, action: 'daily_report.submit', entity: 'daily_report', entityId: report.id, meta: { reportDate: report.reportDate } })
    await db.insert(notifications).values({
      userId: report.recipientId,
      type: 'daily_report_submitted',
      dailyReportId: report.id,
      message: `${me.name} ส่ง Daily Report ประจำวันที่ ${report.reportDate}`,
    })
    return c.json(await loadReportDetail(db, report.id))
  })

  // "ขอแก้ไขรายงาน" — submitted/reviewed → draft กลับมาแก้ (เฉพาะเจ้าของ)
  .post('/daily-reports/:id/request-edit', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, c.req.param('id'))).limit(1))[0]
    if (!report) return c.json({ error: 'not_found' }, 404)
    if (!canEditReport(report, me)) return c.json({ error: 'forbidden' }, 403)
    if (report.status === 'draft') return c.json({ error: 'already_draft' }, 400)
    await db.update(dailyReports).set({ status: 'draft', submittedAt: null, reviewedAt: null }).where(eq(dailyReports.id, report.id))
    await writeAudit(c.env, { actorId: me.id, action: 'daily_report.request_edit', entity: 'daily_report', entityId: report.id, meta: {} })
    return c.json(await loadReportDetail(db, report.id))
  })

  // คอมเมนต์ — เจ้าของหรือผู้รับเท่านั้น (2 ฝ่ายในเธรด)
  .post('/daily-reports/:id/comments', teamOnly, async (c) => {
    const body = z.object({ body: z.string().min(1).max(2000) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const report = (await db.select().from(dailyReports).where(eq(dailyReports.id, c.req.param('id'))).limit(1))[0]
    if (!report) return c.json({ error: 'not_found' }, 404)
    if (report.userId !== me.id && report.recipientId !== me.id && me.role !== 'owner') return c.json({ error: 'forbidden' }, 403)

    const inserted = (await db.insert(dailyReportComments).values({ reportId: report.id, userId: me.id, body: body.data.body }).returning())[0]!
    await writeAudit(c.env, { actorId: me.id, action: 'daily_report.comment', entity: 'daily_report', entityId: report.id, meta: { preview: body.data.body.slice(0, 80) } })
    const otherPartyId = me.id === report.userId ? report.recipientId : report.userId
    if (otherPartyId !== me.id) {
      await db.insert(notifications).values({
        userId: otherPartyId,
        type: 'daily_report_commented',
        dailyReportId: report.id,
        message: `${me.name} คอมเมนต์ใน Daily Report วันที่ ${report.reportDate}`,
      })
    }
    return c.json({ ...inserted, userName: me.name }, 201)
  })
