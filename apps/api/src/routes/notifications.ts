import { createDb, notifications } from '@seedoffice/db'
import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppEnv } from '../types'

/**
 * Tasknista §My Work/Notification — แจ้งเตือนในระบบเท่านั้น (ไม่ส่งอีเมล/แจ้งเตือนออกนอกระบบ) ตอน assign/complete Subtask
 * ของตัวเองเท่านั้น (userId = me.id เสมอ) — ไม่มี endpoint ให้ดูของคนอื่น
 */
export const notificationRoutes = new Hono<AppEnv>()

  .get('/notifications', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, me.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50)
    return c.json(rows)
  })

  .post('/notifications/:id/read', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const updated = await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, c.req.param('id')), eq(notifications.userId, me.id)))
      .returning()
    if (!updated[0]) return c.json({ error: 'not_found' }, 404)
    return c.json(updated[0])
  })

  .post('/notifications/mark-all-read', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, me.id))
    return c.json({ ok: true })
  })
