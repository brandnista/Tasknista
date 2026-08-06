import {
  baseSatang,
  bkkDateOf,
  bufferMinutes,
  costPerHourFromDay,
  costSatang,
  defaultStatusId,
  estimateDays,
  hasAnyEditRight,
  isNearExpiry,
  isPatchableLogo,
  marginSatang,
  parseProjectLogo,
  positionById,
  POSITION_FULL_ACCESS_ID,
  quotationSatang,
  resolvePositions,
  resolveServiceTypes,
  resolveStatuses,
  serviceTypeById,
  statusById,
  uploadLogo,
} from '@seedoffice/core'
import { auditLogs, clients, companyConfig, createDb, docLinks, docs, milestones, payments, projectMembers, projects, tasks, timeEntries, users, type Project } from '@seedoffice/db'
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'
import { healthOf } from './finance'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { canEditProject, getProjectPermissions, getProjectRole } from '../lib/project-role'
import { ownerOnly, teamOnly } from '../middleware/roles'
import type { AppEnv } from '../types'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const MAX_LOGO_BYTES = 2 * 1024 * 1024 // โลโก้ลูกค้า ≤ 2MB

/** vendor ห้ามเห็นการเงินโปรเจกต์ (SPEC §2/§4.8) — ตัดที่ server เสมอ */
function serialize<
  T extends {
    quotedSatang?: number | null
    paidPct?: number | null
    health?: string | null
    usagePct?: number | null
  },
