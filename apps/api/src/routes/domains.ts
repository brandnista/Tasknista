import { createDb, domains, projects, users } from '@seedoffice/db'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import type { AppEnv } from '../types'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const dnsRecordSchema = z.object({
  id: z.string(),
  type: z.string().min(1).max(20),
  host: z.string().max(255),
  value: z.string().min(1).max(1000),
  ttl: z.number().int().positive(),
})
const dsRecordSchema = z.object({
  id: z.string(),
  keyTag: z.string().max(20),
  algorithm: z.string().max(20),
  digestType: z.string().max(20),
  digest: z.string().max(500),
})

const domainPayload = z.object({
  name: z.string().min(1).max(255),
  registeredDate: isoDate.nullable().optional(),
  expiryDate: isoDate,
  provider: z.string().max(255).nullable().optional(),
  responsibleUserId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  notifyEnabled: z.boolean().optional(),
  nameservers: z.array(z.string().max(255)).max(6).nullable().optional(),
  forwardingUrl: z.string().max(1000).nullable().optional(),
  forwardingType: z.string().max(20).nullable().optional(),
  dnsRecords: z.array(dnsRecordSchema).nullable().optional(),
  privacyProtectionEnabled: z.boolean().optional(),
  googleWorkspaceVerified: z.boolean().optional(),
  googleWorkspaceNotes: z.string().max(2000).nullable().optional(),
  dsRecords: z.array(dsRecordSchema).nullable().optional(),
})

/**
 * Pronista §Domain Management (2026-08-27) — ทะเบียนโดเมนของบริษัท + วันหมดอายุ (owner-only ผ่าน /api/admin/* ที่ index.ts)
 * แจ้งเตือนหลายระดับ (30/15/7/1 วัน) ทำใน scheduled.ts:notifyDomainExpiry — ที่นี่แค่ CRUD ล้วนๆ
 * Pronista §Domain Detail Page (2026-08-28) — เพิ่มฟิลด์ Nameservers/Forwarding/DNS/Privacy/Google Workspace/DS
 * ทุกฟิลด์เป็นบันทึกข้อมูลในระบบเราเท่านั้น ไม่ได้เชื่อม API ของ registrar จริง (ตกลงกับเจ้าของแล้ว — ดูโครงหน้าอย่างเดียว)
 */
export const domainRoutes = new Hono<AppEnv>()

  .get('/domains', async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db
      .select({ domain: domains, responsibleName: users.name, projectName: projects.name })
      .from(domains)
      .leftJoin(users, eq(domains.responsibleUserId, users.id))
      .leftJoin(projects, eq(domains.projectId, projects.id))
      .where(isNull(domains.deletedAt))
      .orderBy(desc(domains.expiryDate))
    return c.json(rows.map((r) => ({ ...r.domain, responsibleName: r.responsibleName, projectName: r.projectName })))
  })

  .get('/domains/:id', async (c) => {
    const db = createDb(c.env.DB)
    const row = (
      await db
        .select({ domain: domains, responsibleName: users.name, projectName: projects.name })
        .from(domains)
        .leftJoin(users, eq(domains.responsibleUserId, users.id))
        .leftJoin(projects, eq(domains.projectId, projects.id))
        .where(and(eq(domains.id, c.req.param('id')), isNull(domains.deletedAt)))
        .limit(1)
    )[0]
    if (!row) return c.json({ error: 'not_found' }, 404)
    return c.json({ ...row.domain, responsibleName: row.responsibleName, projectName: row.projectName })
  })

  .post('/domains', async (c) => {
    const body = domainPayload.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const created = (
      await db
        .insert(domains)
        .values({
          name: body.data.name,
          registeredDate: body.data.registeredDate ?? null,
          expiryDate: body.data.expiryDate,
          provider: body.data.provider ?? null,
          responsibleUserId: body.data.responsibleUserId ?? null,
          projectId: body.data.projectId ?? null,
          createdBy: me.id,
        })
        .returning()
    )[0]!
    await writeAudit(c.env, { actorId: me.id, action: 'domain.create', entity: 'domain', entityId: created.id, meta: { name: created.name } })
    return c.json(created, 201)
  })

  .patch('/domains/:id', async (c) => {
    const body = domainPayload.partial().safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select().from(domains).where(and(eq(domains.id, c.req.param('id')), isNull(domains.deletedAt))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (body.data.name !== undefined) patch.name = body.data.name
    if (body.data.registeredDate !== undefined) patch.registeredDate = body.data.registeredDate
    if (body.data.provider !== undefined) patch.provider = body.data.provider
    if (body.data.responsibleUserId !== undefined) patch.responsibleUserId = body.data.responsibleUserId
    if (body.data.projectId !== undefined) patch.projectId = body.data.projectId
    if (body.data.notifyEnabled !== undefined) patch.notifyEnabled = body.data.notifyEnabled
    if (body.data.nameservers !== undefined) patch.nameservers = body.data.nameservers
    if (body.data.forwardingUrl !== undefined) patch.forwardingUrl = body.data.forwardingUrl
    if (body.data.forwardingType !== undefined) patch.forwardingType = body.data.forwardingType
    if (body.data.dnsRecords !== undefined) patch.dnsRecords = body.data.dnsRecords
    if (body.data.privacyProtectionEnabled !== undefined) patch.privacyProtectionEnabled = body.data.privacyProtectionEnabled
    if (body.data.googleWorkspaceVerified !== undefined) patch.googleWorkspaceVerified = body.data.googleWorkspaceVerified
    if (body.data.googleWorkspaceNotes !== undefined) patch.googleWorkspaceNotes = body.data.googleWorkspaceNotes
    if (body.data.dsRecords !== undefined) patch.dsRecords = body.data.dsRecords
    // Pronista §Domain Management — เปลี่ยนวันหมดอายุ = เกตแจ้งเตือนต้องเคลียร์ใหม่ทั้งหมด (มิเรอร์ pattern expiryNotifiedAt/dueNotifiedAt เดิม)
    if (body.data.expiryDate !== undefined && body.data.expiryDate !== before.expiryDate) {
      patch.expiryDate = body.data.expiryDate
      patch.notifiedTiers = null
      patch.expiredNotifiedAt = null
    }
    const updated = (await db.update(domains).set(patch).where(eq(domains.id, before.id)).returning())[0]
    await writeAudit(c.env, { actorId: me.id, action: 'domain.update', entity: 'domain', entityId: before.id, meta: { before, patch } })
    return c.json(updated)
  })

  .delete('/domains/:id', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select().from(domains).where(and(eq(domains.id, c.req.param('id')), isNull(domains.deletedAt))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    await db.update(domains).set({ deletedAt: new Date() }).where(eq(domains.id, before.id))
    await writeAudit(c.env, { actorId: me.id, action: 'domain.delete', entity: 'domain', entityId: before.id, meta: { name: before.name } })
    return c.json({ ok: true })
  })
