import { createDb, sellnistaSubscriptions } from '@seedoffice/db'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import type { AppEnv } from '../types'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const sellnistaPayload = z.object({
  name: z.string().min(1).max(255),
  expiryDate: isoDate,
  notifyEnabled: z.boolean().optional(),
})

/**
 * Pronista §System Enhancements — Sellnista: รายการบริการที่ Subscribe กับระบบ Sellnista (owner-only ผ่าน /api/admin/* ที่ index.ts)
 * ระบบแยกต่างหากจาก domains โดยตั้งใจ (พี่ยืนยัน ไม่ผูก productTypes/Subscription Notify ของ projects) — โครง CRUD ก็อป domains.ts เป๊ะ
 * แจ้งเตือนหลายระดับ (30/15/7/1 วัน) ทำใน scheduled.ts:notifySellnistaExpiry — ที่นี่แค่ CRUD ล้วนๆ
 */
export const sellnistaRoutes = new Hono<AppEnv>()

  .get('/sellnista', async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db.select().from(sellnistaSubscriptions).where(isNull(sellnistaSubscriptions.deletedAt)).orderBy(desc(sellnistaSubscriptions.expiryDate))
    return c.json(rows)
  })

  .get('/sellnista/:id', async (c) => {
    const db = createDb(c.env.DB)
    const row = (
      await db.select().from(sellnistaSubscriptions).where(and(eq(sellnistaSubscriptions.id, c.req.param('id')), isNull(sellnistaSubscriptions.deletedAt))).limit(1)
    )[0]
    if (!row) return c.json({ error: 'not_found' }, 404)
    return c.json(row)
  })

  .post('/sellnista', async (c) => {
    const body = sellnistaPayload.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const created = (
      await db
        .insert(sellnistaSubscriptions)
        .values({ name: body.data.name, expiryDate: body.data.expiryDate, notifyEnabled: body.data.notifyEnabled ?? true, createdBy: me.id })
        .returning()
    )[0]!
    await writeAudit(c.env, { actorId: me.id, action: 'sellnista.create', entity: 'sellnista_subscription', entityId: created.id, meta: { name: created.name } })
    return c.json(created, 201)
  })

  .patch('/sellnista/:id', async (c) => {
    const body = sellnistaPayload.partial().safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (
      await db.select().from(sellnistaSubscriptions).where(and(eq(sellnistaSubscriptions.id, c.req.param('id')), isNull(sellnistaSubscriptions.deletedAt))).limit(1)
    )[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (body.data.name !== undefined) patch.name = body.data.name
    if (body.data.notifyEnabled !== undefined) patch.notifyEnabled = body.data.notifyEnabled
    // Pronista §Domain Management pattern — เปลี่ยนวันหมดอายุ = เกตแจ้งเตือนต้องเคลียร์ใหม่ทั้งหมด
    if (body.data.expiryDate !== undefined && body.data.expiryDate !== before.expiryDate) {
      patch.expiryDate = body.data.expiryDate
      patch.notifiedTiers = null
      patch.expiredNotifiedAt = null
    }
    const updated = (await db.update(sellnistaSubscriptions).set(patch).where(eq(sellnistaSubscriptions.id, before.id)).returning())[0]
    await writeAudit(c.env, { actorId: me.id, action: 'sellnista.update', entity: 'sellnista_subscription', entityId: before.id, meta: { before, patch } })
    return c.json(updated)
  })

  .delete('/sellnista/:id', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (
      await db.select().from(sellnistaSubscriptions).where(and(eq(sellnistaSubscriptions.id, c.req.param('id')), isNull(sellnistaSubscriptions.deletedAt))).limit(1)
    )[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    await db.update(sellnistaSubscriptions).set({ deletedAt: new Date() }).where(eq(sellnistaSubscriptions.id, before.id))
    await writeAudit(c.env, { actorId: me.id, action: 'sellnista.delete', entity: 'sellnista_subscription', entityId: before.id, meta: { name: before.name } })
    return c.json({ ok: true })
  })
