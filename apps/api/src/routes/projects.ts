import {
  baseSatang,
  bkkDateOf,
  bufferMinutes,
  costPerHourFromDay,
  costRoleByRoleId,
  costSatang,
  defaultStatusId,
  estimateDays,
  hasAnyEditRight,
  isNearExpiry,
  isPatchableLogo,
  marginSatang,
  parameterRoleById,
  parseProjectLogo,
  positionById,
  POSITION_FULL_ACCESS_ID,
  productTypeById,
  quotationSatang,
  resolveCostRoles,
  resolveParameterRoles,
  resolvePositions,
  resolveProductTypes,
  resolveServiceTypes,
  resolveStatuses,
  resolveTaskTypes,
  serviceTypeById,
  statusById,
  sumMinutes,
  sumSatang,
  uploadLogo,
} from '@seedoffice/core'
import {
  auditLogs,
  clients,
  companyConfig,
  createDb,
  customerProjects,
  docLinks,
  docs,
  epics,
  estimateExtraCosts,
  estimateGroupOverrides,
  milestones,
  payments,
  projectMembers,
  projects,
  sprints,
  tasks,
  timeEntries,
  users,
  type Db,
  type Project,
} from '@seedoffice/db'
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'
import { healthOf } from './finance'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { canEditProject, getProjectPermissions, getProjectRole, isProjectVisibleToUser } from '../lib/project-role'
import { ownerOnly, teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const MAX_LOGO_BYTES = 2 * 1024 * 1024 // โลโก้ลูกค้า ≤ 2MB

/**
 * Pronista §Project Estimate v2 — ดึง+คำนวณ estimate ต่อ task ของ "ทุก" task ในโปรเจกต์ (ไม่กรอง estimateSelected อีกต่อไป)
 * ใช้ร่วมกันทั้ง GET /:id/estimate (Task tab), GET /:id/estimate/groups และ GET /:id/estimate/phases (รวมตาม taskType/subTaskType)
 */
async function estimateTaskRows(db: Db, cfg: typeof companyConfig.$inferSelect, projectId: string) {
  const parameterRoles = resolveParameterRoles(cfg.parameterRoles)
  const costRoles = resolveCostRoles(cfg.costRoles)

  const taskRows = await db
    .select({
      taskId: tasks.id,
      taskCode: tasks.code,
      title: tasks.title,
      taskType: tasks.taskType,
      subTaskType: tasks.subTaskType,
      estimateMinutes: tasks.estimateMinutes,
      costWorkMinutesPerDay: tasks.costWorkMinutesPerDay,
      costBufferPercent: tasks.costBufferPercent,
      costRoleId: tasks.costRoleId,
      quotationSatang: tasks.quotationSatang,
      assigneeId: tasks.assigneeId,
      assigneeName: users.name,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.createdAt))

  return taskRows.map((t) => {
    const estMinutes = t.estimateMinutes ?? 0
    const bufferPercent = t.costBufferPercent ?? cfg.costBufferPercent
    const buffer = bufferMinutes(estMinutes, bufferPercent)
    const totalMinutes = estMinutes + buffer
    const workMinutesPerDay = t.costWorkMinutesPerDay ?? cfg.workHourCapMinutes
    const days = estimateDays(totalMinutes, workMinutesPerDay)

    const roleName = t.costRoleId ? (parameterRoleById(parameterRoles, t.costRoleId)?.name ?? null) : null
    const costPerDaySatang = t.costRoleId ? (costRoleByRoleId(costRoles, t.costRoleId)?.costPerDaySatang ?? null) : null
    const costPerHourSatang = costPerDaySatang != null ? costPerHourFromDay(costPerDaySatang) : null
    const netCostSatang = costPerHourSatang != null ? baseSatang(totalMinutes, costPerHourSatang) : null
    const margin = netCostSatang != null ? marginSatang(netCostSatang, cfg.costMarginPercent) : null
    // Pronista §Project Estimate v2 — คอลัมน์นี้เดิมชื่อ "Quotation Cost" เปลี่ยนชื่อเป็น "Estimate Cost" (ราคาที่คำนวณอัตโนมัติ) แยกจาก tasks.quotationSatang ที่ PM กรอกเอง (คอลัมน์ "Quotation Cost" ใหม่)
    const estimateCostSatang = netCostSatang != null && margin != null ? quotationSatang(netCostSatang, margin) : null

    return {
      taskId: t.taskId,
      taskCode: t.taskCode,
      title: t.title,
      taskType: t.taskType,
      subTaskType: t.subTaskType,
      assigneeId: t.assigneeId,
      assigneeName: t.assigneeName,
      costRoleId: t.costRoleId,
      roleName,
      costPerDaySatang,
      costPerHourSatang,
      estimateMinutes: estMinutes,
      bufferPercent,
      bufferMinutes: buffer,
      totalMinutes,
      netCostSatang,
      workMinutesPerDay,
      estimateDays: days,
      marginSatang: margin,
      estimateCostSatang,
      quotationSatang: t.quotationSatang,
    }
  })
}

/** vendor ห้ามเห็นการเงินโปรเจกต์ (SPEC §2/§4.8) — ตัดที่ server เสมอ */
function serialize<
  T extends {
    quotedSatang?: number | null
    paidPct?: number | null
    health?: string | null
    usagePct?: number | null
  },
>(p: T, role: string) {
  if (role === 'vendor' || role === 'guest') {
    const rest: Partial<T> = { ...p }
    delete rest.quotedSatang
    delete rest.paidPct
    delete rest.health
    delete rest.usagePct
    return rest
  }
  return p
}

/** ฝังชื่อ/สี/kind ของสถานะลง row (resolve จาก config) — FE ใช้ render chip + filter โดยไม่ต้องโหลด config ซ้ำ */
function statusFields(statuses: ReturnType<typeof resolveStatuses>, id: string) {
  const s = statusById(statuses, id)
  return { statusName: s?.name ?? id, statusColor: s?.color ?? 'slate', statusKind: s?.kind ?? 'active' }
}

export const projectRoutes = new Hono<AppEnv>()

  // ลิสต์ทั้งหมด (รวม archived — lightbox ใช้ค้น) · vendor ถูกตัดข้อมูลเงิน
  // งานต่อเนื่อง: แนบ todo เปิดอยู่ที่ใกล้กำหนดสุด (ตาราง "เรียงตาม todo ที่ต้องส่งก่อน")
  .get('/', async (c) => {
    const db = createDb(c.env.DB)
    const cfgRow = (
      await db
        .select({
          projectStatuses: companyConfig.projectStatuses,
          productStatuses: companyConfig.productStatuses,
          serviceTypes: companyConfig.serviceTypes,
          productTypes: companyConfig.productTypes,
        })
        .from(companyConfig)
        .limit(1)
    )[0]
    const projStatuses = resolveStatuses(cfgRow?.projectStatuses)
    const prodStatuses = resolveStatuses(cfgRow?.productStatuses)
    const statusesFor = (cat: string) => (cat === 'product' ? prodStatuses : projStatuses)
    const svcTypes = resolveServiceTypes(cfgRow?.serviceTypes)
    const prdTypes = resolveProductTypes(cfgRow?.productTypes)
    const rows = await db
      .select({ project: projects, clientName: clients.name, leadName: users.name })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .leftJoin(users, eq(projects.leadId, users.id))
      .where(isNull(projects.deletedAt))
      .orderBy(desc(projects.createdAt))
    // Pronista §PM View — progress ต่อโปรเจกต์ (งานทั้งหมด vs เสร็จแล้ว) ใช้กับ progress bar ในมุมมอง List/Board/Summary
    const allTasks = await db.select({ projectId: tasks.projectId, status: tasks.status }).from(tasks).where(isNotNull(tasks.projectId))
    const progressOf = (projectId: string) => {
      const mine = allTasks.filter((t) => t.projectId === projectId)
      return { total: mine.length, done: mine.filter((t) => t.status === 'done').length }
    }
    const openTasks = await db
      .select({
        projectId: tasks.projectId,
        title: tasks.title,
        dueDate: tasks.dueDate,
        assigneeName: users.name,
      })
      .from(tasks)
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .where(ne(tasks.status, 'done'))
    const firstOpen = new Map<string, (typeof openTasks)[number]>()
    for (const t of openTasks) {
      if (!t.projectId) continue // task ใน Backlog ยังไม่ผูกโปรเจกต์ ไม่มี card ให้แนบสรุป
      const cur = firstOpen.get(t.projectId)
      if (!cur || (t.dueDate ?? '9999') < (cur.dueDate ?? '9999')) firstOpen.set(t.projectId, t)
    }
    // %ลูกค้าจ่าย + จุดสี health ต่อโปรเจกต์ (→ card · vendor ถูกตัดที่ serialize)
    const allPayments = await db
      .select({ projectId: payments.projectId, amountSatang: payments.amountSatang, paidAt: payments.paidAt })
      .from(payments)
    const paidPctOf = (projectId: string): number | null => {
      const mine = allPayments.filter((p) => p.projectId === projectId)
      const total = mine.reduce((s, p) => s + p.amountSatang, 0)
      if (total === 0) return null
      return Math.round((mine.filter((p) => p.paidAt).reduce((s, p) => s + p.amountSatang, 0) / total) * 100)
    }
    const allEntries = await db
      .select({ projectId: timeEntries.projectId, minutes: timeEntries.minutes, rateSnapshotSatang: timeEntries.rateSnapshotSatang })
      .from(timeEntries)
      .where(isNull(timeEntries.deletedAt))
    const allMilestones = await db
      .select({ projectId: milestones.projectId, name: milestones.name, dueDate: milestones.dueDate, budgetSatang: milestones.budgetSatang, status: milestones.status })
      .from(milestones)
      .orderBy(asc(milestones.sortOrder))
    // Pronista §PM View — Timeline (Gantt) โชว์จุด milestone จริงต่อโปรเจกต์
    const milestonesOf = (projectId: string) => allMilestones.filter((m) => m.projectId === projectId).map(({ name, dueDate, status }) => ({ name, dueDate, status }))
    // Pronista §โปรเจกต์ Summary — "อัปเดตล่าสุด" จับจากงาน (task) ที่ขยับล่าสุดในโปรเจกต์ (audit_logs entity='task')
    const activity = await db
      .select({ projectId: tasks.projectId, at: auditLogs.at })
      .from(auditLogs)
      .innerJoin(tasks, eq(auditLogs.entityId, tasks.id))
      .where(eq(auditLogs.entity, 'task'))
    const lastActivityOf = new Map<string, number>()
    for (const a of activity) {
      if (!a.projectId) continue
      const at = a.at.getTime()
      const cur = lastActivityOf.get(a.projectId)
      if (!cur || at > cur) lastActivityOf.set(a.projectId, at)
    }
    const me = c.get('user')
    const role = me.role
    const today = bkkDateOf(Date.now())
    // Pronista §Customer Project Scope — ลูกค้า (guest) เห็นเฉพาะโปรเจกต์ที่ถูกเลือกไว้ตอนตั้งค่าผู้ใช้งาน
    let visibleRows = rows
    if (role === 'guest') {
      const [links, memberships] = await Promise.all([
        db.select({ projectId: customerProjects.projectId }).from(customerProjects).where(eq(customerProjects.userId, me.id)),
        db.select({ projectId: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, me.id)),
      ])
      const allowed = new Set([...links.map((l) => l.projectId), ...memberships.map((m) => m.projectId)])
      visibleRows = rows.filter((r) => allowed.has(r.project.id))
    }
    return c.json(
      visibleRows.map((r) => {
        const cost = costSatang(allEntries.filter((e) => e.projectId === r.project.id))
        const h = healthOf(
          cost,
          r.project.quotedSatang,
          allMilestones.filter((m) => m.projectId === r.project.id),
        )
        return serialize(
          {
            ...r.project,
            ...statusFields(statusesFor(r.project.category), r.project.status),
            clientName: r.clientName,
            leadName: r.leadName,
            openTodo: firstOpen.get(r.project.id) ?? null,
            paidPct: paidPctOf(r.project.id),
            health: h.health,
            usagePct: h.usagePct,
            progress: progressOf(r.project.id),
            milestones: milestonesOf(r.project.id),
            lastActivityAt: lastActivityOf.get(r.project.id) ?? null,
            // Pronista §Subscription Notify — ใกล้/เลยวันหมดอายุบริการแล้ว (ยังไม่ต่ออายุ) ใช้กรองแท็บ "บริการใกล้หมดอายุ"
            nearExpiry: isNearExpiry(r.project.serviceEndDate, r.project.notifyBeforeDays, today),
            serviceTypeName: serviceTypeById(svcTypes, r.project.serviceType)?.name ?? null,
            productTypeName: productTypeById(prdTypes, r.project.productType)?.name ?? null,
          },
          role,
        )
      }),
    )
  })

  .get('/:id', async (c) => {
    const db = createDb(c.env.DB)
    const row = (
      await db
        .select({ project: projects, clientName: clients.name })
        .from(projects)
        .leftJoin(clients, eq(projects.clientId, clients.id))
        .where(eq(projects.id, c.req.param('id')))
        .limit(1)
    )[0]
    if (!row || row.project.deletedAt) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    if (!(await isProjectVisibleToUser(db, row.project.id, me.id, me.role))) return c.json({ error: 'not_found' }, 404)
    const cfgRow = (
      await db
        .select({
          projectStatuses: companyConfig.projectStatuses,
          productStatuses: companyConfig.productStatuses,
          serviceTypes: companyConfig.serviceTypes,
          productTypes: companyConfig.productTypes,
        })
        .from(companyConfig)
        .limit(1)
    )[0]
    const statuses = resolveStatuses(row.project.category === 'product' ? cfgRow?.productStatuses : cfgRow?.projectStatuses)
    const serviceTypeName = serviceTypeById(resolveServiceTypes(cfgRow?.serviceTypes), row.project.serviceType)?.name ?? null
    const productTypeName = productTypeById(resolveProductTypes(cfgRow?.productTypes), row.project.productType)?.name ?? null
    const cfgPositions = (await db.select({ positions: companyConfig.positions }).from(companyConfig).limit(1))[0]
    const positionsList = resolvePositions(cfgPositions?.positions)
    // Pronista §Position-based permission — สมาชิกในโปรเจกต์ (พร้อมชื่อ/avatar/ตำแหน่ง) สำหรับการ์ดหัวโปรเจกต์ + หน้าแก้ไขสมาชิก
    const members = (
      await db
        .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl, role: users.role, positionId: projectMembers.positionId })
        .from(projectMembers)
        .innerJoin(users, eq(projectMembers.userId, users.id))
        .where(eq(projectMembers.projectId, row.project.id))
    ).map((m) => ({ ...m, positionName: positionById(positionsList, m.positionId)?.name ?? null }))
    // Pronista §Position-based permission — permission bundle เต็ม (tabs/actions) สำหรับคุมการมองเห็นเมนู/แท็บ + สิทธิ์เพิ่ม/แก้ไข/ลบละเอียด
    // (Performance review 2026-08-03) คำนวณครั้งเดียว แล้ว derive myRole จากผลลัพธ์นี้เลย แทนการเรียก getProjectRole() แยกซึ่งข้างในคำนวณ permission ซ้ำอีกรอบ
    const myPermissions = await getProjectPermissions(db, row.project.id, me.id, me.role)
    // Pronista §permission — สิทธิ์ของฉันในโปรเจกต์นี้โดยเฉพาะ (owner/editor/viewer) ให้ FE ใช้คุม UI โดยไม่ต้อง fetch แยก
    const myRole: 'owner' | 'editor' | 'viewer' = me.role === 'owner' ? 'owner' : hasAnyEditRight(myPermissions) ? 'editor' : 'viewer'
    // Pronista §Back to Basic (ต่อยอด) — Project Lead อาจไม่ใช่สมาชิกโปรเจกต์ (ไม่อยู่ใน project_members) จึงหาชื่อแยกจาก members ด้านบน
    const lead = row.project.leadId
      ? (await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, row.project.leadId)).limit(1))[0]
      : null
    return c.json(serialize({ ...row.project, ...statusFields(statuses, row.project.status), clientName: row.clientName, leadName: lead?.name ?? null, serviceTypeName, productTypeName, members, myRole, myPermissions }, me.role))
  })

  // สร้างโปรเจกต์ (owner เท่านั้น — Pronista §permission: จัดการข้อมูลโปรเจกต์เป็นงานของหัวหน้า) — ลูกค้าใหม่พิมพ์ชื่อ = สร้าง client ให้เลย
  .post('/', ownerOnly, async (c) => {
    const body = z
      .object({
        name: z.string().min(1),
        description: z.string().max(300).optional(),
        url: z.string().max(300).optional(),
        type: z.enum(['project', 'recurring']),
        status: z.string().optional(), // ตรวจกับ config ด้านล่าง
        clientId: z.string().optional(),
        clientName: z.string().min(1).optional(), // ใช้เมื่อไม่มี clientId
        // Pronista §Back to Basic (ต่อยอด) — Project Lead / หัวหน้าโครงการ
        leadId: z.string().optional(),
        quotedSatang: z.number().int().nonnegative().optional(),
        recurringPeriod: z.enum(['monthly', 'yearly']).optional(),
        startDate: isoDate.optional(),
        dueDate: isoDate.optional(),
        code: z.string().max(12).optional(),
        // Pronista §F1
        category: z.enum(['product', 'project']).optional(),
        tags: z.array(z.string().min(1).max(40)).max(20).optional(),
        sprint: z.string().max(60).optional(),
        priority: z.enum(['low', 'normal', 'high']).optional(),
        members: z.array(z.string()).max(50).optional(),
        // Pronista §Subscription Notify — ประเภทโปรเจกต์ + ช่วงเวลาให้บริการ (ไม่ระบุ serviceEndDate = lifetime)
        serviceType: z.string().optional(),
        // Pronista §Subscription Notify (Product Type) — ใช้เมื่อ category='product' เท่านั้น (คนละแคตตาล็อกกับ serviceType)
        productType: z.string().optional(),
        serviceStartDate: isoDate.optional(),
        serviceEndDate: isoDate.optional(),
        notifyBeforeDays: z.number().int().positive().optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const d = body.data
    const db = createDb(c.env.DB)

    // สถานะปรับเองได้ (SPEC §4.3) — ไม่ระบุ = active ตัวแรก · ระบุต้องมีจริงใน config
    const category = d.category ?? 'project'
    const cfg = (await db.select({ projectStatuses: companyConfig.projectStatuses, productStatuses: companyConfig.productStatuses }).from(companyConfig).limit(1))[0]
    const statuses = resolveStatuses(category === 'product' ? cfg?.productStatuses : cfg?.projectStatuses)
    if (d.status && !statusById(statuses, d.status)) return c.json({ error: 'invalid_status' }, 400)
    // ไม่ระบุ = active ตัวแรกของชุดสถานะตาม category
    const status = d.status ?? defaultStatusId(statuses)

    if (d.serviceType) {
      const cfgSvc = (await db.select({ serviceTypes: companyConfig.serviceTypes }).from(companyConfig).limit(1))[0]
      if (!serviceTypeById(resolveServiceTypes(cfgSvc?.serviceTypes), d.serviceType))
        return c.json({ error: 'invalid_service_type' }, 400)
    }
    if (d.productType) {
      const cfgPrd = (await db.select({ productTypes: companyConfig.productTypes }).from(companyConfig).limit(1))[0]
      if (!productTypeById(resolveProductTypes(cfgPrd?.productTypes), d.productType))
        return c.json({ error: 'invalid_product_type' }, 400)
    }
    if (d.serviceEndDate && d.serviceStartDate && d.serviceStartDate > d.serviceEndDate)
      return c.json({ error: 'invalid_service_period', message: 'วันเริ่มต้นต้องอยู่ก่อนวันสิ้นสุด' }, 400)

    let clientId = d.clientId ?? null
    if (!clientId && d.clientName) {
      const existing = (
        await db.select().from(clients).where(eq(clients.name, d.clientName)).limit(1)
      )[0]
      clientId =
        existing?.id ??
        (await db.insert(clients).values({ name: d.clientName }).returning())[0]?.id ??
        null
    }

    const inserted = await db
      .insert(projects)
      .values({
        name: d.name,
        description: d.description ?? null,
        url: d.url ?? null,
        code: d.code,
        type: d.type,
        category,
        status,
        clientId,
        leadId: d.leadId ?? null,
        quotedSatang: d.type === 'project' ? (d.quotedSatang ?? null) : null,
        billingType: d.type === 'recurring' ? 'recurring' : 'fixed',
        recurringPeriod: d.type === 'recurring' ? (d.recurringPeriod ?? 'monthly') : null,
        startDate: d.startDate,
        dueDate: d.dueDate,
        sprint: d.sprint ?? null,
        priority: d.priority ?? 'normal',
        tags: d.tags ?? null,
        serviceType: d.serviceType ?? null,
        productType: d.productType ?? null,
        serviceStartDate: d.serviceStartDate ?? null,
        serviceEndDate: d.serviceEndDate ?? null,
        notifyBeforeDays: d.notifyBeforeDays ?? null,
      })
      .returning()
    const p = inserted[0]
    if (!p) return c.json({ error: 'insert_failed' }, 500)
    // สมาชิกในโปรเจกต์ (assign ได้หลายคน — Pronista §F1)
    // Pronista §Position-based permission fix — ต้องตั้ง positionId ตอนสร้างเลย ไม่งั้นค่าเริ่มต้นคือ NULL = ไม่มีสิทธิ์อะไรเลยในระบบตำแหน่งใหม่
    // (คนที่ถูกติ๊กเลือกตอนสร้างโปรเจกต์ ควรทำงานในโปรเจกต์ได้ทันที จึงให้ "เข้าถึงเต็มรูปแบบ" เป็นค่าเริ่มต้น ปรับลดทีหลังได้ที่หน้าแก้ไขโปรเจกต์)
    if (d.members && d.members.length > 0)
      await db.insert(projectMembers).values(d.members.map((userId) => ({ projectId: p.id, userId, positionId: POSITION_FULL_ACCESS_ID })))
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'project.create',
      entity: 'project',
      entityId: p.id,
      meta: { name: p.name, quotedSatang: p.quotedSatang },
    })
    return c.json(p, 201)
  })

  // แก้โปรเจกต์ (owner หรือ member ที่เป็น editor ของโปรเจกต์นี้) — เปลี่ยนงบ = ข้อมูลเงิน → audit before/after
  .patch('/:id', teamOnly, async (c) => {
    const body = z
      .object({
        name: z.string().min(1).optional(),
        description: z.string().max(300).nullable().optional(),
        url: z.string().max(300).nullable().optional(),
        // ไอคอน: emoji | lucide:<name> | '' หรือ null = เคลียร์ — upload: ตั้งผ่าน POST /:id/logo เท่านั้น
        logo: z.string().refine(isPatchableLogo, 'invalid_logo').nullable().optional(),
        code: z.string().max(12).nullable().optional(),
        status: z.string().optional(), // ตรวจกับ config ด้านล่าง
        clientId: z.string().nullable().optional(),
        leadId: z.string().nullable().optional(),
        quotedSatang: z.number().int().nonnegative().nullable().optional(),
        recurringPeriod: z.enum(['monthly', 'yearly']).nullable().optional(),
        startDate: isoDate.nullable().optional(),
        dueDate: isoDate.nullable().optional(),
        // Pronista §F1
        category: z.enum(['product', 'project']).optional(),
        tags: z.array(z.string().min(1).max(40)).max(20).nullable().optional(),
        sprint: z.string().max(60).nullable().optional(),
        priority: z.enum(['low', 'normal', 'high']).optional(),
        // Pronista §Project Estimate — owner เท่านั้นที่แก้ได้ (เช็คด้านล่าง, ต่างจาก field อื่นในเอนด์พอยต์นี้ที่ editor แก้ได้)
        estimateNetWorkingDays: z.number().int().positive().nullable().optional(),
        // Pronista §Project Refactor — เนื้อหาแท็บ "API Document" (richtext อิสระต่อโปรเจกต์)
        apiDocNotes: z.string().nullable().optional(),
        // Pronista §Subscription Notify — แก้ประเภท/ช่วงเวลาให้บริการภายหลัง (เช่น ต่ออายุ) — เคลียร์ serviceEndDate = lifetime
        serviceType: z.string().nullable().optional(),
        // Pronista §Subscription Notify (Product Type) — ใช้เมื่อ category='product' เท่านั้น
        productType: z.string().nullable().optional(),
        serviceStartDate: isoDate.nullable().optional(),
        serviceEndDate: isoDate.nullable().optional(),
        notifyBeforeDays: z.number().int().positive().nullable().optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    if (body.data.estimateNetWorkingDays !== undefined && c.get('user').role !== 'owner') {
      return c.json({ error: 'forbidden', message: 'ตั้ง Net Working Days ได้เฉพาะ owner' }, 403)
    }
    const db = createDb(c.env.DB)
    if (body.data.status) {
      const cfg = (await db.select({ projectStatuses: companyConfig.projectStatuses, productStatuses: companyConfig.productStatuses }).from(companyConfig).limit(1))[0]
      const ok =
        statusById(resolveStatuses(cfg?.projectStatuses), body.data.status) ||
        statusById(resolveStatuses(cfg?.productStatuses), body.data.status)
      if (!ok) return c.json({ error: 'invalid_status' }, 400)
    }
    if (body.data.serviceType) {
      const cfgSvc = (await db.select({ serviceTypes: companyConfig.serviceTypes }).from(companyConfig).limit(1))[0]
      if (!serviceTypeById(resolveServiceTypes(cfgSvc?.serviceTypes), body.data.serviceType))
        return c.json({ error: 'invalid_service_type' }, 400)
    }
    if (body.data.productType) {
      const cfgPrd = (await db.select({ productTypes: companyConfig.productTypes }).from(companyConfig).limit(1))[0]
      if (!productTypeById(resolveProductTypes(cfgPrd?.productTypes), body.data.productType))
        return c.json({ error: 'invalid_product_type' }, 400)
    }
    const before = (
      await db.select().from(projects).where(eq(projects.id, c.req.param('id'))).limit(1)
    )[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    const myRole = await getProjectRole(db, before.id, me.id, me.role)
    if (!canEditProject(myRole)) return c.json({ error: 'forbidden' }, 403)
    // เปลี่ยน/เคลียร์วันหมดอายุ (เช่น ต่ออายุ) → reset สถานะแจ้งเตือน กันไม่ให้ cron มองว่าเคยเตือนไปแล้วรอบก่อน
    const patch: typeof body.data & { expiryNotifiedAt?: null } = { ...body.data }
    if ('serviceEndDate' in body.data && body.data.serviceEndDate !== before.serviceEndDate) patch.expiryNotifiedAt = null
    const updated = await db
      .update(projects)
      .set(patch)
      .where(eq(projects.id, before.id))
      .returning()
    // เปลี่ยน/เคลียร์ไอคอนทั้งที่ของเดิมเป็นโลโก้อัปโหลด → ลบไฟล์ R2 เก่าทิ้ง (กันขยะ)
    const prev = parseProjectLogo(before.logo)
    if (body.data.logo !== undefined && prev.kind === 'upload') {
      await c.env.FILES.delete(prev.key).catch(() => {})
    }
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'project.update',
      entity: 'project',
      entityId: before.id,
      meta: {
        before: { status: before.status, quotedSatang: before.quotedSatang },
        after: body.data,
      },
    })
    return c.json(serialize(updated[0] as Project, c.get('user').role))
  })

  // อัปโหลดโลโก้ลูกค้า → R2 (owner หรือ member ที่เป็น editor ของโปรเจกต์นี้ · ไม่รับ SVG กัน XSS เหมือนเอกสาร §4.16)
  // ตั้ง logo = upload:<r2key> · ลบไฟล์เก่าถ้าเคยอัปโหลดไว้
  .post('/:id/logo', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const before = (
      await db.select().from(projects).where(eq(projects.id, c.req.param('id'))).limit(1)
    )[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const meLogo = c.get('user')
    const logoRole = await getProjectRole(db, before.id, meLogo.id, meLogo.role)
    if (!canEditProject(logoRole)) return c.json({ error: 'forbidden' }, 403)
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400)
    if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type))
      return c.json({ error: 'invalid_type', message: 'รับเฉพาะรูป png/jpeg/gif/webp/avif (ไม่รับ SVG)' }, 415)
    if (file.size === 0 || file.size > MAX_LOGO_BYTES) return c.json({ error: 'file_too_large' }, 413)
    const r2Key = `project-logos/${before.id}/${crypto.randomUUID()}`
    await c.env.FILES.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type } })
    const updated = await db
      .update(projects)
      .set({ logo: uploadLogo(r2Key) })
      .where(eq(projects.id, before.id))
      .returning()
    const prev = parseProjectLogo(before.logo)
    if (prev.kind === 'upload') await c.env.FILES.delete(prev.key).catch(() => {})
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'project.update',
      entity: 'project',
      entityId: before.id,
      meta: { logo: 'upload', mime: file.type, sizeBytes: file.size },
    })
    return c.json(serialize(updated[0] as Project, c.get('user').role))
  })

  // serve โลโก้ที่อัปโหลด — ทุก role ที่ล็อกอิน (โลโก้ไม่ใช่ข้อมูลเงิน · vendor เห็นได้)
  .get('/:id/logo', async (c) => {
    const db = createDb(c.env.DB)
    const p = (
      await db
        .select({ logo: projects.logo })
        .from(projects)
        .where(eq(projects.id, c.req.param('id')))
        .limit(1)
    )[0]
    if (!p) return c.json({ error: 'not_found' }, 404)
    const parsed = parseProjectLogo(p.logo)
    if (parsed.kind !== 'upload') return c.json({ error: 'no_logo' }, 404)
    const obj = await c.env.FILES.get(parsed.key)
    if (!obj) return c.json({ error: 'object_missing' }, 404)
    return new Response(obj.body, {
      headers: {
        'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
        'cache-control': 'private, max-age=3600',
      },
    })
  })

  // Pronista §merge — เอกสารที่ผูกกับโปรเจกต์นี้ (Tab "เอกสาร" แทน Kanban/ตารางเดิม) — ผูกตรงกับโปรเจกต์ หรือผูกกับ task/sub-task ใดๆ ในโปรเจกต์นี้ก็นับด้วย
  .get('/:id/docs', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const projectTasks = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, projectId))
    const taskIds = projectTasks.map((t) => t.id)
    const where =
      taskIds.length > 0
        ? and(isNull(docs.deletedAt), or(eq(docLinks.projectId, projectId), inArray(docLinks.taskId, taskIds)))
        : and(isNull(docs.deletedAt), eq(docLinks.projectId, projectId))
    const rows = await db.select({ doc: docs }).from(docLinks).innerJoin(docs, eq(docLinks.docId, docs.id)).where(where)
    const seen = new Map<string, (typeof rows)[number]['doc']>()
    for (const r of rows) if (!seen.has(r.doc.id)) seen.set(r.doc.id, r.doc)
    return c.json(
      [...seen.values()].map((d) => ({ id: d.id, title: d.title, kind: d.kind, templateDocNumber: d.templateDocNumber, srsDocNumber: d.srsDocNumber, docType: d.docType })),
    )
  })

  // Pronista §System Requirements Update — แท็บ "Change Log" ต่อโปรเจกต์ — รวม audit_logs ของทุกสิ่งที่ผูกกับโปรเจกต์นี้ (task/epic/sprint/doc/project เอง) เรียงล่าสุดก่อน
  // การมองเห็นแท็บคุมด้วย tabs.changeLog (client-side เหมือนแท็บอื่น) — endpoint นี้ไม่จำกัด role เพิ่มเติม (ตาม pattern /:id/docs)
  .get('/:id/changelog', async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const [taskRows, epicRows, sprintRows] = await Promise.all([
      db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, projectId)),
      db.select({ id: epics.id }).from(epics).where(eq(epics.projectId, projectId)),
      db.select({ id: sprints.id }).from(sprints).where(eq(sprints.projectId, projectId)),
    ])
    const taskIds = taskRows.map((t) => t.id)
    const epicIds = epicRows.map((e) => e.id)
    const sprintIds = sprintRows.map((s) => s.id)
    const docRows = await db
      .select({ id: docs.id })
      .from(docLinks)
      .innerJoin(docs, eq(docLinks.docId, docs.id))
      .where(taskIds.length > 0 ? or(eq(docLinks.projectId, projectId), inArray(docLinks.taskId, taskIds)) : eq(docLinks.projectId, projectId))
    const docIds = [...new Set(docRows.map((d) => d.id))]

    const conditions = [and(eq(auditLogs.entity, 'project'), eq(auditLogs.entityId, projectId))]
    if (taskIds.length > 0) conditions.push(and(eq(auditLogs.entity, 'task'), inArray(auditLogs.entityId, taskIds)))
    if (epicIds.length > 0) conditions.push(and(eq(auditLogs.entity, 'epic'), inArray(auditLogs.entityId, epicIds)))
    if (sprintIds.length > 0) conditions.push(and(eq(auditLogs.entity, 'sprint'), inArray(auditLogs.entityId, sprintIds)))
    if (docIds.length > 0) conditions.push(and(eq(auditLogs.entity, 'doc'), inArray(auditLogs.entityId, docIds)))

    const rows = await db
      .select({ log: auditLogs, actorName: users.name, actorAvatarUrl: users.avatarUrl })
      .from(auditLogs)
      .innerJoin(users, eq(auditLogs.actorId, users.id))
      .where(or(...conditions))
      .orderBy(desc(auditLogs.at))
      .limit(300)
    return c.json({
      entries: rows.map((r) => ({
        id: r.log.id,
        at: r.log.at,
        actorName: r.actorName,
        actorAvatarUrl: r.actorAvatarUrl,
        action: r.log.action,
        entity: r.log.entity,
        meta: r.log.meta,
      })),
    })
  })

  // Pronista §Project Estimate v2 — ต้นทุนต่อ Task ของ "ทุก" task ในโปรเจกต์ (ไม่มี checkbox เลือกอีกต่อไป — PEP ต้องคิดจากงานทั้งหมดเสมอ)
  // เห็นเฉพาะ owner: เผยต้นทุน/margin ของทีมทั้งหมด ไม่ใช่แค่งบรวมของโปรเจกต์ · Role ต่อ task มาจาก company_config.parameterRoles ไม่ผูกกับตำแหน่งสิทธิ์ของสมาชิกโปรเจกต์
  .get('/:id/estimate', ownerOnly, async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')

    const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)

    const cfg = (await db.select().from(companyConfig).limit(1))[0]
    if (!cfg) return c.json({ error: 'config_missing' }, 500)

    const rows = await estimateTaskRows(db, cfg, projectId)

    const totalNetCostSatang = sumSatang(rows.map((r) => r.netCostSatang)) ?? 0
    const totalMarginSatang = sumSatang(rows.map((r) => r.marginSatang)) ?? 0
    const totalEstimateCostSatang = sumSatang(rows.map((r) => r.estimateCostSatang)) ?? 0
    const maxEstimateDays = rows.reduce((max, r) => Math.max(max, r.estimateDays), 0)

    const suggestedNetWorkingDays = maxEstimateDays > 0 ? Math.ceil(maxEstimateDays) : null
    const estimateProjectCostPerDaySatang =
      project.quotedSatang != null && project.estimateNetWorkingDays
        ? Math.round(project.quotedSatang / project.estimateNetWorkingDays)
        : null

    return c.json({
      rows,
      totals: { netCostSatang: totalNetCostSatang, marginSatang: totalMarginSatang, estimateCostSatang: totalEstimateCostSatang },
      project: { estimateNetWorkingDays: project.estimateNetWorkingDays, quotedSatang: project.quotedSatang },
      suggestedNetWorkingDays,
      estimateProjectCostPerDaySatang,
    })
  })

  // Pronista §Project Estimate v2 — Tab "Task Group": รวม task ทั้งหมดตาม Task Type/Sub-type (catalog เดียวกับ ตั้งค่า > ประเภทงาน)
  // กลุ่มที่มี task จริง → รวมอัตโนมัติ (อ่านอย่างเดียว) · กลุ่มที่ PM เลือกเพิ่มเองผ่านแถว custom (estimate_group_overrides) → กรอกเอง
  // Task Group ไม่ auto-list ทุก sub-type ในแคตตาล็อกอีกต่อไป — โชว์เฉพาะกลุ่มที่มี task จริง หรือกลุ่มที่ PM กดเพิ่มแถวเองเท่านั้น
  .get('/:id/estimate/groups', ownerOnly, async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')

    const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)
    const cfg = (await db.select().from(companyConfig).limit(1))[0]
    if (!cfg) return c.json({ error: 'config_missing' }, 500)
    const parameterRoles = resolveParameterRoles(cfg.parameterRoles)
    const costRoles = resolveCostRoles(cfg.costRoles)
    const taskTypes = resolveTaskTypes(cfg.taskTypes)

    const taskRows = await estimateTaskRows(db, cfg, projectId)
    const overrides = await db.select().from(estimateGroupOverrides).where(eq(estimateGroupOverrides.projectId, projectId))
    const extraCosts = await db
      .select()
      .from(estimateExtraCosts)
      .where(eq(estimateExtraCosts.projectId, projectId))
      .orderBy(asc(estimateExtraCosts.sortOrder), asc(estimateExtraCosts.createdAt))

    const groups = []
    for (const tt of taskTypes) {
      for (const st of tt.subTypes) {
        const memberTasks = taskRows.filter((r) => r.taskType === tt.id && r.subTaskType === st.id)
        if (memberTasks.length > 0) {
          const teamMemberNames = [...new Set(memberTasks.map((r) => r.assigneeName).filter((n): n is string => !!n))]
          const roleNames = [...new Set(memberTasks.map((r) => r.roleName).filter((n): n is string => !!n))]
          groups.push({
            taskTypeId: tt.id,
            subTaskTypeId: st.id,
            name: st.name,
            source: 'auto' as const,
            teamMember: teamMemberNames.join(', ') || null,
            teamMemberIds: [] as string[],
            role: roleNames.join(', ') || null,
            costRoleId: null as string | null,
            costPerDaySatang: null,
            costPerHourSatang: null,
            estimateMinutes: sumMinutes(memberTasks.map((r) => r.estimateMinutes)),
            bufferPercent: null as number | null,
            bufferMinutes: sumMinutes(memberTasks.map((r) => r.bufferMinutes)),
            totalMinutes: sumMinutes(memberTasks.map((r) => r.totalMinutes)),
            netCostSatang: sumSatang(memberTasks.map((r) => r.netCostSatang)),
            workMinutesPerDay: null,
            estimateDays: memberTasks.reduce((sum, r) => sum + r.estimateDays, 0),
            marginSatang: sumSatang(memberTasks.map((r) => r.marginSatang)),
            estimateCostSatang: sumSatang(memberTasks.map((r) => r.estimateCostSatang)),
            quotationSatang: sumSatang(memberTasks.map((r) => r.quotationSatang)),
          })
          continue
        }
        const ov = overrides.find((o) => o.taskTypeId === tt.id && o.subTaskTypeId === st.id)
        if (!ov) continue // ไม่มี task จริง และ PM ยังไม่ได้กดเพิ่มแถวนี้เอง → ไม่ต้องโชว์
        const estMinutes = ov.estimateMinutes ?? 0
        const bufferPercent = ov.bufferPercent ?? cfg.costBufferPercent
        const buffer = bufferMinutes(estMinutes, bufferPercent)
        const totalMinutes = estMinutes + buffer
        const workMinutesPerDay = ov.workMinutesPerDay ?? cfg.workHourCapMinutes
        const days = estimateDays(totalMinutes, workMinutesPerDay)
        const roleName = ov.costRoleId ? (parameterRoleById(parameterRoles, ov.costRoleId)?.name ?? null) : null
        const costPerDaySatang = ov.costRoleId ? (costRoleByRoleId(costRoles, ov.costRoleId)?.costPerDaySatang ?? null) : null
        const costPerHourSatang = costPerDaySatang != null ? costPerHourFromDay(costPerDaySatang) : null
        const netCostSatang = costPerHourSatang != null ? baseSatang(totalMinutes, costPerHourSatang) : null
        const margin = netCostSatang != null ? marginSatang(netCostSatang, cfg.costMarginPercent) : null
        const estimateCost = netCostSatang != null && margin != null ? quotationSatang(netCostSatang, margin) : null
        groups.push({
          taskTypeId: tt.id,
          subTaskTypeId: st.id,
          name: st.name,
          source: 'manual' as const,
          teamMember: null,
          teamMemberIds: ov.teamMemberIds ?? [],
          role: roleName,
          costRoleId: ov.costRoleId ?? null,
          costPerDaySatang,
          costPerHourSatang,
          estimateMinutes: estMinutes,
          bufferPercent,
          bufferMinutes: buffer,
          totalMinutes,
          netCostSatang,
          workMinutesPerDay,
          estimateDays: days,
          marginSatang: margin,
          estimateCostSatang: estimateCost,
          quotationSatang: ov.quotationSatang ?? null,
        })
      }
    }

    const extraCostsSatang = extraCosts.reduce((sum, x) => sum + x.amountSatang, 0)
    const netCostSatang = (sumSatang(groups.map((g) => g.netCostSatang)) ?? 0) + extraCostsSatang
    const marginTotal = sumSatang(groups.map((g) => g.marginSatang)) ?? 0
    const estimateCostTotal = (sumSatang(groups.map((g) => g.estimateCostSatang)) ?? 0) + extraCostsSatang
    const quotationTotal = (sumSatang(groups.map((g) => g.quotationSatang)) ?? 0) + extraCostsSatang

    return c.json({
      groups,
      extraCosts: extraCosts.map((x) => ({ id: x.id, name: x.name, amountSatang: x.amountSatang })),
      totals: {
        netCostSatang,
        marginSatang: marginTotal,
        extraCostsSatang,
        estimateCostSatang: estimateCostTotal,
        quotationSatang: quotationTotal,
      },
    })
  })

  // Pronista §Project Estimate v2 — บันทึกค่าที่ PM กรอกเองสำหรับ Task Group ที่กดเพิ่มแถวเอง (upsert บน projectId+taskTypeId+subTaskTypeId)
  .put('/:id/estimate/groups/override', ownerOnly, async (c) => {
    const body = z
      .object({
        taskTypeId: z.string(),
        subTaskTypeId: z.string().nullable(),
        teamMemberIds: z.array(z.string()).nullable().optional(),
        costRoleId: z.string().nullable().optional(),
        estimateMinutes: z.number().int().nonnegative().nullable().optional(),
        bufferPercent: z.number().int().min(0).max(100).nullable().optional(),
        workMinutesPerDay: z.number().int().positive().nullable().optional(),
        quotationSatang: z.number().int().nonnegative().nullable().optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const { taskTypeId, subTaskTypeId, ...rest } = body.data
    const existing = (
      await db
        .select({ id: estimateGroupOverrides.id })
        .from(estimateGroupOverrides)
        .where(
          and(
            eq(estimateGroupOverrides.projectId, projectId),
            eq(estimateGroupOverrides.taskTypeId, taskTypeId),
            subTaskTypeId ? eq(estimateGroupOverrides.subTaskTypeId, subTaskTypeId) : isNull(estimateGroupOverrides.subTaskTypeId),
          ),
        )
        .limit(1)
    )[0]
    if (existing) {
      await db.update(estimateGroupOverrides).set(rest).where(eq(estimateGroupOverrides.id, existing.id))
    } else {
      await db.insert(estimateGroupOverrides).values({ projectId, taskTypeId, subTaskTypeId, ...rest })
    }
    return c.json({ ok: true })
  })

  // Pronista §Project Estimate v2 — ลบแถว Task Group ที่ PM กดเพิ่มเองออก (แถวที่มี task จริงอยู่แล้วลบไม่ได้ตรงนี้ ต้องลบที่ Task)
  .delete('/:id/estimate/groups/override', ownerOnly, async (c) => {
    const taskTypeId = c.req.query('taskTypeId')
    const subTaskTypeId = c.req.query('subTaskTypeId')
    if (!taskTypeId || !subTaskTypeId) return c.json({ error: 'taskTypeId และ subTaskTypeId จำเป็น' }, 400)
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    await db
      .delete(estimateGroupOverrides)
      .where(
        and(
          eq(estimateGroupOverrides.projectId, projectId),
          eq(estimateGroupOverrides.taskTypeId, taskTypeId),
          eq(estimateGroupOverrides.subTaskTypeId, subTaskTypeId),
        ),
      )
    return c.json({ ok: true })
  })

  // Pronista §Project Estimate v2 — Tab "Phase": รวม Estimate Day จาก Tab Task Group ตามหัวข้อหลัก (Task Type)
  .get('/:id/estimate/phases', ownerOnly, async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)
    const cfg = (await db.select().from(companyConfig).limit(1))[0]
    if (!cfg) return c.json({ error: 'config_missing' }, 500)
    const taskTypes = resolveTaskTypes(cfg.taskTypes)
    const taskRows = await estimateTaskRows(db, cfg, projectId)
    const overrides = await db.select().from(estimateGroupOverrides).where(eq(estimateGroupOverrides.projectId, projectId))

    const phases = taskTypes.map((tt) => {
      let totalDays = 0
      for (const st of tt.subTypes) {
        const memberTasks = taskRows.filter((r) => r.taskType === tt.id && r.subTaskType === st.id)
        if (memberTasks.length > 0) {
          totalDays += memberTasks.reduce((sum, r) => sum + r.estimateDays, 0)
          continue
        }
        const ov = overrides.find((o) => o.taskTypeId === tt.id && o.subTaskTypeId === st.id)
        if (!ov) continue
        const estMinutes = ov.estimateMinutes ?? 0
        const buffer = bufferMinutes(estMinutes, ov.bufferPercent ?? cfg.costBufferPercent)
        totalDays += estimateDays(estMinutes + buffer, ov.workMinutesPerDay ?? cfg.workHourCapMinutes)
      }
      return { taskTypeId: tt.id, name: tt.name, totalEstimateDays: totalDays }
    })

    return c.json({ phases })
  })

  // Pronista §Project Estimate v2 — Grid ค่าใช้จ่ายนอกระบบใน Tab Task Group (Cloud, ค่าเดินทาง ฯลฯ) รวมเข้ายอดรวมเสมอ
  .get('/:id/estimate/extra-costs', ownerOnly, async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db
      .select()
      .from(estimateExtraCosts)
      .where(eq(estimateExtraCosts.projectId, c.req.param('id')))
      .orderBy(asc(estimateExtraCosts.sortOrder), asc(estimateExtraCosts.createdAt))
    return c.json(rows.map((x) => ({ id: x.id, name: x.name, amountSatang: x.amountSatang })))
  })

  .post('/:id/estimate/extra-costs', ownerOnly, async (c) => {
    const body = z.object({ name: z.string().min(1).max(200), amountSatang: z.number().int().nonnegative() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const maxSort = (
      await db.select({ sortOrder: estimateExtraCosts.sortOrder }).from(estimateExtraCosts).where(eq(estimateExtraCosts.projectId, projectId))
    ).reduce((max, r) => Math.max(max, r.sortOrder), -1)
    const created = (
      await db
        .insert(estimateExtraCosts)
        .values({ projectId, name: body.data.name, amountSatang: body.data.amountSatang, sortOrder: maxSort + 1 })
        .returning()
    )[0]!
    return c.json({ id: created.id, name: created.name, amountSatang: created.amountSatang })
  })

  .patch('/:id/estimate/extra-costs/:costId', ownerOnly, async (c) => {
    const body = z
      .object({ name: z.string().min(1).max(200).optional(), amountSatang: z.number().int().nonnegative().optional() })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    await db
      .update(estimateExtraCosts)
      .set(body.data)
      .where(and(eq(estimateExtraCosts.id, c.req.param('costId')), eq(estimateExtraCosts.projectId, c.req.param('id'))))
    return c.json({ ok: true })
  })

  .delete('/:id/estimate/extra-costs/:costId', ownerOnly, async (c) => {
    const db = createDb(c.env.DB)
    await db
      .delete(estimateExtraCosts)
      .where(and(eq(estimateExtraCosts.id, c.req.param('costId')), eq(estimateExtraCosts.projectId, c.req.param('id'))))
    return c.json({ ok: true })
  })

  // Pronista §Feedback batch 3 — เดิม owner เท่านั้น เปิดให้ editor ของโปรเจกต์นั้นๆ จัดการสมาชิกโปรเจกต์ตัวเองได้ด้วย (แก้ปัญหาสร้างโปรเจกต์แล้วมาเพิ่มสมาชิกทีหลังไม่ได้ถ้าไม่ใช่ owner)
  // upsert บน (projectId, userId) — เรียกซ้ำ = เปลี่ยนตำแหน่งเดิม ไม่สร้างแถวซ้ำ (unique index กันไว้)
  // Pronista §Member Management — role member ต้องมีตำแหน่ง (สิทธิ์มาจากตำแหน่ง) · vendor/guest ไม่มีตำแหน่งของตัวเอง (สิทธิ์มาจากเพดานหมวดตรงๆ ผ่าน getProjectPermissions) — positionId เป็น null ได้
  .post('/:id/members', teamOnly, async (c) => {
    const body = z.object({ userId: z.string(), positionId: z.string().optional() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const project = (await db.select().from(projects).where(eq(projects.id, c.req.param('id'))).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    if (!canEditProject(await getProjectRole(db, project.id, me.id, me.role))) return c.json({ error: 'forbidden' }, 403)
    const targetUser = (await db.select().from(users).where(eq(users.id, body.data.userId)).limit(1))[0]
    if (!targetUser) return c.json({ error: 'user_not_found' }, 404)
    if (targetUser.role === 'owner') return c.json({ error: 'owner_has_full_access', message: 'owner เข้าถึงได้ทุกโปรเจกต์อยู่แล้ว ไม่ต้องเพิ่มเป็นสมาชิก' }, 400)
    let positionId: string | null = null
    if (targetUser.role === 'member') {
      if (!body.data.positionId) return c.json({ error: 'position_required', message: 'พนักงาน (member) ต้องเลือกตำแหน่ง' }, 400)
      const cfg = (await db.select({ positions: companyConfig.positions }).from(companyConfig).limit(1))[0]
      if (!positionById(resolvePositions(cfg?.positions), body.data.positionId)) return c.json({ error: 'position_not_found' }, 404)
      positionId = body.data.positionId
    }
    const upserted = await db
      .insert(projectMembers)
      .values({ projectId: project.id, userId: targetUser.id, positionId })
      .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { positionId } })
      .returning()
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'project.member_position',
      entity: 'project',
      entityId: project.id,
      meta: { userId: targetUser.id, positionId },
    })
    return c.json(upserted[0])
  })

  // Pronista §Feedback batch 3 — เอาสมาชิกออกจากโปรเจกต์ (owner หรือ editor ของโปรเจกต์นั้นๆ เหมือนตั้งตำแหน่ง) — เดิมมีแค่ insert/upsert ไม่มีทางเอาออกเลย
  .delete('/:id/members/:userId', teamOnly, async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')
    const userId = c.req.param('userId')
    const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)
    const me = c.get('user')
    if (!canEditProject(await getProjectRole(db, project.id, me.id, me.role))) return c.json({ error: 'forbidden' }, 403)
    await db.delete(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    await writeAudit(c.env, {
      actorId: me.id,
      action: 'project.member_remove',
      entity: 'project',
      entityId: projectId,
      meta: { userId },
    })
    return c.json({ ok: true })
  })

  // Pronista §Project Refactor — ลบโปรเจกต์ (Admin เท่านั้น = owner) · soft-delete เท่านั้น (กฎเหล็ก) ไม่ลบข้อมูลจริง
  .delete('/:id', ownerOnly, async (c) => {
    const db = createDb(c.env.DB)
    const before = (await db.select().from(projects).where(eq(projects.id, c.req.param('id'))).limit(1))[0]
    if (!before || before.deletedAt) return c.json({ error: 'not_found' }, 404)
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, before.id))
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'project.delete',
      entity: 'project',
      entityId: before.id,
      meta: { name: before.name },
    })
    return c.json({ ok: true })
  })

// (picker ลูกค้าย้ายไปใช้ GET /api/clients ของ CRM — routes/clients.ts)
