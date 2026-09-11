import { extractUrls, stripUrls } from '@seedoffice/core'
import { createDb, secondBrainLinks, users } from '@seedoffice/db'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { fetchLineDisplayName, knownSenderName, verifyLineSignature } from '../lib/line'
import type { AppEnv } from '../types'

/**
 * Pronista §Second Brain (2026-09-08) — ดักลิงก์จากห้องแชท LINE กลุ่มเดียว (LINE_SECOND_BRAIN_GROUP_ID) มาเก็บไว้ดู (Phase 1: เก็บอย่างเดียว ไม่มี AI สรุป)
 * webhook เป็น public (LINE เรียกตรง ไม่มี auth ของเรา) — mount แยกที่ /api/line/webhook ใน index.ts ไม่ผ่าน requireAuth
 * list/create/patch/delete mount ที่ /api/second-brain* ผ่าน requireAuth + ceilingMenu('secondBrain') ใน index.ts
 * §Second Brain Manual/Table (2026-09-08) — เพิ่ม kind (article/solution) + source (line/manual) + note แก้ไขได้ในตาราง
 */

interface LineEvent {
  type: string
  message?: { type: string; id: string; text: string }
  source?: { type: string; groupId?: string; userId?: string }
}

export const secondBrainWebhookRoutes = new Hono<AppEnv>().post('/webhook', async (c) => {
  const bodyText = await c.req.text()
  const signature = c.req.header('x-line-signature')
  // ยังไม่ตั้ง secret จริง (รอพี่ส่งมา) → ปฏิเสธแบบสะอาดๆ ไม่ crash เป็น 500 (importKey กับ key ว่าง/undefined พังได้)
  if (!signature || !c.env.LINE_CHANNEL_SECRET || !(await verifyLineSignature(bodyText, signature, c.env.LINE_CHANNEL_SECRET)))
    return c.json({ error: 'invalid_signature' }, 401)

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
    const text = event.message.text
    const urls = extractUrls(text)
    if (urls.length === 0) continue

    // §Second Brain sender fallback (2026-09-09) — คนที่ยังไม่ได้แอด bot เป็นเพื่อน 1:1 จะดึงชื่อจาก LINE API ไม่ได้ (404 เป็นปกติของ LINE) fallback ไปหาชื่อที่ตั้งไว้เองจาก userId ที่รู้จักแน่นอน
    const senderDisplayName = event.source.userId
      ? ((await fetchLineDisplayName(groupId, event.source.userId, c.env.LINE_CHANNEL_ACCESS_TOKEN)) ?? knownSenderName(event.source.userId, c.env.LINE_KNOWN_SENDERS))
      : null

    for (const url of urls) {
      // §Second Brain Manual/Table (2026-09-08) — ตัดลิงก์ออกจาก note กันโชว์ซ้ำกับลิงก์ที่โชว์แยกอยู่แล้วในตาราง (เดิมเก็บแต่ messageText ดิบ)
      const note = stripUrls(text, [url]) || null
      await db
        .insert(secondBrainLinks)
        .values({
          kind: 'article',
          source: 'line',
          url,
          note,
          messageText: text,
          lineMessageId: messageId,
          lineUserId: event.source.userId ?? null,
          senderDisplayName,
        })
        .onConflictDoNothing()
    }
  }

  return c.json({ ok: true })
})

// §Security Recheck (2026-09-10) — จำกัด scheme เป็น http(s) เท่านั้น กัน stored XSS ผ่าน javascript:/data: URI (Second Brain เห็นร่วมกันทั้งทีม คนอื่นกดลิงก์แล้วโดนได้)
const SAFE_URL_RE = /^https?:\/\//i
const manualCreatePayload = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('article'),
    url: z.string().min(1, { message: 'ใส่ลิงก์' }).max(2000).refine((v) => SAFE_URL_RE.test(v), { message: 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https:// เท่านั้น' }),
    note: z.string().max(2000).optional(),
  }),
  z.object({
    kind: z.literal('solution'),
    problem: z.string().min(1, { message: 'ต้องกรอกปัญหาที่พบ' }).max(2000),
    solutionText: z.string().min(1, { message: 'ต้องกรอกวิธีแก้ไข' }).max(2000),
  }),
])
const patchPayload = z.object({
  note: z.string().max(2000).nullable().optional(),
  problem: z.string().min(1, { message: 'ต้องกรอกปัญหาที่พบ' }).max(2000).optional(),
  solutionText: z.string().min(1, { message: 'ต้องกรอกวิธีแก้ไข' }).max(2000).optional(),
})

