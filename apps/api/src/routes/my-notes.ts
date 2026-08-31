import { createDb, noteAttachments, NOTE_MEMBER_ROLES, noteMembers, notes, users } from '@seedoffice/db'
import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { writeAudit } from '../lib/audit'
import { INLINE_SAFE_MIME } from '../lib/file-safety'
import { canEditNote, canViewNote, getNoteAccess } from '../lib/notes-access'
import type { AppEnv } from '../types'

/**
 * Pronista §My Note — บันทึกอิสระของแต่ละคน ในแท็บ "My Note" (งานของฉัน) ต่อจาก Daily Report
 * เมานต์ที่ /api/my-notes (ไม่ใช้ /api/notes — path นั้นถูก crm-items.ts ใช้อยู่แล้วสำหรับ clientNotes)
 * body เก็บเป็น JSON string เสมอ: { mode: 'text', text } หรือ { mode: 'checklist', items: {id,text,done}[] }
 * Pronista §My Note sharing + attachments (2026-08-28) — แชร์ได้ (viewer/editor mirror ไฟล์ของฉัน) + แนบไฟล์ได้
 * /my-notes GET คืน "ของฉัน" รวมกับ "ที่ถูกแชร์มา" เป็นลิสต์เดียว (โชว์ปนกันบนบอร์ด มีป้ายชื่อเจ้าของกำกับของที่ไม่ใช่ของตัวเอง — ตกลงกับเจ้าของแล้ว)
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
    const own = await db.select().from(notes).where(eq(notes.userId, me.id))
    const shared = await db
      .select({ note: notes, ownerName: users.name, myRole: noteMembers.role })
      .from(noteMembers)
      .innerJoin(notes, eq(noteMembers.noteId, notes.id))
      .leftJoin(users, eq(notes.userId, users.id))
      .where(eq(noteMembers.userId, me.id))
    const merged = [
      ...own.map((n) => ({ ...n, ownerName: null as string | null, myRole: undefined as 'viewer' | 'editor' | undefined })),
      ...shared.map((r) => ({ ...r.note, ownerName: r.ownerName, myRole: r.myRole })),
    ].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    return c.json(merged)
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
    const id = c.req.param('id')
    const before = (await db.select().from(notes).where(eq(notes.id, id)).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const access = await getNoteAccess(db, id, me.id)
    if (!canEditNote(access)) return c.json({ error: 'forbidden' }, 403)
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
    const id = c.req.param('id')
    const before = (await db.select().from(notes).where(eq(notes.id, id)).limit(1))[0]
    if (!before) return c.json({ error: 'not_found' }, 404)
    const access = await getNoteAccess(db, id, me.id)
    if (!canEditNote(access)) return c.json({ error: 'forbidden' }, 403)
    await db.delete(noteAttachments).where(eq(noteAttachments.noteId, id))
    await db.delete(noteMembers).where(eq(noteMembers.noteId, id))
    await db.delete(notes).where(eq(notes.id, id))
    return c.json({ ok: true })
  })

  // สิทธิ์แชร์ — จัดการได้เฉพาะเจ้าของบันทึกเท่านั้น (mirror my-files.ts)
  .get('/my-notes/:id/members', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const access = await getNoteAccess(db, c.req.param('id'), me.id)
    if (!canViewNote(access)) return c.json({ error: 'forbidden' }, 403)
    const rows = await db
      .select({ id: users.id, name: users.name, role: noteMembers.role })
      .from(noteMembers)
      .innerJoin(users, eq(noteMembers.userId, users.id))
      .where(eq(noteMembers.noteId, c.req.param('id')))
    return c.json(rows)
  })

  .post('/my-notes/:id/members', async (c) => {
    const body = z.object({ userId: z.string(), role: z.enum(NOTE_MEMBER_ROLES) }).safeParse(await c.req.json())
    if (!body.success) return c.json({ error: 'invalid' }, 400)
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const noteId = c.req.param('id')
    const access = await getNoteAccess(db, noteId, me.id)
    if (access !== 'owner') return c.json({ error: 'forbidden' }, 403)
    const upserted = (
      await db
        .insert(noteMembers)
        .values({ noteId, userId: body.data.userId, role: body.data.role })
        .onConflictDoUpdate({ target: [noteMembers.noteId, noteMembers.userId], set: { role: body.data.role } })
        .returning()
    )[0]
    await writeAudit(c.env, { actorId: me.id, action: 'note.share', entity: 'note', entityId: noteId, meta: { userId: body.data.userId, role: body.data.role } })
    return c.json(upserted, 201)
  })

  .delete('/my-notes/:id/members/:userId', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const noteId = c.req.param('id')
    const access = await getNoteAccess(db, noteId, me.id)
    if (access !== 'owner') return c.json({ error: 'forbidden' }, 403)
    await db.delete(noteMembers).where(and(eq(noteMembers.noteId, noteId), eq(noteMembers.userId, c.req.param('userId'))))
    await writeAudit(c.env, { actorId: me.id, action: 'note.unshare', entity: 'note', entityId: noteId, meta: { userId: c.req.param('userId') } })
    return c.json({ ok: true })
  })

  // ไฟล์แนบ — สตรีมตรงเข้า R2 (bucket เดียวกับ "ไฟล์ของฉัน" คนละ prefix) รับได้หลายไฟล์ต่อครั้งจากฝั่งหน้าบ้าน (ยิงทีละ request)
  .get('/my-notes/:id/attachments', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const access = await getNoteAccess(db, c.req.param('id'), me.id)
    if (!canViewNote(access)) return c.json({ error: 'forbidden' }, 403)
    const rows = await db.select().from(noteAttachments).where(eq(noteAttachments.noteId, c.req.param('id'))).orderBy(desc(noteAttachments.createdAt))
    return c.json(rows)
  })

  .post('/my-notes/:id/attachments', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const noteId = c.req.param('id')
    const access = await getNoteAccess(db, noteId, me.id)
    if (!canEditNote(access)) return c.json({ error: 'forbidden' }, 403)
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'file_required' }, 400)
    if (file.size === 0) return c.json({ error: 'file_empty' }, 400)
    const safeName = file.name.replaceAll('/', '_').slice(0, 120)
    const r2Key = `note-attachments/${noteId}/${crypto.randomUUID()}-${safeName}`
    await c.env.FILES.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } })
    const created = (
      await db
        .insert(noteAttachments)
        .values({ noteId, r2Key, name: safeName, mime: file.type || 'application/octet-stream', sizeBytes: file.size, uploadedBy: me.id })
        .returning()
    )[0]!
    return c.json(created, 201)
  })

  .get('/my-notes/attachments/:attId/download', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const att = (await db.select().from(noteAttachments).where(eq(noteAttachments.id, c.req.param('attId'))).limit(1))[0]
    if (!att) return c.json({ error: 'not_found' }, 404)
    const access = await getNoteAccess(db, att.noteId, me.id)
    if (!canViewNote(access)) return c.json({ error: 'forbidden' }, 403)
    const obj = await c.env.FILES.get(att.r2Key)
    if (!obj) return c.json({ error: 'object_missing' }, 404)
    const inlineSafe = att.mime ? INLINE_SAFE_MIME.has(att.mime) : false
    return new Response(obj.body, {
      headers: {
        'content-type': att.mime ?? 'application/octet-stream',
        'content-disposition': `${inlineSafe ? 'inline' : 'attachment'}; filename="${encodeURIComponent(att.name)}"`,
        'cache-control': 'private, max-age=3600',
      },
    })
  })

  .delete('/my-notes/attachments/:attId', async (c) => {
    const db = createDb(c.env.DB)
    const me = c.get('user')
    const att = (await db.select().from(noteAttachments).where(eq(noteAttachments.id, c.req.param('attId'))).limit(1))[0]
    if (!att) return c.json({ error: 'not_found' }, 404)
    const access = await getNoteAccess(db, att.noteId, me.id)
    if (!canEditNote(access)) return c.json({ error: 'forbidden' }, 403)
    if (att.r2Key) await c.env.FILES.delete(att.r2Key)
    await db.delete(noteAttachments).where(eq(noteAttachments.id, att.id))
    return c.json({ ok: true })
  })