>(p: T, role: string) {
  if (role === 'vendor') {
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
        .select({ projectStatuses: companyConfig.projectStatuses, productStatuses: companyConfig.productStatuses, serviceTypes: companyConfig.serviceTypes })
        .from(companyConfig)
        .limit(1)
    )[0]
    const projStatuses = resolveStatuses(cfgRow?.projectStatuses)
    const prodStatuses = resolveStatuses(cfgRow?.productStatuses)
    const statusesFor = (cat: string) => (cat === 'product' ? prodStatuses : projStatuses)
    const svcTypes = resolveServiceTypes(cfgRow?.serviceTypes)
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
    const role = c.get('user').role
    const today = bkkDateOf(Date.now())
    return c.json(
      rows.map((r) => {
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
    const cfgRow = (
      await db
        .select({ projectStatuses: companyConfig.projectStatuses, productStatuses: companyConfig.productStatuses, serviceTypes: companyConfig.serviceTypes })
        .from(companyConfig)
        .limit(1)
    )[0]
    const statuses = resolveStatuses(row.project.category === 'product' ? cfgRow?.productStatuses : cfgRow?.projectStatuses)
    const serviceTypeName = serviceTypeById(resolveServiceTypes(cfgRow?.serviceTypes), row.project.serviceType)?.name ?? null
    const cfgPositions = (await db.select({ positions: companyConfig.positions }).from(companyConfig).limit(1))[0]
    const positionsList = resolvePositions(cfgPositions?.positions)
    // Pronista §Position-based permission — สมาชิกในโปรเจกต์ (พร้อมชื่อ/avatar/ตำแหน่ง) สำหรับการ์ดหัวโปรเจกต์ + หน้าแก้ไขสมาชิก
    const members = (
      await db
        .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl, positionId: projectMembers.positionId })
        .from(projectMembers)
        .innerJoin(users, eq(projectMembers.userId, users.id))
        .where(eq(projectMembers.projectId, row.project.id))
    ).map((m) => ({ ...m, positionName: positionById(positionsList, m.positionId)?.name ?? null }))
    const me = c.get('user')
    // Pronista §Position-based permission — permission bundle เต็ม (tabs/actions) สำหรับคุมการมองเห็นเมนู/แท็บ + สิทธิ์เพิ่ม/แก้ไข/ลบละเอียด
    // (Performance review 2026-08-03) คำนวณครั้งเดียว แล้ว derive myRole จากผลลัพธ์นี้เลย แทนการเรียก getProjectRole() แยกซึ่งข้างในคำนวณ permission ซ้ำอีกรอบ
    const myPermissions = await getProjectPermissions(db, row.project.id, me.id, me.role)
    // Pronista §permission — สิทธิ์ของฉันในโปรเจกต์นี้โดยเฉพาะ (owner/editor/viewer) ให้ FE ใช้คุม UI โดยไม่ต้อง fetch แยก
    const myRole: 'owner' | 'editor' | 'viewer' = me.role === 'owner' ? 'owner' : hasAnyEditRight(myPermissions) ? 'editor' : 'viewer'
    // Pronista §Back to Basic (ต่อยอด) — Project Lead อาจไม่ใช่สมาชิกโปรเจกต์ (ไม่อยู่ใน project_members) จึงหาชื่อแยกจาก members ด้านบน
    const lead = row.project.leadId
      ? (await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, row.project.leadId)).limit(1))[0]
      : null
    return c.json(serialize({ ...row.project, ...statusFields(statuses, row.project.status), clientName: row.clientName, leadName: lead?.name ?? null, serviceTypeName, members, myRole, myPermissions }, me.role))
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

  // Pronista §Project Estimate — ต้นทุนต่อ Task (เห็นเฉพาะ owner: เผยต้นทุน/margin ของทีมทั้งหมด ไม่ใช่แค่งบรวมของโปรเจกต์)
  .get('/:id/estimate', ownerOnly, async (c) => {
    const db = createDb(c.env.DB)
    const projectId = c.req.param('id')

    const project = (await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)

    const cfg = (await db.select().from(companyConfig).limit(1))[0]
    if (!cfg) return c.json({ error: 'config_missing' }, 500)

    const taskRows = await db
      .select({
        taskId: tasks.id,
        taskCode: tasks.code,
        title: tasks.title,
        estimateMinutes: tasks.estimateMinutes,
        costWorkMinutesPerDay: tasks.costWorkMinutesPerDay,
        costBufferPercent: tasks.costBufferPercent,
        assigneeId: users.id,
        assigneeName: users.name,
        jobTitle: users.jobTitle,
        costPerDaySatang: users.costPerDaySatang,
      })
      .from(tasks)
      .innerJoin(users, eq(tasks.assigneeId, users.id))
      .where(and(eq(tasks.projectId, projectId), isNotNull(tasks.assigneeId), isNotNull(tasks.estimateMinutes)))

    let totalNetCostSatang = 0
    let totalMarginSatang = 0
    let totalQuotationSatang = 0
    let maxEstimateDays = 0

    const rows = taskRows.map((t) => {
      const estMinutes = t.estimateMinutes ?? 0 // กรองมาแล้วว่าไม่ null จาก WHERE ด้านบน
      const bufferPercent = t.costBufferPercent ?? cfg.costBufferPercent
      const buffer = bufferMinutes(estMinutes, bufferPercent)
      const totalMinutes = estMinutes + buffer
      const workMinutesPerDay = t.costWorkMinutesPerDay ?? cfg.workHourCapMinutes
      const days = estimateDays(totalMinutes, workMinutesPerDay)
      maxEstimateDays = Math.max(maxEstimateDays, days)

      const costPerHourSatang = t.costPerDaySatang != null ? costPerHourFromDay(t.costPerDaySatang) : null
      const netCostSatang = costPerHourSatang != null ? baseSatang(totalMinutes, costPerHourSatang) : null
      const margin = netCostSatang != null ? marginSatang(netCostSatang, cfg.costMarginPercent) : null
      const quotation = netCostSatang != null && margin != null ? quotationSatang(netCostSatang, margin) : null
      if (netCostSatang != null && margin != null && quotation != null) {
        totalNetCostSatang += netCostSatang
        totalMarginSatang += margin
        totalQuotationSatang += quotation
      }

      return {
        taskId: t.taskId,
        taskCode: t.taskCode,
        title: t.title,
        assigneeId: t.assigneeId,
        assigneeName: t.assigneeName,
        jobTitle: t.jobTitle,
        costPerDaySatang: t.costPerDaySatang,
        costPerHourSatang,
        estimateMinutes: estMinutes,
        bufferPercent,
        bufferMinutes: buffer,
        totalMinutes,
        netCostSatang,
        workMinutesPerDay,
        estimateDays: days,
        marginSatang: margin,
        quotationSatang: quotation,
      }
    })

    const suggestedNetWorkingDays = maxEstimateDays > 0 ? Math.ceil(maxEstimateDays) : null
    const estimateProjectCostPerDaySatang =
      project.quotedSatang != null && project.estimateNetWorkingDays
        ? Math.round(project.quotedSatang / project.estimateNetWorkingDays)
        : null

    return c.json({
      rows,
      totals: { netCostSatang: totalNetCostSatang, marginSatang: totalMarginSatang, quotationSatang: totalQuotationSatang },
      project: { estimateNetWorkingDays: project.estimateNetWorkingDays, quotedSatang: project.quotedSatang },
      suggestedNetWorkingDays,
      estimateProjectCostPerDaySatang,
    })
  })

  // Pronista §Position-based permission — ตั้ง/เปลี่ยนตำแหน่งของสมาชิกในโปรเจกต์ (owner เท่านั้น — กันการยกระดับสิทธิ์เอง)
  // upsert บน (projectId, userId) — เรียกซ้ำ = เปลี่ยนตำแหน่งเดิม ไม่สร้างแถวซ้ำ (unique index กันไว้)
  .post('/:id/members', ownerOnly, async (c) => {
    const body = z.object({ userId: z.string(), positionId: z.string() }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const project = (await db.select().from(projects).where(eq(projects.id, c.req.param('id'))).limit(1))[0]
    if (!project) return c.json({ error: 'not_found' }, 404)
    const targetUser = (await db.select().from(users).where(eq(users.id, body.data.userId)).limit(1))[0]
    if (!targetUser) return c.json({ error: 'user_not_found' }, 404)
    // ตำแหน่งต่อโปรเจกต์มีผลเฉพาะ member (owner แก้ได้ทุกอย่างอยู่แล้ว · vendor ถูก teamOnly กันไว้ชั้นนอก) — กันตั้งตำแหน่งให้คนที่ไม่ใช้งานจริง
    if (targetUser.role !== 'member')
      return c.json({ error: 'not_a_member', message: 'ตั้งตำแหน่งต่อโปรเจกต์ได้เฉพาะผู้ใช้ role member เท่านั้น' }, 400)
    const cfg = (await db.select({ positions: companyConfig.positions }).from(companyConfig).limit(1))[0]
    if (!positionById(resolvePositions(cfg?.positions), body.data.positionId))
      return c.json({ error: 'position_not_found' }, 404)
    const upserted = await db
      .insert(projectMembers)
      .values({ projectId: project.id, userId: targetUser.id, positionId: body.data.positionId })
      .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { positionId: body.data.positionId } })
      .returning()
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'project.member_position',
      entity: 'project',
      entityId: project.id,
      meta: { userId: targetUser.id, positionId: body.data.positionId },
    })
    return c.json(upserted[0])
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