export const secondBrainRoutes = new Hono<AppEnv>()
  .get('/second-brain/links', async (c) => {
    const db = createDb(c.env.DB)
    const rows = await db
      .select({ link: secondBrainLinks, creatorName: users.name })
      .from(secondBrainLinks)
      .leftJoin(users, eq(secondBrainLinks.createdByUserId, users.id))
      .where(isNull(secondBrainLinks.deletedAt))
      .orderBy(desc(secondBrainLinks.capturedAt))
      .limit(100)
    return c.json(
      rows.map((r) => ({
        ...r.link,
        // แถวเก่าที่บันทึกก่อนแก้บั๊ก note ซ้ำลิงก์ (ยังไม่มี note เก็บไว้จริง) — คำนวณสดจาก messageText แทน ไม่ต้อง backfill migration
        note: r.link.note ?? (r.link.url ? stripUrls(r.link.messageText ?? '', [r.link.url]) || null : null),
        // แถวเก่าที่ดึงชื่อจาก LINE ไม่ได้ตอนบันทึก (คนส่งยังไม่ได้แอด bot เป็นเพื่อน 1:1) — คำนวณสดจาก LINE_KNOWN_SENDERS แทน
        senderDisplayName: r.link.senderDisplayName ?? (r.link.lineUserId ? knownSenderName(r.link.lineUserId, c.env.LINE_KNOWN_SENDERS) : null),
        creatorName: r.creatorName,
      })),
    )
  })

  .post('/second-brain/links', async (c) => {
    const body = manualCreatePayload.safeParse(await c.req.json())
    // Pronista §Second Brain error message fix (2026-09-11) — เดิมคืน {error:'invalid'} เฉยๆ ทั้งที่ frontend เอา error มาโชว์ตรงๆ เป็น alert ("invalid" ดิบๆ ไม่มีความหมาย) — ดึงข้อความจาก zod issue แทน ตรงกับ pattern ที่ใช้ใน admin.ts
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const created = (
      await db
        .insert(secondBrainLinks)
        .values({
          kind: body.data.kind,
          source: 'manual',
          url: body.data.kind === 'article' ? body.data.url : null,
          note: body.data.kind === 'article' ? (body.data.note ?? null) : null,
          problem: body.data.kind === 'solution' ? body.data.problem : null,
          solutionText: body.data.kind === 'solution' ? body.data.solutionText : null,
          createdByUserId: me.id,
        })
        .returning()
    )[0]!
    await writeAudit(c.env, { actorId: me.id, action: 'second_brain_link.create', entity: 'second_brain_link', entityId: created.id, meta: { kind: created.kind } })
    return c.json({ ...created, creatorName: me.name }, 201)
  })

  .patch('/second-brain/links/:id', async (c) => {
    const body = patchPayload.safeParse(await c.req.json())
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (
      await db
        .select({ id: secondBrainLinks.id, kind: secondBrainLinks.kind })
        .from(secondBrainLinks)
        .where(and(eq(secondBrainLinks.id, c.req.param('id')), isNull(secondBrainLinks.deletedAt)))
        .limit(1)
    )[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    // เช็คว่าฟิลด์ที่ส่งมาตรงกับ kind ของแถวเดิม — article แก้ได้แค่ note, solution แก้ได้แค่ problem/solutionText
    if (before.kind === 'article' && ('problem' in body.data || 'solutionText' in body.data)) return c.json({ error: 'wrong_kind' }, 400)
    if (before.kind === 'solution' && 'note' in body.data) return c.json({ error: 'wrong_kind' }, 400)
    await db.update(secondBrainLinks).set({ ...body.data, updatedAt: new Date() }).where(eq(secondBrainLinks.id, before.id))
    await writeAudit(c.env, { actorId: me.id, action: 'second_brain_link.update', entity: 'second_brain_link', entityId: before.id, meta: {} })
    return c.json({ ok: true })
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
