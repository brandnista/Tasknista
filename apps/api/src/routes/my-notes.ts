import { createDb, notes } from '@seedoffice/db'
import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types'

/**
 * Pronista §My Note — บันทึกอิสระของแต่ละคน ในแท็บ "My Note" (งานของฉัน) ต่อจาก Daily Report
 * เมานต์ที่ /api/my-notes (ไม่ใช้ /api/notes — path นั้นถูก crm-items.ts ใช้อยู่แล้วสำหรับ clientNotes)
 * body เก็บเป็น JSON string เสมอ: { mode: 'text', text } หรือ { mode: 'checklist', items: {id,text,done}[] }
 */
export const myNoteRoutes = new Hono<AppEnv>()

const bodyPayload = z.union([
  z.object({ mode: z.literal('text'), text: z.string().max(10000) }),
  z.object({ mode: z.literal('checklist'), items: z.array(z.object({ id: z.string(), text: z.string().max(500), done: z.boolean() })).max(200) }),
])

// Pronista §My Note board — ผูกกลับไปงานที่ Convert สร้างขึ้น เพื่อโชว์เป็น badge บน Post-it (ส่ง null = ลบลิงก์)
const linkPayload = z
  .object({
    kind: z.enum(['epic', 'story', 'task', 'subtask', 'defect']),
    taskId: z.string(),
    code: z.string().nullable(),
    projectId: z.string(),
    projectName: z.string(),
  })
  .nullable()

myNoteRoutes
  .get('/my-notes', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const rows = await db.select().from(notes).where(eq(notes.userId, me.id)).orderBy(desc(notes.updatedAt))
    return c.json(rows)
  })

  .post('/my-notes', async (c) => {
    const body = z.object({ title: z.string().max(200).nullable().optional(), body: bodyPayload }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const inserted = (await db.insert(notes).values({ userId: me.id, title: body.data.title ?? null, body: JSON.stringify(body.data.body) }).returning())[0]!
    return c.json(inserted, 201)
  })

  .patch('/my-notes/:id', async (c) => {
    const body = z
      .object({ title: z.string().max(200).nullable().optional(), body: bodyPayload.optional(), link: linkPayload.optional() })
      .safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select().from(notes).where(and(eq(notes.id, c.req.param('id')), eq(notes.userId, me.id))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if ('title' in body.data) patch.title = body.data.title
    if (body.data.body) patch.body = JSON.stringify(body.data.body)
    if ('link' in body.data) {
      const link = body.data.link
      patch.linkedKind = link?.kind ?? null
      patch.linkedTaskId = link?.taskId ?? null
      patch.linkedCode = link?.code ?? null
      patch.linkedProjectId = link?.projectId ?? null
      patch.linkedProjectName = link?.projectName ?? null
    }
    const updated = (await db.update(notes).set(patch).where(eq(notes.id, before.id)).returning())[0]
    return c.json(updated)
  })

  .delete('/my-notes/:id', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const before = (await db.select().from(notes).where(and(eq(notes.id, c.req.param('id')), eq(notes.userId, me.id))).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    await db.delete(notes).where(eq(notes.id, before.id))
    return c.json({ ok: true })
  })
