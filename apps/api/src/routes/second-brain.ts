import { extractUrls } from '@seedoffice/core'
import { createDb, secondBrainLinks } from '@seedoffice/db'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { writeAudit } from '../lib/audit'
import { fetchLineDisplayName, verifyLineSignature } from '../lib/line'
import type { AppEnv } from '../types'

/**
 * Pronista §Second Brain (2026-09-08) — ดักลิงก์จากห้องแชท LINE กลุ่มเดียว (LINE_SECOND_BRAIN_GROUP_ID) มาเก็บไว้ดู (Phase 1: เก็บอย่างเดียว ไม่มี AI สรุป)
 * webhook เป็น public (LINE เรียกตรง ไม่มี auth ของเรา) — mount แยกที่ /api/line/webhook ใน index.ts ไม่ผ่าน requireAuth
 * list/delete mount ที่ /api/second-brain* ผ่าน requireAuth + ceilingMenu('secondBrain') ใน index.ts
 */

interface LineEvent {
  type: string
  message?: { type: string; id: string; text: string }
  source?: { type: string; groupId?: string; userId?: string }
}

export const secondBrainWebhookRoutes = new Hono<AppEnv>().post('/webhook', async (c) => {
  const bodyText = await c.req.text()
  const signature = c.req.header('x-line-signature')
  if (!signature || !(await verifyLineSignature(bodyText, signature, c.env.LINE_CHANNEL_SECRET))) return c.json({ error: 'invalid_signature' }, 401)

  const db = createDb(c.env.DB)
  let body: { events?: LineEvent[] }
  try {
    body = JSON.parse(bodyText)
  } catch {
    return c.json({ ok: true }) // body พังก็ตอบ 200 กัน LINE retry รัว (ไม่ใช่ signature ผิด แค่ parse ไม่ขึ้น)
  }

  for (const event of body.events ?? []) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue
    if (event.source?.type !== 'group' || event.source.groupId !== c.env.LINE_SECOND_BRAIN_GROUP_ID) continue
    const groupId = event.source.groupId
    const messageId = event.message.id
    const urls = extractUrls(event.message.text)
    if (urls.length === 0) continue

    const senderDisplayName = event.source.userId
      ? await fetchLineDisplayName(groupId, event.source.userId, c.env.LINE_CHANNEL_ACCESS_TOKEN)
      : null

    for (const url of urls) {
      await db
        .insert(secondBrainLinks)
        .values({
          url,
          messageText: event.message.text,
          lineMessageId: messageId,
          lineUserId: event.source.userId ?? null,
          senderDisplayName,
        })
        .onConflictDoNothing()
    }
  }

  return c.json({ ok: true })
})

export const secondBrainRoutes = new Hono<AppEnv>()
  .get('/second-brain/links', async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db
      .select()
      .from(secondBrainLinks)
      .where(isNull(secondBrainLinks.deletedAt))
      .orderBy(desc(secondBrainLinks.capturedAt))
      .limit(100)
    return c.json(rows)
  })

  .delete('/second-brain/links/:id', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (
      await db
        .select({ id: secondBrainLinks.id, url: secondBrainLinks.url })
        .from(secondBrainLinks)
        .where(and(eq(secondBrainLinks.id, c.req.param('id')), isNull(secondBrainLinks.deletedAt)))
        .limit(1)
    )[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    await db.update(secondBrainLinks).set({ deletedAt: new Date() }).where(eq(secondBrainLinks.id, before.id))
    await writeAudit(c.env, { actorId: me.id, action: 'second_brain_link.delete', entity: 'second_brain_link', entityId: before.id, meta: { url: before.url } })
    return c.json({ ok: true })
  })
