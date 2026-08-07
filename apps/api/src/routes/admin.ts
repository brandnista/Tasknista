import {
  bkkDateOf,
  BOARD_COLOR_KEYS,
  PERMISSION_RESOURCE_KEYS,
  PERMISSION_TAB_KEYS,
  resolveLabels,
  resolvePresets,
  resolvePositions,
  resolveProductTypes,
  resolveServiceTypes,
  resolveStatuses,
  STATUS_COLOR_KEYS,
  validateLabels,
  validatePositions,
  validatePresets,
  validateProductTypes,
  validateServiceTypes,
  validateStatuses,
  type BoardPreset,
  type Label,
  type Position,
  type ProductType,
  type ProjectStatus,
  type ServiceType,
} from '@seedoffice/core'
import { companyConfig, createDb, projectMembers, projects, rates, sprints, tasks, teams, users } from '@seedoffice/db'
import { asc, eq, isNotNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { newToken } from '../lib/session'
import type { AppEnv } from '../types'

const icsUrl = (appUrl: string, token: string) => `${appUrl}/api/calendar/feed/${token}`

/** owner เท่านั้น (ติด requireAuth + ownerOnly ตอน mount) — provision user / จัดการทีม / config */
export const adminRoutes = new Hono<AppEnv>()

  // ตารางผู้ใช้เต็ม (email/status/ทีม)
  .get('/users', async (c) => {
    const db = createDb(c.env.DB)
    const all = await db.select().from(users).orderBy(asc(users.role), asc(users.name))
    const allTeams = await db.select().from(teams)
    const teamName = new Map(allTeams.map((t) => [t.id, t.name]))
    return c.json(all.map((u) => ({ ...u, teamName: u.teamId ? (teamName.get(u.teamId) ?? null) : null })))
  })

  // รายชื่อทีม/แผนก (จัดกลุ่มผู้ใช้เฉยๆ ไม่เกี่ยวกับสิทธิ์)
  .get('/teams', async (c) => {
    const db = createDb(c.env.DB)
    return c.json(await db.select().from(teams).orderBy(asc(teams.name)))
  })

  .post('/teams', async (c) => {
    const body = z.object({ name: z.string().min(1).max(60) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const inserted = await db.insert(teams).values({ name: body.data.name }).returning()
    return c.json(inserted[0], 201)
  })

  // provision user ใหม่ (member ในโดเมน หรือ vendor allowlist อีเมลภายนอก)
  .post('/users', async (c) => {
    const body = z
      .object({
        email: z.string().email().toLowerCase(),
        name: z.string().min(1),
        role: z.enum(['owner', 'member', 'vendor', 'guest']),
        teamId: z.string().nullable().optional(),
        // Pronista §Project Estimate — ตำแหน่ง/ต้นทุนต่อวัน (ใหม่ แยกจาก rates เดิม)
        jobTitle: z.string().max(80).nullable().optional(),
        costPerDaySatang: z.number().int().nonnegative().nullable().optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)

    const db = createDb(c.env.DB)
    const dup = (await db.select().from(users).where(eq(users.email, body.data.email)).limit(1))[0]
    if (dup) return c.json({ error: 'email_exists' }, 409)

    const inserted = await db
      .insert(users)
      .values({
        email: body.data.email,
        name: body.data.name,
        role: body.data.role,
        teamId: body.data.teamId ?? null,
        jobTitle: body.data.jobTitle ?? null,
        costPerDaySatang: body.data.costPerDaySatang ?? null,
      })
      .returning()
    const user = inserted[0]
    if (!user) return c.json({ error: 'insert_failed' }, 500)

    // Pronista เป็น PM app ล้วนๆ ไม่มี UI ตั้ง rate แล้ว — ใส่ rate ตั้งต้น (ไม่แสดงที่ไหน) กัน time-entry บล็อกเพราะไม่มี rate
    await db.insert(rates).values({ userId: user.id, rateSatangPerHour: 0, effectiveFrom: bkkDateOf(Date.now()) })
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'user.create',
      entity: 'user',
      entityId: user.id,
      meta: { email: user.email, role: user.role },
    })
    return c.json(user, 201)
  })

  // แก้ชื่อ/role/สถานะ (ปิดการใช้งาน = status disabled — session เดิมใช้ไม่ได้ทันที)
  .patch('/users/:id', async (c) => {
    const body = z
      .object({
        name: z.string().min(1).optional(),
        email: z.string().email().toLowerCase().optional(),
        role: z.enum(['owner', 'member', 'vendor', 'guest']).optional(),
        status: z.enum(['active', 'disabled']).optional(),
        teamId: z.string().nullable().optional(),
        // Pronista §Project Estimate — ตำแหน่ง/ต้นทุนต่อวัน (ใหม่ แยกจาก rates เดิม)
        jobTitle: z.string().max(80).nullable().optional(),
        costPerDaySatang: z.number().int().nonnegative().nullable().optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const before = (await db.select().from(users).where(eq(users.id, c.req.param('id'))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    if (body.data.email && body.data.email !== before.email) {
      const dup = (await db.select().from(users).where(eq(users.email, body.data.email)).limit(1))[0]
      if (dup) return c.json({ error: 'email_exists' }, 409)
    }
    const updated = await db
      .update(users)
      .set(body.data)
      .where(eq(users.id, before.id))
      .returning()
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'user.update',
      entity: 'user',
      entityId: before.id,
      meta: { before: { role: before.role, status: before.status }, after: body.data },
    })
    return c.json(updated[0])
  })

  // แก้ config บริษัท
  .patch('/config', async (c) => {
    const body = z
      .object({
        cutoffDay: z.number().int().min(1).max(28).optional(),
        workHourCapMinutes: z.number().int().min(60).max(1440).optional(),
        // โดเมน auto-provision member — ต้องขึ้นต้น @ มีจุดอย่างน้อย 1 จุด · '' = ปิด auto-provision
        memberDomain: z
          .string()
          .trim()
          .toLowerCase()
          .max(64)
          .regex(/^(@[a-z0-9-]+(\.[a-z0-9-]+)+)?$/, 'ต้องเป็นรูปแบบ @example.com หรือเว้นว่าง')
          .optional(),
        // Pronista §Project Estimate — % buffer/margin default ใช้คำนวณต้นทุน
        costBufferPercent: z.number().int().min(0).max(100).optional(),
        costMarginPercent: z.number().int().min(0).max(100).optional(),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const before = (await db.select().from(companyConfig).limit(1))[0]
    const updated = await db
      .update(companyConfig)
      .set(body.data)
      .where(eq(companyConfig.id, 1))
      .returning()
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'config.update',
      entity: 'company_config',
      entityId: '1',
      meta: { before, after: body.data },
    })
    return c.json(updated[0])
  })

  // สถานะโปรเจกต์ปรับเองได้ (SPEC §4.3) — owner บันทึกทั้งลิสต์ (เพิ่ม/ลบ/เรียง/ชื่อ/สี)
  // Pronista §PM View — category แยกชุดสถานะ product/project กันคนละคอลัมน์ (company_config.productStatuses/projectStatuses) ตาม category ของโปรเจกต์
  // กันลบสถานะที่ยังมีโปรเจกต์ (เฉพาะ category นั้น) ใช้อยู่ (ต้องย้ายโปรเจกต์ออกก่อน)
  .put('/project-statuses', async (c) => {
    const body = z
      .object({
        category: z.enum(['product', 'project']).default('project'),
        statuses: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              color: z.enum(STATUS_COLOR_KEYS),
              kind: z.enum(['active', 'archived']),
              sortOrder: z.number().int(),
            }),
          )
          .min(1),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const { category, statuses: rawStatuses } = body.data
    const statuses = rawStatuses as ProjectStatus[]
    const check = validateStatuses(statuses)
    if (!check.ok) return c.json({ error: 'invalid', message: check.error }, 400)

    const db = createDb(c.env.DB)
    // กันลบสถานะที่ใช้อยู่ — เช็คเฉพาะโปรเจกต์ใน category เดียวกัน (แต่ละ category มีชุดสถานะ/id เป็นอิสระจากกัน)
    const used = await db.selectDistinct({ status: projects.status }).from(projects).where(eq(projects.category, category))
    const newIds = new Set(statuses.map((s) => s.id))
    const orphan = used.map((u) => u.status).filter((s) => !newIds.has(s))
    if (orphan.length > 0)
      return c.json(
        { error: 'status_in_use', message: `ยังมีโปรเจกต์ใช้สถานะ: ${orphan.join(', ')} — ย้ายออกก่อนจึงลบได้` },
        409,
      )

    const before = (await db.select({ projectStatuses: companyConfig.projectStatuses, productStatuses: companyConfig.productStatuses }).from(companyConfig).limit(1))[0]
    await db.update(companyConfig).set({ [category === 'product' ? 'productStatuses' : 'projectStatuses']: statuses }).where(eq(companyConfig.id, 1))
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: `config.${category}_statuses`,
      entity: 'company_config',
      entityId: '1',
      meta: { before: (category === 'product' ? before?.productStatuses : before?.projectStatuses) ?? null, after: statuses },
    })
    return c.json({ [category === 'product' ? 'productStatuses' : 'projectStatuses']: resolveStatuses(statuses) })
  })

  // Pronista §Sprint & Board — preset คอลัมน์บอร์ดปรับเองได้ (owner บันทึกทั้งลิสต์)
  // กันลบ preset ที่ sprint ใช้อยู่ (ทั้ง planned/active/completed — completed ต้องอ้าง preset เดิมได้เพื่อดูประวัติ/รายงาน)
  .put('/board-presets', async (c) => {
    const body = z
      .object({
        presets: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              columns: z
                .array(
                  z.object({
                    id: z.string(),
                    name: z.string(),
                    color: z.enum(BOARD_COLOR_KEYS),
                    sortOrder: z.number().int(),
                  }),
                )
                .min(2),
            }),
          )
          .min(1),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const presetsData = body.data.presets as BoardPreset[]
    const check = validatePresets(presetsData)
    if (!check.ok) return c.json({ error: 'invalid', message: check.error }, 400)

    const db = createDb(c.env.DB)
    const used = await db.selectDistinct({ boardPresetId: sprints.boardPresetId }).from(sprints)
    const newIds = new Set(presetsData.map((p) => p.id))
    const orphan = used.map((u) => u.boardPresetId).filter((id): id is string => id !== null && !newIds.has(id))
    if (orphan.length > 0)
      return c.json(
        { error: 'preset_in_use', message: `ยังมี Sprint ใช้ preset: ${orphan.join(', ')} — ลบไม่ได้` },
        409,
      )

    const before = (await db.select({ boardPresets: companyConfig.boardPresets }).from(companyConfig).limit(1))[0]
    await db.update(companyConfig).set({ boardPresets: presetsData }).where(eq(companyConfig.id, 1))
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'config.board_presets',
      entity: 'company_config',
      entityId: '1',
      meta: { before: before?.boardPresets ?? null, after: presetsData },
    })
    return c.json({ boardPresets: resolvePresets(presetsData) })
  })

  // Pronista §Position-based permission — แคตตาล็อกตำแหน่งต่อโปรเจกต์ (BA/PM/ฯลฯ)
  .get('/positions', async (c) => {
    const db = createDb(c.env.DB)
    const cfg = (await db.select({ positions: companyConfig.positions }).from(companyConfig).limit(1))[0]
    return c.json({ positions: resolvePositions(cfg?.positions) })
  })

  // owner บันทึกทั้งลิสต์ (เพิ่ม/ลบ/เรียง/checkbox สิทธิ์) — กันลบตำแหน่งที่ยังมีสมาชิกโปรเจกต์ใช้อยู่
  .put('/positions', async (c) => {
    const body = z
      .object({
        positions: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              sortOrder: z.number().int(),
              permissions: z.object({
                tabs: z.record(z.enum(PERMISSION_TAB_KEYS), z.boolean()),
                actions: z.record(
                  z.enum(PERMISSION_RESOURCE_KEYS),
                  z.object({ create: z.boolean(), edit: z.boolean(), delete: z.boolean() }),
                ),
              }),
            }),
          )
          .min(1),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const positionsData = body.data.positions as Position[]
    const check = validatePositions(positionsData)
    if (!check.ok) return c.json({ error: 'invalid', message: check.error }, 400)

    const db = createDb(c.env.DB)
    const used = await db.selectDistinct({ positionId: projectMembers.positionId }).from(projectMembers)
    const newIds = new Set(positionsData.map((p) => p.id))
    const orphan = used.map((u) => u.positionId).filter((id): id is string => id !== null && !newIds.has(id))
    if (orphan.length > 0)
      return c.json(
        { error: 'position_in_use', message: `ยังมีสมาชิกโปรเจกต์ใช้ตำแหน่ง: ${orphan.join(', ')} — ย้ายออกก่อนจึงลบได้` },
        409,
      )

    const before = (await db.select({ positions: companyConfig.positions }).from(companyConfig).limit(1))[0]
    await db.update(companyConfig).set({ positions: positionsData }).where(eq(companyConfig.id, 1))
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'config.positions',
      entity: 'company_config',
      entityId: '1',
      meta: { before: before?.positions ?? null, after: positionsData },
    })
    return c.json({ positions: resolvePositions(positionsData) })
  })

  // Pronista §Subscription Notify — แคตตาล็อกประเภทโปรเจกต์ (Website Dev/Mobile App/ฯลฯ)
  .get('/service-types', async (c) => {
    const db = createDb(c.env.DB)
    const cfg = (await db.select({ serviceTypes: companyConfig.serviceTypes }).from(companyConfig).limit(1))[0]
    return c.json({ serviceTypes: resolveServiceTypes(cfg?.serviceTypes) })
  })

  // owner บันทึกทั้งลิสต์ (เพิ่ม/ลบ/เรียง/แก้ชื่อ) — กันลบประเภทที่ยังมีโปรเจกต์ใช้อยู่
  .put('/service-types', async (c) => {
    const body = z
      .object({
        serviceTypes: z
          .array(z.object({ id: z.string(), name: z.string(), sortOrder: z.number().int() }))
          .min(1),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const serviceTypesData = body.data.serviceTypes as ServiceType[]
    const check = validateServiceTypes(serviceTypesData)
    if (!check.ok) return c.json({ error: 'invalid', message: check.error }, 400)

    const db = createDb(c.env.DB)
    const used = await db.selectDistinct({ serviceType: projects.serviceType }).from(projects)
    const newIds = new Set(serviceTypesData.map((s) => s.id))
    const orphan = used.map((u) => u.serviceType).filter((id): id is string => id !== null && !newIds.has(id))
    if (orphan.length > 0)
      return c.json(
        { error: 'service_type_in_use', message: `ยังมีโปรเจกต์ใช้ประเภท: ${orphan.join(', ')} — เปลี่ยนประเภทของโปรเจกต์นั้นก่อนจึงลบได้` },
        409,
      )

    const before = (await db.select({ serviceTypes: companyConfig.serviceTypes }).from(companyConfig).limit(1))[0]
    await db.update(companyConfig).set({ serviceTypes: serviceTypesData }).where(eq(companyConfig.id, 1))
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'config.service_types',
      entity: 'company_config',
      entityId: '1',
      meta: { before: before?.serviceTypes ?? null, after: serviceTypesData },
    })
    return c.json({ serviceTypes: resolveServiceTypes(serviceTypesData) })
  })

  // Pronista §Subscription Notify (Product Type) — แคตตาล็อกชื่อผลิตภัณฑ์ (Sellnista/Paynista/ฯลฯ) ใช้เมื่อ category='product'
  .get('/product-types', async (c) => {
    const db = createDb(c.env.DB)
    const cfg = (await db.select({ productTypes: companyConfig.productTypes }).from(companyConfig).limit(1))[0]
    return c.json({ productTypes: resolveProductTypes(cfg?.productTypes) })
  })

  // owner บันทึกทั้งลิสต์ (เพิ่ม/ลบ/เรียง/แก้ชื่อ) — กันลบประเภทที่ยังมีโปรเจกต์ใช้อยู่
  .put('/product-types', async (c) => {
    const body = z
      .object({
        productTypes: z
          .array(z.object({ id: z.string(), name: z.string(), sortOrder: z.number().int() }))
          .min(1),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const productTypesData = body.data.productTypes as ProductType[]
    const check = validateProductTypes(productTypesData)
    if (!check.ok) return c.json({ error: 'invalid', message: check.error }, 400)

    const db = createDb(c.env.DB)
    const used = await db.selectDistinct({ productType: projects.productType }).from(projects)
    const newIds = new Set(productTypesData.map((p) => p.id))
    const orphan = used.map((u) => u.productType).filter((id): id is string => id !== null && !newIds.has(id))
    if (orphan.length > 0)
      return c.json(
        { error: 'product_type_in_use', message: `ยังมีโปรเจกต์ใช้ประเภทสินค้า: ${orphan.join(', ')} — เปลี่ยนประเภทของโปรเจกต์นั้นก่อนจึงลบได้` },
        409,
      )

    const before = (await db.select({ productTypes: companyConfig.productTypes }).from(companyConfig).limit(1))[0]
    await db.update(companyConfig).set({ productTypes: productTypesData }).where(eq(companyConfig.id, 1))
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'config.product_types',
      entity: 'company_config',
      entityId: '1',
      meta: { before: before?.productTypes ?? null, after: productTypesData },
    })
    return c.json({ productTypes: resolveProductTypes(productTypesData) })
  })

  // Pronista §Workspace — แคตตาล็อกแท็กสีของ Task (Bug/Urgent/Blocked/ฯลฯ)
  .get('/labels', async (c) => {
    const db = createDb(c.env.DB)
    const cfg = (await db.select({ labels: companyConfig.labels }).from(companyConfig).limit(1))[0]
    return c.json({ labels: resolveLabels(cfg?.labels) })
  })

  // owner บันทึกทั้งลิสต์ (เพิ่ม/ลบ/เรียง/แก้ชื่อ/สี) — กันลบ label ที่ยังมี task ผูกอยู่ (labelIds เป็น array ต่างจาก serviceType/productType ที่เป็นค่าเดียว)
  .put('/labels', async (c) => {
    const body = z
      .object({
        labels: z
          .array(z.object({ id: z.string(), name: z.string(), color: z.string(), sortOrder: z.number().int() }))
          .min(1),
      })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const labelsData = body.data.labels as Label[]
    const check = validateLabels(labelsData)
    if (!check.ok) return c.json({ error: 'invalid', message: check.error }, 400)

    const db = createDb(c.env.DB)
    const used = await db.select({ labelIds: tasks.labelIds }).from(tasks).where(isNotNull(tasks.labelIds))
    const usedIds = new Set(used.flatMap((u) => u.labelIds ?? []))
    const newIds = new Set(labelsData.map((l) => l.id))
    const orphan = [...usedIds].filter((id) => !newIds.has(id))
    if (orphan.length > 0)
      return c.json(
        { error: 'label_in_use', message: `ยังมี Task ผูก label: ${orphan.join(', ')} — เอาออกจาก Task ก่อนจึงลบได้` },
        409,
      )

    const before = (await db.select({ labels: companyConfig.labels }).from(companyConfig).limit(1))[0]
    await db.update(companyConfig).set({ labels: labelsData }).where(eq(companyConfig.id, 1))
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'config.labels',
      entity: 'company_config',
      entityId: '1',
      meta: { before: before?.labels ?? null, after: labelsData },
    })
    return c.json({ labels: resolveLabels(labelsData) })
  })

  // ── ICS feed (SPEC §4.14 · E6) — ลิงก์ subscribe ปฏิทินทีม (owner สร้าง/รีเซ็ต/ปิด) ──
  // ลิงก์เดียวแชร์ทั้งทีม · token ลับ = ตัวกันเข้าถึง (ไม่ส่งออกทาง GET /api/config)
  .get('/ics-link', async (c) => {
    const db = createDb(c.env.DB)
    const [cfg] = await db
      .select({ icsToken: companyConfig.icsToken })
      .from(companyConfig)
      .limit(1)
    return c.json({ url: cfg?.icsToken ? icsUrl(c.env.APP_URL, cfg.icsToken) : null })
  })

  // สร้าง/รีเซ็ตลิงก์ — รีเซ็ตคือเปลี่ยน token (ลิงก์เดิมใช้ไม่ได้ทันที)
  .post('/ics-link/regenerate', async (c) => {
    const db = createDb(c.env.DB)
    const token = newToken()
    await db.update(companyConfig).set({ icsToken: token }).where(eq(companyConfig.id, 1))
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'config.ics_regenerate',
      entity: 'company_config',
      entityId: '1',
    })
    return c.json({ url: icsUrl(c.env.APP_URL, token) })
  })

  // ปิดลิงก์ (feed คืน 404)
  .delete('/ics-link', async (c) => {
    const db = createDb(c.env.DB)
    await db.update(companyConfig).set({ icsToken: null }).where(eq(companyConfig.id, 1))
    await writeAudit(c.env, {
      actorId: c.get('user').id,
      action: 'config.ics_disable',
      entity: 'company_config',
      entityId: '1',
    })
    return c.json({ url: null })
  })
