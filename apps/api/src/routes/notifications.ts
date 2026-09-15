import { DEFAULT_MEETING_REMINDER_MINUTES, NOTIFICATION_CATEGORIES } from '@seedoffice/core'
import { createDb, notifications, users, NOTIFICATION_TYPES } from '@seedoffice/db'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types'

/**
 * Pronista §My Work/Notification — แจ้งเตือนในระบบเท่านั้น (ไม่ส่งอีเมล/แจ้งเตือนออกนอกระบบ) ตอน assign/complete Subtask
 * ของตัวเองเท่านั้น (userId = me.id เสมอ) — ไม่มี endpoint ให้ดูของคนอื่น
 */
export const notificationRoutes = new Hono<AppEnv>()

  // Pronista §System Enhancements — เดิม hardcode limit 50 ไม่มี filter/pagination (พอสำหรับ dropdown 20 แถวบนสุด)
  // เพิ่ม page/pageSize/category (optional) รองรับหน้า "การแจ้งเตือน" แบบเต็ม — ไม่ส่ง query เลยพฤติกรรมเหมือนเดิมทุกอย่าง (จำกัด 50, ไม่มี total)
  .get('/notifications', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(200).optional(),
        category: z.string().optional(),
      })
      .safeParse(c.req.query())
    if (!query.success) return c.json({ error: 'invalid' }, 400)
    const { page, pageSize, category } = query.data
    const cat = category ? NOTIFICATION_CATEGORIES.find((x) => x.key === category) : undefined
    const where = cat
      ? and(eq(notifications.userId, me.id), inArray(notifications.type, cat.types as (typeof NOTIFICATION_TYPES)[number][]))
      : eq(notifications.userId, me.id)

    // ไม่ส่ง page มา = โหมดเดิม (dropdown) จำกัด 50 แถว ไม่มี total
    if (page === undefined) {
      const rows = await db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(50)
      return c.json(rows)
    }
    const size = pageSize ?? 20
    const [rows, totalRow] = await Promise.all([
      db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(size).offset((page - 1) * size),
      db.select({ n: count() }).from(notifications).where(where),
    ])
    return c.json({ rows, total: totalRow[0]?.n ?? 0 })
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

  // Pronista §My Note badge (2026-09-01) — เปิดแท็บ/หน้าที่มี badge เฉพาะประเภทแล้ว mark อ่านทั้งประเภทนั้นทันที (mirror markChannelRead ของแชท แต่ generic ด้วย type แทน channel)
  .post('/notifications/mark-type-read', async (c) => {
    const body = z.object({ type: z.enum(NOTIFICATION_TYPES) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    await db.update(notifications).set({ isRead: true }).where(and(eq(notifications.userId, me.id), eq(notifications.type, body.data.type)))
    return c.json({ ok: true })
  })

  // Pronista §Notification overhaul (2026-08-27) — ตั้งค่าส่วนตัว: ประเภทแจ้งเตือนที่ปิดไว้ (ว่าง = เปิดรับทุกประเภท)
  // Pronista §Meeting Schedule Tab (2026-08-27) — เพิ่ม meetingReminderMinutes (นาทีล่วงหน้าก่อนประชุมเริ่ม ที่จะเตือน — null = ยังไม่ตั้ง ใช้ค่าเริ่มต้น 5 นาที)
  .get('/notification-prefs', async (c) => {
    const me = c.get('user')
    return c.json({ disabledTypes: me.notificationPrefs ?? [], meetingReminderMinutes: me.meetingReminderMinutes ?? DEFAULT_MEETING_REMINDER_MINUTES })
  })

  .patch('/notification-prefs', async (c) => {
    const body = z
      .object({ disabledTypes: z.array(z.enum(NOTIFICATION_TYPES)).optional(), meetingReminderMinutes: z.number().int().min(1).max(120).optional() })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const patch: { notificationPrefs?: string[]; meetingReminderMinutes?: number } = {}
    if (body.data.disabledTypes !== undefined) patch.notificationPrefs = body.data.disabledTypes
    if (body.data.meetingReminderMinutes !== undefined) patch.meetingReminderMinutes = body.data.meetingReminderMinutes
    await db.update(users).set(patch).where(eq(users.id, me.id))
    return c.json({
      disabledTypes: patch.notificationPrefs ?? me.notificationPrefs ?? [],
      meetingReminderMinutes: patch.meetingReminderMinutes ?? me.meetingReminderMinutes ?? DEFAULT_MEETING_REMINDER_MINUTES,
    })
  })
